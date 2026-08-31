import "server-only";
import type { ProviderId } from "@/domain/common";
import { deepSeekAdapter } from "./deepseek";
import { kimiAdapter } from "./kimi";
import type { ModelAdapter } from "./types";

/** 新增供应商只需在此注册，orchestrator 不需要改动。 */
const adapters: Record<ProviderId, ModelAdapter> = {
  kimi: kimiAdapter,
  deepseek: deepSeekAdapter,
};

export function getAdapter(provider: ProviderId): ModelAdapter {
  return adapters[provider];
}

export function listAdapters(): ModelAdapter[] {
  return Object.values(adapters);
}
