# ZHAKA Lab MiniMax 实时语音方案

> 状态：首版已实现（localhost），待填入 MiniMax API Key 后实测  
> 日期：2026-09-27  
> 范围：MiniMax ASR + MiniMax TTS；聊天模型继续使用现有 Kimi / DeepSeek，不增加 MiniMax 聊天模型

---

## 0. 首版实际实现（与下文设计的差异以本节为准）

下文第 3–5、11–12 节描述的是“独立 WebSocket 网关 + 服务端 VAD”的设计。首版落地时做了简化，体验目标不变：

| 项目 | 设计稿 | 首版实现 |
|---|---|---|
| 传输 | 浏览器 ↔ WebSocket 网关 | 每句话一次 `POST /api/voice/turn`（multipart：`meta` JSON + `audio` WAV），响应为 NDJSON 流 |
| VAD / 断句 | 服务端 | 浏览器能量 VAD（`src/lib/voice/vad.ts`），静音 1.2s 自动结束一句，用户无需点“说完了” |
| ASR | 同步接口 | `POST {MINIMAX_BASE_URL}/v1/speech_to_text`，`asr-1.0`，16kHz 单声道 WAV |
| TTS | WebSocket | HTTP 流式 `POST /v1/t2a_v2`（`stream:true`），PCM 32kHz，按句边生成边播放 |
| 配置 | 多个 URL | 仅 `MINIMAX_API_KEY`（必填）+ `MINIMAX_BASE_URL` / `MINIMAX_ASR_MODEL` / `MINIMAX_TTS_MODEL`（有默认值） |

NDJSON 事件：`empty` / `transcript` / `text` / `audio`（base64 PCM16）/ `error`（含 `stage`: asr·chat·tts）/ `done`。

主要代码：

- `src/server/orchestration/voice-turn.ts`：`runVoiceTurn`，与传输无关；复用文字聊天的上下文、行为配置、Run 记录与记忆提取。
- `src/server/speech/minimax.ts`：ASR 与流式 TTS 客户端；`sentence-segmenter.ts`：回复断句。
- `src/server/adapters/openai-stream.ts`：Kimi / DeepSeek 流式输出。
- `src/app/api/voice/turn/route.ts`：鉴权、WAV 校验（≤3MB）、NDJSON 输出。
- `src/components/voice/*`、`src/lib/voice/*`：会话状态机、麦克风采集、PCM 播放。

ESP32 接入时，新增一个 WebSocket 网关包一层 `runVoiceTurn` 即可，上行 16kHz PCM16、下行 32kHz PCM16 的格式已对齐。

---

## 1. 目标与产品定义

ZHAKA Lab 增加一个真正的实时语音会话入口。用户进入语音模式后，直接说话，ZHAKA 自动理解并开口回复；产品不向用户呈现“录音 → 上传 → 转文字”的工具式流程。

用户感知到的流程应是：

```text
点击一次“开始语音对话”
        ↓
直接说话
        ↓
ZHAKA 自动判断用户说完
        ↓
短暂思考后开始说话
        ↓
ZHAKA 说完后自动恢复聆听
        ↓
继续下一轮
```

内部仍然是“语音 → 文本 → 陪伴大脑 → 文本 → 语音”，原因是现有安全、行为计划、世界观、记忆和 Run 回放都以文本为中心。转换过程在后台实时完成，不作为前台操作步骤展示。

本方案明确不做：

- 不把 MiniMax 加入聊天模型槽位；
- 不把一段录音录完后再作为文件让用户手动上传；
- 不让浏览器直接持有 MiniMax API Key；
- 不让语音通道绕过现有安全和陪伴行为引擎；
- 不默认长期保存原始录音。

---

## 2. 目标体验

### 2.1 聊天区入口

在现有文字输入区增加“语音对话”按钮。点击后进入持续语音会话，而不是只录一条语音消息。

界面只显示必要状态：

- 正在连接
- 正在听
- 正在想
- ZHAKA 正在说
- 已暂停 / 连接失败

