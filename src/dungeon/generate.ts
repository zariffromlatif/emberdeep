import { Rng } from "../core/rng";
import { DIRS4, DIRS8, type Pt } from "../core/grid";
import { DEPTH_BUDGET, DEPTH_TABLES, MONSTERS } from "../rules/monsters";
import { THEMES } from "./themes";
import { T, idx, inBounds, type DungeonMap, type Prop, type PropKind, type Room, type Spawn } from "./map";

export const FINAL_DEPTH = 5;

/** Builds one dungeon level. The same depth and seed always give the same level. */
/** `budget` and `groupSize` scale the monsters (difficulty); 1 is the tuned Normal. */
export function generate(depth: number, seed: number, budget = 1, groupSize = 1): DungeonMap {
  const rng = new Rng((seed ^ Math.imul(depth, 0x9e3779b1)) >>> 0);
  const W = 40 + depth * 3;
  const H = 40 + depth * 3;
  const m: DungeonMap = {
    depth,
    w: W,
    h: H,
    tiles: new Uint8Array(W * H),
    roomOf: new Int16Array(W * H).fill(-1),
    solid: new Uint8Array(W * H),
    rooms: [],
    props: [],
    spawns: [],
    start: { x: 0, y: 0 },
    stairs: null,
    theme: THEMES[Math.min(depth, THEMES.length) - 1],
  };

  placeRooms(m, rng);
  connectRooms(m, rng);
  assignRoomKinds(m, rng);
  placeDoors(m, rng);
  decorate(m, rng);
  populate(m, rng, budget, groupSize);
  return m;
}

// ---------------------------------------------------------------- rooms

function placeRooms(m: DungeonMap, rng: Rng): void {
  const target = Math.min(7 + m.depth, 12);
  const tryAdd = (w: number, h: number): boolean => {
    const x = rng.int(2, m.w - w - 3);
    const y = rng.int(2, m.h - h - 3);
    for (const r of m.rooms) {
      if (x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y) return false;
    }
    m.rooms.push({ id: m.rooms.length, x, y, w, h, kind: "normal" });
    return true;
  };
  if (m.depth === FINAL_DEPTH) {
    for (let i = 0; i < 200 && !tryAdd(13, 11); i++);
  }
  for (let i = 0; i < 600 && m.rooms.length < target; i++) tryAdd(rng.int(5, 10), rng.int(5, 8));

  for (const r of m.rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        m.tiles[idx(m, x, y)] = T.Floor;
        m.roomOf[idx(m, x, y)] = r.id;
      }
    }
  }
}

const center = (r: Room): Pt => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

function connectRooms(m: DungeonMap, rng: Rng): void {
  const n = m.rooms.length;
  const d = (a: number, b: number) => {
    const ca = center(m.rooms[a]), cb = center(m.rooms[b]);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
  };
  // Prim's minimum spanning tree: every room reachable, corridors kept short.
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < n) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of inTree) {
      for (let b = 0; b < n; b++) {
        if (inTree.has(b)) continue;
        const dd = d(a, b);
        if (dd < bestD) { bestD = dd; best = [a, b]; }
      }
    }
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  // A couple of extra links make loops, so the player can circle around a fight.
  const extra = 1 + Math.floor(n / 5);
  for (let i = 0; i < extra * 6 && edges.length < n - 1 + extra; i++) {
    const a = rng.int(0, n - 1);
    const b = rng.int(0, n - 1);
    if (a === b || d(a, b) > 22) continue;
    if (edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) continue;
    edges.push([a, b]);
  }
  for (const [a, b] of edges) carveCorridor(m, center(m.rooms[a]), center(m.rooms[b]), rng);
}

function carveCorridor(m: DungeonMap, a: Pt, b: Pt, rng: Rng): void {
  const dig = (x: number, y: number) => {
    if (inBounds(m, x, y) && m.tiles[idx(m, x, y)] === T.Wall) m.tiles[idx(m, x, y)] = T.Floor;
  };
  const h = (x0: number, x1: number, y: number) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) dig(x, y); };
  const v = (y0: number, y1: number, x: number) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) dig(x, y); };
  if (rng.chance(0.5)) { h(a.x, b.x, a.y); v(a.y, b.y, b.x); } else { v(a.y, b.y, a.x); h(a.x, b.x, b.y); }
}

