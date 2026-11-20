import { DynamicTexture, Texture, type Scene } from "@babylonjs/core";
import { Rng } from "../core/rng";

/** Tileable value noise with a few octaves. */
function makeNoise(seed: number, period: number) {
  const rng = new Rng(seed);
  const grid = new Float32Array(period * period).map(() => rng.next());
  const at = (x: number, y: number) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  /** u, v in [0,1); returns roughly [0,1]. */
  return (u: number, v: number, octaves = 4): number => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(u * period * freq, v * period * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

/** Turns a height field into a tangent-space normal map. */
function normalsFromHeight(h: Float32Array, size: number, strength: number): ImageData {
  const img = new ImageData(size, size);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function toTexture(scene: Scene, name: string, size: number, img: ImageData, wrap = true): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  (t.getContext() as CanvasRenderingContext2D).putImageData(img, 0, 0);
  t.update(false);
  if (wrap) {
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
  }
  t.anisotropicFilteringLevel = 8;
  return t;
}

export interface Surface {
  diffuse: DynamicTexture;
  normal: DynamicTexture;
}

/**
 * Flagstones aligned to the tactical grid: the texture covers 4x4 tiles, one stone per tile
 * (some split in two), so the grid reads at a glance without drawing lines.
 */
export function flagstones(scene: Scene, size = 1024, seed = 11): Surface {
  const rng = new Rng(seed);
  const noise = makeNoise(seed, 16);
  const fine = makeNoise(seed + 1, 64);
  const tiles = 4;
  const cell = size / tiles;
  type Stone = { split: number; tint: number[]; height: number[] };
  const stones: Stone[] = [];
  for (let i = 0; i < tiles * tiles; i++) {
    const split = rng.chance(0.3) ? (rng.chance(0.5) ? 1 : 2) : 0; // 1 = vertical seam, 2 = horizontal
    stones.push({
      split,
      tint: [0, 1].map(() => 0.86 + rng.next() * 0.22),
      height: [0, 1].map(() => 0.75 + rng.next() * 0.25),
    });
  }
  const height = new Float32Array(size * size);
  const img = new ImageData(size, size);
  const grout = cell * 0.028;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const s = stones[cy * tiles + cx];
      let lx = x - cx * cell, ly = y - cy * cell;
      let w = cell, hgt = cell, part = 0;
      if (s.split === 1) { if (lx >= cell / 2) { lx -= cell / 2; part = 1; } w = cell / 2; }
      if (s.split === 2) { if (ly >= cell / 2) { ly -= cell / 2; part = 1; } hgt = cell / 2; }
      const u = x / size, v = y / size;
      // Wobbly edges so the stones look hand-cut.
      const wob = (noise(u * 2, v * 2, 3) - 0.5) * grout * 2.2;
      const edge = Math.min(lx, ly, w - lx, hgt - ly) + wob;
      const bevel = Math.max(0, Math.min(1, (edge - grout) / (grout * 1.6)));
      const n = noise(u, v, 5);
      const f = fine(u, v, 3);
      const stoneH = s.height[part] * (0.82 + 0.18 * n) + f * 0.06;
      const hv = bevel > 0 ? stoneH * (0.35 + 0.65 * Math.sqrt(bevel)) : 0.05 + f * 0.05;
      height[y * size + x] = hv;
      const tint = s.tint[part];
      const base = bevel > 0 ? (0.62 + 0.38 * n) * tint * (0.9 + 0.1 * f) : 0.3 + 0.12 * f;
      const ao = bevel > 0 ? 0.86 + 0.14 * bevel : 1;
      const lum = base * ao;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, lum * 238);
      img.data[i + 1] = Math.min(255, lum * 228);
      img.data[i + 2] = Math.min(255, lum * 214);
      img.data[i + 3] = 255;
    }
  }
  const diffuse = toTexture(scene, "floorDiffuse", size, img);
  // Hairline cracks and scuffs.
  const ctx = diffuse.getContext() as CanvasRenderingContext2D;
  ctx.strokeStyle = "rgba(20,16,12,0.55)";
  for (let k = 0; k < 26; k++) {
    ctx.lineWidth = 0.8 + rng.next() * 1.4;
    let x = rng.next() * size, y = rng.next() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rng.next() - 0.5) * 40;
      y += (rng.next() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  diffuse.update(false);
  const normal = toTexture(scene, "floorNormal", size, normalsFromHeight(height, size, 6));
  return { diffuse, normal };
}

