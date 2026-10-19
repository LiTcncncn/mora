import { randomUUID } from "node:crypto";
import type { VoiceId, VoiceTurnEvent } from "@/domain/voice";
import { VOICE_INPUT_SAMPLE_RATE, VOICE_MAX_UTTERANCE_MS } from "@/domain/voice";
import { concat, EnergyVad, type VadUtteranceStats } from "@/lib/voice/vad";
import { encodeWav } from "@/lib/voice/pcm";
import { prepareForAsr } from "@/lib/voice/prepare-asr";
import { PcmDownsampler } from "./downsample";
import {
  createDeviceAuthenticator,
  type DeviceAuthenticator,
  type DeviceIdentity,
} from "./identity";
import {
  DeviceFrame,
  DeviceStatus,
  decodeFrame,
  encodeBind,
  encodeFrame,
  encodeHaptic,
  encodeStatus,
  encodeText,
} from "./protocol";

export interface DeviceBinding {
  deviceId?: string;
  profileId: string;
  conversationId: string;
  modelSlotId: string;
  voiceId: VoiceId;
}

export type RunDeviceTurn = (
  wav: Blob,
  binding: DeviceBinding,
  signal: AbortSignal,
  emit: (event: VoiceTurnEvent) => void,
  transcript?: string,
) => Promise<void>;

/** 一轮硬件对话的计时，毫秒都相对这句话被判定说完的时刻。 */
export interface DeviceTurnTrace {
  turnId: string;
  deviceId: string | null;
  at: string;
  outcome: "replied" | "empty" | "merged" | "error" | "cancelled";
  utteranceMs: number;
  mergedSegments: number;
  vad: VadUtteranceStats | null;
  marks: Record<string, number>;
  transcript: string | null;
  errors: string[];
  playback: { underruns: number; overflowBytes: number } | null;
  drainTimedOut: boolean;
}

export interface DeviceLinkHooks {
  onTrace?: (trace: DeviceTurnTrace) => void;
  onUtterance?: (turnId: string, wav: Blob) => void;
  /** 有的话由网关在静音尾部抢跑识别，回合里就不用再等一整段 ASR。 */
  transcribe?: (wav: Blob, signal: AbortSignal) => Promise<string>;
  onAuthenticated?: (identity: DeviceIdentity) => void;
}

function pcm16ToFloat(samples: Int16Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = samples[index]! / 0x8000;
  }
  return output;
}

function alignedPcm16(payload: Buffer): Int16Array {
  const aligned = Buffer.from(payload);
  return new Int16Array(
    aligned.buffer,
    aligned.byteOffset,
    Math.floor(aligned.byteLength / 2),
  );
}

/** 16kHz PCM16 的 20ms。开发板单条 WebSocket 大约只能收 15KB，必须拆开。 */
const PLAYBACK_FRAME_BYTES = 640;
const BYTES_PER_MS = (VOICE_INPUT_SAMPLE_RATE * 2) / 1000;
/** 让设备缓冲区始终领先播放这么多，吸收 Wi-Fi 和定时器抖动。 */
const PLAYBACK_LEAD_MS = 500;
/** 旧固件不回报播放完成时，最多等这么久再恢复收音。 */
const DRAIN_TIMEOUT_MS = 4000;
/** 喇叭刚停时房间里还有余音，这段不送给 VAD。 */
const POST_PLAYBACK_MUTE_MS = 400;
/** 超过就不再把下一段并进来，直接当新的一句。 */
const MAX_MERGED_SAMPLES = (VOICE_INPUT_SAMPLE_RATE * VOICE_MAX_UTTERANCE_MS) / 1000;
/** 约 100Hz 一阶高通，去掉直流和桌面低频震动。 */
const HIGH_PASS_ALPHA = 0.96;
/** 数字增益后超过这个值开始软压，不直接削顶。 */
const LIMITER_KNEE = 24_000;
/** 没有字母或数字的识别结果不能沿用，整句还要再试一次。 */
const SPEAKABLE = /[\p{L}\p{N}]/u;

/** 按设备的播放时钟下发，始终领先 PLAYBACK_LEAD_MS，不多也不少。 */
class RealtimePacer {
  private pending = Buffer.alloc(0);
  private timer: NodeJS.Timeout | null = null;
  private finishing: (() => void) | null = null;
  private clockStart: number | null = null;
  private sentMs = 0;
  private readonly send: (frame: Buffer) => void;
  private readonly paceMs: number;

  constructor(send: (frame: Buffer) => void, paceMs: number) {
    this.send = send;
    this.paceMs = paceMs;
  }

