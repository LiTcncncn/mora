import "server-only";
import path from "node:path";
import { z } from "zod";

/**
 * 只解析允许的环境变量。绝不导出 key 值本身给任何调用方以外的层，
 * 也绝不序列化整个 process.env。
 */
const optionalKey = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  KIMI_API_KEY: optionalKey,
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.cn/v1"),
  DEEPSEEK_API_KEY: optionalKey,
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  MINIMAX_API_KEY: optionalKey,
  MINIMAX_BASE_URL: z.string().url().default("https://api.minimax.cn"),
  MINIMAX_ASR_MODEL: z.string().min(1).default("asr-1.0"),
  MINIMAX_TTS_MODEL: z.string().min(1).default("speech-2.8-turbo"),
  MORA_DATA_DIR: z.string().min(1).default("./data"),
  /** 会话签名密钥；生产必须设置。 */
  SESSION_SECRET: z.string().min(16).optional(),
  /** 硬件 WebSocket 鉴权。只放在服务端和固件本地配置。 */
  DEVICE_TOKEN: optionalKey,
});

const blankToUndefined = (value: string | undefined): string | undefined =>
  value && value.trim() !== "" ? value : undefined;

const parsed = envSchema.safeParse({
  KIMI_API_KEY: process.env.KIMI_API_KEY,
  KIMI_BASE_URL: process.env.KIMI_BASE_URL,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_BASE_URL: blankToUndefined(process.env.MINIMAX_BASE_URL),
  MINIMAX_ASR_MODEL: blankToUndefined(process.env.MINIMAX_ASR_MODEL),
  MINIMAX_TTS_MODEL: blankToUndefined(process.env.MINIMAX_TTS_MODEL),
  MORA_DATA_DIR: process.env.MORA_DATA_DIR,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DEVICE_TOKEN: process.env.DEVICE_TOKEN,
});

if (!parsed.success) {
  throw new Error(
    `环境变量校验失败：${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
  );
}

const env = parsed.data;

export function getKimiApiKey(): string | null {
  return env.KIMI_API_KEY ?? null;
}

export function getKimiBaseUrl(): string {
  return env.KIMI_BASE_URL;
}

export function getDeepSeekApiKey(): string | null {
  return env.DEEPSEEK_API_KEY ?? null;
}

export function getDeepSeekBaseUrl(): string {
  return env.DEEPSEEK_BASE_URL;
}

export function getMinimaxApiKey(): string | null {
  return env.MINIMAX_API_KEY ?? null;
}

export function getMinimaxBaseUrl(): string {
  return env.MINIMAX_BASE_URL.replace(/\/$/, "");
}

export function getMinimaxAsrModel(): string {
  return env.MINIMAX_ASR_MODEL;
}

export function getMinimaxTtsModel(): string {
  return env.MINIMAX_TTS_MODEL;
}

export function getDataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), env.MORA_DATA_DIR);
}

/** 只暴露布尔值，绝不暴露 key、前缀或后四位。 */
export function getProviderConfiguredStatus(): {
  kimi: { configured: boolean };
  deepseek: { configured: boolean };
  minimax: { configured: boolean };
} {
  return {
    kimi: { configured: env.KIMI_API_KEY !== undefined },
    deepseek: { configured: env.DEEPSEEK_API_KEY !== undefined },
    minimax: { configured: env.MINIMAX_API_KEY !== undefined },
  };
}

/** 供 sanitizer 使用的密钥列表，不对外导出到任何响应。 */
export function getSecretValues(): string[] {
  return [
    env.KIMI_API_KEY,
    env.DEEPSEEK_API_KEY,
    env.MINIMAX_API_KEY,
    env.SESSION_SECRET,
    env.DEVICE_TOKEN,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** HTTP 阶段可用开发默认；生产务必设置 SESSION_SECRET。 */
export function getDeviceToken(): string | null {
  return env.DEVICE_TOKEN ?? null;
}

export function getSessionSecret(): string {
  return (
    env.SESSION_SECRET ??
    "zhaka-dev-session-secret-change-me"
  );
}
