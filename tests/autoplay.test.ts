import { describe, expect, it } from "vitest";
import { playRun, type RunResult } from "./bot";
import type { ClassId } from "../src/game/types";

/**
 * Whole runs played by the competent-player bot (tests/bot.ts).
 * Seeds are fixed, so results are deterministic: these guard against crashes, stalls,
 * and accidental big swings in difficulty. Full report: BALANCE=1 npx vitest run tests/balance.test.ts
 */
const classes: ClassId[] = ["fighter", "rogue", "wizard", "cleric"];
const RUNS = 25;
const results = new Map<ClassId, RunResult[]>();
const runsFor = (cls: ClassId) => {
  if (!results.has(cls)) results.set(cls, Array.from({ length: RUNS }, (_, i) => playRun(cls, i * 7919 + 13)));
  return results.get(cls)!;
};

describe("autoplay", () => {
  for (const cls of classes) {
    it(`${cls}: whole runs finish without crashing or stalling`, () => {
      expect(runsFor(cls).filter((r) => r.result === "stalled")).toEqual([]);
    });
  }

  it("difficulty stays in the tuned band for a competent player", () => {
    const all = classes.flatMap(runsFor);
    const winRate = all.filter((r) => r.result === "victory").length / all.length;
    const depth1Deaths = all.filter((r) => r.result === "dead" && r.depth === 1).length / all.length;
    // Tuned target (Nov 2026): ~50% overall wins, depth 1 almost always survived.
    expect(winRate).toBeGreaterThan(0.3);
    expect(winRate).toBeLessThan(0.75);
    expect(depth1Deaths).toBeLessThan(0.1);
    for (const cls of classes) {
      const w = runsFor(cls).filter((r) => r.result === "victory").length / RUNS;
      expect(w, `${cls} win rate`).toBeGreaterThan(0.15);
    }
  }, 120_000);
});
