/** 送给识别前：裁到有声音的一段，再把过轻的峰值拉高。不改断句用的原音频。 */
const FRAME_MS = 20;
const PAD_MS = 100;
/** 低于这段能量的帧算静音。很轻的人声大约 0.009，不能再高。 */
const VOICED_FLOOR = 0.006;
const PEAK_FRACTION = 0.3;
/** 正弦峰值大约 0.25。已经更响的不再压小。 */
const TARGET_PEAK = 0.25;
/** 近乎无声时停止放大，避免把底噪拉成满幅。 */
const MAX_GAIN = 32;

export function prepareForAsr(samples: Int16Array, sampleRate: number): Int16Array {
  if (samples.length === 0) return samples;
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const pad = Math.round((sampleRate * PAD_MS) / 1000);
  let peakRms = 0;
  const frameRms: number[] = [];
  for (let offset = 0; offset + frame <= samples.length; offset += frame) {
    let sum = 0;
    for (let index = 0; index < frame; index += 1) {
      const value = samples[offset + index]! / 32768;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / frame);
    frameRms.push(rms);
    if (rms > peakRms) peakRms = rms;
  }

  const gate = Math.max(VOICED_FLOOR, peakRms * PEAK_FRACTION);
  let first = -1;
  let last = -1;
  for (let index = 0; index < frameRms.length; index += 1) {
    if (frameRms[index]! < gate) continue;
    if (first < 0) first = index;
    last = index;
  }

  const start = first < 0 ? 0 : Math.max(0, first * frame - pad);
  const end = first < 0 ? samples.length : Math.min(samples.length, (last + 1) * frame + pad);
  const trimmed = samples.subarray(start, end);

  let peak = 0;
  for (const sample of trimmed) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  const target = Math.round(TARGET_PEAK * 32767);
  if (peak === 0 || peak >= target) return new Int16Array(trimmed);
  const gain = Math.min(MAX_GAIN, target / peak);
  const output = new Int16Array(trimmed.length);
  for (let index = 0; index < trimmed.length; index += 1) {
    output[index] = Math.max(-32768, Math.min(32767, Math.round(trimmed[index]! * gain)));
  }
  return output;
}
