# ZHAKA 账号与权限系统设计 & 执行方案

> 状态：**产品决策已冻结；Phase 1–3 核心代码已落地**（登录鉴权、角色守卫、guest 浏览器聊天/记忆、用量日志、配置热切换提示）  
> 日期：2026-09-09  
> 目标：把「本机 Lab + 本地测试档案」演进为「管理员配置 / 体验账号聊天」，并明确数据落点与权限边界。  
> **账号已定**：无注册；`accounts.json`；首发 **1 admin + 10 guest**；改完重启。  
> **配置已定**：**改完即生效** + **热切换**（guest **无需刷新**，下一句发言即用新配置）。  
> **部署**：公网腾讯云，当前入口 [http://120.53.223.237:3004](http://120.53.223.237:3004)（HTTP；HTTPS 待后补）。

---

## 1. 背景与目标

### 1.1 现状（简要）

- 无登录；用 **Profile（本地测试档案）** 隔离本机 JSON：设置、Persona、行为配置、对话、Memory、Runs。
- 数据全部在服务端 `MORA_DATA_DIR`（默认 `./data`），浏览器只是控制台。
- 设置页可改一切：模型槽位开关、并行对比、导入导出、行为配置等。
- Lab 假设使用者 = 策划/工程，同一人既改配置又聊天。

### 1.2 目标形态

| 角色 | 能做什么 | 不能做什么 |
|------|----------|------------|
| **管理员** | 改任意配置；控制跑 2 个模型还是只跑某一个；配置导入/导出；**可正常聊天、自行体验**（与体验账号同一套聊天能力） | 无注册；不在 Web 内做账号增删（改 `accounts.json`） |
| **体验账号** | 在管理员定稿的版本里聊天体验 | 改配置、开关模型、导入导出、进 Studio / 行为编辑等 |

| 数据类型 | 存放位置 | 谁可读可写 |
|----------|----------|------------|
| **配置**（Persona、行为配置、Prompt Preset、模型槽位启用、生成参数、安全/能量等） | **服务端**（管理员可导入导出） | 仅管理员写；体验账号只读生效结果 |
| **用户数据**（聊天记录、Memory） | **用户浏览器本地** | 各浏览器各自一份；服务端默认不持久化用户聊天/记忆 |

### 1.3 非目标（本阶段不做）

- **注册 / 自助开户 / 邮箱验证 / 找回密码**（账号一律由运维在服务端文件中维护）。
- 完整 SaaS 多租户、OAuth、企业 SSO、细粒度 RBAC（编辑者/审核者等）。
- 服务端永久保存每位体验用户的聊天**原文**（可保留不含原文的匿名用量日志，见 §12 决策）。
- 把毛绒硬件 / ASR / TTS 的账号体系与本 Lab **打通**（Lab 仅为内部 Web 版本）。

---

## 2. 「本地测试档案」还有没有意义？

### 2.1 结论（建议）

**在目标产品语义下：对体验用户无意义，应弱化/移除；对管理员可降级为「配置版本 / 环境」，而不是「测试用户档案」。**

| 旧概念 | 旧用途 | 新世界里 |
|--------|--------|----------|
| Profile A / B | 隔离两套「人设+对话+记忆」做对比实验 | 对话与记忆改到浏览器本地后，**不再用 Profile 隔离用户数据** |
| 多档案 | 模拟多用户 | 由 **体验账号身份 + 浏览器本地库** 承担 |
| 档案级导入导出 | 导出某档案配置 | 改为 **管理员导出「当前发布配置」**，不必绑档案名 |

### 2.2 建议替换概念

- **删除或隐藏「本地测试档案」UI**（顶栏下拉、设置里的档案管理）。
- 若管理员仍需要「试两套配置不互相覆盖」，用其一：
  - **配置环境**：`draft`（草稿）/ `published`（体验账号只读 published）；或
  - **配置快照 / 版本号**：导出文件即版本，导入即回滚；
  - **不保留多套并行配置**（最简）：服务器只有一份生效配置。

**已定：改完即生效**（不做 draft/published 双轨）。不做 N 个 Profile。

### 2.3 迁移期

现有 `profiles.json` 与按 `profileId` 分片的数据可暂时保留为「默认配置槽」，对外改名「当前配置」，停止鼓励新建档案。

---

## 3. 角色与权限矩阵

### 3.1 角色

| role | 说明 |
|------|------|
| `admin` | 配置与发布的负责人 |
| `guest`（体验账号） | 只聊天 |

> 命名可用 `experiencer` / `player`；下文统一用 **体验账号 / guest**。

### 3.2 页面与能力

| 能力 / 页面 | 管理员 | 体验账号 |
|-------------|--------|----------|
| 登录 | ✓ | ✓ |
| 聊天体验（与体验账号同等对话能力） | ✓（**已定：管理员当然可以自己聊、自己体验**） | ✓（仅管理员启用的槽位） |
| 改 Persona / 行为配置 / Preset | ✓ | ✗ |
| 模型开关（槽位 enable、并行 2 路 vs 1 路） | ✓ | ✗（只消费结果） |
| 配置导入 / 导出 | ✓ | ✗ |
| Prompt Studio / Context Inspector / Runs 全量调试 | ✓ | ✗（或只读极简「本轮失败原因」） |
| Memory（聊天相关） | ✓（浏览器本地，与自己的聊天绑定） | ✓（浏览器本地） |
| 注册 / 自助开户 | ✗ | ✗ |
| 在 Web UI 里增删改账号 | ✗（默认；改账号改服务器文件） | ✗ |

### 3.3 API 权限（原则）

- **写配置类** `PUT/POST/DELETE` settings、personas、behavior-config、prompt-presets、config import、槽位相关 → **仅 admin**。
- **读配置类**（聊天所需最小集）→ admin 与 guest 均可；guest 只拿 **published 生效包**，不含草稿、不含密钥。
- **聊天生成** `POST /api/compare`（或新 `/api/chat`）→ 已登录即可；服务端用 published 配置 + 服务端 API Key 调模型；**请求体可带本轮消息，但不把完整历史强制写入服务端库**（见 §5）。
- **Profiles CRUD** → 废弃或仅 admin 且隐藏。

密钥（`KIMI_API_KEY` 等）**永远只在服务端**，体验账号响应中不得出现。

---

## 4. 账号与鉴权设计

### 4.1 原则（已拍板）

- **无注册流程**：产品只有「登录」，没有注册页、邀请码自助开户、忘记密码。
- **账号存在服务器文件内**：管理员与体验账号都写在同一份（或明确拆分的）服务端账号文件里，由运维/管理员在机器上编辑后生效。
- **Web UI 不提供账号 CRUD**（本阶段）：增删用户、改密码 = 改文件（或极少数运维脚本），避免体验台出现「用户管理」后台。

### 4.2 账号文件（建议）

路径示例（勿提交明文密码到 git；可用 `.gitignore`）：

```
$MORA_DATA_DIR/accounts.json          # 推荐：与业务数据同目录，部署机可写
# 或
./secrets/accounts.json               # 更严：仅运维可读
```

建议结构（示意）：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-09-09T00:00:00.000Z",
  "users": [
    {
      "id": "user-admin-1",
      "username": "admin",
      "role": "admin",
      "passwordHash": "<argon2/bcrypt hash>",
      "enabled": true,
      "displayName": "管理员"
    },
    {
      "id": "user-guest-1",
      "username": "guest",
      "role": "guest",
      "passwordHash": "<argon2/bcrypt hash>",
      "enabled": true,
      "displayName": "体验账号"
    },
    {
      "id": "user-guest-2",
      "username": "tester-a",
      "role": "guest",
      "passwordHash": "<...>",
      "enabled": true,
      "displayName": "受试者 A"
    }
  ]
}
```

约定：

| 项 | 说明 |
|----|------|
| 多管理员 / 多体验账号 | **允许**；**首发固定：1 × admin + 10 × guest**（可在文件中增减，改完重启） |
| 密码 | 文件内只存 **hash**，不存明文；初次部署用一次性脚本生成 hash 写入 |
| 禁用 | `enabled: false` 立即不可登录（**改完重启后**再生效，见决策） |
| 种子 | 提供 `accounts.example.json`（示例 1 admin + 10 guest 占位）+ `npm run accounts:hash` |
| 与 `.env` 关系 | API Key 仍在 `.env`；**账号不放 env**，统一走 `accounts.json` |
| 公网部署 | 腾讯云；当前 HTTP IP:3004；登录限流；**暂无 Secure Cookie，待 HTTPS** |

登录流程：

1. 用户打开 `/login`，输入用户名 + 密码（无「注册」入口）。  
2. 服务端读 `accounts.json`，校验 `enabled` + 密码 hash。  
3. 成功则发 **HttpOnly** Cookie（session）；HTTP 阶段不加 `Secure`，上 HTTPS 后再加。  
4. Session 载荷：`{ userId, username, role, exp }`。  
5. 中间件 / API：`requireAuth()` / `requireRole('admin' | 'guest')`。

**不做**：邮箱验证、找回密码、OAuth、复杂 RBAC、产品内注册。

### 4.3 浏览器本地数据与账号的对应

- IndexedDB / 本地库按登录后的 **`userId`（来自 accounts 文件）** 分库，例如 `zhaka:{env}:{userId}:…`。  
- 同一体验账号在不同浏览器 = 两套本地聊天（符合「数据在浏览器」）；不在此引入云同步。  
- 不再使用「共享口令 + 匿名 deviceId」作为主方案；若运维只配了一个 `guest`，多人共用该账号时，本地数据仍按浏览器隔离，服务端无法区分人——这是文件里只配一人时的预期限制。

### 4.4 与「配置生效」的关系（已定）

- **改完即生效**：Admin 在设置里保存后，服务端当前配置立即成为唯一生效配置。  
- **热切换**：Guest **不必刷新浏览器**。已打开的聊天页里，**下一次点发送**时，服务端会重新读取最新配置再生成回复；正在屏幕上的旧气泡不会被改写。  
- 实现要点：每次 `/api/chat` 现读配置，不在浏览器缓存「整份死配置」作为唯一真相。

---

## 5. 数据架构重划

### 5.1 服务端保留（管理员配置面）

```
$MORA_DATA_DIR/
  accounts.json         # 账号（admin + guest）；无注册，运维改文件
  published/
    settings.json       # 槽位开关、生成参数等（无 API Key）
    personas.json
    prompt-presets.json
    behavior-config.json
  draft/                # 可选，仅 admin
  runs/                 # 可选：仅 admin 调试时写；guest 默认不写
