import { Rng } from "../core/rng";
import { abilityMod, roll, rollD20, signed } from "../core/dice";
import { dist, type Pt } from "../core/grid";
import { generate, FINAL_DEPTH } from "../dungeon/generate";
import { computeFov, hasLos } from "../dungeon/fov";
import { T, idx, tileAt, type DungeonMap } from "../dungeon/map";
import { findPath, reachable, pathFromReach } from "../dungeon/path";
import { CLASSES, MAX_LEVEL, XP_LEVELS, proficiency } from "../rules/classes";
import { DEPTH_TABLES, MONSTERS, type MonsterDef } from "../rules/monsters";
import { DIFFICULTIES, type Difficulty, type DifficultyDef } from "../rules/difficulty";

const MONSTER_TABLE = (depth: number): [string, number][] => DEPTH_TABLES[depth] ?? DEPTH_TABLES[1];
import { runMonsterTurn } from "./ai";
import type { Ability, Actor, ClassId, DamageType, GameEvent, Hero, RollInfo, Tone } from "./types";

export const SIGHT = 8;
/** Solo heroes are a little tougher than a 5e party member: there is nobody to pick them up. */
export const SOLO_HP_BONUS = 10;
export const SOLO_HP_PER_LEVEL = 2;
export const NOTICE = 7;

export interface ShopItem {
  id: "potion" | "weapon" | "armor";
  name: string;
  desc: string;
  price: number;
  soldOut: boolean;
}

export interface AttackOpts {
  toHit: number;
  dice: string;
  type: DamageType;
  ranged: boolean;
  fx: string;
  label: string;
  /** Called after a hit lands (rider effects). */
  onHit?: (crit: boolean, dealt: number) => void;
  /** Rogue: add Sneak Attack dice if conditions are met. */
  sneak?: boolean;
  /** Cleric weapon hits add radiant damage. */
  blessed?: boolean;
  /** Extra flat damage added by the attacker. */
  extraDamage?: number;
}

const SAVE_PROFS: Record<ClassId, Ability[]> = {
  fighter: ["str", "con"],
  rogue: ["dex", "int"],
  wizard: ["int", "wis"],
  cleric: ["wis", "cha"],
};

export interface SaveData {
  version: 1;
  seed: number;
  /** Missing in saves from before difficulties existed: those are Normal. */
  difficulty?: Difficulty;
  depth: number;
  hero: Hero;
  stats: RunStats;
}

export interface RunStats {
  turns: number;
  damageDealt: number;
  damageTaken: number;
  crits: number;
  chests: number;
}

export class Game {
  readonly seed: number;
  readonly difficulty: Difficulty;
  depth = 1;
  map!: DungeonMap;
  hero!: Hero;
  actors: Actor[] = [];
  rng: Rng;
  inCombat = false;
  order: number[] = [];
  turnIdx = -1;
  round = 0;
  visible = new Set<number>();
  seen!: Uint8Array;
  over: "dead" | "victory" | null = null;
  stats: RunStats = { turns: 0, damageDealt: 0, damageTaken: 0, crits: 0, chests: 0 };
  private nextId = 1;
  ev: GameEvent[] = [];

  constructor(seed: number, difficulty: Difficulty = "normal") {
    this.seed = seed >>> 0;
    this.difficulty = difficulty;
    this.rng = new Rng(this.seed ^ 0x51ed270b);
  }

  // ------------------------------------------------------------ setup

  get diff(): DifficultyDef {
    return DIFFICULTIES[this.difficulty];
  }

  static newRun(cls: ClassId, seed: number, difficulty: Difficulty = "normal"): Game {
    const g = new Game(seed, difficulty);
    g.hero = g.makeHero(cls);
    g.startFloor(1);
    return g;
  }

  static load(data: SaveData): Game {
    const g = new Game(data.seed, data.difficulty ?? "normal");
    g.hero = data.hero;
    g.stats = data.stats;
    g.rng = new Rng((data.seed ^ Math.imul(data.depth, 0x27d4eb2d)) >>> 0);
    g.startFloor(data.depth);
    return g;
  }

  toSave(): SaveData {
    return { version: 1, seed: this.seed, difficulty: this.difficulty, depth: this.depth, hero: structuredClone(this.hero), stats: { ...this.stats } };
  }

  private makeHero(cls: ClassId): Hero {
    const c = CLASSES[cls];
    const conMod = abilityMod(c.scores.con);
    const hp = c.hitDie + conMod + SOLO_HP_BONUS + this.diff.heroHp;
    const hero: Hero = {
      ...this.blankActor("hero", cls, c.name, { x: 0, y: 0 }),
      hp, maxHp: hp, ac: 0, speed: 6, scores: { ...c.scores },
      awake: true, cls, level: 1, xp: 0,
      slots: c.slots[0], slotsMax: c.slots[0],
      potions: this.diff.potions, gold: 15, weaponBonus: 0, armorBonus: 0,
      hitDice: 2, restsUsed: 0, featureUses: {}, kills: 0,
    };
    hero.ac = this.heroAc(hero);
    return hero;
  }

