#!/usr/bin/env node
/**
 * Phase 0 机械盘点（D33 / §21）。
 *
 * 两份盘点合一：
 *   1. 旧 few-shot 按推断 Response Mode 的分布，对照 §11.6 覆盖门槛给出缺口；
 *   2. 现有 Canon、种子、示例、Persona 中需要替换的旧设定词（海岸场景与非亚马逊物种）。
 *
 * 推断结果只作为策划确认缺口的依据，**不写回任何配置**。§18.2 已定：
 * 自动迁移只能生成 reviewStatus=pending 的候选，人工确认后才启用。
 *
 * 用法：
 *   node scripts/inventory-phase0.mjs                    # 读 data/，回退到 data-seed/
 *   node scripts/inventory-phase0.mjs --source data-seed # 强制读种子数据
 *   node scripts/inventory-phase0.mjs --json             # 输出 JSON 便于归档
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RESPONSE_MODES = [
  "COMPANION",
  "ASK_LIGHT",
  "DIRECT_ANSWER",
  "ONE_STEP_HELP",
  "CONFIRM_CHOICE",
  "CELEBRATE",
  "REPAIR",
  "CLOSE",
];

/** §11.6：8 个 mode 各 ≥3，高频三档 ≥5。 */
const MIN_PER_MODE = 3;
const HIGH_FREQUENCY_MODES = ["COMPANION", "ONE_STEP_HELP", "DIRECT_ANSWER"];
const MIN_PER_HIGH_FREQUENCY_MODE = 5;
const MIN_ENERGY_SPREAD = 2;
const MIN_AVOID_CARDS = 2;

/**
 * 推断规则按 §7.3 的 mode 定义写，顺序即优先级：先匹配者胜。
 * 只用显式措辞，不做语义猜测——猜错会让盘点数字失真，而这份数字要用来排工期。
 */
const MODE_RULES = [
  {
    mode: "CLOSE",
    scene: [/结束对话/, /睡/],
    user: [/我睡了/, /改天/, /明天再说/, /不聊了/, /先这样/],
  },
  {
    mode: "REPAIR",
    scene: [/怼我/, /嫌被问/, /不想被安慰/],
    user: [/你.*像客服/, /别再问/, /你没懂/, /重新说/, /套话/],
  },
  {
    mode: "CONFIRM_CHOICE",
    scene: [/已经选定/, /选定动作/],
    user: [/那我先/, /我决定/, /我打算就/, /我去.{0,4}了/],
  },
  {
    mode: "CELEBRATE",
    scene: [/完成/, /好消息/, /进步/],
    user: [/我.*过了/, /终于/, /做完了/, /成了/],
  },
  {
    mode: "ONE_STEP_HELP",
    scene: [/怎么办/, /开始/],
    user: [/怎么办/, /怎么开始/, /怎么弄/, /该做什么/],
  },
  {
    mode: "DIRECT_ANSWER",
    scene: [/该不该/, /问/],
    user: [/该不该/, /是不是/, /为什么/, /算不算/, /\?$/, /？$/],
  },
  {
    mode: "ASK_LIGHT",
    scene: [/想被问/, /想说说/],
    user: [/你怎么不问/, /想说说/, /陪我聊/],
  },
];

/**
 * questionPreference=avoid 的识别，用于 §11.6 的最后一条门槛。
 * 与 mode 推断分开：一条 COMPANION 卡也可能是 avoid 场景。
 */
const AVOID_PATTERNS = [/别问/, /不想说/, /不想被问/, /嫌被问/, /别再问/];

/** §3.2 / §3.3：需要替换的旧设定词。命中即需人工改写。 */
const LEGACY_TERMS = {
  地点: [
    "哥斯达黎加",
    "甘多卡",
    "曼萨尼约",
    "加勒比",
    "Costa Rica",
    "Cahuita",
    "Manzanillo",
    "Puerto Viejo",
  ],
  品牌口号: ["Pura Vida", "pura vida", "普拉维达"],
  海岸场景: [
    "海滩",
    "沙滩",
    "海岸",
    "潮水",
    "涨潮",
    "退潮",
    "远洋",
    "大海",
    "海边",
    "海浪",
    "海风",
  ],
  非亚马逊物种: ["海龟", "绿海龟", "棱皮龟", "寄居蟹", "海鸥", "椰子蟹"],
};

function parseArgs(argv) {
  return {
    source: argv.includes("--source")
      ? argv[argv.indexOf("--source") + 1]
      : null,
    json: argv.includes("--json"),
  };
}

/** JsonStore 写出的文件带 envelope，data-seed 里的是裸对象，两种都要认。 */
function unwrap(parsed) {
  return parsed && typeof parsed === "object" && "data" in parsed
    ? parsed.data
    : parsed;
}