/** Rough-cut stone blocks for walls. Covers 2 units wide by 2 tall. */
export function brickwork(scene: Scene, size = 1024, seed = 23): Surface {
  const rng = new Rng(seed);
  const noise = makeNoise(seed, 16);
  const fine = makeNoise(seed + 5, 64);
  const rows = 7;
  const rowH = size / rows;
  const perRow = 3;
  const tints: number[] = [];
  for (let i = 0; i < rows * (perRow + 1); i++) tints.push(0.8 + rng.next() * 0.3);
  const offsets: number[] = [];
  for (let r = 0; r < rows; r++) offsets.push(rng.next() * (size / perRow));
  const height = new Float32Array(size * size);
  const img = new ImageData(size, size);
  const grout = rowH * 0.07;
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rowH);
    const ly = y - r * rowH;
    for (let x = 0; x < size; x++) {
      const bw = size / perRow;
      const sx = (x + offsets[r]) % size;
      const b = Math.floor(sx / bw);
      const lx = sx - b * bw;
      const u = x / size, v = y / size;
      const wob = (noise(u * 2, v * 2, 3) - 0.5) * grout * 2.5;
      const edge = Math.min(lx, ly, bw - lx, rowH - ly) + wob;
      const bevel = Math.max(0, Math.min(1, (edge - grout) / (grout * 2)));
      const n = noise(u, v, 5);
      const f = fine(u, v, 3);
      const tint = tints[r * (perRow + 1) + b];
      const hv = bevel > 0 ? (0.6 + 0.4 * n) * (0.4 + 0.6 * Math.sqrt(bevel)) + f * 0.08 : 0.04;
      height[y * size + x] = hv;
      const lum = bevel > 0 ? (0.55 + 0.45 * n) * tint * (0.88 + 0.12 * f) * (0.8 + 0.2 * bevel) : 0.14 + 0.08 * f;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, lum * 236);
      img.data[i + 1] = Math.min(255, lum * 226);
      img.data[i + 2] = Math.min(255, lum * 212);
      img.data[i + 3] = 255;
    }
  }
  const diffuse = toTexture(scene, "wallDiffuse", size, img);
  const normal = toTexture(scene, "wallNormal", size, normalsFromHeight(height, size, 5));
  return { diffuse, normal };
}

/** Vertical planks with grain, for doors, crates and chests. */
export function planks(scene: Scene, size = 256, seed = 31): DynamicTexture {
  const rng = new Rng(seed);
  const grain = makeNoise(seed, 8);
  const img = new ImageData(size, size);
  const boards = 4;
  const tints = Array.from({ length: boards }, () => 0.8 + rng.next() * 0.3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const b = Math.floor((x / size) * boards);
      const lx = (x / size) * boards - b;
      const seam = lx < 0.04 || lx > 0.96 ? 0.45 : 1;
      const g = grain(x / size * 0.25 + b * 0.37, y / size * 2.5, 4);
      const lum = (0.5 + 0.5 * g) * tints[b] * seam;
      const i = (y * size + x) * 4;
      img.data[i] = lum * 150;
      img.data[i + 1] = lum * 98;
      img.data[i + 2] = lum * 60;
      img.data[i + 3] = 255;
    }
  }
  return toTexture(scene, "planks", size, img);
}

/** Soft round blob for particles and glows. */
export function softDot(scene: Scene, size = 64): DynamicTexture {
  const t = new DynamicTexture("softDot", { width: size, height: size }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.75)");
  g.addColorStop(0.6, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  t.update(false);
  t.hasAlpha = true;
  return t;
}

/** A soft ring, used for selection circles and target markers on the floor. */
export function ringTexture(scene: Scene, size = 128): DynamicTexture {
  const t = new DynamicTexture("ring", { width: size, height: size }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.55, "rgba(255,255,255,0.9)");
  g.addColorStop(0.7, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Four small notches, like a compass, so it reads as a game marker.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((k * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -c * 0.98);
    ctx.lineTo(c * 0.07, -c * 0.8);
    ctx.lineTo(-c * 0.07, -c * 0.8);
    ctx.fill();
    ctx.restore();
  }
  t.update(false);
  t.hasAlpha = true;
  return t;
}

/** Rounded square outline for the tile cursor. */
export function tileFrame(scene: Scene, size = 128): DynamicTexture {
  const t = new DynamicTexture("tileFrame", { width: size, height: size }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const pad = size * 0.08, r = size * 0.14, w = size - pad * 2;
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.roundRect(pad, pad, w, w, r);
  ctx.stroke();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.6);
  g.addColorStop(0, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0.05)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(pad, pad, w, w, r);
  ctx.fill();
  t.update(false);
  t.hasAlpha = true;
  return t;
}

/** Woven rug with a border pattern. */
export function rugTexture(scene: Scene, base: string, trim: string, size = 256): DynamicTexture {
  const t = new DynamicTexture(`rug${base}`, { width: size, height: size * 2 }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const H = size * 2;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, H);
  ctx.strokeStyle = trim;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, size - 28, H - 28);
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, size - 60, H - 60);
  ctx.fillStyle = trim;
  for (let k = 0; k < 5; k++) {
    const cy = H * (0.2 + k * 0.15);
    ctx.beginPath();
    ctx.moveTo(size / 2, cy - 22);
    ctx.lineTo(size / 2 + 26, cy);
    ctx.lineTo(size / 2, cy + 22);
    ctx.lineTo(size / 2 - 26, cy);
    ctx.closePath();
    ctx.fill();
  }
  // Wear: darker blotches.
  const rng = new Rng(7);
  for (let k = 0; k < 60; k++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rng.next() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * H, 4 + rng.next() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  t.update(false);
  return t;
}

/** Cobweb drawn in a corner. */
export function webTexture(scene: Scene, size = 256): DynamicTexture {
  const t = new DynamicTexture("web", { width: size, height: size }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(230,230,240,0.55)";
  ctx.lineWidth = 1.4;
  const spokes = 7;
  for (let s = 0; s <= spokes; s++) {
    const a = (s / spokes) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
    ctx.stroke();
  }
  for (let r = 30; r < size; r += 26) {
    ctx.beginPath();
    for (let s = 0; s <= spokes; s++) {
      const a = (s / spokes) * (Math.PI / 2);
      const rr = r * (0.92 + 0.08 * Math.sin(s * 2.1 + r));
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (s === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(Math.cos(a - 0.1) * rr * 0.92, Math.sin(a - 0.1) * rr * 0.92, x, y);
    }
    ctx.stroke();
  }
  t.update(false);
  t.hasAlpha = true;
  return t;
}
