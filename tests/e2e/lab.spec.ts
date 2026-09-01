import { expect, test, type Page } from "@playwright/test";

const FAILED_TEXT = "调用失败";

/** 拦截 compare 请求，模拟一个成功槽位与一个失败槽位，不消耗真实 API。 */
async function mockCompare(page: Page): Promise<void> {
  await page.route("**/api/compare", async (route) => {
    const body = route.request().postDataJSON() as { conversationId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          comparisonGroupId: "cmp-e2e",
          sharedContextHash: "sharedhash000000",
          userMessageId: "msg-user",
          conversationId: body.conversationId,
          candidates: [],
          memoryExtraction: {
            status: "succeeded",
            candidateIds: [],
            displayText: "",
          },
        },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
});

test("总览页展示当前档案与启用槽位", async ({ page }) => {
  await expect(page.getByText("当前档案", { exact: true })).toBeVisible();
  await expect(page.getByText("启用模型槽位")).toBeVisible();
  await expect(page.getByText("Kimi：已配置")).toBeVisible();
});

test("页面上不会出现任何 API Key 痕迹", async ({ page }) => {
  for (const path of ["/", "/settings", "/compare", "/studio", "/models"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const html = await page.content();
    expect(html).not.toContain("sk-e2e-kimi-placeholder");
    expect(html).not.toContain("sk-e2e-deepseek-placeholder");
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
  }
});

test("修改设置后刷新仍然保留", async ({ page }) => {
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Energy 能量档位与低电量策略" })
    .click();

  const threshold = page.locator("input[type=number]").first();
  await threshold.waitFor();

  await page.getByRole("button", { name: "Memory 记忆选择与自动提取" }).click();
  const topK = page.locator("label", { hasText: "topK" }).locator("input");
  await topK.fill("4");

  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("已保存到本机")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Memory 记忆选择与自动提取" }).click();
  await expect(
    page.locator("label", { hasText: "topK" }).locator("input"),
  ).toHaveValue("4");
});

test("新建测试档案后数据相互隔离", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "本地测试档案" }).click();

  const name = `档案 ${Date.now()}`;
  await page.getByPlaceholder("新档案名称").fill(name);
  await page.getByRole("button", { name: "新建档案" }).click();

  const row = page.locator("li").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "切换" }).click();
  await expect(row).toContainText("当前");

  await page.goto("/memory");
  await expect(page.getByText("这个档案还没有已确认的记忆")).toBeVisible();
});

test("失败槽位只显示调用失败，不展示任何保底文本", async ({ page }) => {
  await mockCompare(page);
  await page.goto("/compare");

  await page.getByRole("button", { name: "新建对话" }).click();
  const input = page.getByPlaceholder("写一句话");
  await input.fill("今天好累");

  await page.route("**/api/conversations/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const payload = (await response.json()) as {
      ok: boolean;
      data: { messages: unknown[] };
    };
    payload.data.messages = [
      {
        id: "msg-user",
        role: "user",
        content: "今天好累",
        createdAt: new Date().toISOString(),
        runId: null,
        modelSlotId: null,
        provider: null,
        modelId: null,
        comparisonGroupId: "cmp-e2e",
      },
    ];
    await route.fulfill({ json: payload });
  });

  await page.route("**/api/runs?*", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        data: {
          total: 1,
          nextCursor: null,
          items: [
            {
              id: "run-failed",
              profileId: "profile-default",
              // 必须是种子里真实存在的槽位，否则 buildTurns 会把这条车道整列过滤掉。
              modelSlotId: "slot-kimi",
              slotLabel: "Kimi",
              comparisonGroupId: "cmp-e2e",
              conversationId: "conv-e2e",
              mode: "compare",
              status: "failed",
              provider: "kimi",
              modelId: "kimi-k2.6",
              startedAt: new Date().toISOString(),
              completedAt: null,
              latencyMs: null,
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                source: "unavailable",
              },
              finishReason: null,
              contextHash: "lanehash00000000",
              sharedContextHash: "sharedhash000000",
              error: { code: "PROVIDER_TIMEOUT", message: "超时", retryable: true },
            },
          ],
        },
      },
    });
  });

  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText(FAILED_TEXT).first()).toBeVisible();
  await expect(page.getByText("今天好累").first()).toBeVisible();
});

