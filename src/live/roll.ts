import { octave } from "../music/notes";
import { tileDuration, type TimedNote } from "../music/timed";
import type { PianoView } from "../ui/piano";
import { COUNT_IN } from "./session";

const LOOKAHEAD = 3.2;
const MIN_ROLL_HEIGHT = 160;
/** Longest sustain still drawn — must cover held notes when searching the chart. */
const MAX_HELD_SEARCH = 48;

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

export class PianoRoll {
  readonly canvas: HTMLCanvasElement;
  private piano: PianoView;
  private shiftX = 0;
  private lastTime = 0;
  private lastHitY = 160;
  private lastPixelsPerSecond = 40;
  private onSeek: ((time: number) => void) | null = null;
  private alignFrame = 0;

  constructor(piano: PianoView) {
    this.piano = piano;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "piano-roll";
    this.canvas.setAttribute("aria-label", "Falling notes — click to jump in the song");
    this.canvas.style.cursor = "pointer";
    this.canvas.addEventListener("click", (event) => this.seekFromClick(event));
    const markLayoutDirty = (): void => {
      this.alignFrame = 0;
      this.piano.invalidateLayout();
    };
    window.addEventListener("resize", markLayoutDirty);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(markLayoutDirty);
      observer.observe(this.canvas);
    }
  }

  invalidateLayout(): void {
    this.alignFrame = 0;
    this.piano.invalidateLayout();
  }

  setSeekHandler(handler: ((time: number) => void) | null): void {
    this.onSeek = handler;
  }

  private seekFromClick(event: MouseEvent): void {
    if (!this.onSeek) return;
    const rect = this.canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const time = this.lastTime + (this.lastHitY - y) / this.lastPixelsPerSecond;
    this.onSeek(Math.max(0, time));
  }

  private syncAlignment(pianoEl: HTMLElement | null): void {
    this.alignFrame += 1;
    if (this.alignFrame !== 1 && this.alignFrame % 4 !== 0) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const pianoRect = pianoEl?.getBoundingClientRect();
    this.shiftX = pianoRect ? pianoRect.left - canvasRect.left : 0;
  }

  draw(notes: TimedNote[], time: number, judged: Set<number>): void {
    this.lastTime = time;
    const pianoEl = this.piano.pianoElement();
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || this.canvas.clientWidth || 800;
    const height = Math.max(MIN_ROLL_HEIGHT, parent?.clientHeight || this.canvas.clientHeight || 220);
    const ratio = window.devicePixelRatio || 1;
    const pixelW = Math.floor(width * ratio);
    const pixelH = Math.floor(height * ratio);
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.invalidateLayout();
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const hitY = height - 3;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#100e0b";
    ctx.fillRect(0, 0, width, height);

    const pixelsPerSecond = (hitY - 16) / LOOKAHEAD;
    this.lastHitY = hitY;
    this.lastPixelsPerSecond = pixelsPerSecond;
    this.syncAlignment(pianoEl);
    const shiftX = this.shiftX;
    const pianoWidth = pianoEl?.clientWidth ?? width;
    const layout = pianoWidth > 0 ? this.piano.virtualLayout(pianoWidth) : new Map();

    ctx.fillStyle = "rgba(232, 184, 109, 0.16)";
    ctx.fillRect(0, hitY - 7, width, 14);
    ctx.strokeStyle = "rgba(232, 184, 109, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(width, hitY);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, hitY);
    ctx.clip();

    drawOctaveGuides(ctx, layout, shiftX, hitY, width);

    if (time < 0) {
      ctx.fillStyle = "#e8b86d";
      ctx.font = "600 18px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(Math.max(1, Math.ceil(-time))), width / 2, 36);
    }

    let leftEdge = 16;
    let rightEdge = pianoWidth - 16;
    let lowMidi = 0;
    if (layout.size > 0) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      lowMidi = Number.POSITIVE_INFINITY;
      for (const [midi, slot] of layout) {
        if (slot.x < minX) minX = slot.x;
        if (slot.x > maxX) maxX = slot.x;
        if (midi < lowMidi) lowMidi = midi;
      }
      leftEdge = minX;
      rightEdge = maxX;
    }

    const visibleStart = time - 0.35;
    const visibleEnd = time + LOOKAHEAD + 0.35;
    const searchStart = Math.max(0, visibleStart - MAX_HELD_SEARCH);
    let index = lowerBoundByStart(notes, searchStart);
    for (; index < notes.length; index += 1) {
      const note = notes[index]!;
      if (note.start > visibleEnd) break;
      const visualDuration = tileDuration(note);
      const noteEnd = note.start + visualDuration;
      if (noteEnd < visibleStart) continue;
      const arrive = note.start - time;
      const leave = noteEnd - time;
      let top = hitY - leave * pixelsPerSecond;
      let bottom = hitY - arrive * pixelsPerSecond;
      if (bottom > hitY) bottom = hitY;
      if (top >= hitY || bottom < -40) continue;

      const key = layout.get(note.note);
      const off = !key;
      const x = key ? key.x : note.note < lowMidi ? leftEdge : rightEdge;
      const tileW = key ? Math.max(12, key.width * (key.black ? 0.88 : 0.78)) : 14;
      const done = judged.has(index);
      const active = time >= note.start - 0.04 && time <= noteEnd;
      const h = Math.max(8, bottom - top);
      const drawX = x + shiftX - tileW / 2;
      if (drawX + tileW < -8 || drawX > width + 8) continue;
      const rightHand = note.note >= 60;
      const handBase = rightHand ? "#e8b86d" : "#4a90d9";
      const handActive = rightHand ? "#f5d08a" : "#7eb6d6";
      ctx.globalAlpha = off ? 0.28 : 1;
      ctx.fillStyle = done
        ? "rgba(143, 206, 122, 0.82)"
        : active
          ? handActive
          : handBase;
      roundRect(ctx, drawX, top, tileW, h, key?.black ? 4 : 6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (time < -COUNT_IN + 0.05) {
      ctx.fillStyle = "rgba(244, 239, 230, 0.45)";
      ctx.font = "500 13px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Notes fall to the gold line with the song", width / 2, height / 2);
    }
  }
}

function drawOctaveGuides(
  ctx: CanvasRenderingContext2D,
  layout: Map<number, { x: number; width: number; black: boolean }>,
  shiftX: number,
  hitY: number,
  canvasWidth: number,
): void {
  for (const [midi, slot] of layout) {
    if (midi % 12 !== 0) continue;
    const x = slot.x + shiftX;
    if (x < -24 || x > canvasWidth + 24) continue;
    ctx.strokeStyle = "rgba(232, 184, 109, 0.22)";
    ctx.lineWidth = midi === 60 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, hitY);
    ctx.stroke();
    ctx.fillStyle = "rgba(232, 184, 109, 0.55)";
    ctx.font = "600 10px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`C${octave(midi)}`, x, 10);
  }
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
