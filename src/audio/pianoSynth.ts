type Voice = {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  stops: AudioScheduledSourceNode[];
};

const SAMPLE_MIDI = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];

const SAMPLE_NAMES = ["A", "C", "Ds", "Fs"] as const;

function sampleName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const index = SAMPLE_MIDI.indexOf(midi);
  const letter = SAMPLE_NAMES[((index % 4) + 4) % 4] ?? "C";
  return `${letter}${octave}`;
}

function nearestSample(midi: number): number {
  return SAMPLE_MIDI.reduce((best, candidate) =>
    Math.abs(candidate - midi) < Math.abs(best - midi) ? candidate : best,
  );
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function roomImpulse(context: AudioContext): AudioBuffer {
  const seconds = 1.8;
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.4;
    }
  }
  return buffer;
}

export class PianoSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private toneFilter: BiquadFilterNode | null = null;
  private voices = new Map<number, Voice>();
  private buffers = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private enabled = true;
  private ready = false;
  private useSamples = true;
  private sustain = false;
  private held = new Set<number>();
  private status: ((text: string) => void) | null = null;

  onStatus(handler: (text: string) => void): void {
    this.status = handler;
  }

  isReady(): boolean {
    return this.ready;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.releaseAll();
    else void this.warm();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    if (on) return;
    for (const note of [...this.voices.keys()]) {
      if (!this.held.has(note)) this.release(note, 0.85);
    }
  }

  async warm(): Promise<void> {
    if (this.loading) return this.loading;
    this.status?.("Loading piano…");
    this.loading = this.loadSamples();
    try {
      await this.loading;
      this.ready = true;
      this.status?.(this.useSamples ? "Sound on" : "Sound on (synth)");
    } catch {
      this.useSamples = false;
      this.ready = true;
      this.loading = null;
      this.status?.("Sound on (synth)");
    }
  }

  noteOn(note: number, velocity = 96): void {
    if (!this.enabled) return;
    this.held.add(note);
    void this.play(note, velocity);
  }

  noteOff(note: number): void {
    this.held.delete(note);
    if (this.sustain) return;
    this.release(note, 0.9);
  }

  private async play(note: number, velocity: number): Promise<void> {
    await this.warm();
    const context = this.ensure();
    void context.resume();
    this.release(note, 0.02);

    if (this.useSamples) {
      const root = nearestSample(note);
      const buffer = this.buffers.get(root);
      if (buffer) {
        this.playSample(context, note, root, buffer, velocity);
        return;
      }
    }
    this.playSynth(context, note, velocity);
  }

  private playSample(
    context: AudioContext,
    note: number,
    root: number,
    buffer: AudioBuffer,
    velocity: number,
  ): void {
    const now = context.currentTime;
    const vel = Math.min(127, Math.max(1, velocity)) / 127;
    const amp = 0.22 + vel * 0.78;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(amp * 0.72, now + 0.09);
    gain.connect(this.toneFilter ?? this.master ?? context.destination);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((note - root) / 12);
    source.connect(gain);
    source.start(now);
    this.voices.set(note, { source, gain, stops: [source] });
  }

  private playSynth(context: AudioContext, note: number, velocity: number): void {
    const now = context.currentTime;
    const vel = Math.min(127, Math.max(1, velocity)) / 127;
    const freq = midiToHz(note);
    const amp = 0.1 + vel * 0.28;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(amp * 0.55, now + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    gain.connect(this.toneFilter ?? this.master ?? context.destination);

    const partials = [
      { ratio: 1, weight: 1, type: "triangle" as OscillatorType },
      { ratio: 2, weight: 0.45, type: "sine" as OscillatorType },
      { ratio: 3, weight: 0.28, type: "sine" as OscillatorType },
      { ratio: 4.02, weight: 0.16, type: "sine" as OscillatorType },
      { ratio: 5.8, weight: 0.08, type: "sine" as OscillatorType },
    ];

    const stops: AudioScheduledSourceNode[] = [];
    for (const partial of partials) {
      const osc = context.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;
      const partialGain = context.createGain();
      partialGain.gain.value = partial.weight;
      osc.connect(partialGain);
      partialGain.connect(gain);
      osc.start(now);
      osc.stop(now + 2.5);
      stops.push(osc);
    }

    this.voices.set(note, { source: null, gain, stops });
  }

  private release(note: number, seconds: number): void {
    const voice = this.voices.get(note);
    const context = this.context;
    if (!voice || !context) return;
    this.voices.delete(note);
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    for (const node of voice.stops) {
      try {
        node.stop(now + seconds + 0.06);
      } catch {
        /* already stopped */
      }
    }
  }

  private releaseAll(): void {
    for (const note of [...this.voices.keys()]) this.release(note, 0.14);
    this.held.clear();
  }

  private async loadSamples(): Promise<void> {
    const context = this.ensure();
    const missing = SAMPLE_MIDI.filter((midi) => !this.buffers.has(midi));
    let loaded = 0;
    await Promise.all(
      missing.map(async (midi) => {
        try {
          const response = await fetch(`/piano/${sampleName(midi)}.mp3`);
          if (!response.ok) return;
          const data = await response.arrayBuffer();
          this.buffers.set(midi, await context.decodeAudioData(data.slice(0)));
          loaded += 1;
        } catch {
          /* sample missing */
        }
      }),
    );
    if (loaded < 4) {
      this.useSamples = false;
    }
  }

  private ensure(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.95;
      this.toneFilter = this.context.createBiquadFilter();
      this.toneFilter.type = "lowpass";
      this.toneFilter.frequency.value = 5200;
      this.toneFilter.Q.value = 0.6;
      const dry = this.context.createGain();
      const wet = this.context.createGain();
      dry.gain.value = 0.82;
      wet.gain.value = 0.24;
      const verb = this.context.createConvolver();
      verb.buffer = roomImpulse(this.context);
      this.master.connect(this.toneFilter);
      this.toneFilter.connect(dry);
      this.toneFilter.connect(verb);
      verb.connect(wet);
      dry.connect(this.context.destination);
      wet.connect(this.context.destination);
    }
    return this.context;
  }
}
