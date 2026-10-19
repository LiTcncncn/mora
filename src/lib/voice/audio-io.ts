"use client";

import { VOICE_INPUT_SAMPLE_RATE } from "@/domain/voice";
import { LinearResampler, pcm16ToFloat } from "./pcm";

const CAPTURE_WORKLET = `
class ZhakaCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("zhaka-capture", ZhakaCapture);
`;

/** 麦克风采集，输出 16kHz 单声道浮点样本。 */
export class Microphone {
  private constructor(
    private readonly stream: MediaStream,
    private readonly nodes: AudioNode[],
  ) {}

  static async open(
    context: AudioContext,
    onSamples: (samples: Float32Array) => void,
  ): Promise<Microphone> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器环境无法使用麦克风（需要 localhost 或 HTTPS）");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const moduleUrl = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "zhaka-capture");
    const mute = context.createGain();
    mute.gain.value = 0;
    const resampler = new LinearResampler(context.sampleRate, VOICE_INPUT_SAMPLE_RATE);
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onSamples(resampler.process(event.data));
    };
    source.connect(capture);
    capture.connect(mute);
    mute.connect(context.destination);
    return new Microphone(stream, [source, capture, mute]);
  }

  close(): void {
    for (const node of this.nodes) node.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}

/** 按到达顺序无缝排队播放 PCM16 块。 */
export class PcmPlayer {
  private nextTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private drainWaiters: Array<() => void> = [];

  constructor(
    private readonly context: AudioContext,
    private readonly sampleRate: number,
  ) {}

  enqueue(bytes: Uint8Array): void {
    const samples = pcm16ToFloat(bytes);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime + 0.05, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.flushWaiters();
    };
  }

  whenDrained(): Promise<void> {
    if (this.sources.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // 尚未开始播放
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.flushWaiters();
  }

  private flushWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
