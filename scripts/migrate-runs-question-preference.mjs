/**
 * 迁移 runs.json：为历史 turnPlan 补 questionPreference，并将 maxQuestions 收敛到 ≤1。
 *
 * 用法：node scripts/migrate-runs-question-preference.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const FILE = path.join("data", "runs.json");

function resolveQuestionPreference(run, turnPlan) {
  const fromTrace = run.behaviorTrace?.routing?.questionPreference?.value;
  if (fromTrace === "invite" || fromTrace === "neutral" || fromTrace === "avoid") {
    return fromTrace;
  }
  // 历史记录无 Router 快照时，用 neutral 占位即可通过 schema；不影响已完成的回复。
  return "neutral";
}

function patchTurnPlan(run, turnPlan) {
  if (!turnPlan || typeof turnPlan !== "object") return 0;
  let changed = 0;

  if (!("questionPreference" in turnPlan)) {
    turnPlan.questionPreference = resolveQuestionPreference(run, turnPlan);
    changed++;
  }

  const budget = turnPlan.responseBudget;
  if (budget && typeof budget.maxQuestions === "number" && budget.maxQuestions > 1) {
    budget.maxQuestions = 1;
    changed++;
  }

  return changed;
}

if (!fs.existsSync(FILE)) {
  console.log("未找到 data/runs.json，跳过。");
  process.exit(0);
}

const raw = fs.readFileSync(FILE, "utf8");
const envelope = JSON.parse(raw);
const items = envelope.data?.items ?? [];
let patchedPlans = 0;

for (const run of items) {
  patchedPlans += patchTurnPlan(run, run.contextSnapshot?.turnPlan);
  patchedPlans += patchTurnPlan(run, run.behaviorTrace?.turnPlan);
}

const next = `${JSON.stringify(envelope, null, 2)}\n`;
if (next === raw) {
  console.log("runs.json 无需改动。");
  process.exit(0);
}

console.log(`${DRY_RUN ? "试运行" : "已迁移"}：${patchedPlans} 处 turnPlan 字段已修补。`);

if (!DRY_RUN) {
  const bak = `${FILE}.bak`;
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(FILE, bak);
    console.log(`已备份 → ${bak}`);
  }
  fs.writeFileSync(FILE, next, "utf8");
  console.log(`已写入 ${FILE}`);
}
