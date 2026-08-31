# MORA Lab Web Demo — Cursor 实施规格

> 文档用途：将本文件放在项目根目录，由 Cursor 直接读取并按阶段实施。
>
> 项目类型：本地单机实验型 Web Demo，不是生产系统。
>
> 技术栈：Next.js App Router + React + TypeScript + Tailwind CSS。
>
> 状态：MVP 实施基线。

---

## 0. 给 Cursor 的执行指令

你正在实现 **MORA Lab**：一个用于调试树懒陪伴式对话体验、比较 OpenAI 与 DeepSeek 输出差异的本地 Web 实验台。

执行时必须遵守以下规则：

1. 先完整阅读本文件，再创建或修改代码。
2. 严格按“阶段实施清单”的顺序推进；一次只完成一个阶段。
3. 每完成一个阶段：
   - 运行 lint、类型检查和该阶段相关测试；
   - 修复所有由本次改动引入的问题；
   - 对照该阶段验收条件逐项自检；
   - 在回复中列出已完成项、验证结果、剩余项和任何假设。
4. 不得擅自引入数据库、云服务、RAG、向量库、微调、语音、登录、账号体系或部署平台；允许使用无登录的本地测试档案隔离不同测试用户的数据。
5. 优先使用简单、清晰、可检查的实现。不要为了“未来扩展”提前引入复杂框架。
6. 所有影响模型行为的设置必须在 UI 中可见；适合实验调试的设置必须可编辑。
7. 同一轮多模型比较必须复用完全相同的 Persona、Energy、Memory、Prompt 和当前用户输入；每个 model slot 维护自己的 assistant 历史。首轮完整 Context 相同，后续轮次只允许因各槽位既有 assistant 回复而产生历史差异。
8. 所有 API Key 只能由 Next.js 服务端读取。任何 API Key 都不得进入浏览器、React props、客户端状态、localStorage、sessionStorage、页面 HTML、API 响应、日志或错误信息。
9. 所有本地 JSON 数据写入都必须先校验，并采用串行写入与原子替换，避免并发写坏文件。
10. 不确定的供应商参数必须通过 adapter capability 判断；不要假设 OpenAI 和 DeepSeek 支持完全相同的参数。
11. 不要硬编码会快速过期的价格。价格必须是可编辑的本地配置，成本结果必须标记为估算值。
12. 未经明确要求，不要修改本规格定义的 MVP 边界。
13. 任何 LLM 调用失败后都不得返回预设话术、规则生成文本、旧缓存、其他模型结果或任何伪装成模型回复的 fallback；最终失败状态在对应容器显示“调用失败”。
14. 绝对禁止在应用层硬截断、切片或改写模型已经返回的生成内容；必须完整保存和展示供应商实际返回文本。

如果这是一个空目录，从阶段 1 开始。如果项目已经存在，先审查现状，只补齐缺失部分，并保持已有的合理实现。

---

## 1. 产品目标

MORA Lab 不是普通聊天网页，而是一个可观察、可调参、可复现实验的“陪伴式对话实验台”。MVP 必须同时支持：

- 通过启用或停用 model slots 决定本轮参与的模型；只启用一个槽位时自然形成单模型测试，不另设独立聊天流程；
- 同一句用户输入并行调用全部启用的模型槽位，在独立容器中进行公平比较；
- 配置并调试 Persona；
- 配置并调试 Energy State 与 Low-Energy Policy；
- 为不同本地测试档案隔离设置、对话与 Memory；
- 从聊天过程中生成结构化 Memory 候选，经人工确认后再写入对应测试档案的正式 Memory；
- 在本地创建、编辑、启停、删除和检索 Memory；
- 每轮确定性地构建 Context，并查看模型实际收到的内容；
- 在 Prompt Studio 编辑 prompt 分区、预览最终 prompt，并保存版本/预设；
- 将最终行为配置导出为可下载、可校验且不含密钥的配置文件，并支持从该文件导入；
- 暴露所有影响模型行为的参数；
- 记录运行日志、token、估算成本、延迟、错误、上下文快照和设置快照；
- 为未来人工评分和自动评测保留标准接口；首版不实现评分 UI。

### 1.1 MVP 不做什么

以下内容明确不在 MVP 范围内：

- 不做语料库微调或任何模型训练；
- 不做 RAG、知识库、向量数据库或 embedding 检索；
- 不做语音输入、语音合成或实时音频；
- 不使用 PostgreSQL、MySQL、SQLite、Redis 或任何数据库；
- 不做登录、账号体系、权限或云同步；本地测试档案不等同于账号或多租户系统；
- 不做多设备同步；
- 不做公开互联网部署；
- 不做复杂工作流编排、Agent 工具调用或外部插件；
- 不声称提供医疗诊断、心理治疗或紧急救援服务。

### 1.2 成功标准

这个 Demo 的价值不由 UI 华丽程度衡量，而由以下问题能否被快速回答衡量：

1. OpenAI 与 DeepSeek 在首轮相同上下文、后续独立模型对话分支下，哪个持续体验更接近理想的 MORA？
2. 某次回复为什么变长、变短、变主动或变得不够温和？
3. Persona、Energy、Memory、历史窗口和模型参数分别对结果造成了什么影响？
4. 某次结果能否利用设置快照与上下文快照被解释和近似复现？
5. 每条 Memory 是否只属于产生它的测试档案，并经过人工确认？
6. 最终调试配置能否安全导出、重新导入并复现主要行为设置？

### 1.3 已确认的首版产品约束

- 严格实现纯文字 MORA Lab，不实现语音相关功能；
- 首版在本地运行；未来云端化不属于本规格，不能据此提前引入云存储或账号体系；
- 首批供应商为 OpenAI 与 DeepSeek。产品界面使用供应商与模型 ID，不把“ChatGPT”当作 API provider ID；
- adapter registry 必须允许未来增加供应商，但不提前实现插件平台或通用工作流框架；
- 多模型并行比较的首要目标是选择最终模型供应商；
- 不建立标准测试话术、理想回复数据集或 LLM-as-a-judge；
- 产品语言仅做简体中文；
- MORA 默认人格由实现提供 seed，树懒角色表达保持克制，弱化排他或依赖性的关系语言；相关 Persona 文本仍可编辑；
- Safety baseline 必须保留，但安全评级暂不作为首版评估重点；
- Memory 来自聊天过程，可额外调用 LLM 生成结构化候选，但必须归属单个测试档案并经人工确认；
- 不实现人工评分系统；保留 runs、快照和未来 evaluation hook/schema；
- UI 极简、无装饰性视觉元素，以信息层级、排版和可用性为主，同时适配手机与桌面；
- 默认模型 seed 采用实施时官方仍可用的最新适合文本陪伴的稳定模型；截至 2026-08-21，初始选择为 OpenAI `gpt-5.6-sol` 与 DeepSeek `deepseek-v4-pro`，启动连接测试时仍需依据官方文档和账号实际权限复核；
- 按阶段 1 至阶段 7 连续实施，并在每阶段完成规定验证。

---

## 2. 不可违反的安全与数据规则

### 2.1 API Key 规则

硬性要求：

- `OPENAI_API_KEY` 与 `DEEPSEEK_API_KEY` 只存在于 `.env.local` 或进程环境变量；
- 只允许 `src/server/**` 和 Next.js Route Handler 的服务端代码读取它们；
- 引用密钥的模块必须使用 `import "server-only"` 或位于明确的 server-only 边界内；
- 客户端只能看到 `configured: true | false`，不能看到 key、key 前缀、key 后四位或任何可推断内容；
- 禁止使用 `NEXT_PUBLIC_` 前缀保存密钥；
- 禁止把密钥保存到 `data/*.json`、设置快照或 run 日志；
- 禁止将整个 `process.env` 序列化、打印或返回；
- 供应商错误在返回浏览器前必须清洗，避免 header、请求对象或 key 泄露；
- `.env.local` 必须进入 `.gitignore`；
- `.env.example` 只保存空占位符，不得保存真实值。

`.env.example` 基线：

```dotenv
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
MORA_DATA_DIR=./data
```

不要把模型 ID 放在环境变量中作为唯一配置来源；模型 ID 需要在 Settings UI 中可见、可编辑并保存到本地 JSON。

### 2.2 本地隐私规则

对话、Memory、Context Snapshot 和日志可能包含敏感内容。MVP 必须：

- 在 UI 明示“数据仅保存在当前机器的本项目目录”；
- 提供清空单条对话、单条 Memory 和运行记录的能力；
- 删除操作必须二次确认；
- 日志默认不保存供应商原始响应对象，只保存标准化结果；
- `saveRawProviderResponse` 默认 `false`；即使打开，也必须先执行 secret/header 清洗；
- 不把本地数据发送到 OpenAI/DeepSeek 以外的第三方；
- 仅把 Context Builder 明确产出的上下文发送给当前选中的模型供应商。

### 2.3 产品安全边界

这是陪伴体验 Demo，不是专业医疗工具。至少保留一段透明、可查看但默认锁定的基础安全指令，要求模型：

- 不冒充人类、医生或治疗师；
- 不做诊断或保证结果；
- 对疑似紧急危险内容优先建议联系当地紧急服务、可信任的人或专业支持；
- 不生成鼓励自伤、伤害他人或其他明显危险行为的内容。

可实验的安全措辞放入 Prompt Studio；上述最低边界以只读区显示。UI 必须明确区分“产品安全底线”和“可调试 prompt”。

---

