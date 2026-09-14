import { buildWaveformPeaks } from "../audio/waveform";
import { FIRST_MIDI, isBlackKey, LAST_MIDI, noteLabel } from "../music/notes";
import { playDuration, type TimedNote } from "../music/timed";

const ROW = 11;
const LABEL_W = 48;
const PAD = 8;
const WAVE_H = 56;
const TIME_SNAP = 0.05;
const MIN_NOTE = 0.06;

const COLORS = {
  left: "#4a90d9",
  right: "#e8a849",
  voice: "#b07ce8",
  neutral: "#f4efe6",
  neutralDark: "#6aa8c8",
  selected: "#ffffff",
  playhead: "#ff6b6b",
  wave: "rgba(244, 239, 230, 0.55)",
  waveBg: "rgba(244, 239, 230, 0.06)",
};

type NoteRect = { index: number; x: number; y: number; w: number; h: number };
type NoteKind = "left" | "right" | "voice" | "neutral";

export class NoteEditor {
  readonly root: HTMLElement;
  readonly waveCanvas: HTMLCanvasElement;
  readonly rollCanvas: HTMLCanvasElement;
  private notes: TimedNote[] = [];
  private leftHand = new Set<string>();
  private rightHand = new Set<string>();
  private voiceSet = new Set<string>();
  private selected = new Set<number>();
  private scrollX = 0;
  private pps = 120;
  private minPitch = FIRST_MIDI;
  private maxPitch = LAST_MIDI;
  private duration = 60;
  private playhead = 0;
  private audio: AudioBuffer | null = null;
  private peaks: Float32Array | null = null;
  private dirty = false;
  private dragIndex = -1;
  private dragOffset = { dt: 0, dp: 0 };
  private onChange: ((notes: TimedNote[]) => void) | null = null;
  private onSeek: ((time: number) => void) | null = null;
  private onPlayToggle: (() => void) | null = null;
  private saveTimer = 0;
  private resizeObserver: ResizeObserver | null = null;
  private playBtn: HTMLButtonElement;
  private timeLabel: HTMLElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "ss-editor hidden";
    this.root.innerHTML = `
      <div class="ss-transport">
        <button type="button" class="ss-play primary" data-editor-play aria-label="Play">▶</button>
        <span class="ss-time" data-editor-time>0:00 / 0:00</span>
        <div class="ss-transport-gap"></div>
        <button type="button" class="ghost" data-editor-delete>Delete note</button>
        <button type="button" class="ghost" data-editor-earlier>←</button>
        <button type="button" class="ghost" data-editor-later>→</button>
        <div class="ss-legend">
          <span><i class="lh"></i> Left</span>
          <span><i class="rh"></i> Right</span>
          <span><i class="voc"></i> Vocal</span>
        </div>
      </div>
    `;
    this.waveCanvas = document.createElement("canvas");
    this.waveCanvas.className = "ss-wave";
    this.rollCanvas = document.createElement("canvas");
    this.rollCanvas.className = "ss-roll";
    this.rollCanvas.tabIndex = 0;
    this.rollCanvas.setAttribute("role", "application");
    this.rollCanvas.setAttribute("aria-label", "Piano roll review");
    this.root.append(this.waveCanvas, this.rollCanvas);

    this.playBtn = this.root.querySelector("[data-editor-play]") as HTMLButtonElement;
    this.timeLabel = this.root.querySelector("[data-editor-time]") as HTMLElement;