  heroAc(h: Hero = this.hero): number {
    const c = CLASSES[h.cls];
    return c.baseAc + (c.acDex ? abilityMod(h.scores.dex) : 0) + h.armorBonus;
  }

  private blankActor(team: Actor["team"], def: string, name: string, pos: Pt): Actor {
    return {
      id: this.nextId++, team, def, name, pos: { ...pos }, hp: 1, maxHp: 1, ac: 10, speed: 6,
      scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      dead: false, awake: false, group: -1, initiative: 0, hasActed: false,
      movesLeft: 0, actionUsed: false, bonusUsed: false, reactionUsed: false,
      attacksLeft: 0, sneakUsed: false, cond: {}, flags: {},
    };
  }

  makeMonster(id: string, pos: Pt, group: number): Actor {
    const d = MONSTERS[id];
    const a = this.blankActor("enemy", id, d.name, pos);
    a.hp = a.maxHp = Math.max(1, Math.round(d.hp * this.diff.monsterHp));
    a.ac = d.ac;
    a.speed = d.speed;
    a.scores = { ...d.scores };
    a.group = group;
    return a;
  }

  startFloor(depth: number): void {
    this.depth = depth;
    this.map = generate(depth, this.seed, this.diff.monsterBudget, this.diff.groupSize);
    this.rng = new Rng((this.seed ^ Math.imul(depth, 0x27d4eb2d)) >>> 0);
    this.seen = new Uint8Array(this.map.w * this.map.h);
    this.inCombat = false;
    this.order = [];
    this.turnIdx = -1;
    this.round = 0;
    const h = this.hero;
    // Long rest at the campfire before each depth.
    h.hp = h.maxHp;
    h.slots = h.slotsMax;
    h.featureUses = {};
    h.hitDice = h.level + 1;
    h.restsUsed = 0;
    h.defyUsed = 0;
    h.flags = {};
    h.cond = {};
    h.dead = false;
    h.pos = { ...this.map.start };
    h.id = 0;
    this.resetTurn(h);
    this.actors = [h];
    this.nextId = 1;
    for (const s of this.map.spawns) this.actors.push(this.makeMonster(s.monster, s.pos, s.group));
    this.refreshFov();
    this.ev = [];
  }

  // ------------------------------------------------------------ queries

  get monsters(): Actor[] {
    return this.actors.filter((a) => a.team === "enemy" && !a.dead);
  }

  byId(id: number): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  actorAt(x: number, y: number): Actor | undefined {
    return this.actors.find((a) => !a.dead && a.pos.x === x && a.pos.y === y);
  }

  current(): Actor | undefined {
    return this.inCombat ? this.byId(this.order[this.turnIdx]) : undefined;
  }

  isHeroTurn(): boolean {
    return !this.over && (!this.inCombat || this.order[this.turnIdx] === this.hero.id);
  }

  isVisible(p: Pt): boolean {
    return this.visible.has(idx(this.map, p.x, p.y));
  }

  monsterDef(a: Actor): MonsterDef {
    return MONSTERS[a.def];
  }

  prof(): number {
    return proficiency(this.hero.level);
  }

  mod(a: Actor, ab: Ability): number {
    return abilityMod(a.scores[ab]);
  }

  spellAttack(): number {
    return this.prof() + this.mod(this.hero, CLASSES[this.hero.cls].primary);
  }

  spellDc(): number {
    return 8 + this.spellAttack();
  }

  weaponToHit(): number {
    const w = CLASSES[this.hero.cls].weapon;
    return this.prof() + this.mod(this.hero, w.ability) + this.hero.weaponBonus;
  }

  weaponDamage(): string {
    const w = CLASSES[this.hero.cls].weapon;
    const bonus = this.mod(this.hero, w.ability) + this.hero.weaponBonus;
    return bonus === 0 ? w.dice : `${w.dice}${signed(bonus)}`;
  }

  /** Cleric's Blessed Strikes: radiant dice added to weapon hits. */
  blessedDice(): string {
    return this.hero.level >= 5 ? "2d8" : "1d8";
  }

  /** Wizard's Ember Ward: temporary HP renewed at the start of each fight. */
  wardMax(): number {
    return 4 * this.hero.level + this.mod(this.hero, "int");
  }

  sneakDice(): number {
    return Math.ceil(this.hero.level / 2);
  }

  /** Blocker for pathing: tiles held by living creatures other than `self`. */
  occupiedBy(self: Actor) {
    return (x: number, y: number) => this.actors.some((a) => a !== self && !a.dead && a.pos.x === x && a.pos.y === y);
  }

  /** Tiles the hero can still walk to this turn (combat) with their costs. */
  heroReach() {
    const budget = this.inCombat ? this.hero.movesLeft : 40;
    return reachable(this.map, this.hero.pos, budget, this.occupiedBy(this.hero));
  }

  los(a: Pt, b: Pt): boolean {
    return hasLos(this.map, a, b);
  }

  hostilesAdjacent(a: Actor): Actor[] {
    return this.actors.filter((o) => !o.dead && o.team !== a.team && (o.team === "hero" || o.awake) && dist(o.pos, a.pos) === 1);
  }