## 3. 技术决策

### 3.1 基础技术栈

- Next.js（App Router）；
- React；
- TypeScript，启用严格模式；
- Tailwind CSS；
- Zod：API 输入、环境配置和 JSON 文件校验；
- OpenAI 官方 JavaScript SDK：仅在 OpenAI adapter 的服务端实现中使用；
- DeepSeek：在服务端 adapter 中使用标准 `fetch` 或兼容 SDK 调用；
- Node.js 内置 `crypto.randomUUID()` 生成 ID；
- Node.js 文件系统 API 保存 JSON；
- Vitest：单元与集成测试；
- React Testing Library：关键组件测试；
- Playwright：最终关键路径 E2E，可在后期阶段加入。

如无现有包管理器约束，使用 npm。不要同时生成多种 lockfile。

### 3.2 运行时约束

- 所有访问本地文件的 Route Handler 必须使用 Node.js runtime，不能使用 Edge runtime；
- 本地 JSON 是唯一持久化来源；React state 只用于界面临时状态；
- MVP 默认非流式返回，以便更简单、稳定地比较整体延迟和输出；
- adapter 接口保留 streaming capability 字段，但第一版不要求实现流式传输；
- 应用只保证单机、单进程开发模式；仍需通过进程内写队列避免同进程并发写文件；
- 不把本地文件存储描述为适合 serverless 或多实例部署。

### 3.3 OpenAI 接入基线

- 使用 Responses API；
- 使用服务端环境变量初始化 client；
- 默认 `store: false`，本地对话状态由 MORA 自己管理；
- 使用 `instructions` 传递系统/开发者层指令；
- 使用 `input` 传递本轮上下文与用户内容；
- 通过标准化层提取 `output_text`、usage、response id 和错误；
- 只发送当前模型明确支持的参数；
- 不假设所有 OpenAI 模型都支持 `temperature`、`top_p`、reasoning 或 verbosity。

OpenAI 的模型 ID 只是设置值，不写死在 adapter。初始 seed 可以提供一个可编辑示例，但 UI 必须允许用户替换为其账号实际可用的模型。

### 3.4 DeepSeek 接入基线

- 仅由服务端调用；
- base URL 从 `DEEPSEEK_BASE_URL` 读取，不暴露给客户端编辑；
- 模型 ID 在 Settings UI 中可编辑；
- adapter 将统一请求转换为供应商兼容格式；
- adapter 将响应映射为统一的文本、usage、延迟和错误结构；
- 如果某参数不被当前端点支持，必须忽略并在 Context/Run Inspector 中标记为 `not_applied`，不能静默伪装为已生效；
- 不要依赖 OpenAI adapter 的内部实现，两个 adapter 只共享统一接口和通用工具。

---

## 4. 总体架构

```text
Browser / React UI
        │
        │ 只发送用户输入、公开设置与操作命令
        ▼
Next.js Route Handlers（Node runtime）
        │
        ▼
Conversation Orchestrator
        ├── Energy Resolver
        ├── Memory Selector
        ├── Persona Resolver
        ├── Safety Baseline
        ├── Context Builder
        └── Settings Snapshot / Context Snapshot
        │
        ▼
Unified Model Adapter Interface
        ├── OpenAI Adapter ── OpenAI Responses API
        └── DeepSeek Adapter ─ DeepSeek API
        │
        ▼
Normalized Result
        ├── assistant text
        ├── token usage
        ├── estimated cost
        ├── latency / error
        └── applied / ignored parameters
        │
        ▼
Local JSON Repository
        ├── settings.json
        ├── profiles.json
        ├── personas.json
        ├── memories.json
        ├── conversations.json
        ├── prompt-presets.json
        ├── runs.json
        └── evals.json
```

### 4.1 核心调用顺序

每个模型槽位的调用严格按以下顺序执行；多模型模式共享步骤 1–7，再从步骤 8 开始并行执行：

1. 校验请求；
2. 读取当前 Settings 与 Persona；
3. 读取目标 Conversation；
4. 解析当前 Energy State；
5. 根据用户输入、Memory 设置和预算选择 Memory；
6. 由 Context Builder 构建结构化上下文；
7. 生成 settings snapshot 与 context snapshot；
8. 调用选中的 provider adapter；
9. 标准化响应与 usage；
10. 计算估算成本；
11. 保存 user/assistant message、run 和快照；
12. 将不含任何密钥的结果返回浏览器。

### 4.2 多模型并行调用顺序

比较模式必须：

1. 完成一次请求校验；
2. 只解析一次 Persona、Energy、Memory 和历史；
3. 只解析一次共享的 Persona、Energy、Memory、Prompt 和当前用户输入；
4. 为共享部分生成稳定 `sharedContextHash`，再为每个槽位结合其独立历史生成 `laneContextHash`；
5. 读取当前档案全部启用的 model slots，并创建一个 `comparisonGroupId`；
6. 用 `Promise.allSettled` 并行调用所有 model slots；
7. 同组全部 run 保存相同的 `sharedContextHash` 和公共设置快照，并分别保存自己的 Context Snapshot 与 `laneContextHash`；
8. 分别保存各 slot 的 provider、model、模型参数快照、usage、延迟、结束原因和错误；
9. 任一槽位失败时，该槽位只显示“调用失败”，其他槽位结果照常展示；
10. 每个成功回复自动写入所属 `modelSlotId` 的独立 assistant 历史；失败槽位不写入 assistant message；
11. 用户无需选择公共回复即可发送下一条消息；下一轮每个槽位只读取自己的 assistant 历史与全部共享 user 消息；
12. 不允许因为一个槽位失败而调用本地保底、复制其他槽位结果或重新包装错误为陪伴回复；
13. 修改现有槽位的 provider 或 model ID 时必须提示清空该槽位 assistant 历史，或要求复制为新槽位，禁止把旧模型回复无提示地并入新模型分支。
14. 某槽位在一轮调用失败后，该轮只保留共享 user message 和 failed run；下一轮仍可继续调用该槽位，但历史中不存在伪造的 assistant message。

---

## 5. 页面与交互设计

UI 同时面向手机与桌面测试。采用极简、无装饰的排版系统，不使用非必要插画、渐变、动效、阴影或拟物元素。桌面端可使用多栏实验台，窄屏必须重排为单栏、抽屉或分页区域，不能仅靠横向滚动缩小桌面布局。

### 5.1 全局导航

左侧导航至少包含：

- Dashboard
- Compare Chat
- Prompt Studio
- Memory
- Runs
- Settings

顶部全局状态至少显示：

- 当前本地测试档案；
- 当前模式；
- 当前 Persona；
- 当前 Energy 模式/状态；
- OpenAI 是否已配置；
- DeepSeek 是否已配置；
- 本地保存状态或最近一次写入错误。

这里只显示 provider `configured` 布尔值，绝不显示 key 信息。

### 5.1.1 本地测试档案

- 首次启动创建一个可重命名的默认测试档案；
- 支持创建、重命名、切换和删除测试档案；
- 删除档案必须二次确认，并级联删除该档案的设置、Persona、Prompt Preset、对话、Memory、runs 与候选；其他档案不受影响；
- Settings、Persona、Prompt Preset、Conversation、Memory 和 Run 均必须通过 `profileId` 隔离；
- 切换档案后不得在 UI、Memory selection 或 Context Builder 中读取其他档案的数据；
- 本地测试档案不包含密码、邮箱、权限或远程身份。

### 5.2 Dashboard

至少提供：

- 进入多模型并行聊天；
- 最近 runs；
- provider 配置状态；
- 当前主要设置摘要；
- 本地数据与 Demo 边界提示。

### 5.3 Compare Chat

布局：

- 顶部或底部固定一个共享用户输入框；
- 用户每次发送后，为全部启用 model slots 同时创建回复容器；
- 桌面端使用等宽多列或可读的响应式网格；手机端纵向排列模型容器，不压缩正文；
- 每个容器显示 slot label、provider、model、状态、完整回复、延迟、token 和估算成本；
- 每个成功或失败容器均可打开对应 Run Inspector；
- 右侧或抽屉式实验面板用于 Energy override、启用槽位与核心生成参数；
- 提供 Context Inspector 按钮，在发送前预览、发送后查看实际快照；
- 支持新建、重命名、切换和删除本地对话。

### 5.4 多模型比较行为

- 首版默认启用 OpenAI 与 DeepSeek 两个模型槽位，但数据结构和 UI 不得假设永远只有左右两列；
- 所有容器显示相同的 `sharedContextHash`，同时显示各自的 `laneContextHash`；
- 首轮各槽位 `laneContextHash` 应一致；后续轮次允许因独立 assistant 历史而不同；
- 用户无需选择某个模型回复即可继续输入；
- 失败容器正文区域只显示“调用失败”，可在 Inspector 查看清洗后的错误类型；
- 不得生成失败保底文本；失败容器也不得复用其他容器的输出；
- 模型返回的正文不得按字符、句子或 DOM 展示长度截断。长内容可折叠或滚动，但必须提供“展开全文”和复制全文；
- 若 provider 报告因输出限制结束，显示“输出可能未完成”的独立状态，不修改正文。

首版不提供维度评分、评语、tags、verdict 或“采用此回复”流程。

### 5.5 Prompt Studio

Prompt Studio 不是一个单独的大文本框，而是按 Context Builder 分区编辑：