ASR 的最终文本作为普通“我：……”消息进入当前对话；ZHAKA 的文本回复照常显示并自动播报。可以选择不显示 ASR 临时转写，避免文字不断跳动干扰用户。

### 2.2 自动轮转

语音模式开启后：

1. 浏览器持续采集麦克风；
2. 流式音频发送到 ZHAKA 实时语音网关；
3. 网关转发给 MiniMax ASR；
4. ASR/VAD 判断一句话结束；
5. 最终转写立即进入现有 `prepareSharedTurnContext()`；
6. Kimi 或 DeepSeek 生成文字；
7. 回复按语义短句送入 MiniMax TTS；
8. 浏览器边收音频边播放；
9. 播放结束后自动回到监听状态。

用户不需要再按“发送”。

### 2.3 首版轮转边界

首版不实现用户开口打断 ZHAKA。ZHAKA 播放期间暂停 ASR 收音，播放结束后自动恢复监听。用户仍可点击“停止语音会话”立即停止播放并关闭本次会话。

这能先稳定 ASR、陪伴管线与 TTS 的完整闭环，并避免扬声器声音被误识别为用户输入。后续接入硬件时再增加 barge-in；届时需要全链路取消、回声消除与迟到音频隔离。

浏览器采集仍应启用：

```text
echoCancellation: true
noiseSuppression: true
autoGainControl: true
```

同时需要 VAD 阈值、最短发声时间和静音结束时长。MiniMax ASR 当前公开接口不负责接收实时麦克风流并判停，因此端点检测由 ZHAKA 实时网关完成，不提供“说完了”按钮。

---

## 3. 总体架构

```text
┌────────────────── 浏览器 / ZHAKA Lab ──────────────────┐
│ 麦克风 → AudioWorklet → PCM 音频帧 → WebSocket          │
│ 扬声器 ← AudioWorklet/AudioContext ← TTS 音频帧          │
│ UI 状态：听 / 想 / 说 / 暂停                             │
└────────────────────────┬────────────────────────────────┘
                         │ 同一条实时会话连接
                         ▼
┌──────────────── ZHAKA Realtime Gateway ─────────────────┐
│ 登录态校验 · session/turn 状态机 · VAD · 缓冲与重连        │
│                                                         │
│ 音频上行 → VAD 判停 → WAV 封装 → MiniMax ASR HTTP/SSE    │
│                                      ↓                  │
│              Safety → Router → TurnPlan → Context       │
│                                      ↓                  │
│                    Kimi / DeepSeek 流式文本               │
│                                      ↓                  │
│                 断句器 → MiniMax TTS WebSocket           │
│                                      ↓                  │
│                           音频帧下行                      │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌────────────────── 数据与可观测性 ────────────────────────┐
│ 文本输入 · 文本输出 · 模型 · 延迟 · 失败 · 中断原因        │
│ 默认不保存原始麦克风音频和 TTS 音频                       │
└─────────────────────────────────────────────────────────┘
```

### 3.1 为什么需要独立实时网关

现有应用是 Next.js 请求/响应模式，`/api/compare` 会等待模型完整返回；Kimi 和 DeepSeek adapter 当前也固定 `stream: false`。自然语音需要一条长连接同时承载：

- 连续音频上行；
- 语音端点检测和 ASR 最终结果；
- 状态事件；
- TTS 音频下行；
- 心跳和断线恢复。

因此建议新增一个与 Next.js 同仓库、同部署环境运行的 Node.js WebSocket 服务，而不是把实时状态强塞进普通 Route Handler。Next.js 继续负责页面、配置、鉴权和普通 API；Realtime Gateway 负责长连接。

生产环境由 Nginx/Caddy 统一提供 HTTPS/WSS，并将：

```text
/               → Next.js
/realtime       → Realtime Gateway
```

当前公网 HTTP 入口不能用于正式浏览器麦克风方案。除 `localhost` 外，`getUserMedia()` 需要安全上下文；实施实时语音前必须具备域名和 HTTPS。