function floodDistances(m: DungeonMap, from: Pt): Int32Array {
  const dist = new Int32Array(m.w * m.h).fill(-1);
  const q: number[] = [idx(m, from.x, from.y)];
  dist[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % m.w, y = (i / m.w) | 0;
    for (const dd of DIRS4) {
      const nx = x + dd.x, ny = y + dd.y;
      if (!inBounds(m, nx, ny)) continue;
      const ni = idx(m, nx, ny);
      const t = m.tiles[ni];
      if (dist[ni] >= 0 || t === T.Wall || t === T.Pillar || m.solid[ni]) continue;
      dist[ni] = dist[i] + 1;
      q.push(ni);
    }
  }
  return dist;
}

function assignRoomKinds(m: DungeonMap, rng: Rng): void {
  const boss = m.depth === FINAL_DEPTH ? m.rooms[0] : null;
  let start: Room;
  if (boss) {
    const dist = floodDistances(m, center(boss));
    start = m.rooms.slice(1).reduce((a, b) => (dist[idx(m, center(b).x, center(b).y)] > dist[idx(m, center(a).x, center(a).y)] ? b : a));
  } else {
    start = rng.pick(m.rooms);
  }
  start.kind = "start";
  m.start = center(start);

  if (boss) {
    boss.kind = "boss";
    return;
  }
  const dist = floodDistances(m, m.start);
  const far = m.rooms.reduce((a, b) => (dist[idx(m, center(b).x, center(b).y)] > dist[idx(m, center(a).x, center(a).y)] ? b : a));
  far.kind = "stairs";
  m.stairs = center(far);
  m.tiles[idx(m, m.stairs.x, m.stairs.y)] = T.Stairs;
}

function placeDoors(m: DungeonMap, rng: Rng): void {
  const isWall = (x: number, y: number) => !inBounds(m, x, y) || m.tiles[idx(m, x, y)] === T.Wall;
  const isDoor = (x: number, y: number) => inBounds(m, x, y) && m.tiles[idx(m, x, y)] === T.Door;
  for (const r of m.rooms) {
    const ring: [number, number, boolean][] = [];
    for (let x = r.x; x < r.x + r.w; x++) { ring.push([x, r.y - 1, true], [x, r.y + r.h, true]); }
    for (let y = r.y; y < r.y + r.h; y++) { ring.push([r.x - 1, y, false], [r.x + r.w, y, false]); }
    for (const [x, y, horizontalEdge] of ring) {
      const i = idx(m, x, y);
      if (m.tiles[i] !== T.Floor || m.roomOf[i] !== -1) continue;
      const framed = horizontalEdge ? isWall(x - 1, y) && isWall(x + 1, y) : isWall(x, y - 1) && isWall(x, y + 1);
      if (!framed) continue;
      if (DIRS8.some((d) => isDoor(x + d.x, y + d.y))) continue;
      if (rng.chance(r.kind === "boss" ? 1 : 0.55)) m.tiles[i] = T.Door;
    }
  }
}

// ---------------------------------------------------------------- props

