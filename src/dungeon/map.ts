import type { Pt } from "../core/grid";

export const T = {
  Wall: 0,
  Floor: 1,
  Door: 2,
  DoorOpen: 3,
  Stairs: 4,
  Pillar: 5,
} as const;
export type TileId = (typeof T)[keyof typeof T];

export type RoomKind = "start" | "normal" | "stairs" | "boss";

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RoomKind;
}

export type PropKind =
  | "torch" | "banner" | "barrel" | "crate" | "bones" | "rubble" | "skull" | "chest"
  | "brazier" | "cobweb" | "rug" | "statue" | "candles" | "throne";

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /** Facing for wall-mounted props: direction from the wall into the room. */
  dir: number;
  blocks: boolean;
  /** Chests only. */
  opened?: boolean;
  /** Small per-prop variation for the renderer. */
  seed: number;
}

export interface Spawn {
  monster: string;
  pos: Pt;
  group: number;
}

export interface Theme {
  name: string;
  subtitle: string;
  wall: string;
  floor: string;
  ambient: string;
  torch: string;
  fog: number;
  accent: string;
}

export interface DungeonMap {
  depth: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  roomOf: Int16Array;
  /** 1 where a prop blocks movement (barrels, chests, braziers). */
  solid: Uint8Array;
  rooms: Room[];
  props: Prop[];
  spawns: Spawn[];
  start: Pt;
  stairs: Pt | null;
  theme: Theme;
}

export const idx = (m: { w: number }, x: number, y: number): number => y * m.w + x;
export const inBounds = (m: { w: number; h: number }, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < m.w && y < m.h;

export function tileAt(m: DungeonMap, x: number, y: number): number {
  return inBounds(m, x, y) ? m.tiles[idx(m, x, y)] : T.Wall;
}

export function blocksSight(m: DungeonMap, x: number, y: number): boolean {
  const t = tileAt(m, x, y);
  return t === T.Wall || t === T.Door || t === T.Pillar;
}

/** Walls, pillars and solid props. Doors are walkable (they open). */
export function blocksMove(m: DungeonMap, x: number, y: number): boolean {
  const t = tileAt(m, x, y);
  if (t === T.Wall || t === T.Pillar) return true;
  return m.solid[idx(m, x, y)] === 1;
}

export const isFloorLike = (t: number): boolean =>
  t === T.Floor || t === T.Door || t === T.DoorOpen || t === T.Stairs;
