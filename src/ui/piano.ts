import { FIRST_MIDI, LAST_MIDI, isBlackKey, noteLabel, octave } from "../music/notes";
import { HandPlanner, keyPosition, type Finger, type HandMode, type HandPose, type HandsPose, type PlanGroup } from "./fingering";
import { handSvg, type FingerTarget } from "./handArt";
import type { FingerBadge, Hands3D } from "./hand3d";
import { themeColor } from "./theme";

/** "real": lit 3D hands; "drawn": the flat illustrated hands (also the fallback without WebGL). */
export type HandStyle = "real" | "drawn";

export type KeyState = "idle" | "played" | "target" | "correct" | "wrong";

type PianoOptions = {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
};

const WINDOW_STARTS = [24, 36, 48, 60, 72, 84];
const WINDOW_SPAN = 24;

function snapWindow(note: number): number {
  const preferred = Math.floor(note / 12) * 12;
  const shifted = note >= preferred + 17 ? preferred - 12 : preferred;
  return WINDOW_STARTS.reduce((best, start) =>
    Math.abs(start - shifted) < Math.abs(best - shifted) ? start : best,
  );
}

function visibleWhitesBefore(midi: number, from: number): number {
  let count = 0;
  for (let n = from; n < midi; n++) {
    if (!isBlackKey(n)) count += 1;
  }
  return count;
}

export class PianoView {
  readonly root: HTMLElement;
  private keys = new Map<number, HTMLButtonElement>();
  private states = new Map<number, KeyState>();
  private held = new Set<number>();
  private startC = 60;
  private autoFollow = true;
  private layoutCache = new Map<number, { x: number; width: number; black: boolean }>();
  private layoutWidth = 0;
  private options: PianoOptions;
  private whiteTotal = 1;
  private planner = new HandPlanner();
  private handsOn = true;
  private handsLayer: SVGSVGElement | null = null;
  private lastPose: HandsPose | null = null;
  private handsResize: ResizeObserver | null = null;
  private lastHandNotes: number[] = [];
  private lastHandAt: number | undefined;
  private handStyle: HandStyle = "real";
  private hands3d: Hands3D | null = null;
  private hands3dState: "idle" | "loading" | "ready" | "failed" = "idle";

  constructor(options: PianoOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "piano-shell";
    this.root.innerHTML = `
      <div class="piano-toolbar">
        <button type="button" class="ghost jump" data-shift="-12" aria-label="Previous octave">◀</button>
        <div class="octave-picks" data-octaves></div>
        <p class="piano-range" data-range></p>
        <button type="button" class="ghost jump" data-shift="12" aria-label="Next octave">▶</button>
      </div>
      <div class="piano-bed">
        <div class="piano"></div>
      </div>
    `;

    this.buildOctavePicks();
    this.rebuild();
    this.bind();
  }

  setState(note: number, state: KeyState): void {
    this.states.set(note, state);
    this.paint(note);
  }

  clearHighlights(keepHeld = true): void {
    for (let note = FIRST_MIDI; note <= LAST_MIDI; note++) {
      if (keepHeld && this.held.has(note)) this.states.set(note, "played");
      else this.states.set(note, "idle");
      this.paint(note);
    }
    this.renderHands([]);
  }

  /** Show or hide the guide hands drawn over the keys. */
  setHandsVisible(on: boolean): void {
    this.handsOn = on;
    this.handsLayer?.classList.toggle("hidden", !on);
    this.hands3d?.canvas.classList.toggle("hidden", !on || this.handStyle !== "real");
    if (on) this.renderHands(this.lastHandNotes, true, this.lastHandAt);
  }

  /** Realistic 3D hands or the flat drawn ones. */
  setHandStyle(style: HandStyle): void {
    this.handStyle = style;
    this.hands3d?.canvas.classList.toggle("hidden", !this.handsOn || style !== "real");
    this.drawHands();
  }

  /**
   * Plan hand positions for the whole song or lesson so hands move ahead of the music.
   * `at` values are seconds (songs) or step indexes (lessons); pass null to clear.
   */
  setHandPlan(groups: PlanGroup[] | null, mode: HandMode = null): void {
    this.planner.setPlan(groups, mode);
    this.lastHandAt = groups?.[0]?.at;
    this.renderHands([], true);
  }

  setAutoFollow(on: boolean): void {
    this.autoFollow = on;
  }

  hold(note: number, on: boolean): void {
    if (on) {
      this.held.add(note);
      if (this.autoFollow) this.focusNote(note);
      this.states.set(note, this.states.get(note) === "target" ? "correct" : "played");
    } else {
      this.held.delete(note);
      if (this.states.get(note) === "played") this.states.set(note, "idle");
    }
    this.paint(note);
  }

