import { Game } from "../src/game/game";
import { affectedTiles, blockedReason, findAction, heroActions, useAction, validTarget, type HeroAction } from "../src/game/actions";
import { dist, type Pt } from "../src/core/grid";
import { FINAL_DEPTH } from "../src/dungeon/generate";
import { MONSTERS } from "../src/rules/monsters";
import type { Actor, ClassId } from "../src/game/types";

/**
 * A "competent player" bot: the yardstick for difficulty tuning.
 * It plays the way a careful person does: focus fire, heal before it's too late,
 * rest between fights, use each class's tricks, keep the wizard out of melee,
 * and shop for potions. It knows where monsters are (a human finds them by
 * exploring, which costs nothing in a turn-based game).
 */
export interface RunResult {
  cls: ClassId;
  seed: number;
  result: "victory" | "dead" | "stalled";
  depth: number;
  level: number;
  /** What was standing over the hero when it fell. */
  killers: string[];
  /** Hero state as the fatal fight began. */
  lastFight?: { hp: number; maxHp: number; potions: number; restsUsed: number; hitDice: number; slots: number; foes: string[]; rounds: number };
}

const can = (g: Game, id: string): HeroAction | null => {
  const a = heroActions(g).find((x) => x.id === id);
  return a && !blockedReason(g, a) ? a : null;
};

const use = (g: Game, id: string, t: Actor | null = null, at: Pt | null = null): boolean => {
  const a = can(g, id);
  if (!a || !validTarget(g, a, t, at)) return false;
  const before = JSON.stringify([g.hero.actionUsed, g.hero.bonusUsed, g.hero.attacksLeft, g.hero.slots, g.hero.potions, g.hero.featureUses, g.hero.pos]);
  useAction(g, id, t, at);
  return before !== JSON.stringify([g.hero.actionUsed, g.hero.bonusUsed, g.hero.attacksLeft, g.hero.slots, g.hero.potions, g.hero.featureUses, g.hero.pos]) || g.over !== null;
};

const isUndead = (m: Actor) => MONSTERS[m.def].traits.includes("undead");
const alive = (g: Game) => !g.over && g.inCombat && g.isHeroTurn();
const foesOf = (g: Game) => g.monsters.filter((m) => m.awake);
const adjacent = (g: Game) => foesOf(g).filter((m) => dist(m.pos, g.hero.pos) <= 1);

/** Weakest foe first (finish kills), then nearest. */
function pickTarget(g: Game, among: Actor[]): Actor | undefined {
  return [...among].sort((a, b) => a.hp - b.hp || dist(a.pos, g.hero.pos) - dist(b.pos, g.hero.pos))[0];
}

/** Best tile to aim an area spell: most foes hit, never the hero. */
function bestArea(g: Game, id: string, minHits: number): Pt | null {
  const a = findAction(g, id);
  if (!a) return null;
  let best: Pt | null = null;
  let bestN = minHits - 1;
  const aims: Pt[] = [];
  for (const m of foesOf(g)) {
    aims.push(m.pos);
    for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) aims.push({ x: m.pos.x + d.x, y: m.pos.y + d.y });
  }
  for (const at of aims) {
    if (!validTarget(g, a, null, at)) continue;
    const tiles = affectedTiles(g, a, at);
    if (tiles.some((t) => t.x === g.hero.pos.x && t.y === g.hero.pos.y)) continue;
    const n = tiles.filter((t) => g.actorAt(t.x, t.y)?.team === "enemy").length;
    if (n > bestN) { bestN = n; best = at; }
  }
  return best;
}

/** Walk to the reachable tile that is farthest from every foe (kiting / retreating). */
function retreat(g: Game): void {
  const reach = g.heroReach();
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (const [i] of reach) {
    const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
    const near = Math.min(...foesOf(g).map((m) => dist(m.pos, p)));
    const score = Math.min(near, 5) * 10 - reach.get(i)!.cost;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best) g.moveHero(best);
  g.takeEvents();
}

/** Close the distance until something is in range (but don't walk into melee as a caster). */
function closeIn(g: Game, range: number): void {
  const foes = foesOf(g);
  if (!foes.length) return;
  const reach = g.heroReach();
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (const [i, r] of reach) {
    const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
    const inRange = foes.filter((m) => dist(m.pos, p) <= range && g.los(p, m.pos)).length;
    const nearest = Math.min(...foes.map((m) => dist(m.pos, p)));
    const score = (inRange > 0 ? 100 : -nearest * 5) + (nearest >= 2 ? 10 : -20) - r.cost;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best) g.moveHero(best);
  g.takeEvents();
}

function emergencyHeal(g: Game): void {
  const h = g.hero;
  const frac = h.hp / h.maxHp;
  if (frac < 0.45) for (const id of ["second_wind", "healing_word", "potion"]) if (use(g, id)) break;
  if (h.hp / h.maxHp < 0.3) use(g, "cure_wounds");
}