---

## 4. 实时会话状态机

服务端每个会话保持以下状态：

```text
idle
  → connecting
  → listening
  → finalizing_asr
  → thinking
  → speaking
  → listening

任意状态 → failed / closed
```

每一轮有独立 `turnId`。会话关闭后，旧轮迟到的模型文本和 TTS 音频必须丢弃，不能串入下一次会话。

建议协议事件：

### 浏览器 → 网关

```text
session.start
audio.chunk
session.pause
session.resume
session.close
heartbeat
```

### 网关 → 浏览器

```text
session.ready
asr.partial
asr.final
assistant.text.delta
assistant.text.final
tts.audio
turn.completed
error
heartbeat.ack
```

控制消息使用 JSON；音频帧使用 WebSocket binary frame，避免 Base64 增加约 33% 体积。所有事件包含 `sessionId`、`turnId` 和递增序号。

---

## 5. 音频采集与播放

### 5.1 浏览器采集

不使用 `MediaRecorder` 作为主链路，因为它偏向生成一段完整录音文件，分片时延和编码格式受浏览器影响。实时方案使用 Web Audio API：

- `getUserMedia()` 获取麦克风；
- `AudioWorklet` 获取连续采样；
- 重采样为 MiniMax ASR 要求的采样率；
- 转换为单声道 PCM16；
- 每 20–40ms 发送一帧；
- 客户端只保留短环形缓冲，不生成可下载录音文件。

上行统一为单声道 16kHz PCM16，Gateway 在一句话结束后补 WAV 容器头再调用 MiniMax ASR。这一格式也方便后续 ESP32 复用。

### 5.2 浏览器播放

服务端将 MiniMax TTS 返回的音频帧立即转发到浏览器。优先选择低解码成本、可连续拼接的 PCM；如果 MiniMax 实时接口只支持压缩格式，则根据其分片边界选择 WebCodecs 或 MediaSource。

播放端要求：

- 小型抖动缓冲，兼顾卡顿和首响；
- 新 turn 开始时清空旧音频；
- 停止语音会话时立即停止并清空音频；
- 页面不可见或系统暂停后能够恢复；
- 同一时间只允许一个回复音轨播放。

---

## 6. ASR：MiniMax 国内接口

已确认国内平台提供 MiniMax ASR：

```text
POST https://api.minimax.cn/v1/speech_to_text
Authorization: Bearer <API Key>
Content-Type: multipart/form-data
model: asr-1.0
file: wav / aiff / flac / m4a / mp3 / aac / opus / ogg
stream: true | false
```

官方指南：<https://platform.minimax.cn/docs/guides/speech-to-text>

需要准确理解官方文档中的“流式返回”：它表示完整音频文件上传完成后，识别文本通过 SSE 增量返回；该接口不接受 WebSocket 麦克风音频流，也不接受无容器裸 PCM。因此它不是严格意义上的实时流式 ASR。

为了维持“用户直接说、产品直接答”的体验，内部链路改为：

```text
浏览器持续发送短 PCM 帧
        ↓
ZHAKA Gateway 缓冲并进行 VAD
        ↓
检测到连续静音，判定本轮结束
        ↓
Gateway 将本轮 PCM 封装为单声道 16kHz WAV
        ↓
隐藏地调用 MiniMax /v1/speech_to_text
        ↓
得到最终文本后立即进入陪伴大脑
```

用户界面不会出现录音文件、上传按钮、上传进度或手动转写步骤；但技术上 MiniMax 当前接口仍要求每一轮以完整音频文件调用。该事实不能在架构上写成不存在的 MiniMax ASR WebSocket。

API Key 只存在服务端环境变量中。网关负责：