- 产品安全底线：可查看、只读；
- Persona core prompt：可编辑；
- Tone / language / style rules：可编辑；
- Low-Energy Policy template：可编辑；
- Memory injection template：可编辑；
- Conversation history template：可编辑；
- Response contract：可编辑；
- Custom experiment block：可编辑、可启停；
- 分区顺序：可在允许范围内调整；安全底线永远在最前；
- 最终渲染预览：显示变量替换后的真实内容；
- 显示各分区字符数、估算 token、是否启用和来源；
- 支持保存 preset、复制 preset、切换 preset、恢复 seed 默认值；
- 保存前显示 diff 或至少显示“未保存改动”。

不得在 Prompt Studio 中显示或编辑 API Key。

### 5.6 Memory Inspector

至少支持：

- 列表、搜索、筛选；
- 新建、编辑、启停、删除；
- 字段：type、content、importance、tags、createdAt、lastUsedAt、useCount、source；
- 显示某条 Memory 最近在哪些 run 中被选中；
- 使用当前用户输入模拟一次 Memory selection；
- 展示每条候选的 importance、recency、keyword relevance 和总分；
- 手动 pin；
- 每轮用户消息保存成功后自动启动 Memory 候选提取；
- 自动提取仅作为候选，不默认直接写入正式 Memory；
- 自动提取只以当前档案的用户原话和必要上下文为依据，不把模型生成的陪伴回复保存成用户事实；
- 提取失败在候选区域显示“调用失败”，不得阻塞或替换各聊天模型容器的结果。

MVP 的 Memory selection 是本地确定性规则，不是 RAG：

- 对启用且未过期的 Memory 评分；
- 综合 pin、importance、recency 和简单关键词重合；
- 按分数排序；
- 同时满足 `topK` 与 `maxChars` 预算；
- 记录入选原因和未入选原因；
- 不生成 embedding，不调用向量库。

### 5.7 Run Inspector

显示：

- run id、时间、模式、provider、model、状态；
- settings snapshot；
- applied parameters 与 ignored parameters；
- Energy 解析结果及原因；
- Memory 候选、分数与最终选择；
- Context 的分区内容、顺序、字符数、估算 token 与 hash；
- provider usage；
- latency；
- 估算成本与采用的价格版本；
- 标准化错误；
- 关联同一 comparison group 的其他 runs。

Inspector 不显示 secret、authorization header 或完整供应商请求对象。

### 5.8 Settings

按分组暴露设置：

1. Provider & Model
2. Generation
3. Persona
4. Energy
5. Memory
6. Context
7. Logging & Privacy
8. Cost Estimation
9. Advanced / Experimental

每个设置应包含：名称、当前值、简短说明、默认值、是否会影响行为，以及 provider capability 提示。保存时进行 Zod 校验，错误必须精确到字段。

Settings 还必须提供“导出配置”和“导入配置”：

- 导出内容仅包含当前测试档案的行为配置、Persona 和 Prompt Preset；
- 默认不包含 API Key、环境变量、绝对路径、对话、Memory、runs 或用户输入；
- 配置文件包含 `schemaVersion`、导出时间和明确的数据类型；
- 导入前完成 Zod 校验并显示变更摘要，用户确认后才覆盖当前档案配置；
- 导入不能修改 Safety baseline，也不能携带任意文件路径或可执行模板表达式。

---

## 6. 建议目录结构

```text
mora-lab/
├── .env.example
├── .env.local                     # 本地创建，永不提交
├── .gitignore
├── MORA_LAB_CURSOR_IMPLEMENTATION_SPEC.md
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── eslint.config.mjs
├── vitest.config.ts
├── data/
│   ├── .gitkeep
│   ├── settings.json
│   ├── profiles.json
│   ├── personas.json
│   ├── memories.json
│   ├── conversations.json
│   ├── prompt-presets.json
│   ├── runs.json
│   └── evals.json
├── data-seed/
│   ├── settings.json
│   ├── profiles.json
│   ├── personas.json
│   ├── memories.json
│   ├── conversations.json
│   ├── prompt-presets.json
│   ├── runs.json
│   └── evals.json
├── public/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── compare/route.ts
│   │   │   ├── context/preview/route.ts
│   │   │   ├── config/export/route.ts
│   │   │   ├── config/import/route.ts
│   │   │   ├── conversations/route.ts
│   │   │   ├── conversations/[id]/route.ts
│   │   │   ├── memories/route.ts
│   │   │   ├── memories/[id]/route.ts
│   │   │   ├── memories/preview-selection/route.ts
│   │   │   ├── personas/route.ts
│   │   │   ├── personas/[id]/route.ts
│   │   │   ├── profiles/route.ts
│   │   │   ├── profiles/[id]/route.ts
│   │   │   ├── prompt-presets/route.ts
│   │   │   ├── prompt-presets/[id]/route.ts
│   │   │   ├── providers/status/route.ts
│   │   │   ├── providers/test/route.ts
│   │   │   ├── runs/route.ts
│   │   │   ├── runs/[id]/route.ts
│   │   │   └── settings/route.ts
│   │   ├── compare/page.tsx
│   │   ├── memory/page.tsx
│   │   ├── runs/page.tsx
│   │   ├── runs/[id]/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── studio/page.tsx
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── app-shell/
│   │   ├── chat/
│   │   ├── compare/
│   │   ├── context-inspector/
│   │   ├── memory/
│   │   ├── prompt-studio/
│   │   ├── runs/
│   │   ├── settings/
│   │   └── ui/
│   ├── domain/
│   │   ├── conversation.ts
│   │   ├── config-bundle.ts
│   │   ├── energy.ts
│   │   ├── evaluation.ts
│   │   ├── memory.ts
│   │   ├── persona.ts
│   │   ├── prompt.ts
│   │   ├── profile.ts
│   │   ├── run.ts
│   │   └── settings.ts
│   ├── server/
│   │   ├── adapters/
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── openai.ts
│   │   │   └── deepseek.ts
│   │   ├── config/env.ts
│   │   ├── context/
│   │   │   ├── builder.ts
│   │   │   ├── renderers.ts
│   │   │   └── snapshot.ts
│   │   ├── energy/
│   │   │   └── resolver.ts
│   │   ├── memory/
│   │   │   ├── selector.ts
│   │   │   └── candidate-extractor.ts
│   │   ├── orchestration/
│   │   │   └── compare.ts
│   │   ├── persistence/
│   │   │   ├── atomic-json-store.ts
│   │   │   ├── repositories.ts
│   │   │   ├── seed.ts
│   │   │   └── write-queue.ts
│   │   ├── observability/
│   │   │   ├── cost.ts
│   │   │   ├── hash.ts
│   │   │   ├── latency.ts
│   │   │   └── sanitize.ts
│   │   └── safety/baseline.ts
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── constants.ts
│   │   └── format.ts
│   └── test/
│       ├── fixtures/
│       └── setup.ts
└── tests/
    └── e2e/
```

说明：

- `data-seed/` 可提交，保存不含用户数据的初始结构；
- `data/` 是运行时可变数据，除 `.gitkeep` 外默认 gitignore；
- 首次启动时，如果 `data/*.json` 不存在，从 `data-seed/` 复制；
- 所有档案级实体都显式保存 `profileId`；repository 查询默认要求传入 `profileId`，禁止先读取全部数据再只在 UI 过滤；
- `src/domain/` 不读取文件、不调用供应商，保持纯类型与纯函数；
- `src/server/` 不能被 client component 导入；
- UI 通过 `/api/**` 访问数据，不直接读取文件系统。

---

## 7. 领域模型与数据 Schema

所有 JSON 文件使用 envelope，便于版本迁移：

```ts
interface StoreEnvelope<T> {
  schemaVersion: number;
  updatedAt: string; // ISO 8601
  data: T;
}
```

当前所有 seed 的 `schemaVersion` 从 `1` 开始。读取时必须用 Zod 校验完整 envelope。遇到未知更高版本时停止写入并显示清晰错误，禁止覆盖文件。

### 7.1 本地测试档案与配置包

```ts
interface TestProfile {
  id: string;
  name: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

interface ProfilesData {
  activeProfileId: string;
  items: TestProfile[];
}

interface ProfileSettingsItem {
  profileId: string;
  settings: SettingsData;
}

interface SettingsStoreData {
  items: ProfileSettingsItem[];
}

interface MoraConfigBundle {
  schemaVersion: 1;
  kind: "mora_behavior_config";
  exportedAt: ISODateTime;
  sourceProfileName: string;
  settings: SettingsData;
  personas: Persona[];
  promptPresets: PromptPreset[];
}
```

规则：

- 每个档案恰好拥有一份 `SettingsData`；
- `activeProfileId` 只表示当前 UI 默认档案，不替代 API 的显式 `profileId` 校验；
- 导出的 `MoraConfigBundle` 不含 profile id、Memory、Conversation、Run、Eval、API Key、环境变量或 Safety baseline；
- 导入配置时为导入的 Persona 和 Prompt Preset 重新生成当前档案内 ID，并正确重写 active 引用，避免 ID 冲突；
- 未来如需导出用户数据，必须设计不同的 bundle `kind`，不得把敏感数据悄悄加入行为配置包。

### 7.2 通用类型

```ts
type ISODateTime = string;
type ProviderId = "openai" | "deepseek";
type RunMode = "single" | "compare";
type RunStatus = "pending" | "succeeded" | "failed";
type EnergyLevel = "E0" | "E1" | "E2" | "E3";

interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  source: "provider" | "estimated" | "unavailable";
}
```

Energy 语义固定为：

