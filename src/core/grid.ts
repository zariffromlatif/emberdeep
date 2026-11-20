export interface Pt {
  x: number;
  y: number;
}

/** 5e grid distance: every step, straight or diagonal, is 5 feet. */
export const dist = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const euclid = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

export const DIRS8: readonly Pt[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export const DIRS4: readonly Pt[] = DIRS8.slice(0, 4);

/** Grid cells on the straight line between two cells (Bresenham), both ends included. */
export function line(a: Pt, b: Pt): Pt[] {
  const pts: Pt[] = [];
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}
