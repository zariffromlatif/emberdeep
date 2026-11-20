import { line, type Pt } from "../core/grid";
import { blocksSight, idx, inBounds, type DungeonMap } from "./map";

const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

/** Recursive shadowcasting. Returns the tile indices the origin can see within the radius. */
export function computeFov(m: DungeonMap, origin: Pt, radius: number): Set<number> {
  const seen = new Set<number>();
  seen.add(idx(m, origin.x, origin.y));
  const r2 = radius * radius;

  const cast = (row: number, start: number, end: number, xx: number, xy: number, yx: number, yy: number): void => {
    if (start < end) return;
    let newStart = 0;
    for (let j = row; j <= radius; j++) {
      let dx = -j - 1;
      const dy = -j;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const X = origin.x + dx * xx + dy * xy;
        const Y = origin.y + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;
        if (dx * dx + dy * dy < r2 && inBounds(m, X, Y)) seen.add(idx(m, X, Y));
        const solid = blocksSight(m, X, Y);
        if (blocked) {
          if (solid) { newStart = rSlope; continue; }
          blocked = false;
          start = newStart;
        } else if (solid && j < radius) {
          blocked = true;
          cast(j + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  };

  for (let o = 0; o < 8; o++) cast(1, 1, 0, MULT[0][o], MULT[1][o], MULT[2][o], MULT[3][o]);
  return seen;
}

/** Clear line between two tiles (either direction counts, so it is symmetric). */
export function hasLos(m: DungeonMap, a: Pt, b: Pt): boolean {
  const clear = (p: Pt[]) => p.slice(1, -1).every((c) => !blocksSight(m, c.x, c.y));
  return clear(line(a, b)) || clear(line(b, a));
}