  /** Advantage/disadvantage sources for an attack, also used for the hover "chance to hit". */
  attackEdge(attacker: Actor, target: Actor, ranged: boolean): { adv: string[]; dis: string[] } {
    const adv: string[] = [];
    const dis: string[] = [];
    if (attacker.cond.hidden) adv.push("hidden");
    if (target.cond.marked) adv.push("guided");
    if (target.cond.stunned) adv.push("stunned");
    if (attacker === this.hero && this.hero.cls === "rogue" && this.inCombat && !target.hasActed) adv.push("ambush");
    if (attacker.team === "enemy" && this.monsterDef(attacker).traits.includes("pack_tactics")) {
      // Solo tuning: the pack needs two other members at your side, not one.
      const pack = this.actors.filter((o) => o !== attacker && !o.dead && o.team === "enemy" && o.awake && dist(o.pos, target.pos) === 1);
      if (pack.length >= 2) adv.push("pack");
    }
    if (target.cond.dodging) dis.push("dodging");
    if (target.cond.hidden && attacker.team === "enemy") dis.push("unseen");
    if (ranged && this.hostilesAdjacent(attacker).length > 0) dis.push("in melee");
    if (attacker.cond.turned) dis.push("turned");
    return { adv, dis };
  }

  /** Chance (0..1) that an attack with this bonus hits this AC. */
  static hitChance(toHit: number, ac: number, mode: number): number {
    const need = Math.min(20, Math.max(2, ac - toHit));
    const p = (21 - need) / 20;
    if (mode > 0) return 1 - (1 - p) ** 2;
    if (mode < 0) return p * p;
    return p;
  }

  // ------------------------------------------------------------ event helpers

  emit(e: GameEvent): void {
    this.ev.push(e);
  }

  log(text: string, tone: Tone = "info"): void {
    this.emit({ t: "log", text, tone });
  }

  float(a: Actor, text: string, tone: Tone): void {
    this.emit({ t: "float", id: a.id, text, tone });
  }

  private flush(): GameEvent[] {
    const out = this.ev;
    this.ev = [];
    return out;
  }

  // ------------------------------------------------------------ sight

  refreshFov(): void {
    this.visible = computeFov(this.map, this.hero.pos, SIGHT);
    for (const i of this.visible) this.seen[i] = 1;
    this.emit({ t: "fov", visible: [...this.visible] });
  }

  /** Unaware monsters the hero can now see wake up, with the rest of their group. */
  private checkNotice(): Actor[] {
    return this.monsters.filter((m) => !m.awake && this.isVisible(m.pos) && dist(m.pos, this.hero.pos) <= NOTICE);
  }

  private wakeGroups(seeds: Actor[]): Actor[] {
    const groups = new Set(seeds.map((s) => s.group));
    const woke: Actor[] = [];
    for (const m of this.monsters) {
      if (!m.awake && (groups.has(m.group) || seeds.includes(m))) {
        m.awake = true;
        woke.push(m);
      }
    }
    return woke;
  }

  // ------------------------------------------------------------ combat flow

  /** Starts a fight. `opened` = the hero struck first, so those foes are not surprised but still roll. */
  beginCombat(seeds: Actor[], opened = false): void {
    const woke = this.wakeGroups(seeds);
    if (!woke.length && !this.monsters.some((m) => m.awake)) return;
    const h = this.hero;
    if (h.cls === "wizard") {
      h.ward = this.wardMax();
      this.float(h, `Ember Ward ${h.ward}`, "magic");
    }
    const stealth = roll(this.rng, "1d20", this.mod(h, "dex") + CLASSES[h.cls].stealthBonus).total;
    const surprised: number[] = [];
    if (!opened) {
      for (const m of woke) {
        const passive = 10 + this.mod(m, "wis");
        if (stealth > passive && !this.monsterDef(m).traits.includes("boss")) {
          m.cond.surprised = true;
          surprised.push(m.id);
        }
      }
    }
    h.initiative = roll(this.rng, "1d20", this.mod(h, "dex")).total + 0.5;
    for (const m of woke) m.initiative = roll(this.rng, "1d20", this.mod(m, "dex")).total;
    for (const a of this.actors) a.hasActed = false;
    this.inCombat = true;
    this.round = 1;
    this.order = [h, ...this.monsters.filter((m) => m.awake)].sort((a, b) => b.initiative - a.initiative).map((a) => a.id);
    this.turnIdx = -1;
    this.emit({ t: "combatStart", order: [...this.order], surprised });
    this.log(`Roll for initiative! You rolled ${Math.floor(h.initiative)}.`, "info");
    if (surprised.length) this.log(`Stealth ${stealth}: ${surprised.length === woke.length ? "they never saw you coming" : "some of them are caught off guard"}.`, "good");
  }

