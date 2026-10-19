import { z } from "zod";

export const accountRoleSchema = z.enum(["admin", "guest"]);
export type AccountRole = z.infer<typeof accountRoleSchema>;

export const accountUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1).max(64),
  role: accountRoleSchema,
  passwordHash: z.string().min(1),
  enabled: z.boolean(),
  displayName: z.string().min(1).max(80),
});
export type AccountUser = z.infer<typeof accountUserSchema>;

export const accountsFileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  users: z.array(accountUserSchema).min(1),
});
export type AccountsFile = z.infer<typeof accountsFileSchema>;

export type PublicSessionUser = {
  id: string;
  username: string;
  role: AccountRole;
  displayName: string;
};