  revealTargets(notes: number[], at?: number): void {
    for (const [note, state] of this.states) {
      if (state === "target") this.states.set(note, this.held.has(note) ? "played" : "idle");
    }
    for (const note of notes) {
      if (!this.held.has(note)) this.states.set(note, "target");
    }
    const first = notes[0];
    if (first !== undefined) this.focusNote(first);
    this.paintAll();
    this.renderHands(notes, false, at);
  }

  focusNote(_note: number): void {
    return;
  }

  fitNotes(_notes: number[]): void {
    return;
  }

  covers(note: number): boolean {
    return this.isVisible(note);
  }

  lightTargets(notes: number[], at?: number): void {
    const wanted = new Set(notes);
    let dirty = false;
    for (const [note, state] of this.states) {
      if (wanted.has(note) || this.held.has(note)) continue;
      if (state === "target" || state === "correct" || state === "wrong") {
        this.states.set(note, "idle");
        dirty = true;
      }
    }
    for (const note of notes) {
      const state = this.states.get(note);
      if (state === "correct" || state === "wrong" || this.held.has(note)) continue;
      if (state !== "target") {
        this.states.set(note, "target");
        dirty = true;
      }
    }
    if (dirty) this.paintAll();
    this.renderHands(notes, false, at);
  }

  invalidateLayout(): void {
    this.layoutWidth = 0;
    this.layoutCache.clear();
  }

  virtualLayout(width: number): Map<number, { x: number; width: number; black: boolean }> {
    const rounded = Math.round(width);
    if (rounded > 0 && rounded === this.layoutWidth && this.layoutCache.size > 0) {
      return this.layoutCache;
    }
    const layout = new Map<number, { x: number; width: number; black: boolean }>();
    const { from, to } = this.range();
    let whiteTotal = 0;
    for (let midi = from; midi <= to; midi++) {
      if (!isBlackKey(midi)) whiteTotal += 1;
    }
    if (whiteTotal === 0 || width <= 0) return layout;
    const whiteW = width / whiteTotal;
    let whiteIndex = 0;
    for (let midi = from; midi <= to; midi++) {
      if (isBlackKey(midi)) {
        const left = visibleWhitesBefore(midi, from);
        const edge = left * whiteW - whiteW * 0.34;
        const width = whiteW * 0.62;
        layout.set(midi, {
          x: edge + width / 2,
          width,
          black: true,
        });
      } else {
        const gap = 1;
        layout.set(midi, {
          x: whiteIndex * whiteW + whiteW / 2,
          width: Math.max(10, whiteW - gap),
          black: false,
        });
        whiteIndex += 1;
      }
    }
    this.layoutWidth = rounded;
    this.layoutCache = layout;
    return layout;
  }

  focusSpan(notes: number[]): void {
    if (notes.length === 0) return;
    const lo = Math.min(...notes);
    const hi = Math.max(...notes);
    const covering = WINDOW_STARTS.filter((start) => lo >= start && hi <= start + WINDOW_SPAN);
    if (covering.length === 0) {
      this.focusNote(lo);
      return;
    }
    const mid = (lo + hi) / 2;
    const start = covering.reduce((best, item) => {
      const bestMid = best + WINDOW_SPAN / 2;
      const itemMid = item + WINDOW_SPAN / 2;
      return Math.abs(itemMid - mid) < Math.abs(bestMid - mid) ? item : best;
    });
    this.setWindow(start);
  }

  centerOnMiddleC(): void {
    this.setWindow(60);
  }

  pianoElement(): HTMLElement | null {
    const piano = this.root.querySelector(".piano");
    return piano instanceof HTMLElement ? piano : null;
  }

  keyLayout(): Map<number, { x: number; width: number; black: boolean }> {
    const piano = this.pianoElement();
    if (!piano || piano.clientWidth <= 0) return new Map();
    return this.virtualLayout(piano.clientWidth);
  }

  private setWindow(startC: number): void {
    const next = WINDOW_STARTS.includes(startC) ? startC : snapWindow(startC);
    if (next === this.startC) {
      this.syncToolbar();
      return;
    }
    this.startC = next;
    this.syncToolbar();
  }

  private range(): { from: number; to: number } {
    return { from: FIRST_MIDI, to: LAST_MIDI };
  }

  private isVisible(note: number): boolean {
    const { from, to } = this.range();
    return note >= from && note <= to;
  }

