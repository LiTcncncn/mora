import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import {
  deviceConfigSchema,
  type DeviceConfig,
  type DeviceRecord,
  type DevicesData,
  type DeviceStatusView,
} from "@/domain/device";
import { createDeviceAuthenticator, type DeviceIdentity } from "./identity";
import {
  DeviceLink,
  type DeviceBinding,
  type DeviceLinkHooks,
  type RunDeviceTurn,
} from "./link";

export function playbackGain(volume: number): number {
  const clamped = Math.min(100, Math.max(0, volume));
  return (clamped / 100) * 2.5;
}

/** 网关只通过这几个口子读写设备登记表，测试里可以换成内存实现。 */
export interface DeviceRegistryPort {
  read(): Promise<DevicesData>;
  register(identity: DeviceIdentity): Promise<{ record: DeviceRecord; binding: Omit<DeviceBinding, "deviceId"> }>;
  applyConfig(config: DeviceConfig, options: { applyVolume: boolean }): Promise<unknown>;
  update(
    deviceId: string,
    patch: Partial<Pick<DeviceRecord, "displayName" | "volume" | "enabled">>,
  ): Promise<DeviceRecord>;
  archiveConversation(deviceId: string): Promise<unknown>;
}

export interface DeviceGateway {
  port: number;
  close: () => Promise<void>;
}

interface Session {
  socket: WebSocket;
  link: DeviceLink;
  identity: DeviceIdentity;
}

/** 连上后这么久还没通过鉴权就断开，公网上不留空连接。 */
const AUTH_TIMEOUT_MS = 10_000;

function rawToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readBody(request);
  return raw.trim() === "" ? {} : JSON.parse(raw);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function lanAddress(): string | null {
  const preferred: string[] = [];
  const others: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("192.168.31.")) preferred.push(entry.address);
      else others.push(entry.address);
    }
  }
  return preferred[0] ?? others[0] ?? null;
}

function advertise(port: number, address: string): ChildProcess {
  const child = spawn(
    "dns-sd",
    ["-P", "ZHAKA", "_zhaka._tcp", "local", String(port), "zhaka.local", address],
    { stdio: "ignore" },
  );
  // 云服务器上没有 dns-sd，局域网广播只是本地开发的便利。
  child.on("error", () => undefined);
  return child;
}

const devicePatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    volume: z.number().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const configBodySchema = z.object({
  config: deviceConfigSchema,
  applyVolume: z.boolean().default(false),
});

