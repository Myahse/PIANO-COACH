import { FIRST_MIDI, isBlackKey } from "../music/notes";

export type HandSide = "left" | "right";
export type Finger = 1 | 2 | 3 | 4 | 5;
/** Which hand a lesson is written for; "both" (or null) lets each note go to the hand that can reach it. */
export type HandMode = "left" | "right" | "both" | null;

/** One hand's placement: fingers spread over white keys `anchor … anchor + span`. */
export type HandPose = {
  side: HandSide;
  /** Keyboard position (in white keys from the lowest key) of the hand's lowest finger. */
  anchor: number;
  /** Distance (in white keys) from lowest to highest finger — 4 at rest, up to MAX_SPAN stretched. */
  span: number;
  /** Keys this hand is holding right now, with the finger on each. */
  pressed: Map<number, Finger>;
};

export type HandsPose = {
  left: HandPose | null;
  right: HandPose | null;
  /** Newly struck notes no human hand could take (chord too wide or too many notes). */
  unreached: number[];
};

/** A moment in a song (seconds) or lesson (step index) and the notes that start there. */
export type PlanGroup = { at: number; notes: number[] };

/** Middle C — the natural boundary between the hands when nothing else decides. */
export const HAND_SPLIT = 60;
/**
 * Widest a hand stretches, thumb to little finger, in white-key steps: an octave
 * (e.g. C4–C5). Most adults can do this; a ninth or tenth needs a large hand.
 */
export const MAX_SPAN = 7;
const MAX_NOTES = 5;
/** How many upcoming note groups a hand looks at when it has to choose a new position. */
const LOOKAHEAD = 12;
/**
 * How far a hand can travel between notes: LEAP_BASE white keys at once plus LEAP_SPEED per second
 * of time it has. Jumps beyond that are what makes a passage unplayable at tempo.
 */
export const LEAP_BASE = 4;
export const LEAP_SPEED = 15;

/** Position of a key in white-key units; black keys sit halfway between their neighbours. */
export function keyPosition(midi: number): number {
  let whites = 0;
  for (let n = FIRST_MIDI; n < midi; n++) if (!isBlackKey(n)) whites += 1;
  return isBlackKey(midi) ? whites - 0.5 : whites;
}

/** Finger for a key at `offset` white keys above the hand's lowest finger (five-finger position). */
export function fingerAt(side: HandSide, offset: number): Finger {
  // A black key (half offset) takes the finger over the white key above it: C♯ is RH 2 / LH 4.
  const slot = Math.ceil(offset);
  const raw = side === "right" ? slot + 1 : 5 - slot;
  return Math.min(5, Math.max(1, raw)) as Finger;
}

function bounds(notes: number[]): { lo: number; hi: number } {
  const positions = notes.map(keyPosition);
  return { lo: Math.floor(Math.min(...positions)), hi: Math.ceil(Math.max(...positions)) };
}

/** Can one hand hold all of these at once? */
export function reachable(notes: number[]): boolean {
  if (notes.length === 0) return true;
  if (new Set(notes).size > MAX_NOTES) return false;
  const { lo, hi } = bounds(notes);
  return hi - lo <= MAX_SPAN;
}

function fits(notes: number[], anchor: number): boolean {
  const { lo, hi } = bounds(notes);
  return lo >= anchor && hi <= anchor + 4;
}

/** How far a five-finger position at `anchor` must move to cover `notes`. */
function moveCost(notes: number[], anchor: number): number {
  if (notes.length === 0) return 0;
  const { lo, hi } = bounds(notes);
  if (hi - lo > 4) return Math.abs(lo - anchor) * 0.5; // stretched: hand re-centres on the chord
  if (lo < anchor) return anchor - lo;
  if (hi > anchor + 4) return hi - (anchor + 4);
  return 0;
}

/** Resting places: right thumb on middle C, left little finger on the C below. */
const HOME: Record<HandSide, number> = { left: keyPosition(48), right: keyPosition(60) };
/** Beyond these, a note feels "far" for that hand (G4 for the left, E3 for the right). */
const COMFORT: Record<HandSide, number> = { left: keyPosition(67), right: keyPosition(52) };

