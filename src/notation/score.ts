import { isBlackKey } from "../music/notes";
import type { TimedNote } from "../music/timed";
import { accidentalForKey, beatGridMarkup, interpretForNotation, notationHeaderMarkup } from "./interpret";

type ScoreEvent = {
  start: number;
  duration: number;
  midi: number[];
};

const LETTER_STEPS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

function diatonicFromC0(midi: number): number {
  return Math.floor(midi / 12) * 7 + (LETTER_STEPS[midi % 12] ?? 0);
}

function staffY(midi: number, bass: boolean, gap: number, originY: number): number {
  const ref = bass ? 43 : 64;
  return originY - (diatonicFromC0(midi) - diatonicFromC0(ref)) * (gap / 2);
}

export class ScoreView {
  readonly root: HTMLElement;
  private events: ScoreEvent[] = [];
  private currentIndex = -1;
  private zoom = 1;
  private svgWidth = 640;
  private svgHeight = 230;
  private onZoom: ((zoom: number) => void) | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "score-scroll";
    this.root.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        this.setZoom(this.zoom + (event.deltaY < 0 ? 0.12 : -0.12));
      },
      { passive: false },
    );
  }

  onZoomChange(handler: (zoom: number) => void): void {
    this.onZoom = handler;
  }

  getZoom(): number {
    return this.zoom;
  }

  setZoom(zoom: number): void {
    this.zoom = Math.round(Math.min(2.6, Math.max(0.7, zoom)) * 100) / 100;
    this.applyZoom();
    this.onZoom?.(this.zoom);
  }

  zoomBy(step: number): void {
    this.setZoom(this.zoom + step);
  }

  render(notes: TimedNote[]): void {
    const interpreted = interpretForNotation(notes);
    this.events = interpreted.events.map((event) => ({
      start: event.start,
      duration: event.duration,
      midi: event.midi,
    }));
    this.currentIndex = -1;
    const beat = interpreted.beatDuration;
    const scoreKey = interpreted.key;
    const gap = 13;
    const left = 72;
    const trebleY = 72;
    const bassY = 168;
    const height = 230;

    let x = left;
    const xs: number[] = [];
    for (const event of this.events) {
      xs.push(x);
      x += Math.max(34, Math.min(110, (event.duration / beat) * 50));
    }
    const width = Math.max(640, x + 48);

    const lines = (origin: number) =>
      [0, 1, 2, 3, 4]
        .map((index) => `<line x1="20" y1="${origin - index * gap}" x2="${width - 12}" y2="${origin - index * gap}" />`)
        .join("");

    const heads = this.events
      .map((event, index) => {
        const cx = xs[index] ?? left;
        const chord = event.midi
          .map((midi) => {
            const bass = midi < 60;
            const origin = bass ? bassY : trebleY;
            const y = staffY(midi, bass, gap, origin);
            const stemUp = y > origin - gap * 2;
            const ledger = ledgerLines(midi, bass, cx, gap, origin);
            const accSymbol = isBlackKey(midi) ? accidentalForKey(midi, scoreKey) : null;
            const acc = accSymbol ? `<text class="acc" x="${cx - 16}" y="${y + 4}">${accSymbol}</text>` : "";
            const stem = stemUp
              ? `<line class="stem" x1="${cx + 7}" y1="${y}" x2="${cx + 7}" y2="${y - 32}" />`
              : `<line class="stem" x1="${cx - 7}" y1="${y}" x2="${cx - 7}" y2="${y + 32}" />`;
            return `${ledger}${acc}<ellipse class="head" cx="${cx}" cy="${y}" rx="8" ry="6" />${stem}`;
          })
          .join("");
        return `<g class="score-event" data-index="${index}" data-start="${event.start}" data-end="${event.start + event.duration}">${chord}</g>`;
      })
      .join("");

    const measureDuration = beat * interpreted.measureBeats;
    let lastMeasure = -1;
    const bars: string[] = [];
    this.events.forEach((event, index) => {
      const measure = Math.floor(event.start / measureDuration);
      if (measure > lastMeasure && index > 0) {
        const at = (xs[index] ?? left) - 8;
        bars.push(`<line class="bar" x1="${at}" y1="${trebleY - 4 * gap}" x2="${at}" y2="${bassY}" />`);
        lastMeasure = measure;
      } else if (index === 0) {
        lastMeasure = measure;
      }
    });

    const header = notationHeaderMarkup(interpreted, trebleY, gap);
    const beatGrid = beatGridMarkup(interpreted.events, xs, trebleY, bassY, gap);

    this.svgWidth = width;
    this.svgHeight = height;
    this.root.innerHTML = `
      <svg class="staff score" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sheet music">
        ${header}
        <text class="clef" x="28" y="${trebleY - gap}">G</text>
        <text class="clef" x="28" y="${bassY - gap * 3}">F</text>
        ${lines(trebleY)}
        ${lines(bassY)}
        <line class="brace" x1="16" y1="${trebleY - 4 * gap}" x2="16" y2="${bassY}" />
        ${beatGrid}
        ${bars.join("")}
        ${heads}
      </svg>
    `;
    this.applyZoom();
  }

  private applyZoom(): void {
    const svg = this.root.querySelector("svg");
    if (!(svg instanceof SVGElement)) return;
    svg.style.width = `${this.svgWidth * this.zoom}px`;
    svg.style.minWidth = `${this.svgWidth * this.zoom}px`;
    svg.style.height = `${this.svgHeight * this.zoom}px`;
  }

  setTime(time: number): void {
    let nowIndex = -1;
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      if (!event) continue;
      if (time >= event.start - 0.06 && time < event.start + event.duration) {
        nowIndex = i;
        break;
      }
      if (time < event.start - 0.06) break;
    }
    if (nowIndex === this.currentIndex) return;
    const previous = this.currentIndex;
    this.currentIndex = nowIndex;
    if (previous >= 0) {
      const old = this.root.querySelector(`.score-event[data-index="${previous}"]`);
      if (old instanceof SVGGElement) old.dataset.state = time >= (this.events[previous]?.start ?? 0) + (this.events[previous]?.duration ?? 0) ? "done" : "idle";
    }
    if (nowIndex >= 0) {
      const node = this.root.querySelector(`.score-event[data-index="${nowIndex}"]`);
      if (node instanceof SVGGElement) {
        node.dataset.state = "now";
        const parent = this.root;
        const mid = (node as SVGGElement).getBBox?.();
        if (mid && Number.isFinite(mid.x)) {
          parent.scrollLeft = Math.max(0, mid.x * this.zoom - parent.clientWidth * 0.35);
        }
      }
    }
  }
}

function ledgerLines(midi: number, bass: boolean, x: number, gap: number, originY: number): string {
  const y = staffY(midi, bass, gap, originY);
  const top = originY - 4 * gap;
  const bottom = originY;
  const marks: string[] = [];
  if (y > bottom + 1) {
    for (let line = bottom + gap; line <= y + 1; line += gap) {
      marks.push(`<line class="ledger" x1="${x - 14}" y1="${line}" x2="${x + 14}" y2="${line}" />`);
    }
  }
  if (y < top - 1) {
    for (let line = top - gap; line >= y - 1; line -= gap) {
      marks.push(`<line class="ledger" x1="${x - 14}" y1="${line}" x2="${x + 14}" y2="${line}" />`);
    }
  }
  return marks.join("");
}
