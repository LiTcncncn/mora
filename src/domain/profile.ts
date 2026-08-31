import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const testProfileSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TestProfile = z.infer<typeof testProfileSchema>;

export const profilesDataSchema = z
  .object({
    activeProfileId: idSchema,
    items: z.array(testProfileSchema).min(1),
  })
  .refine(
    (value) => value.items.some((item) => item.id === value.activeProfileId),
    { message: "activeProfileId 必须指向存在的档案", path: ["activeProfileId"] },
  );
export type ProfilesData = z.infer<typeof profilesDataSchema>;