  /** Monsters that come into view mid-fight join the initiative order. */
  private joinCombat(seeds: Actor[]): void {
    const woke = this.wakeGroups(seeds);
    if (!woke.length) return;
    const cur = this.order[this.turnIdx];
    for (const m of woke) m.initiative = roll(this.rng, "1d20", this.mod(m, "dex")).total;
    const all = [...this.order.map((id) => this.byId(id)!), ...woke];
    this.order = all.filter((a) => !a.dead).sort((a, b) => b.initiative - a.initiative).map((a) => a.id);
    this.turnIdx = this.order.indexOf(cur);
    this.emit({ t: "joinCombat", order: [...this.order] });
    this.log(`${woke.length === 1 ? `A ${woke[0].name} joins` : `${woke.length} more foes join`} the fight!`, "bad");
  }

  private resetTurn(a: Actor): void {
    a.movesLeft = a.speed;
    a.actionUsed = false;
    a.bonusUsed = false;
    a.reactionUsed = false;
    a.attacksLeft = 0;
    a.sneakUsed = false;
    a.cond.dodging = false;
    a.cond.disengaged = false;
  }

  private checkCombatEnd(): boolean {
    if (!this.inCombat || this.over) return false;
    if (this.monsters.some((m) => m.awake)) return false;
    this.inCombat = false;
    this.order = [];
    this.turnIdx = -1;
    this.resetTurn(this.hero);
    this.hero.cond = {};
    this.hero.ward = 0;
    this.emit({ t: "combatEnd" });
    this.log("The last foe falls. Silence returns to the dark.", "good");
    if (this.depth === FINAL_DEPTH && !this.actors.some((a) => a.def === "wight" && !a.dead)) {
      this.over = "victory";
      this.emit({ t: "victory" });
    }
    return true;
  }

  /** Runs turns until the hero needs to decide something (or the fight ends). */
  private advance(): void {
    let guard = 0;
    while (this.inCombat && !this.over && guard++ < 200) {
      this.turnIdx++;
      if (this.turnIdx >= this.order.length) {
        this.turnIdx = 0;
        this.round++;
      }
      const a = this.byId(this.order[this.turnIdx]);
      if (!a || a.dead) continue;
      this.resetTurn(a);
      this.emit({ t: "turn", id: a.id, round: this.round });
      if (a.cond.surprised) {
        a.cond.surprised = false;
        a.hasActed = true;
        this.float(a, "Surprised!", "dim");
        continue;
      }
      if (a.cond.stunned) {
        a.cond.stunned--;
        if (!a.cond.stunned) delete a.cond.stunned;
        a.hasActed = true;
        this.float(a, "Stunned", "bad");
        this.log(`${a === this.hero ? "You are" : `The ${a.name} is`} stunned and lose${a === this.hero ? "" : "s"} the turn.`, a === this.hero ? "bad" : "good");
        continue;
      }
      if (a === this.hero && a.flags.opener) {
        // The hero's ambush already used this turn.
        a.flags.opener = false;
        a.hasActed = true;
        continue;
      }
      if (a === this.hero) {
        if (this.hero.cond.hidden && this.monsters.some((m) => m.awake && dist(m.pos, this.hero.pos) <= 1)) {
          this.hero.cond.hidden = false;
        }
        return;
      }
      runMonsterTurn(this, a);
      a.hasActed = true;
      this.checkCombatEnd();
    }
  }

  // ------------------------------------------------------------ rolls & damage

  d20(adv: number, dis: number) {
    return rollD20(this.rng, adv, dis);
  }

  attack(attacker: Actor, target: Actor, o: AttackOpts): boolean {
    const edge = this.attackEdge(attacker, target, o.ranged);
    const d = this.d20(edge.adv.length, edge.dis.length);
    const toHit = o.toHit + (attacker.team === "enemy" ? this.diff.monsterToHit : 0);
    const total = d.natural + toHit;
    const critOn = attacker === this.hero && this.hero.cls === "fighter" && this.hero.level >= 3 ? 19 : 20;
    const crit = d.natural >= critOn;
    const hit = crit || (d.natural !== 1 && total >= target.ac);
    const info: RollInfo = { d20: d, bonus: toHit, total, target: target.ac, label: o.label };
    this.emit({ t: "attack", attacker: attacker.id, target: target.id, fx: o.fx, roll: info, hit, crit });
    const who = attacker === this.hero ? "You" : `The ${attacker.name}`;
    const whom = target === this.hero ? "you" : `the ${target.name}`;
    const edgeText = d.mode > 0 ? ` (advantage: ${edge.adv.join(", ")})` : d.mode < 0 ? ` (disadvantage: ${edge.dis.join(", ")})` : "";
    attacker.cond.hidden = false;
    if (target.cond.marked) target.cond.marked = false;

    if (!hit) {
      this.float(target, d.natural === 1 ? "Fumble!" : "Miss", "miss");
      const verb = o.label === "Opportunity" ? "lash out at" : "attack";
      this.log(`${who} ${attacker === this.hero ? verb : verb.replace(/^(\w+)/, "$1es").replace("attackes", "attacks")} ${whom} — ${d.natural === 1 ? "natural 1, a clean miss" : `${total} vs AC ${target.ac}, miss`}${edgeText}.`, "miss");
      return false;
    }
    if (crit && attacker === this.hero) this.stats.crits++;
    const mult = crit ? 2 : 1;
    let total2 = roll(this.rng, o.dice, o.extraDamage ?? 0, mult).total;
    let note = "";
    const duel = !o.ranged && this.hostilesAdjacent(attacker).length === 1;
    if (o.sneak && attacker === this.hero && this.hero.cls === "rogue" && !this.hero.sneakUsed && (d.mode > 0 || target.cond.stunned || duel)) {
      const s = roll(this.rng, `${this.sneakDice()}d6`, 0, mult);
      total2 += s.total;
      this.hero.sneakUsed = true;
      note = "Sneak Attack";
    }
    if (o.blessed && attacker === this.hero && this.hero.cls === "cleric") {
      total2 += roll(this.rng, this.blessedDice(), 0, mult).total;
      note = "Blessed";
    }
    this.log(`${who} hit${attacker === this.hero ? "" : "s"} ${whom}${crit ? " — CRITICAL!" : ""} ${total} vs AC ${target.ac}${edgeText}.`, crit ? "crit" : attacker === this.hero ? "good" : "bad");
    const dealt = this.damage(target, total2, o.type, { crit, note, by: attacker, fromAttack: true });
    o.onHit?.(crit, dealt);
    return true;
  }

