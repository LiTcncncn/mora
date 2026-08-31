import "server-only";
import {
  BEHAVIOR_CONFIG_SCHEMA_VERSION,
  DEPRECATED_CONFIG_KEYS,
  behaviorConfigExportSchema,
  exampleLibraryExportSchema,
  worldviewLibraryExportSchema,
  type BehaviorConfigExport,
  type BehaviorConfigV2,
  type ExampleLibraryExport,
  type WorldviewLibraryExport,
} from "@/domain/behavior-config";
import { moraConfigBundleSchema } from "@/domain/config-bundle";
import { AppError } from "../api/errors";
import { canonicalize } from "./behavior-hash";

/**
 * §13.6.1、§13.6.2、§13.6.7、§13.6.8：导出与文件判别。
 *
 * 导入流程本身在 `behavior-import.ts`——这里只负责「把配置变成文件」和
 * 「判断一个文件是什么」，两者都不触碰活动配置。
 */

export type TransferKind =
  | "mora_behavior_config"
  | "mora_worldview_library"
  | "mora_example_library";

/** §13.6.8：单文件体积上限。触发上限说明有数据混入。 */
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

// ------------------------------------------------------------ 序列化

/**
 * §13.6.8：2 空格缩进、键序稳定，使文件可进 git diff。
 * 这是策划批量编辑素材的主要工作方式。
 */
export function serializeExport(payload: unknown): string {
  const text = `${JSON.stringify(canonicalize(payload), null, 2)}\n`;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_EXPORT_BYTES) {
    throw new AppError(
      "CONFLICT",
      `导出文件 ${(bytes / 1024 / 1024).toFixed(1)} MB 超过 8 MB 上限，请改用单库导出`,
    );
  }

  return text;
}

/**
 * §13.6.7：白名单序列化。
 *
 * 按 `BehaviorConfigV2` 的字段逐项挑选，而不是取整个 store 再删除敏感字段。
 * 后者在新增字段时会默认泄露，前者在新增字段时默认不导出——两种默认失败
 * 方向，只有前者是安全的。
 *
 * 因此这个函数刻意写成逐字段罗列而不是展开 `...config`：展开会让任何新增到
 * 活动配置上的字段自动进入导出文件，而新增字段时最可能忘的就是回来检查
 * 这里。多写十几行换掉这个失败方向是值得的。
 */
export function buildConfigExport(
  config: BehaviorConfigV2,
  exportedAt: string,
): BehaviorConfigExport {
  const payload: BehaviorConfigExport = {
    schemaVersion: BEHAVIOR_CONFIG_SCHEMA_VERSION,
    kind: "mora_behavior_config",
    exportedAt,
    sourceProfileName: config.sourceProfileName,

    taxonomyVersion: config.taxonomyVersion,
    energyPolicyVersion: config.energyPolicyVersion,
    strategyPolicyVersion: config.strategyPolicyVersion,
    worldviewVersion: config.worldviewVersion,
    exampleLibraryVersion: config.exampleLibraryVersion,
    configHash: config.configHash,

    brandCanon: config.brandCanon,
    router: config.router,
    requestFlags: config.requestFlags,
    energy: config.energy,
    majorEvent: config.majorEvent,
    safety: config.safety,
    strategies: config.strategies,
    worldview: config.worldview,
    exampleRetrieval: config.exampleRetrieval,
    responseContract: config.responseContract,

    canonFacts: config.canonFacts,
    worldviewSeeds: config.worldviewSeeds,
    exampleCards: config.exampleCards,
  };

  // strict schema 在这里第二次把关：任何漏在白名单外又混进来的字段会被拒绝。
  return behaviorConfigExportSchema.parse(payload);
}

/**
 * 单库文件不含 `configHash` 与五个 version——它们是主配置的属性，
 * 单库导入后由接收端重新计算（§13.6.1）。
 */
export function buildWorldviewLibraryExport(
  config: BehaviorConfigV2,
  exportedAt: string,
): WorldviewLibraryExport {
  return worldviewLibraryExportSchema.parse({
    schemaVersion: BEHAVIOR_CONFIG_SCHEMA_VERSION,
    kind: "mora_worldview_library",
    exportedAt,
    sourceProfileName: config.sourceProfileName,
    canonFacts: config.canonFacts,
    worldviewSeeds: config.worldviewSeeds,
  });
}

export function buildExampleLibraryExport(
  config: BehaviorConfigV2,
  exportedAt: string,
): ExampleLibraryExport {
  return exampleLibraryExportSchema.parse({
    schemaVersion: BEHAVIOR_CONFIG_SCHEMA_VERSION,
    kind: "mora_example_library",
    exportedAt,
    sourceProfileName: config.sourceProfileName,
    exampleCards: config.exampleCards,
  });
}

/**
 * §13.6.8：文件名把 hash 放进去，便于在不打开文件的情况下判断两份导出
 * 是否相同。
 */
