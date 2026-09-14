import type { TimedNote } from "../music/timed";
import { guideDuration, pieceDuration, tileDuration } from "../music/timed";

function lowerBoundByStart(notes: TimedNote[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.start < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type LiveHit = "hit" | "miss" | "idle";

export type LiveSnapshot = {
  title: string;
  playing: boolean;
  finished: boolean;
  time: number;
  duration: number;
  hits: number;
  misses: number;
  combo: number;
  lastResult: LiveHit;
  notes: TimedNote[];
  judged: Set<number>;
  waiting: boolean;
  dueNotes: number[];
};

export const COUNT_IN = 1.2;
const WINDOW = 0.2;
/** If the player does not hit a due chord in time, continue so the song can finish. */
const WAIT_TIMEOUT = 5;

export class LiveSession {
  private notes: TimedNote[] = [];
  private title = "Live";
  private audioBuffer: AudioBuffer | null = null;
  private audioOffset = 0;
  private audioDurationSec = 0;
  private backing: AudioBufferSourceNode | null = null;
  private backingGain: GainNode | null = null;
  private guideScanIndex = 0;
  private missScanIndex = 0;
  private playing = false;
  private startedAt = 0;
  private pausedAt = -COUNT_IN;
  private hits = 0;
  private misses = 0;
  private combo = 0;
  private lastResult: LiveHit = "idle";
  private judged = new Set<number>();
  private startedGuide = new Set<number>();
  private guideCounts = new Map<number, number>();
  private lastGuideTime = -COUNT_IN;
  private hearSong = true;
  private hearNotes = true;
  private waitForPlayer = false;
  private waiting = false;
  private waitFrozenAt = 0;
  private waitStartedAt = 0;
  private context: AudioContext | null = null;
  private practiceSpeed = 1;
  private onGuide: ((note: number, on: boolean, velocity?: number) => void) | null = null;

  setPracticeSpeed(speed: number): void {
    this.practiceSpeed = Math.min(1, Math.max(0.5, speed));
  }

  practiceSpeedNow(): number {
    return this.practiceSpeed;
  }

  setGuide(handler: (note: number, on: boolean, velocity?: number) => void): void {
    this.onGuide = handler;
  }

  load(
    title: string,
    notes: TimedNote[],
    audio?: AudioBuffer,
    audioOffset = 0,
    audioDurationSec?: number,
  ): void {
    this.stop();
    this.title = title;
    this.notes = notes.map((note) => ({ ...note }));
    this.audioBuffer = audio ?? null;
    this.audioOffset = Math.max(0, audioOffset);
    this.audioDurationSec = audio?.duration ?? audioDurationSec ?? 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.lastResult = "idle";
    this.judged = new Set();
    this.resetGuideState();
    this.resetPlaybackCursors(-COUNT_IN);
    this.waiting = false;
    this.waitFrozenAt = -COUNT_IN;
    this.pausedAt = -COUNT_IN;
  }

  setWaitForPlayer(on: boolean): void {
    this.waitForPlayer = on;
    if (!on && this.waiting) this.leaveWait();
  }

  setHearSong(on: boolean): void {
    if (this.hearSong === on) return;
    this.hearSong = on;
    if (!this.playing) return;
    if (on) this.startBacking();
    else {
      this.backing?.stop();
      this.backing = null;
      this.backingGain = null;
    }
  }

  setHearNotes(on: boolean): void {
    if (this.hearNotes === on) return;
    this.hearNotes = on;
    if (!on) this.stopOpenGuides();
    this.updateBackingGain();
  }

  /** Map transcribed note velocity to guide piano loudness. */
  guideVelocity(noteVelocity?: number): number {
    if (!this.hearNotes) return 0;
    const fromNote = noteVelocity ?? 80;
    if (this.hearSong && this.audioBuffer) {
      return Math.round(Math.min(72, Math.max(40, fromNote * 0.52)));
    }
    return Math.round(Math.min(88, Math.max(48, fromNote * 0.82)));
  }

  hasSong(): boolean {
    return this.audioBuffer !== null;
  }

  playingNow(): boolean {
    return this.playing;
  }

  play(): void {
    if (this.notes.length === 0 && !this.audioBuffer) return;
    this.context ??= new AudioContext();
    void this.context.resume();
    this.startedAt = this.context.currentTime - this.pausedAt;
    this.lastGuideTime = this.pausedAt - 0.001;
    this.playing = true;
    this.startBacking();
  }

  pause(): void {
    this.pausedAt = this.time();
    this.playing = false;
    this.waiting = false;
    this.backing?.stop();
    this.backing = null;
    this.backingGain = null;
    this.stopOpenGuides();
  }

  stop(): void {
    this.playing = false;
    this.waiting = false;
    this.pausedAt = -COUNT_IN;
    this.backing?.stop();
    this.backing = null;
    this.backingGain = null;
    this.resetGuideState();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Jump to a song position (for review / editor scrubbing). */
  seek(time: number): void {
    const clamped = Math.max(-COUNT_IN, time);
    const wasPlaying = this.playing;
    this.pause();
    this.pausedAt = clamped;
    this.judged.clear();
    this.resetGuideState();
    this.resetPlaybackCursors(clamped);
    this.lastGuideTime = clamped - 0.001;
    this.waiting = false;
    if (wasPlaying) this.play();
  }

  /** Pitches whose tiles are active at `time` — avoids scanning the whole chart each frame. */
  activeTilePitches(time: number): number[] {
    const out: number[] = [];
    let i = lowerBoundByStart(this.notes, time - 0.04);
    while (i < this.notes.length) {
      const note = this.notes[i]!;
      if (note.start > time) break;
      if (time < note.start + tileDuration(note)) out.push(note.note);
      i += 1;
    }
    return out;
  }

  time(): number {
    if (this.waiting) return this.waitFrozenAt;
    if (!this.playing || !this.context) return this.pausedAt;
    return this.context.currentTime - this.startedAt;
  }

  tickWait(): void {
    if (!this.playing || !this.waitForPlayer) return;
    const now = this.time();
    if (this.waiting) {
      if (now - this.waitStartedAt >= WAIT_TIMEOUT) this.skipWaitGroup();
      return;
    }
    if (now < 0) return;
    const group = this.dueGroup(now, 0.03);
    if (group.length === 0) return;
    this.waiting = true;
    this.waitFrozenAt = now;
    this.waitStartedAt = now;
    this.backing?.stop();
    this.backing = null;
  }

  tickGuide(): void {
    if (!this.playing || !this.hearNotes || this.waiting) return;
    const now = this.time();
    const prev = this.lastGuideTime;
    this.lastGuideTime = now;

    for (const index of [...this.startedGuide]) {
      const note = this.notes[index];
      if (!note) continue;
      if (now >= note.start + guideDuration(note)) {
        this.guideOff(note.note);
        this.startedGuide.delete(index);
      }
    }

    const guideWindow = 0.08;
    if (now < prev) {
      this.guideScanIndex = lowerBoundByStart(this.notes, now - guideWindow);
    } else if (this.guideScanIndex > 0 && this.notes[this.guideScanIndex - 1]!.start >= now - guideWindow) {
      this.guideScanIndex = lowerBoundByStart(this.notes, now - guideWindow);
    }
    for (let index = this.guideScanIndex; index < this.notes.length; index += 1) {
      const note = this.notes[index]!;
      if (note.start > now) break;
      if (note.start <= prev) continue;
      if (note.start < now - guideWindow) continue;
      if (this.judged.has(index) || this.startedGuide.has(index)) continue;
      if (now >= note.start + guideDuration(note) + 0.02) continue;
      this.startedGuide.add(index);
      this.guideOn(note.note, note.velocity);
    }
    while (
      this.guideScanIndex < this.notes.length &&
      this.notes[this.guideScanIndex]!.start < now - guideWindow
    ) {
      this.guideScanIndex += 1;
    }
  }

  noteOn(midi: number): LiveHit {
    if (!this.playing || this.time() < -0.05) return "idle";
    const now = this.time();
    const group = this.dueGroup(now, WINDOW);
    const dueHit = group.find((item) => item.note.note === midi && !this.judged.has(item.index));
    if (dueHit) {
      this.judged.add(dueHit.index);
      this.guideOff(dueHit.note.note);
      this.startedGuide.delete(dueHit.index);
      this.hits += 1;
      this.combo += 1;
      this.lastResult = "hit";
      if (group.every((item) => this.judged.has(item.index))) this.leaveWait();
      return "hit";
    }
    if (this.waiting || this.waitForPlayer) return "idle";
    let best = -1;
    let bestDelta = WINDOW;
    this.notes.forEach((note, index) => {
      if (note.note !== midi || this.judged.has(index)) return;
      const delta = Math.abs(note.start - now);
      const held = now >= note.start - WINDOW && now <= note.start + note.duration + 0.04;
      if ((delta <= WINDOW || held) && delta <= bestDelta) {
        best = index;
        bestDelta = delta;
      }
    });
    if (best >= 0) {
      const hit = this.notes[best]!;
      this.judged.add(best);
      this.guideOff(hit.note);
      this.startedGuide.delete(best);
      this.hits += 1;
      this.combo += 1;
      this.lastResult = "hit";
      return "hit";
    }
    this.combo = 0;
    this.lastResult = "miss";
    this.misses += 1;
    return "miss";
  }

  snapshot(): LiveSnapshot {
    this.tickWait();
    if (!this.waitForPlayer) this.sweepMisses();
    const duration = pieceDuration(
      this.notes,
      this.audioBuffer ?? undefined,
      this.audioOffset,
      this.audioDurationSec,
    );
    const time = this.time();
    const finished = time >= duration + 0.45 && (this.notes.length > 0 || this.audioBuffer !== null);
    if (finished && this.playing) this.pause();
    return {
      title: this.title,
      playing: this.playing,
      finished,
      time,
      duration,
      hits: this.hits,
      misses: this.misses,
      combo: this.combo,
      lastResult: this.lastResult,
      notes: this.notes,
      judged: this.judged,
      waiting: this.waiting,
      dueNotes: this.dueGroup(time, this.waiting ? 0.03 : WINDOW).map((item) => item.note.note),
    };
  }

  private startBacking(): void {
    if (!this.hearSong || !this.audioBuffer || !this.context) return;
    const t = this.time();
    const when = this.context.currentTime + Math.max(0, -t);
    const offset = Math.max(0, t) + this.audioOffset;
    if (offset >= this.audioBuffer.duration) return;
    this.backing?.stop();
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    this.backingGain = gain;
    this.updateBackingGain();
    source.buffer = this.audioBuffer;
    source.playbackRate.value = this.practiceSpeed;
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start(when, offset);
    this.backing = source;
  }

  private updateBackingGain(): void {
    if (this.backingGain) {
      this.backingGain.gain.value = this.hearNotes ? 0.58 : 0.92;
    }
  }

  private dueGroup(now: number, lead = 0.03): { index: number; note: TimedNote }[] {
    let nextStart = Number.POSITIVE_INFINITY;
    this.notes.forEach((note, index) => {
      if (this.judged.has(index)) return;
      if (note.start < nextStart) nextStart = note.start;
    });
    if (!Number.isFinite(nextStart) || now + lead < nextStart) return [];
    return this.notes
      .map((note, index) => ({ note, index }))
      .filter((item) => !this.judged.has(item.index) && Math.abs(item.note.start - nextStart) <= 0.08);
  }

  private leaveWait(): void {
    if (!this.waiting) return;
    this.waiting = false;
    if (this.playing && this.context) {
      this.lastGuideTime = this.waitFrozenAt - 0.001;
      this.startedAt = this.context.currentTime - this.waitFrozenAt;
      this.startBacking();
    }
  }

  private skipWaitGroup(): void {
    const group = this.dueGroup(this.waitFrozenAt, 0.03);
    for (const item of group) {
      if (!this.judged.has(item.index)) {
        this.judged.add(item.index);
        this.misses += 1;
      }
    }
    this.combo = 0;
    this.leaveWait();
  }

  private sweepMisses(): void {
    if (!this.playing || this.time() < 0) return;
    const now = this.time();
    while (this.missScanIndex < this.notes.length) {
      const index = this.missScanIndex;
      const note = this.notes[index]!;
      if (now <= note.start + WINDOW + 0.14) break;
      this.missScanIndex += 1;
      if (this.judged.has(index)) continue;
      this.judged.add(index);
      this.misses += 1;
      this.combo = 0;
    }
  }

  private guideOn(note: number, velocity?: number): void {
    const count = this.guideCounts.get(note) ?? 0;
    this.guideCounts.set(note, count + 1);
    if (count === 0) this.onGuide?.(note, true, velocity);
  }

  private guideOff(note: number): void {
    const count = (this.guideCounts.get(note) ?? 0) - 1;
    if (count <= 0) {
      this.guideCounts.delete(note);
      this.onGuide?.(note, false);
    } else {
      this.guideCounts.set(note, count);
    }
  }

  private stopOpenGuides(): void {
    for (const index of this.startedGuide) {
      const note = this.notes[index];
      if (note) this.guideOff(note.note);
    }
    this.startedGuide.clear();
  }

  private resetGuideState(): void {
    this.stopOpenGuides();
    this.guideCounts.clear();
    this.lastGuideTime = -COUNT_IN;
  }

  private resetPlaybackCursors(fromTime: number): void {
    this.guideScanIndex = lowerBoundByStart(this.notes, fromTime - 0.1);
    this.missScanIndex = lowerBoundByStart(this.notes, fromTime - WINDOW - 0.2);
  }
}
