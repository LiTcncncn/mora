import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 每个测试文件使用独立的数据目录，绝不触碰真实 data/。
process.env.MORA_DATA_DIR = mkdtempSync(path.join(tmpdir(), "mora-test-"));
process.env.KIMI_API_KEY = "sk-test-kimi-key-value";
process.env.KIMI_BASE_URL = "https://api.moonshot.test/v1";
process.env.DEEPSEEK_API_KEY = "sk-test-deepseek-key-value";
process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.test";