function decorate(m: DungeonMap, rng: Rng): void {
  const floorCount = () => {
    let n = 0;
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      if (t !== T.Wall && t !== T.Pillar && !m.solid[i]) n++;
    }
    return n;
  };
  const reachableCount = () => {
    const dist = floodDistances(m, m.start);
    let n = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) n++;
    return n;
  };
  /** Places something that blocks movement only if every floor tile stays reachable. */
  const placeBlocking = (_x: number, _y: number, apply: () => void, undo: () => void): boolean => {
    apply();
    if (reachableCount() === floorCount()) return true;
    undo();
    return false;
  };
  const occupied = new Set<number>();
  const free = (x: number, y: number) => {
    const i = idx(m, x, y);
    return m.tiles[i] === T.Floor && !occupied.has(i) && !(x === m.start.x && y === m.start.y);
  };
  const addProp = (kind: PropKind, x: number, y: number, dir: number, blocks: boolean): boolean => {
    const i = idx(m, x, y);
    if (blocks) {
      if (!free(x, y)) return false;
      const ok = placeBlocking(x, y, () => { m.solid[i] = 1; }, () => { m.solid[i] = 0; });
      if (!ok) return false;
    }
    if (kind !== "torch" && kind !== "banner" && kind !== "cobweb") occupied.add(i);
    m.props.push({ kind, x, y, dir, blocks, seed: rng.int(0, 999999) });
    return true;
  };
  /** True when a floor tile touches a corridor or doorway (keep those clear). */
  const nearOpening = (x: number, y: number, room: Room) =>
    DIRS8.some((d) => {
      const nx = x + d.x, ny = y + d.y;
      if (!inBounds(m, nx, ny)) return false;
      const i = idx(m, nx, ny);
      return m.tiles[i] !== T.Wall && m.roomOf[i] !== room.id;
    });

  for (const r of m.rooms) {
    const big = r.w >= 8 && r.h >= 7;

    // Pillars: a colonnade in large rooms, a grand hall for the boss.
    if (r.kind === "boss") {
      for (let y = r.y + 2; y < r.y + r.h - 1; y += 3) {
        for (const x of [r.x + 2, r.x + r.w - 3]) {
          const i = idx(m, x, y);
          placeBlocking(x, y, () => { m.tiles[i] = T.Pillar; }, () => { m.tiles[i] = T.Floor; });
        }
      }
    } else if (big && r.kind !== "start" && rng.chance(0.55)) {
      for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
        if (nearOpening(x, y, r)) continue;
        const i = idx(m, x, y);
        placeBlocking(x, y, () => { m.tiles[i] = T.Pillar; }, () => { m.tiles[i] = T.Floor; });
      }
    }

    // Wall-mounted torches and banners, spaced out along the walls.
    const wallSpots: { x: number; y: number; dir: number }[] = [];
    for (let x = r.x; x < r.x + r.w; x++) {
      if (m.tiles[idx(m, x, r.y - 1)] === T.Wall) wallSpots.push({ x, y: r.y - 1, dir: 0 });
      if (m.tiles[idx(m, x, r.y + r.h)] === T.Wall) wallSpots.push({ x, y: r.y + r.h, dir: 2 });
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      if (m.tiles[idx(m, r.x - 1, y)] === T.Wall) wallSpots.push({ x: r.x - 1, y, dir: 3 });
      if (m.tiles[idx(m, r.x + r.w, y)] === T.Wall) wallSpots.push({ x: r.x + r.w, y, dir: 1 });
    }
    rng.shuffle(wallSpots);
    const torchCount = 2 + (r.w * r.h > 50 ? 1 : 0) + (rng.chance(0.4) ? 1 : 0);
    const used: { x: number; y: number }[] = [];
    const spaced = (s: { x: number; y: number }, gap: number) => used.every((u) => Math.abs(u.x - s.x) + Math.abs(u.y - s.y) >= gap);
    for (const s of wallSpots) {
      if (used.length >= torchCount) break;
      if (spaced(s, 4)) { used.push(s); addProp("torch", s.x, s.y, s.dir, false); }
    }
    let banners = rng.int(0, 2);
    for (const s of wallSpots) {
      if (banners <= 0) break;
      if (spaced(s, 2)) { used.push(s); addProp("banner", s.x, s.y, s.dir, false); banners--; }
    }

    // Edge tiles: inside the room, touching a wall, away from doorways.
    const edges: Pt[] = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const onEdge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
        if (onEdge && free(x, y) && !nearOpening(x, y, r)) edges.push({ x, y });
      }
    }
    rng.shuffle(edges);
    const wallDirOf = (p: Pt): number => (p.y === r.y ? 0 : p.y === r.y + r.h - 1 ? 2 : p.x === r.x ? 3 : 1);

    if (r.kind === "boss") {
      addProp("throne", center(r).x, r.y + 1, 0, true);
      for (const [x, y] of [[r.x + 4, r.y + 2], [r.x + r.w - 5, r.y + 2], [r.x + 4, r.y + r.h - 3], [r.x + r.w - 5, r.y + r.h - 3]]) {
        addProp("brazier", x, y, 0, true);
      }
      addProp("rug", center(r).x, center(r).y, 0, false);
      continue;
    }

    // Chests: the reason to explore.
    if (r.kind !== "start" && rng.chance(r.kind === "stairs" ? 0.5 : 0.45)) {
      const spot = edges.find((p) => free(p.x, p.y));
      if (spot) addProp("chest", spot.x, spot.y, wallDirOf(spot), true);
    }
    // Barrels and crates in clusters.
    const clutter = rng.int(0, big ? 4 : 2);
    for (let k = 0, placed = 0; k < edges.length && placed < clutter; k++) {
      const p = edges[k];
      if (!free(p.x, p.y)) continue;
      if (addProp(rng.chance(0.55) ? "barrel" : "crate", p.x, p.y, wallDirOf(p), true)) placed++;
    }
    if (big && r.kind !== "stairs" && rng.chance(0.35)) {
      const c = center(r);
      if (free(c.x, c.y)) addProp(rng.chance(0.5) ? "brazier" : "statue", c.x, c.y, rng.int(0, 3), true);
    }
    if (rng.chance(0.3)) addProp("rug", center(r).x, center(r).y, r.w >= r.h ? 1 : 0, false);

    // Corner cobwebs and floor litter: no gameplay, all mood.
    for (const [x, y, dir] of [[r.x, r.y, 0], [r.x + r.w - 1, r.y, 1], [r.x + r.w - 1, r.y + r.h - 1, 2], [r.x, r.y + r.h - 1, 3]]) {
      if (rng.chance(0.35)) m.props.push({ kind: "cobweb", x, y, dir, blocks: false, seed: rng.int(0, 999999) });
    }
    const litter = rng.int(1, 4);
    for (let k = 0; k < litter; k++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (!free(x, y)) continue;
      const kind = rng.weighted<PropKind>([["bones", 3], ["rubble", 3], ["skull", 2], ["candles", m.depth >= 2 ? 2 : 1]]);
      addProp(kind, x, y, rng.int(0, 3), false);
    }
  }

  // A few torches in long corridors so the way between rooms isn't pitch black.
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 1; x < m.w - 1; x++) {
      const i = idx(m, x, y);
      if (m.tiles[i] !== T.Floor || m.roomOf[i] !== -1 || !rng.chance(0.03)) continue;
      const d = DIRS4.findIndex((dd) => m.tiles[idx(m, x + dd.x, y + dd.y)] === T.Wall);
      if (d < 0) continue;
      const dd = DIRS4[d];
      // dir numbering: 0 = faces +y (wall above), 1 = faces -x, 2 = faces -y, 3 = faces +x
      const dir = dd.y === -1 ? 0 : dd.x === 1 ? 1 : dd.y === 1 ? 2 : 3;
      if (m.props.some((p) => p.kind === "torch" && Math.abs(p.x - x) + Math.abs(p.y - y) < 6)) continue;
      m.props.push({ kind: "torch", x: x + dd.x, y: y + dd.y, dir, blocks: false, seed: rng.int(0, 999999) });
    }
  }
}

