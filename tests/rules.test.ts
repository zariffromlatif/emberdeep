import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { parseDice, roll, rollD20 } from "../src/core/dice";
import { Game } from "../src/game/game";

describe("dice", () => {
  it("parses common expressions", () => {
    expect(parseDice("2d6+3")).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(parseDice("d20")).toEqual({ count: 1, sides: 20, bonus: 0 });
    expect(parseDice("1d4-1")).toEqual({ count: 1, sides: 4, bonus: -1 });
    expect(parseDice("5")).toEqual({ count: 0, sides: 0, bonus: 5 });
  });

  it("stays inside the possible range and doubles dice on a crit", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const r = roll(rng, "2d6+3");
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(15);
      expect(roll(rng, "1d8", 0, 2).rolls).toHaveLength(2);
    }
  });

  it("advantage keeps the higher die", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const r = rollD20(rng, 1, 0);
      expect(r.natural).toBe(Math.max(...r.dice));
      const d = rollD20(rng, 0, 1);
      expect(d.natural).toBe(Math.min(...d.dice));
      expect(rollD20(rng, 1, 1).dice).toHaveLength(1);
    }
  });

  it("is deterministic per seed", () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it("hit chance matches the d20 maths", () => {
    expect(Game.hitChance(5, 15, 0)).toBeCloseTo(0.55);
    expect(Game.hitChance(5, 15, 1)).toBeCloseTo(1 - 0.45 * 0.45);
    expect(Game.hitChance(20, 10, 0)).toBeCloseTo(0.95); // a 1 always misses
    expect(Game.hitChance(0, 30, 0)).toBeCloseTo(0.05); // a 20 always hits
  });
});