function fighterTurn(g: Game): void {
  for (let i = 0; i < 4 && alive(g); i++) {
    const t = pickTarget(g, adjacent(g)) ?? pickTarget(g, foesOf(g));
    if (!t || !use(g, "attack", t, t.pos)) break;
  }
  if (alive(g) && foesOf(g).length && (foesOf(g).length >= 2 || (pickTarget(g, foesOf(g))?.hp ?? 0) > 6) && use(g, "action_surge")) {
    for (let i = 0; i < 2 && alive(g); i++) {
      const t = pickTarget(g, adjacent(g)) ?? pickTarget(g, foesOf(g));
      if (!t || !use(g, "attack", t, t.pos)) break;
    }
  }
}

function rogueTurn(g: Game): void {
  const h = g.hero;
  if (!adjacent(g).length) use(g, "hide");
  // Prefer a foe standing alone: one-on-one earns Sneak Attack.
  const foes = foesOf(g);
  const lonely = foes.filter((m) => foes.filter((o) => o !== m && dist(o.pos, m.pos) <= 2).length === 0);
  const t = pickTarget(g, adjacent(g)) ?? pickTarget(g, lonely) ?? pickTarget(g, foes);
  if (t && !use(g, "attack", t, t.pos)) {
    const r = pickTarget(g, foes.filter((m) => dist(m.pos, h.pos) <= 5 && g.los(h.pos, m.pos)));
    if (r) use(g, "throw_dagger", r, r.pos);
  }
  if (alive(g) && adjacent(g).length >= 2 && h.hp < h.maxHp * 0.6 && use(g, "disengage")) retreat(g);
}

function wizardTurn(g: Game): void {
  const h = g.hero;
  if (adjacent(g).length) {
    if (use(g, "misty_step", null, mistySpot(g))) { /* blinked away */ }
  }
  const fb = h.level >= 5 ? bestArea(g, "fireball", 2) : null;
  if (fb && use(g, "fireball", null, fb)) return;
  const cone = bestArea(g, "burning_hands", adjacent(g).length ? 1 : 2);
  if (cone && (adjacent(g).length || h.slots > 1) && use(g, "burning_hands", null, cone)) return;
  const inRange = foesOf(g).filter((m) => dist(m.pos, h.pos) <= 8 && g.los(h.pos, m.pos) && g.isVisible(m.pos));
  const t = pickTarget(g, inRange);
  if (!t) { closeIn(g, 7); const t2 = pickTarget(g, foesOf(g).filter((m) => dist(m.pos, h.pos) <= 8 && g.los(h.pos, m.pos))); if (t2) use(g, "fire_bolt", t2, t2.pos); return; }
  const adj = pickTarget(g, adjacent(g));
  if (adj && adjacent(g).length === 1) {
    // Zap the lone attacker, then step back: it can't punish the retreat.
    if (use(g, "shocking_grasp", adj, adj.pos) && alive(g)) retreat(g);
    return;
  }
  if ((adjacent(g).length || (t.hp <= 11 && t.hp > 5)) && h.slots > 1 && use(g, "magic_missile", t, t.pos)) return;
  if (adj && use(g, "shocking_grasp", adj, adj.pos)) return;
  use(g, "fire_bolt", t, t.pos);
  // Step out of reach if nothing is adjacent yet but foes are closing.
  if (alive(g) && !adjacent(g).length && h.movesLeft > 0 && foesOf(g).some((m) => dist(m.pos, h.pos) <= 3)) retreat(g);
}

