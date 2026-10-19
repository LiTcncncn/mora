/**
 * Memory 日历：相对时间窗解析（P0）。
 * 产品默认时区 Asia/Shanghai；民事日用 YYYY-MM-DD。
 */

export const MEMORY_CALENDAR_TIME_ZONE = "Asia/Shanghai";

export interface MemoryTimeWindow {
  startOn: string;
  endOn: string;
  label: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 将瞬间格式化为指定时区的民事日。 */
export function formatCivilDate(
  instant: Date,
  timeZone: string = MEMORY_CALENDAR_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return instant.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

export function parseCivilDate(dateOn: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOn);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** 用 UTC 正午做加减，避免 DST；仅用于民事日算术。 */
function civilToUtcNoon(dateOn: string): Date | null {
  const parsed = parseCivilDate(dateOn);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12));
}

export function addCivilDays(dateOn: string, deltaDays: number): string {
  const base = civilToUtcNoon(dateOn);
  if (!base) return dateOn;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

/** 周一=0 … 周日=6（中国常用周起算）。 */
function mondayBasedWeekday(dateOn: string): number {
  const base = civilToUtcNoon(dateOn);
  if (!base) return 0;
  // getUTCDay: 0=Sun … 6=Sat → Mon=0
  return (base.getUTCDay() + 6) % 7;
}

function startOfWeekMonday(dateOn: string): string {
  return addCivilDays(dateOn, -mondayBasedWeekday(dateOn));
}

function endOfWeekSunday(dateOn: string): string {
  return addCivilDays(startOfWeekMonday(dateOn), 6);
}

function startOfMonth(dateOn: string): string {
  const parsed = parseCivilDate(dateOn);
  if (!parsed) return dateOn;
  return `${parsed.year}-${pad2(parsed.month)}-01`;
}

function endOfMonth(dateOn: string): string {
  const parsed = parseCivilDate(dateOn);
  if (!parsed) return dateOn;
  const nextMonth = new Date(Date.UTC(parsed.year, parsed.month, 1, 12));
  nextMonth.setUTCDate(0);
  return `${nextMonth.getUTCFullYear()}-${pad2(nextMonth.getUTCMonth() + 1)}-${pad2(nextMonth.getUTCDate())}`;
}

/**
 * 从用户话里识别回顾类时间窗。无明确相对时间则返回 null（走普通选记忆）。
 */
export function parseRelativeTimeWindow(
  userMessage: string,
  now: Date = new Date(),
  timeZone: string = MEMORY_CALENDAR_TIME_ZONE,
): MemoryTimeWindow | null {
  const text = userMessage.trim();
  if (!text) return null;
  const today = formatCivilDate(now, timeZone);

  const rules: Array<{ pattern: RegExp; build: () => MemoryTimeWindow }> = [
    {
      pattern: /大前天/,
      build: () => {
        const day = addCivilDays(today, -3);
        return { startOn: day, endOn: day, label: "大前天" };
      },
    },
    {
      pattern: /前天/,
      build: () => {
        const day = addCivilDays(today, -2);
        return { startOn: day, endOn: day, label: "前天" };
      },
    },
    {
      pattern: /昨天|昨日/,
      build: () => {
        const day = addCivilDays(today, -1);
        return { startOn: day, endOn: day, label: "昨天" };
      },
    },
    {
      pattern: /今天|今日/,
      build: () => ({ startOn: today, endOn: today, label: "今天" }),
    },
    {
      pattern: /上周|上星期|上个星期/,
      build: () => {
        const thisMonday = startOfWeekMonday(today);
        const lastMonday = addCivilDays(thisMonday, -7);
        return {
          startOn: lastMonday,
          endOn: addCivilDays(lastMonday, 6),
          label: "上周",
        };
      },
    },
    {
      pattern: /本周|这周|这个星期|这一周/,
      build: () => ({
        startOn: startOfWeekMonday(today),
        endOn: endOfWeekSunday(today),
        label: "本周",
      }),
    },
    {
      pattern: /上个月|上月/,
      build: () => {
        const thisStart = startOfMonth(today);
        const lastMonthDay = addCivilDays(thisStart, -1);
        return {
          startOn: startOfMonth(lastMonthDay),
          endOn: endOfMonth(lastMonthDay),
          label: "上个月",
        };
      },
    },
    {
      pattern: /这个月|本月/,
      build: () => ({
        startOn: startOfMonth(today),
        endOn: endOfMonth(today),
        label: "这个月",
      }),
    },
    {
      pattern: /最近几天|这几天|近几天/,
      build: () => ({
        startOn: addCivilDays(today, -3),
        endOn: today,
        label: "最近几天",
      }),
    },
    {
      pattern: /最近一周|近一周|过去一周|这一周来/,
      build: () => ({
        startOn: addCivilDays(today, -6),
        endOn: today,
        label: "最近一周",
      }),
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.build();
  }
  return null;
}

/** 记忆区间与查询窗是否相交（皆为闭区间民事日）。 */
export function memoryOverlapsTimeWindow(
  occurredOn: string | null,
  occurredEndOn: string | null,
  window: MemoryTimeWindow,
): boolean {
  if (!occurredOn) return false;
  const start = occurredOn;
  const end = occurredEndOn && occurredEndOn >= occurredOn ? occurredEndOn : occurredOn;
  return start <= window.endOn && end >= window.startOn;
}

/**
 * 从用户原话推断事发锚定日（写入用）。
 * 优先匹配更具体的相对词；无则 null。
 */
export function inferOccurredOnFromText(
  text: string,
  now: Date = new Date(),
  timeZone: string = MEMORY_CALENDAR_TIME_ZONE,
): { occurredOn: string; occurredPrecision: "day" | "week" | "month" } | null {
  const window = parseRelativeTimeWindow(text, now, timeZone);
  if (!window) return null;
  if (window.startOn === window.endOn) {
    return { occurredOn: window.startOn, occurredPrecision: "day" };
  }
  if (window.label.includes("周")) {
    return { occurredOn: window.startOn, occurredPrecision: "week" };
  }
  if (window.label.includes("月")) {
    return { occurredOn: window.startOn, occurredPrecision: "month" };
  }
  return { occurredOn: window.startOn, occurredPrecision: "day" };
}