  enqueue(samples: Int16Array): void {
    if (samples.length === 0) return;
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    this.pending = Buffer.concat([this.pending, bytes]);
    if (this.paceMs <= 0) {
      this.flushAll();
      return;
    }
    this.timer ??= setInterval(() => this.tick(), this.paceMs);
    this.tick();
  }

  finish(done: () => void): void {
    this.finishing = done;
    if (this.paceMs <= 0) {
      this.flushAll();
      return;
    }
    this.timer ??= setInterval(() => this.tick(), this.paceMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = Buffer.alloc(0);
    this.finishing = null;
    this.clockStart = null;
    this.sentMs = 0;
  }

  private sendSlice(allowShort: boolean): boolean {
    if (this.pending.length === 0) return false;
    if (this.pending.length < PLAYBACK_FRAME_BYTES && !allowShort) return false;
    const size = Math.min(PLAYBACK_FRAME_BYTES, this.pending.length);
    const frame = Buffer.from(this.pending.subarray(0, size));
    this.pending = Buffer.from(this.pending.subarray(size));
    this.send(encodeFrame(DeviceFrame.pcm, frame));
    this.sentMs += size / BYTES_PER_MS;
    return true;
  }

  private flushAll(): void {
    while (this.sendSlice(true)) {
      // 测试用：一次交完。
    }
    this.complete();
  }

  private tick(): void {
    const now = Date.now();
    this.clockStart ??= now;
    let buffered = this.sentMs - (now - this.clockStart);
    if (buffered < 0) {
      // 设备已经放空，播放时钟从现在重新算。
      this.clockStart = now - this.sentMs;
      buffered = 0;
    }
    while (buffered < PLAYBACK_LEAD_MS) {
      const before = this.sentMs;
      if (!this.sendSlice(this.finishing !== null)) break;
      buffered += this.sentMs - before;
    }
    this.complete();
  }

  private complete(): void {
    if (this.pending.length > 0 || !this.finishing) return;
    const done = this.finishing;
    this.stop();
    done();
  }
}

type Phase = "idle" | "recognizing" | "replying" | "draining";

interface Turn {
  id: string;
  startedAt: number;
  abort: AbortController;
  utterance: Int16Array;
  mergedSegments: number;
  vad: VadUtteranceStats | null;
  marks: Record<string, number>;
  transcript: string | null;
  empty: boolean;
  errors: string[];
  outcome: DeviceTurnTrace["outcome"] | null;
  replyFinished: boolean;
  settled: boolean;
  closed: boolean;
  traced: boolean;
  playback: DeviceTurnTrace["playback"];
  drainTimedOut: boolean;
}

/**
 * 一块板的会话：鉴权、绑定、断句，再把语音回合的事件收成二进制帧。
 * 识别阶段用户接着说，会取消本轮并把两段并成一句；回复开始后上行音频丢掉。
 */
export class DeviceLink {
  private authed = false;
  private binding: DeviceBinding | null = null;
  private phase: Phase = "idle";
  private playing = false;
  private closed = false;
  private current: Turn | null = null;
  private carry: { samples: Int16Array; segments: number } | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private holdoffUntil = 0;
  private highPassX = 0;
  private highPassY = 0;
  private readonly vad = new EnergyVad({
    sampleRate: VOICE_INPUT_SAMPLE_RATE,
    // 停顿后接着说会被并回同一句，所以这里可以比浏览器短。
    endSilenceMs: 800,
    maxUtteranceMs: VOICE_MAX_UTTERANCE_MS,
    startSpeechMs: 100,
    minSpeechMs: 160,
    preRollMs: 400,
    tailKeepMs: 500,
    // 开口约高于底噪 10dB，维持约 5dB，轻声的后半句不会被当成静音。
    rmsFloor: 0.006,
    noiseMultiplier: 3.2,
    holdFloor: 0.004,
    holdMultiplier: 1.8,
    adaptiveNoise: true,
    noisePercentile: 0.95,
    calibrationMs: 800,
    // 噪声底被尾音抬高时，开口线停在这里，正常音量仍能进识别。
    maxStartThreshold: 0.012,
    noiseObserveCeiling: 0.008,
  });
  private speculative: {
    samples: number;
    abort: AbortController;
    promise: Promise<string>;
  } | null = null;
  private readonly downsampler = new PcmDownsampler();
  private readonly pacer: RealtimePacer;
  private readonly authenticate: DeviceAuthenticator;
  private identity: DeviceIdentity | null = null;
  private readonly send: (frame: Buffer) => void;
  private readonly runTurn: RunDeviceTurn;
  private readonly hooks: DeviceLinkHooks;
  private playbackGain = 1;
  private readonly bars = Array<number>(16).fill(0);
  private micOk: boolean | null = null;
  private lastMeterAt = 0;
  private meterBucket = 0;
  private meterBucketAt = 0;