- 连续接收浏览器或未来硬件的音频帧；
- VAD、静音收口和最大单轮时长；
- 将 PCM 封装为符合接口要求的 WAV；
- 调用 MiniMax ASR 并处理 SSE/最终文本；
- 超时、重试、供应商错误映射；
- 过滤空转写和极短噪声；
- 记录 ASR 延迟、`trace_id` 和最终文本；
- 把最终文本交给现有文字陪伴管线。

Phase 0 必须先实测短语音的“停止说话到 final 文本”延迟。如果文件式 ASR 无法达到自然对话要求，MiniMax 当前公开接口本身会成为瓶颈，需要与 MiniMax 商务确认是否另有实时音频流 ASR。

---

## 7. 聊天模型：保持 Kimi / DeepSeek

聊天模型类型和管理员配置不变，仍然只使用：

- Kimi
- DeepSeek

现有以下能力原样保留：

- Safety；
- Router；
- Energy；
- TurnPlan；
- 世界观调度；
- Memory 选择与抽取；
- Persona / Prompt Preset；
- BehaviorTrace；
- Run 记录。

### 7.1 必须增加流式生成能力

当前 Kimi / DeepSeek adapter 使用完整响应模式，无法尽早启动 TTS。需要在保留现有 `complete()` 的同时增加：

```ts
stream(request, signal): AsyncIterable<ModelStreamEvent>
```

事件至少包含：

```text
text.delta
usage
completed
failed
```

`/api/compare` 可以继续走原有完整响应，避免影响现有 Lab 对比功能；实时语音网关调用新流式接口。

### 7.2 回复断句

不能每个 token 调一次 TTS，也不能等完整回复生成完再合成。增加一个中文语义断句器：

- 遇到 `。！？；` 优先提交；
- 逗号处达到一定长度可提前提交；
- 首段采用更短阈值，降低首响；
- 括号内舞台动作和内部计划不能进入 TTS；
- turn 完成时冲刷剩余文本。

第一段开始 TTS 后，聊天模型继续生成后续段落，实现流水线：

```text
LLM 生成第 1 句 → TTS 第 1 句 → 开始播放
LLM 生成第 2 句 → TTS 第 2 句 → 排队播放
```

---

## 8. TTS：MiniMax 接入

自然对话主链路采用 MiniMax WebSocket TTS，不采用长文本异步接口。

建议初始选择：

- 模型：`speech-2.8-turbo`，优先低延迟；
- 对照：`speech-2.8-hd`，用于音质评测；
- 语言：中文 / auto；
- 声音：界面可选择 `Chinese (Mandarin)_Warm_Girl`、`Chinese (Mandarin)_ExplorativeGirl`、`Chinese (Mandarin)_Cute_Spirit`；
- 输出：优先单声道 PCM，具体参数按官方实时接口能力确定。

国内 WebSocket TTS 地址已确认：

```text
wss://api.minimax.cn/ws/v1/t2a_v2
```

每次开启语音会话前，用户同时选择聊天模型和 TTS 音色；会话进行中固定，结束后可重新选择。首版使用 `speech-2.8-turbo`。

网关负责：

- 维护 MiniMax TTS 连接；
- 顺序提交断好的文本；
- 将音频增量转发给浏览器；
- 记录首音频延迟、总合成耗时和错误；
- 用户关闭语音会话时终止任务并丢弃未播放音频；
- 对 TTS 输入执行 `sanitizeForSpeech()`；
- 绝不朗读内部计划、模型思考、错误堆栈和配置内容。

语音内容和页面展示正文必须来自同一份最终 assistant 文本。为了尽早播放而提交给 TTS 的句子，在模型输出完成后仍应合并成一条正常的 assistant 消息。

---

## 9. 单模型与双模型的产品冲突

现有 Lab 可以同时启用 Kimi 和 DeepSeek，并在同一轮展示两列结果；自然语音场景不能同时让两个 ZHAKA 开口。

已确认规则：

- 文字模式维持现有多模型对比；
- 语音模式只使用一个“语音主模型”；
- 每次开启语音会话前，用户从当前已启用的 Kimi / DeepSeek 槽位中选择一个；
- 另一个槽位不在该语音轮调用，避免额外延迟、成本和两种答案冲突；
- 会话中不生成未选模型的隐藏结果；
- 若只启用一个槽位则直接使用，无需额外选择。

