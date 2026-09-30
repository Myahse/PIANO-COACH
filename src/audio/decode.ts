/** Decode any audio File the browser supports into an AudioBuffer. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData((await file.arrayBuffer()).slice(0));
  } finally {
    void context.close();
  }
}