function mistySpot(g: Game): Pt | null {
  const a = findAction(g, "misty_step");
  if (!a) return null;
  let best: Pt | null = null;
  let bestD = 0;
  for (let y = g.hero.pos.y - 6; y <= g.hero.pos.y + 6; y++) {
    for (let x = g.hero.pos.x - 6; x <= g.hero.pos.x + 6; x++) {
      if (!validTarget(g, a, null, { x, y })) continue;
      const d = Math.min(...foesOf(g).map((m) => dist(m.pos, { x, y })));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

function clericTurn(g: Game): void {
  const h = g.hero;
  if (h.hp < h.maxHp * 0.5) use(g, "healing_word");
  const undead = foesOf(g).filter((m) => isUndead(m) && dist(m.pos, h.pos) <= 6 && g.isVisible(m.pos));
  if (undead.length >= 2 && use(g, "turn_undead")) return;
  const adj = pickTarget(g, adjacent(g));
  if (adj) { use(g, "attack", adj, adj.pos); return; }
  const tough = foesOf(g).filter((m) => m.hp >= 12 && dist(m.pos, h.pos) <= 10 && g.los(h.pos, m.pos) && g.isVisible(m.pos));
  if (tough.length && h.slots >= 2 && use(g, "guiding_bolt", tough[0], tough[0].pos)) return;
  const t = pickTarget(g, foesOf(g));
  if (!t) return;
  // Walk in and swing if we can reach; otherwise Sacred Flame from range.
  if (use(g, "attack", t, t.pos)) return;
  if (dist(t.pos, h.pos) <= 6 && g.los(h.pos, t.pos)) use(g, "sacred_flame", t, t.pos);
  else { g.approach(t.pos); g.takeEvents(); }
}

const TURNS: Record<ClassId, (g: Game) => void> = { fighter: fighterTurn, rogue: rogueTurn, wizard: wizardTurn, cleric: clericTurn };

export function playRun(cls: ClassId, seed: number): RunResult {
  const g = Game.newRun(cls, seed);
  let steps = 0;
  let killers: string[] = [];
  let lastFight: RunResult["lastFight"];
  let wasInCombat = false;
  while (!g.over && steps++ < 6000) {
    const h = g.hero;
    if (g.inCombat && !wasInCombat) {
      lastFight = { hp: h.hp, maxHp: h.maxHp, potions: h.potions, restsUsed: h.restsUsed, hitDice: h.hitDice, slots: h.slots, foes: foesOf(g).map((m) => m.name), rounds: 0 };
    }
    wasInCombat = g.inCombat;
    if (g.inCombat) {
      if (lastFight) lastFight.rounds = g.round;
      if (!g.isHeroTurn()) return { cls, seed, result: "stalled", depth: g.depth, level: h.level, killers };
      emergencyHeal(g);
      if (alive(g)) TURNS[cls](g);
      if (alive(g) && !h.actionUsed) {
        // Couldn't do anything useful: get closer, or brace.
        const near = pickTarget(g, foesOf(g));
        if (near && dist(near.pos, h.pos) > 1 && cls !== "wizard") { g.approach(near.pos); g.takeEvents(); }
        if (alive(g) && adjacent(g).length && !h.actionUsed) use(g, "dodge");
      }
      killers = adjacent(g).map((m) => m.name).concat(foesOf(g).filter((m) => MONSTERS[m.def].attacks[0].ranged).map((m) => m.name));
      if (alive(g)) g.endTurn();
      continue;
    }
    // Between fights: patch up, rest, loot, hunt, descend.
    if (h.hp < h.maxHp * 0.6) use(g, "cure_wounds");
    if (h.hp < h.maxHp * 0.55) use(g, "second_wind");
    const lowSlots = h.slotsMax > 0 && h.slots <= Math.floor(h.slotsMax / 3);
    if ((h.hp < h.maxHp * 0.65 || lowSlots) && !g.restBlocked()) { g.shortRest(); continue; }
    if (h.hp < h.maxHp * 0.4) use(g, "potion");
    const chest = g.map.props.find((p) => p.kind === "chest" && !p.opened);
    if (chest) { g.openChest(chest); if (!chest.opened) chest.opened = true; continue; }
    // Out of healing and badly hurt: skip the rest of the depth and make for the campfire.
    const healsLeft = h.potions + (g.restBlocked() ? 0 : 1) + (h.slotsMax && h.cls === "cleric" ? h.slots : 0);
    let fleeing = h.hp < h.maxHp * 0.5 && healsLeft === 0 && !!g.map.stairs;
    if (fleeing) {
      // Head for the stairs; if something blocks the only way, fight through it.
      const before = { ...h.pos };
      g.moveHero(g.map.stairs!);
      if (g.canDescend()) { descend(g); continue; }
      if (g.inCombat || g.over) continue;
      if (before.x === h.pos.x && before.y === h.pos.y) fleeing = false;
    }
    const m = fleeing ? undefined : [...g.monsters].sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos))[0];
    if (m) {
      const before = { ...h.pos };
      g.approach(m.pos);
      g.takeEvents();
      if (!g.inCombat && before.x === h.pos.x && before.y === h.pos.y) m.dead = true; // unreachable: skip it
      continue;
    }
    if (g.depth >= FINAL_DEPTH) break;
    g.moveHero(g.map.stairs!);
    if (g.canDescend()) descend(g);
  }
  const result = g.over === "victory" ? "victory" : g.over === "dead" ? "dead" : "stalled";
  if (result === "dead" && lastFight) lastFight.foes = [...new Set([...lastFight.foes, ...g.monsters.filter((m) => m.awake).map((m) => m.name)])];
  return { cls, seed, result, depth: g.depth, level: g.hero.level, killers, lastFight };
}

/** Campfire: shop like a sensible player, then go down. */
function descend(g: Game): void {
  while (g.hero.potions < 4 && g.buy("potion"));
  g.buy("weapon");
  g.buy("armor");
  while (g.hero.potions < 6 && g.buy("potion"));
  g.startFloor(g.depth + 1);
}

export function summarize(results: RunResult[]): string {
  const n = results.length;
  const wins = results.filter((r) => r.result === "victory").length;
  const byDepth = [1, 2, 3, 4, 5].map((d) => results.filter((r) => r.result === "dead" && r.depth === d).length);
  const stalled = results.filter((r) => r.result === "stalled").length;
  return `win ${((wins / n) * 100).toFixed(0)}% · deaths by depth ${byDepth.join("/")}${stalled ? ` · stalled ${stalled}` : ""}`;
}
