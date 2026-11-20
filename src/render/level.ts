import {
  Color3, Color4, Mesh, ParticleSystem, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData,
  type Texture,
} from "./babylon";
import { DIRS4 } from "../core/grid";
import { T, idx, inBounds, isFloorLike, type DungeonMap, type Prop } from "../dungeon/map";
import type { Kit } from "./kit";
import type { Stage } from "./stage";
import { buildModel } from "./models";
import { rugTexture, webTexture, type Surface } from "./textures";

export const WALL_H = 1.15;
/** Height of walls cut away because they stand between the camera and the room. */
const STUB_H = 0.22;
const FOG_SEEN = 0.24;

/** Facing (into the room) for wall-mounted props, by `dir`. */
const FACING = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];

interface LightSource {
  pos: Vector3;
  tile: number;
  color: Color3;
  seed: number;
  strength: number;
  flame?: Mesh;
}

interface PropView {
  node: TransformNode;
  tile: number;
}

/** Builds and animates one depth: stone, fog of war, torches, doors, chests. */
export class LevelView {
  private root: TransformNode;
  private floor!: Mesh;
  private walls!: Mesh;
  private caps!: Mesh;
  private floorTile!: Int32Array;
  private floorBase!: Float32Array;
  private wallTile!: Int32Array;
  private wallBase!: Float32Array;
  private capTile!: Int32Array;
  private capBase!: Float32Array;
  private wallTop!: Uint8Array;
  /** Per wall tile: the directions its visible faces point. */
  private faceDirs = new Map<number, { x: number; y: number }[]>();
  private wallH: Float32Array;
  private wallHTarget: Float32Array;
  private wallsDirty = true;
  private lastCamAngle = 999;
  private wallProps: { node: TransformNode; tile: number }[] = [];
  private fogCur: Float32Array;
  private fogTarget: Float32Array;
  private fogDirty = true;
  private props: PropView[] = [];
  private lights: LightSource[] = [];
  private flames: ParticleSystem[] = [];
  private doors = new Map<number, { pivot: TransformNode; t: number; open: boolean }>();
  private chests = new Map<number, { lid: TransformNode; t: number; open: boolean; glow: Mesh }>();
  private stairsMotes: ParticleSystem | null = null;
  private time = 0;
  private floorMat: StandardMaterial;
  private wallMat: StandardMaterial;
  private capMat: StandardMaterial;
  private seenRef: Uint8Array;
  private visibleRef = new Set<number>();
  /** Shown everywhere (title-screen flyover). */
  revealAll = false;

  constructor(
    readonly stage: Stage,
    readonly kit: Kit,
    readonly map: DungeonMap,
    readonly surfaces: { floor: Surface; wall: Surface; planks: Texture; dot: Texture },
  ) {
    const scene = stage.scene;
    this.root = new TransformNode("level", scene);
    const n = map.w * map.h;
    this.fogCur = new Float32Array(n);
    this.fogTarget = new Float32Array(n);
    this.seenRef = new Uint8Array(n);
    this.wallH = new Float32Array(n).fill(WALL_H);
    this.wallHTarget = new Float32Array(n).fill(WALL_H);

    const theme = map.theme;
    scene.fogDensity = theme.fog;
    stage.ambient.diffuse = Color3.FromHexString(theme.ambient).scale(1.6);
    stage.ambient.groundColor = Color3.FromHexString(theme.ambient).scale(0.35);

    this.floorMat = new StandardMaterial("floorMat", scene);
    this.floorMat.diffuseTexture = surfaces.floor.diffuse;
    this.floorMat.bumpTexture = surfaces.floor.normal;
    this.floorMat.bumpTexture.level = 0.9;
    this.floorMat.specularColor = new Color3(0.22, 0.2, 0.18);
    this.floorMat.specularPower = 28;
    this.floorMat.maxSimultaneousLights = stage.lightCount;

    this.wallMat = new StandardMaterial("wallMat", scene);
    this.wallMat.diffuseTexture = surfaces.wall.diffuse;
    this.wallMat.bumpTexture = surfaces.wall.normal;
    this.wallMat.bumpTexture.level = 1.1;
    this.wallMat.specularColor = new Color3(0.12, 0.11, 0.1);
    this.wallMat.specularPower = 20;
    this.wallMat.backFaceCulling = false;
    this.wallMat.maxSimultaneousLights = stage.lightCount;

    this.capMat = new StandardMaterial("capMat", scene);
    this.capMat.diffuseTexture = surfaces.floor.diffuse;
    this.capMat.specularColor = Color3.Black();
    this.capMat.backFaceCulling = false;
    this.capMat.maxSimultaneousLights = stage.lightCount;

    this.buildFloor();
    this.buildWalls();
    this.buildProps();
    this.buildFlamePool();
  }

