import type { Rng } from "./rng";

export interface DiceExpr {
  count: number;
  sides: number;
  bonus: number;
}

export interface DiceResult {
  expr: string;
  rolls: number[];
  bonus: number;
  total: number;
}

/** Parses "2d6+3", "1d8", "d20-1", "4". */
export function parseDice(text: string): DiceExpr {
  const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(text);
  if (!m) {
    const flat = Number(text);
    if (!Number.isFinite(flat)) throw new Error(`Bad dice expression: ${text}`);
    return { count: 0, sides: 0, bonus: flat };
  }
  return {
    count: m[1] ? Number(m[1]) : 1,
    sides: Number(m[2]),
    bonus: m[3] ? Number(m[3].replace(/\s/g, "")) : 0,
  };
}

export function formatDice(d: DiceExpr): string {
  const base = d.count > 0 ? `${d.count}d${d.sides}` : "";
  if (!d.bonus) return base || "0";
  if (!base) return String(d.bonus);
  return `${base}${d.bonus > 0 ? "+" : "-"}${Math.abs(d.bonus)}`;
}

/** Rolls dice. `extraDice` adds more dice of the same size (critical hits double the dice). */
export function roll(rng: Rng, text: string | DiceExpr, extraBonus = 0, diceMultiplier = 1): DiceResult {
  const d = typeof text === "string" ? parseDice(text) : text;
  const rolls: number[] = [];
  for (let i = 0; i < d.count * diceMultiplier; i++) rolls.push(rng.int(1, d.sides));
  const bonus = d.bonus + extraBonus;
  const total = Math.max(0, rolls.reduce((s, r) => s + r, 0) + bonus);
  return { expr: formatDice({ ...d, bonus }), rolls, bonus, total };
}

export function average(text: string): number {
  const d = parseDice(text);
  return d.count * (d.sides + 1) / 2 + d.bonus;
}

export interface D20Result {
  /** The die that counts. */
  natural: number;
  /** Both dice when rolled with advantage or disadvantage. */
  dice: number[];
  /** +1 advantage, -1 disadvantage, 0 straight. */
  mode: number;
}

export function rollD20(rng: Rng, advantage: number, disadvantage: number): D20Result {
  const mode = Math.sign((advantage > 0 ? 1 : 0) - (disadvantage > 0 ? 1 : 0));
  const a = rng.int(1, 20);
  if (mode === 0) return { natural: a, dice: [a], mode };
  const b = rng.int(1, 20);
  return { natural: mode > 0 ? Math.max(a, b) : Math.min(a, b), dice: [a, b], mode };
}

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
