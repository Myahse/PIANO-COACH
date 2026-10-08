import { describe, expect, it } from "vitest";
import { HandPlanner, fingerAt, keyPosition, planGroupsFromTimed } from "./fingering";

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
  it("splits at middle C when a one-hand lesson contains chords wider than a hand", () => {
    const planner = new HandPlanner();
    planner.setPlan([{ at: 0, notes: [48, 55, 64] }], "right");
    const pose = planner.update([48, 55, 64], 0);
    expect([...pose.left!.pressed.keys()].sort()).toEqual([48, 55]);
    expect([...pose.right!.pressed.keys()]).toEqual([64]);
  });
});