  constructor(
    auth: string | DeviceAuthenticator,
    send: (frame: Buffer) => void,
    runTurn: RunDeviceTurn,
    paceMs = 20,
    hooks: DeviceLinkHooks = {},
  ) {
    this.authenticate = typeof auth === "string" ? createDeviceAuthenticator(auth) : auth;
    this.send = send;
    this.runTurn = runTurn;
    this.hooks = hooks;
    this.pacer = new RealtimePacer(send, paceMs);
  }

  setPlaybackGain(gain: number): void {
    this.playbackGain = gain;
  }

  get deviceIdentity(): DeviceIdentity | null {
    return this.identity;
  }

  pulse(durationMs: number): void {
    if (!this.authed || this.closed) return;
    this.send(encodeHaptic(durationMs));
  }

  /** 让设备重启进配网热点。旧固件不认识这一帧，会直接忽略。 */
  requestProvision(): boolean {
    if (!this.authed || this.closed) return false;
    this.send(encodeFrame(DeviceFrame.provision));
    return true;
  }

  micSnapshot(now = Date.now()): { ok: boolean | null; bars: number[] } {
    const stale = this.authed && this.lastMeterAt > 0 && now - this.lastMeterAt > 1500;
    return {
      ok: stale ? false : this.micOk,
      bars: [...this.bars],
    };
  }

  close(): void {
    this.closed = true;
    this.abortSpeculative();
    if (this.current) this.cancelTurn(this.current, "cancelled");
    this.pacer.stop();
    this.clearDrainTimer();
  }

  setBinding(binding: DeviceBinding | null): void {
    this.binding = binding;
    if (!binding) {
      this.vad.reset();
      this.carry = null;
      this.abortSpeculative();
      if (this.current) this.cancelTurn(this.current, "cancelled");
    }
    if (this.authed) this.send(encodeBind(binding !== null));
  }

  onMessage(message: Uint8Array): void {
    const frame = decodeFrame(message);
    if (!frame) return;
    if (!this.authed) {
      this.acceptHello(frame.type, frame.payload);
      return;
    }
    if (frame.type === DeviceFrame.meter) {
      this.noteMeter(frame.payload);
      return;
    }
    if (frame.type === DeviceFrame.playbackDone) {
      this.onPlaybackDone(frame.payload);
      return;
    }
    if (frame.type !== DeviceFrame.audio || !this.binding) return;
    if (this.phase === "replying" || this.phase === "draining") return;
    if (Date.now() < this.holdoffUntil) return;

    const samples = this.highPass(alignedPcm16(frame.payload));
    const utterance = this.vad.push(pcm16ToFloat(samples));
    if (this.phase === "recognizing" && this.vad.isSpeaking && this.current) {
      const turn = this.current;
      this.carry = { samples: turn.utterance, segments: turn.mergedSegments };
      this.cancelTurn(turn, "merged");
    }
    if (this.vad.isSpeaking && this.vad.silenceMs < 80) this.abortSpeculative();
    else this.kickSpeculative();
    if (utterance) this.startUtterance(utterance);
  }

  private startUtterance(utterance: Int16Array): void {
    const carry = this.carry;
    this.carry = null;
    const merged =
      carry && carry.samples.length + utterance.length <= MAX_MERGED_SAMPLES
        ? { samples: concat([carry.samples, utterance]), segments: carry.segments + 1 }
        : { samples: utterance, segments: 1 };
    void this.beginTurn(merged.samples, merged.segments);
  }

  private kickSpeculative(): void {
    if (!this.hooks.transcribe || this.speculative || this.phase !== "idle") return;
    if (!this.vad.isSpeaking || this.vad.silenceMs < 360) return;
    const preview = this.vad.previewUtterance();
    if (!preview || preview.length < 1600) return;
    const abort = new AbortController();
    const promise = this.hooks.transcribe(
      encodeWav(prepareForAsr(preview, VOICE_INPUT_SAMPLE_RATE), VOICE_INPUT_SAMPLE_RATE),
      abort.signal,
    );
    // 这句话还没结束时没人 await。限流或取消若在这里拒绝，会直接打崩进程。
    void promise.catch(() => undefined);
    this.speculative = {
      samples: preview.length,
      abort,
      promise,
    };
  }

  private abortSpeculative(): void {
    if (!this.speculative) return;
    const pending = this.speculative;
    this.speculative = null;
    pending.abort.abort();
    void pending.promise.catch(() => undefined);
  }