export function buildExportFileName(
  kind: TransferKind,
  sourceProfileName: string,
  configHash: string,
  now: Date,
): string {
  const prefix = {
    mora_behavior_config: "mora-config",
    mora_worldview_library: "mora-worldview",
    mora_example_library: "mora-examples",
  }[kind];

  const date = now.toISOString().slice(0, 10);
  // 文件名里不能出现路径分隔符与空格，否则下载与命令行操作都会出问题。
  const safeName =
    sourceProfileName.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 40) ||
    "profile";

  return `${prefix}-${safeName}-${date}-${configHash.slice(0, 8)}.json`;
}

// ------------------------------------------------------------ 判别

export type DetectedFile =
  | { generation: 1; bundle: ReturnType<typeof moraConfigBundleSchema.parse> }
  | { generation: 2; kind: "mora_behavior_config"; payload: BehaviorConfigExport }
  | {
      generation: 2;
      kind: "mora_worldview_library";
      payload: WorldviewLibraryExport;
    }
  | {
      generation: 2;
      kind: "mora_example_library";
      payload: ExampleLibraryExport;
    };

/**
 * §13.6.2：判别只看 `schemaVersion`，然后在 v2 内部按 `kind` 分流。
 *
 * 判别顺序与拒绝提示按规格逐条实现。`schemaVersion > 2` 必须**显式拒绝**
 * 而不是尝试兼容：读一个字段更多的未来文件看似能用，实际会静默丢弃新字段，
 * 导出时再写回去就造成数据损失。
 */
export function detectConfigFile(raw: string): DetectedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "不是合法 JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("VALIDATION_ERROR", "无法识别的配置文件");
  }

  const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
  if (typeof schemaVersion !== "number") {
    throw new AppError("VALIDATION_ERROR", "无法识别的配置文件");
  }

  if (schemaVersion === 1) {
    const result = moraConfigBundleSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "这是一份 v1 配置文件，但结构校验失败，无法迁移",
      );
    }
    return { generation: 1, bundle: result.data };
  }

  if (schemaVersion > BEHAVIOR_CONFIG_SCHEMA_VERSION) {
    throw new AppError(
      "VALIDATION_ERROR",
      "该文件来自更新版本的 Lab，当前程序不支持导入",
    );
  }

  if (schemaVersion !== BEHAVIOR_CONFIG_SCHEMA_VERSION) {
    throw new AppError("VALIDATION_ERROR", "无法识别的配置文件");
  }

  // 已废弃键名在 strict schema 里只会报成「未知字段」。先指名拒绝，
  // 因为这类文件几乎都来自手工把 v1 配置改成 v2，而「配置里还有
  // minOrganicGap」比「未知字段」更能让人知道该改哪里（§13.4）。
  const deprecated = findDeprecatedKeys(parsed);
  if (deprecated.length > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `配置文件中出现已废弃的键名 ${deprecated.join("、")}，请改用 §13.2 的新字段名`,
    );
  }

  const kind = (parsed as Record<string, unknown>).kind;
  switch (kind) {
    case "mora_behavior_config":
      return {
        generation: 2,
        kind,
        payload: parseStrict(behaviorConfigExportSchema, parsed, "完整配置"),
      };
    case "mora_worldview_library":
      return {
        generation: 2,
        kind,
        payload: parseStrict(worldviewLibraryExportSchema, parsed, "世界观素材库"),
      };
    case "mora_example_library":
      return {
        generation: 2,
        kind,
        payload: parseStrict(exampleLibraryExportSchema, parsed, "示例卡库"),
      };
    default:
      // kind 不识别时直接拒绝，不做猜测（§13.6.1）。
      throw new AppError(
        "VALIDATION_ERROR",
        `无法识别的文件类型 kind=${String(kind)}`,
      );
  }
}

/** 递归查找已废弃键名，任意嵌套深度都要命中。 */
function findDeprecatedKeys(value: unknown): string[] {
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;

    for (const [key, child] of Object.entries(node)) {
      if (DEPRECATED_CONFIG_KEYS.includes(key)) found.add(key);
      walk(child);
    }
  };

  walk(value);
  return [...found];
}

function parseStrict<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    const detail = summarizeZodError(result.error);
    throw new AppError(
      "VALIDATION_ERROR",
      `${label}文件结构校验失败${detail ? `：${detail}` : ""}`,
    );
  }
  return result.data;
}

/** 结构错误要指名字段，否则策划手工编辑素材后无从下手。 */
function summarizeZodError(error: unknown): string {
  if (
    error === null ||
    typeof error !== "object" ||
    !("issues" in error) ||
    !Array.isArray((error as { issues: unknown }).issues)
  ) {
    return "";
  }

  const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> })
    .issues;

  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
      return path ? `${path}（${issue.message ?? ""}）` : (issue.message ?? "");
    })
    .filter(Boolean)
    .join("；");
}