  save(target: Actor, ab: Ability, dc: number, label: string): boolean {
    let bonus = this.mod(target, ab);
    if (target === this.hero && SAVE_PROFS[this.hero.cls].includes(ab)) bonus += this.prof();
    const d = this.d20(0, 0);
    const total = d.natural + bonus;
    const success = total >= dc;
    this.emit({ t: "save", target: target.id, roll: { d20: d, bonus, total, target: dc, label }, success });
    return success;
  }

  damage(target: Actor, amount: number, type: DamageType, o: { crit?: boolean; note?: string; by?: Actor; fromAttack?: boolean } = {}): number {
    if (target.dead || amount <= 0) return 0;
    let n = amount;
    let note = o.note ?? "";
    if (target === this.hero) {
      const h = this.hero;
      // Rogue: Uncanny Dodge halves the first weapon or spell attack that lands each round.
      if (h.cls === "rogue" && h.level >= 3 && o.fromAttack && !h.reactionUsed && this.inCombat) {
        h.reactionUsed = true;
        n = Math.ceil(n / 2);
        note = note ? `${note} · Uncanny Dodge` : "Uncanny Dodge";
      }
      // Wizard: Ember Ward soaks damage first.
      if (h.ward && h.ward > 0) {
        const soak = Math.min(h.ward, n);
        h.ward -= soak;
        n -= soak;
        this.float(h, `Ward −${soak}`, "magic");
        this.emit({ t: "hero" });
        if (n <= 0) {
          this.log(`Your Ember Ward drinks the blow${h.ward ? "" : " and gutters out"}.`, "magic");
          return 0;
        }
      }
    }
    if (target.team === "enemy") {
      const traits = this.monsterDef(target).traits;
      if (traits.includes("vuln_bludgeoning") && type === "bludgeoning") {
        n *= 2;
        note = note ? `${note} · Vulnerable` : "Vulnerable";
      }
    }
    target.hp -= n;
    if (target === this.hero) this.stats.damageTaken += n;
    else if (o.by === this.hero) this.stats.damageDealt += n;

    if (target.hp <= 0 && target.team === "enemy" && this.monsterDef(target).traits.includes("undead_fortitude") && type !== "radiant" && !o.crit) {
      this.emit({ t: "damage", target: target.id, amount: n, type, hpAfter: 0, crit: o.crit, note });
      if (this.save(target, "con", 5 + n, "Undead Fortitude")) {
        target.hp = 1;
        this.emit({ t: "heal", target: target.id, amount: 1, hpAfter: 1 });
        this.float(target, "Refuses to fall!", "bad");
        this.log(`The ${target.name} lurches back up!`, "bad");
        return n;
      }
      target.hp = 0;
    } else {
      this.emit({ t: "damage", target: target.id, amount: n, type, hpAfter: Math.max(0, target.hp), crit: o.crit, note });
    }

    if (target.hp <= 0 && target === this.hero && (this.hero.defyUsed ?? 0) < this.diff.defyDeath) {
      // Solo safety net: once per depth, a killing blow leaves you standing at 1 HP.
      this.hero.defyUsed = (this.hero.defyUsed ?? 0) + 1;
      target.hp = 1;
      this.emit({ t: "heal", target: target.id, amount: 1, hpAfter: 1 });
      this.float(target, "Defy Death!", "crit");
      this.log("Darkness swims at the edge of your sight… but you refuse to fall. (Defy Death)", "gold");
      return n;
    }
    if (target.hp <= 0) this.kill(target);
    return n;
  }

  heal(target: Actor, amount: number): void {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.emit({ t: "heal", target: target.id, amount: target.hp - before, hpAfter: target.hp });
  }

  private kill(a: Actor): void {
    a.hp = 0;
    a.dead = true;
    this.emit({ t: "death", id: a.id });
    if (a === this.hero) {
      this.over = "dead";
      this.log("You fall. The dark closes in.", "bad");
      this.emit({ t: "heroDied" });
      return;
    }
    this.hero.kills++;
    this.log(`The ${a.name} is slain.`, "good");
    if (["goblin", "goblin_archer", "orc", "hobgoblin", "bugbear", "ogre"].includes(a.def) && this.rng.chance(0.5)) {
      const coins = roll(this.rng, `${this.depth}d6`).total;
      this.hero.gold += coins;
      this.float(a, `+${coins} gold`, "gold");
    }
    this.gainXp(this.monsterDef(a).xp);
  }