// ---------------------------------------------------------------- monsters

function populate(m: DungeonMap, rng: Rng, budgetMult: number, groupMult: number): void {
  const taken = new Set<number>();
  const freeTiles = (r: Room): Pt[] => {
    const out: Pt[] = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = idx(m, x, y);
        if (m.tiles[i] === T.Floor && !m.solid[i] && !taken.has(i)) out.push({ x, y });
      }
    }
    return out;
  };
  const put = (monster: string, r: Room, prefer?: Pt): boolean => {
    const tiles = freeTiles(r);
    if (!tiles.length) return false;
    let p: Pt;
    if (prefer) {
      tiles.sort((a, b) => Math.hypot(a.x - prefer.x, a.y - prefer.y) - Math.hypot(b.x - prefer.x, b.y - prefer.y));
      p = tiles[Math.min(tiles.length - 1, rng.int(0, 2))];
    } else {
      p = rng.pick(tiles);
    }
    taken.add(idx(m, p.x, p.y));
    m.spawns.push({ monster, pos: p, group: r.id });
    return true;
  };

  const rooms = rng.shuffle(m.rooms.filter((r) => r.kind !== "start" && r.kind !== "boss"));
  const startRoom = m.rooms.find((r) => r.kind === "start")!;
  // Rooms right next to the start get lighter groups.
  rooms.sort((a, b) => {
    const da = Math.hypot(center(a).x - m.start.x, center(a).y - m.start.y);
    const db = Math.hypot(center(b).x - m.start.x, center(b).y - m.start.y);
    return db - da;
  });

  let budget = (DEPTH_BUDGET[m.depth] ?? 600) * budgetMult;
  const table = DEPTH_TABLES[m.depth] ?? DEPTH_TABLES[1];
  const cap = (GROUP_CAP[m.depth] ?? 750) * groupMult;
  const filled = new Set<number>();
  // The depth-4 Ogre guards the stairs alone: it is a full encounter by itself.
  if (m.depth === 4) {
    const stairsRoom = m.rooms.find((r) => r.kind === "stairs");
    if (stairsRoom) filled.add(stairsRoom.id);
  }
  for (let pass = 0; pass < 3 && budget > 0; pass++) {
    for (const r of rooms) {
      if (budget <= 0) break;
      if (filled.has(r.id) || (pass === 0 && rng.chance(0.15))) continue;
      const near = Math.hypot(center(r).x - m.start.x, center(r).y - m.start.y) < 14;
      const group = buildGroup(rng, table, near ? cap * 0.7 : cap);
      if (!group.length) continue;
      filled.add(r.id);
      for (const id of group) {
        const def = MONSTERS[id];
        // Archers keep to the far side of the room, away from the way in.
        const prefer = def.attacks[0].ranged ? farCorner(r, center(startRoom)) : undefined;
        if (put(id, r, prefer)) budget -= def.xp;
      }
    }
  }

  if (m.depth === 4) {
    const stairsRoom = m.rooms.find((r) => r.kind === "stairs")!;
    put("ogre", stairsRoom, m.stairs ?? undefined);
  }
  if (m.depth === FINAL_DEPTH) {
    const boss = m.rooms.find((r) => r.kind === "boss")!;
    put("wight", boss, { x: center(boss).x, y: boss.y + 2 });
    put("skeleton", boss, { x: center(boss).x - 2, y: boss.y + 3 });
  }
}

