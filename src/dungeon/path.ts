import { DIRS8, type Pt } from "../core/grid";
import { blocksMove, idx, inBounds, type DungeonMap } from "./map";

/** Extra rule on top of the map: e.g. tiles held by other creatures. */
export type Blocker = (x: number, y: number) => boolean;

/** Diagonal steps may not squeeze between two solid corners. */
function canStep(m: DungeonMap, x: number, y: number, dx: number, dy: number, blocked: Blocker): boolean {
  const nx = x + dx, ny = y + dy;
  if (!inBounds(m, nx, ny) || blocksMove(m, nx, ny) || blocked(nx, ny)) return false;
  if (dx !== 0 && dy !== 0) {
    if (blocksMove(m, x + dx, y) || blocksMove(m, x, y + dy)) return false;
  }
  return true;
}

class MinHeap {
  private items: { k: number; v: number }[] = [];
  get size() { return this.items.length; }
  push(v: number, k: number) {
    const a = this.items;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].k < a[s].k) s = l;
        if (r < a.length && a[r].k < a[s].k) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

/**
 * Shortest path (every step costs 5 ft, diagonals too). Straight steps are very
 * slightly cheaper so paths look natural. Returns the steps after `from`, or null.
 * With `adjacentOk`, stopping next to the goal is enough (walking up to a foe or a chest).
 */
export function findPath(m: DungeonMap, from: Pt, to: Pt, blocked: Blocker = () => false, adjacentOk = false, limit = 4000): Pt[] | null {
  const goalI = idx(m, to.x, to.y);
  const done = (x: number, y: number) =>
    adjacentOk ? Math.max(Math.abs(x - to.x), Math.abs(y - to.y)) <= 1 : x === to.x && y === to.y;
  if (done(from.x, from.y)) return [];
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const open = new MinHeap();
  const start = idx(m, from.x, from.y);
  g.set(start, 0);
  open.push(start, 0);
  let expanded = 0;
  while (open.size && expanded++ < limit) {
    const cur = open.pop();
    const cx = cur % m.w, cy = (cur / m.w) | 0;
    if (done(cx, cy)) {
      const path: Pt[] = [];
      let c = cur;
      while (c !== start) {
        path.push({ x: c % m.w, y: (c / m.w) | 0 });
        c = prev.get(c)!;
      }
      return path.reverse();
    }
    const gc = g.get(cur)!;
    for (const d of DIRS8) {
      const nx = cx + d.x, ny = cy + d.y;
      const ni = idx(m, nx, ny);
      const isGoal = ni === goalI;
      // The goal itself may be "blocked" (a creature) when we only need to reach its side.
      if (!canStep(m, cx, cy, d.x, d.y, isGoal && adjacentOk ? () => false : blocked)) continue;
      if (isGoal && adjacentOk) continue;
      const step = d.x !== 0 && d.y !== 0 ? 1.001 : 1;
      const ng = gc + step;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        prev.set(ni, cur);
        const h = Math.max(Math.abs(nx - to.x), Math.abs(ny - to.y));
        open.push(ni, ng + h);
      }
    }
  }
  return null;
}

/** Every tile reachable within `budget` steps, with the path back to `from`. */
export function reachable(m: DungeonMap, from: Pt, budget: number, blocked: Blocker = () => false): Map<number, { cost: number; prev: number }> {
  const out = new Map<number, { cost: number; prev: number }>();
  const start = idx(m, from.x, from.y);
  out.set(start, { cost: 0, prev: -1 });
  const open = new MinHeap();
  open.push(start, 0);
  while (open.size) {
    const cur = open.pop();
    const c = out.get(cur)!;
    if (c.cost >= budget) continue;
    const cx = cur % m.w, cy = (cur / m.w) | 0;
    for (const d of DIRS8) {
      if (!canStep(m, cx, cy, d.x, d.y, blocked)) continue;
      const ni = idx(m, cx + d.x, cy + d.y);
      const step = d.x !== 0 && d.y !== 0 ? 1.001 : 1;
      const nc = c.cost + step;
      if (nc > budget + 0.01) continue;
      const old = out.get(ni);
      if (!old || nc < old.cost) {
        out.set(ni, { cost: nc, prev: cur });
        open.push(ni, nc);
      }
    }
  }
  return out;
}

export function pathFromReach(m: DungeonMap, reach: Map<number, { cost: number; prev: number }>, to: Pt): Pt[] | null {
  let c = idx(m, to.x, to.y);
  if (!reach.has(c)) return null;
  const path: Pt[] = [];
  while (reach.get(c)!.prev !== -1) {
    path.push({ x: c % m.w, y: (c / m.w) | 0 });
    c = reach.get(c)!.prev;
  }
  return path.reverse();
}
