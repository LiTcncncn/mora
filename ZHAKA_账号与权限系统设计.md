# ZHAKA 账号与权限系统设计 & 执行方案

> 状态：**设计稿，先不落地代码**  
> 日期：2026-09-09  
> 目标：把「本机 Lab + 本地测试档案」演进为「管理员配置 / 体验账号聊天」，并明确数据落点与权限边界。  
> **账号已定**：无注册；管理员与体验账号均写在服务端 `accounts.json`，登录校验该文件。

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
- 服务端永久保存每位体验用户的聊天全文（除非另开「合规审计」需求）。
- 把毛绒硬件 / ASR / TTS 的账号体系一次做完（可预留接口，本方案只管 Web Lab → 体验台）。

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

**推荐默认：一份 `published` + 可选 `draft`，不做 N 个 Profile。**

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
| 多管理员 / 多体验账号 | **允许**：文件里多条 `role: admin` 或 `guest` |
| 密码 | 文件内只存 **hash**，不存明文；初次部署用一次性脚本生成 hash 写入 |
| 禁用 | `enabled: false` 立即不可登录（下次读文件生效；可选热加载或重启后加载） |
| 种子 | 可提供 `accounts.example.json`（无真实 hash）+ `npm run accounts:hash` 类脚本帮助运维写入 |
| 与 `.env` 关系 | API Key 仍在 `.env`；**账号不放 env**（人一多难维护），统一走 `accounts.json` |

登录流程：

1. 用户打开 `/login`，输入用户名 + 密码（无「注册」入口）。  
2. 服务端读 `accounts.json`，校验 `enabled` + 密码 hash。  
3. 成功则发 **HttpOnly Secure Cookie**（session）或短期 JWT（仍建议 HttpOnly）。  
4. Session 载荷：`{ userId, username, role, exp }`。  
5. 中间件 / API：`requireAuth()` / `requireRole('admin' | 'guest')`。

**不做**：邮箱验证、找回密码、OAuth、复杂 RBAC、产品内注册。

### 4.3 浏览器本地数据与账号的对应

- IndexedDB / 本地库按登录后的 **`userId`（来自 accounts 文件）** 分库，例如 `zhaka:{env}:{userId}:…`。  
- 同一体验账号在不同浏览器 = 两套本地聊天（符合「数据在浏览器」）；不在此引入云同步。  
- 不再使用「共享口令 + 匿名 deviceId」作为主方案；若运维只配了一个 `guest`，多人共用该账号时，本地数据仍按浏览器隔离，服务端无法区分人——这是文件里只配一人时的预期限制。

### 4.4 与「配置发布」的关系

- Admin 编辑 → 写入 `draft`（可选）→ **发布** 到 `published`。
- Guest 聊天永远绑定 `published` 的 `configHash`；若 admin 中途发布，需定义：
  - **热切换**（下一轮起用新配置），或
  - **会话锁定**（本会话沿用进入时的 hash，直到新开对话）。

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

- Admin 在 settings 中：
  - 启用 Kimi / DeepSeek 等槽位；
  - **模式**：`single`（只跑默认槽）| `compare`（并行启用槽）。
- Guest：
  - UI 不展示开关；
  - 若 `single`：只显示一路；
  - 若 `compare`：是否给体验者看双列，需产品决定（见开放问题 Q5）。

服务端在 `/api/chat` 内根据 published settings **强制**槽位集合，忽略客户端篡改的 `enabledSlots`。

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

### Phase 0 — 决策冻结（0.5–1 天）

- 答完本文 §12 开放问题。  
- 确认：单 published vs draft+published；双模型是否对 guest 可见。  
- **账号模型已定**：无注册；`accounts.json` 维护 admin + guest。

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

约 **2–3 周**（1 人，含联调与文档）；若跳过 draft、账号文件只配 1 admin + 1 guest、暂缓 Memory 抽取改造，可压到约 **1–1.5 周** 出可用体验台。

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

## 12. 开放问题（请拍板）

