const HARD_BOUNDARIES = new Set(["。", "！", "？", "!", "?", "；", ";", "…", "\n"]);
const SOFT_BOUNDARIES = new Set(["，", ",", "、", "："]);
const TRAILING_CLOSERS = new Set(["”", "」", "』", "\"", "'", "’", "…"]);
const OPENERS = new Set(["（", "("]);
const CLOSERS = new Set(["）", ")"]);

/** 首句尽早送 TTS 以压低首响；后续句子更长，减少停顿。 */
const FIRST_SOFT_MIN_CHARS = 6;
const LATER_SOFT_MIN_CHARS = 24;

/**
 * 把流式文本切成适合 TTS 的短句。
 * 括号未闭合时不切分，保证舞台动作能被整体清洗掉。
 */
export class SentenceSegmenter {
  private buffer = "";
  private emitted = 0;

  push(delta: string): string[] {
    this.buffer += delta;
    const output: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === null) break;
      const segment = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      if (segment.trim()) {
        output.push(segment);
        this.emitted += 1;
      }
    }
    return output;
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? [rest] : [];
  }

  private findCut(): number | null {
    const chars = [...this.buffer];
    const softMin = this.emitted === 0 ? FIRST_SOFT_MIN_CHARS : LATER_SOFT_MIN_CHARS;
    let depth = 0;
    let offset = 0;
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index]!;
      offset += char.length;
      if (OPENERS.has(char)) depth += 1;
      else if (CLOSERS.has(char)) depth = Math.max(0, depth - 1);
      if (depth > 0) continue;

      const hard = HARD_BOUNDARIES.has(char);
      const soft = SOFT_BOUNDARIES.has(char) && index + 1 >= softMin;
      if (!hard && !soft) continue;

      let end = offset;
      let next = index + 1;
      while (next < chars.length && TRAILING_CLOSERS.has(chars[next]!)) {
        end += chars[next]!.length;
        next += 1;
      }
      return end;
    }
    return null;
  }
}