  gainXp(n: number): void {
    const h = this.hero;
    h.xp += n;
    this.emit({ t: "xp", amount: n, total: h.xp });
    while (h.level < MAX_LEVEL && h.xp >= XP_LEVELS[h.level]) this.levelUp();
  }

  private levelUp(): void {
    const h = this.hero;
    const c = CLASSES[h.cls];
    h.level++;
    const gains: string[] = [];
    if (h.level === 4) {
      h.scores[c.primary] += 2;
      gains.push(`${c.primary.toUpperCase()} +2`);
    }
    const hpGain = c.hpPerLevel + abilityMod(h.scores.con) + SOLO_HP_PER_LEVEL + this.diff.heroHpPerLevel;
    h.maxHp += hpGain;
    h.hp += hpGain;
    gains.unshift(`+${hpGain} max HP`);
    const newSlots = c.slots[h.level - 1];
    if (newSlots > h.slotsMax) {
      h.slots += newSlots - h.slotsMax;
      h.slotsMax = newSlots;
      gains.push(`${newSlots} spell slots`);
    }
    if (h.level === 5) gains.push("Proficiency +3");
    const extra: Record<ClassId, Record<number, string>> = {
      fighter: { 3: "Improved Critical (19–20)", 5: "Extra Attack" },
      rogue: { 3: "Sneak Attack 2d6 · Uncanny Dodge", 5: "Sneak Attack 3d6" },
      wizard: { 3: "Misty Step", 5: "Fireball · Fire Bolt 2d10" },
      cleric: { 2: "Turn Undead", 5: "Destroy Undead · Sacred Flame 2d8" },
    };
    const e = extra[h.cls][h.level];
    if (e) gains.push(e);
    h.ac = this.heroAc();
    this.emit({ t: "levelUp", level: h.level, maxHp: h.maxHp, gains });
    this.log(`You reach level ${h.level}! ${gains.join(", ")}.`, "gold");
  }

  // ------------------------------------------------------------ movement

  /** Moves one tile; handles doors, sight, reactions. Returns false if the mover can't continue. */
  stepActor(a: Actor, to: Pt): boolean {
    // Opportunity attacks: leaving a hostile's reach without disengaging.
    if (this.inCombat && !a.cond.disengaged) {
      for (const o of this.hostilesAdjacent(a)) {
        if (o.reactionUsed || o.cond.stunned || o.cond.turned || dist(o.pos, to) <= 1) continue;
        if (o.team === "enemy" && !o.awake) continue;
        o.reactionUsed = true;
        this.float(o, "Opportunity attack", "dim");
        this.opportunityAttack(o, a);
        if (a.dead || this.over) return false;
      }
    }
    const from = { ...a.pos };
    a.pos = { ...to };
    this.emit({ t: "move", id: a.id, from, to: { ...to } });
    const ti = idx(this.map, to.x, to.y);
    if (this.map.tiles[ti] === T.Door) {
      this.map.tiles[ti] = T.DoorOpen;
      this.emit({ t: "door", at: { ...to } });
      if (a !== this.hero) this.refreshFov();
    }
    if (a === this.hero) this.refreshFov();
    if (this.inCombat) {
      const seen = this.checkNotice();
      if (seen.length) this.joinCombat(seen);
    }
    return true;
  }

  private opportunityAttack(o: Actor, target: Actor): void {
    if (o === this.hero) {
      const w = CLASSES[this.hero.cls].weapon;
      this.attack(o, target, { toHit: this.weaponToHit(), dice: this.weaponDamage(), type: w.type, ranged: false, fx: w.fx, label: "Opportunity" });
    } else {
      const atk = this.monsterDef(o).attacks.find((x) => !x.ranged);
      if (atk) this.attack(o, target, { toHit: atk.toHit, dice: atk.dice, type: atk.type, ranged: false, fx: atk.fx, label: "Opportunity" });
    }
  }

  /** Hero walks toward a tile. Out of combat: any distance. In combat: up to remaining movement. */
  moveHero(to: Pt): GameEvent[] {
    if (!this.isHeroTurn()) return [];
    const h = this.hero;
    let path: Pt[] | null;
    if (this.inCombat) {
      path = pathFromReach(this.map, this.heroReach(), to);
    } else {
      path = findPath(this.map, h.pos, to, this.occupiedBy(h));
    }
    if (!path || !path.length) return this.flush();
    this.walk(path);
    return this.flush();
  }

  private walk(path: Pt[]): void {
    const h = this.hero;
    for (const p of path) {
      if (this.inCombat) {
        if (h.movesLeft < 1) break;
        h.movesLeft--;
      }
      if (!this.stepActor(h, p)) break;
      if (!this.inCombat) {
        this.stats.turns++;
        const seen = this.checkNotice();
        if (seen.length) {
          this.beginCombat(seen);
          this.advance();
          break;
        }
        if (tileAt(this.map, p.x, p.y) === T.Stairs && p === path[path.length - 1]) {
          this.emit({ t: "stairs" });
        }
      }
    }
  }

