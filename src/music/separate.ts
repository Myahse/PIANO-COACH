const MODEL_RATE = 22050;

export type AudioSources = {
  vocal: Float32Array;
  instruments: Float32Array;
};

export async function prepareSources(buffer: AudioBuffer, maxSeconds: number): Promise<AudioSources> {
  const stereo = await resampleStereo(buffer, maxSeconds);
  const mid = new Float32Array(stereo.left.length);
  const side = new Float32Array(stereo.left.length);
  for (let i = 0; i < mid.length; i++) {
    const left = stereo.left[i] ?? 0;
    const right = stereo.right[i] ?? 0;
    mid[i] = (left + right) * 0.5;
    side[i] = (left - right) * 0.5;
  }

  const vocal = normalize(
    noiseGate(
      duckTransients(bandPass(mid, 150, 1800, MODEL_RATE)),
      0.02,
    ),
  );
  const bass = lowPass(highPass(mid, 45, MODEL_RATE), 500, MODEL_RATE);
  const wide = lowPass(highPass(side, 110, MODEL_RATE), 1100, MODEL_RATE);
  const instruments = normalize(
    noiseGate(
      duckTransients(mix(bass, 0.85, wide, 0.45)),
      0.02,
    ),
  );
  return { vocal, instruments };
}

async function resampleStereo(
  buffer: AudioBuffer,
  maxSeconds: number,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const srcFrames = Math.min(buffer.length, Math.floor(maxSeconds * buffer.sampleRate));
  if (srcFrames < buffer.sampleRate * 0.4) throw new Error("That audio clip is too short to read.");
  const duration = srcFrames / buffer.sampleRate;
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * MODEL_RATE)), MODEL_RATE);
  const sourceBuffer = offline.createBuffer(2, srcFrames, buffer.sampleRate);
  const left = sourceBuffer.getChannelData(0);
  const right = sourceBuffer.getChannelData(1);
  const channel0 = buffer.getChannelData(0);
  const channel1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : channel0;
  left.set(channel0.subarray(0, srcFrames));
  right.set(channel1.subarray(0, srcFrames));
  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return {
    left: rendered.getChannelData(0).slice(),
    right: rendered.getChannelData(1).slice(),
  };
}

function mix(a: Float32Array, aGain: number, b: Float32Array, bGain: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) * aGain + (b[i] ?? 0) * bGain;
  return out;
}

function normalize(input: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i] ?? 0));
  if (peak < 0.02) return input;
  const gain = 0.94 / peak;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = (input[i] ?? 0) * gain;
  return out;
}

function duckTransients(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  let env = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = input[i] ?? 0;
    const mag = Math.abs(sample);
    env = mag > env ? env * 0.62 + mag * 0.38 : env * 0.994 + mag * 0.006;
    if (mag > env * 2.1 && env > 1e-4) out[i] = sample * Math.min(1, (env * 1.05) / mag);
    else out[i] = sample;
  }
  return out;
}

function noiseGate(input: Float32Array, threshold: number): Float32Array {
  const out = new Float32Array(input.length);
  let env = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = input[i] ?? 0;
    const mag = Math.abs(sample);
    env = mag > env ? env * 0.65 + mag * 0.35 : env * 0.999 + mag * 0.001;
    out[i] = env < threshold ? sample * (env / threshold) : sample;
  }
  return out;
}

function highPass(input: Float32Array, freq: number, sampleRate: number): Float32Array {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.707);
  return biquad(input, (1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function lowPass(input: Float32Array, freq: number, sampleRate: number): Float32Array {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.707);
  return biquad(input, (1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function bandPass(input: Float32Array, low: number, high: number, sampleRate: number): Float32Array {
  return lowPass(highPass(input, low, sampleRate), high, sampleRate);
}

function biquad(
  input: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): Float32Array {
  const out = new Float32Array(input.length);
  const n0 = b0 / a0;
  const n1 = b1 / a0;
  const n2 = b2 / a0;
  const d1 = a1 / a0;
  const d2 = a2 / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] ?? 0;
    const y = n0 * x + n1 * x1 + n2 * x2 - d1 * y1 - d2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}
