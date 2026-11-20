import { roll, signed } from "../core/dice";
import { dist, euclid, type Pt } from "../core/grid";
import { blocksMove, inBounds } from "../dungeon/map";
import { CLASSES } from "../rules/classes";
import { MONSTERS } from "../rules/monsters";
import type { Game } from "./game";
import type { Actor, ClassId, GameEvent } from "./types";

export type Targeting = "enemy" | "self" | "tile" | "area" | "cone";

export interface HeroAction {
  id: string;
  name: string;
  icon: string;
  cost: "action" | "bonus" | "free";
  targeting: Targeting;
  range: number;
  radius?: number;
  slots?: number;
  feature?: string;
  minLevel?: number;
  hostile: boolean;
  /** Spell or weapon attack bonus, for the hover hit chance. */
  toHit?: (g: Game) => number;
  /** One-line numbers for the tooltip. */
  stat: (g: Game) => string;
  desc: string;
  /** Extra availability rule; returns the reason it can't be used, or null. */
  check?: (g: Game) => string | null;
  run: (g: Game, target: Actor | null, at: Pt | null) => void;
}

const isUndead = (a: Actor) => a.team === "enemy" && MONSTERS[a.def].traits.includes("undead");

const weaponAttack: HeroAction = {
  id: "attack",
  name: "Attack",
  icon: "sword",
  cost: "action",
  targeting: "enemy",
  range: 1,
  hostile: true,
  toHit: (g) => g.weaponToHit(),
  stat: (g) => `${signed(g.weaponToHit())} to hit · ${g.weaponDamage()} ${CLASSES[g.hero.cls].weapon.type}${g.hero.cls === "cleric" ? ` + ${g.hero.level >= 5 ? "1d8" : "1d4"} radiant` : ""}`,
  desc: "Strike with your weapon. Click a distant foe to walk up and swing.",
  run: (g, t) => {
    const w = CLASSES[g.hero.cls].weapon;
    g.attack(g.hero, t!, { toHit: g.weaponToHit(), dice: g.weaponDamage(), type: w.type, ranged: false, fx: w.fx, label: w.name, sneak: true, blessed: true });
  },
};

const dash: HeroAction = {
  id: "dash", name: "Dash", icon: "boot", cost: "action", targeting: "self", range: 0, hostile: false,
  stat: () => "+6 movement", desc: "Spend your action to move twice as far this turn.",
  check: (g) => (g.inCombat ? null : "Only needed in combat"),
  run: (g) => { g.hero.movesLeft += g.hero.speed; g.float(g.hero, "Dash", "info"); },
};

const dodge: HeroAction = {
  id: "dodge", name: "Dodge", icon: "shield", cost: "action", targeting: "self", range: 0, hostile: false,
  stat: () => "Attacks vs you: disadvantage", desc: "Focus on defence until your next turn. Every attack against you rolls twice and keeps the lower.",
  check: (g) => (g.inCombat ? null : "Only useful in combat"),
  run: (g) => { g.hero.cond.dodging = true; g.float(g.hero, "Dodging", "info"); g.log("You raise your guard.", "info"); },
};

const potion: HeroAction = {
  id: "potion", name: "Potion", icon: "potion", cost: "bonus", targeting: "self", range: 0, hostile: false,
  stat: (g) => `Heal 2d4+2 · ${g.hero.potions} left`, desc: "Drink a Potion of Healing. A bonus action, so you can still attack.",
  check: (g) => (g.hero.potions <= 0 ? "No potions left" : g.hero.hp >= g.hero.maxHp ? "Already at full health" : null),
  run: (g) => {
    g.hero.potions--;
    const r = roll(g.rng, "2d4+2");
    g.emit({ t: "spell", caster: g.hero.id, fx: "potion", at: { ...g.hero.pos } });
    g.heal(g.hero, r.total);
    g.log(`You drink a potion and recover ${r.total} HP.`, "good");
  },
};

// ---------------------------------------------------------------- fighter

