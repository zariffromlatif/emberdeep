import { describe, it } from "vitest";
import { playRun, summarize } from "./bot";
import type { ClassId } from "../src/game/types";

/**
 * Difficulty report, run on demand:  BALANCE=1 npx vitest run tests/balance.test.ts
 * Plays N seeded runs per class with the competent-player bot.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const N = Number(env.BALANCE_RUNS ?? 60);

describe.skipIf(!env.BALANCE)("balance report", () => {
  it("prints win and death rates per class", () => {
    const classes = (env.BALANCE_CLASS ? env.BALANCE_CLASS.split(",") : ["fighter", "rogue", "wizard", "cleric"]) as ClassId[];
    const all = [];
    for (const cls of classes) {
      const rs = [];
      for (let i = 1; i <= N; i++) rs.push(playRun(cls, i * 7919 + 13));
      all.push(...rs);
      console.log(`${cls.padEnd(8)} ${summarize(rs)}`);
      if (env.BALANCE_VERBOSE) {
        const killers = new Map<string, number>();
        for (const r of rs) if (r.result === "dead") for (const k of new Set(r.killers)) killers.set(k, (killers.get(k) ?? 0) + 1);
        const minD = Number(env.BALANCE_MIN_DEPTH ?? 1);
        for (const r of rs.filter((x) => x.result === "dead" && x.depth >= minD).slice(0, 10)) {
          const f = r.lastFight!;
          console.log(`         d${r.depth} L${r.level}: fight began ${f.hp}/${f.maxHp} HP, ${f.potions} pots, rests ${f.restsUsed}, HD ${f.hitDice}, slots ${f.slots}, ${f.rounds} rounds vs ${f.foes.join(", ")}`);
        }
        console.log(`         killers: ${[...killers].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
      }
    }
    console.log(`overall  ${summarize(all)}`);
  }, 600_000);
});