  private async recognize(utterance: Int16Array, signal: AbortSignal): Promise<string | undefined> {
    if (!this.hooks.transcribe) return undefined;
    const speculative = this.speculative;
    this.speculative = null;
    const extra = utterance.length - (speculative?.samples ?? 0);
    if (speculative && extra >= 0 && extra <= 2400) {
      try {
        const text = await speculative.promise;
        if (SPEAKABLE.test(text)) return text;
      } catch {
        if (signal.aborted) return undefined;
      }
    } else {
      speculative?.abort.abort();
      void speculative?.promise.catch(() => undefined);
    }
    return this.hooks.transcribe(
      encodeWav(prepareForAsr(utterance, VOICE_INPUT_SAMPLE_RATE), VOICE_INPUT_SAMPLE_RATE),
      signal,
    );
  }

  private highPass(input: Int16Array): Int16Array {
    const output = new Int16Array(input.length);
    let previousX = this.highPassX;
    let previousY = this.highPassY;
    for (let index = 0; index < input.length; index += 1) {
      const x = input[index]!;
      const y = HIGH_PASS_ALPHA * (previousY + x - previousX);
      output[index] = Math.max(-32768, Math.min(32767, Math.round(y)));
      previousX = x;
      previousY = y;
    }
    this.highPassX = previousX;
    this.highPassY = previousY;
    return output;
  }

  private acceptHello(type: number, payload: Buffer): void {
    const identity = type === DeviceFrame.hello ? this.authenticate(payload) : null;
    if (!identity) {
      this.send(encodeFrame(DeviceFrame.authFail));
      return;
    }
    this.authed = true;
    this.identity = identity;
    this.send(encodeFrame(DeviceFrame.authOk));
    this.send(encodeBind(this.binding !== null));
    this.hooks.onAuthenticated?.(identity);
  }

  private applyGain(samples: Int16Array): Int16Array {
    const gain = this.playbackGain;
    const headroom = 32767 - LIMITER_KNEE;
    for (let index = 0; index < samples.length; index += 1) {
      const scaled = samples[index]! * gain;
      const magnitude = Math.abs(scaled);
      if (magnitude <= LIMITER_KNEE) {
        samples[index] = Math.round(scaled);
        continue;
      }
      const limited = LIMITER_KNEE + headroom * Math.tanh((magnitude - LIMITER_KNEE) / headroom);
      samples[index] = Math.round(Math.sign(scaled) * limited);
    }
    return samples;
  }

  private noteMeter(payload: Buffer): void {
    const now = Date.now();
    this.lastMeterAt = now;
    this.micOk = payload[0] === 1;
    this.meterBucket = Math.max(this.meterBucket, this.micOk ? (payload[1] ?? 0) : 0);
    if (this.meterBucketAt === 0) this.meterBucketAt = now;
    if (now - this.meterBucketAt < 120) return;
    this.bars.shift();
    this.bars.push(this.meterBucket);
    this.meterBucket = 0;
    this.meterBucketAt = now;
  }

  private mark(turn: Turn, name: string): void {
    turn.marks[name] ??= Date.now() - turn.startedAt;
  }