  /** Walk next to something, then do `then` (attack, open a chest). Returns false if unreachable. */
  approach(target: Pt): boolean {
    const h = this.hero;
    if (dist(h.pos, target) <= 1) return true;
    if (this.inCombat) {
      const reach = this.heroReach();
      let best: Pt | null = null;
      let bestCost = Infinity;
      for (const [i, r] of reach) {
        const p = { x: i % this.map.w, y: (i / this.map.w) | 0 };
        if (dist(p, target) === 1 && r.cost < bestCost) { best = p; bestCost = r.cost; }
      }
      if (!best) return false;
      this.walk(pathFromReach(this.map, reach, best)!);
    } else {
      const path = findPath(this.map, h.pos, target, this.occupiedBy(h), true);
      if (!path) return false;
      this.walk(path);
    }
    return !h.dead && dist(h.pos, target) <= 1;
  }

  // ------------------------------------------------------------ hero commands

  endTurn(): GameEvent[] {
    if (!this.inCombat || !this.isHeroTurn()) return [];
    this.hero.hasActed = true;
    this.stats.turns++;
    this.advance();
    return this.flush();
  }

  /** Called by hero actions after they resolve: start a fight if needed, end it if won. */
  afterHeroAction(openedOn?: Actor): void {
    if (this.over) return;
    if (this.inCombat) {
      this.checkCombatEnd();
      return;
    }
    const seeds = this.checkNotice();
    if (openedOn) seeds.push(openedOn);
    const anyAlive = seeds.some((s) => this.monsters.some((m) => m.group === s.group || m === s));
    if (seeds.length && anyAlive) {
      this.beginCombat(seeds, !!openedOn);
      if (this.inCombat) {
        if (openedOn) this.hero.flags.opener = true;
        this.advance();
        return;
      }
    }
    this.resetTurn(this.hero);
  }

  openChest(at: Pt): GameEvent[] {
    if (!this.isHeroTurn()) return [];
    const chest = this.map.props.find((p) => p.kind === "chest" && p.x === at.x && p.y === at.y && !p.opened);
    if (!chest) return [];
    if (!this.approach(at)) return this.flush();
    if (this.inCombat && this.order[this.turnIdx] !== this.hero.id) return this.flush();
    chest.opened = true;
    this.stats.chests++;
    const loot = this.rollLoot();
    this.emit({ t: "chest", at: { ...at }, loot });
    this.log(`The chest creaks open: ${loot.join(", ")}.`, "gold");
    return this.flush();
  }

  private rollLoot(): string[] {
    const h = this.hero;
    const r = this.rng;
    const out: string[] = [];
    const gold = r.int(8, 20) * this.depth + r.int(0, 10);
    h.gold += gold;
    out.push(`${gold} gold`);
    if (r.chance(0.6)) {
      const n = r.chance(0.25) ? 2 : 1;
      h.potions += n;
      out.push(n > 1 ? `${n} Potions of Healing` : "a Potion of Healing");
    }
    if (r.chance(0.18) && h.weaponBonus < 3) {
      h.weaponBonus++;
      out.push(`Runed whetstone (weapon +${h.weaponBonus})`);
    } else if (r.chance(0.14) && h.armorBonus < 2) {
      h.armorBonus++;
      h.ac = this.heroAc();
      out.push(`Dwarven plates (AC +1)`);
    }
    if (r.chance(0.2) && h.slotsMax > 0 && h.slots < h.slotsMax) {
      h.slots++;
      out.push("an Ember Shard (1 spell slot restored)");
    }
    return out;
  }

  restsLeft(): number {
    return Math.max(0, this.diff.restsPerDepth - this.hero.restsUsed);
  }

  /** Why a short rest isn't possible right now (null = it is). */
  restBlocked(): string | null {
    const h = this.hero;
    if (this.over) return "The run is over";
    if (this.inCombat) return "Not while foes are near";
    if (h.restsUsed >= this.diff.restsPerDepth) return "No more rests on this depth";
    if (h.hp >= h.maxHp && !Object.keys(h.featureUses).length && h.slots >= h.slotsMax) return "Nothing to recover";
    return null;
  }

