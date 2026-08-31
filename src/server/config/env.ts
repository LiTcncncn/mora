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
  MORA_DATA_DIR: z.string().min(1).default("./data"),
});

const parsed = envSchema.safeParse({
  KIMI_API_KEY: process.env.KIMI_API_KEY,
  KIMI_BASE_URL: process.env.KIMI_BASE_URL,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  MORA_DATA_DIR: process.env.MORA_DATA_DIR,
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

export function getDataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), env.MORA_DATA_DIR);
}

/** 只暴露布尔值，绝不暴露 key、前缀或后四位。 */
export function getProviderConfiguredStatus(): {
  kimi: { configured: boolean };
  deepseek: { configured: boolean };
} {
  return {
    kimi: { configured: env.KIMI_API_KEY !== undefined },
    deepseek: { configured: env.DEEPSEEK_API_KEY !== undefined },
  };
}

/** 供 sanitizer 使用的密钥列表，不对外导出到任何响应。 */
export function getSecretValues(): string[] {
  return [env.KIMI_API_KEY, env.DEEPSEEK_API_KEY].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}
