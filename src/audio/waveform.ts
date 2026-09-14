/** Downsample audio to peak envelope for waveform display. */
export function buildWaveformPeaks(buffer: AudioBuffer, buckets = 1800): Float32Array {
  const channel = buffer.getChannelData(0);
  const secondChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const count = Math.max(1, Math.min(buckets, channel.length));
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(channel[j] ?? 0);
      const b = secondChannel ? Math.abs(secondChannel[j] ?? 0) : 0;
      peak = Math.max(peak, a, b);
    }
    peaks[i] = peak;
  }
  return peaks;
}