  private rebuild(): void {
    const piano = this.root.querySelector(".piano");
    if (!(piano instanceof HTMLElement)) return;
    piano.replaceChildren();
    this.keys.clear();

    const { from, to } = this.range();
    const whites = document.createElement("div");
    whites.className = "white-keys";
    const blacks = document.createElement("div");
    blacks.className = "black-keys";

    let whiteTotal = 0;
    for (let midi = from; midi <= to; midi++) {
      if (!isBlackKey(midi)) whiteTotal += 1;
    }

    for (let midi = from; midi <= to; midi++) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = isBlackKey(midi) ? "key black" : "key white";
      key.dataset.note = String(midi);
      key.setAttribute("aria-label", noteLabel(midi));
      const showOctave = !isBlackKey(midi) && midi % 12 === 0;
      key.innerHTML = showOctave ? `<span>C${octave(midi)}</span>` : "";

      if (isBlackKey(midi)) {
        const left = visibleWhitesBefore(midi, from);
        key.style.left = `calc((100% / ${whiteTotal}) * ${left} - (100% / ${whiteTotal}) * 0.34)`;
        key.style.width = `calc((100% / ${whiteTotal}) * 0.62)`;
        blacks.append(key);
      } else {
        whites.append(key);
      }

      this.keys.set(midi, key);
      if (!this.states.has(midi)) this.states.set(midi, "idle");
    }

