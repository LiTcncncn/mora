import { floatToPcm16 } from "./pcm";

/** 20ms 一帧的能量 VAD；纯函数状态机，便于测试与硬件端移植。 */
export const VAD_FRAME_MS = 20;

export interface VadOptions {
  sampleRate: number;
  endSilenceMs: number;
  maxUtteranceMs: number;
  /** 连续超过阈值多久才算开口，过滤键盘声和咳嗽。 */
  startSpeechMs?: number;
  /** 有效发声不足此时长则丢弃。 */
  minSpeechMs?: number;
  preRollMs?: number;
  /** 句末静音里保留多少，太短会吃掉轻声收尾。 */
  tailKeepMs?: number;
  /** 低于此能量不算开口。浏览器用 0.012；硬件麦克风更轻，需要更低。 */
  rmsFloor?: number;
  /** 噪声底乘上这个倍数，避免环境底噪被当成说话。 */
  noiseMultiplier?: number;
  /** 开口后维持“还在说”的阈值。不给时沿用开口阈值的 0.7。 */
  holdFloor?: number;
  holdMultiplier?: number;
  /** 噪声底快降慢升，稳定的风扇声会被慢慢吸收，不会一直误触发。 */
  adaptiveNoise?: boolean;
  /**
   * 用最近 1.5 秒噪声的这个分位数当地板。
   * 0.95 大约是环境峰值，比指数平均更能扛风扇和键盘。
   */
  noisePercentile?: number;
  /** 绑定后先听这么久的环境再开口，避免上电瞬间被当成说话。 */
  calibrationMs?: number;
  /** 开口阈值的上限。噪声底被尾音抬高时，正常音量仍能开口。 */
  maxStartThreshold?: number;
  /** 高于此能量的帧不计入噪声底。那是说话、碰撞或喇叭余音。 */
  noiseObserveCeiling?: number;
}

export interface VadUtteranceStats {
  durationMs: number;
  voicedMs: number;
  peakRms: number;
  noiseFloor: number;
  startThreshold: number;
  holdThreshold: number;
  endedBy: "silence" | "max";
}

const NOISE_WINDOW_FRAMES = Math.round(1500 / VAD_FRAME_MS);

export class EnergyVad {
  readonly frameSize: number;
  private readonly endSilenceFrames: number;
  private readonly maxFrames: number;
  private readonly startFrames: number;
  private readonly minSpeechFrames: number;
  private readonly preRollFrames: number;
  private readonly tailKeepFrames: number;
  private readonly rmsFloor: number;
  private readonly noiseMultiplier: number;
  private readonly holdFloor: number | null;
  private readonly holdMultiplier: number | null;
  private readonly adaptiveNoise: boolean;
  private readonly noisePercentile: number | null;
  private readonly calibrationFrames: number;
  private readonly maxStartThreshold: number | null;
  private readonly noiseObserveCeiling: number | null;

  private noiseFloor = 0.004;
  private noiseSamples: number[] = [];
  private calibratedFrames = 0;
  private preRoll: Int16Array[] = [];
  private frames: Int16Array[] = [];
  private speaking = false;
  private loudRun = 0;
  private silenceRun = 0;
  private voicedFrames = 0;
  private peakRms = 0;
  private pending = new Float32Array(0);
  private stats: VadUtteranceStats | null = null;