/**
 * Give each finger its own key, in order along the keyboard (thumb lowest for the right hand,
 * highest for the left). Notes must already be within reach.
 */
function assignFingers(side: HandSide, notes: number[], anchor: number): Map<number, Finger> {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  const positions = sorted.map(keyPosition);
  const { lo, hi } = bounds(sorted);
  // Right-hand finger numbers rising left→right; the left hand is the mirror image.
  let rh: number[];
  if (hi - lo > 4) {
    rh = positions.map((p) => 1 + Math.round(((p - lo) / (hi - lo)) * 4));
  } else {
    rh = positions.map((p) => {
      const f = fingerAt("right", p - anchor);
      return side === "right" ? f : 6 - fingerAt("left", p - anchor);
    });
  }
  // Distinct and in order: never two notes on one finger, never fingers crossing.
  for (let i = 1; i < rh.length; i++) rh[i] = Math.max(rh[i]!, rh[i - 1]! + 1);
  for (let i = rh.length - 1; i >= 0; i--) rh[i] = Math.min(rh[i]!, MAX_NOTES - (rh.length - 1 - i));
  for (let i = 1; i < rh.length; i++) rh[i] = Math.max(rh[i]!, rh[i - 1]! + 1);
  const out = new Map<number, Finger>();
  sorted.forEach((note, i) => {
    const f = rh[i]!;
    out.set(note, (side === "right" ? f : 6 - f) as Finger);
  });
  return out;
}

/**
 * Decides where each hand sits and which finger plays each note — within what a human hand can do:
 * at most five notes per hand, each on its own finger, spanning no more than an octave.
 *
 * Each newly struck chord is split between the hands wherever both halves are reachable and the
 * hands move least. Keys already held stay under their fingers only while they still fit with the
 * new notes; otherwise the hand lets go (the sustain pedal keeps them ringing). With a plan (the
 * whole song or lesson known up front) a hand that has to move picks the five-finger position
 * that covers the most upcoming notes — so E D C starts as 3 2 1 over a C position.
 */
export class HandPlanner {
  private anchors: Record<HandSide, number | null> = { left: null, right: null };
  private holding: Record<HandSide, Set<number>> = { left: new Set(), right: new Set() };
  private plan: Record<HandSide, { at: number; anchor: number }[]> = { left: [], right: [] };
  private mode: HandMode = null;
  /** When each hand last struck a note (seconds or lesson step). */
  private lastAt: Record<HandSide, number | null> = { left: null, right: null };

  reset(): void {
    this.anchors = { left: null, right: null };
    this.lastAt = { left: null, right: null };
    this.holding = { left: new Set(), right: new Set() };
  }

  /** Pre-plan hand positions for a song or lesson; `mode` prefers one hand for every note. */
  setPlan(groups: PlanGroup[] | null, mode: HandMode = null): void {
    this.mode = mode;
    this.plan = { left: [], right: [] };
    this.reset();
    if (!groups) return;
    const sorted = [...groups].sort((a, b) => a.at - b.at);

    // Pass 1: decide which hand plays each note, moving hands the minimum along the way.
    const perSide: Record<HandSide, { at: number; notes: number[] }[]> = { left: [], right: [] };
    for (const group of sorted) {
      const { left, right } = this.split(group.notes, group.at);
      for (const [side, notes] of [["left", left], ["right", right]] as const) {
        if (notes.length === 0) continue;
        perSide[side].push({ at: group.at, notes });
        this.anchors[side] = this.shiftedAnchor(side, notes);
        this.lastAt[side] = group.at;
      }
    }

    // Pass 2: per hand, choose positions that cover the most upcoming notes.
    for (const side of ["left", "right"] as const) {
      const mine = perSide[side];
      let anchor: number | null = null;
      mine.forEach((group, i) => {
        const { lo, hi } = bounds(group.notes);
        if (hi - lo > 4) return; // stretched chord — keep the surrounding position
        if (anchor !== null && fits(group.notes, anchor)) return;
        anchor = this.choose(side, mine.slice(i, i + LOOKAHEAD).map((g) => g.notes), lo, hi, anchor);
        this.plan[side].push({ at: group.at, anchor });
      });
    }
    this.reset();
  }