  private async beginTurn(utterance: Int16Array, mergedSegments: number): Promise<void> {
    const binding = this.binding;
    if (!binding || this.phase !== "idle" || this.closed) return;
    const turn: Turn = {
      id: `dturn-${randomUUID()}`,
      startedAt: Date.now(),
      abort: new AbortController(),
      utterance,
      mergedSegments,
      vad: this.vad.lastStats,
      marks: {},
      transcript: null,
      empty: false,
      errors: [],
      outcome: null,
      replyFinished: false,
      settled: false,
      closed: false,
      traced: false,
      playback: null,
      drainTimedOut: false,
    };
    this.current = turn;
    this.phase = "recognizing";
    this.playing = false;
    this.send(encodeStatus(DeviceStatus.think));
    const wav = encodeWav(utterance, VOICE_INPUT_SAMPLE_RATE);
    this.hooks.onUtterance?.(turn.id, wav);
    try {
      const transcript = this.hooks.transcribe
        ? await this.recognize(utterance, turn.abort.signal)
        : undefined;
      if (turn.abort.signal.aborted || this.closed) return;
      if (this.hooks.transcribe) this.mark(turn, "asr");
      await this.runTurn(
        wav,
        binding,
        turn.abort.signal,
        (event) => this.onTurnEvent(turn, event),
        transcript,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "硬件回合失败";
      turn.errors.push(message);
      if (this.current === turn && !turn.abort.signal.aborted && !this.closed) {
        this.send(encodeFrame(DeviceFrame.error, Buffer.from(message)));
      }
    }
    turn.settled = true;
    if (this.current === turn) this.finishReply(turn);
    this.maybeTrace(turn);
  }

  private onTurnEvent(turn: Turn, event: VoiceTurnEvent): void {
    if (turn.abort.signal.aborted || this.closed) return;
    if (event.type === "timing") {
      turn.marks[event.mark] ??= Date.now() - turn.startedAt;
      return;
    }
    if (event.type === "done") return;
    if (this.current !== turn) return;
    switch (event.type) {
      case "transcript":
        turn.transcript = event.text;
        this.mark(turn, "transcript");
        this.phase = "replying";
        this.send(encodeText("user", event.text));
        break;
      case "text":
        this.send(encodeText("assistant", event.text));
        break;
      case "haptic":
        this.send(encodeHaptic(event.durationMs));
        break;
      case "audio":
        if (!this.playing) {
          this.playing = true;
          this.mark(turn, "first_audio_sent");
          this.send(encodeStatus(DeviceStatus.speak));
        }
        this.pacer.enqueue(this.applyGain(this.downsampler.push(Buffer.from(event.data, "base64"))));
        break;
      case "error":
        turn.errors.push(`${event.stage}: ${event.message}`);
        this.send(encodeFrame(DeviceFrame.error, Buffer.from(event.message)));
        break;
      case "speech_end":
        this.finishReply(turn);
        break;
      case "empty":
        turn.empty = true;
        break;
      default:
        break;
    }
  }

  /** 声音交完就放开麦克风；存档和记忆抽取还在后台跑。 */
  private finishReply(turn: Turn): void {
    if (turn.replyFinished || this.current !== turn) return;
    turn.replyFinished = true;
    this.mark(turn, "speech_end");
    turn.outcome ??= turn.empty
      ? "empty"
      : turn.errors.length > 0 && !this.playing
        ? "error"
        : "replied";
    if (!this.playing) {
      this.closeTurn(turn);
      return;
    }
    this.pacer.finish(() => {
      if (this.current !== turn) return;
      this.mark(turn, "audio_end_sent");
      this.send(encodeFrame(DeviceFrame.audioEnd));
      this.phase = "draining";
      this.clearDrainTimer();
      this.drainTimer = setTimeout(() => {
        turn.drainTimedOut = true;
        this.closeTurn(turn);
      }, DRAIN_TIMEOUT_MS);
    });
  }

  private onPlaybackDone(payload: Buffer): void {
    const turn = this.current;
    if (!turn || this.phase !== "draining") return;
    turn.playback = {
      underruns: payload.length >= 2 ? payload.readUInt16LE(0) : 0,
      overflowBytes: payload.length >= 4 ? payload.readUInt16LE(2) : 0,
    };
    this.mark(turn, "playback_done");
    this.closeTurn(turn);
  }

  private closeTurn(turn: Turn): void {
    if (this.current !== turn) return;
    this.clearDrainTimer();
    this.current = null;
    this.phase = "idle";
    this.playing = false;
    this.vad.resetUtterance();
    this.abortSpeculative();
    turn.closed = true;
    this.mark(turn, "listen");
    this.holdoffUntil = Date.now() + POST_PLAYBACK_MUTE_MS;
    if (!this.closed) this.send(encodeStatus(DeviceStatus.listen));
    this.maybeTrace(turn);
  }

  private cancelTurn(turn: Turn, outcome: DeviceTurnTrace["outcome"]): void {
    turn.outcome = outcome;
    turn.abort.abort();
    if (this.current !== turn) return;
    this.clearDrainTimer();
    this.pacer.stop();
    this.current = null;
    this.phase = "idle";
    this.playing = false;
    this.abortSpeculative();
    turn.closed = true;
    this.maybeTrace(turn);
  }

  private clearDrainTimer(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
  }

  private maybeTrace(turn: Turn): void {
    if (turn.traced || !turn.closed || !turn.settled) return;
    turn.traced = true;
    this.hooks.onTrace?.({
      turnId: turn.id,
      deviceId: this.identity?.deviceId ?? null,
      at: new Date(turn.startedAt).toISOString(),
      outcome: turn.outcome ?? "replied",
      utteranceMs: Math.round((turn.utterance.length / VOICE_INPUT_SAMPLE_RATE) * 1000),
      mergedSegments: turn.mergedSegments,
      vad: turn.vad,
      marks: turn.marks,
      transcript: turn.transcript,
      errors: turn.errors,
      playback: turn.playback,
      drainTimedOut: turn.drainTimedOut,
    });
  }
}
