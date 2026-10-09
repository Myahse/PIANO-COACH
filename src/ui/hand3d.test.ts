import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { bendFinger } from "./hand3d";

describe("bendFinger", () => {
  const lengths = [45, 26, 18];

  it("puts the fingertip on a key within reach, keeping the bones' lengths", () => {
    const base = new Vector3(100, 42, 200);
    const target = new Vector3(110, -4, 150);
    const points = bendFinger(base, target, lengths);
    expect(points).toHaveLength(4);
    expect(points[3]!.distanceTo(target)).toBeLessThan(1);
    for (let i = 0; i < 3; i++) expect(points[i]!.distanceTo(points[i + 1]!)).toBeCloseTo(lengths[i]!, 5);
  });

  it("curls like a pianist's finger — every joint bends down toward the key, none bends back", () => {
    const points = bendFinger(new Vector3(0, 42, 0), new Vector3(0, -4, -50), lengths);
    expect(points[1]!.y).toBeLessThan(points[0]!.y);
    expect(points[3]!.y).toBeLessThan(points[2]!.y);
    expect(points[2]!.y).toBeLessThan(points[1]!.y);
  });

  it("stretches toward a key out of reach instead of failing", () => {
    const base = new Vector3(0, 42, 0);
    const points = bendFinger(base, new Vector3(0, 0, -400), lengths);
    expect(points[3]!.z).toBeLessThan(-80);
  });
});
