const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{8,}/gi,
];

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|authorization|apikey|secret|token|password)/i;

export const REDACTED = "[REDACTED]";

/**
 * 清洗任意文本中的密钥痕迹。
 * knownSecrets 为进程内真实密钥，必须优先整体替换。
 */
export function sanitizeText(text: string, knownSecrets: string[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 8) {
      result = result.split(secret).join(REDACTED);
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/** 递归清洗对象，敏感键名直接替换值。 */
export function sanitizeValue(
  value: unknown,
  knownSecrets: string[] = [],
  depth = 0,
): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") return sanitizeText(value, knownSecrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, knownSecrets, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeValue(item, knownSecrets, depth + 1);
    }
    return output;
  }
  return undefined;
}
