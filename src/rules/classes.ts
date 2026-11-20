import type { Ability, ClassId, DamageType, Scores } from "../game/types";

export interface Weapon {
  name: string;
  dice: string;
  ability: Ability;
  type: DamageType;
  fx: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  title: string;
  blurb: string;
  scores: Scores;
  /** Hit points gained per level after the first (SRD fixed average). */
  hpPerLevel: number;
  hitDie: number;
  baseAc: number;
  acNote: string;
  /** Adds Dexterity modifier to AC (light armour). */
  acDex: boolean;
  weapon: Weapon;
  primary: Ability;
  /** Spell slots by level, index 0 = level 1. */
  slots: number[];
  /** Proficient in Stealth with expertise (Rogue). */
  stealthBonus: number;
  /** Shown on the hero-select card. */
  traits: string[];
  difficulty: "Sturdy" | "Tricky" | "Fragile";
}

export const XP_LEVELS = [0, 250, 700, 1350, 2300];
export const MAX_LEVEL = 5;

export const proficiency = (level: number): number => (level >= 5 ? 3 : 2);

export const CLASSES: Record<ClassId, ClassDef> = {
  fighter: {
    id: "fighter",
    name: "Fighter",
    title: "Sworn Blade of Hollowmere",
    blurb: "Heavy steel and a stubborn heart. Shrugs off blows that would fold anyone else.",
    scores: { str: 16, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
    hpPerLevel: 6,
    hitDie: 10,
    baseAc: 18,
    acNote: "Chain mail + shield",
    acDex: false,
    weapon: { name: "Longsword", dice: "1d8", ability: "str", type: "slashing", fx: "slash" },
    primary: "str",
    slots: [0, 0, 0, 0, 0],
    stealthBonus: -2,
    traits: ["Second Wind: heal yourself once per depth", "Action Surge: a second action, once per depth", "Extra Attack at level 5"],
    difficulty: "Sturdy",
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    title: "Knife in the Dark",
    blurb: "Strikes first and strikes hard. Hides, slips away, and comes back for the kill.",
    scores: { str: 10, dex: 16, con: 14, int: 12, wis: 13, cha: 8 },
    hpPerLevel: 5,
    hitDie: 8,
    baseAc: 11,
    acNote: "Leather armour + Dex",
    acDex: true,
    weapon: { name: "Shortsword", dice: "1d6", ability: "dex", type: "piercing", fx: "stab" },
    primary: "dex",
    slots: [0, 0, 0, 0, 0],
    stealthBonus: 4,
    traits: ["Sneak Attack: bonus dice with the edge, or one-on-one", "Cunning Action: Hide, Dash or Disengage as a bonus", "Throws daggers at range"],
    difficulty: "Tricky",
  },
  wizard: {
    id: "wizard",
    name: "Wizard",
    title: "Scholar of the Ember Script",
    blurb: "Paper-thin and devastating. Fire Bolt at will, and spells that empty whole rooms.",
    scores: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    hpPerLevel: 4,
    hitDie: 6,
    baseAc: 13,
    acNote: "Mage Armour + Dex",
    acDex: true,
    weapon: { name: "Quarterstaff", dice: "1d6", ability: "str", type: "bludgeoning", fx: "smash" },
    primary: "int",
    slots: [2, 3, 4, 5, 6],
    stealthBonus: 0,
    traits: ["Fire Bolt and Magic Missile", "Burning Hands, Misty Step at 3, Fireball at 5", "Fewest hit points: keep your distance"],
    difficulty: "Fragile",
  },
  cleric: {
    id: "cleric",
    name: "Cleric",
    title: "Lantern of the Dawnfather",
    blurb: "Mace in one hand, holy fire in the other. Heals the wounds the dark leaves behind.",
    scores: { str: 14, dex: 10, con: 14, int: 8, wis: 16, cha: 12 },
    hpPerLevel: 5,
    hitDie: 8,
    baseAc: 16,
    acNote: "Scale mail + shield",
    acDex: false,
    weapon: { name: "Mace", dice: "1d6", ability: "str", type: "bludgeoning", fx: "smash" },
    primary: "wis",
    slots: [2, 3, 4, 5, 6],
    stealthBonus: -2,
    traits: ["Blessed Strikes: mace hits add radiant damage", "Disciple of Life: stronger healing spells", "Turn Undead from level 2"],
    difficulty: "Sturdy",
  },
};