---

## 10. 文本日志、对话与隐私

现有系统并不是对所有用户都在服务端保存文本：

- admin：`/api/compare` 会把对话和 Run 写入服务端 JSON，其中包含文本输入、文本输出和上下文快照；
- guest：`clientPersist=true`，聊天正文和记忆只保存在浏览器；服务端不写 Conversation/Run；
- `usage.jsonl`：只是匿名用量日志，明确不含聊天原文。

因此，“后台日志记录文本输入和文本输出”对 admin 已基本存在，对 guest 是一项新的服务端数据留存策略，不是直接复用现状。语音模式若要统一记录 admin 与 guest，建议新增服务端语音 turn 日志，而不是保存音频：

```text
voice-turns.jsonl
```

每条记录建议包含：

```text
timestamp
userId
sessionId
turnId
conversationId
inputText
outputText
chatProvider
chatModelId
asrModelId
ttsModelId
configHash
asrFinalLatencyMs
llmFirstTokenLatencyMs
ttsFirstAudioLatencyMs
endToEndFirstAudioLatencyMs
interrupted
status
errorCode
```

默认不记录：

- 原始麦克风音频；
- TTS 音频；
- MiniMax API Key；
- Cookie / session token；
- 完整供应商原始响应；
- 前端设备敏感信息。

需要注意：现有 guest 页面明确提示聊天保存在本机浏览器。若新增包含原文的服务端日志，这一提示就不再完整，必须同步说明用途、访问权限、保留期限和删除规则。若你只要求现有聊天记录可回放，则也可以保持：admin 服务端存、guest 浏览器存，不另建原文日志。

紧急安全场景仍记录最终文本和安全路由结果，但应限制日志访问权限。

---

## 11. 预计代码结构

建议新增：

```text
src/realtime/
  server.ts
  protocol.ts
  session-manager.ts
  turn-controller.ts
  sentence-segmenter.ts

src/server/speech/
  minimax-asr.ts
  minimax-tts.ts
  audio-format.ts
  voice-turn-log.ts

src/components/voice/
  voice-session-button.tsx
  voice-status.tsx

src/lib/voice/
  realtime-client.ts
  microphone-worklet.ts
  playback-worklet.ts

src/server/adapters/
  types.ts                 # 增加流式接口
  kimi.ts                  # 实现 stream
  deepseek.ts              # 实现 stream
```

预计修改：

```text
src/components/compare/compare-view.tsx
src/server/orchestration/compare.ts
src/server/orchestration/prepare-turn.ts
src/server/config/env.ts
src/domain/settings.ts
src/lib/local-chat-store.ts
.env.example
README.md
package.json
```

具体文件可能在接口验证后调整。

---

## 12. 配置与密钥

建议环境变量：

```env
MINIMAX_API_KEY=
MINIMAX_ASR_BASE_URL=https://api.minimax.cn
MINIMAX_ASR_MODEL=asr-1.0
MINIMAX_TTS_BASE_URL=wss://api.minimax.cn/ws/v1/t2a_v2
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE_IDS=Chinese (Mandarin)_Warm_Girl,Chinese (Mandarin)_ExplorativeGirl,Chinese (Mandarin)_Cute_Spirit
REALTIME_PUBLIC_URL=wss://你的域名/realtime
VOICE_LOG_RETENTION_DAYS=
```

不要把真实 Key 写入 Markdown、代码、前端设置、导出配置或提交到 Git。实施时由你写入本机 `.env.local` 和服务器环境变量。

管理员设置页可以配置非敏感项：

- 是否开放语音模式；
- MiniMax TTS model；
- 可选 voice ID 白名单；
- 语速、音量、音调；
- VAD 静音结束时长（首版 `1.2s`）；
- 是否显示临时转写；
- 最大单轮说话时长（首版 `60s`）。