function readStore(name, forcedSource) {
  const candidates = forcedSource
    ? [path.join(forcedSource, `${name}.json`)]
    : [
        path.join(process.env.MORA_DATA_DIR ?? "./data", `${name}.json`),
        path.join("data-seed", `${name}.json`),
      ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) continue;
    try {
      return {
        source: candidate,
        data: unwrap(JSON.parse(fs.readFileSync(resolved, "utf8"))),
      };
    } catch (error) {
      throw new Error(`${candidate} 不是合法 JSON：${error.message}`);
    }
  }
  return { source: null, data: null };
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferMode(sample) {
  for (const rule of MODE_RULES) {
    if (
      matchesAny(rule.scene, sample.scene) ||
      matchesAny(rule.user, sample.user)
    ) {
      return { mode: rule.mode, confident: true };
    }
  }
  // 兜底为 COMPANION 而不是留空：§7.3 的 COMPANION 定义就是「没有明确要求
  // 解决问题」，兜底命中它是正确的默认，但必须标出来供人工复核。
  return { mode: "COMPANION", confident: false };
}

function inventoryExamples(forcedSource) {
  const { source, data } = readStore("fewshot", forcedSource);
  if (!data) {
    return { source: null, total: 0, byMode: {}, rows: [], gaps: [] };
  }

  const items = (data.items ?? []).filter((item) => item.enabled !== false);
  const rows = items.map((item) => {
    const { mode, confident } = inferMode(item);
    return {
      id: item.id,
      scene: item.scene,
      energy: item.energy,
      worldview: item.worldview,
      mode,
      confident,
      avoid: matchesAny(AVOID_PATTERNS, `${item.scene}${item.user}`),
      // §18.2：含世界观的示例要拆成 Example + Seed 两个候选
      needsSplit: item.worldview !== "none",
    };
  });

  const byMode = {};
  for (const mode of RESPONSE_MODES) {
    const matched = rows.filter((row) => row.mode === mode);
    const energies = new Set(
      matched.flatMap((row) => (row.energy === "any" ? ["E0", "E1", "E2", "E3"] : [row.energy])),
    );
    byMode[mode] = {
      count: matched.length,
      inferredOnly: matched.filter((row) => !row.confident).length,
      energySpread: energies.size,
      threshold: HIGH_FREQUENCY_MODES.includes(mode)
        ? MIN_PER_HIGH_FREQUENCY_MODE
        : MIN_PER_MODE,
    };
  }

  const gaps = [];
  for (const mode of RESPONSE_MODES) {
    const entry = byMode[mode];
    if (entry.count < entry.threshold) {
      gaps.push({
        mode,
        kind: "数量",
        need: entry.threshold - entry.count,
        detail: `现有 ${entry.count} 张，门槛 ${entry.threshold} 张`,
      });
    }
    if (entry.count > 0 && entry.energySpread < MIN_ENERGY_SPREAD) {
      gaps.push({
        mode,
        kind: "Energy 覆盖",
        need: MIN_ENERGY_SPREAD - entry.energySpread,
        detail: `只覆盖 ${entry.energySpread} 个 Energy 档，门槛 ${MIN_ENERGY_SPREAD} 个`,
      });
    }
  }

  const avoidCount = rows.filter((row) => row.avoid).length;
  if (avoidCount < MIN_AVOID_CARDS) {
    gaps.push({
      mode: "（跨 mode）",
      kind: "avoid 场景",
      need: MIN_AVOID_CARDS - avoidCount,
      detail: `现有 ${avoidCount} 张，门槛 ${MIN_AVOID_CARDS} 张`,
    });
  }

  return { source, total: rows.length, byMode, rows, gaps, avoidCount };
}

/**
 * 声明行标记：命中这些措辞的行是在**声明禁用词**，不是在使用它们。
 * 不做这层排除，创作指南里的「不得出现：哥斯达黎加、海龟……」会被全部误报，
 * 而这正是 canon lint 最容易犯的错——把自己的禁词清单当成违规内容。
 */
const DECLARATION_MARKERS = [
  /废弃/,
  /不得/,
  /不使用/,
  /不在/,
  /禁用/,
  /禁止/,
  /改写/,
  /改为/,
  /替换/,
  /forbidden/i,
  /legacy/i,
];

function isDeclarationLine(line) {
  return DECLARATION_MARKERS.some((marker) => marker.test(line));
}

function scanText(text, hits, location) {
  // 逐行扫描而不是整份 includes：需要按行判断是使用还是声明。
  const lines = text.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    if (isDeclarationLine(line)) continue;
    for (const [category, terms] of Object.entries(LEGACY_TERMS)) {
      for (const term of terms) {
        if (!line.includes(term)) continue;
        const key = `${category}::${term}`;
        const entry = hits.get(key) ?? { category, term, locations: [] };
        const where = `${location}:${lineIndex + 1}`;
        if (!entry.locations.includes(where)) entry.locations.push(where);
        hits.set(key, entry);
      }
    }
  }
}