```

- **导入导出**：只针对 published（或 draft→published 流程中的包），格式可延续现有 behavior / config bundle；**导出包不含 accounts.json**。
- **API Key**：仍只在 `.env`，不进导出包、不进 accounts。

### 5.2 浏览器本地（所有登录用户的聊天与 Memory）

建议技术选型（择一，推荐顺序）：

1. **IndexedDB**（推荐，经 `idb` 等封装）— 容量够、可结构化存对话与记忆。  
2. `localStorage` — 仅适合极小 POC，易满、难索引。

建议库名 / key 空间：

```
zhaka:{env}:{userId}:    # userId 来自 accounts.json，登录后可知
  conversations
  messages
  memories
  meta (schemaVersion, lastConfigHash)
```

- **管理员与体验账号都可以聊天**：管理员登录后既可进配置台，也可进聊天自行体验；聊天与 Memory 同样只存在**该管理员浏览器本地**，不与配置目录混写，也不占用体验账号的本地库。
- **换浏览器 / 清站点数据 = 丢聊天与记忆**（需在 UI 明确提示）。
- 可选：已登录用户「导出我的聊天 JSON」纯客户端下载（非管理员配置导出）。

### 5.3 聊天请求时序（guest）

```
浏览器本地读出：近期消息 + 选中的 memories
    → POST /api/chat  { messages?, memories?, conversationId? }
    → 服务端：鉴权 guest → 加载 published 配置 → Router/TurnPlan → 调模型
    → 返回：assistant 文本 +（可选）behaviorTrace 精简版
    → 浏览器写入本地 messages；可选在本地跑/请求「记忆抽取」结果也只写本地
