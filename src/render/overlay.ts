import { Color3, Mesh, MeshBuilder, StandardMaterial, VertexData, type Scene, type Texture } from "./babylon";
import type { Pt } from "../core/grid";

function flatMat(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.fogEnabled = false;
  m.disableDepthWrite = true;
  m.backFaceCulling = false;
  return m;
}

/** Tactical overlays on the floor: cursor, movement range, area previews, path dots. */
export class Overlay {
  private cursor: Mesh;
  private cursorMat: StandardMaterial;
  private regions = new Map<string, Mesh>();
  private mats = new Map<string, StandardMaterial>();
  private time = 0;
  /** Set by the app so overlay fills can opt out of the glow layer. */
  glowExclude: ((m: Mesh) => void) | null = null;

  constructor(readonly scene: Scene, frame: Texture) {
    this.cursorMat = flatMat(scene, "cursorMat");
    this.cursorMat.diffuseTexture = frame;
    this.cursorMat.opacityTexture = frame;
    this.cursor = MeshBuilder.CreateGround("cursor", { width: 1, height: 1 }, scene);
    this.cursor.material = this.cursorMat;
    this.cursor.isPickable = false;
    this.cursor.setEnabled(false);
  }

  setCursor(p: Pt | null, color = "#ffffff"): void {
    if (!p) { this.cursor.setEnabled(false); return; }
    this.cursor.setEnabled(true);
    this.cursor.position.set(p.x, 0.04, p.y);
    this.cursorMat.emissiveColor = Color3.FromHexString(color);
  }

  /** A filled region with a crisp border, e.g. where you can move this turn. */
  setRegion(key: string, tiles: Pt[] | null, color: string, fill = 0.13, edge = 0.85): void {
    for (const part of ["fill", "edge"]) {
      this.regions.get(`${key}-${part}`)?.dispose();
      this.regions.delete(`${key}-${part}`);
    }
    if (!tiles || !tiles.length) return;
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const fillQ: number[][] = [];
    const edgeQ: number[][] = [];
    const w = 0.05;
    for (const t of tiles) {
      fillQ.push([t.x - 0.5, t.y - 0.5, t.x + 0.5, t.y + 0.5]);
      if (!set.has(`${t.x},${t.y - 1}`)) edgeQ.push([t.x - 0.5, t.y - 0.5, t.x + 0.5, t.y - 0.5 + w]);
      if (!set.has(`${t.x},${t.y + 1}`)) edgeQ.push([t.x - 0.5, t.y + 0.5 - w, t.x + 0.5, t.y + 0.5]);
      if (!set.has(`${t.x - 1},${t.y}`)) edgeQ.push([t.x - 0.5, t.y - 0.5, t.x - 0.5 + w, t.y + 0.5]);
      if (!set.has(`${t.x + 1},${t.y}`)) edgeQ.push([t.x + 0.5 - w, t.y - 0.5, t.x + 0.5, t.y + 0.5]);
    }
    const c = Color3.FromHexString(color);
    const build = (part: string, quads: number[][], alpha: number, y: number) => {
      if (!quads.length) return;
      const pos: number[] = [], nrm: number[] = [], ind: number[] = [];
      for (const [x0, z0, x1, z1] of quads) {
        const v = pos.length / 3;
        pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
        nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        ind.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
      const mesh = new Mesh(`region-${key}-${part}`, this.scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.normals = nrm;
      vd.indices = ind;
      vd.applyToMesh(mesh);
      const mk = `${key}-${part}`;
      let mat = this.mats.get(mk);
      if (!mat) {
        mat = flatMat(this.scene, `regionMat-${mk}`);
        this.mats.set(mk, mat);
      }
      mat.emissiveColor = c;
      mat.alpha = alpha;
      mesh.material = mat;
      mesh.position.y = y;
      mesh.isPickable = false;
      // Only the crisp border gets bloom; the fill stays a quiet tint.
      if (part === "fill") this.glowExclude?.(mesh);
      this.regions.set(mk, mesh);
    };
    const base = key === "range" ? 0.015 : 0.025;
    build("fill", fillQ, fill, base);
    build("edge", edgeQ, edge, base + 0.004);
  }

  /** Glowing dots along the planned path. */
  setPath(points: Pt[] | null, color = "#ffe2a0"): void {
    this.regions.get("path")?.dispose();
    this.regions.delete("path");
    if (!points || !points.length) return;
    const parts: Mesh[] = points.map((p, i) => {
      const last = i === points.length - 1;
      const d = MeshBuilder.CreateDisc("dot", { radius: last ? 0.16 : 0.07, tessellation: 12 }, this.scene);
      d.rotation.x = Math.PI / 2;
      d.position.set(p.x, 0.035, p.y);
      return d;
    });
    const mesh = Mesh.MergeMeshes(parts, true)!;
    let mat = this.mats.get("path");
    if (!mat) {
      mat = flatMat(this.scene, "pathMat");
      this.mats.set("path", mat);
    }
    mat.emissiveColor = Color3.FromHexString(color);
    mat.alpha = 0.9;
    mesh.material = mat;
    mesh.isPickable = false;
    this.regions.set("path", mesh);
  }

  clear(): void {
    for (const m of this.regions.values()) m.dispose();
    this.regions.clear();
    this.setCursor(null);
  }

  update(dt: number): void {
    this.time += dt;
    const s = 1 + Math.sin(this.time * 5) * 0.04;
    this.cursor.scaling.set(s, 1, s);
  }
}
