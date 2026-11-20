import type { DamageType, Scores } from "../game/types";

export interface MonsterAttack {
  name: string;
  toHit: number;
  dice: string;
  type: DamageType;
  /** Tiles. Melee is 1. */
  range: number;
  ranged: boolean;
  fx: string;
}

export type Trait =
  | "pack_tactics" | "nimble" | "undead" | "undead_fortitude" | "aggressive"
  | "stun_claws" | "vuln_bludgeoning" | "life_drain" | "summoner" | "brute" | "boss";

export interface MonsterDef {
  id: string;
  name: string;
  ac: number;
  hp: number;
  /** Tiles per turn (30 ft = 6). */
  speed: number;
  scores: Scores;
  attacks: MonsterAttack[];
  /** Number of attacks per turn. */
  multiattack: number;
  xp: number;
  traits: Trait[];
  /** Short line for the inspect tooltip. */
  lore: string;
}

const s = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Scores =>
  ({ str, dex, con, int, wis, cha });

const melee = (name: string, toHit: number, dice: string, type: DamageType, fx = "slash"): MonsterAttack =>
  ({ name, toHit, dice, type, range: 1, ranged: false, fx });

const ranged = (name: string, toHit: number, dice: string, type: DamageType, range: number, fx = "arrow"): MonsterAttack =>
  ({ name, toHit, dice, type, range, ranged: true, fx });

