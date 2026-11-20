import { roll } from "../core/dice";
import { DIRS8, dist, type Pt } from "../core/grid";
import { blocksMove, idx } from "../dungeon/map";
import { findPath, reachable, pathFromReach } from "../dungeon/path";
import type { MonsterAttack } from "../rules/monsters";
import type { Game } from "./game";
import type { Actor } from "./types";

/** One monster's whole turn: move, then attack, with a little personality per type. */
export function runMonsterTurn(g: Game, m: Actor): void {
  const h = g.hero;
  if (h.dead || m.dead) return;
  const def = g.monsterDef(m);

  if (m.cond.turned) {
    flee(g, m);
    m.cond.turned--;
    if (!m.cond.turned) delete m.cond.turned;
    return;
  }

  if (def.traits.includes("summoner") && m.hp <= m.maxHp / 2 && !m.flags.summoned) {
    m.flags.summoned = true;
    summon(g, m);
  }

  const melee = def.attacks.filter((a) => !a.ranged);
  const ranged = def.attacks.filter((a) => a.ranged);
  // Fair play: a monster may only shoot from where the hero can see it (and shoot back).
  const canShoot = (a: MonsterAttack) => dist(m.pos, h.pos) <= a.range && g.los(m.pos, h.pos) && g.isVisible(m.pos);

  // Archers: keep distance, shoot from cover.
  if (ranged.length && def.attacks[0].ranged) {
    const shot = ranged[0];
    if (dist(m.pos, h.pos) === 1 && def.traits.includes("nimble")) {
      m.cond.disengaged = true;
      retreat(g, m, shot);
    }
    if (!canShoot(shot)) moveToward(g, m, m.speed, () => canShoot(shot));
    if (canShoot(shot) && dist(m.pos, h.pos) > 1) {
      strike(g, m, shot);
    } else if (dist(m.pos, h.pos) === 1 && melee.length) {
      strike(g, m, melee[0]);
    } else if (canShoot(shot)) {
      strike(g, m, shot);
    }
    return;
  }

  if (dist(m.pos, h.pos) > 1) {
    const budget = def.traits.includes("aggressive") ? m.speed * 2 : m.speed;
    moveToward(g, m, budget, () => dist(m.pos, h.pos) <= 1);
  }
  if (h.dead) return;

  if (dist(m.pos, h.pos) <= 1 && melee.length) {
    for (let i = 0; i < def.multiattack && !h.dead && !m.dead; i++) {
      strike(g, m, melee[Math.min(i, melee.length - 1)]);
    }
  } else if (ranged.length && canShoot(ranged[0])) {
    strike(g, m, ranged[0]);
  }
}

function strike(g: Game, m: Actor, a: MonsterAttack): void {
  const h = g.hero;
  const traits = g.monsterDef(m).traits;
  g.attack(m, h, {
    toHit: a.toHit, dice: a.dice, type: a.type, ranged: a.ranged, fx: a.fx, label: a.name,
    onHit: (_crit, dealt) => {
      if (a.name === "Life Drain" && traits.includes("life_drain") && dealt > 0) {
        g.float(m, "Drains life", "bad");
        g.heal(m, Math.ceil(dealt / 2));
      }
      if (traits.includes("stun_claws") && !h.dead && !h.cond.stunned) {
        if (!g.save(h, "con", 10, "Con save")) {
          h.cond.stunned = 1;
          g.float(h, "Paralysed!", "bad");
          g.log(`The ${m.name}'s claws numb your limbs. You'll lose your next turn.`, "bad");
        }
      }
    },
  });
}

/** Walk toward the hero, one step at a time, stopping when `done` says so. */
function moveToward(g: Game, m: Actor, budget: number, done: () => boolean): void {
  const h = g.hero;
  let path = findPath(g.map, m.pos, h.pos, g.occupiedBy(m), true, 2500);
  if (!path) path = findPath(g.map, m.pos, h.pos, () => false, true, 2500);
  if (!path) return;
  for (let i = 0; i < path.length && i < budget; i++) {
    if (done()) return;
    const p = path[i];
    if (g.actorAt(p.x, p.y)) return;
    if (!g.stepActor(m, p)) return;
    if (h.dead) return;
  }
}

/** Nimble archers back off to a spot where they still have a shot. */
function retreat(g: Game, m: Actor, shot: MonsterAttack): void {
  const h = g.hero;
  const reach = reachable(g.map, m.pos, 3, g.occupiedBy(m));
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (const [i] of reach) {
    const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
    const d = dist(p, h.pos);
    if (d < 2 || d > shot.range || !g.los(p, h.pos) || !g.isVisible(p)) continue;
    const score = d * 2 - (reach.get(i)!.cost);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (!best) return;
  for (const p of pathFromReach(g.map, reach, best) ?? []) if (!g.stepActor(m, p)) return;
}

/** Turned undead run as far from the hero as they can. */
function flee(g: Game, m: Actor): void {
  const h = g.hero;
  const reach = reachable(g.map, m.pos, m.speed, g.occupiedBy(m));
  let best: Pt | null = null;
  let bestD = dist(m.pos, h.pos);
  for (const [i] of reach) {
    const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
    const d = dist(p, h.pos);
    if (d > bestD) { bestD = d; best = p; }
  }
  g.float(m, "Fleeing", "magic");
  if (!best) return;
  for (const p of pathFromReach(g.map, reach, best) ?? []) if (!g.stepActor(m, p)) return;
}

function summon(g: Game, boss: Actor): void {
  const spots: Pt[] = [];
  for (const d of DIRS8) {
    for (let r = 1; r <= 2 && spots.length < 2; r++) {
      const p = { x: boss.pos.x + d.x * r, y: boss.pos.y + d.y * r };
      if (blocksMove(g.map, p.x, p.y) || g.actorAt(p.x, p.y)) continue;
      if (spots.some((s) => s.x === p.x && s.y === p.y)) continue;
      if (g.map.tiles[idx(g.map, p.x, p.y)] === undefined) continue;
      spots.push(p);
      break;
    }
  }
  g.emit({ t: "spell", caster: boss.id, fx: "summon", at: { ...boss.pos } });
  g.log("Varrow roars, and the dead claw their way up from the ash!", "bad");
  g.float(boss, "Rise!", "bad");
  const kinds = ["skeleton", roll(g.rng, "1d2").total === 1 ? "skeleton_archer" : "zombie"];
  spots.slice(0, 2).forEach((p, i) => g.spawnMonster(kinds[i], p, boss.group));
}
