export class Metronome {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private bpm = 80;
  private beat = 0;
  private onBeat: ((beat: number) => void) | null = null;

  setTempo(bpm: number): void {
    this.bpm = Math.min(200, Math.max(40, bpm));
    if (this.timer !== null) {
      this.stop();
      this.start(this.onBeat ?? undefined);
    }
  }

  getTempo(): number {
    return this.bpm;
  }

  start(onBeat?: (beat: number) => void): void {
    this.stop();
    this.onBeat = onBeat ?? null;
    this.context ??= new AudioContext();
    this.beat = 0;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), (60 / this.bpm) * 1000);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private tick(): void {
    this.click(this.beat % 4 === 0);
    this.onBeat?.(this.beat);
    this.beat += 1;
  }

  private click(accent: boolean): void {
    const context = this.context;
    if (!context) return;
    void context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(accent ? 0.16 : 0.1, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);
  }
}
