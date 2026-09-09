import "server-only";

/**
 * 面向 TTS / 硬件语音：用户侧只应听到可朗读的对话正文。
 * 模型偶发泄漏的舞台指示、内部分析、计划复述用括号包起来——此处做确定性清洗。
 *
 * Lab Run 的 outputText 仍应保留供应商原文；清洗结果用于对话气泡 / 播报。
 */

const FULLWIDTH_PAREN = /（[^（）]*）/g;
const HALFWIDTH_PAREN = /\([^()]*\)/g;

/** 去掉成对括号及其内容（含全角/半角）；多轮扫以处理嵌套简单情况。 */
export function stripParentheticalBlocks(text: string): string {
  let previous = "";
  let current = text;
  let guard = 0;
  while (current !== previous && guard < 8) {
    previous = current;
    current = current.replace(FULLWIDTH_PAREN, "").replace(HALFWIDTH_PAREN, "");
    guard += 1;
  }
  return current;
}

/** 去掉单独成行的计划/分析残句（无括号时）。 */
function stripLeakedPlanLines(text: string): string {
  return text
    .split(/\n+/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^(本轮必须|提问执行|必须做到|不要做|用户说)/.test(trimmed)) {
        return false;
      }
      if (/内部判断|回复计划|不可省略/.test(trimmed) && trimmed.length < 80) {
        return false;
      }
      return true;
    })
    .join("\n");
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([，。！？、；：])/g, "$1")
    .trim();
}

/**
 * 将模型原文整理为可播报对话。
 * 若清洗后为空，回退原文（避免把合法短回复洗没）；硬件侧仍应优先避免脏输出进模型。
 */
export function sanitizeForSpeech(raw: string): {
  text: string;
  stripped: boolean;
} {
  const original = raw ?? "";
  let next = stripParentheticalBlocks(original);
  next = stripLeakedPlanLines(next);
  next = collapseWhitespace(next);

  if (!next) {
    return { text: collapseWhitespace(original), stripped: false };
  }

  return {
    text: next,
    stripped: next !== collapseWhitespace(original),
  };
}
