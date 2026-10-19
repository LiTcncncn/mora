# ZHAKA Lab ESP32 硬件语音方案

> 状态：首版已接入。网关、Lab 绑定和 `badgedemo` 固件已落地；板上已连上 `zhaka.local`，未绑定前不拾音  
> 日期：2026-09-30  
> 范围：经典 ESP32-WROOM-32（Good Display ESP32-L）+ INMP441 + MAX98357A + DRV2605L/LRA，接入现有 ZHAKA Lab 语音回合

---

## 1. 目标

上电后的开发板能和 ZHAKA Lab 做连续语音对话：用户说话，产品直接开口回复。人格、安全、记忆、模型选择继续走现有陪伴引擎，不在固件里重写一套。

震动只做一件事：陪伴引擎判定本轮用户能量为 **E0** 时，LRA 震动 2 秒。E1、E2、E3 不震动。

本方案不做：打断、配网 App、OTA、一机一密、原始录音落盘。

---

## 2. 已确认决策

| # | 结论 |
|---|---|
| 1 | E0 指陪伴引擎对本轮的能量判定（`E0`–`E3` 中的崩溃档），不是麦克风响度 |
| 2 | 判定为 E0 后、第一句开声时震 2 秒，每轮只震一次；连续两轮都是 E0 则各震一次 |
| 3 | 硬件接法见第 4 节。马达不由 GPIO 或 ESP32 PWM 直接驱动 |
| 4 | 在现有 PlatformIO + Arduino 工程上改，不从零写固件。芯片是经典 ESP32-WROOM-32，开发板 Good Display ESP32-L |
| 5 | ESP32 与这台 Mac 使用同一个 Wi-Fi。网关跑在这台 Mac 上。Wi-Fi 稍后由使用者同步 |
| 6 | 模型、声音、对话在 Lab 页面绑定，不写死在固件里 |
| 7 | 没有按键唤醒。上电只连接网关；管理员绑定后才开始听 |
| 8 | 首版单一 `DEVICE_TOKEN`，分别放在设备配置和 `.env.local` |
| 9 | 设备持续上传 20ms 帧，网关用现有 VAD：静音约 1.2 秒结束一句，单轮最长 60 秒 |
| 10 | 硬件回合记在管理员账号下，写入页面绑定时选中的那条 Conversation |
| 11 | 未绑定：保持连接，不上传、不识别。绑定后开始听，解除绑定后回到静默 |
| 12 | 页面上改模型、声音或对话后，下一句即生效，不用重启板子 |
| 13 | 只有管理员能绑定。访客对话留在浏览器，硬件不写 |
| 14 | 板子通过 mDNS 连接 `zhaka.local`，不写死局域网 IP |
| 15 | 设备已绑定且在线时，Lab 页面的「开始语音对话」禁用 |
| 16 | 固件工程：`/Users/lit/Documents/PlatformIO/Projects/badgedemo`。配置是该目录下的 `platformio.ini`，程序是 `src/main.cpp` |

---

## 3. 链路

浏览器语音已经落地：每句话 `POST /api/voice/turn`，NDJSON 里是 base64 PCM。ESP32 不走这条接口。那条接口要 Cookie、WAV 表单和 base64，经典 ESP32 的内存和解析成本都偏高。Next.js 路由也不能把 HTTP 升级成 WebSocket。

硬件走同机上的独立 WebSocket 网关，核心仍调用 `runVoiceTurn`。

```text
INMP441  16kHz I2S（32-bit 左声道）
        │  固件取高 16 位，变成 PCM16
        ▼
ESP32-WROOM-32
        │  ws://zhaka.local:<端口>
        ▼
设备网关（Node，与 ZHAKA Lab 同机）
  断句 → 16kHz 单声道 WAV → runVoiceTurn
        │
        ├─ MiniMax ASR
        ├─ 陪伴引擎（此处得到 E0–E3）
        ├─ 本轮选中的 Kimi 或 DeepSeek（另一个不调用）
        └─ MiniMax TTS：32kHz 单声道 PCM16
        │
        ├─ 网关降到 16kHz PCM16 → ESP32 → MAX98357A（左右声道复制）
        └─ 若 energy == E0 → haptic 2000ms → DRV2605L → LRA
```

