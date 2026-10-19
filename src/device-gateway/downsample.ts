const TAPS = 31;

/** 32kHz 下截止约 7kHz 的 Blackman 窗低通，直流增益为 1。 */
function lowPassTaps(): Float64Array {
  const cutoff = 7000 / 32000;
  const middle = (TAPS - 1) / 2;
  const taps = new Float64Array(TAPS);
  let sum = 0;
  for (let index = 0; index < TAPS; index += 1) {
    const x = index - middle;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * index) / (TAPS - 1)) +
      0.08 * Math.cos((4 * Math.PI * index) / (TAPS - 1));
    taps[index] = sinc * window;
    sum += taps[index]!;
  }
  for (let index = 0; index < TAPS; index += 1) taps[index] = taps[index]! / sum;
  return taps;
}

const LOW_PASS = lowPassTaps();

/**
 * MiniMax 下行是 32kHz PCM16，硬件喇叭按 16kHz 播放。
 * 先低通再隔一取一；直接两两平均会把 8kHz 以上折回可听频段，听起来发沙。
 */
export class PcmDownsampler {
  private oddByte: number | null = null;
  private readonly history = new Float64Array(TAPS);
  private cursor = 0;
  private phase = 0;

  push(bytes: Uint8Array): Int16Array {
    const samples: number[] = [];
    for (const byte of bytes) {
      if (this.oddByte === null) {
        this.oddByte = byte;
        continue;
      }
      const sample = (byte << 8) | this.oddByte;
      this.oddByte = null;
      this.history[this.cursor] = sample > 0x7fff ? sample - 0x10000 : sample;
      this.cursor = (this.cursor + 1) % TAPS;
      this.phase ^= 1;
      if (this.phase === 1) continue;
      let acc = 0;
      for (let tap = 0; tap < TAPS; tap += 1) {
        acc += LOW_PASS[tap]! * this.history[(this.cursor + tap) % TAPS]!;
      }
      samples.push(Math.max(-32768, Math.min(32767, Math.round(acc))));
    }
    return Int16Array.from(samples);
  }
}