```

要点：

- 服务端**可以短暂**在请求内存中使用历史，**默认不落库**。
- Memory 抽取若仍走 LLM：可 `POST /api/memories/extract` 返回候选，**由客户端写入 IndexedDB**；不再 `memories.json` 服务端持久化（guest）。
- Admin 调试模式可另开「将本轮 Run 写入服务端 runs」开关，默认关。

### 5.4 「本地测试档案」数据迁移

| 旧数据 | 建议 |
|--------|------|
| 配置类 JSON | 收敛为单一 published（选一个现用 profile 提升） |
| conversations / memories / runs | 可选一次性「导出到浏览器」工具；或宣布 Lab 数据不迁移，体验台从零开始 |
| 多 profile | 停止新建；文档标明废弃 |

---

## 6. 产品信息架构（IA）

### 6.1 管理员台

- 登录 → 可进 **配置 / 设置**，也可进 **聊天**（已定：管理员自己可以聊、可以体验）。
- 保留：设置、行为配置、Persona、模型槽位（1 路 / 2 路）、导入导出、（可选）Runs / Studio。
- 聊天与体验账号走同一套对话链路；管理员可用 published 预览，若有 draft 也可试 draft（产品另定）。
- **去掉**「本地测试档案」管理块与顶栏档案切换（或改成 draft/published 切换）。

### 6.2 体验台

- 登录 → **只有聊天**（单列优先；若 admin 开了双模型，可只显示「主槽」或双列只读对比，由配置决定）。
- 无设置、无导入导出、无 Studio、无档案。
- 页脚提示：聊天与记忆仅保存在本机浏览器。

### 6.3 路由示例

| 路径 | 角色 |
|------|------|
| `/login` | 公共；**仅登录，无注册链接** |
| `/admin/*` | admin |
| `/chat` 或 `/` | guest（及 admin 预览） |
| `/api/auth/login` | 公共（校验 accounts.json） |
| `/api/auth/logout` | 已登录 |
| `/api/admin/*` | admin |
| `/api/chat` | 已登录 |

前端路由守卫 + API 双重校验（不可只藏按钮）。**不提供** `/register` 或 `/api/auth/register`。

---

## 7. 模型开关（管理员专属）

对应现有「槽位 enable / 并行 compare」：

- Admin 在 settings 中启用各模型槽位。  
- **已定（Q7）**：管理员开放几个槽位，guest 就看到几列；两个都开则 guest **可见两列对比**；只开一个则 guest 只见一列。  
- Guest UI **不提供**开关；服务端按生效 settings **强制**槽位集合，忽略客户端篡改。

---

## 8. 安全要点

1. 所有写配置 API：校验 session role=admin。  
2. Guest 请求体不得指定任意 personaId/behavior 覆盖（或仅允许白名单内的「无副作用」字段）。  
3. 导出包审计：无 Key、无用户聊天。  
4. Cookie：`HttpOnly; Secure; SameSite=Lax`（或 Strict）。  
5. 密码：`accounts.json` 内只存 hash（argon2/bcrypt）；文件权限收紧（如 `chmod 600`）。  
6. 速率限制：login + guest 聊天 API，防撞库与刷 Key。  
7. XSS：本地存储的消息渲染需转义，避免脚本注入读其它源。  
8. `accounts.json` 与配置导出隔离，防止误发账号文件。  
9. 登录失败统一文案（不提示「用户不存在」vs「密码错误」）。

---

## 9. 与现有模块的映射

| 现有模块 | 变更方向 |
|----------|----------|
| `profile-manager` / `profiles` API | 废弃或改为 config env |
| `settings` + 槽位 | 仅 admin 写；guest 读 published |
| `behavior-config` 导入导出 | 仅 admin |
| `compare` 编排 | 抽成 chat 服务；guest 不写 runs（默认） |
| `conversations` / `memories` 服务端仓库 | guest 路径改为客户端；admin 可选保留调试写入 |
| `app-shell` 顶栏档案 | 改为角色标识 + 当前用户名 + 退出登录 |
| 新模块 `accounts.json` + login | 无注册；启动时校验文件可读、至少一名 enabled admin |
| E2E「新建测试档案隔离」 | 改为「guest 无法进设置」「admin 可导出」「无注册入口」等 |

---

## 10. 执行方案（分阶段，仍先不写代码）

### Phase 0 — 决策冻结

- **已完成**（含 guest Memory 强制自动写本地）。通读 §12 无异议即可编码。

### Phase 1 — 鉴权骨架（2–4 天）

- `accounts.example.json` + hash 生成脚本；部署机写入真实 `accounts.json`。  
- 登录页（无注册）、session、`requireRole`；读文件校验用户。  
- 路由拆分 admin / chat。  
- 全部写配置 API 挂 admin 守卫（先不改数据落点，仍用现有 JSON + 单一默认 profile）。  
- 体验账号登录后隐藏设置入口（前端）+ API 拒绝（后端）。

### Phase 2 — 配置发布模型（2–3 天）

- 收敛多 Profile → 单一 published（+ 可选 draft）。  
- 导入导出仅 admin；文案去掉「测试档案」。  
- 模型 single/compare 仅 admin。

### Phase 3 — 用户数据迁浏览器（4–7 天）

- IndexedDB schema + 对话/Memory CRUD。  
- `/api/chat`：服务端无会话持久化（默认）。  
- Memory 抽取结果回写客户端。  
- UI 提示「数据仅本机」。  
- 迁移/清空策略说明。

### Phase 4 — 打磨与 hardening（2–4 天）

- 速率限制、发布锁定策略、错误态、E2E、文档（README / 策划手册）。  
- 删除或归档 Profile 相关 UI 与测试。

### 合计粗估

约 **2–3 周**（1 人）；账号文件首发 1 admin + 10 guest、公网加固、匿名用量日志计入工期。若 Q5 选「改完即生效」（无 draft），可略缩短 Phase 2。

### 建议交付顺序的「可演示里程碑」

1. Admin/Guest 登录 + Guest 看不到设置。  
2. Admin 改槽位后 Guest 聊天行为立刻（或发布后）一致。  
3. Guest 刷新后聊天仍在（IndexedDB），服务端 `conversations.json` 不再增长。  
4. 仅 Admin 能导出配置包。

---

## 11. 「本地测试档案」最终建议（产品口径）

- **对体验用户**：不存在、不展示。  
- **对管理员**：用「当前配置 / 草稿 / 已发布」替代「测试档案」。  
- **工程上**：`profileId` 可暂时硬编码为 `profile-default` 以降低改造面，待 Phase 2 再删字段。

---

## 12. 决策记录、名词解释与收尾清单

### 12.1 已拍板（含本轮）

| # | 议题 | 决策 |
|---|------|------|
| — | 注册 / 账号文件 | 无注册；`accounts.json`；改完**重启** |
| — | 管理员聊天 | 可以自己聊、自己体验；数据在浏览器本地 |
| 1 | 首发账号 | **1 × admin + 10 × guest**（命名与口令见 §12.5） |
| 3 | 部署 | 公网腾讯云；当前 [http://120.53.223.237:3004](http://120.53.223.237:3004)（**HTTP**；HTTPS 后补） |
| 4 | 改 accounts | **改完重启** |
| **5** | 配置生效 | **改完即生效**（保存就变） |
| **5 补充** | guest 要不要刷新？ | **不用刷新**；下一句发送即用新配置（热切换） |
| 6 | 热切换 | 已定；实现不难 |
| 7 | 双列 | Admin 开几槽 guest 看几列 |
| 8 | 聊天仅浏览器 | 可接受；**不做**「导出我的聊天」 |
| 9 | 匿名用量日志 | **需要**；**仅服务端文件/日志**，不做 Admin 统计页（首发） |
| **10** | Memory 抽取 | **与现有 Lab 相同：继续自动抽取**；落盘改为浏览器本地；**guest 强制自动写入、无确认页**；admin 可保留「写入前确认」开关 |
| **11** | 旧服务器聊天文件 | 上线前由你**清空**；工程不迁移 |
| 12 | 云端/本地 | 同一套；只保留最新版本 |
| **13** | Studio / Runs / Inspector | **guest 完全进不去**（路由+API）；失败仅短提示 |
| 14 | 硬件 | 不打通；Lab 内部 Web |
| 15 | 名称 | **ZHAKA Lab** |
| 16 | 手册账号章 | 到时候再说 |
| 新1 | guest 命名/密码 | **由设计生成**（§12.5）；部署时写入 hash |
| 新2 | 用量日志形态 | **文件即可** |
| 新3 | HTTPS | **暂无**；先 HTTP IP:端口 |
| 新4 | 导出聊天 | **不用** |
| 新5 | 每日轮次上限 | **不用** |
| 新6 | 配置更新提示 | **可以**：guest 侧轻提示「配置已更新」 |

### 12.2 关键解释（回答你的追问）

#### Q5：guest 不刷新也会变吗？

**会。** 更精确地说：

| 时机 | 行为 |
|------|------|
| Admin 刚点保存 | 服务端配置已是新的 |
| Guest 浏览器页面还开着 | **不用 F5** |
| Guest **下一次发送消息** | 这次请求按**新配置**生成；所以「下一句」就会变味道/人格/槽位规则 |
| 已经显示在屏幕上的旧回复 | **不会**被自动改写成新配置下的说法 |

若 Guest 一直挂机不说话，页面上看不到变化；一说话就变。这就是热切换。

#### Q10：和现在 Lab 的 Memory 有什么不同？

**业务逻辑：做成一样。**

现在 Lab 大致是：

1. 用户说话 → 模型回复（主对话）。  
2. 若设置里开了「自动抽取记忆」：系统**再调一次**模型，从用户原话里抽出候选记忆。  
3. 写入服务器的 `memories.json`。  
4. 之后几轮把相关记忆拼进上下文。

新账号体系下：

| 步骤 | 现在 Lab | 新方案 |
|------|----------|--------|
| 要不要自动抽 | 有开关，默认会抽 | **同样：继续自动抽** |
| 多一次 LLM 费用/延迟 | 有 | **一样** |
| 记忆存哪 | **服务器** `data/memories.json` | **该用户浏览器本地**（IndexedDB） |
| 换电脑 / 清缓存 | 服务器上还在 | **没了**（你已接受） |
| guest 进 Memory 管理后台 | Lab 里可进 | guest **不进**管理页、**无「写入前确认」**；抽取结果**直接写入本地**供后续对话使用 |

所以：**不是换一套新记忆哲学，只是「存服务器」改成「存浏览器」。**

#### Q11 / Q13（已定简述）

- Q11：你上线前清空服务器旧聊天即可。  
- Q13：guest 打不开 Studio / Runs / Context Inspector。

### 12.3 公网 HTTP 注意（工程默认）

当前入口为 HTTP IP。在上 HTTPS 之前：

- Cookie **不能**强制 `Secure`（否则登录态设不上）；用 `HttpOnly; SameSite=Lax`，待 HTTPS 后再开 `Secure`。  
- 公网 HTTP 下密码窃听风险更高 → 仍做登录限流；尽快补域名 + HTTPS。  
- 品牌文案后续统一为 ZHAKA Lab。

### 12.5 首发账号清单（生成稿）

> 部署时用脚本把下方明文打成 hash 写入 `accounts.json`，**勿把含真实生产 hash 的文件提交到公开 git**。口令为 **6 位（数字+小写字母）**，便于内测分发；公网 HTTP 下强度有限，上线后可轮换。

| username | role | 建议初始密码（明文，仅首次；**6 位：数字+小写字母**） |
|----------|------|------------------------------|
| `admin` | admin | `a9k2m4` |
| `guest01` | guest | `g1m7w4` |
| `guest02` | guest | `g2r8x3` |
| `guest03` | guest | `g3t5h9` |
| `guest04` | guest | `g4v2j6` |
| `guest05` | guest | `g5q4l8` |
| `guest06` | guest | `g6n9w3` |
| `guest07` | guest | `g7k1y7` |
| `guest08` | guest | `g8h6r5` |
| `guest09` | guest | `g9p3e4` |
| `guest10` | guest | `g0c8d2` |

`displayName`：管理员 / 体验账号 01 … 10。`id`：`user-admin-1`、`user-guest-01` … `user-guest-10`。

### 12.6 还需要确定吗？

**产品权限与数据落点：已基本齐，可以开工。**

仅剩「偏好级」非阻塞项：

| 项 | 状态 | 说明 |
|----|------|------|
| HTTPS / 域名 | 未上 | 不挡 Phase 1；上线后尽快补 |
| 登录失败锁定具体频率 | 未细定 | 工程默认（如同 IP 10 次 / 15 分钟） |
| 「配置已更新」提示文案 | 已说可以做 | 实现时：configHash 变化 toast 一次 |
| Memory「写入前需确认」对 guest | **已定：否** | **guest 强制自动写入本地、无确认页**；admin 可保留现 Lab 开关 |
| 清空旧数据 | 运维 | 你清空 conversations/memories/runs；配置与 Persona 保留 |

**产品决策已齐，可进入 Phase 1。**（HTTPS 等工程默认项不挡开工。）

---

## 13. 风险与依赖

| 风险 | 缓解 |
|------|------|
| 只藏前端入口、API 未鉴权 | Phase 1 必须 API 守卫优先 |
| IndexedDB 配额 / 隐私模式 | UI 提示；可选导出备份 |
| 改造面大（处处 `profileId`） | Phase 1–2 先钉死单 profile + 鉴权，再迁存储 |
| Guest 伪造槽位或超长上下文刷死 Key | 服务端强制 settings；限流 + 长度上限（**不做**每日轮次上限，已定） |
| 公网撞库 / 刷接口 | 登录限流；当前为 **HTTP**，尽快 HTTPS；上 HTTPS 前 Cookie 不用 Secure |
| 与现有「多模型 Lab」心智冲突 | 产品名 ZHAKA Lab；guest 列数 = admin 开放槽位数 |
| Admin 改配置 guest 无感 | 热切换 + 可选「配置已更新」提示 |

---

## 14. 附录：一句话架构图

```
[Admin] 登录 → 改配置（保存即生效）+ 可聊天 → 本地 IndexedDB
[Guest] 登录 → 聊天（下一句热切换新配置；开几槽见几列；无 Studio/Runs）→ 本地 IndexedDB
服务端：accounts.json（改完重启）+ 匿名用量日志文件 + API Key
入口现状：http://120.53.223.237:3004 （HTTP）
产品名：ZHAKA Lab（内部 Web，不与硬件打通）
```

---

## 15. 下一步

1. 产品决策已冻结（含 guest Memory 强制自动写本地）。你可再通读本文检查。  
2. 检查通过后，再开 Agent 按 Phase 1 开工（登录 + 鉴权 + 藏 guest 配置入口）。  
3. 上线前：清空服务器旧聊天/记忆文件；用 §12.5 生成 `accounts.json`；注意当前为 HTTP。
