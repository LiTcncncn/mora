/**
 * 将代码中的 Phase A 起步示例卡同步到 data/ 与 deploy bundle。
 * 用法：npx tsx scripts/apply-phase-a-examples.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDefaultBehaviorConfig,
  extractHashable,
  type BehaviorConfigV2,
} from "../src/domain/behavior-config";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGETS = [
  path.join(ROOT, "data/behavior-config.json"),
  path.join(ROOT, "deploy/v2-data-bundle/behavior-config.json"),
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

function computeConfigHash(config: BehaviorConfigV2): string {
  const payload = JSON.stringify(canonicalize(extractHashable(config)));
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

const cards = buildDefaultBehaviorConfig("默认配置").exampleCards;

function countByMode(list: typeof cards): Record<string, number> {
  const by: Record<string, number> = {};
  for (const card of list) {
    by[card.responseMode] = (by[card.responseMode] ?? 0) + 1;
  }
  return by;
}

for (const filePath of TARGETS) {
  const store = JSON.parse(readFileSync(filePath, "utf8")) as {
    data: { items: Array<{ config: BehaviorConfigV2 }> };
  };
  const entry = store.data.items[0];
  if (!entry?.config) {
    console.error("skip (no config):", filePath);
    continue;
  }
  const prev = Number(entry.config.exampleLibraryVersion ?? 1);
  entry.config.exampleCards = cards;
  entry.config.exampleLibraryVersion = String(prev + 1);
  entry.config.configHash = computeConfigHash(entry.config);
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
  console.log(
    path.relative(ROOT, filePath),
    "cards",
    cards.length,
    countByMode(cards),
    "hash",
    entry.config.configHash,
  );
}