- `E0`：能量耗尽，只适合非常短的承接与安全感；
- `E1`：低能量，少问题、少任务、短回复；
- `E2`：中等能量，可温和探索并提供一个小步骤；
- `E3`：较高能量，可进行更完整的讨论与行动规划。

### 7.3 settings.json

```ts
interface SettingsData {
  activePersonaId: string;
  activePromptPresetId: string;
  defaultProvider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  energy: EnergySettings;
  memory: MemorySettings;
  context: ContextSettings;
  logging: LoggingSettings;
  evaluation: EvaluationSettings;
  compare: CompareSettings;
}

interface ProviderSettings {
  enabled: boolean;
  modelId: string;
  generation: {
    temperature: number | null;
    topP: number | null;
    maxOutputTokens: number;
    presencePenalty: number | null;
    frequencyPenalty: number | null;
    seed: number | null;
    thinkingMode: "enabled" | "disabled" | null;
    reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
    verbosity: "low" | "medium" | "high" | null;
  };
  transport: {
    timeoutMs: number;
    maxRetries: number;
    stream: false;
  };
  pricing: {
    currency: "USD";
    inputPerMillion: number | null;
    cachedInputPerMillion: number | null;
    outputPerMillion: number | null;
    label: string;
    effectiveDate: string | null;
  };
}

interface EnergySettings {
  mode: "manual" | "rule_based" | "hybrid";
  manualLevel: EnergyLevel;
  allowPerMessageOverride: boolean;
  ruleBased: {
    enabled: boolean;
    lowEnergyKeywords: string[];
    highEnergyKeywords: string[];
    exhaustionPunctuationWeight: number;
    shortMessageThreshold: number;
  };
  policies: Record<EnergyLevel, EnergyPolicy>;
}

interface EnergyPolicy {
  targetMaxChars: number;
  targetMaxSentences: number;
  maxQuestions: number;
  maxSuggestedActions: number;
  allowAdvice: boolean;
  validationWeight: number; // 0..1
  actionWeight: number;     // 0..1
  toneInstruction: string;
  responseInstruction: string;
}

interface MemorySettings {
  enabled: boolean;
  topK: number;
  maxChars: number;
  minImportance: number;
  includedTypes: MemoryType[];
  weights: {
    pinned: number;
    importance: number;
    recency: number;
    keywordRelevance: number;
  };
  autoCandidateExtraction: {
    enabled: boolean;
    provider: ProviderId;
    modelId: string;
    requireManualApproval: true;
  };
}

interface ContextSettings {
  historyTurns: number;
  maxHistoryChars: number;
  maxTotalChars: number;
  includeTimestamps: boolean;
  includeEnergyReason: boolean;
  includeMemoryMetadata: boolean;
  sectionOrder: ContextSectionId[];
  customExperimentBlockEnabled: boolean;
}

interface LoggingSettings {
  saveContextSnapshot: boolean;
  saveSettingsSnapshot: boolean;
  saveStandardizedProviderResponse: boolean;
  saveRawProviderResponse: boolean; // default false
  maxRuns: number;
}

interface EvaluationSettings {
  enabled: false;
  autoEvaluatorEnabled: false; // MVP 固定为 false，只保留 hook
}

interface CompareSettings {
  runInParallel: true;
  historyMode: "independent_lanes";
  modelSlots: ModelSlot[];
}

interface ModelSlot {
  id: string;
  label: string;
  enabled: boolean;
  provider: ProviderId;
  modelId: string;
  generationOverrides: Partial<ProviderSettings["generation"]>;
}
```

`settings.json` 的 envelope data 使用 `SettingsStoreData`，不直接保存单个全局 `SettingsData`。

规则：

- `temperature` 与 `topP` 可以同时在 UI 中可见，但 UI 应提示通常只调整一个；
- adapter 通过 capability 决定实际发送的参数；
- `maxOutputTokens` 必须大于 0，并设置合理上限；
- 所有权重与阈值都必须在 Settings UI 中显示；
- `autoEvaluatorEnabled` 在 MVP 中不可开启；
- `autoCandidateExtraction.enabled` 的 seed 为 `true`；启用时每轮自动运行，不提供“需要手动点击才提取”的模式；
- 成本配置为空时显示“未配置”，不得显示伪造的 `$0.00`。

### 7.4 personas.json

```ts
interface Persona {
  id: string;
  profileId: string;
  name: string;
  description: string;
  enabled: boolean;
  corePrompt: string;
  language: "zh-CN";
  traits: {
    warmth: number;       // 0..1
    humor: number;        // 0..1
    initiative: number;   // 0..1
    directness: number;   // 0..1
    playfulness: number;  // 0..1
  };
  style: {
    defaultReplyLength: "very_short" | "short" | "medium" | "long";
    emojiMode: "none" | "rare" | "light";
    questionFrequency: "low" | "medium" | "high";
    avoidPatterns: string[];
    preferredPatterns: string[];
  };
  relationshipFraming: string;
  boundaries: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

interface PersonasData {
  items: Persona[];
}
```

不要把 traits 数值直接发送给模型；Context Builder 使用可查看的 renderer 将其转换为清晰文字。转换规则必须有单元测试。

### 7.5 memories.json

```ts
type MemoryType =
  | "profile"
  | "preference"
  | "event"
  | "support_strategy"
  | "boundary"
  | "relationship"
  | "other";

interface MemoryItem {
  id: string;
  profileId: string;
  type: MemoryType;
  content: string;
  importance: number; // 0..1
  enabled: boolean;
  pinned: boolean;
  tags: string[];
  source: {
    kind: "manual" | "conversation_candidate";
    conversationId?: string;
    messageId?: string;
  };
  status: "active" | "candidate" | "archived";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  lastUsedAt: ISODateTime | null;
  useCount: number;
  expiresAt: ISODateTime | null;
}

interface MemoriesData {
  items: MemoryItem[];
}

interface MemorySelectionTrace {
  memoryId: string;
  selected: boolean;
  scores: {
    pinned: number;
    importance: number;
    recency: number;
    keywordRelevance: number;
    total: number;
  };
  reason: string;
}
```

Memory 自动提取必须接入每轮 Compare Chat 流程。启用后无需用户点击，结果必须进入 `candidate`，由用户确认后才进入 `active`。禁止模型自动覆盖现有 Memory；提取模型失败时只记录失败并显示“调用失败”。

### 7.6 conversations.json

```ts
type MessageRole = "user" | "assistant";

interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: ISODateTime;
  runId: string | null;
  modelSlotId: string | null; // user 为 null，assistant 必须属于一个 slot
  provider: ProviderId | null;
  modelId: string | null;
  comparisonGroupId: string | null;
}

interface Conversation {
  id: string;
  profileId: string;
  title: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  messages: ConversationMessage[];
}

interface ConversationsData {
  items: Conversation[];
}
```

规则：

- user message 是全部槽位共享历史，`modelSlotId` 必须为 `null`；
- 每个成功 assistant message 必须带所属 `modelSlotId`，并自动写入该槽位历史；
- 为某槽位构建 Context 时，只读取全部 user messages 与该槽位的 assistant messages；
- 失败 run 不创建 assistant message；
- 禁止把其他槽位的 assistant message 注入当前槽位。

### 7.7 prompt-presets.json

```ts
type ContextSectionId =
  | "safety_baseline"
  | "persona"
  | "style"
  | "energy_policy"
  | "memory"
  | "history"
  | "response_contract"
  | "custom_experiment";

interface PromptSectionTemplate {
  id: ContextSectionId;
  enabled: boolean;
  title: string;
  template: string;
  editable: boolean;
}

interface PromptPreset {
  id: string;
  profileId: string;
  name: string;
  description: string;
  sections: PromptSectionTemplate[];
  version: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

interface PromptPresetsData {
  items: PromptPreset[];
}
```

模板变量必须使用一个小而明确的白名单，例如：

```text
{{persona.name}}
{{persona.corePrompt}}
{{persona.renderedTraits}}
{{energy.level}}
{{energy.policy}}
{{memory.rendered}}
{{history.rendered}}
{{user.message}}
```

禁止通过 `eval`、动态 JavaScript 或任意表达式执行模板。未识别变量必须报错并阻止保存或运行。

### 7.8 runs.json

```ts
interface AppliedParameter {
  name: string;
  requestedValue: unknown;
  appliedValue: unknown;
  status: "applied" | "transformed" | "not_applied";
  reason?: string;
}

interface SettingsSnapshot {
  id: string;
  createdAt: ISODateTime;
  common: unknown; // 实现时替换为明确的 Zod schema，不使用裸 any
  provider: ProviderSettings;
  personaVersion: string;
  promptPresetVersion: number;
}

interface ContextSectionSnapshot {
  id: ContextSectionId | "user_input";
  title: string;
  content: string;
  charCount: number;
  estimatedTokens: number | null;
  sourceIds: string[];
}

interface ContextSnapshot {
  id: string;
  createdAt: ISODateTime;
  sections: ContextSectionSnapshot[];
  renderedInstructions: string;
  renderedInput: string;
  selectedMemoryIds: string[];
  memorySelectionTrace: MemorySelectionTrace[];
  energy: {
    level: EnergyLevel;
    source: "manual" | "rule_based" | "override";
    reason: string;
  };
  charCount: number;
  estimatedTokens: number | null;
  sharedHash: string; // 不含槽位独立 assistant 历史的共享部分
  hash: string;       // 当前槽位完整有效 Context，即 laneContextHash
}

interface RunRecord {
  id: string;
  profileId: string;
  modelSlotId: string | null;
  comparisonGroupId: string | null;
  comparisonRunIds: string[];
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  mode: RunMode;
  status: RunStatus;
  provider: ProviderId;
  modelId: string;
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
  latencyMs: number | null;
  timeToFirstTokenMs: number | null; // 非流式 MVP 为 null
  settingsSnapshot: SettingsSnapshot;
  contextSnapshot: ContextSnapshot;
  sharedContextHash: string;
  contextHash: string; // laneContextHash
  appliedParameters: AppliedParameter[];
  outputText: string | null;
  usage: TokenUsage;
  estimatedCost: {
    amount: number | null;
    currency: "USD";
    isEstimate: true;
    pricingLabel: string | null;
    effectiveDate: string | null;
  };
  providerResponseId: string | null;
  finishReason: "completed" | "length" | "content_filter" | "cancelled" | "unknown" | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}

interface RunsData {
  items: RunRecord[];
}
```

