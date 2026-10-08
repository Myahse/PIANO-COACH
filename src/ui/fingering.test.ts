import { describe, expect, it } from "vitest";
import { HandPlanner, MAX_SPAN, fingerAt, keyPosition, planGroupsFromTimed, reachable } from "./fingering";

describe("fingerAt", () => {
  it("numbers a five-finger position from the thumb", () => {
    expect([0, 1, 2, 3, 4].map((o) => fingerAt("right", o))).toEqual([1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4].map((o) => fingerAt("left", o))).toEqual([5, 4, 3, 2, 1]);
  });

  it("plays black keys with the finger above (right) / below (left) the gap", () => {
    expect(fingerAt("right", 0.5)).toBe(2);
    expect(fingerAt("left", 0.5)).toBe(4);
  });
});

describe("keyPosition", () => {
  it("puts black keys halfway between white neighbours", () => {
    expect(keyPosition(61)).toBe(keyPosition(60) + 0.5);
    expect(keyPosition(62)).toBe(keyPosition(60) + 1);
  });
});

describe("HandPlanner", () => {
  it("plays Hot Cross Buns (E D C) with RH 3 2 1, thumb on middle C", () => {
    const planner = new HandPlanner();
    planner.update([60]); // thumb lands on C
    const fingers = [64, 62, 60].map((note) => planner.update([note]).right!.pressed.get(note));
    expect(fingers).toEqual([3, 2, 1]);
  });

  it("plays C D E F G with RH 1 2 3 4 5 without moving the hand", () => {
    const planner = new HandPlanner();
    const anchors = new Set<number>();
    const fingers = [60, 62, 64, 65, 67].map((note) => {
      const pose = planner.update([note]).right!;
      anchors.add(pose.anchor);
      return pose.pressed.get(note);
    });
    expect(fingers).toEqual([1, 2, 3, 4, 5]);
    expect(anchors.size).toBe(1);
  });

  it("plays C3 with the left little finger once the hand sits in C position", () => {
    const planner = new HandPlanner();
    planner.update([55]); // thumb on G3 → little finger over C3
    expect(planner.update([48]).left!.pressed.get(48)).toBe(5);
  });

  it("shifts the hand only as far as needed when a note leaves the position", () => {
    const planner = new HandPlanner();
    const start = planner.update([60]).right!.anchor;
    const moved = planner.update([69]).right!; // A4 is past the little finger (G4)
    expect(moved.anchor).toBe(start + 1);
    expect(moved.pressed.get(69)).toBe(5);
  });

  it("splits hands at middle C and stretches for an octave chord", () => {
    const planner = new HandPlanner();
    const pose = planner.update([36, 48, 60, 64, 67, 72]);
    expect(pose.left!.pressed.get(36)).toBe(5);
    expect(pose.left!.pressed.get(48)).toBe(1);
    expect(pose.right!.pressed.get(60)).toBe(1);
    expect(pose.right!.pressed.get(72)).toBe(5);
    expect(pose.right!.span).toBe(7);
  });
});

describe("HandPlanner with a plan (look-ahead)", () => {
  const hotCrossBuns = [64, 62, 60, 64, 62, 60, 60, 60, 60, 60, 62, 62, 62, 62, 64, 62, 60];

  it("plays Hot Cross Buns from the first note as RH 3 2 1", () => {
    const planner = new HandPlanner();
    planner.setPlan(hotCrossBuns.map((note, i) => ({ at: i, notes: [note] })));
    const fingers = hotCrossBuns.slice(0, 3).map((note, i) => planner.update([note], i).right!.pressed.get(note));
    expect(fingers).toEqual([3, 2, 1]);
  });

  it("follows a song timeline: Twinkle opening E D C D E stays in C position", () => {
    const planner = new HandPlanner();
    const melody = [64, 62, 60, 62, 64, 64, 64];
    planner.setPlan(planGroupsFromTimed(melody.map((note, i) => ({ note, start: i * 0.5 }))));
    const fingers = melody.map((note, i) => planner.update([note], i * 0.5 + 0.1).right!.pressed.get(note));
    expect(fingers).toEqual([3, 2, 1, 2, 3, 3, 3]);
  });

  it("puts every note of a left-hand lesson in the left hand, even above middle C", () => {
    const planner = new HandPlanner();
    planner.setPlan([{ at: 0, notes: [60] }, { at: 1, notes: [62] }], "left");
    const pose = planner.update([60], 0);
    expect(pose.right!.pressed.size).toBe(0);
    expect(pose.left!.pressed.has(60)).toBe(true);
  });
});