  /** Default resting pose, or wherever the hands last were. */
  restingPose(): HandsPose {
    return {
      left: { side: "left", anchor: this.anchors.left ?? HOME.left, span: 4, pressed: new Map() },
      right: { side: "right", anchor: this.anchors.right ?? HOME.right, span: 4, pressed: new Map() },
      unreached: [],
    };
  }

  /**
   * Hand poses for the notes sounding now. Notes that were not sounding a moment ago are newly
   * struck; `at` (seconds or step) selects the planned position.
   */
  update(sounding: number[], at?: number): HandsPose {
    if (at !== undefined) {
      for (const side of ["left", "right"] as const) {
        const planned = this.plannedAnchor(side, at);
        if (planned !== null) this.anchors[side] = planned;
      }
    }
    const now = new Set(sounding);
    const wasHeld = new Set([...this.holding.left, ...this.holding.right]);
    // Sounding notes no hand was holding: newly struck (or released keys ringing on the pedal,
    // which simply stay out of the hands).
    const fresh = [...now].filter((note) => !wasHeld.has(note));
    const { left, right, unreached } = this.split(fresh, at);

    const result = this.restingPose();
    result.unreached = unreached;
    for (const [side, mine] of [["left", left], ["right", right]] as const) {
      // Keep holding keys that still sound and still fit with the new notes.
      let keys = [...mine];
      const held = [...this.holding[side]].filter((note) => now.has(note));
      const centre = mine.length ? mine.reduce((s, n) => s + n, 0) / mine.length : null;
      held.sort((a, b) => (centre === null ? 0 : Math.abs(a - centre) - Math.abs(b - centre)));
      for (const note of held) if (reachable([...keys, note])) keys.push(note);
      keys = [...new Set(keys)].sort((a, b) => a - b);
      this.holding[side] = new Set(keys);
      if (keys.length === 0) continue;

      const anchor = this.shiftedAnchor(side, keys);
      this.anchors[side] = anchor;
      if (mine.length > 0 && at !== undefined) this.lastAt[side] = at;
      const { lo, hi } = bounds(keys);
      const stretched = hi - lo > 4;
      result[side] = {
        side,
        anchor: stretched ? lo : anchor,
        span: stretched ? hi - lo : 4,
        pressed: assignFingers(side, keys, anchor),
      };
    }
    return result;
  }

  /**
   * Split newly struck notes between the hands. Every split point of the sorted chord is tried;
   * splits a hand cannot reach are skipped and the one needing the least hand movement wins.
   * If no split works (chord too wide for two hands), keep the outer notes — bass and melody —
   * and as many inner notes as fit.
   */
  private split(notes: number[], at?: number): { left: number[]; right: number[]; unreached: number[] } {
    const sorted = [...new Set(notes)].sort((a, b) => a - b);
    if (sorted.length === 0) return { left: [], right: [], unreached: [] };
    const best = this.bestSplit(sorted, at);
    if (best) return { ...best, unreached: [] };

    // Too wide: drop inner notes (nearest the middle of the chord first) until it can be played.
    const kept = [...sorted];
    const dropped: number[] = [];
    while (kept.length > 2) {
      const mid = (kept.length - 1) / 2;
      let idx = 1;
      for (let i = 1; i < kept.length - 1; i++) if (Math.abs(i - mid) < Math.abs(idx - mid)) idx = i;
      dropped.push(...kept.splice(idx, 1));
      const attempt = this.bestSplit(kept, at);
      if (attempt) return { ...attempt, unreached: dropped.sort((a, b) => a - b) };
    }
    // Even the two outer notes are out of reach of two hands (more than two octaves apart in
    // one hand's range) — give each hand its own end.
    const lowEnd = kept[0]!;
    const highEnd = kept[kept.length - 1]!;
    return { left: [lowEnd], right: highEnd === lowEnd ? [] : [highEnd], unreached: dropped };
  }