`settingsSnapshot.common` 在实际代码中必须定义具体 schema；这里用 `unknown` 只是提醒不能把 API Key 或环境变量混入快照。推荐显式 pick 允许字段，而不是对整个运行时配置做 spread。

### 7.9 evals.json

```ts
type EvaluationDimension =
  | "warmth"
  | "relevance"
  | "brevity"
  | "persona_consistency"
  | "energy_appropriateness"
  | "helpfulness"
  | "safety";

interface RunEvaluation {
  id: string;
  profileId: string;
  runId: string;
  comparisonGroupId: string | null;
  scores: Partial<Record<EvaluationDimension, 1 | 2 | 3 | 4 | 5>>;
  thumb: "up" | "down" | null;
  verdict: "left" | "right" | "tie" | "neither" | null;
  tags: string[];
  comment: string;
  evaluator: "human" | "hook";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

interface EvalsData {
  items: RunEvaluation[];
}
```

该 schema 只为未来兼容保留。首版不实现评分 UI、不生成人工 evaluation，也不实现 LLM-as-a-judge。未来自动 evaluator 必须通过独立接口写入 `evaluator: "hook"`，不能与人工结果混淆。

---

## 8. Adapter 统一接口

```ts
interface ModelCapabilities {
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsPresencePenalty: boolean;
  supportsFrequencyPenalty: boolean;
  supportsSeed: boolean;
  supportsThinkingMode: boolean;
  supportsReasoningEffort: boolean;
  supportsVerbosity: boolean;
  supportsStreaming: boolean;
  reportsUsage: boolean;
}

interface UnifiedModelRequest {
  provider: ProviderId;
  modelId: string;
  instructions: string;
  input: string;
  generation: ProviderSettings["generation"];
  timeoutMs: number;
  maxRetries: number;
  metadata: {
    runId: string;
    conversationId: string;
    sharedContextHash: string;
    contextHash: string;
  };
}

interface UnifiedModelResult {
  provider: ProviderId;
  modelId: string;
  responseId: string | null;
  text: string;
  usage: TokenUsage;
  latencyMs: number;
  appliedParameters: AppliedParameter[];
  finishReason: "completed" | "length" | "content_filter" | "cancelled" | "unknown";
}

interface ModelAdapter {
  id: ProviderId;
  getCapabilities(modelId: string): ModelCapabilities;
  complete(request: UnifiedModelRequest): Promise<UnifiedModelResult>;
  testConnection(modelId: string): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number | null;
  }>;
}
```

实现要求：

- adapter 负责供应商格式转换，不负责 Persona、Memory 或历史拼装；
- orchestrator 不访问供应商 SDK 的原始类型；
- capability 判断结果写入 run；
- 超时使用 `AbortController`；
- retry 只处理明确可重试错误，并限制次数；
- 不重试认证错误和普通参数错误；
- 返回浏览器的错误统一为安全、短小、可理解的结构；
- retry 耗尽后返回失败，不调用任何 fallback adapter 或本地文本生成器；
- adapter 必须原样返回完整标准化文本，禁止为满足 Persona、Energy 或 UI 长度目标执行 `slice`、substring、句子裁剪、摘要或重写；
- 若供应商返回输出长度结束原因，映射为 `finishReason: "length"`，保留全部已返回文本；
- 服务端日志不得打印请求 headers；
- 测试使用 mock，不在自动测试中消耗真实 API。

---

## 9. Context Builder 规格

Context Builder 必须是一个可单元测试的确定性模块。同样输入必须得到完全相同的 section 顺序、文本和 hash。

### 9.1 输入

```ts
interface BuildContextInput {
  modelSlotId: string;
  userMessage: string;
  conversation: Conversation;
  persona: Persona;
  energyResolution: {
    level: EnergyLevel;
    source: "manual" | "rule_based" | "override";
    reason: string;
  };
  selectedMemories: MemoryItem[];
  memoryTrace: MemorySelectionTrace[];
  promptPreset: PromptPreset;
  settings: Pick<SettingsData, "context" | "memory">;
}
```

### 9.2 输出

输出 `ContextSnapshot`，并明确拆分：

- `renderedInstructions`：安全、Persona、风格、Energy、Memory、response contract 等；
- `renderedInput`：受历史窗口约束的当前槽位独立历史，加本轮 user message；
- `sections`：Inspector 所需的逐段内容；
- `sharedHash`：对不含槽位独立 assistant 历史的共享有效内容计算 SHA-256；
- `hash`：对当前槽位完整有效上下文计算 SHA-256；
- token 仅作估算时必须标注，不伪装为 provider usage。

### 9.3 顺序与预算

默认顺序：

1. Safety baseline；
2. Persona；
3. Style；
4. Energy policy；
5. Selected memories；
6. Response contract；
7. Custom experiment block；
8. Canonical conversation history；
9. Current user input。

预算裁剪优先级：

1. 永不移除 Safety baseline；
2. 永不移除当前 user input；
3. 优先保留 Persona 核心与当前 Energy policy；
4. Memory 按 selector 排名从低到高移除；
5. 历史从最旧 turn 开始移除；
6. Custom experiment block 超预算时禁用并记录原因；
7. 若仍超预算，返回明确错误，不进行隐式截断。

不能依赖 provider 自动丢弃旧消息来满足预算。

### 9.4 Context Inspector

发送前预览必须允许选择 model slot。预览和发送后快照必须尽量使用同一个 builder。发送后快照是事实来源；如果发送前后设置发生变化，必须显示 snapshot 时间与差异提示。

---

## 10. Energy Resolver 规格

MVP 的自动 Energy 解析必须透明、轻量、可重复。

### 10.1 模式

- `manual`：始终使用 Settings 的 manualLevel；
- `rule_based`：仅依据公开规则与当前输入计算；
- `hybrid`：规则给出建议，用户本轮 override 优先；若无 override 使用规则结果。

### 10.2 规则输出

Resolver 必须返回：

```ts
{
  level: EnergyLevel;
  source: "manual" | "rule_based" | "override";
  reason: string;
  signals: Array<{
    name: string;
    matched: boolean;
    contribution: number;
  }>;
}
```

规则参数全部出现在 Settings 中。不要做不可解释的隐藏分类。不要使用情绪或心理诊断标签。

### 10.3 Low-Energy Policy

Energy policy 同时通过两层生效：

1. Prompt 指令：控制语气、问题数量、建议数量和回复目标长度；
2. 后置观察：记录实际字符数、句数、问号数与目标的偏差，仅用于 Inspector 和 evaluation hook。

MVP 不要强行截断模型自然语言来伪造合规；若超标，记录 policy deviation，供调参和未来评估使用。

---

## 11. Memory Selector 规格

### 11.1 确定性评分

对每条有效 Memory 计算 0..1 的归一化分量：

- pinned；
- importance；
- recency；
- keyword relevance。

总分：

```text
total =
  pinnedScore * weights.pinned +
  importanceScore * weights.importance +
  recencyScore * weights.recency +
  keywordScore * weights.keywordRelevance
```

最终再除以启用权重之和归一化。排序相同时依次按：pinned、importance、updatedAt、id，保证稳定。

关键词匹配第一版支持：

- 中文：字符 bigram 与空白/标点切分后的片段；
- 英文：小写单词 token；
- 去除一个很小的内置停用词表；
- 不引入 embedding。

### 11.2 选择约束

- 仅选择 `enabled && status === "active"` 且未过期的条目；
- importance 小于阈值的不选，pinned 可绕过该阈值；
- 同时遵守 `topK` 和 `maxChars`；
- 每次选择保存完整 trace；
- 只有成功完成的 run 才更新 `lastUsedAt` 与 `useCount`；
- selector 不修改 Memory 内容。

---

## 12. 本地 JSON 持久化规格

### 12.1 原子写入

每次写入必须：

1. 进入单进程写队列；
2. 读取当前文件；
3. 用 Zod 校验当前数据；
4. 在内存中生成新数据；
5. 用 Zod 校验新数据；
6. 写入同目录临时文件；
7. flush/close；
8. 将现有文件复制为单份 `.bak`；
9. rename 临时文件替换目标文件；
10. 失败时保留原文件并返回结构化错误。

禁止直接在原 JSON 文件上 truncate 后写入。

### 12.2 Repository 约束

为每种数据提供明确 repository：

- `settingsRepository`
- `profileRepository`
- `personaRepository`
- `memoryRepository`
- `conversationRepository`
- `promptPresetRepository`
- `runRepository`
- `evaluationRepository`（只保留未来接口所需的 repository 骨架，不提供首版写入 UI）