const secondWind: HeroAction = {
  id: "second_wind", name: "Second Wind", icon: "heart", cost: "bonus", targeting: "self", range: 0, hostile: false,
  feature: "second_wind",
  stat: (g) => `Heal 1d10+${g.hero.level} · once per depth`, desc: "Draw on your stamina to shake off wounds.",
  check: (g) => (g.hero.hp >= g.hero.maxHp ? "Already at full health" : null),
  run: (g) => {
    const r = roll(g.rng, `1d10+${g.hero.level}`);
    g.emit({ t: "spell", caster: g.hero.id, fx: "surge", at: { ...g.hero.pos } });
    g.heal(g.hero, r.total);
    g.log(`Second Wind: you recover ${r.total} HP.`, "good");
  },
};

const actionSurge: HeroAction = {
  id: "action_surge", name: "Action Surge", icon: "bolt", cost: "free", targeting: "self", range: 0, hostile: false,
  feature: "action_surge",
  stat: () => "Regain your action · once per depth", desc: "Push past your limits and take one more action this turn.",
  check: (g) => (!g.inCombat ? "Only in combat" : !g.hero.actionUsed || g.hero.attacksLeft > 0 ? "You still have your action" : null),
  run: (g) => {
    g.hero.actionUsed = false;
    g.hero.attacksLeft = 0;
    g.emit({ t: "spell", caster: g.hero.id, fx: "surge", at: { ...g.hero.pos } });
    g.float(g.hero, "Action Surge!", "crit");
  },
};

// ---------------------------------------------------------------- rogue

const throwDagger: HeroAction = {
  id: "throw_dagger", name: "Throw Dagger", icon: "dagger", cost: "action", targeting: "enemy", range: 5, hostile: true,
  toHit: (g) => g.prof() + g.mod(g.hero, "dex") + g.hero.weaponBonus,
  stat: (g) => `${signed(g.prof() + g.mod(g.hero, "dex") + g.hero.weaponBonus)} to hit · 1d4${signed(g.mod(g.hero, "dex") + g.hero.weaponBonus)} · range 5`,
  desc: "A thrown blade. Sneak Attack still applies.",
  run: (g, t) => {
    const b = g.mod(g.hero, "dex") + g.hero.weaponBonus;
    g.attack(g.hero, t!, { toHit: g.prof() + b, dice: `1d4${signed(b)}`, type: "piercing", ranged: true, fx: "dagger", label: "Thrown dagger", sneak: true });
  },
};

const hide: HeroAction = {
  id: "hide", name: "Hide", icon: "hood", cost: "bonus", targeting: "self", range: 0, hostile: false,
  stat: (g) => `Stealth 1d20${signed(g.mod(g.hero, "dex") + 4)} vs their notice`,
  desc: "Cunning Action. Slip into the shadows: your next attack has advantage, and foes struggle to find you.",
  check: (g) => (g.hero.cond.hidden ? "Already hidden" : g.inCombat && g.monsters.some((m) => m.awake && dist(m.pos, g.hero.pos) <= 1) ? "Too close to a foe" : null),
  run: (g) => {
    const watchers = g.monsters.filter((m) => m.awake && g.isVisible(m.pos));
    const best = Math.max(0, ...watchers.map((m) => 10 + g.mod(m, "wis")));
    const r = g.d20(0, 0);
    const total = r.natural + g.mod(g.hero, "dex") + 4;
    const ok = watchers.length === 0 || total >= best;
    g.emit({ t: "save", target: g.hero.id, roll: { d20: r, bonus: g.mod(g.hero, "dex") + 4, total, target: best, label: "Stealth" }, success: ok });
    if (ok) {
      g.hero.cond.hidden = true;
      g.float(g.hero, "Hidden", "magic");
      g.log("You melt into the shadows.", "good");
    } else {
      g.float(g.hero, "Spotted", "bad");
      g.log("They still have eyes on you.", "bad");
    }
  },
};

const disengage: HeroAction = {
  id: "disengage", name: "Disengage", icon: "wind", cost: "bonus", targeting: "self", range: 0, hostile: false,
  stat: () => "No opportunity attacks this turn", desc: "Cunning Action. Slip out of reach without giving anyone a free swing.",
  check: (g) => (g.inCombat ? null : "Only in combat"),
  run: (g) => { g.hero.cond.disengaged = true; g.float(g.hero, "Disengage", "info"); },
};

