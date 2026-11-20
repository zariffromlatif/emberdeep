import type { Pt } from "../core/grid";
import type { D20Result } from "../core/dice";

export type Team = "hero" | "enemy";
export type DamageType =
  | "slashing" | "piercing" | "bludgeoning" | "fire" | "force" | "radiant" | "necrotic" | "poison" | "cold";
export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type Scores = Record<Ability, number>;

export type ClassId = "fighter" | "rogue" | "wizard" | "cleric";

export interface Conditions {
  /** Attacks against have disadvantage until this actor's next turn. */
  dodging?: boolean;
  /** Loses its next turn(s). */
  stunned?: number;
  /** Skips its first turn of combat. */
  surprised?: boolean;
  /** Next attack has advantage; enemies lose track. */
  hidden?: boolean;
  /** Next attack against this actor has advantage (Guiding Bolt). */
  marked?: boolean;
  /** Undead fleeing from holy power for N rounds. */
  turned?: number;
  /** No opportunity attacks this turn. */
  disengaged?: boolean;
}

export interface Actor {
  id: number;
  team: Team;
  /** Class id for the hero, monster id for enemies. */
  def: string;
  name: string;
  pos: Pt;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number;
  scores: Scores;
  dead: boolean;
  /** Enemies start unaware and wake in groups. */
  awake: boolean;
  group: number;
  initiative: number;
  /** Has taken at least one turn this combat. */
  hasActed: boolean;
  movesLeft: number;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  /** Attacks left inside the current Attack action (Extra Attack). */
  attacksLeft: number;
  /** Sneak Attack is once per turn. */
  sneakUsed: boolean;
  cond: Conditions;
  /** Boss phase flags and the like. */
  flags: Record<string, boolean>;
}

export interface Hero extends Actor {
  cls: ClassId;
  level: number;
  xp: number;
  slots: number;
  slotsMax: number;
  potions: number;
  gold: number;
  weaponBonus: number;
  armorBonus: number;
  /** Short-rest healing dice left this depth (one per level). */
  hitDice: number;
  /** Short rests taken this depth. */
  restsUsed: number;
  /** Per-floor features: Second Wind, Action Surge, Turn Undead. */
  featureUses: Record<string, number>;
  kills: number;
}

export interface RollInfo {
  d20: D20Result;
  bonus: number;
  total: number;
  target: number;
  label: string;
}

/** Everything the view needs to replay what the rules decided, in order. */
export type GameEvent =
  | { t: "move"; id: number; from: Pt; to: Pt }
  | { t: "teleport"; id: number; from: Pt; to: Pt }
  | { t: "fov"; visible: number[] }
  | { t: "door"; at: Pt }
  | { t: "combatStart"; order: number[]; surprised: number[] }
  | { t: "joinCombat"; order: number[] }
  | { t: "turn"; id: number; round: number }
  | { t: "attack"; attacker: number; target: number; fx: string; roll: RollInfo; hit: boolean; crit: boolean }
  | { t: "save"; target: number; roll: RollInfo; success: boolean }
  | { t: "damage"; target: number; amount: number; type: DamageType; hpAfter: number; crit?: boolean; note?: string }
  | { t: "heal"; target: number; amount: number; hpAfter: number }
  | { t: "death"; id: number }
  | { t: "spell"; caster: number; fx: string; at: Pt; tiles?: Pt[]; target?: number }
  | { t: "float"; id: number; text: string; tone: Tone }
  | { t: "log"; text: string; tone: Tone }
  | { t: "xp"; amount: number; total: number }
  | { t: "levelUp"; level: number; maxHp: number; gains: string[] }
  | { t: "chest"; at: Pt; loot: string[] }
  | { t: "spawn"; actor: Actor }
  | { t: "combatEnd" }
  | { t: "stairs" }
  | { t: "heroDied" }
  | { t: "victory" }
  | { t: "hero" };

export type Tone = "info" | "good" | "bad" | "crit" | "miss" | "magic" | "gold" | "dim";
