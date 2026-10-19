/** 有状态线性插值重采样，跨块保持相位连续。 */
export class LinearResampler {
  private readonly step: number;
  private position = 0;
  private previous = 0;

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    const output: number[] = [];
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const left = index === 0 ? this.previous : input[index - 1]!;
      const right = input[index]!;
      output.push(left + (right - left) * frac);
      this.position += this.step;
    }
    this.position -= input.length;
    if (input.length > 0) this.previous = input[input.length - 1]!;
    return Float32Array.from(output);
  }
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]!));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function pcm16ToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return output;
}

export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index += 1) {
      view.setUint8(offset + index, tag.charCodeAt(index));
    }
  };
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44, samples.length).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