  private bestSplit(sorted: number[], at?: number): { left: number[]; right: number[] } | null {
    let best: { left: number[]; right: number[] } | null = null;
    let bestCost = Infinity;
    for (let s = 0; s <= sorted.length; s++) {
      const left = sorted.slice(0, s);
      const right = sorted.slice(s);
      if (!reachable(left) || !reachable(right)) continue;
      const cost = this.handCost("left", left, at) + this.handCost("right", right, at);
      if (cost < bestCost) {
        bestCost = cost;
        best = { left, right };
      }
    }
    return best;
  }

  private handCost(side: HandSide, notes: number[], at?: number): number {
    if (notes.length === 0) return 0;
    let cost = moveCost(notes, this.anchors[side] ?? HOME[side]);
    const positions = notes.map(keyPosition);
    // A hand that would have to jump further than it can in the time since its last note.
    const anchor = this.anchors[side];
    const last = this.lastAt[side];
    if (at !== undefined && anchor !== null && last !== null) {
      const centre = positions.reduce((s, p) => s + p, 0) / positions.length;
      const excess = Math.abs(centre - (anchor + 2)) - (LEAP_BASE + LEAP_SPEED * Math.max(0, at - last));
      if (excess > 0) cost += excess * 10;
    }
    // Prefer each hand on its own side of the keyboard.
    for (const p of positions) {
      if (side === "left" && p > COMFORT.left) cost += (p - COMFORT.left) * 0.75;
      if (side === "right" && p < COMFORT.right) cost += (COMFORT.right - p) * 0.75;
    }
    // A one-hand lesson keeps notes in that hand whenever it can reach them.
    if ((this.mode === "left" || this.mode === "right") && this.mode !== side) cost += 20 * notes.length;
    return cost;
  }

  /** Five-finger position for these notes, moving the hand as little as possible. */
  private shiftedAnchor(side: HandSide, notes: number[]): number {
    const { lo, hi } = bounds(notes);
    let anchor = this.anchors[side];
    if (anchor === null) anchor = side === "right" ? lo : hi - 4;
    if (hi - lo > 4) return lo;
    if (lo < anchor) anchor = lo;
    if (hi > anchor + 4) anchor = hi - 4;
    return anchor;
  }

  private plannedAnchor(side: HandSide, at: number): number | null {
    const steps = this.plan[side];
    let found: number | null = null;
    for (const step of steps) {
      if (step.at > at + 1e-6) break;
      found = step.anchor;
    }
    return found ?? steps[0]?.anchor ?? null;
  }

  /** Among positions containing the current notes, cover the longest run of upcoming groups. */
  private choose(side: HandSide, upcoming: number[][], lo: number, hi: number, previous: number | null): number {
    const from = previous ?? HOME[side];
    let best = lo;
    let bestScore = -1;
    let bestMove = Infinity;
    for (let a = hi - 4; a <= lo; a++) {
      let score = 0;
      for (const group of upcoming) {
        if (!fits(group, a)) break;
        score += 1;
      }
      const move = Math.abs(a - from);
      if (score > bestScore || (score === bestScore && move < bestMove)) {
        best = a;
        bestScore = score;
        bestMove = move;
      }
    }
    return best;
  }
}

/** Group a song's notes by onset (chords within 40 ms count as one moment). */
export function planGroupsFromTimed(notes: { note: number; start: number }[]): PlanGroup[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const groups: PlanGroup[] = [];
  for (const note of sorted) {
    const last = groups.at(-1);
    if (last && note.start - last.at < 0.04) last.notes.push(note.note);
    else groups.push({ at: note.start, notes: [note.note] });
  }
  return groups;
}