### 账号与访问（部分已定）

- **已定**：无注册；管理员与体验账号均写在服务端 `accounts.json`；登录校验该文件；不在 Web 内做账号注册/管理。  
- **已定**：**管理员当然可以自己聊天、自己体验**；其聊天/Memory 与体验账号一样落在浏览器本地（按 `userId` 分库）。  
1. 首发 `accounts.json` 是否只配 1 个 admin + 1 个 guest 即可？（文件内允许多名）  
2. ~~管理员是否允许配置 + 闲聊 / 聊天是否存本地~~ → **已定：允许；存本地**。  
3. 部署形态是 **公网可访问** 还是 **仅内网/VPN**？影响 Cookie Secure、HTTPS、撞库防护强度。  
4. `accounts.json` 变更后要否 **热加载**，还是改完重启/发信号再读？

### 配置生命周期

5. 是否需要 **draft / published** 两套，还是改完即生效？  
6. Admin 发布新配置时：体验中会话 **热切换** 还是 **锁定到开聊时的 configHash**？  
7. 双模型 compare：**体验账号是否看到两列？** 还是后台仍可 compare 但前台只露出主模型？

### 数据与合规

8. 聊天与 Memory **仅浏览器**：清缓存即丢失，是否可接受？要不要「导出我的聊天」？  
9. 是否需要服务端保留 **匿名用量日志**（次数、token、错误率）而不存原文？  
10. Memory 抽取是否继续每轮打 LLM？费用归属与失败时本地策略？  
11. 现有 Lab 的 `data/` 对话/记忆：**迁移到浏览器 / 放弃 / 仅 admin 可下载归档**？

### 产品边界

12. 本方案是否覆盖 **云端已部署的 `/www/wwwroot/mora`** 与本地开发两套同一套权限模型？  
13. Runs / Prompt Studio / Context Inspector：体验账号是 **完全不可见**，还是保留只读「为什么失败」？  
14. 未来硬件端账号是否与本 Web 账号打通？若否，本方案是否声明「仅 Web 体验台」？

### 命名与文案

15. 产品对外仍叫 **ZHAKA Lab**，还是拆成 **ZHAKA Admin** + **ZHAKA 体验**？  
16. 「本地测试档案」下线后，策划手册 / README 是否同步开一版「账号权限」章节（建议是）？

---

## 13. 风险与依赖

| 风险 | 缓解 |
|------|------|
| 只藏前端入口、API 未鉴权 | Phase 1 必须 API 守卫优先 |
| IndexedDB 配额 / 隐私模式 | UI 提示；可选导出备份 |
| 改造面大（处处 `profileId`） | Phase 1–2 先钉死单 profile + 鉴权，再迁存储 |
| Guest 伪造槽位或超长上下文刷死 Key | 服务端强制 settings；限流 + 长度上限 |
| 与现有「多模型 Lab」心智冲突 | 文档明确：Lab 能力收进 Admin，体验台默认单聊 |

---

## 14. 附录：一句话架构图

```
[Admin 浏览器] --登录--> 改 published/draft 配置（服务端 JSON）
                      \------> 聊天体验（与 guest 同等能力）→ 本地 IndexedDB（按 admin userId）

[Guest 浏览器] --登录--> 只读 published 配置 + 调 /api/chat（服务端持 Key）
                      \------> 聊天与 Memory 只写本机 IndexedDB（按 guest userId）

「本地测试档案」不再承担用户隔离；
用户身份 = accounts.json 中的账号；聊天/Memory 隔离 = 该账号在浏览器本地的库。
管理员与体验账号都可以聊；差别只在配置权限。
```

---

## 15. 下一步

1. 产品 / 你方回复 §12 剩余问题（尤其 **Q5、Q7、Q8**；**无注册、accounts 文件、管理员可聊天体验** 已定）。  
2. 冻结范围后，再开 Agent 按 Phase 1 → 4 执行。  
3. **本文档确认前不改代码。**