  constructor(options: VadOptions) {
    const framesFor = (ms: number) => Math.max(1, Math.round(ms / VAD_FRAME_MS));
    this.frameSize = Math.round((options.sampleRate * VAD_FRAME_MS) / 1000);
    this.endSilenceFrames = framesFor(options.endSilenceMs);
    this.maxFrames = framesFor(options.maxUtteranceMs);
    this.startFrames = framesFor(options.startSpeechMs ?? 120);
    this.minSpeechFrames = framesFor(options.minSpeechMs ?? 300);
    this.preRollFrames = framesFor(options.preRollMs ?? 300);
    this.tailKeepFrames = framesFor(options.tailKeepMs ?? 200);
    this.rmsFloor = options.rmsFloor ?? 0.012;
    this.noiseMultiplier = options.noiseMultiplier ?? 3;
    this.holdFloor = options.holdFloor ?? null;
    this.holdMultiplier = options.holdMultiplier ?? null;
    this.adaptiveNoise = options.adaptiveNoise ?? false;
    this.noisePercentile = options.noisePercentile ?? null;
    this.calibrationFrames = options.calibrationMs
      ? framesFor(options.calibrationMs)
      : 0;
    this.maxStartThreshold = options.maxStartThreshold ?? null;
    this.noiseObserveCeiling = options.noiseObserveCeiling ?? null;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get silenceMs(): number {
    return this.speaking ? this.silenceRun * VAD_FRAME_MS : 0;
  }

  get calibrating(): boolean {
    return this.calibratedFrames < this.calibrationFrames;
  }

  /** 最近一句话的断句数据，用来查截断和误触发。 */
  get lastStats(): VadUtteranceStats | null {
    return this.stats;
  }

  /** 正在说的这一句（含少量尾静音），给识别抢跑用。 */
  previewUtterance(): Int16Array | null {
    if (!this.speaking || this.frames.length === 0) return null;
    return concat(this.frames.slice(0, this.keptFrameCount()));
  }

  reset(): void {
    this.resetUtterance();
    this.noiseSamples = [];
    this.calibratedFrames = 0;
    this.noiseFloor = 0.004;
  }

  /** 收口后只清这一句，环境噪声底留下来。 */
  resetUtterance(): void {
    this.preRoll = [];
    this.frames = [];
    this.speaking = false;
    this.loudRun = 0;
    this.silenceRun = 0;
    this.voicedFrames = 0;
    this.peakRms = 0;
    this.pending = new Float32Array(0);
  }

  /** 送入 16kHz 浮点样本；一句话结束时返回整句 PCM16。 */
  push(samples: Float32Array): Int16Array | null {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    let offset = 0;
    let utterance: Int16Array | null = null;
    while (offset + this.frameSize <= joined.length) {
      const frame = joined.subarray(offset, offset + this.frameSize);
      offset += this.frameSize;
      utterance = this.pushFrame(frame) ?? utterance;
    }
    this.pending = joined.slice(offset);
    return utterance;
  }

  private startThreshold(): number {
    const threshold = Math.max(this.rmsFloor, this.noiseFloor * this.noiseMultiplier);
    if (this.maxStartThreshold === null) return threshold;
    return Math.min(this.maxStartThreshold, threshold);
  }

  private holdThreshold(): number {
    const raw =
      this.holdMultiplier === null
        ? this.startThreshold() * 0.7
        : Math.max(this.holdFloor ?? 0, this.noiseFloor * this.holdMultiplier);
    if (this.maxStartThreshold === null) return raw;
    return Math.min(raw, this.maxStartThreshold * 0.7);
  }

  private observeNoise(rms: number): void {
    if (this.noiseObserveCeiling !== null && rms > this.noiseObserveCeiling) return;
    this.noiseSamples.push(rms);
    if (this.noiseSamples.length > NOISE_WINDOW_FRAMES) this.noiseSamples.shift();
    if (this.noisePercentile !== null && this.noiseSamples.length >= 15) {
      const sorted = [...this.noiseSamples].sort((left, right) => left - right);
      const index = Math.min(
        sorted.length - 1,
        Math.floor(sorted.length * this.noisePercentile),
      );
      this.noiseFloor = Math.max(0.0005, sorted[index]!);
      return;
    }
    if (!this.adaptiveNoise) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      return;
    }
    const rate = rms < this.noiseFloor ? 0.2 : 0.005;
    this.noiseFloor = Math.max(0.0005, this.noiseFloor * (1 - rate) + rms * rate);
  }

  private keptFrameCount(): number {
    return this.frames.length - this.silenceRun + Math.min(this.silenceRun, this.tailKeepFrames);
  }

  private pushFrame(frame: Float32Array): Int16Array | null {
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const rms = Math.sqrt(sum / frame.length);
    const threshold = this.startThreshold();
    const pcm = floatToPcm16(frame);

    if (!this.speaking) {
      if (this.calibratedFrames < this.calibrationFrames) {
        this.calibratedFrames += 1;
        this.observeNoise(rms);
        return null;
      }
      this.preRoll.push(pcm);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      const loud = rms > threshold;
      if (!loud) this.observeNoise(rms);
      if (loud) {
        this.loudRun += 1;
        if (this.loudRun >= this.startFrames) {
          this.speaking = true;
          this.frames = [...this.preRoll];
          this.preRoll = [];
          this.voicedFrames = this.loudRun;
          this.silenceRun = 0;
          this.peakRms = rms;
        }
      } else {
        this.loudRun = 0;
      }
      return null;
    }

    this.frames.push(pcm);
    this.peakRms = Math.max(this.peakRms, rms);
    if (rms > this.holdThreshold()) {
      this.silenceRun = 0;
      this.voicedFrames += 1;
    } else {
      this.silenceRun += 1;
    }

    const ended = this.silenceRun >= this.endSilenceFrames;
    if (!ended && this.frames.length < this.maxFrames) return null;

    const keep = ended ? this.keptFrameCount() : this.frames.length;
    const voiced = this.voicedFrames;
    const frames = this.frames.slice(0, keep);
    const stats: VadUtteranceStats = {
      durationMs: keep * VAD_FRAME_MS,
      voicedMs: voiced * VAD_FRAME_MS,
      peakRms: this.peakRms,
      noiseFloor: this.noiseFloor,
      startThreshold: threshold,
      holdThreshold: this.holdThreshold(),
      endedBy: ended ? "silence" : "max",
    };
    this.resetUtterance();
    if (voiced < this.minSpeechFrames) return null;
    this.stats = stats;
    return concat(frames);
  }
}

export function concat(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const output = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
}