能量在 ASR 和 `prepareSharedTurnContext` 之后就已确定，不必等整段回复生成完。震动与第一句播报并行。

ZHAKA 说话时固件暂停上传麦克风，避免喇叭回灌。说完再恢复收音。

文本日志与网页管理员语音相同：写入 Conversation / Run。不存原始音频。用量仍进匿名 `usage.jsonl`。

---

## 4. 已确认硬件

固件不在本仓库，而在：

```text
/Users/lit/Documents/PlatformIO/Projects/badgedemo
├── platformio.ini
└── src/main.cpp
```

`platformio.ini` 已是约定环境，并依赖 `adafruit/Adafruit DRV2605 Library`：

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    adafruit/Adafruit DRV2605 Library
```

使用者已分别验证过：I2C 能扫到 `0x5A`、LRA 能震、INMP441 能采集、MAX98357A 能出声。当前磁盘上的 `src/main.cpp` 只保留了停马达程序：`Wire.begin(21, 22)`，找到 DRV2605L 后 `setRealtimeValue(0)` 并 `stop()`。麦和喇叭的测试代码不在这个文件里，整合时按第 4 节接线重接 I2S，震动则沿用这份已能找到芯片的 I2C 初始化。2 秒震动直接用库里的 `setRealtimeValue()`。

### 4.1 震动：DRV2605L + 1040 LRA

| 信号 | 连接 |
|---|---|
| VIN | 3V3 |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |
| IN | 不接 |
| I2C 地址 | `0x5A` |
| LRA motor+ / motor- | 马达正负极 |

ESP32 只通过 I2C 写 DRV2605L。2 秒震动用 RTP：`setRealtimeValue()` 写入非零幅度，保持 2000ms，再写 0。不用库里的固定音效时长，也不去拉 IN 脚。

### 4.2 麦克风：INMP441

| 信号 | 连接 |
|---|---|
| VDD | 3V3 |
| GND | GND |
| SCK/BCLK | GPIO25 |
| WS/LRCLK | GPIO26 |
| SD | GPIO34 |
| L/R | GND（左声道） |

I2S RX：16000 Hz，32-bit slot，只取左声道。固件把每个样本收成 16-bit PCM 再上行。采样率已经是 16kHz，上行不再重采样。

### 4.3 喇叭：MAX98357A + 4Ω 3W

| 信号 | 连接 |
|---|---|
| VIN | 5V |
| GND | GND |
| BCLK | GPIO32 |
| LRC/WS | GPIO33 |
| DIN | GPIO27 |
| SD、GAIN | 暂不接 |

I2S TX：16000 Hz，16-bit，立体声。左右声道写入同一段 mono PCM。

Lab 的 TTS 输出是 32kHz 单声道 PCM16。降到 16kHz 放在网关，不放在 ESP32。固件只做声道复制和 I2S 写出。

麦和喇叭使用各自的 BCLK/WS，分别占用两路 I2S（RX 与 TX），不共用时钟。

---

## 5. 线上格式

二进制 WebSocket，不传 base64。

设备 → 网关：

- 连接鉴权：只带 `DEVICE_TOKEN`。模型、声音、对话不在固件里
- 音频：20ms 一帧，16kHz 单声道 PCM16（640 字节）

网关 → 设备：

- 绑定状态：未绑定 / 已绑定（含当前模型与声音，仅供串口日志）
- 状态：听 / 想 / 说 / 错误
- 转写文本与回复文本（调试用，喇叭不读字）
- 音频块：16kHz 单声道 PCM16，按实时速率发送，避免经典 ESP32 缓冲溢出
- `haptic`：`{ "pattern": "e0", "durationMs": 2000 }`
- 本轮音频已发送完毕

断句在网关：静音约 1.2 秒结束一句，单轮最长 60 秒。识别结果为空则不调用聊天模型，也不震动。

ZHAKA 说话期间设备停止上传。恢复上传的时刻以设备本地喇叭缓冲播完为准，而不是以网关发完数据为准，否则会把句尾录回去。

局域网实验允许明文 `ws://`。ESP32 不是浏览器，不需要 HTTPS 才能采集麦克风。同一 TOKEN 同时只保留一路连接，新连接替换旧连接。

