import "server-only";
import { setDefaultResultOrder } from "node:dns";
import { Agent } from "undici";

/** 大模型测试的网络探测与密钥校验默认等待时间。 */
export const DIAGNOSE_TIMEOUT_MS = 30_000;

/**
 * Node 默认可能先走 IPv6。本机 AAAA 常被解析到无关地址（证书对不上），
 * IPv4 经 VPN TUN 才是正确路径。
 */
setDefaultResultOrder("ipv4first");

export function createProviderAgent(timeoutMs: number): Agent {
  return new Agent({
    connectTimeout: timeoutMs,
    connect: {
      timeout: timeoutMs,
      family: 4,
    },
  });
}

/**
 * 同时设置 AbortController 与 undici TCP 连接超时。
 * 只改 abort 不够：Node 默认连接超时约 10 秒，会先于应用层超时失败。
 */
export async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = createProviderAgent(timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher,
    } as RequestInit);
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}