const cunningDash: HeroAction = {
  id: "cunning_dash", name: "Cunning Dash", icon: "boot", cost: "bonus", targeting: "self", range: 0, hostile: false,
  stat: () => "+6 movement", desc: "Cunning Action. Dash as a bonus action and keep your action for the kill.",
  check: (g) => (g.inCombat ? null : "Only needed in combat"),
  run: (g) => { g.hero.movesLeft += g.hero.speed; g.float(g.hero, "Dash", "info"); },
};

// ---------------------------------------------------------------- wizard

const fireBolt: HeroAction = {
  id: "fire_bolt", name: "Fire Bolt", icon: "flame", cost: "action", targeting: "enemy", range: 8, hostile: true,
  toHit: (g) => g.spellAttack(),
  stat: (g) => `${signed(g.spellAttack())} to hit · ${g.hero.level >= 5 ? "2d10" : "1d10"} fire · range 8`,
  desc: "Cantrip. Hurl a mote of fire. Costs no spell slot.",
  run: (g, t) => {
    g.attack(g.hero, t!, { toHit: g.spellAttack(), dice: g.hero.level >= 5 ? "2d10" : "1d10", type: "fire", ranged: true, fx: "firebolt", label: "Fire Bolt" });
  },
};

const magicMissile: HeroAction = {
  id: "magic_missile", name: "Magic Missile", icon: "sparkle", cost: "action", targeting: "enemy", range: 8, slots: 1, hostile: true,
  stat: (g) => `${missiles(g)} darts · 1d4+1 force each · never misses`,
  desc: "Glowing darts of force that always strike their mark.",
  run: (g, t) => {
    g.emit({ t: "spell", caster: g.hero.id, fx: "missile", at: { ...t!.pos }, target: t!.id });
    let total = 0;
    for (let i = 0; i < missiles(g); i++) total += roll(g.rng, "1d4+1").total;
    g.log(`${missiles(g)} darts of force slam into the ${t!.name}.`, "magic");
    g.damage(t!, total, "force", { by: g.hero, note: "Magic Missile" });
  },
};
const missiles = (g: Game) => (g.hero.level >= 3 ? 4 : 3);

const burningHands: HeroAction = {
  id: "burning_hands", name: "Burning Hands", icon: "fan", cost: "action", targeting: "cone", range: 3, slots: 1, hostile: true,
  stat: (g) => `3d6 fire in a cone · Dex save DC ${g.spellDc()} for half`,
  desc: "A fan of flame bursts from your fingertips. Aim it at a nearby tile.",
  run: (g, _t, at) => {
    const tiles = affectedTiles(g, burningHands, at!);
    g.emit({ t: "spell", caster: g.hero.id, fx: "cone", at: { ...at! }, tiles });
    areaDamage(g, tiles, "3d6", "fire", "Burning Hands");
  },
};

const mistyStep: HeroAction = {
  id: "misty_step", name: "Misty Step", icon: "mist", cost: "bonus", targeting: "tile", range: 6, slots: 1, minLevel: 3, hostile: false,
  stat: () => "Teleport up to 6 tiles", desc: "Vanish in silver mist and reappear somewhere you can see. No opportunity attacks.",
  run: (g, _t, at) => {
    const from = { ...g.hero.pos };
    g.hero.pos = { ...at! };
    g.emit({ t: "teleport", id: g.hero.id, from, to: { ...at! } });
    g.refreshFov();
  },
};

const fireball: HeroAction = {
  id: "fireball", name: "Fireball", icon: "burst", cost: "action", targeting: "area", range: 12, radius: 3, slots: 2, minLevel: 5, hostile: true,
  stat: (g) => `8d6 fire · radius 3 · Dex save DC ${g.spellDc()} for half · 2 slots`,
  desc: "The classic. A bead of light blooms into a roaring explosion. Mind your own eyebrows.",
  run: (g, _t, at) => {
    const tiles = affectedTiles(g, fireball, at!);
    g.emit({ t: "spell", caster: g.hero.id, fx: "fireball", at: { ...at! }, tiles });
    areaDamage(g, tiles, "8d6", "fire", "Fireball");
  },
};

