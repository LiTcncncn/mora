import { defineConfig, devices } from "@playwright/test";

const PORT = 3311;
// 必须与 Next dev 绑定的 host 一致，否则客户端 chunk 会被跨源保护拦截。
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: { baseURL, trace: "off" },
  // 使用本机已安装的 Chrome，避免额外下载 Playwright 自带浏览器。
  // 如需使用自带 Chromium，删除 channel 并运行 npx playwright install chromium。
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // E2E 使用独立数据目录，绝不写入开发用的 data/。
      MORA_DATA_DIR: "./.e2e-data",
      KIMI_API_KEY: "sk-e2e-kimi-placeholder",
      DEEPSEEK_API_KEY: "sk-e2e-deepseek-placeholder",
    },
  },
});
