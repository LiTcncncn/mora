/**
 * 生成 accounts.json 用的密码哈希（与 §12.5 一致）。
 * 用法：npx tsx scripts/hash-accounts.ts > data-seed/accounts.json
 */
import { randomBytes, scryptSync } from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const ACCOUNTS = [
  { id: "user-admin-1", username: "admin", role: "admin", password: "a9k2m4", displayName: "管理员" },
  { id: "user-guest-01", username: "guest01", role: "guest", password: "g1m7w4", displayName: "体验账号 01" },
  { id: "user-guest-02", username: "guest02", role: "guest", password: "g2r8x3", displayName: "体验账号 02" },
  { id: "user-guest-03", username: "guest03", role: "guest", password: "g3t5h9", displayName: "体验账号 03" },
  { id: "user-guest-04", username: "guest04", role: "guest", password: "g4v2j6", displayName: "体验账号 04" },
  { id: "user-guest-05", username: "guest05", role: "guest", password: "g5q4l8", displayName: "体验账号 05" },
  { id: "user-guest-06", username: "guest06", role: "guest", password: "g6n9w3", displayName: "体验账号 06" },
  { id: "user-guest-07", username: "guest07", role: "guest", password: "g7k1y7", displayName: "体验账号 07" },
  { id: "user-guest-08", username: "guest08", role: "guest", password: "g8h6r5", displayName: "体验账号 08" },
  { id: "user-guest-09", username: "guest09", role: "guest", password: "g9p3e4", displayName: "体验账号 09" },
  { id: "user-guest-10", username: "guest10", role: "guest", password: "g0c8d2", displayName: "体验账号 10" },
] as const;

const file = {
  schemaVersion: 1 as const,
  updatedAt: new Date().toISOString(),
  users: ACCOUNTS.map((account) => ({
    id: account.id,
    username: account.username,
    role: account.role,
    passwordHash: hashPassword(account.password),
    enabled: true,
    displayName: account.displayName,
  })),
};

process.stdout.write(`${JSON.stringify(file, null, 2)}\n`);