// ---------------------------------------------------------------- cleric

const sacredFlame: HeroAction = {
  id: "sacred_flame", name: "Sacred Flame", icon: "sun", cost: "action", targeting: "enemy", range: 6, hostile: true,
  stat: (g) => `${g.hero.level >= 5 ? "2d8" : "1d8"} radiant · Dex save DC ${g.spellDc()} · range 6`,
  desc: "Cantrip. Holy fire falls on a foe. Nothing to aim, they must dodge it. Undead cannot shrug off radiant damage.",
  run: (g, t) => {
    g.emit({ t: "spell", caster: g.hero.id, fx: "column", at: { ...t!.pos }, target: t!.id });
    if (g.save(t!, "dex", g.spellDc(), "Dex save")) {
      g.float(t!, "Dodged", "miss");
      g.log(`The ${t!.name} twists out of the holy fire.`, "miss");
      return;
    }
    const dmg = roll(g.rng, g.hero.level >= 5 ? "2d8" : "1d8").total;
    g.log(`Radiant flame engulfs the ${t!.name}.`, "magic");
    g.damage(t!, dmg, "radiant", { by: g.hero });
  },
};

const guidingBolt: HeroAction = {
  id: "guiding_bolt", name: "Guiding Bolt", icon: "star", cost: "action", targeting: "enemy", range: 10, slots: 1, hostile: true,
  toHit: (g) => g.spellAttack(),
  stat: (g) => `${signed(g.spellAttack())} to hit · 4d6 radiant · next attack has advantage`,
  desc: "A flash of light streaks toward a foe and leaves it glowing for your next strike.",
  run: (g, t) => {
    g.attack(g.hero, t!, {
      toHit: g.spellAttack(), dice: "4d6", type: "radiant", ranged: true, fx: "guiding", label: "Guiding Bolt",
      onHit: () => { if (!t!.dead) t!.cond.marked = true; },
    });
  },
};

const cureWounds: HeroAction = {
  id: "cure_wounds", name: "Cure Wounds", icon: "heart", cost: "action", targeting: "self", range: 0, slots: 1, hostile: false,
  stat: (g) => `Heal ${cureDice(g)}`, desc: "Lay hands on your own wounds and close them with holy light.",
  check: (g) => (g.hero.hp >= g.hero.maxHp ? "Already at full health" : null),
  run: (g) => {
    const r = roll(g.rng, cureDice(g));
    g.emit({ t: "spell", caster: g.hero.id, fx: "heal", at: { ...g.hero.pos } });
    g.heal(g.hero, r.total);
    g.log(`Warm light knits your wounds: +${r.total} HP.`, "good");
  },
};
/** Life Domain: Disciple of Life adds 2 + spell level (1) to healing spells. */
const cureDice = (g: Game) => `${g.hero.level >= 3 ? 2 : 1}d8${signed(g.mod(g.hero, "wis") + 3)}`;
const wordDice = (g: Game) => `1d4${signed(g.mod(g.hero, "wis") + 3)}`;

const healingWord: HeroAction = {
  id: "healing_word", name: "Healing Word", icon: "chime", cost: "bonus", targeting: "self", range: 0, slots: 1, hostile: false,
  stat: (g) => `Heal ${wordDice(g)} · bonus action`, desc: "A quick prayer: less healing, but you keep your action.",
  check: (g) => (g.hero.hp >= g.hero.maxHp ? "Already at full health" : null),
  run: (g) => {
    const r = roll(g.rng, wordDice(g));
    g.emit({ t: "spell", caster: g.hero.id, fx: "heal", at: { ...g.hero.pos } });
    g.heal(g.hero, r.total);
    g.log(`A word of power: +${r.total} HP.`, "good");
  },
};

