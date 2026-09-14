/** Encode an AudioBuffer as a 16-bit mono WAV File for re-transcription. */
export function audioBufferToWavFile(buffer: AudioBuffer, filename: string): File {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / channels;
  }

  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * bytesPerSample;
  const header = 44;
  const out = new ArrayBuffer(header + dataSize);
  const view = new DataView(out);

  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)!);
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = header;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new File([out], filename.replace(/\.[^.]+$/, "") + ".wav", { type: "audio/wav" });
}