export function startDeviceGateway(options: {
  token: string;
  port?: number;
  runTurn: RunDeviceTurn;
  registry: DeviceRegistryPort;
  advertiseHost?: boolean;
  hooks?: Omit<DeviceLinkHooks, "onAuthenticated" | "transcribe">;
  transcribe?: (wav: Blob, signal: AbortSignal, deviceId: string | null) => Promise<string>;
}): DeviceGateway {
  const port = options.port ?? 8787;
  const authenticate = createDeviceAuthenticator(options.token);
  const sessions = new Map<string, Session>();
  const { registry } = options;

  /** 从登记表重新取这台设备的绑定和音量，套到当前连接上。 */
  async function refresh(session: Session): Promise<void> {
    const { record, binding } = await registry.register(session.identity);
    if (sessions.get(session.identity.deviceId) !== session) return;
    session.link.setPlaybackGain(playbackGain(record.volume));
    session.link.setBinding(record.enabled ? { ...binding, deviceId: record.deviceId } : null);
  }

  function refreshAll(): Promise<void> {
    return Promise.all([...sessions.values()].map((session) => refresh(session))).then(() => undefined);
  }

  const server = createServer((request, response) => {
    void handleControl(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "网关处理失败";
      if (!response.headersSent) sendJson(response, 500, { ok: false, error: message });
    });
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => {
    let session: Session | null = null;
    const authTimer = setTimeout(() => {
      if (!session) socket.close();
    }, AUTH_TIMEOUT_MS);
    const link = new DeviceLink(
      authenticate,
      (frame) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(frame);
      },
      options.runTurn,
      20,
      {
        ...options.hooks,
        transcribe: options.transcribe
          ? (wav, signal) => options.transcribe!(wav, signal, session?.identity.deviceId ?? null)
          : undefined,
        onAuthenticated: (identity) => {
          clearTimeout(authTimer);
          const previous = sessions.get(identity.deviceId);
          if (previous) {
            previous.link.close();
            previous.socket.close();
          }
          session = { socket, link, identity };
          sessions.set(identity.deviceId, session);
          const current = session;
          void refresh(current)
            .then(() => {
              console.log(
                `[device-gateway] ${identity.deviceId} 上线 固件${identity.firmwareVersion ?? "旧版"} RSSI ${identity.rssi ?? "-"}`,
              );
            })
            .catch((error: unknown) => {
              console.error(`[device-gateway] ${identity.deviceId} 登记失败`, error);
            });
        },
      },
    );
    socket.on("message", (data: RawData) => {
      link.onMessage(rawToBuffer(data));
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      link.close();
      if (session && sessions.get(session.identity.deviceId) === session) {
        sessions.delete(session.identity.deviceId);
        console.log(`[device-gateway] ${session.identity.deviceId} 离线`);
      }
    });
  });

  async function statusView(): Promise<{ config: DeviceConfig; items: DeviceStatusView[] }> {
    const data = await registry.read();
    return {
      config: data.config,
      items: data.items.map((record) => {
        const session = sessions.get(record.deviceId);
        return {
          ...record,
          online: session !== undefined,
          mic: session?.link.micSnapshot() ?? { ok: null, bars: Array<number>(16).fill(0) },
        };
      }),
    };
  }

  async function handleControl(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopback(request)) {
      sendJson(response, 403, { ok: false, error: "只接受本机控制" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, { ok: true, data: await statusView() });
      return;
    }
    if (request.method === "PUT" && url.pathname === "/config") {
      const parsed = configBodySchema.safeParse(await readJson(request));
      if (!parsed.success) {
        sendJson(response, 400, { ok: false, error: "硬件配置参数不合法" });
        return;
      }
      await registry.applyConfig(parsed.data.config, { applyVolume: parsed.data.applyVolume });
      await refreshAll();
      sendJson(response, 200, { ok: true, data: await statusView() });
      return;
    }

    const match = /^\/devices\/([^/]+)(?:\/(archive|provision|haptic))?$/.exec(url.pathname);
    if (!match) {
      sendJson(response, 404, { ok: false, error: "没有这个接口" });
      return;
    }
    const deviceId = decodeURIComponent(match[1]!);
    const action = match[2];
    const session = sessions.get(deviceId);

    if (request.method === "PATCH" && !action) {
      const parsed = devicePatchSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        sendJson(response, 400, { ok: false, error: "设备参数不合法" });
        return;
      }
      const record = await registry.update(deviceId, parsed.data);
      if (session) await refresh(session);
      sendJson(response, 200, { ok: true, data: record });
      return;
    }
    if (request.method === "POST" && action === "archive") {
      await registry.archiveConversation(deviceId);
      if (session) await refresh(session);
      sendJson(response, 200, { ok: true, data: await statusView() });
      return;
    }
    if (request.method === "POST" && (action === "provision" || action === "haptic")) {
      if (!session) {
        sendJson(response, 409, { ok: false, error: "设备不在线" });
        return;
      }
      if (action === "haptic") session.link.pulse(500);
      else session.link.requestProvision();
      sendJson(response, 200, { ok: true, data: { deviceId } });
      return;
    }
    sendJson(response, 404, { ok: false, error: "没有这个接口" });
  }

  let mdns: ChildProcess | null = null;
  server.listen({ port, host: "0.0.0.0", exclusive: true });
  if (options.advertiseHost !== false) {
    const address = lanAddress();
    if (address) {
      mdns = advertise(port, address);
      console.log(`[device-gateway] ws://zhaka.local:${port} (${address})`);
    } else {
      console.log(`[device-gateway] 监听 ${port}，没有局域网地址，不做 mDNS 广播`);
    }
  }

  return {
    port,
    close: () =>
      new Promise((resolve) => {
        mdns?.kill();
        for (const session of sessions.values()) session.link.close();
        sockets.close();
        server.close(() => resolve());
      }),
  };
}