---

## 13. 延迟目标

实验阶段建议记录并展示以下指标：

```text
用户停嘴 → ASR final：          Phase 0 实测后冻结（文件式 ASR）
ASR final → LLM 首 token：      P50 ≤ 800ms
首句形成 → TTS 首音频：         P50 ≤ 500ms
用户停嘴 → 听到 ZHAKA：         P50 ≤ 2.0s，P95 ≤ 3.5s
```

以上是产品目标，不是对供应商能力的承诺。需在拿到真实 MiniMax ASR/TTS 账号后做延迟基准测试再冻结。

---

## 14. 实施阶段

### Phase 0：接口和部署验证

1. 核对 MiniMax ASR/TTS 账号权限；
2. 用最小脚本验证短 WAV ASR、SSE/final 结果和 TTS 首包；
3. 确认音频格式、模型、voice ID、区域 endpoint；
4. 准备域名、HTTPS 和 WSS 反向代理；
5. 实测供应商延迟。

退出条件：可以完成“实时说一句 → 得到 final 文本”和“发一句文本 → 边收边播放音频”。

### Phase 1：浏览器实时音频底座

1. 麦克风权限和 AudioWorklet；
2. PCM 重采样与分帧；
3. Realtime Gateway；
4. 音频下行队列和播放；
5. 会话状态、心跳、暂停和重连。

### Phase 2：接入陪伴大脑

1. ASR final 进入现有 `prepareSharedTurnContext()`；
2. Kimi / DeepSeek 增加流式 adapter；
3. 语义断句；
4. MiniMax 流式 TTS；
5. 最终文本写入现有对话；
6. 服务端文本日志。

### Phase 3：自然对话能力

1. VAD 自动收口；
2. turn 级状态与迟到帧隔离；
3. 回声误触发调优；
4. 弱网、切后台和设备切换；
5. 延迟仪表和错误诊断；
6. 播放中打断列为后续版本，不进入首版验收。

### Phase 4：回归与上线

1. Safety / Memory / 世界观行为回归；
2. ASR 错词、空话、连续说话测试；
3. Chrome、Safari 和移动端测试；
4. 连接数、并发和成本测试；
5. 隐私提示、保留期限和删除流程；
6. 生产 HTTPS/WSS 与密钥检查。

---

## 15. 验收标准

- 用户只需开启一次语音模式，之后可连续对话；
- 前台不出现录音文件、上传进度或手动转写步骤；
- 用户停顿后自动形成一轮并得到回复；
- ASR 最终文本以普通用户消息进入聊天记录；
- 语音和文字输入使用同一套 Safety、TurnPlan、Memory 和 Persona；
- Kimi / DeepSeek 仍由现有管理员配置决定；
- ZHAKA 回复文本显示并自动播报；
- ZHAKA 播放期间不把自身声音识别成下一轮用户输入；
- 用户关闭语音会话后立即停止播放；
- 按最终确认的 11–15 留存口径记录文本与关键延迟；
- 默认不保存原始输入音频和合成音频；
- MiniMax API Key 永不进入浏览器；
- 开启会话前可选择一个已启用的 Kimi / DeepSeek 槽位和一个指定音色；
- 未选择的聊天模型不调用；
- 公网环境使用 HTTPS/WSS。

---

## 16. 已确认决策与剩余问题

### 16.1 已确认

