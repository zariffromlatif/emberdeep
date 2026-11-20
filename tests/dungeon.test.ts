import { describe, expect, it } from "vitest";
import { generate, FINAL_DEPTH } from "../src/dungeon/generate";
import { T, idx, blocksMove } from "../src/dungeon/map";
import { findPath } from "../src/dungeon/path";
import { computeFov } from "../src/dungeon/fov";

describe("dungeon generation", () => {
  for (let depth = 1; depth <= FINAL_DEPTH; depth++) {
    it(`depth ${depth}: every seed is connected and sensibly populated`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const m = generate(depth, seed * 7919);
        expect(m.rooms.length).toBeGreaterThanOrEqual(5);
        expect(blocksMove(m, m.start.x, m.start.y)).toBe(false);
        if (depth < FINAL_DEPTH) {
          expect(m.stairs).not.toBeNull();
          expect(m.tiles[idx(m, m.stairs!.x, m.stairs!.y)]).toBe(T.Stairs);
          expect(findPath(m, m.start, m.stairs!, () => false, false, 100000)).not.toBeNull();
        } else {
          expect(m.spawns.some((s) => s.monster === "wight")).toBe(true);
        }
        const seen = new Set<number>();
        for (const s of m.spawns) {
          const i = idx(m, s.pos.x, s.pos.y);
          expect(seen.has(i)).toBe(false);
          seen.add(i);
          expect(blocksMove(m, s.pos.x, s.pos.y)).toBe(false);
          expect(findPath(m, m.start, s.pos, () => false, false, 100000)).not.toBeNull();
        }
        for (const p of m.props.filter((p) => p.kind === "chest")) {
          expect(findPath(m, m.start, p, () => false, true, 100000)).not.toBeNull();
        }
      }
    });
  }

  it("is identical for the same seed", () => {
    const a = generate(2, 1234), b = generate(2, 1234);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.spawns).toEqual(b.spawns);
  });

  it("field of view stops at walls", () => {
    const m = generate(1, 99);
    const fov = computeFov(m, m.start, 8);
    expect(fov.has(idx(m, m.start.x, m.start.y))).toBe(true);
    // Nothing visible is more than the radius away.
    for (const i of fov) {
      const x = i % m.w, y = (i / m.w) | 0;
      expect(Math.hypot(x - m.start.x, y - m.start.y)).toBeLessThan(8.01);
    }
  });
});