  // ------------------------------------------------------------ geometry

  private buildFloor(): void {
    const m = this.map;
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], ind: number[] = [];
    const tileOf: number[] = [];
    const base: number[] = [];
    const tint = Color3.FromHexString(m.theme.floor).scale(1.5);
    const solidAt = (x: number, y: number) => {
      if (!inBounds(m, x, y)) return true;
      const t = m.tiles[idx(m, x, y)];
      return t === T.Wall || t === T.Pillar;
    };
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const t = m.tiles[idx(m, x, y)];
        if (!isFloorLike(t) || t === T.Stairs) continue;
        const v0 = pos.length / 3;
        const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
        for (const [cx, cy] of corners) {
          pos.push(x + cx, 0, y + cy);
          nrm.push(0, 1, 0);
          uv.push((x + cx + 0.5) / 4, 1 - (y + cy + 0.5) / 4);
          // Ambient occlusion: corners touching walls are darker.
          const sx = cx < 0 ? -1 : 1, sy = cy < 0 ? -1 : 1;
          const occ = (solidAt(x + sx, y) ? 1 : 0) + (solidAt(x, y + sy) ? 1 : 0) + (solidAt(x + sx, y + sy) ? 0.6 : 0);
          const ao = 1 - occ * 0.2;
          base.push(tint.r * ao, tint.g * ao, tint.b * ao);
          col.push(0, 0, 0, 1);
          tileOf.push(idx(m, x, y));
        }
        ind.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    }
    this.floor = this.makeMesh("floor", pos, nrm, uv, col, ind, this.floorMat);
    this.floorTile = Int32Array.from(tileOf);
    this.floorBase = Float32Array.from(base);
  }

  private buildWalls(): void {
    const m = this.map;
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], ind: number[] = [];
    const tileOf: number[] = [];
    const base: number[] = [];
    const top: number[] = [];
    const cpos: number[] = [], cnrm: number[] = [], cuv: number[] = [], ccol: number[] = [], cind: number[] = [];
    const ctile: number[] = [];
    const cbase: number[] = [];
    const tint = Color3.FromHexString(m.theme.wall).scale(1.45);
    const capTint = Color3.FromHexString(m.theme.wall).scale(0.16);
    const open = (x: number, y: number) => inBounds(m, x, y) && isFloorLike(m.tiles[idx(m, x, y)]);

    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (m.tiles[idx(m, x, y)] !== T.Wall) continue;
        let touches = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) touches = true;
        if (!touches) continue;
        const ti = idx(m, x, y);
        for (const d of DIRS4) {
          if (!open(x + d.x, y + d.y)) continue;
          if (!this.faceDirs.has(ti)) this.faceDirs.set(ti, []);
          this.faceDirs.get(ti)!.push(d);
          // Face on the boundary, facing the open tile.
          const fx = x + d.x * 0.5, fz = y + d.y * 0.5;
          const along = d.x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
          const v0 = pos.length / 3;
          for (const [s, hgt] of [[-0.5, 0], [0.5, 0], [0.5, WALL_H], [-0.5, WALL_H]]) {
            const px = fx + along.x * s, pz = fz + along.z * s;
            pos.push(px, hgt, pz);
            nrm.push(d.x, 0, d.y);
            uv.push((along.x ? px : pz) / 2 + 0.25, hgt / 2);
            const ao = hgt === 0 ? 0.42 : 1.05;
            base.push(tint.r * ao, tint.g * ao, tint.b * ao);
            col.push(0, 0, 0, 1);
            tileOf.push(ti);
            top.push(hgt > 0 ? 1 : 0);
          }
          ind.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        }
        const c0 = cpos.length / 3;
        for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
          cpos.push(x + cx, WALL_H, y + cy);
          cnrm.push(0, 1, 0);
          cuv.push((x + cx) / 7, (y + cy) / 7);
          cbase.push(capTint.r, capTint.g, capTint.b);
          ccol.push(0, 0, 0, 1);
          ctile.push(ti);
        }
        cind.push(c0, c0 + 1, c0 + 2, c0, c0 + 2, c0 + 3);
      }
    }
    this.walls = this.makeMesh("walls", pos, nrm, uv, col, ind, this.wallMat);
    this.wallTile = Int32Array.from(tileOf);
    this.wallBase = Float32Array.from(base);
    this.wallTop = Uint8Array.from(top);
    this.caps = this.makeMesh("caps", cpos, cnrm, cuv, ccol, cind, this.capMat);
    this.capTile = Int32Array.from(ctile);
    this.capBase = Float32Array.from(cbase);
  }

  private makeMesh(name: string, pos: number[], nrm: number[], uv: number[], col: number[], ind: number[], mat: StandardMaterial): Mesh {
    const mesh = new Mesh(name, this.stage.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.uvs = uv;
    vd.colors = col;
    vd.indices = ind;
    vd.applyToMesh(mesh, true);
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  // ------------------------------------------------------------ props

  private buildProps(): void {
    const m = this.map;
    const K = this.kit;
    const wood = K.mat("#ffffff", { texture: this.surfaces.planks, spec: 0.05 });
    const iron = K.mat("#3a3a40", { spec: 0.5, specPower: 40 });
    const stone = K.mat(m.theme.wall, { spec: 0.05 });
    const torchColor = Color3.FromHexString(m.theme.torch);

    // Pillars.
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (m.tiles[idx(m, x, y)] !== T.Pillar) continue;
        const n = K.node("pillar", this.root, x, 0, y);
        K.box(0.72, 0.16, 0.72, stone, n, 0, 0.08, 0);
        K.cyl(0.52, 0.58, WALL_H + 0.6, 8, stone, n, 0, (WALL_H + 0.6) / 2 + 0.1, 0);
        K.box(0.7, 0.14, 0.7, stone, n, 0, WALL_H + 0.72, 0);
        this.props.push({ node: n, tile: idx(m, x, y) });
      }
    }

    // Doors: a frame in the gap and a hinged panel.
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const t = m.tiles[idx(m, x, y)];
        if (t !== T.Door && t !== T.DoorOpen) continue;
        const wallsX = m.tiles[idx(m, x - 1, y)] === T.Wall && m.tiles[idx(m, x + 1, y)] === T.Wall;
        const n = K.node("door", this.root, x, 0, y);
        n.rotation.y = wallsX ? 0 : Math.PI / 2;
        K.box(0.14, WALL_H + 0.05, 0.3, wood, n, -0.48, (WALL_H + 0.05) / 2, 0);
        K.box(0.14, WALL_H + 0.05, 0.3, wood, n, 0.48, (WALL_H + 0.05) / 2, 0);
        K.box(1.1, 0.16, 0.32, wood, n, 0, WALL_H, 0);
        const pivot = K.node("hinge", n, -0.42, 0, 0);
        K.box(0.84, WALL_H - 0.1, 0.07, wood, pivot, 0.42, (WALL_H - 0.1) / 2, 0);
        for (const hy of [0.25, 0.75]) K.box(0.86, 0.05, 0.09, iron, pivot, 0.42, hy, 0);
        K.ball(0.07, 2, iron, pivot, 0.72, 0.5, 0.06);
        const open = t === T.DoorOpen;
        pivot.rotation.y = open ? -1.75 : 0;
        this.doors.set(idx(m, x, y), { pivot, t: open ? 1 : 0, open });
        this.props.push({ node: n, tile: idx(m, x, y) });
      }
    }

    // The way down: steps into a glowing pit.
    if (m.stairs) {
      const n = K.node("stairs", this.root, m.stairs.x, 0, m.stairs.y);
      const dark = K.mat("#2a2622");
      for (let k = 0; k < 5; k++) K.box(1, 0.2, 0.2, stone, n, 0, -0.1 - k * 0.2, -0.4 + k * 0.2);
      K.box(1, 0.05, 1, dark, n, 0, -1.05, 0);
      for (const sx of [-0.52, 0.52]) K.box(0.06, 1.1, 1, dark, n, sx, -0.5, 0);
      const glow = K.plane(0.9, 0.9, K.glow("#5fb0ff", 1.2), n, 0, -0.95, 0.1);
      glow.rotation.x = Math.PI / 2;
      // Railing posts so the stairs read from far away.
      for (const sx of [-0.45, 0.45]) {
        K.cyl(0.07, 0.09, 0.5, 6, iron, n, sx, 0.25, -0.45);
        K.ball(0.09, 2, K.glow("#7fc4ff", 2), n, sx, 0.55, -0.45);
      }
      const ti = idx(m, m.stairs.x, m.stairs.y);
      this.props.push({ node: n, tile: ti });
      this.lights.push({ pos: new Vector3(m.stairs.x, 0.3, m.stairs.y), tile: ti, color: Color3.FromHexString("#6fb6ff"), seed: 3, strength: 0.9 });
      const ps = new ParticleSystem("stairMotes", 40, this.stage.scene);
      ps.particleTexture = this.surfaces.dot;
      ps.emitter = new Vector3(m.stairs.x, -0.8, m.stairs.y);
      ps.minEmitBox = new Vector3(-0.4, 0, -0.4);
      ps.maxEmitBox = new Vector3(0.4, 0, 0.4);
      ps.color1 = new Color4(0.5, 0.8, 1, 1);
      ps.color2 = new Color4(0.3, 0.6, 1, 0.8);
      ps.colorDead = new Color4(0.1, 0.2, 0.6, 0);
      ps.minSize = 0.03; ps.maxSize = 0.08;
      ps.minLifeTime = 1.2; ps.maxLifeTime = 2.4;
      ps.emitRate = 14;
      ps.direction1 = new Vector3(-0.05, 1, -0.05);
      ps.direction2 = new Vector3(0.05, 1, 0.05);
      ps.minEmitPower = 0.5; ps.maxEmitPower = 0.9;
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      this.stairsMotes = ps;
    }

    // The light shaft where you came in.
    {
      const n = K.node("entry", this.root, m.start.x, 0, m.start.y);
      const shaft = K.cyl(1.0, 1.7, 6, 12, K.mat("#ffe6b0", { emissive: "#ffd890", emissiveScale: 0.18, alpha: 0.035, noFog: true }), n, 0, 3, 0);
      this.stage.glow.addExcludedMesh(shaft);
      shaft.material!.disableDepthWrite = true;
      this.props.push({ node: n, tile: idx(m, m.start.x, m.start.y) });
    }

    for (const p of m.props) this.buildProp(p, wood, iron, stone, torchColor);
  }

  private buildProp(p: Prop, wood: StandardMaterial, iron: StandardMaterial, stone: StandardMaterial, torchColor: Color3): void {
    const K = this.kit;
    const m = this.map;
    const ti = idx(m, p.x, p.y);
    const f = FACING[p.dir] ?? FACING[0];
    const jitter = ((p.seed % 1000) / 1000 - 0.5);
    const n = K.node(p.kind, this.root, p.x, 0, p.y);
    switch (p.kind) {
      case "torch": {
        this.wallProps.push({ node: n, tile: ti });
        // Mounted on the face of the wall tile, sticking into the room.
        n.position.set(p.x + f.x * 0.5, 0, p.y + f.y * 0.5);
        n.rotation.y = Math.atan2(f.x, f.y);
        K.box(0.14, 0.2, 0.06, iron, n, 0, 0.72, 0.03);
        const stick = K.cyl(0.05, 0.035, 0.32, 5, K.mat("#4a3020"), n, 0, 0.82, 0.12);
        stick.rotation.x = 0.45;
        K.cyl(0.11, 0.07, 0.07, 6, iron, n, 0, 0.96, 0.19);
        const flame = K.ball(0.13, 2, K.glow(torchColor.toHexString(), 2.2), n, 0, 1.04, 0.2, false);
        flame.scaling.set(0.8, 1.4, 0.8);
        this.lights.push({ pos: new Vector3(p.x + f.x * 0.72, 1.1, p.y + f.y * 0.72), tile: ti, color: torchColor, seed: p.seed, strength: 1, flame });
        break;
      }
      case "banner": {
        this.wallProps.push({ node: n, tile: ti });
        n.position.set(p.x + f.x * 0.53, 0, p.y + f.y * 0.53);
        n.rotation.y = Math.atan2(f.x, f.y);
        const cloth = ["#6e1a1a", "#1f3560", "#3c2a5a", "#2f4a2a"][p.seed % 4];
        K.box(0.5, 0.05, 0.05, K.mat("#6b4a2b"), n, 0, 1.0, 0.02);
        K.box(0.42, 0.7, 0.02, K.mat(cloth), n, 0, 0.62, 0.03);
        K.box(0.12, 0.12, 0.03, K.mat("#c9a24a", { spec: 0.6 }), n, 0, 0.7, 0.04).rotation.z = Math.PI / 4;
        const tail = K.cyl(0, 0.3, 0.16, 3, K.mat(cloth), n, 0, 0.2, 0.03);
        tail.rotation.z = Math.PI;
        tail.scaling.z = 0.1;
        break;
      }
      case "barrel": {
        n.position.x += jitter * 0.2;
        const b = K.cyl(0.46, 0.4, 0.62, 10, wood, n, 0, 0.31, 0);
        b.scaling.x = 1;
        K.cyl(0.5, 0.5, 0.04, 10, iron, n, 0, 0.14, 0);
        K.cyl(0.5, 0.5, 0.04, 10, iron, n, 0, 0.48, 0);
        K.cyl(0.42, 0.42, 0.02, 10, K.mat("#3a2818"), n, 0, 0.62, 0);
        if (p.seed % 3 === 0) K.cyl(0.36, 0.32, 0.46, 10, wood, n, 0.38, 0.23, 0.15);
        break;
      }
      case "crate": {
        n.rotation.y = jitter * 0.6;
        K.box(0.6, 0.55, 0.6, wood, n, 0, 0.275, 0);
        for (const [x, z] of [[-0.29, -0.29], [0.29, -0.29], [0.29, 0.29], [-0.29, 0.29]]) K.box(0.06, 0.57, 0.06, K.mat("#3a2818"), n, x, 0.28, z);
        if (p.seed % 2 === 0) K.box(0.4, 0.36, 0.4, wood, n, 0.05, 0.73, 0.02).rotation.y = 0.5;
        break;
      }
      case "bones": {
        const bone = K.mat("#d8cfb8");
        for (let k = 0; k < 4; k++) {
          const b = K.cyl(0.035, 0.035, 0.32, 4, bone, n, Math.sin(p.seed + k) * 0.18, 0.025, Math.cos(p.seed * 0.7 + k) * 0.18);
          b.rotation.z = Math.PI / 2;
          b.rotation.y = k * 1.3 + jitter;
        }
        K.ball(0.13, 2, bone, n, 0.15, 0.06, -0.1);
        break;
      }
      case "skull": {
        const bone = K.mat("#d8cfb8");
        K.ball(0.16, 2, bone, n, jitter * 0.3, 0.08, 0);
        K.box(0.1, 0.05, 0.08, bone, n, jitter * 0.3, 0.02, 0.05);
        break;
      }
      case "rubble": {
        for (let k = 0; k < 5; k++) {
          K.rock(0.05 + ((p.seed >> k) % 5) * 0.015, k % 3, stone, n, Math.sin(p.seed + k * 2.1) * 0.25, 0.04, Math.cos(p.seed + k * 1.7) * 0.25).rotation.y = k;
        }
        break;
      }
      case "candles": {
        for (let k = 0; k < 3; k++) {
          const x = Math.sin(p.seed + k * 2.2) * 0.12, z = Math.cos(p.seed + k * 2.2) * 0.12;
          const hgt = 0.12 + k * 0.05;
          K.cyl(0.05, 0.05, hgt, 6, K.mat("#e8dcc0"), n, x, hgt / 2, z);
          K.ball(0.05, 2, K.glow("#ffcc66", 2), n, x, hgt + 0.03, z, false).scaling.y = 1.6;
        }
        this.lights.push({ pos: new Vector3(p.x, 0.4, p.y), tile: ti, color: Color3.FromHexString("#ffbb66"), seed: p.seed, strength: 0.45 });
        break;
      }
      case "chest": {
        n.rotation.y = Math.atan2(f.x, f.y);
        const gold = K.mat("#c9a24a", { spec: 0.8, specPower: 64 });
        K.box(0.7, 0.36, 0.46, wood, n, 0, 0.18, 0);
        K.box(0.72, 0.05, 0.48, gold, n, 0, 0.34, 0);
        const lid = K.node("lid", n, 0, 0.36, -0.23);
        const top = K.cyl(0.46, 0.46, 0.7, 8, wood, lid, 0, 0, 0.23);
        top.rotation.z = Math.PI / 2;
        top.scaling.set(1, 1, 0.6);
        K.box(0.74, 0.06, 0.06, gold, lid, 0, 0.12, 0.23);
        K.box(0.1, 0.12, 0.05, gold, n, 0, 0.3, 0.25);
        const glow = K.plane(0.6, 0.35, K.glow("#ffd76a", 1.4), n, 0, 0.36, 0);
        glow.rotation.x = Math.PI / 2;
        glow.setEnabled(false);
        this.chests.set(ti, { lid, t: p.opened ? 1 : 0, open: !!p.opened, glow });
        break;
      }
      case "brazier": {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const leg = K.cyl(0.04, 0.04, 0.6, 4, iron, n, Math.sin(a) * 0.16, 0.3, Math.cos(a) * 0.16);
          leg.rotation.x = Math.cos(a) * 0.25;
          leg.rotation.z = -Math.sin(a) * 0.25;
        }
        K.cyl(0.62, 0.3, 0.2, 8, iron, n, 0, 0.66, 0);
        for (let k = 0; k < 4; k++) K.rock(0.06, 1, K.glow("#ff7a2a", 1.5), n, Math.sin(k * 1.7) * 0.12, 0.74, Math.cos(k * 1.7) * 0.12);
        const flame = K.ball(0.32, 2, K.glow(torchColor.toHexString(), 2.2), n, 0, 0.92, 0, false);
        flame.scaling.set(0.8, 1.3, 0.8);
        this.lights.push({ pos: new Vector3(p.x, 1.2, p.y), tile: ti, color: torchColor, seed: p.seed, strength: 1.25, flame });
        break;
      }
      case "statue": {
        K.box(0.7, 0.3, 0.7, stone, n, 0, 0.15, 0);
        const rig = buildModel(K, "statue", true);
        rig.root.parent = n;
        rig.root.position.y = 0.3;
        rig.root.rotation.y = (p.dir * Math.PI) / 2;
        rig.root.scaling.setAll(1.15);
        rig.armR.rotation.x = -2.4;
        break;
      }
      case "cobweb": {
        const corner = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]][p.dir];
        n.position.set(p.x + corner[0] * 0.98, WALL_H - 0.02, p.y + corner[1] * 0.98);
        n.rotation.y = Math.atan2(-corner[0], -corner[1]);
        const web = K.plane(0.9, 0.9, K.mat("#ffffff", { texture: webTexture(this.stage.scene), alpha: 0.99, backFaces: true }), n, 0, -0.3, 0.1);
        web.rotation.x = 0.6;
        (web.material as StandardMaterial).diffuseTexture!.hasAlpha = true;
        (web.material as StandardMaterial).useAlphaFromDiffuseTexture = true;
        break;
      }
      case "rug": {
        const mat = K.mat("#ffffff", { texture: rugTexture(this.stage.scene, "#5a1a1e", "#c9a24a"), spec: 0 });
        const rug = K.plane(1.6, 3.2, mat, n, 0, 0.012, 0);
        rug.rotation.x = Math.PI / 2;
        rug.rotation.y = p.dir === 1 ? Math.PI / 2 : 0;
        break;
      }
      case "throne": {
        const dark = K.mat("#2a2228", { spec: 0.5 });
        const red = K.mat("#6a1414");
        K.box(1.1, 0.3, 0.8, dark, n, 0, 0.15, 0);
        K.box(0.8, 0.25, 0.6, red, n, 0, 0.42, 0.05);
        K.box(0.9, 1.6, 0.18, dark, n, 0, 1.05, -0.3);
        for (const sx of [-0.48, 0.48]) {
          K.box(0.14, 0.5, 0.7, dark, n, sx, 0.55, 0);
          K.cyl(0, 0.16, 0.45, 4, K.mat("#3a2a20", { emissive: "#ff5a1a", emissiveScale: 0.5 }), n, sx, 2.0, -0.3);
        }
        K.box(0.5, 0.5, 0.04, K.glow("#ff5a1a", 1.4), n, 0, 1.4, -0.2).rotation.z = Math.PI / 4;
        this.lights.push({ pos: new Vector3(p.x, 1.6, p.y + 0.3), tile: ti, color: Color3.FromHexString("#ff5a2a"), seed: p.seed, strength: 1.3 });
        break;
      }
    }
    this.props.push({ node: n, tile: ti });
  }

  private buildFlamePool(): void {
    const scene = this.stage.scene;
    for (let i = 0; i < this.stage.torchLights.length; i++) {
      const ps = new ParticleSystem(`flame${i}`, 60, scene);
      ps.particleTexture = this.surfaces.dot;
      ps.emitter = new Vector3(0, -50, 0);
      ps.minEmitBox = new Vector3(-0.04, 0, -0.04);
      ps.maxEmitBox = new Vector3(0.04, 0, 0.04);
      ps.color1 = new Color4(1, 0.62, 0.22, 1);
      ps.color2 = new Color4(1, 0.82, 0.4, 1);
      ps.colorDead = new Color4(0.4, 0.05, 0, 0);
      ps.minSize = 0.06; ps.maxSize = 0.17;
      ps.minLifeTime = 0.2; ps.maxLifeTime = 0.5;
      ps.emitRate = 46;
      ps.direction1 = new Vector3(-0.08, 1, -0.08);
      ps.direction2 = new Vector3(0.08, 1, 0.08);
      ps.minEmitPower = 0.5; ps.maxEmitPower = 1.0;
      ps.gravity = new Vector3(0, 1.2, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.start();
      this.flames.push(ps);
    }
  }

  // ------------------------------------------------------------ live updates

  /** New sight from the rules: tiles fade toward lit, remembered, or unknown. */
  setVisibility(visible: Iterable<number>, seen: Uint8Array): void {
    this.visibleRef = new Set(visible);
    this.seenRef = seen;
    for (let i = 0; i < this.fogTarget.length; i++) {
      this.fogTarget[i] = this.revealAll ? 1 : this.visibleRef.has(i) ? 1 : seen[i] ? FOG_SEEN : 0;
    }
    this.fogDirty = true;
    for (const p of this.props) p.node.setEnabled(this.revealAll || !!seen[p.tile]);
    this.wallsDirty = true;
    this.stairsMotes?.[this.revealAll || (this.map.stairs && seen[idx(this.map, this.map.stairs.x, this.map.stairs.y)]) ? "start" : "stop"]();
  }

  isVisibleTile(i: number): boolean {
    return this.revealAll || this.visibleRef.has(i);
  }

  openDoor(x: number, y: number): void {
    const d = this.doors.get(idx(this.map, x, y));
    if (d) d.open = true;
  }

  openChest(x: number, y: number): void {
    const c = this.chests.get(idx(this.map, x, y));
    if (c) {
      c.open = true;
      c.glow.setEnabled(true);
    }
  }

  /** Walls whose faces all point away from the camera are cut down so they never hide the action. */
  private updateCutaway(dt: number): void {
    const cam = this.stage.camera;
    const angle = cam.alpha;
    if (Math.abs(angle - this.lastCamAngle) > 0.02) {
      this.lastCamAngle = angle;
      // Horizontal direction the camera looks along, in tile space (x, y=z).
      const fx = -Math.cos(angle), fz = -Math.sin(angle);
      for (const [ti, dirs] of this.faceDirs) {
        const away = dirs.every((d) => d.x * fx + d.y * fz > 0.15);
        this.wallHTarget[ti] = away ? STUB_H : WALL_H;
      }
      this.wallsDirty = true;
    }
    if (!this.wallsDirty) return;
    let moving = false;
    const k = Math.min(1, dt * 8);
    for (const ti of this.faceDirs.keys()) {
      const d = this.wallHTarget[ti] - this.wallH[ti];
      if (Math.abs(d) > 0.002) { this.wallH[ti] += d * k; moving = true; } else this.wallH[ti] = this.wallHTarget[ti];
    }
    const wp = this.walls.getVerticesData(VertexBuffer.PositionKind)!;
    for (let v = 0; v < this.wallTile.length; v++) if (this.wallTop[v]) wp[v * 3 + 1] = this.wallH[this.wallTile[v]];
    this.walls.updateVerticesData(VertexBuffer.PositionKind, wp);
    const cp = this.caps.getVerticesData(VertexBuffer.PositionKind)!;
    for (let v = 0; v < this.capTile.length; v++) cp[v * 3 + 1] = this.wallH[this.capTile[v]];
    this.caps.updateVerticesData(VertexBuffer.PositionKind, cp);
    for (const p of this.wallProps) {
      const lowered = this.wallH[p.tile] < WALL_H * 0.8;
      p.node.setEnabled(!lowered && (this.revealAll || !!this.seenRef[p.tile]));
    }
    this.wallsDirty = moving;
  }

  update(dt: number, focus: Vector3): void {
    this.time += dt;
    this.updateCutaway(dt);
    if (this.fogDirty) {
      let still = false;
      const k = Math.min(1, dt * 5);
      for (let i = 0; i < this.fogCur.length; i++) {
        const d = this.fogTarget[i] - this.fogCur[i];
        if (Math.abs(d) > 0.004) { this.fogCur[i] += d * k; still = true; } else this.fogCur[i] = this.fogTarget[i];
      }
      this.applyFog(this.floor, this.floorTile, this.floorBase);
      this.applyFog(this.walls, this.wallTile, this.wallBase);
      this.applyFog(this.caps, this.capTile, this.capBase);
      this.fogDirty = still;
    }

    // Doors swing, chest lids lift.
    for (const d of this.doors.values()) {
      if (d.open && d.t < 1) { d.t = Math.min(1, d.t + dt * 2.5); d.pivot.rotation.y = -1.75 * easeOut(d.t); }
    }
    for (const c of this.chests.values()) {
      if (c.open && c.t < 1) { c.t = Math.min(1, c.t + dt * 2); c.lid.rotation.x = -1.9 * easeOut(c.t); }
    }

    // Flicker every flame, and hand the light pool to the nearest seen ones.
    const lit = this.lights.filter((l) => this.revealAll || this.seenRef[l.tile]);
    for (const l of lit) {
      if (!l.flame) continue;
      const f = flicker(this.time, l.seed);
      l.flame.scaling.set(0.8 + f * 0.15, 1.3 + f * 0.35, 0.8 + f * 0.15);
    }
    lit.sort((a, b) => Vector3.DistanceSquared(a.pos, focus) - Vector3.DistanceSquared(b.pos, focus));
    this.stage.torchLights.forEach((light, i) => {
      const src = lit[i];
      const ps = this.flames[i];
      if (!src) {
        light.intensity = 0;
        ps.emitter = new Vector3(0, -50, 0);
        return;
      }
      light.position.copyFrom(src.pos);
      light.diffuse = src.color;
      light.intensity = src.strength * (0.85 + flicker(this.time, src.seed) * 0.35);
      ps.emitter = src.flame ? src.flame.getAbsolutePosition() : new Vector3(0, -50, 0);
      ps.emitRate = src.flame && src.flame.isEnabled() ? 46 : 0;
    });
  }

  private applyFog(mesh: Mesh, tileOf: Int32Array, base: Float32Array): void {
    const n = tileOf.length;
    const colors = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const f = this.fogCur[tileOf[v]];
      // Remembered tiles shift cool and dim, like a memory of the place.
      const cool = f < 0.5 ? (0.5 - f) * 0.6 : 0;
      colors[v * 4] = base[v * 3] * f * (1 - cool * 0.4);
      colors[v * 4 + 1] = base[v * 3 + 1] * f * (1 - cool * 0.15);
      colors[v * 4 + 2] = base[v * 3 + 2] * f * (1 + cool * 0.5);
      colors[v * 4 + 3] = 1;
    }
    mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
  }

  dispose(): void {
    for (const f of this.flames) f.dispose();
    this.stairsMotes?.dispose();
    this.root.dispose(false, false);
    this.floorMat.dispose();
    this.wallMat.dispose();
    this.capMat.dispose();
    for (const l of this.stage.torchLights) l.intensity = 0;
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Smooth pseudo-random flicker in [0, 1]. */
export function flicker(t: number, seed: number): number {
  const s = seed * 0.013;
  return 0.5 + 0.25 * Math.sin(t * 9.1 + s) + 0.15 * Math.sin(t * 23.7 + s * 3.1) + 0.1 * Math.sin(t * 5.3 + s * 7.7);
}