1. 使用 MiniMax 国内平台。  
2. ASR 使用国内 `asr-1.0` 文件式接口；先进行短语音延迟实测。  
3. 界面可选三种音色：`Chinese (Mandarin)_Warm_Girl`、`Chinese (Mandarin)_ExplorativeGirl`、`Chinese (Mandarin)_Cute_Spirit`。  
4. TTS 首版使用 `speech-2.8-turbo`。  
5. 点击一次开启连续语音对话，再次点击关闭。  
6. 首版不实现用户开口打断。  
7. 隐藏 ASR 临时结果，只把最终文本显示为普通用户消息。  
8. 自动 VAD 收口，不提供“说完了”按钮。  
9. 每次开启语音会话前选择一个已启用的 Kimi / DeepSeek 槽位。  
10. 不调用未选择的聊天模型。  
11–15. 采用 A：保持现有文本留存口径。admin 文本写服务端 Conversation/Run；guest 文本只存浏览器；不新增包含原文的 `voice-turns.jsonl`；原始音频和 TTS 音频均不保存；性能指标写入不含正文的匿名日志。  
16. 当前没有 HTTPS。  
17. 首版先在开发机 `localhost` 验证；HTTPS 与跨设备浏览器测试后续配置。ASR 不指定 `language`，允许中英混合识别。TTS 下行首选 32kHz 单声道 PCM，为后续 ESP32 复用。  
18. 很快接入硬件，因此协议和网关从首版起为硬件复用预留。  

### 16.2 仍需确认

16. 没有 HTTPS 时：

- `localhost` 开发可以使用麦克风；
- 其他手机或 PC 通过当前 HTTP IP 打开时，主流浏览器通常不会开放 `getUserMedia()`；
- WSS 也需要 HTTPS 站点和有效证书。

单纯在浏览器弹窗中点击“允许麦克风”不能绕过安全上下文限制。少量内测有四种可选方式：

1. **仅开发机本地测试**：在运行服务的 Mac 上用 `http://localhost:3000`，无需 HTTPS；最简单，但其他手机和 PC 无法参与。
2. **私有 HTTPS 网络（推荐少量内测）**：使用 Tailscale 等私有网络为测试者提供受信任的 HTTPS 地址；测试者需安装并加入同一私有网络，手机和 PC 均可测试，不向公网开放。
3. **临时 HTTPS Tunnel**：使用 Cloudflare Tunnel 等服务给当前应用提供 HTTPS 地址；接入快，但依赖第三方隧道和网络可达性。
4. **浏览器测试开关**：桌面 Chrome/Edge 可在每台测试机上把指定 HTTP origin 临时视为安全来源；只适合工程调试，不适合普通测试者，也不能可靠覆盖 iPhone Safari。仅修改站点麦克风权限不够。

自签名证书只有在每台设备都安装并信任根证书后才可靠，维护成本通常高于私有 HTTPS 网络。

已确认首版只在开发机 `localhost` 测试。域名、HTTPS/WSS 与手机/其他 PC 的跨设备测试留到后续部署阶段；在此之前不承诺通过当前 HTTP IP 使用麦克风。

17. “任何有麦克风的设备”无法做绝对保证。建议首版承诺以下现代浏览器：

- macOS：Chrome、Safari；
- Windows：Chrome、Edge；
- iPhone/iPad：Safari；
- Android：Chrome。

微信内置浏览器、老旧浏览器、被企业策略禁用麦克风的设备不列入首版保证范围。所有非 localhost 设备都要求 HTTPS。请确认是否接受该支持范围。

18. 硬件复用方式：

- 现在就定义与终端无关的 `session/turn/audio/status` 协议；
- 浏览器和未来 ESP32 都向同一个 Realtime Gateway 发送标准音频帧；
- Gateway 统一负责 VAD、WAV 封装、MiniMax ASR、陪伴大脑和 MiniMax TTS；
- 浏览器使用登录 Cookie，ESP32 后续增加独立 `deviceId + device credential`，不能复制浏览器 Cookie；
- 首版确定单声道 16kHz PCM16 上行，使 ESP32 的 INMP441 容易接入；
- 首版下行采用 32kHz 单声道 PCM，使 ESP32 可直接送入 I²S/MAX98357A；正式固件前再根据弱网带宽决定是否增加 Opus。

结论：当前 Lab 可以把实时网关做成未来硬件的云端语音入口，但“设备配网、设备鉴权、OTA、断网重连和硬件音频驱动”仍是后续硬件工程，不应混入本次网页首版。

