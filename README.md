# ZHAKA Lab

ZHAKA Lab 是一个**本地单机 Web 实验台**，用于调试树懒气质的低负担陪伴式对话，并在同一句输入下并行比较多个模型供应商的表现。

它不是最终消费者产品界面。Prompt Studio、Context Inspector、Run Inspector 都是实验工具。

## 核心特性

- **多模型并行比较**：一次输入，全部启用的模型槽位同时回复，各自独立成列。
- **独立对话分支**：每个槽位维护自己的 assistant 历史。首轮上下文完全一致，之后各自分叉，界面同时显示共享 hash 与各槽位 hash。
- **本地测试档案**：无登录，但不同档案的设置、Persona、对话、Memory 与运行记录完全隔离。
- **可解释的 Energy 判定**：规则、阈值、关键词全部在设置中可见可改，判定依据写入每次运行记录。
- **可控的结构化记忆**：每轮自动从**用户原话**提取并默认写入正式记忆，下一轮起可进入上下文；设置中可改回「写入前需人工确认」。已写入的条目仍可在 Memory 页修改或删除。
- **如实呈现失败**：任何模型调用失败只显示「调用失败」。没有预设话术、没有规则生成文本、不复用其他模型的结果。
- **绝不截断**：供应商返回的正文完整保存与展示。长内容可以折叠，但始终能展开和复制全文。

## 环境要求

- Node.js 20.9 或更高（开发时使用 24.x）
- npm 10 或更高

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入你自己的 API Key
npm run dev
```

打开 <http://localhost:3000>，首次启动会自动从 `data-seed/` 生成本机数据文件。

## 环境变量

所有密钥只在 Next.js 服务端读取，永远不会进入浏览器、页面 HTML、API 响应或日志。

| 变量 | 说明 |
| --- | --- |
| `KIMI_API_KEY` | Kimi（Moonshot）API Key，可留空。在 [platform.moonshot.cn](https://platform.moonshot.cn) 创建 |
| `KIMI_BASE_URL` | 默认 `https://api.moonshot.cn/v1`。国际站可改为 `https://api.moonshot.ai/v1` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，可留空 |
| `DEEPSEEK_BASE_URL` | DeepSeek 地址，默认 `https://api.deepseek.com` |
| `MORA_DATA_DIR` | 本地数据目录，默认 `./data` |

未配置某个 Key 时，对应槽位会在调用时显示「调用失败」，其他槽位不受影响。

## 数据存放位置

全部数据以 JSON 保存在 `MORA_DATA_DIR`（默认 `./data`）：

```
data/
  profiles.json          测试档案列表
  settings.json          每个档案的设置
  personas.json          Persona
  prompt-presets.json    Prompt 分区模板
  memories.json          记忆与候选
  conversations.json     对话与消息
  runs.json              运行记录与上下文快照
  evals.json             预留，首版不写入
```

每次写入都会先校验、写临时文件、生成一份 `.bak`，再原子替换。**这个目录被 `.gitignore` 忽略，不会进入版本库。**

## 页面

| 页面 | 用途 |
| --- | --- |
| 总览 | 当前档案、启用槽位、运行与成本概况 |
| 多模型对话 | 主实验界面，并行调用与结果对比 |
| Prompt Studio | 编辑 Persona 与上下文分区模板 |
| Memory | 确认候选、管理与预览记忆选择 |
| 运行记录 | 每次调用的完整快照与筛选 |
| 设置 | 模型槽位、生成参数、Energy、Memory、Context、档案与配置导入导出 |

## 配置导出与导入

设置页可以把当前档案的**行为配置**导出为 JSON：只包含设置、Persona 与 Prompt Preset。

导出文件**不包含** API Key、base URL、路径、对话、Memory 或运行记录。导入时服务端会重新完整校验，安全底线由程序提供，不会被配置文件覆盖。

## 模型与价格

种子配置使用 `gpt-5.6-sol` 与 `deepseek-v4-pro`，记忆提取使用 `deepseek-v4-flash`。**首次使用前请按你账号实际可用的模型在设置页修改。**

价格默认留空，因此成本显示为「未配置价格」。填入价格后所有成本都标记为估算值，请自行核对官方定价。

## 开发命令

```bash
npm run dev         # 开发服务器
npm run build       # 生产构建
npm run typecheck   # TypeScript 检查
npm run lint        # ESLint
npm test            # 单元与集成测试（全部使用 mock，不消耗真实 API）
npm run e2e         # Playwright 端到端测试
```

## 边界

首版不包含：语音输入、语音日记、TTS、长期状态轨迹、登录与多用户、云端存储、RAG 与向量检索、模型微调、评分系统与自动评估。

`evals.json` 与 evaluation hook 接口已预留，但首版不提供写入界面。