    this.whiteTotal = Math.max(1, whiteTotal);
    this.handsLayer = this.buildHands();
    this.handsLayer.classList.toggle("hidden", !this.handsOn);
    piano.append(whites, blacks, this.handsLayer);
    this.invalidateLayout();
    this.syncToolbar();
    this.paintAll();
    this.renderHands(this.lastHandNotes, true);
  }

  private buildOctavePicks(): void {
    const host = this.root.querySelector("[data-octaves]");
    if (!(host instanceof HTMLElement)) return;
    host.innerHTML = WINDOW_STARTS.map((start) => {
      const label = `C${octave(start)}`;
      return `<button type="button" class="octave-pick" data-start="${start}">${label}</button>`;
    }).join("");
  }

  private syncToolbar(): void {
    const { from, to } = this.range();
    const range = this.root.querySelector("[data-range]");
    if (range) range.textContent = `${noteLabel(from)} – ${noteLabel(to)}`;

    this.root.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.start) === this.startC);
    });
  }

  private bind(): void {
    this.root.addEventListener("pointerdown", (event) => {
      const key = this.keyFromEvent(event);
      if (key === null) return;
      event.preventDefault();
      const target = event.target;
      if (target instanceof Element) {
        target.closest("button")?.setPointerCapture(event.pointerId);
      }
      this.options.onNoteOn(key, 96);
    });

    this.root.addEventListener("pointerup", (event) => {
      const key = this.keyFromEvent(event);
      if (key !== null) this.options.onNoteOff(key);
    });

    this.root.addEventListener("pointercancel", (event) => {
      const key = this.keyFromEvent(event);
      if (key !== null) this.options.onNoteOff(key);
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-shift]").forEach((button) => {
      button.addEventListener("click", () => {
        const shift = Number(button.dataset.shift);
        const index = WINDOW_STARTS.indexOf(this.startC);
        const next = WINDOW_STARTS[index + (shift < 0 ? -1 : 1)];
        if (next !== undefined) this.setWindow(next);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((button) => {
      button.addEventListener("click", () => {
        this.setWindow(Number(button.dataset.start));
      });
    });
  }

  private keyFromEvent(event: Event): number | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const key = target.closest(".key[data-note]");
    if (!(key instanceof HTMLElement)) return null;
    const note = Number(key.dataset.note);
    return Number.isFinite(note) ? note : null;
  }

  private buildHands(): SVGSVGElement {
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", "hands-layer");
    layer.setAttribute("aria-hidden", "true");
    // Redraw at the new size when the keyboard is resized.
    this.handsResize?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      this.handsResize = new ResizeObserver(() => this.drawHands());
      window.requestAnimationFrame(() => {
        const piano = this.pianoElement();
        if (piano) this.handsResize?.observe(piano);
      });
    }
    window.addEventListener("themechange", () => this.drawHands());
    return layer;
  }

  private renderHands(notes: number[], force = false, at?: number): void {
    const same =
      notes.length === this.lastHandNotes.length && notes.every((note, i) => note === this.lastHandNotes[i]);
    if (same && !force) return;
    this.lastHandNotes = [...notes];
    if (at !== undefined) this.lastHandAt = at;
    if (!this.handsOn || !this.handsLayer) return;
    // Between notes the hands still glide to the planned position for what comes next.
    this.lastPose = this.planner.update(notes, this.lastHandAt);
    this.drawHands();
  }

  /** Draw both hands for the last pose, sized to the keyboard as it is on screen. */
  private drawHands(): void {
    const layer = this.handsLayer;
    const piano = this.pianoElement();
    if (!layer || !piano || !this.handsOn) return;
    const width = piano.clientWidth;
    const height = piano.clientHeight;
    if (width <= 0 || height <= 0) return;
    const whiteW = width / this.whiteTotal;
    const resting = this.planner.restingPose();
    const pose = this.lastPose ?? resting;
    const hands = [pose.left ?? resting.left!, pose.right ?? resting.right!];
    layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const real = this.realHands(piano);
    if (real) {
      real.setSize(width, height, whiteW);
      real.setHands(
        hands.map((hand) => ({ side: hand.side, fingers: this.fingerTargets(hand, whiteW), active: hand.pressed.size > 0 })),
      );
      return;
    }
    layer.innerHTML = hands.map((hand) => this.handMarkup(hand, whiteW, height)).join("");
  }

  /** The 3D hands, ready and on this keyboard — or null to draw the flat ones (loading or no WebGL). */
  private realHands(piano: HTMLElement): Hands3D | null {
    if (this.handStyle !== "real") return null;
    if (this.hands3dState === "idle") {
      this.hands3dState = "loading";
      void import("./hand3d")
        .then(({ Hands3D }) => Hands3D.create())
        .then((hands) => {
          this.hands3d = hands;
          this.hands3dState = hands ? "ready" : "failed";
          if (hands) hands.onBadges = (badges) => this.drawBadges(badges);
          this.drawHands();
        });
    }
    const real = this.hands3d;
    if (!real || !this.handsLayer) return null;
    if (real.canvas.parentElement !== piano) piano.insertBefore(real.canvas, this.handsLayer);
    real.canvas.classList.toggle("hidden", !this.handsOn);
    return real;
  }

  /** Finger numbers on the playing fingers of the 3D hands. */
  private drawBadges(badges: FingerBadge[]): void {
    const layer = this.handsLayer;
    const piano = this.pianoElement();
    if (!layer || !piano || this.handStyle !== "real") return;
    const r = Math.max(6, Math.min(8.5, (piano.clientWidth / this.whiteTotal) * 0.32));
    layer.innerHTML = badges
      .map((badge) => {
        const accent = themeColor(badge.side === "left" ? "--left-hand" : "--right-hand", badge.side === "left" ? "#0ea5e9" : "#6366f1");
        return `<circle cx="${badge.x.toFixed(1)}" cy="${badge.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${accent}" stroke="#fff" stroke-width="1.4"/>
          <text x="${badge.x.toFixed(1)}" y="${(badge.y + r * 0.36).toFixed(1)}" text-anchor="middle" font-size="${(r * 1.05).toFixed(1)}" font-weight="700" fill="#fff">${badge.finger}</text>`;
      })
      .join("");
  }

  private handMarkup(pose: HandPose, whiteW: number, height: number): string {
    return handSvg({
      side: pose.side,
      fingers: this.fingerTargets(pose, whiteW),
      whiteW,
      height,
      active: pose.pressed.size > 0,
      accent: themeColor(pose.side === "left" ? "--left-hand" : "--right-hand", pose.side === "left" ? "#0ea5e9" : "#6366f1"),
    });
  }

  /** Where each fingertip goes: playing fingers on their keys, the others spread over the hand's span. */
  private fingerTargets(pose: HandPose, whiteW: number): FingerTarget[] {
    // Resting finger centres: evenly spread over the hand's span, on white-key centres.
    const xs = Array.from({ length: 5 }, (_, i) => pose.anchor + (i * pose.span) / 4 + 0.5);
    const pressedAt = new Map<number, number>();
    for (const [note, finger] of pose.pressed) {
      const idx = pose.side === "right" ? finger - 1 : 5 - finger;
      xs[idx] = keyPosition(note) + 0.5;
      pressedAt.set(idx, note);
    }
    return xs.map((x, idx) => {
      const note = pressedAt.get(idx);
      return {
        finger: (pose.side === "right" ? idx + 1 : 5 - idx) as Finger,
        x: x * whiteW,
        pressed: note !== undefined,
        onBlack: note !== undefined && isBlackKey(note),
      };
    });
  }

  private paintAll(): void {
    for (const note of this.keys.keys()) this.paint(note);
  }

  private paint(note: number): void {
    const key = this.keys.get(note);
    if (!key) return;
    const state = this.states.get(note) ?? "idle";
    key.dataset.state = state;
    key.classList.toggle("held", this.held.has(note));
  }
}
