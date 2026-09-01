/**
 * 一次性迁移：抹掉成本估算、空壳日志开关、few-shot 注入这三块留下的字段。
 *
 * 大部分字段是 Zod 的未知键，读取时会被自动剥离，不迁移也能跑。但 `few_shot`
 * 是从 contextSectionId 枚举里删掉的成员，它出现在 settings.sectionOrder、
 * prompt-presets.sections、runs[].contextSnapshot.sections 三处数组里，
 * 枚举校验失败会让整个 store 读不出来，必须先清掉。
 *
 * 顺手把其余死字段一并清干净，避免导出的配置里还挂着已经不存在的键。
 *
 * 用法：node scripts/migrate-remove-dead-settings.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const TARGET_DIRS = ["data", "data-seed"];

let changedFiles = 0;
const log = [];

function cleanEnergy(energy) {
  if (!energy?.policies) return;
  for (const policy of Object.values(energy.policies)) {
    if (policy && typeof policy === "object") {
      delete policy.validationWeight;
      delete policy.actionWeight;
    }
  }
}

function cleanContext(context) {
  if (!context || typeof context !== "object") return;
  delete context.fewShot;
  if (Array.isArray(context.sectionOrder)) {
    context.sectionOrder = context.sectionOrder.filter((id) => id !== "few_shot");
  }
}

function cleanProviders(providers) {
  if (!providers || typeof providers !== "object") return;
  for (const provider of Object.values(providers)) {
    if (provider && typeof provider === "object") delete provider.pricing;
  }
}

function cleanSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  cleanProviders(settings.providers);
  cleanEnergy(settings.energy);
  cleanContext(settings.context);
  if (settings.logging && typeof settings.logging === "object") {
    // 只留容量上限，三个快照开关已固定为“总是保存”。
    settings.logging = { maxRuns: settings.logging.maxRuns };
  }
}

const TRANSFORMS = {
  "settings.json": (data) => {
    for (const item of data.items ?? []) cleanSettings(item.settings);
  },

  "prompt-presets.json": (data) => {
    for (const preset of data.items ?? []) {
      if (!Array.isArray(preset.sections)) continue;
      // safety_baseline 由服务端常量无条件注入，存储里这条的 template 与 title
      // 从来不被读取，留着只会让人以为它可以改。
      preset.sections = preset.sections.filter(
        (section) => section.id !== "few_shot" && section.id !== "safety_baseline",
      );
    }
  },

  "personas.json": (data) => {
    for (const persona of data.items ?? []) {
      // 全仓零引用：enabled 与 activePersonaId 重复，language 是固定常量。
      delete persona.enabled;
      delete persona.language;
    }
  },

  "runs.json": (data) => {
    for (const run of data.items ?? []) {
      delete run.estimatedCost;

      const snapshot = run.contextSnapshot;
      if (snapshot && typeof snapshot === "object") {
        delete snapshot.selectedFewShotIds;
        delete snapshot.fewShotSelectionTrace;
        if (Array.isArray(snapshot.sections)) {
          snapshot.sections = snapshot.sections.filter(
            (section) => section.id !== "few_shot",
          );
        }
      }

      const settingsSnapshot = run.settingsSnapshot;
      if (settingsSnapshot && typeof settingsSnapshot === "object") {
        if (settingsSnapshot.provider) delete settingsSnapshot.provider.pricing;
        cleanEnergy(settingsSnapshot.common?.energy);
        cleanContext(settingsSnapshot.common?.context);
      }
    }
  },
};

for (const dir of TARGET_DIRS) {
  if (!fs.existsSync(dir)) continue;

  for (const [fileName, transform] of Object.entries(TRANSFORMS)) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    // data/ 下是带信封的 store 文件，data-seed/ 下同样带信封。
    const payload = parsed.data ?? parsed;
    transform(payload);

    const next = `${JSON.stringify(parsed, null, 2)}\n`;
    if (next === raw) {
      log.push(`  未变化  ${filePath}`);
      continue;
    }

    changedFiles += 1;
    log.push(`  已清理  ${filePath}`);
    if (!DRY_RUN) fs.writeFileSync(filePath, next, "utf8");
  }
}

console.log(DRY_RUN ? "试运行（不写入）：" : "迁移完成：");
console.log(log.join("\n"));
console.log(`\n${changedFiles} 个文件需要改动。`);