  /**
   * Short rest: spend hit dice to heal and recover per-depth features. Once per depth,
   * and the dark doesn't always let you: wandering monsters may find you.
   */
  shortRest(): GameEvent[] {
    if (this.restBlocked()) return [];
    const h = this.hero;
    const c = CLASSES[h.cls];
    h.restsUsed++;
    this.emit({ t: "spell", caster: h.id, fx: "rest", at: { ...h.pos } });
    let healed = 0;
    let spent = 0;
    while (h.hitDice > 0 && h.hp + healed < h.maxHp) {
      h.hitDice--;
      spent++;
      healed += Math.max(1, roll(this.rng, `1d${c.hitDie}`, abilityMod(h.scores.con)).total);
    }
    if (healed) this.heal(h, healed);
    const recovered: string[] = [];
    if (Object.keys(h.featureUses).length) {
      h.featureUses = {};
      recovered.push("class features");
    }
    if (h.slotsMax > 0 && h.slots < h.slotsMax) {
      const n = Math.min(h.slotsMax - h.slots, Math.ceil(h.level / 2));
      h.slots += n;
      recovered.push(`${n} spell slot${n > 1 ? "s" : ""}`);
    }
    this.log(`You rest by your lantern${spent ? `, spending ${spent} hit ${spent > 1 ? "dice" : "die"}` : ""}${recovered.length ? ` and recover ${recovered.join(" and ")}` : ""}.`, "good");
    this.emit({ t: "hero" });
    if (this.rng.chance(0.25)) this.wanderers();
    return this.flush();
  }

  /** A wandering group, drawn by the light, arrives out of the dark. */
  private wanderers(): void {
    const h = this.hero;
    const cands: Pt[] = [];
    for (let i = 0; i < this.seen.length; i++) {
      if (!this.seen[i] || this.visible.has(i)) continue;
      const p = { x: i % this.map.w, y: (i / this.map.w) | 0 };
      const d = dist(p, h.pos);
      if (d < 6 || d > 14 || this.map.tiles[i] !== T.Floor || this.map.solid[i] || this.actorAt(p.x, p.y)) continue;
      if (!findPath(this.map, p, h.pos, () => false, true, 600)) continue;
      cands.push(p);
    }
    if (!cands.length) return;
    const table = MONSTER_TABLE(this.depth).filter(([id]) => MONSTERS[id].xp <= 100);
    const id = this.rng.weighted(table.length ? table : [["rat", 1] as [string, number]]);
    const count = this.rng.int(1, MONSTERS[id].xp <= 50 ? 3 : 2);
    const origin = this.rng.pick(cands);
    const group = 1000 + this.rng.int(0, 99999);
    const spawned: Actor[] = [];
    for (let k = 0; k < count; k++) {
      const spot = cands.filter((c) => !this.actorAt(c.x, c.y)).sort((a, b) => dist(a, origin) - dist(b, origin))[0];
      if (!spot) break;
      const m = this.makeMonster(id, spot, group);
      this.actors.push(m);
      this.emit({ t: "spawn", actor: structuredClone(m) });
      spawned.push(m);
    }
    this.log(`Footsteps in the dark — your rest is cut short!`, "bad");
    this.beginCombat(spawned);
    this.advance();
  }

  shop(): ShopItem[] {
    const h = this.hero;
    return [
      { id: "potion", name: "Potion of Healing", desc: "Heals 2d4+2. Drink as a bonus action.", price: 30, soldOut: false },
      { id: "weapon", name: "Runed Whetstone", desc: `Your weapon becomes +${h.weaponBonus + 1}: to hit and damage.`, price: 120 * (h.weaponBonus + 1), soldOut: h.weaponBonus >= 3 },
      { id: "armor", name: "Dwarven Plates", desc: "Rivet them on: +1 AC.", price: 150 * (h.armorBonus + 1), soldOut: h.armorBonus >= 2 },
    ];
  }

  buy(id: ShopItem["id"]): boolean {
    const item = this.shop().find((i) => i.id === id);
    const h = this.hero;
    if (!item || item.soldOut || h.gold < item.price) return false;
    h.gold -= item.price;
    if (id === "potion") h.potions++;
    if (id === "weapon") h.weaponBonus++;
    if (id === "armor") { h.armorBonus++; h.ac = this.heroAc(); }
    return true;
  }

  /** Called by the UI when the player chooses to take the stairs. */
  canDescend(): boolean {
    return !this.inCombat && !this.over && this.map.stairs !== null &&
      this.hero.pos.x === this.map.stairs.x && this.hero.pos.y === this.map.stairs.y;
  }

  /** Utility for the view: what message to show for a log line. */
  static toneFor(team: Actor["team"]): Tone {
    return team === "hero" ? "good" : "bad";
  }

  /** Utility for actions: alive, awake-or-not enemies in range with line of sight. */
  targetsInRange(range: number): Actor[] {
    return this.monsters.filter((m) => this.isVisible(m.pos) && dist(m.pos, this.hero.pos) <= range && this.los(this.hero.pos, m.pos));
  }

  takeEvents(): GameEvent[] {
    return this.flush();
  }

  spawnMonster(id: string, pos: Pt, group: number): Actor {
    const a = this.makeMonster(id, pos, group);
    a.awake = true;
    a.initiative = roll(this.rng, "1d20", this.mod(a, "dex")).total;
    this.actors.push(a);
    this.emit({ t: "spawn", actor: structuredClone(a) });
    if (this.inCombat) {
      const cur = this.order[this.turnIdx];
      this.order.push(a.id);
      this.order = this.order.map((id) => this.byId(id)!).filter((x) => !x.dead).sort((p, q) => q.initiative - p.initiative).map((x) => x.id);
      this.turnIdx = this.order.indexOf(cur);
      this.emit({ t: "joinCombat", order: [...this.order] });
    }
    return a;
  }
}