test("Prompt Studio 中安全底线只读且未知变量阻止保存", async ({ page }) => {
  await page.goto("/studio");

  // 安全底线是列表第一条，且不提供任何编辑控件。
  const baseline = page
    .getByTestId("prompt-section")
    .filter({ has: page.locator('[data-section-id="safety_baseline"]') })
    .or(page.locator('[data-section-id="safety_baseline"]'))
    .first();
  await expect(baseline).toBeVisible();
  await expect(baseline.locator("textarea")).toHaveCount(0);
  await expect(baseline.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByText("产品安全底线（只读，不可编辑）")).toBeVisible();

  const saveButton = page.getByRole("button", {
    name: "保存 Prompt Preset 提示词预设",
  });
  await expect(saveButton).toBeEnabled();

  const editableSection = page
    .getByTestId("prompt-section")
    .filter({ has: page.locator("textarea") })
    .first();
  await editableSection
    .locator("textarea")
    .fill("{{process.env.OPENAI_API_KEY}}");

  await expect(page.getByText("未知变量").first()).toBeVisible();
  await expect(saveButton).toBeDisabled();
});

test("Studio 可直接预览组装结果，不需要先建对话", async ({ page }) => {
  await page.goto("/studio");

  await expect(
    page.getByRole("button", { name: "组装结果预览（只读，不写入任何数据）" }),
  ).toBeVisible();

  await page.getByLabel("测试用的一句话").fill("今天什么都不想做");
  await page.getByRole("button", { name: "生成预览" }).click();

  // 安全底线必须是预览里的第一段。
  await expect(page.getByText(/^1\. 产品安全底线（\d+ 字符）$/)).toBeVisible();
  await expect(page.getByText("字符总数")).toBeVisible();
});

test("Studio 可复制并切换 Persona 与预设", async ({ page }) => {
  await page.goto("/studio");

  const personaSelect = page.getByLabel(/当前 Persona 人格/);
  await expect(personaSelect).toBeVisible();
  const before = await personaSelect.locator("option").count();

  await page
    .locator("div")
    .filter({ has: personaSelect })
    .getByRole("button", { name: "复制一版" })
    .first()
    .click();

  await expect(personaSelect.locator("option")).toHaveCount(before + 1);
  // 复制后应当自动切到副本。
  await expect(personaSelect).toHaveValue(
    await personaSelect.locator("option").last().getAttribute("value") ?? "",
  );
});

test("大模型测试页给出分步结论", async ({ page }, testInfo) => {
  await page.route("**/api/providers/diagnose", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        data: {
          provider: "kimi",
          modelId: "kimi-k2.6",
          baseUrl: "https://api.moonshot.cn/v1",
          steps: [
            {
              id: "config",
              label: "config 密钥配置",
              status: "ok",
              detail: "已在服务端读取到 API Key",
              latencyMs: null,
            },
            {
              id: "network",
              label: "network 网络连通",
              status: "failed",
              detail: "无法访问",
              latencyMs: 10000,
            },
          ],
          conclusion: "网络层就失败了，本机根本没有连上该地址",
          availableModels: [],
        },
      },
    });
  });

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "菜单" }).click();
    await page.locator("header").getByRole("link", { name: "大模型测试" }).click();
  } else {
    await page.locator("aside").getByRole("link", { name: "大模型测试" }).click();
  }
  await expect(page.getByRole("heading", { name: "大模型测试" })).toBeVisible();

  const diagnose = page.getByRole("button", { name: "开始检测" });
  await expect(diagnose).toBeEnabled();
  await diagnose.click();

  await expect(page.getByText("network 网络连通")).toBeVisible();
  await expect(page.getByText("网络层就失败了")).toBeVisible();
});

test("移动端与桌面端布局都可用", async ({ page }, testInfo) => {
  await page.goto("/compare");
  await page.getByRole("button", { name: "新建对话" }).click();

  const input = page.getByPlaceholder("写一句话");
  await expect(input).toBeVisible();

  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200);

  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("button", { name: "菜单" })).toBeVisible();
  }

  // 页面不应出现横向滚动。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
