import { describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { blockedReason, findAction, heroActions, useAction } from "../src/game/actions";
import { dist } from "../src/core/grid";
import { FINAL_DEPTH } from "../src/dungeon/generate";
import type { Actor, ClassId } from "../src/game/types";

/** A simple bot that plays whole runs: catches crashes and stalls, and gives a rough balance read. */
function playRun(cls: ClassId, seed: number): { depth: number; result: string; level: number; steps: number } {
  const g = Game.newRun(cls, seed);
  const prefer: Record<ClassId, string[]> = {
    fighter: ["action_surge", "attack"],
    rogue: ["attack", "throw_dagger"],
    wizard: ["fireball", "magic_missile", "fire_bolt", "attack"],
    cleric: ["turn_undead", "guiding_bolt", "sacred_flame", "attack"],
  };
  let steps = 0;
  while (!g.over && steps++ < 4000) {
    const h = g.hero;
    if (g.inCombat) {
      if (!g.isHeroTurn()) throw new Error("combat stalled on a monster turn");
      if (h.hp < h.maxHp * 0.5) {
        for (const id of ["second_wind", "healing_word", "potion"]) {
          const a = findAction(g, id);
          if (a && !blockedReason(g, a)) { useAction(g, id, null, null); break; }
        }
      }
      const foes = g.monsters.filter((m) => m.awake && g.isVisible(m.pos)).sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos));
      let acted = false;
      for (const id of prefer[cls]) {
        const a = heroActions(g).find((x) => x.id === id);
        if (!a || blockedReason(g, a) || g.over || !g.inCombat) continue;
        const t: Actor | undefined = a.targeting === "self" ? undefined : foes.find((f) => a.id === "attack" || dist(f.pos, h.pos) <= a.range);
        if (a.targeting !== "self" && !t) continue;
        const at = a.targeting === "area" && t ? t.pos : null;
        if (a.targeting === "area" && t && dist(t.pos, h.pos) <= (a.radius ?? 0)) continue;
        const meleeFoe = foes.some((f) => dist(f.pos, h.pos) <= 1);
        if (meleeFoe && a.toHit && a.range > 1 && heroActions(g).some((x) => x.id === "attack")) continue;
        const before = g.hero.actionUsed;
        useAction(g, id, t ?? null, at);
        if (g.hero.actionUsed !== before || g.over) { acted = true; break; }
      }
      if (!acted && foes.length === 0 && g.inCombat) {
        // Nobody in sight: walk toward the nearest awake foe.
        const m = g.monsters.filter((x) => x.awake).sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos))[0];
        if (m) { g.approach(m.pos); g.takeEvents(); }
      }
      if (g.inCombat && !g.over && g.isHeroTurn()) g.endTurn();
      continue;
    }
    // Exploring: rest when hurt, loot, then hunt, then stairs.
    if (h.hp < h.maxHp * 0.7 && !g.restBlocked()) { g.shortRest(); continue; }
    if (h.hp < h.maxHp * 0.5) {
      for (const id of ["second_wind", "cure_wounds", "potion"]) {
        const a = findAction(g, id);
        if (a && !blockedReason(g, a)) { useAction(g, id, null, null); break; }
      }
    }
    const chest = g.map.props.find((p) => p.kind === "chest" && !p.opened);
    if (chest) { g.openChest(chest); if (!chest.opened) chest.opened = true; continue; }
    const m = g.monsters.sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos))[0];
    if (m) {
      const before = { ...h.pos };
      g.approach(m.pos);
      g.takeEvents();
      if (!g.inCombat && before.x === h.pos.x && before.y === h.pos.y) m.dead = true; // unreachable: skip it
      continue;
    }
    if (g.depth >= FINAL_DEPTH) break;
    g.moveHero(g.map.stairs!);
    if (g.canDescend()) {
      while (g.hero.potions < 4 && g.buy("potion"));
      g.buy("weapon");
      g.buy("armor");
      while (g.buy("potion"));
      g.startFloor(g.depth + 1);
    }
  }
  if (steps >= 4000) throw new Error(`run stalled at depth ${g.depth}`);
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_DEBUG && g.over === "dead") {
    console.log(`${cls} died d${g.depth} L${g.hero.level} potions ${g.hero.potions} rested ${!!g.hero.flags.rested} awake foes: ${g.monsters.filter((m) => m.awake).map((m) => m.name).join(", ")}`);
  }
  return { depth: g.depth, result: g.over ?? "stopped", level: g.hero.level, steps };
}

describe("autoplay", () => {
  const classes: ClassId[] = ["fighter", "rogue", "wizard", "cleric"];
  for (const cls of classes) {
    it(`${cls}: whole runs finish without crashing or stalling`, () => {
      const results = [];
      for (let seed = 1; seed <= 12; seed++) results.push(playRun(cls, seed * 104729));
      const wins = results.filter((r) => r.result === "victory").length;
      const avgDepth = results.reduce((s, r) => s + r.depth, 0) / results.length;
      console.log(`${cls}: ${wins}/12 wins, average depth reached ${avgDepth.toFixed(1)}, levels ${results.map((r) => r.level).join(",")}`);
      expect(results.every((r) => r.result === "victory" || r.result === "dead")).toBe(true);
    });
  }
});