绑定存在网关内存中，由管理员在 Lab 页面写入：当前 `profileId`、`conversationId`、已启用的 `modelSlotId`、`voiceId`。页面上改选项后，下一句使用新值，不用重启板子。访客没有服务端对话，页面不提供绑定。

未绑定时设备保持 WebSocket，不上传音频。绑定成功后网关通知设备开始上传。解除绑定后设备停止上传，连接不断。设备已绑定且在线时，该管理员页面上的「开始语音对话」禁用，避免和硬件同时写同一条对话。

固件里的网关主机名固定为 `zhaka.local`。Mac 上的网关进程公布这个 mDNS 名字。Wi-Fi 名称、密码和 `DEVICE_TOKEN` 仍放在固件本地配置，不进 Git。

---

## 6. 与现有代码的对应

| 现有模块 | 硬件侧用法 |
|---|---|
| `src/server/orchestration/voice-turn.ts` | 网关直接调用，不复制陪伴逻辑 |
| `src/domain/voice.ts` | 上行常量 16kHz 可直接用；下行 32kHz 只存在于 MiniMax，出网关前降到 16kHz |
| `src/lib/voice/vad.ts` | 网关断句时复用同一阈值策略 |
| `src/domain/common.ts` 的 `E0`–`E3` | `haptic` 只在 `turnPlan.energy === "E0"` 时发送 |
| `src/app/api/voice/turn/route.ts` | 继续服务网页，硬件不调用 |

---

## 7. 实施顺序

1. 定协议，并用脚本假装 ESP32，确认 E0 会发出 2000ms 的 `haptic`，音频是 16kHz PCM16。
2. 写 Node 网关，包住 `runVoiceTurn`，并做 32kHz → 16kHz。网关在这台 Mac 上公布 `zhaka.local`。
3. 改 `/Users/lit/Documents/PlatformIO/Projects/badgedemo/src/main.cpp`：接上 WebSocket、两路 I2S 和 DRV2605L RTP。Wi-Fi 名称、密码、`DEVICE_TOKEN` 放在该工程的本地配置，不进 Git。

---

## 8. 由已确认决策带出的做法

这些不另开产品选择题，按下面执行：

- 网关把硬件回合写成管理员操作。文本进入页面选中的那条服务端 Conversation。
- 没有第一句可播音频时不震动。空识别、聊天失败、TTS 失败都不震。
- Wi-Fi 名称、密码、`DEVICE_TOKEN` 放在固件的本地配置里，不进 Git。网关主机名用 `zhaka.local`，不随 DHCP 改配置。`.env.local` 里只增加 `DEVICE_TOKEN`。
- 下行音频按播放速度送出。设备侧再留一小段缓冲。

## 9. 怎么跑

1. `.env.local` 里已有 `DEVICE_TOKEN`。同一份值在 `badgedemo/include/secrets.h`，两边都不进 Git。
2. 在本仓库启动网关：`npm run device-gateway`。它监听 `8787`，并公布 `zhaka.local`。
3. 开发板烧录 `badgedemo` 后上电。串口出现 `GATEWAY_OK` 和 `UNBOUND` 表示已连上、尚未绑定。
4. 打开 Lab 的对话页，用管理员账号选择模型、声音和对话，点「绑定到硬件」。之后直接对麦克风说话。
5. 设备在线且已绑定时，页面上的「开始语音对话」会禁用。