function inventoryLegacyTerms(forcedSource) {
  const hits = new Map();
  const scanned = [];

  const targets = [
    { store: "personas", label: "Persona" },
    { store: "fewshot", label: "few-shot" },
    { store: "prompt-presets", label: "Prompt Preset" },
    { store: "settings", label: "Settings" },
  ];

  for (const target of targets) {
    const { source, data } = readStore(target.store, forcedSource);
    if (!data) continue;
    scanned.push(`${target.label} (${source})`);
    // 整份序列化后扫描：字段结构各不相同，逐字段遍历只会漏。
    // 缩进输出让数组每项独占一行，扫描才能按行区分使用与声明。
    scanText(JSON.stringify(data, null, 2), hits, target.label);
  }

  // 创作指南保留在仓库里，但同样不允许出现旧设定词
  for (const file of ["MORA_WORLDVIEW.md", "MORA_STYLE_CORPUS.md"]) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) continue;
    scanned.push(file);
    scanText(fs.readFileSync(resolved, "utf8"), hits, file);
  }

  return { scanned, hits: [...hits.values()] };
}

function printReport(examples, legacy) {
  const line = "─".repeat(64);

  console.log(`\n${line}`);
  console.log("Phase 0 机械盘点（D33）");
  console.log(line);

  console.log(`\n【一】示例卡缺口（对照 §11.6）`);
  console.log(`数据来源：${examples.source ?? "未找到 fewshot 数据"}`);
  console.log(`启用样本总数：${examples.total}`);
  console.log(
    `avoid 场景样本：${examples.avoidCount ?? 0}（门槛 ${MIN_AVOID_CARDS}）\n`,
  );

  console.log("Mode 分布：");
  console.log(
    `  ${"Mode".padEnd(16)}${"现有".padStart(4)}${"门槛".padStart(6)}${"兜底推断".padStart(10)}${"Energy 档".padStart(11)}  状态`,
  );
  for (const mode of RESPONSE_MODES) {
    const entry = examples.byMode[mode] ?? {
      count: 0,
      threshold: MIN_PER_MODE,
      inferredOnly: 0,
      energySpread: 0,
    };
    const ok =
      entry.count >= entry.threshold && entry.energySpread >= MIN_ENERGY_SPREAD;
    console.log(
      `  ${mode.padEnd(16)}${String(entry.count).padStart(4)}${String(entry.threshold).padStart(6)}${String(entry.inferredOnly).padStart(10)}${String(entry.energySpread).padStart(11)}  ${ok ? "达标" : "缺口"}`,
    );
  }

  const needsSplit = examples.rows.filter((row) => row.needsSplit);
  console.log(
    `\n含世界观、需按 §18.2 拆成 Example + Seed 两个候选的样本：${needsSplit.length} 条`,
  );
  for (const row of needsSplit) {
    console.log(`  ${row.id}  ${row.scene}  (worldview=${row.worldview})`);
  }

  const lowConfidence = examples.rows.filter((row) => !row.confident);
  console.log(
    `\n兜底判为 COMPANION、需人工复核的样本：${lowConfidence.length} 条`,
  );
  for (const row of lowConfidence) {
    console.log(`  ${row.id}  ${row.scene}`);
  }

  console.log(`\n缺口清单：`);
  if (examples.gaps.length === 0) {
    console.log("  无");
  } else {
    let totalNeed = 0;
    for (const gap of examples.gaps) {
      if (gap.kind === "数量") totalNeed += gap.need;
      console.log(`  [${gap.kind}] ${gap.mode}：${gap.detail}`);
    }
    console.log(`\n  策划需新写的卡片数（仅数量缺口，不含 Energy 覆盖）：${totalNeed}`);
  }

  console.log(`\n${line}`);
  console.log(`\n【二】旧设定替换清单（对照 §3.2 / §3.3）`);
  console.log(`已扫描：${legacy.scanned.join("、") || "无"}\n`);
  if (legacy.hits.length === 0) {
    console.log("  未命中任何旧设定词。");
  } else {
    for (const hit of legacy.hits) {
      console.log(
        `  [${hit.category}] ${hit.term}  →  出现于 ${hit.locations.join("、")}`,
      );
    }
    console.log(`\n  合计需替换词条：${legacy.hits.length}`);
  }

  console.log(`\n${line}`);
  console.log("盘点结果不写回任何配置。示例卡候选按 §18.2 走人工确认。");
  console.log(`${line}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const examples = inventoryExamples(args.source);
  const legacy = inventoryLegacyTerms(args.source);

  if (args.json) {
    console.log(
      JSON.stringify(
        { generatedAt: new Date().toISOString(), examples, legacy },
        null,
        2,
      ),
    );
    return;
  }

  printReport(examples, legacy);
}

main();