const turnUndead: HeroAction = {
  id: "turn_undead", name: "Turn Undead", icon: "ankh", cost: "action", targeting: "self", range: 6, feature: "turn_undead", minLevel: 2, hostile: true,
  stat: (g) => `Undead within 6: Wis save DC ${g.spellDc()} or flee${g.hero.level >= 5 ? " (weak ones are destroyed)" : ""} · once per depth`,
  desc: "Present your holy symbol. The dead remember what they fear.",
  check: (g) => (g.monsters.some((m) => isUndead(m) && dist(m.pos, g.hero.pos) <= 6 && g.isVisible(m.pos)) ? null : "No undead in range"),
  run: (g) => {
    g.emit({ t: "spell", caster: g.hero.id, fx: "turn", at: { ...g.hero.pos } });
    for (const m of g.monsters.filter((m) => isUndead(m) && dist(m.pos, g.hero.pos) <= 6 && g.isVisible(m.pos))) {
      if (MONSTERS[m.def].traits.includes("boss")) { g.float(m, "Unmoved", "bad"); continue; }
      if (g.save(m, "wis", g.spellDc(), "Wis save")) { g.float(m, "Resists", "miss"); continue; }
      if (g.hero.level >= 5 && MONSTERS[m.def].xp <= 100) {
        g.log(`The ${m.name} crumbles to ash!`, "magic");
        g.damage(m, m.hp, "radiant", { by: g.hero, note: "Destroyed" });
      } else {
        m.cond.turned = 3;
        g.float(m, "Turned!", "magic");
        g.log(`The ${m.name} recoils and flees from your light.`, "magic");
      }
    }
  },
};

export const CLASS_ACTIONS: Record<ClassId, HeroAction[]> = {
  fighter: [weaponAttack, secondWind, actionSurge, dodge, dash, potion],
  rogue: [weaponAttack, throwDagger, hide, disengage, cunningDash, potion, dodge],
  wizard: [fireBolt, magicMissile, burningHands, mistyStep, fireball, weaponAttack, dodge, potion],
  cleric: [weaponAttack, sacredFlame, guidingBolt, cureWounds, healingWord, turnUndead, dodge, potion],
};

export const heroActions = (g: Game): HeroAction[] =>
  CLASS_ACTIONS[g.hero.cls].filter((a) => !a.minLevel || g.hero.level >= a.minLevel);

export const findAction = (g: Game, id: string): HeroAction | undefined => CLASS_ACTIONS[g.hero.cls].find((a) => a.id === id);

// ---------------------------------------------------------------- shared helpers

/** Why this action can't be used right now (null = good to go). */
export function blockedReason(g: Game, a: HeroAction): string | null {
  const h = g.hero;
  if (g.over) return "The run is over";
  if (!g.isHeroTurn()) return "Not your turn";
  if (a.minLevel && h.level < a.minLevel) return `Unlocks at level ${a.minLevel}`;
  if (a.cost === "action" && h.actionUsed && !(a.id === "attack" && h.attacksLeft > 0)) return "Action already used";
  if (a.cost === "bonus" && h.bonusUsed) return "Bonus action already used";
  if (a.slots && h.slots < a.slots) return a.slots > 1 ? `Needs ${a.slots} spell slots` : "No spell slots left";
  if (a.feature && (h.featureUses[a.feature] ?? 0) >= 1) return "Used this depth";
  return a.check?.(g) ?? null;
}

export function validTarget(g: Game, a: HeroAction, t: Actor | null, at: Pt | null): boolean {
  const h = g.hero;
  switch (a.targeting) {
    case "self":
      return true;
    case "enemy":
      if (!t || t.dead || t.team !== "enemy" || !g.isVisible(t.pos)) return false;
      if (a.id === "attack") return true; // walks up first
      return dist(t.pos, h.pos) <= a.range && g.los(h.pos, t.pos);
    case "tile":
      if (!at || !inBounds(g.map, at.x, at.y) || !g.isVisible(at)) return false;
      return dist(at, h.pos) <= a.range && dist(at, h.pos) > 0 && !blocksMove(g.map, at.x, at.y) && !g.actorAt(at.x, at.y);
    case "area":
      return !!at && g.isVisible(at) && dist(at, h.pos) <= a.range && g.los(h.pos, at);
    case "cone":
      return !!at && !(at.x === h.pos.x && at.y === h.pos.y);
  }
}