    this.bindToolbar();
    this.bindCanvas();
    this.resizeObserver = new ResizeObserver(() => this.redraw());
    this.resizeObserver.observe(this.rollCanvas);
    if (this.rollCanvas.parentElement) this.resizeObserver.observe(this.rollCanvas.parentElement);
  }

  onNotesChange(handler: (notes: TimedNote[]) => void): void {
    this.onChange = handler;
  }

  onSeekRequest(handler: (time: number) => void): void {
    this.onSeek = handler;
  }

  onPlayRequest(handler: () => void): void {
    this.onPlayToggle = handler;
  }

  load(
    notes: TimedNote[],
    songDuration: number,
    audio?: AudioBuffer,
    audioOffset = 0,
    layers?: { left?: TimedNote[]; right?: TimedNote[]; voice?: TimedNote[] },
  ): void {
    this.notes = notes.map((note) => ({ ...note }));
    this.duration = Math.max(songDuration, 1);
    this.audio = audio ?? null;
    this.peaks = audio ? buildWaveformPeaks(audio) : null;
    void audioOffset;
    this.selected.clear();
    this.dirty = false;
    this.dragIndex = -1;
    this.playhead = 0;
    this.playBtn.textContent = "▶";

    this.leftHand = new Set((layers?.left ?? []).map((n) => noteKey(n)));
    this.rightHand = new Set((layers?.right ?? []).map((n) => noteKey(n)));
    this.voiceSet = new Set((layers?.voice ?? []).map((n) => noteKey(n)));

    const pitches = this.notes.map((note) => note.note);
    if (pitches.length) {
      this.minPitch = Math.max(FIRST_MIDI, Math.min(...pitches) - 6);
      this.maxPitch = Math.min(LAST_MIDI, Math.max(...pitches) + 6);
    } else {
      this.minPitch = 48;
      this.maxPitch = 84;
    }
    this.scrollX = 0;
    this.updateTimeLabel();
    this.redraw();
  }

  getNotes(): TimedNote[] {
    return this.notes.map((note) => ({ ...note }));
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  setPlayhead(time: number, playing: boolean): void {
    this.playhead = Math.max(0, time);
    this.playBtn.textContent = playing ? "⏸" : "▶";
    this.updateTimeLabel();
    this.redraw();
  }

  deleteSelected(): void {
    if (this.selected.size === 0) return;
    this.notes = this.notes.filter((_, index) => !this.selected.has(index));
    this.selected.clear();
    this.markDirty();
  }

  nudgeTime(delta: number): void {
    if (this.selected.size === 0) return;
    for (const index of this.selected) {
      const note = this.notes[index];
      if (!note) continue;
      note.start = Math.max(0, snapTime(note.start + delta));
    }
    this.markDirty();
  }

  nudgePitch(delta: number): void {
    if (this.selected.size === 0) return;
    for (const index of this.selected) {
      const note = this.notes[index];
      if (!note) continue;
      note.note = Math.min(LAST_MIDI, Math.max(FIRST_MIDI, note.note + delta));
    }
    this.markDirty();
  }

  focus(): void {
    this.rollCanvas.focus();
  }

  private bindToolbar(): void {
    this.playBtn.addEventListener("click", () => this.onPlayToggle?.());
    this.root.querySelector("[data-editor-delete]")?.addEventListener("click", () => this.deleteSelected());
    this.root.querySelector("[data-editor-earlier]")?.addEventListener("click", () => this.nudgeTime(-TIME_SNAP));
    this.root.querySelector("[data-editor-later]")?.addEventListener("click", () => this.nudgeTime(TIME_SNAP));
  }

  private bindCanvas(): void {
    let panning = false;
    let panStart = { x: 0, scroll: 0 };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY < 0 ? 1.08 : 0.92;
        const rect = this.rollCanvas.getBoundingClientRect();
        const anchor = event.clientX - rect.left - LABEL_W;
        const timeAtAnchor = (anchor + this.scrollX) / this.pps;
        this.pps = Math.min(280, Math.max(36, this.pps * factor));
        this.scrollX = Math.max(0, timeAtAnchor * this.pps - anchor);
      } else if (event.shiftKey) {
        this.scrollX = Math.max(0, this.scrollX + event.deltaY);
      } else {
        this.scrollX = Math.max(0, this.scrollX + event.deltaX + event.deltaY * 0.25);
      }
      this.redraw();
    };

    this.waveCanvas.addEventListener("wheel", handleWheel, { passive: false });
    this.rollCanvas.addEventListener("wheel", handleWheel, { passive: false });

    this.rollCanvas.addEventListener("keydown", (event) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.deleteSelected();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.nudgeTime(-TIME_SNAP);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.nudgeTime(TIME_SNAP);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this.nudgePitch(-1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.nudgePitch(1);
      } else if (event.key === " ") {
        event.preventDefault();
        this.onPlayToggle?.();
      }
    });

    const scrubAt = (localX: number): void => {
      const time = Math.max(0, Math.min(this.duration, this.xToTime(localX)));
      this.playhead = time;
      this.onSeek?.(time);
      this.updateTimeLabel();
      this.redraw();
    };

    this.waveCanvas.addEventListener("mousedown", (event) => {
      scrubAt(event.offsetX);
    });

    this.rollCanvas.addEventListener("mousedown", (event) => {
      this.rollCanvas.focus();
      const hit = this.hitTest(event.offsetX, event.offsetY);
      if (hit >= 0) {
        if (!event.shiftKey) this.selected.clear();
        this.selected.add(hit);
        this.dragIndex = hit;
        const note = this.notes[hit]!;
        this.dragOffset = {
          dt: this.xToTime(event.offsetX) - note.start,
          dp: this.yToPitch(event.offsetY) - note.note,
        };
        this.redraw();
        return;
      }
      if (event.altKey || event.metaKey) {
        scrubAt(event.offsetX);
        return;
      }
      if (!event.shiftKey) this.selected.clear();
      panning = true;
      panStart = { x: event.clientX, scroll: this.scrollX };
      this.redraw();
    });

    window.addEventListener("mousemove", (event) => {
      const rect = this.rollCanvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (this.dragIndex >= 0) {
        const note = this.notes[this.dragIndex];
        if (!note) return;
        note.start = Math.max(0, snapTime(this.xToTime(localX) - this.dragOffset.dt));
        note.note = Math.min(
          LAST_MIDI,
          Math.max(FIRST_MIDI, this.yToPitch(localY) - this.dragOffset.dp),
        );
        this.markDirty();
        return;
      }
      if (panning) {
        this.scrollX = Math.max(0, panStart.scroll - (event.clientX - panStart.x));
        this.redraw();
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.dragIndex >= 0) {
        const note = this.notes[this.dragIndex];
        if (note) note.duration = Math.max(MIN_NOTE, note.duration);
        this.dragIndex = -1;
        this.redraw();
      }
      panning = false;
    });
  }

  private markDirty(): void {
    this.dirty = true;
    this.redraw();
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.onChange?.(this.getNotes());
      this.dirty = false;
    }, 700);
  }

  private noteKind(note: TimedNote): NoteKind {
    const key = noteKey(note);
    if (this.voiceSet.has(key)) return "voice";
    if (this.leftHand.has(key)) return "left";
    if (this.rightHand.has(key)) return "right";
    if (note.note < 60) return "left";
    return "right";
  }

  private updateTimeLabel(): void {
    this.timeLabel.textContent = `${formatTime(this.playhead)} / ${formatTime(this.duration)}`;
  }

  redraw(): void {
    this.drawWaveform();
    this.drawRoll();
  }

  private drawWaveform(): void {
    const width = this.waveCanvas.clientWidth || 800;
    const height = WAVE_H;
    this.paintCanvas(this.waveCanvas, width, height, (ctx) => {
      ctx.fillStyle = "#0d0b09";
      ctx.fillRect(0, 0, width, height);
      const left = LABEL_W;
      const innerW = width - left;
      ctx.fillStyle = COLORS.waveBg;
      ctx.fillRect(left, 4, innerW, height - 8);

      if (this.peaks && this.audio) {
        const peaks = this.peaks;
        const span = this.duration;
        const bucketW = (span * this.pps) / peaks.length;
        ctx.fillStyle = COLORS.wave;
        for (let i = 0; i < peaks.length; i++) {
          const t = (i / peaks.length) * this.audio.duration;
          const x = left + t * this.pps - this.scrollX;
          if (x + bucketW < left || x > width) continue;
          const h = (peaks[i] ?? 0) * (height - 16);
          ctx.fillRect(x, height / 2 - h / 2, Math.max(1, bucketW * 0.85), h);
        }
      }

      this.drawPlayhead(ctx, width, height);
    });
  }

  private rollHeight(): number {
    return Math.max(180, this.rollCanvas.clientHeight || 320);
  }

  private drawRoll(): void {
    const width = this.rollCanvas.clientWidth || 800;
    const height = this.rollHeight();
    this.paintCanvas(this.rollCanvas, width, height, (ctx) => {
      ctx.fillStyle = "#100e0b";
      ctx.fillRect(0, 0, width, height);

      const gridTop = PAD;
      const gridBottom = height - PAD;
      const gridLeft = LABEL_W;
      const gridHeight = gridBottom - gridTop;

      for (let pitch = this.minPitch; pitch <= this.maxPitch; pitch++) {
        const y = this.pitchY(pitch, gridTop, gridHeight);
        ctx.fillStyle = isBlackKey(pitch) ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.018)";
        ctx.fillRect(gridLeft, y - ROW / 2, width - gridLeft, ROW);
        if (pitch % 12 === 0) {
          ctx.strokeStyle = "rgba(244, 239, 230, 0.07)";
          ctx.beginPath();
          ctx.moveTo(gridLeft, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(180, 168, 150, 0.7)";
        ctx.font = "500 10px Manrope, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(noteLabel(pitch), gridLeft - 6, y);
      }

      const beatStep = this.pps >= 150 ? 0.5 : 1;
      ctx.strokeStyle = "rgba(244, 239, 230, 0.05)";
      for (let t = 0; t <= this.duration + 1; t += beatStep) {
        const x = gridLeft + t * this.pps - this.scrollX;
        if (x < gridLeft || x > width) continue;
        ctx.beginPath();
        ctx.moveTo(x, gridTop);
        ctx.lineTo(x, gridBottom);
        ctx.stroke();
      }

      this.layoutNotes(gridTop, gridHeight).forEach(({ index, x, y, w, h }) => {
        const note = this.notes[index]!;
        const selected = this.selected.has(index);
        const kind = this.noteKind(note);
        ctx.fillStyle = selected
          ? COLORS.selected
          : kind === "left"
            ? COLORS.left
            : kind === "right"
              ? COLORS.right
              : kind === "voice"
                ? COLORS.voice
                : isBlackKey(note.note)
                  ? COLORS.neutralDark
                  : COLORS.neutral;
        ctx.globalAlpha = selected ? 1 : 0.92;
        roundRect(ctx, x, y - h / 2 + 1, w, h - 2, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          roundRect(ctx, x, y - h / 2 + 1, w, h - 2, 4);
          ctx.stroke();
        }
      });

      this.drawPlayhead(ctx, width, height);
    });
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const x = LABEL_W + this.playhead * this.pps - this.scrollX;
    if (x < LABEL_W - 2 || x > width) return;
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  private paintCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(ctx);
  }

  private layoutNotes(gridTop: number, gridHeight: number): NoteRect[] {
    const rects: NoteRect[] = [];
    this.notes.forEach((note, index) => {
      const x = LABEL_W + note.start * this.pps - this.scrollX;
      const w = Math.max(7, playDuration(note) * this.pps);
      const y = this.pitchY(note.note, gridTop, gridHeight);
      if (x + w < LABEL_W || x > (this.rollCanvas.clientWidth || 800)) return;
      rects.push({ index, x, y, w, h: ROW - 1 });
    });
    return rects;
  }

  private pitchY(pitch: number, gridTop: number, gridHeight: number): number {
    const span = this.maxPitch - this.minPitch || 1;
    return gridTop + ((this.maxPitch - pitch) / span) * gridHeight;
  }

  private yToPitch(y: number): number {
    const gridTop = PAD;
    const gridHeight = this.rollHeight() - PAD * 2;
    const span = this.maxPitch - this.minPitch || 1;
    return Math.round(this.maxPitch - ((y - gridTop) / gridHeight) * span);
  }

  private xToTime(x: number): number {
    return (x - LABEL_W + this.scrollX) / this.pps;
  }

  private hitTest(x: number, y: number): number {
    const gridTop = PAD;
    const gridHeight = this.rollHeight() - PAD * 2;
    const rects = this.layoutNotes(gridTop, gridHeight);
    for (let i = rects.length - 1; i >= 0; i--) {
      const rect = rects[i]!;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y - rect.h / 2 && y <= rect.y + rect.h / 2) {
        return rect.index;
      }
    }
    return -1;
  }
}

function noteKey(note: TimedNote): string {
  return `${note.note.toFixed(0)}@${note.start.toFixed(3)}`;
}

function snapTime(value: number): number {
  return Math.round(value / TIME_SNAP) * TIME_SNAP;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