describe("HandPlanner hand modes", () => {
  it("in a one-hand lesson keeps what that hand can reach and gives the rest to the other hand", () => {
    const planner = new HandPlanner();
    planner.setPlan([{ at: 0, notes: [48, 55, 64] }], "right");
    const pose = planner.update([48, 55, 64], 0);
    expect(pose.left!.pressed.has(48)).toBe(true);
    expect(pose.right!.pressed.has(64)).toBe(true);
    for (const hand of [pose.left!, pose.right!]) expect(reachable([...hand.pressed.keys()])).toBe(true);
  });
});

/** Every hand pose must be something a person can actually do. */
function expectHumanPose(pose: ReturnType<HandPlanner["update"]>): void {
  for (const hand of [pose.left, pose.right]) {
    if (!hand || hand.pressed.size === 0) continue;
    const keys = [...hand.pressed.keys()].sort((a, b) => a - b);
    const fingers = keys.map((k) => hand.pressed.get(k)!);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keyPosition(keys.at(-1)!) - keyPosition(keys[0]!)).toBeLessThanOrEqual(MAX_SPAN);
    expect(new Set(fingers).size).toBe(fingers.length); // one finger per key
    // Fingers in keyboard order: right hand 1→5 upward, left hand 5→1 upward.
    const ordered = hand.side === "right" ? fingers : [...fingers].reverse();
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!).toBeGreaterThan(ordered[i - 1]!);
  }
}

describe("HandPlanner stays within a human hand", () => {
  it("never stretches a hand past an octave or puts two keys on one finger", () => {
    const planner = new HandPlanner();
    const chords = [
      [36, 43, 48, 52, 55, 60, 64, 67, 72], // big spread chord across four octaves
      [41, 48, 57, 60, 65, 69, 72, 77],
      [38, 45, 50, 62, 66, 69, 74, 78, 81],
      [60, 62, 64, 65, 67, 69, 71], // seven-note cluster
    ];
    for (const chord of chords) expectHumanPose(planner.update(chord));
  });

  it("leaves out inner notes of a chord too wide for two hands, keeping bass and top", () => {
    const planner = new HandPlanner();
    const pose = planner.update([24, 36, 48, 60, 72, 84, 96]); // seven Cs, six octaves
    expectHumanPose(pose);
    const held = [...pose.left!.pressed.keys(), ...pose.right!.pressed.keys()];
    expect(held).toContain(24);
    expect(held).toContain(96);
    expect(pose.unreached.length).toBeGreaterThan(0);
  });

  it("lets go of keys left ringing on the pedal when the hand moves on", () => {
    const planner = new HandPlanner();
    // Arpeggio C3 G3 E4 C5 G5 under the pedal: every note keeps sounding.
    const arpeggio = [48, 55, 64, 72, 79];
    const sounding: number[] = [];
    let pose = planner.update([]);
    for (const note of arpeggio) {
      sounding.push(note);
      pose = planner.update([...sounding]);
      expectHumanPose(pose);
    }
    const fingered = [...pose.left!.pressed.keys(), ...pose.right!.pressed.keys()];
    expect(fingered).toContain(79);
    expect(fingered.length).toBeLessThan(arpeggio.length);
  });

  it("keeps holding a bass note while the other hand plays the melody", () => {
    const planner = new HandPlanner();
    planner.update([48]);
    for (const note of [64, 62, 60, 62]) {
      const pose = planner.update([48, note]);
      expect(pose.left!.pressed.has(48)).toBe(true);
      expect(pose.right!.pressed.has(note)).toBe(true);
    }
  });
});