/** Tiles hit by an area spell aimed at `at`. */
export function affectedTiles(g: Game, a: HeroAction, at: Pt): Pt[] {
  const h = g.hero.pos;
  const out: Pt[] = [];
  if (a.targeting === "area") {
    const r = a.radius ?? 1;
    for (let y = at.y - r; y <= at.y + r; y++) {
      for (let x = at.x - r; x <= at.x + r; x++) {
        if (!inBounds(g.map, x, y) || euclid({ x, y }, at) > r + 0.5) continue;
        if (blocksMove(g.map, x, y) && !g.actorAt(x, y)) continue;
        if (g.los(at, { x, y })) out.push({ x, y });
      }
    }
  } else if (a.targeting === "cone") {
    const dx = at.x - h.x, dy = at.y - h.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let y = h.y - a.range; y <= h.y + a.range; y++) {
      for (let x = h.x - a.range; x <= h.x + a.range; x++) {
        if (x === h.x && y === h.y) continue;
        if (!inBounds(g.map, x, y) || blocksMove(g.map, x, y)) continue;
        const vx = x - h.x, vy = y - h.y;
        const vl = Math.hypot(vx, vy);
        if (vl > a.range + 0.5) continue;
        if ((vx * dx + vy * dy) / (vl * len) < 0.62) continue;
        if (g.los(h, { x, y })) out.push({ x, y });
      }
    }
  }
  return out;
}

function areaDamage(g: Game, tiles: Pt[], dice: string, type: "fire", label: string): void {
  const dmg = roll(g.rng, dice).total;
  const victims = tiles.map((p) => g.actorAt(p.x, p.y)).filter((a): a is Actor => !!a);
  if (!victims.length) g.log(`${label} scorches empty stone.`, "dim");
  for (const v of victims) {
    const saved = g.save(v, "dex", g.spellDc(), "Dex save");
    const n = saved ? Math.floor(dmg / 2) : dmg;
    if (v === g.hero) g.log(`You're caught in your own ${label}!`, "bad");
    g.damage(v, n, type, { by: g.hero, note: saved ? "Half" : undefined });
  }
}

/** Runs a hero action end to end. Returns the events to play back. */
export function useAction(g: Game, id: string, target: Actor | null, at: Pt | null): GameEvent[] {
  const a = findAction(g, id);
  if (!a || blockedReason(g, a) || !validTarget(g, a, target, at)) return g.takeEvents();
  const h = g.hero;

  if (a.id === "attack" && target) {
    if (!g.approach(target.pos)) return g.takeEvents();
    // Walking up may have started a fight, or the fight may have moved on.
    if (h.dead || g.over || !g.isHeroTurn() || target.dead) return g.takeEvents();
    if (blockedReason(g, a)) return g.takeEvents();
  }

  if (a.cost === "action") {
    if (a.id === "attack" && h.attacksLeft > 0) {
      h.attacksLeft--;
    } else {
      h.actionUsed = true;
      h.attacksLeft = a.id === "attack" && h.cls === "fighter" && h.level >= 5 ? 1 : 0;
    }
  } else if (a.cost === "bonus") {
    h.bonusUsed = true;
  }
  if (a.slots) h.slots -= a.slots;
  if (a.feature) h.featureUses[a.feature] = (h.featureUses[a.feature] ?? 0) + 1;

  // Whoever gets hit first is who "noticed" the ambush.
  let opened: Actor | undefined = a.hostile && target ? target : undefined;
  if (a.hostile && !opened && at && (a.targeting === "area" || a.targeting === "cone")) {
    opened = affectedTiles(g, a, at).map((p) => g.actorAt(p.x, p.y)).find((v) => v && v.team === "enemy");
  }
  a.run(g, target, at);
  g.emit({ t: "hero" });
  g.afterHeroAction(opened);
  return g.takeEvents();
}