/** 5e encounter maths: bigger groups are deadlier than their XP alone suggests. */
export function adjustedXp(ids: string[]): number {
  const raw = ids.reduce((s, id) => s + MONSTERS[id].xp, 0);
  const mult = ids.length <= 1 ? 1 : ids.length === 2 ? 1.5 : ids.length <= 6 ? 2 : 2.5;
  return raw * mult;
}

/** Adjusted-XP ceiling per group: about "hard" for a lone hero of the expected level. */
const GROUP_CAP = [0, 100, 200, 340, 520, 760];

function buildGroup(rng: Rng, table: [string, number][], cap: number): string[] {
  const affordable = table.filter(([id]) => MONSTERS[id].xp <= cap);
  if (!affordable.length) return [];
  const group = [rng.weighted(affordable)];
  for (let tries = 0; tries < 6 && group.length < 4; tries++) {
    // Rats run in packs; otherwise mix in an ally no stronger than the leader.
    const next = group[0] === "rat" && rng.chance(0.7)
      ? "rat"
      : rng.weighted(affordable.filter(([id]) => MONSTERS[id].xp <= MONSTERS[group[0]].xp));
    if (adjustedXp([...group, next]) <= cap) group.push(next);
  }
  return group;
}

function farCorner(r: Room, from: Pt): Pt {
  const corners = [
    { x: r.x, y: r.y }, { x: r.x + r.w - 1, y: r.y },
    { x: r.x, y: r.y + r.h - 1 }, { x: r.x + r.w - 1, y: r.y + r.h - 1 },
  ];
  return corners.reduce((a, b) => (Math.hypot(b.x - from.x, b.y - from.y) > Math.hypot(a.x - from.x, a.y - from.y) ? b : a));
}

export type { Spawn, Prop };