/** Stat blocks follow the 5e System Reference Document 5.1 (CC BY 4.0). */
export const MONSTERS: Record<string, MonsterDef> = {
  rat: {
    id: "rat", name: "Giant Rat", ac: 12, hp: 7, speed: 6, scores: s(7, 15, 11, 2, 10, 4),
    attacks: [melee("Bite", 4, "1d4+2", "piercing", "bite")], multiattack: 1, xp: 25,
    traits: ["pack_tactics"], lore: "Bold in a pack. Advantage when two packmates surround its prey.",
  },
  goblin: {
    id: "goblin", name: "Goblin", ac: 15, hp: 7, speed: 6, scores: s(8, 14, 10, 10, 8, 8),
    attacks: [melee("Scimitar", 4, "1d6+2", "slashing")], multiattack: 1, xp: 50,
    traits: ["nimble"], lore: "Quick, mean, and fond of hit-and-run.",
  },
  goblin_archer: {
    id: "goblin_archer", name: "Goblin Archer", ac: 13, hp: 7, speed: 6, scores: s(8, 14, 10, 10, 8, 8),
    attacks: [ranged("Shortbow", 4, "1d6+2", "piercing", 8), melee("Dagger", 4, "1d4+2", "piercing", "stab")],
    multiattack: 1, xp: 50, traits: ["nimble"], lore: "Keeps its distance and shoots from the dark.",
  },
  skeleton: {
    id: "skeleton", name: "Skeleton", ac: 13, hp: 13, speed: 6, scores: s(10, 14, 15, 6, 8, 5),
    attacks: [melee("Shortsword", 4, "1d6+2", "piercing", "stab")], multiattack: 1, xp: 50,
    traits: ["undead", "vuln_bludgeoning"], lore: "Old bones on old orders. Brittle against blunt blows.",
  },
  skeleton_archer: {
    id: "skeleton_archer", name: "Skeleton Archer", ac: 13, hp: 13, speed: 6, scores: s(10, 14, 15, 6, 8, 5),
    attacks: [ranged("Shortbow", 4, "1d6+2", "piercing", 8), melee("Claw", 4, "1d4+2", "slashing")],
    multiattack: 1, xp: 50, traits: ["undead", "vuln_bludgeoning"], lore: "It never blinks, and it never misses its mark twice.",
  },
  zombie: {
    id: "zombie", name: "Zombie", ac: 8, hp: 22, speed: 4, scores: s(13, 6, 16, 3, 6, 5),
    attacks: [melee("Slam", 3, "1d6+1", "bludgeoning", "smash")], multiattack: 1, xp: 50,
    traits: ["undead", "undead_fortitude"], lore: "Slow, and hard to keep down. Radiant light or a critical hit ends it.",
  },
  orc: {
    id: "orc", name: "Orc", ac: 13, hp: 15, speed: 6, scores: s(16, 12, 16, 7, 11, 10),
    attacks: [melee("Greataxe", 5, "1d12+3", "slashing", "cleave")], multiattack: 1, xp: 100,
    traits: ["aggressive"], lore: "Charges straight in. Hits like a falling door.",
  },
  hobgoblin: {
    id: "hobgoblin", name: "Hobgoblin", ac: 18, hp: 11, speed: 6, scores: s(13, 12, 12, 10, 10, 9),
    attacks: [melee("Longsword", 3, "1d10+1", "slashing"), ranged("Longbow", 3, "1d8+1", "piercing", 10)],
    multiattack: 1, xp: 100, traits: [], lore: "Drilled soldiers in plate. Hard to hit.",
  },
  ghoul: {
    id: "ghoul", name: "Ghoul", ac: 12, hp: 22, speed: 6, scores: s(13, 15, 10, 7, 10, 6),
    attacks: [melee("Claws", 4, "2d4+2", "slashing", "claw")], multiattack: 1, xp: 200,
    traits: ["undead", "stun_claws"], lore: "Its claws numb the flesh. Fail the save and you lose a turn.",
  },
  bugbear: {
    id: "bugbear", name: "Bugbear", ac: 16, hp: 27, speed: 6, scores: s(15, 14, 13, 8, 11, 9),
    attacks: [melee("Morningstar", 4, "2d8+2", "piercing", "smash")], multiattack: 1, xp: 200,
    traits: ["brute"], lore: "Big, hairy and quieter than it looks.",
  },
  ogre: {
    id: "ogre", name: "Ogre", ac: 11, hp: 59, speed: 6, scores: s(19, 8, 16, 5, 7, 7),
    attacks: [melee("Greatclub", 6, "2d8+4", "bludgeoning", "smash")], multiattack: 1, xp: 450,
    traits: [], lore: "A mountain of appetite. One hit can end a careless hero.",
  },
  wight: {
    id: "wight", name: "Varrow, the Ember Wight", ac: 15, hp: 78, speed: 6, scores: s(15, 14, 16, 10, 13, 15),
    attacks: [
      melee("Ember Blade", 5, "1d10+3", "fire", "cleave"),
      melee("Life Drain", 5, "2d6+2", "necrotic", "drain"),
      ranged("Cinder Bolt", 5, "2d8", "fire", 10, "cinder"),
    ],
    multiattack: 2, xp: 1100,
    traits: ["undead", "life_drain", "summoner", "boss"],
    lore: "The forge-lord who would not die. Calls the dead to stand with him.",
  },
};

/** Which monsters each depth draws from, with weights. */
export const DEPTH_TABLES: Record<number, [string, number][]> = {
  1: [["rat", 4], ["goblin", 4], ["goblin_archer", 2], ["skeleton", 1]],
  2: [["goblin", 3], ["goblin_archer", 2], ["skeleton", 3], ["skeleton_archer", 2], ["zombie", 3], ["hobgoblin", 1]],
  3: [["skeleton", 2], ["zombie", 3], ["orc", 4], ["hobgoblin", 3], ["skeleton_archer", 2], ["ghoul", 1]],
  4: [["orc", 3], ["hobgoblin", 2], ["ghoul", 3], ["bugbear", 3], ["skeleton_archer", 2]],
  5: [["skeleton", 3], ["skeleton_archer", 3], ["zombie", 2], ["ghoul", 3], ["bugbear", 1]],
};

/** XP worth of monsters placed on each depth (not counting the boss). */
export const DEPTH_BUDGET = [0, 300, 500, 800, 1100, 900];
