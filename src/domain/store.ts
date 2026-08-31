import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const CURRENT_SCHEMA_VERSION = 1;

export interface StoreEnvelope<T> {
  schemaVersion: number;
  updatedAt: string;
  data: T;
}

export function storeEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    schemaVersion: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
    data: dataSchema,
  });
}
