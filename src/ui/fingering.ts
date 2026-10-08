import { FIRST_MIDI, isBlackKey } from "../music/notes";

export type HandSide = "left" | "right";
export type Finger = 1 | 2 | 3 | 4 | 5;
/** Which hand a lesson is written for; "both" (or null) splits at middle C. */
export type HandMode = "left" | "right" | "both" | null;

/** One hand's placement: five fingers over white keys `anchor … anchor + span`. */
export type HandPose = {
  side: HandSide;
  /** Keyboard position (in white keys from the lowest key) of the hand's lowest finger. */
  anchor: number;
  /** Distance (in white keys) from lowest to highest finger — 4 normally, more when stretching. */
  span: number;
  /** Notes currently pressed by this hand, with the finger used. */
  pressed: Map<number, Finger>;
};

export type HandsPose = { left: HandPose | null; right: HandPose | null };

/** A moment in a song (seconds) or lesson (step index) and the notes that start there. */
export type PlanGroup = { at: number; notes: number[] };

/** Middle C and above go to the right hand, below it to the left — the beginner convention. */
export const HAND_SPLIT = 60;
/** How many upcoming note groups a hand looks at when it has to choose a new position. */
const LOOKAHEAD = 12;

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

function fits(notes: number[], anchor: number): boolean {
  const { lo, hi } = bounds(notes);
  return lo >= anchor && hi <= anchor + 4;
}

/** Resting places: right thumb on middle C, left little finger on the C below. */
const HOME: Record<HandSide, number> = { left: keyPosition(48), right: keyPosition(60) };

/**
 * Decides where each hand sits and which finger plays each sounding note.
 *
 * With a plan (the whole song or lesson known up front) a hand that has to move picks the
 * five-finger position that covers the most upcoming notes — so E D C starts as 3 2 1 over a
 * C position instead of putting the thumb on E. Without a plan it shifts the minimum distance.
 * Wide chords (e.g. octaves) stretch the hand from thumb to little finger.
 */
export class HandPlanner {
  private anchors: Record<HandSide, number | null> = { left: null, right: null };
  private plan: Record<HandSide, { at: number; anchor: number }[]> = { left: [], right: [] };
  private mode: HandMode = null;

  reset(): void {
    this.anchors = { left: null, right: null };
  }

  /** Pre-plan hand positions for a song or lesson; `mode` pins every note to one hand. */
  setPlan(groups: PlanGroup[] | null, mode: HandMode = null): void {
    this.reset();
    this.plan = { left: [], right: [] };
    // A one-hand lesson only stays one-handed if every chord fits in a hand (≤ an octave);
    // otherwise (e.g. an imported song with a bass line) split the hands at middle C.
    const playable = (groups ?? []).every((group) => {
      if (group.notes.length === 0) return true;
      const { lo, hi } = bounds(group.notes);
      return hi - lo <= 7;
    });
    this.mode = playable ? mode : null;
    if (!groups) return;
    const sorted = [...groups].sort((a, b) => a.at - b.at);
    for (const side of ["left", "right"] as const) {
      const mine = sorted
        .map((group) => ({ at: group.at, notes: this.notesFor(side, group.notes) }))
        .filter((group) => group.notes.length > 0);
      let anchor: number | null = null;
      mine.forEach((group, i) => {
        const { lo, hi } = bounds(group.notes);
        if (hi - lo > 4) return; // stretched chord — keep the surrounding position
        if (anchor !== null && fits(group.notes, anchor)) return;
        anchor = this.choose(side, mine.slice(i, i + LOOKAHEAD).map((g) => g.notes), lo, hi, anchor);
        this.plan[side].push({ at: group.at, anchor });
      });
    }
  }

  /** Default resting pose, or wherever the hands last were. */
  restingPose(): HandsPose {
    return {
      left: { side: "left", anchor: this.anchors.left ?? HOME.left, span: 4, pressed: new Map() },
      right: { side: "right", anchor: this.anchors.right ?? HOME.right, span: 4, pressed: new Map() },
    };
  }

  /** Hand poses for the notes sounding now; `at` (seconds or step) selects the planned position. */
  update(notes: number[], at?: number): HandsPose {
    if (at !== undefined) {
      for (const side of ["left", "right"] as const) {
        const planned = this.plannedAnchor(side, at);
        if (planned !== null) this.anchors[side] = planned;
      }
    }
    const result = this.restingPose();
    for (const side of ["left", "right"] as const) {
      const mine = [...new Set(this.notesFor(side, notes))].sort((a, b) => a - b);
      if (mine.length > 0) result[side] = this.place(side, mine);
    }
    return result;
  }

  private notesFor(side: HandSide, notes: number[]): number[] {
    if (this.mode === "left" || this.mode === "right") return this.mode === side ? notes : [];
    return notes.filter((n) => (side === "right" ? n >= HAND_SPLIT : n < HAND_SPLIT));
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

  private place(side: HandSide, notes: number[]): HandPose {
    const positions = notes.map(keyPosition);
    const { lo, hi } = bounds(notes);
    const pressed = new Map<number, Finger>();

    if (hi - lo > 4) {
      // Stretch: lowest note under one end of the hand, highest under the other.
      const span = hi - lo;
      notes.forEach((note, i) => {
        const slot = Math.round(((positions[i]! - lo) / span) * 4);
        pressed.set(note, (side === "right" ? slot + 1 : 5 - slot) as Finger);
      });
      return { side, anchor: lo, span, pressed };
    }

    let anchor = this.anchors[side];
    if (anchor === null) anchor = side === "right" ? lo : hi - 4;
    if (lo < anchor) anchor = lo;
    if (hi > anchor + 4) anchor = hi - 4;
    this.anchors[side] = anchor;

    notes.forEach((note, i) => pressed.set(note, fingerAt(side, positions[i]! - anchor)));
    return { side, anchor, span: 4, pressed };
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