Route Handler 不直接调用 `fs`。所有文件路径必须基于校验后的 `MORA_DATA_DIR` 和固定文件名构造，禁止接受来自 API 的任意路径。

### 12.3 容量限制

MVP 通过 `logging.maxRuns` 控制每个测试档案的 runs 数量。超限时只删除该档案最旧 run；未来启用 eval 后再同步处理孤立 eval。任何自动清理逻辑都必须有测试。

建议初始上限为 2,000 条 run，可在 Settings 中修改。不要按字节大小做难以解释的隐式清理。

---

## 13. API 路由契约

所有 API：

- 请求和响应都使用 JSON；
- 使用 Zod 校验 body、query 和 params；
- 返回统一 envelope；
- 不返回 stack trace；
- 不返回 secrets；
- 对写操作返回已保存实体或新版本；
- 对冲突或无效状态使用清晰的 4xx；
- provider 上游失败映射为安全的 502/504 或结构化 compare 单侧失败结果。

除 provider status/test 外，所有读取或写入档案级数据的 API 必须显式接收 `profileId`，并在 repository 层验证目标实体属于该档案。客户端传入其他档案的实体 ID 时返回 `NOT_FOUND`，不得泄露实体是否存在。

统一响应：

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };
```

### 13.1 Provider

#### `GET /api/providers/status`

返回：

```ts
{
  openai: { configured: boolean };
  deepseek: { configured: boolean };
}
```

不得增加 key preview。

#### `POST /api/providers/test`

请求：

```ts
{ provider: ProviderId; modelId: string }
```

执行一次最小服务端连接测试。需明确提示会产生极少量 API 调用成本。响应只返回成功、清洗后的消息和延迟。

### 13.2 Settings

#### `GET /api/settings`

要求 `profileId` query，返回该档案公开的 `SettingsData`。其类型本身不得含 API Key 或 base URL。

#### `PUT /api/settings`

body 包含 `profileId` 与完整 `settings`；完整校验并保存 Settings。不要做不透明的部分合并。

### 13.2.1 Profiles 与配置文件

- `GET /api/profiles`
- `POST /api/profiles`
- `PUT /api/profiles/:id`
- `DELETE /api/profiles/:id`
- `GET /api/config/export?profileId=`
- `POST /api/config/import`

`POST /api/config/import` 请求包含 `profileId`、`bundle` 与确认标志。服务端必须重新校验整个 bundle，不能信任浏览器端校验。导出响应使用可下载的 JSON 文件名，不包含任何 secret 或用户内容。

### 13.3 Persona 与 Prompt Preset

- `GET /api/personas`
- `POST /api/personas`
- `GET /api/personas/:id`
- `PUT /api/personas/:id`
- `DELETE /api/personas/:id`
- `GET /api/prompt-presets`
- `POST /api/prompt-presets`
- `GET /api/prompt-presets/:id`
- `PUT /api/prompt-presets/:id`
- `DELETE /api/prompt-presets/:id`

删除 active 项目前必须先切换 active 项，或返回冲突错误。

### 13.4 Memory

- `GET /api/memories?profileId=&query=&type=&status=&enabled=`
- `POST /api/memories`
- `PUT /api/memories/:id`
- `DELETE /api/memories/:id`
- `POST /api/memories/preview-selection`
- `POST /api/memories/extract-candidates`

preview 请求：

```ts
{ profileId: string; userMessage: string }
```

返回排序后的 selection trace，但不更新 `lastUsedAt` 或 `useCount`。

candidate extraction 请求：

```ts
{
  profileId: string;
  conversationId: string;
  messageIds: string[];
}
```

只允许读取同一档案中已成功保存的用户消息。每轮用户消息保存后由客户端自动发起该请求，无需点击按钮。提取调用使用当前档案配置的 extractor provider/model，返回并保存 `status: "candidate"` 的结构化 Memory；不得自动变为 `active`。UI 必须显示这是额外 LLM 调用，并允许逐条修改、确认或拒绝。调用失败时显示“调用失败”，不得生成空候选或预设候选冒充结果。

### 13.5 Conversation

- `GET /api/conversations?profileId=`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `PUT /api/conversations/:id`：MVP 仅允许重命名；
- `DELETE /api/conversations/:id`

删除对话不自动删除 runs，runs 保留快照并显示原对话已删除。若实现级联删除，必须在确认框中明确说明；MVP 推荐不级联。

### 13.6 Context Preview

#### `POST /api/context/preview`

请求：

```ts
{
  profileId: string;
  conversationId: string;
  userMessage: string;
  energyOverride?: EnergyLevel;
}
```

返回尚未调用模型的完整 `ContextSnapshot`。不得创建正式 run，不更新 Memory 使用次数。

### 13.7 多模型 Compare Chat

#### `POST /api/compare`

请求：

```ts
{
  profileId: string;
  conversationId: string;
  userMessage: string;
  energyOverride?: EnergyLevel;
  slotOverrides?: Array<{
    modelSlotId: string;
    generation?: Partial<ProviderSettings["generation"]>;
  }>;
}
```

返回：

```ts
{
  comparisonGroupId: string;
  sharedContextHash: string;
  candidates: Array<{
    modelSlotId: string;
    slotLabel: string;
    provider: ProviderId;
    modelId: string;
    runId: string;
    contextSnapshotId: string;
    laneContextHash: string;
    status: "succeeded" | "failed";
    text: string | null;
    displayText: string;
    finishReason: "completed" | "length" | "content_filter" | "cancelled" | "unknown" | null;
    usage: TokenUsage;
    latencyMs: number | null;
    estimatedCost: number | null;
    error: { code: string; message: string } | null;
  }>;
  memoryExtraction: {
    status: "succeeded" | "failed" | "disabled";
    candidateIds: string[];
    displayText: "" | "调用失败";
  };
}
```

要求：

- 服务端从当前档案设置读取全部启用的 model slots；至少启用一个，否则返回校验错误；
- 所有 slots 共用同一份 Persona、Energy、Memory、Prompt 和当前用户输入；每个 slot 使用自己的 assistant 历史构建最终 Context；
- 首轮所有 `laneContextHash` 应一致；后续轮次仅因独立 assistant 历史允许不同；
- `slotOverrides` 仅对本轮生效并写入各自 settings snapshot，不能新增未配置的 slot；
- 每个失败 candidate 的 `text` 必须为 `null`，`displayText` 必须严格为“调用失败”；
- 成功 candidate 的 `displayText` 等于完整 `text`，不得进行硬截断或替换；
- 保存失败 run，但不创建 assistant message；
- 用户消息保存成功后，compare orchestrator 自动并行调用与 `/api/memories/extract-candidates` 相同的 service，不要求客户端或用户点击；
- Memory 提取请求只使用该轮用户消息及同档案必要上下文，不使用各模型候选回复；
- Memory 提取成功或失败都不改变模型 compare 的结果和状态。

### 13.8 Runs 与未来 Evals

- `GET /api/runs?profileId=&provider=&mode=&status=&conversationId=&limit=&cursor=`
- `GET /api/runs/:id`
- `DELETE /api/runs/:id`

列表接口返回摘要，不在 runs 列表一次性返回所有完整 context。run 详情才返回完整 snapshot。

Eval 路由与写入 UI 不在首版实现范围内；只保留 domain schema、`NoopEvaluationHook` 和未来扩展边界。

---

## 14. 所有应暴露的调试参数

以下项目必须可在 UI 中查看；除注明只读外应可编辑：

### Provider / Model

- provider enabled；
- model ID；
- provider capability（只读）；
- provider configured（只读，仅布尔值）；
- timeout；
- retry 次数；
- stream（MVP 显示为关闭且只读）。

### Generation

- temperature；
- top_p；
- max output tokens；
- presence penalty；
- frequency penalty；
- seed；
- thinking mode；
- reasoning effort；
- verbosity；
- 参数是否被 adapter 实际应用（发送后只读）。

### Persona

- core prompt；
- language；
- warmth；
- humor；
- initiative；
- directness；
- playfulness；
- default reply length；
- emoji mode；
- question frequency；
- avoid/preferred patterns；
- relationship framing；
- boundaries。

### Energy

- mode；
- manual level；
- per-message override；
- rule keywords；
- rule thresholds/weights；
- 每级 target max chars；
- 每级 target max sentences；
- 每级 max questions；
- 每级 max actions；
- allow advice；
- validation/action weights；
- tone/response instruction。

### Memory

- enabled；
- topK；
- maxChars；
- minImportance；
- included types；
- 四类 selection weights；
- auto candidate extraction 开关；
- extractor provider/model；
- manual approval（MVP 固定开启、只读）。

### Context

- history turns；
- max history chars；
- max total chars；
- timestamp inclusion；
- Energy reason inclusion；
- Memory metadata inclusion；
- section order；
- custom experiment block。

### Logging / Cost

- 各 snapshot 保存开关；
- standardized/raw response 保存开关；
- max runs；
- 每 provider input/cached input/output 单价；
- price label 与生效日期；
- auto evaluator 状态（MVP 关闭、只读）。

### 明确不暴露为可编辑项

- API Key；
- authorization headers；
- `DEEPSEEK_BASE_URL`；
- `MORA_DATA_DIR`；
- 本地任意文件路径；
- Safety baseline 的最低安全边界；
- 任何可执行代码或模板表达式。

这些项目中，provider 是否配置、安全底线内容和数据目录的逻辑名称可以只读显示，但不显示敏感值或绝对路径。

---

## 15. 错误处理

至少定义以下稳定错误 code：

```text
VALIDATION_ERROR
NOT_FOUND
CONFLICT
PROVIDER_NOT_CONFIGURED
PROVIDER_AUTH_ERROR
PROVIDER_RATE_LIMITED
PROVIDER_TIMEOUT
PROVIDER_BAD_REQUEST
PROVIDER_UNAVAILABLE
EMPTY_MODEL_OUTPUT
DATA_READ_ERROR
DATA_VALIDATION_ERROR
DATA_WRITE_ERROR
CONTEXT_BUDGET_EXCEEDED
CONTEXT_HASH_MISMATCH
COMPARISON_ALREADY_SELECTED
UNKNOWN_ERROR
```

要求：

- UI 展示用户可行动的消息；
- Run Inspector 展示安全技术摘要；
- 原始 stack 只在本地开发服务端可见，且经过 secret sanitizer；
- compare 中的单侧错误不把整个响应变成失败；
- 文件损坏时停止写入，提示用户检查对应逻辑文件名和 `.bak`，不要自动用空数组覆盖。

---

## 16. 评估 Hook

定义轻量接口，不实现自动模型评分：

```ts
interface EvaluationHookInput {
  run: RunRecord;
  comparisonRuns?: RunRecord[];
}

