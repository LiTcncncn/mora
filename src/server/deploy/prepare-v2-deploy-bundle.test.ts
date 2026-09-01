/**
 * 生成 v2 云端发布数据包（Step 0）。
 * 运行：npm run prepare:deploy
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  behaviorConfigStoreDataSchema,
  buildDefaultBehaviorConfig,
  type BehaviorConfigV2,
} from "@/domain/behavior-config";
import { conversationsDataSchema } from "@/domain/conversation";
import { memoriesDataSchema } from "@/domain/memory";
import { personasDataSchema } from "@/domain/persona";
import { profilesDataSchema } from "@/domain/profile";
import { promptPresetsDataSchema } from "@/domain/prompt";
import { runsDataSchema } from "@/domain/run";
import { settingsStoreDataSchema } from "@/domain/settings";
import { computeConfigHash } from "@/server/config/behavior-hash";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const SEED = path.join(ROOT, "data-seed");
const OUT = path.join(ROOT, "deploy", "v2-data-bundle");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeEnvelope(filePath: string, data: unknown): void {
  const envelope = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    data,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function finalizeBehaviorConfig(profileName: string): BehaviorConfigV2 {
  const base = buildDefaultBehaviorConfig(profileName);
  return { ...base, configHash: computeConfigHash(base) };
}

describe("prepare v2 deploy bundle", () => {
  it("writes deploy/v2-data-bundle and materializes behavior-config", () => {
    const profilesEnvelope = readJson<{
      data: ReturnType<typeof profilesDataSchema.parse>;
    }>(path.join(DATA, "profiles.json"));
    const profiles = profilesDataSchema.parse(profilesEnvelope.data);
    const defaultProfile = profiles.items.find((p) => p.id === "profile-default");
    expect(defaultProfile).toBeTruthy();

    const personas = personasDataSchema.parse(
      readJson<{ data: unknown }>(path.join(DATA, "personas.json")).data,
    );
    const settings = settingsStoreDataSchema.parse(
      readJson<{ data: unknown }>(path.join(DATA, "settings.json")).data,
    );
    const presets = promptPresetsDataSchema.parse(
      readJson<{ data: unknown }>(path.join(DATA, "prompt-presets.json")).data,
    );

    const settingsEntry = settings.items.find(
      (item) => item.profileId === "profile-default",
    );
    expect(settingsEntry).toBeTruthy();
    const activePersonaId = settingsEntry!.settings.activePersonaId;
    const activePresetId = settingsEntry!.settings.activePromptPresetId;
    expect(
      personas.items.some(
        (p) => p.id === activePersonaId && p.profileId === "profile-default",
      ),
    ).toBe(true);
    expect(
      presets.items.some(
        (p) => p.id === activePresetId && p.profileId === "profile-default",
      ),
    ).toBe(true);

    const behaviorEnvelope = readJson<{
      data: { items: Array<{ profileId: string; config: BehaviorConfigV2 }> };
    }>(path.join(DATA, "behavior-config.json"));

    let behaviorConfig: BehaviorConfigV2;
    const existing = behaviorEnvelope.data.items.find(
      (item) => item.profileId === "profile-default",
    );
    if (existing?.config?.configHash) {
      behaviorConfig = existing.config;
    } else {
      behaviorConfig = finalizeBehaviorConfig(defaultProfile!.name);
      writeEnvelope(path.join(DATA, "behavior-config.json"), {
        items: [{ profileId: "profile-default", config: behaviorConfig }],
      });
    }

    behaviorConfigStoreDataSchema.parse({
      items: [{ profileId: "profile-default", config: behaviorConfig }],
    });

    fs.mkdirSync(OUT, { recursive: true });

    const configFiles = [
      "profiles.json",
      "settings.json",
      "personas.json",
      "prompt-presets.json",
    ] as const;
    for (const name of configFiles) {
      fs.copyFileSync(path.join(DATA, name), path.join(OUT, name));
    }

    writeEnvelope(path.join(OUT, "behavior-config.json"), {
      items: [{ profileId: "profile-default", config: behaviorConfig }],
    });

    for (const name of ["conversations.json", "memories.json", "runs.json"] as const) {
      fs.copyFileSync(path.join(SEED, name), path.join(OUT, name));
    }

    conversationsDataSchema.parse(
      readJson<{ data: unknown }>(path.join(OUT, "conversations.json")).data,
    );
    memoriesDataSchema.parse(
      readJson<{ data: unknown }>(path.join(OUT, "memories.json")).data,
    );
    runsDataSchema.parse(
      readJson<{ data: unknown }>(path.join(OUT, "runs.json")).data,
    );

    const manifest = {
      generatedAt: new Date().toISOString(),
      profileId: "profile-default",
      profileName: defaultProfile!.name,
      activePersonaId,
      activePresetId,
      behaviorConfigHash: behaviorConfig.configHash,
      files: [
        "profiles.json",
        "settings.json",
        "personas.json",
        "prompt-presets.json",
        "behavior-config.json",
        "conversations.json",
        "memories.json",
        "runs.json",
      ],
    };
    fs.writeFileSync(
      path.join(OUT, "MANIFEST.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    console.log("deploy bundle:", OUT);
    console.log("configHash:", behaviorConfig.configHash);
  });
});
