export type Difficulty = "story" | "normal" | "hard";

/**
 * Every dial a difficulty turns. Competent-bot win rates (100 runs per class, Nov 2026):
 * Story ~90%, Normal ~51%, Hard ~15%. Normal is the tuned baseline (all neutral values);
 * Story and Hard were tuned against the competent-player bot (tests/bot.ts):
 *   BALANCE=1 BALANCE_DIFFICULTY=story npx vitest run tests/balance.test.ts
 */
export interface DifficultyDef {
  id: Difficulty;
  name: string;
  blurb: string;
  /** Extra hero hit points at level 1, and per level after. */
  heroHp: number;
  heroHpPerLevel: number;
  potions: number;
  restsPerDepth: number;
  /** Times per depth a killing blow leaves you at 1 HP instead. */
  defyDeath: number;
  /** Multiplies monster hit points. */
  monsterHp: number;
  /** Added to every monster attack roll. */
  monsterToHit: number;
  /** Multiplies how many monsters each depth holds, and how big a group can be. */
  monsterBudget: number;
  groupSize: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  story: {
    id: "story", name: "Story",
    blurb: "For the tale, not the tactics. A tougher hero, gentler foes and more second chances.",
    heroHp: 10, heroHpPerLevel: 2, potions: 5, restsPerDepth: 3, defyDeath: 2,
    monsterHp: 0.8, monsterToHit: -1, monsterBudget: 0.85, groupSize: 0.85,
  },
  normal: {
    id: "normal", name: "Normal",
    blurb: "The intended descent. A careful player wins about half the time.",
    heroHp: 0, heroHpPerLevel: 0, potions: 3, restsPerDepth: 2, defyDeath: 1,
    monsterHp: 1, monsterToHit: 0, monsterBudget: 1, groupSize: 1,
  },
  hard: {
    id: "hard", name: "Hard",
    blurb: "For veterans. One rest per depth, no Defy Death, and more, tougher monsters.",
    heroHp: 0, heroHpPerLevel: 0, potions: 3, restsPerDepth: 1, defyDeath: 0,
    monsterHp: 1.1, monsterToHit: 0, monsterBudget: 1.1, groupSize: 1.1,
  },
};