interface EvaluationHookResult {
  evaluator: "hook";
  scores: Partial<Record<EvaluationDimension, number>>;
  tags: string[];
  comment: string;
}

interface EvaluationHook {
  id: string;
  enabled: boolean;
  evaluate(input: EvaluationHookInput): Promise<EvaluationHookResult>;
}
```

MVP 提供：

- `NoopEvaluationHook`；
- 导出评估所需的纯 JSON 函数或 endpoint 预留；
- run 与未来 eval 的稳定关联字段。

不要在 MVP 中悄悄增加第三次 LLM 调用做 judge。

---

## 17. 测试策略

### 17.1 必须有的单元测试

- Energy Resolver：manual、rule_based、hybrid、override；
- Energy Policy renderer；
- Memory 评分、排序、预算、过期与 pinned；
- Context Builder section 顺序；
- Context 预算裁剪；
- Context hash 确定性；
- Persona trait renderer；
- 模板变量白名单与未知变量报错；
- adapter capability 参数过滤；
- OpenAI/DeepSeek 响应标准化（mock）；
- token usage 缺失处理；
- 成本估算；
- secret sanitizer；
- Zod store schema；
- 原子写失败时原文件保持可读；
- 独立 model slot 历史筛选与跨槽位隔离；
- 测试档案 repository 隔离；
- 配置 bundle 导入、导出、ID 重写与 secret 排除；
- Memory 候选提取结果始终为 candidate 且归属正确档案。

### 17.2 API 集成测试

- status API 只返回 configured boolean；
- settings CRUD 不包含 secrets；
- 跨档案实体访问返回 NOT_FOUND 且不泄露数据；
- 配置导出不包含 Memory、Conversation、Run、环境变量或 API Key；
- 非法配置 bundle 不覆盖当前配置；
- Memory preview 不产生写副作用；
- context preview 不创建 run；
- chat 成功/失败保存正确记录；
- compare 全部槽位共享 `sharedContextHash`；
- 首轮 lane context hash 相同，后续轮次只因槽位 assistant 历史而产生预期差异；
- compare 任一槽位失败仍返回其他槽位；
- 所有 LLM 失败响应均不包含 fallback 文本；
- 成功响应正文与 adapter 返回正文完全一致；
- 每个成功候选只写入所属 model slot 历史；
- malformed JSON store 不被覆盖；
- 所有 route validation 错误结构一致。

### 17.3 E2E 关键路径

使用 mock provider 或测试 adapter，禁止 E2E 默认调用真实付费 API：

1. 首次启动并看到 provider 未配置状态；
2. 创建两个测试档案，确认设置、对话与 Memory 相互隔离；
3. 修改 Settings 并刷新后仍保留；
4. 导出配置、修改设置、重新导入并看到变更摘要与恢复结果；
5. 创建 Memory 并在 selection preview 中看到分数；
6. 从聊天消息提取 Memory 候选，确认后仅进入当前档案；
7. 多模型并行聊天并打开 Context/Run Inspector；
8. 每轮看到全部启用槽位共享相同 `sharedContextHash`，无需选择回复即可继续；
9. 在 Runs 中找到同组全部记录；
10. 模拟某槽位失败，确认该容器只显示“调用失败”且其他槽位正常；
11. 模拟超长完整回复，确认保存、展示和复制内容均未被应用层截断；
12. 删除操作显示确认并正确生效；
13. 在手机和桌面 viewport 下完成主要路径，不出现阻断性横向溢出。

### 17.4 每阶段通用验证命令

按 package.json 实际脚本保持一致，至少提供：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

最终阶段再运行 E2E。真实 provider smoke test 必须由用户主动在 UI 点击，不属于自动测试。

---

## 18. 阶段实施清单

### 阶段 1：项目骨架与安全边界

- [ ] 初始化 Next.js + React + TypeScript + Tailwind App Router 项目；
- [ ] 启用 TypeScript strict；
- [ ] 创建页面路由和基础 App Shell；
- [ ] 添加 Zod、OpenAI SDK、Vitest 和测试基础设施；
- [ ] 创建 `.env.example`；
- [ ] 确保 `.env.local`、`data/*.json` 和备份/临时文件被 gitignore；
- [ ] 创建 server-only `env.ts`，只解析允许的环境变量；
- [ ] 实现 `/api/providers/status`，只返回 configured boolean；
- [ ] 建立统一 API response/error helper；
- [ ] README 写明本地启动、密钥配置和 MVP 边界。

阶段 1 验收：

- 项目可启动；
- 所有页面可导航；
- 未配置 key 时页面正常工作并显示未配置；
- 浏览器网络响应和页面源码中不存在任何 key；
- lint、typecheck、测试和 build 通过。

### 阶段 2：Schema 与本地 JSON Repository

- [ ] 实现本规格中的领域类型与 Zod schemas；
- [ ] 创建 `data-seed/*.json`；
- [ ] 实现首次启动 seed；
- [ ] 实现写队列、原子 JSON store 与 `.bak`；
- [ ] 实现各 repository；
- [ ] 实现测试档案及其级联删除策略；
- [ ] 实现 Settings、Persona、Prompt Preset、Memory、Conversation 基础 CRUD API；
- [ ] 所有档案级 repository 与 API 强制执行 `profileId` 隔离；
- [ ] 对未知 schemaVersion、损坏 JSON 和写失败添加测试；
- [ ] 确保 Route Handler 不直接使用任意文件路径。

阶段 2 验收：

- 修改设置或实体后刷新仍保留；
- 两个测试档案的数据不会互相读取或注入 Context；
- 并发写测试不会产生非法 JSON；
- 非法数据不会覆盖原文件；
- `.bak` 可用于人工恢复；
- API 结果不含环境变量或密钥。

### 阶段 3：Settings、Persona 与 Prompt Studio

- [ ] 完成 Settings 分组 UI；
- [ ] 所有行为参数可见；
- [ ] provider 不支持的字段显示 capability 提示；
- [ ] 完成 Persona 列表、编辑与 active 切换；
- [ ] 完成 Prompt Studio 分区编辑；
- [ ] 实现模板变量白名单；
- [ ] 实现 preset 创建、复制、切换与恢复 seed；
- [ ] 实现行为配置 bundle 的导出、校验、变更摘要和导入；
- [ ] 显示未保存状态与字段校验；
- [ ] 显示只读 Safety baseline。

阶段 3 验收：

- 不改代码即可调整所有主要行为参数；
- 切换 Persona/Prompt preset 后刷新仍保留；
- 未知模板变量无法保存或运行；
- API Key 从未出现在 Settings/Studio。
- 导出的配置不含 API Key、环境变量或用户聊天数据；
- 手机与桌面下 Settings、Persona 和 Prompt Studio 均可使用。

### 阶段 4：Energy、Memory 与 Context Builder

- [ ] 实现 Energy Resolver 与解释 trace；
- [ ] 实现每级 Low-Energy Policy renderer；
- [ ] 实现 Memory Selector 与评分 trace；
- [ ] 完成 Memory Inspector；
- [ ] 实现 Context Builder、预算和 hash；
- [ ] 实现 `/api/context/preview`；
- [ ] 完成 Context Inspector；
- [ ] 对确定性、顺序、预算和裁剪添加完整测试；
- [ ] 实现 policy deviation 观察，不强行截断回复。

阶段 4 验收：

- 相同输入、设置、model slot 与槽位历史生成相同 lane context hash；
- 能解释 Energy Level 的来源；
- 能解释每条 Memory 为什么入选或未入选；
- Context Inspector 可查看最终每个分区；
- 没有 embedding、向量库或 RAG。

### 阶段 5：Provider Adapters、Memory 提取与模型槽位

- [ ] 实现统一 adapter 类型与 registry；
- [ ] 实现 OpenAI Responses API adapter；
- [ ] 实现 DeepSeek adapter；
- [ ] 实现 capability 参数过滤与 applied parameter trace；
- [ ] 实现超时、有限 retry、错误清洗与 usage 标准化；
- [ ] 实现成本估算；
- [ ] 实现 provider test API；
- [ ] 实现可配置 model slots；
- [ ] 实现聊天 Memory 的 LLM 候选提取、人工确认与拒绝流程；
- [ ] 实现自动触发的 Memory 候选提取，且只提取用户原话；
- [ ] 实现 runs 写入与 Run Inspector；
- [ ] 使用 mock 覆盖成功、空输出、超时、限流、认证错误、无 fallback 与全文不截断测试。

阶段 5 验收：

- 两个 provider 可独立选择；
- 未配置 provider 会得到友好错误；
- 单独启用任一 model slot 时可完成调用；
- Memory 提取产生的内容始终先进入当前档案的 candidate；
- 每轮可查看 settings/context snapshot；
- token、延迟和成本状态正确；
- 不支持的参数显示为 not_applied；
- provider 错误不会泄露 secret。

### 阶段 6：多模型 Compare Chat

- [ ] 实现 compare orchestrator；
- [ ] 共享一次 Context Builder 结果；
- [ ] 并行调用全部启用的 model slots；
- [ ] 保存 comparison group、同组 runs、共享 hash 与各槽位 lane hash；
- [ ] 实现多模型容器 Compare Chat UI；
- [ ] 实现单槽位失败时严格显示“调用失败”；
- [ ] 将每个成功回复自动保存到所属 model slot 的独立历史；
- [ ] 防止任一槽位读取其他槽位的 assistant 历史；
- [ ] 测试 N 个槽位共享配置公平性、首轮 hash 一致与后续分支差异；
- [ ] 修改槽位 provider/model 时强制重置该槽位历史或复制为新槽位；
- [ ] 测试任何失败路径均不产生预设保底回复；
- [ ] 测试模型全文在持久化、API 和 UI 三层均不被硬截断。

阶段 6 验收：

- 同一轮全部槽位的 `sharedContextHash` 必须相同；
- 首轮完整 context hash 相同；后续完整 hash 只允许因独立 assistant 历史不同；
- 各槽位共享 Persona、Energy、Memory、Prompt 和 user 消息，只允许 provider/model/generation 与既有槽位 assistant 历史不同；
- 任一 provider 失败时其他结果仍显示，失败槽位只显示“调用失败”；
- 每个成功 assistant message 只进入所属槽位历史；
- 同组全部 runs 均可独立检查；
- 没有 fallback 回复，没有应用层生成内容硬截断。

### 阶段 7：Runs、响应式适配与收尾

- [ ] 提供 NoopEvaluationHook；
- [ ] 完成 Runs 列表筛选、分页/游标和详情；
- [ ] 完成 maxRuns 清理策略；
- [ ] 增加本地隐私提示与删除确认；
- [ ] 完成 Dashboard 最近 runs 与设置摘要；
- [ ] 补齐空状态、加载状态与错误状态；
- [ ] 完成极简 UI 收口和手机/桌面响应式验证；
- [ ] 完成 E2E；
- [ ] 执行 lint、typecheck、test、build 和 E2E；
- [ ] 更新 README，列出已知限制和真实 API smoke test 步骤。

阶段 7 验收：

- 可以用 provider/mode/status/conversation 筛选 runs；
- UI 中明确这是本地 Demo；
- 手机和桌面主要流程均可完成且无阻断性布局问题；
- 自动测试不调用真实 API；
- 全部质量检查通过。

---

## 19. MVP 总体验收标准

只有以下所有条件满足，MVP 才算完成。

### 功能

- [ ] 可用 OpenAI 单独聊天；
- [ ] 可用 DeepSeek 单独聊天；
- [ ] 每次用户输入都会在全部启用模型容器中并行生成结果；
- [ ] 每个模型槽位维持独立 assistant 历史，用户无需选择回复即可继续；
- [ ] Persona、Energy、Memory、Context、Prompt 和模型参数均可查看与调试；
- [ ] 可创建和切换本地测试档案，且档案间设置、对话、Memory 和 runs 相互隔离；
- [ ] 可从聊天生成结构化 Memory 候选，并经人工确认后进入当前档案；
- [ ] 可安全导出和导入行为配置文件；
- [ ] 数据刷新后仍存在于本地 JSON；
- [ ] 可查看 run、token、延迟、估算成本、设置快照和 Context 快照；

### 公平性与可解释性

- [ ] 同轮全部模型槽位拥有相同共享配置 hash，并可检查各自 lane Context Snapshot 与 hash；
- [ ] 每个行为参数都可在 UI 或只读 Inspector 中找到；
- [ ] 每个 provider 参数都有 applied/not_applied 状态；
- [ ] Energy 结果有来源和理由；
- [ ] Memory 选择有逐条 trace；
- [ ] 成本明确标记为 estimate，价格配置可见。

### 安全

- [ ] API Key 只在服务端环境变量中；
- [ ] 浏览器、localStorage、sessionStorage、HTML、API 响应与 JSON 文件中均无 key；
- [ ] `.env.local` 已 gitignore；
- [ ] 不返回供应商 header、完整原始错误或 stack；
- [ ] 本地敏感数据有明确提示和删除能力；
- [ ] Safety baseline 可查看但不可通过 UI 删除。

### 工程质量

- [ ] TypeScript strict，无新增类型错误；
- [ ] lint 通过；
- [ ] 单元与集成测试通过；
- [ ] production build 通过；
- [ ] E2E 关键路径通过；
- [ ] JSON 写入经过校验、队列和原子替换；
- [ ] 自动测试不产生真实模型费用；
- [ ] README 足以让新开发者在本地启动。

### 范围

- [ ] 没有数据库；
- [ ] 没有 RAG/知识库/向量检索；
- [ ] 没有微调；
- [ ] 没有语音；
- [ ] 没有登录、账号、多租户权限或云同步；只有无身份系统的本地测试档案；
- [ ] 没有不必要的 Agent/工具调用框架。

---

## 20. Seed 建议

初始 seed 应尽量少，只为首次启动提供可用结构。

### 20.1 Persona seed

创建一个 `MORA Default`，核心方向：

- 温和但不黏腻；
- 不假装全知；
- 先承接，再决定是否提问或建议；
- 低能量时显著缩短回复；
- 避免连续追问、说教、诊断和模板式积极；
- 必要时允许安静陪伴，不强迫用户行动；
- 默认只使用简体中文；
- 树懒身份只作为轻微节奏与气质，不频繁使用拟声、动作描写或角色口头禅；
- 避免“只有我懂你”“永远不要离开我”等排他、依赖或夸大亲密关系的表达；
- 关系 framing、playfulness、preferred/avoid patterns 保持可编辑，供后续增强或弱化角色感。

具体文字放入可编辑 Persona，不要散落硬编码在多个组件。

### 20.2 Memory seed

`memories.json` 初始为空。不要预置虚构的用户 Memory。

Memory 自动提取默认开启，seed extractor 使用 DeepSeek `deepseek-v4-flash` 并关闭 thinking mode。该模型适合高频结构化提取且成本低于 Pro；设置中允许切换 provider/model。提取失败不得切换到其他模型保底。

### 20.3 Model seed

- 第一个启用槽位为 OpenAI `gpt-5.6-sol`，初始 `reasoningEffort: "none"`、低 verbosity，用于测试自然、低延迟的陪伴回复；
- 第二个启用槽位为 DeepSeek `deepseek-v4-pro`，初始关闭 thinking mode，用于与 OpenAI 稳定模型进行文本陪伴比较；
- 上述选择依据 2026-08-21 官方模型目录；首次真实连接前必须复核官方文档、账号权限和实际 model ID；
- UI 必须允许用户修改 model ID、增加槽位、复制槽位、停用槽位和调整槽位级参数；
- adapter 不得依赖 seed model ID 做业务分支，只能通过 capability 过滤实际参数；
- 供应商新模型应只需改 Settings，不需改 orchestrator。

### 20.4 Price seed

价格字段初始建议为 `null`，让用户按实际模型价格填写；或明确标注示例值和日期。绝不把未核验的价格当作事实。

---

## 21. Definition of Done 与交付格式

Cursor 在每个阶段结束时，回复应采用以下结构：

```text
阶段：<编号与名称>

已完成：
- ...

主要文件：
- ...

验证：
- lint: pass/fail
- typecheck: pass/fail
- test: pass/fail
- build: pass/fail/not run

验收自检：
- ...

假设或已知限制：
- ...

下一阶段：
- ...
```

最终交付必须包含：

- 可运行的本地项目；
- `.env.example`；
- 完整 README；
- 初始 seed；
- 测试；
- 本规格文件；
- 已知限制；
- 不含任何真实 API Key 或用户数据。

---

## 22. 参考与实现提醒

- OpenAI 端采用 Responses API 的服务端实现；官方接口支持 `instructions`、`input`、`max_output_tokens`、部分采样/推理参数及 usage 数据。实际可用参数仍以所选模型能力为准。
- OpenAI 官方接口参考：<https://developers.openai.com/api/reference/resources/responses/methods/create>
- DeepSeek 的 endpoint、模型名和参数能力可能变化，保持 adapter 隔离并以用户当前账号/官方文档为准。
- 本地 JSON 方案是为了实验透明度和低复杂度，不是生产架构。出现多用户、多进程、多设备、云部署、大量日志或复杂检索需求时，再单独设计数据库迁移。

本文件是 MVP 的范围与验收基线。如果实现与本文件冲突，优先满足：安全规则、多模型公平性、真实失败呈现、生成全文不截断、数据可恢复性、可观察性和 MVP 非目标。
