import { type AbstractMesh, type Mesh, type TransformNode } from "@babylonjs/core";
import type { Kit } from "./kit";

/** Pivots the animator moves. Every model, two legs or four, fills these in. */
export interface Rig {
  root: TransformNode;
  body: TransformNode;
  head: TransformNode;
  armR: TransformNode;
  armL: TransformNode;
  legL: TransformNode;
  legR: TransformNode;
  meshes: AbstractMesh[];
  height: number;
  /** Rest height of the body pivot. */
  hipY: number;
  quad: boolean;
  /** Glowing bits that pulse (staff orbs, eyes, ember blades). */
  glows: Mesh[];
}

type Weapon = "sword" | "dagger" | "staff" | "mace" | "axe" | "club" | "scimitar" | "morningstar" | "emberblade" | "longsword" | "claws" | null;
type Offhand = "shield" | "dagger" | "bow" | "holy" | null;
type HeadKind = "helm" | "hood" | "wizard" | "skull" | "goblin" | "orc" | "crown" | "hair" | "ghoul" | "bugbear" | "ogre" | "zombie" | "hobhelm";

interface Spec {
  h: number;
  w: number;
  skin: string;
  top: string;
  bottom: string;
  boots?: string;
  trim?: string;
  metal?: boolean;
  head: HeadKind;
  hair?: string;
  weapon: Weapon;
  offhand: Offhand;
  shield?: string;
  emblem?: string;
  cape?: string;
  robe?: boolean;
  hunch?: number;
  armLen?: number;
  limb?: number;
  eyes?: string;
  tabard?: string;
}

const SPECS: Record<string, Spec> = {
  fighter: {
    h: 1, w: 1.05, skin: "#d9a47e", top: "#9aa3ad", bottom: "#3b3f4a", boots: "#3a2a1e", metal: true,
    head: "helm", weapon: "sword", offhand: "shield", shield: "#2b4f8f", emblem: "#e8c15a", tabard: "#2b4f8f", trim: "#e8c15a", cape: "#7a1f24",
  },
  rogue: {
    h: 0.96, w: 0.92, skin: "#e0b08c", top: "#2f3a33", bottom: "#24262b", boots: "#1d1a17",
    head: "hood", hair: "#1e2a24", weapon: "dagger", offhand: "dagger", cape: "#1f2a25", trim: "#8a6a3a",
  },
  wizard: {
    h: 1, w: 0.95, skin: "#e3b896", top: "#3b2b6e", bottom: "#2a1f50", boots: "#2a1f1a", robe: true,
    head: "wizard", hair: "#cfc8bd", weapon: "staff", offhand: null, trim: "#d9b34a", eyes: undefined,
  },
  cleric: {
    h: 1, w: 1.02, skin: "#b9805e", top: "#c9c2b0", bottom: "#4a4038", boots: "#3a2a1e", metal: true,
    head: "hair", hair: "#3a2414", weapon: "mace", offhand: "shield", shield: "#d8d0bc", emblem: "#f2c14e", tabard: "#efe8d6", trim: "#d9a93a",
  },
  goblin: {
    h: 0.68, w: 0.85, skin: "#6f9a3c", top: "#5a4630", bottom: "#3d3122", head: "goblin", weapon: "scimitar", offhand: null, eyes: "#ffcc33",
  },
  goblin_archer: {
    h: 0.66, w: 0.8, skin: "#7aa043", top: "#4a5a3a", bottom: "#3d3122", head: "goblin", weapon: null, offhand: "bow", eyes: "#ffcc33", cape: "#3a4a2a",
  },
  skeleton: {
    h: 0.98, w: 0.82, skin: "#ddd6c2", top: "#ddd6c2", bottom: "#cfc7b0", head: "skull", weapon: "sword", offhand: null, limb: 0.55, eyes: "#7fe8ff",
  },
  skeleton_archer: {
    h: 0.98, w: 0.82, skin: "#d4ccb4", top: "#d4ccb4", bottom: "#c7bea6", head: "skull", weapon: null, offhand: "bow", limb: 0.55, eyes: "#7fe8ff",
  },
  zombie: {
    h: 0.98, w: 1.05, skin: "#7f8f6a", top: "#4b4a3c", bottom: "#3a3a30", head: "zombie", weapon: null, offhand: null, hunch: 0.35, armLen: 1.1, eyes: "#c8ff5a",
  },
  orc: {
    h: 1.08, w: 1.3, skin: "#6c7d52", top: "#4e3a2a", bottom: "#3a3028", boots: "#2a2018", head: "orc", hair: "#1a1612", weapon: "axe", offhand: null, eyes: "#ff5a3a",
  },
  hobgoblin: {
    h: 1, w: 1.1, skin: "#c4673a", top: "#7d8590", bottom: "#4a2a26", boots: "#2a1f18", metal: true, head: "hobhelm", weapon: "longsword", offhand: "shield", shield: "#6e2a22", emblem: "#c9a24a",
  },
  ghoul: {
    h: 0.95, w: 0.85, skin: "#a6a89a", top: "#58564c", bottom: "#3f3d36", head: "ghoul", weapon: "claws", offhand: null, hunch: 0.4, armLen: 1.25, limb: 0.7, eyes: "#ffe14a",
  },
  bugbear: {
    h: 1.2, w: 1.35, skin: "#8a5a32", top: "#5a3a22", bottom: "#3a2a1a", head: "bugbear", weapon: "morningstar", offhand: null, eyes: "#ffb347",
  },
  ogre: {
    h: 1.65, w: 1.75, skin: "#a08a5e", top: "#6a4a2e", bottom: "#4a3826", head: "ogre", hair: "#2a2018", weapon: "club", offhand: null, armLen: 1.1, eyes: "#ffd27a",
  },
  wight: {
    h: 1.22, w: 1.2, skin: "#4a3f3a", top: "#2c2a30", bottom: "#1e1c22", boots: "#141216", metal: true, head: "crown", weapon: "emberblade", offhand: null, cape: "#4a1210", trim: "#ff6a2a", eyes: "#ff6a1a",
  },
  statue: {
    h: 1.05, w: 1.05, skin: "#8d8a84", top: "#8d8a84", bottom: "#86837c", head: "helm", weapon: "sword", offhand: "shield", shield: "#86837c",
  },
};

export function buildModel(kit: Kit, def: string, stoneOverride = false): Rig {
  if (def === "rat") return buildRat(kit);
  const spec = SPECS[def] ?? SPECS.goblin;
  return buildHumanoid(kit, spec, stoneOverride);
}

function buildHumanoid(kit: Kit, s: Spec, stone: boolean): Rig {
  const K = kit;
  const mat = (hex: string, metal = false) => (stone ? K.mat("#8d8a84", { spec: 0.05 }) : K.mat(hex, metal ? { spec: 0.6, specPower: 48 } : {}));
  const h = s.h, w = s.w;
  const limb = s.limb ?? 1;
  // Chunky, big-headed proportions: they read clearly from an isometric camera.
  const hipY = 0.3 * h;
  const root = K.node("actor", null);
  const body = K.node("body", root, 0, hipY, 0);
  const meshes: AbstractMesh[] = [];
  const glows: Mesh[] = [];
  const add = <T extends AbstractMesh>(m: T): T => { meshes.push(m); return m; };

  // Legs.
  const legL = K.node("legL", root, -0.1 * w, hipY, 0);
  const legR = K.node("legR", root, 0.1 * w, hipY, 0);
  if (!s.robe) {
    for (const leg of [legL, legR]) {
      add(K.box(0.13 * w * limb, 0.2 * h, 0.14 * w * limb, mat(s.bottom), leg, 0, -0.1 * h, 0));
      add(K.box(0.15 * w, 0.09 * h, 0.2 * w, mat(s.boots ?? s.bottom), leg, 0, -0.245 * h, 0.03));
    }
  }

  // Torso, leaning forward for the hunched dead.
  const torsoNode = K.node("torso", body, 0, 0, 0);
  torsoNode.rotation.x = s.hunch ?? 0;
  if (s.robe) {
    add(K.cyl(0.36 * w, 0.52 * w, 0.32 * h, 8, mat(s.bottom), root, 0, 0.16 * h, 0));
    add(K.cyl(0.53 * w, 0.53 * w, 0.03 * h, 8, mat(s.trim ?? s.top), root, 0, 0.015 * h, 0));
  }
  const torso = add(K.cyl(0.44 * w * (s.limb ? 0.8 : 1), 0.33 * w, 0.3 * h, 8, mat(s.top, s.metal), torsoNode, 0, 0.15 * h, 0));
  torso.rotation.y = Math.PI / 8;
  if (s.limb && s.head === "skull") {
    // Ribcage hint: dark gaps.
    for (let k = 0; k < 3; k++) add(K.box(0.36 * w, 0.015, 0.25 * w, K.mat("#2a2420"), torsoNode, 0, 0.1 * h + k * 0.05 * h, 0.03));
  }
  add(K.cyl(0.36 * w, 0.36 * w, 0.045 * h, 8, mat(s.boots ?? "#3a2a1e"), torsoNode, 0, 0.02 * h, 0)); // belt
  if (s.tabard) {
    add(K.box(0.24 * w, 0.32 * h, 0.02, mat(s.tabard), torsoNode, 0, 0.09 * h, 0.19 * w));
    if (s.emblem) add(K.box(0.09 * w, 0.09 * w, 0.02, K.mat(s.emblem, { emissive: s.emblem, emissiveScale: 0.3 }), torsoNode, 0, 0.18 * h, 0.205 * w)).rotation.z = Math.PI / 4;
  }
  if (s.cape) {
    const cape = add(K.box(0.4 * w, 0.46 * h, 0.03, mat(s.cape), torsoNode, 0, 0.04 * h, -0.19 * w));
    cape.rotation.x = 0.14;
  }
  if (s.metal) {
    // Pauldrons.
    for (const sx of [-1, 1]) add(K.ball(0.19 * w, 3, mat(s.top, true), torsoNode, sx * 0.23 * w, 0.27 * h, 0)).scaling.y = 0.75;
  }

  // Head.
  const head = K.node("head", torsoNode, 0, 0.3 * h + 0.13 * h, 0);
  buildHead(K, s, head, mat, add, glows, h, w, stone);

  // Arms: pivots at the shoulders, hanging down.
  const armLen = 0.24 * h * (s.armLen ?? 1);
  const armR = K.node("armR", torsoNode, 0.26 * w, 0.25 * h, 0);
  const armL = K.node("armL", torsoNode, -0.26 * w, 0.25 * h, 0);
  for (const arm of [armL, armR]) {
    add(K.box(0.1 * w * limb, armLen, 0.11 * w * limb, mat(s.metal ? s.top : s.skin, s.metal), arm, 0, -armLen / 2, 0));
    add(K.ball(0.12 * w, 3, mat(s.skin), arm, 0, -armLen, 0.01));
  }
  const handR = K.node("handR", armR, 0, -armLen, 0.02);
  const handL = K.node("handL", armL, 0, -armLen, 0.02);
  buildWeapon(K, s.weapon, handR, mat, add, glows, h, stone);
  buildOffhand(K, s, handL, mat, add, glows, h);

  // Resting pose: arms slightly forward, weapon raised.
  armR.rotation.x = -0.35;
  armL.rotation.x = -0.25;
  armR.rotation.z = -0.12;
  armL.rotation.z = 0.12;
  if (s.hunch) { armR.rotation.x = -1.2; armL.rotation.x = -1.2; }

  root.scaling.setAll(1.18);
  return { root, body, head, armR, armL, legL, legR, meshes, height: 0.9 * h * 1.18, hipY, quad: false, glows };
}

type MatFn = (hex: string, metal?: boolean) => ReturnType<Kit["mat"]>;
type AddFn = <T extends AbstractMesh>(m: T) => T;

function buildHead(K: Kit, s: Spec, head: TransformNode, mat: MatFn, add: AddFn, glows: Mesh[], h: number, w: number, stone: boolean): void {
  const eyeMat = s.eyes && !stone ? K.glow(s.eyes, 2.2) : K.mat("#1a1412");
  const eyes = (y: number, z: number, sep: number, size = 0.03) => {
    for (const sx of [-1, 1]) {
      const e = add(K.box(size, size * 0.8, 0.02, eyeMat, head, sx * sep, y, z));
      if (s.eyes && !stone) glows.push(e);
    }
  };
  const r = 0.15 * h;
  switch (s.head) {
    case "skull": {
      add(K.box(r * 1.5, r * 1.5, r * 1.6, mat(s.skin), head, 0, 0, 0));
      add(K.box(r * 1.1, r * 0.5, r * 1.1, mat(s.bottom), head, 0, -r * 0.85, 0.02));
      eyes(r * 0.15, r * 0.81, r * 0.35, 0.045);
      break;
    }
    case "goblin": case "orc": case "zombie": case "ghoul": case "ogre": case "bugbear": {
      const big = s.head === "ogre" ? 1.25 : s.head === "bugbear" ? 1.15 : 1;
      add(K.ball(r * 2 * big, 4, mat(s.skin), head, 0, 0, 0));
      if (s.head === "goblin") {
        for (const sx of [-1, 1]) {
          const ear = add(K.cyl(0, r * 0.55, r * 1.5, 4, mat(s.skin), head, sx * r * 1.05, r * 0.15, -r * 0.1));
          ear.rotation.z = -sx * 1.25;
        }
        add(K.cyl(0, r * 0.35, r * 0.6, 4, mat(s.skin), head, 0, -r * 0.1, r * 0.95)).rotation.x = Math.PI / 2;
      }
      if (s.head === "orc" || s.head === "ogre") {
        for (const sx of [-1, 1]) add(K.cyl(0, r * 0.22, r * 0.5, 4, K.mat("#f1ead8"), head, sx * r * 0.35, -r * 0.45, r * 0.8));
        if (s.hair) add(K.box(r * 0.5, r * 0.4, r * 1.6, mat(s.hair), head, 0, r * 0.95, -r * 0.1));
      }
      if (s.head === "bugbear") {
        for (const sx of [-1, 1]) add(K.ball(r * 0.6, 2, mat(s.skin), head, sx * r * 0.8, r * 0.75, 0));
        add(K.box(r * 0.9, r * 0.5, r * 0.6, mat("#6a4428"), head, 0, -r * 0.35, r * 0.75));
      }
      if (s.head === "ghoul") {
        add(K.box(r * 1.1, r * 0.35, r * 0.4, K.mat("#3a3230"), head, 0, -r * 0.55, r * 0.75));
      }
      eyes(r * 0.15, r * 0.9 * big, r * 0.38 * big, 0.035 * big);
      break;
    }
    case "helm": {
      add(K.ball(r * 2, 4, mat(s.skin), head, 0, 0, 0));
      const dome = add(K.ball(r * 2.25, 4, mat("#aab3bd", true), head, 0, r * 0.12, 0));
      dome.scaling.y = 0.95;
      add(K.cyl(r * 2.3, r * 2.3, r * 0.22, 10, mat("#8a6a3a", true), head, 0, -r * 0.05, 0));
      add(K.box(r * 1.5, r * 0.16, r * 0.3, K.mat("#0b0b0d"), head, 0, r * 0.05, r * 1.0));
      add(K.box(r * 0.18, r * 0.9, r * 0.25, mat("#aab3bd", true), head, 0, -r * 0.35, r * 1.02));
      const plume = add(K.box(r * 0.32, r * 0.7, r * 1.7, mat(s.cape ?? "#7a1f24"), head, 0, r * 1.15, -r * 0.15));
      plume.rotation.x = -0.25;
      break;
    }
    case "hobhelm": {
      add(K.ball(r * 2, 4, mat(s.skin), head, 0, 0, 0));
      add(K.cyl(r * 1.4, r * 2.2, r * 1.3, 6, mat("#7d8590", true), head, 0, r * 0.45, 0));
      add(K.cyl(0, r * 0.3, r * 0.9, 4, mat("#7d8590", true), head, 0, r * 1.4, 0));
      eyes(0, r * 0.95, r * 0.35);
      break;
    }
    case "hood": {
      add(K.ball(r * 1.9, 3, mat(s.skin), head, 0, -r * 0.05, 0));
      add(K.cyl(r * 0.3, r * 2.5, r * 2.4, 7, mat(s.hair ?? s.top), head, 0, r * 0.35, -r * 0.1));
      // Mask across the lower face.
      add(K.box(r * 1.5, r * 0.55, 0.02, mat("#1a1a1a"), head, 0, -r * 0.35, r * 0.92));
      eyes(r * 0.15, r * 0.93, r * 0.33);
      break;
    }
    case "wizard": {
      add(K.ball(r * 2, 4, mat(s.skin), head, 0, 0, 0));
      add(K.cyl(r * 3.6, r * 3.6, r * 0.18, 10, mat(s.top), head, 0, r * 0.6, 0));
      const hat = add(K.cyl(0, r * 2.1, r * 3.2, 7, mat(s.top), head, 0, r * 2.2, -r * 0.2));
      hat.rotation.x = -0.25;
      add(K.cyl(r * 2.12, r * 2.12, r * 0.25, 7, mat(s.trim ?? "#d9b34a"), head, 0, r * 0.8, 0));
      // Beard.
      add(K.cyl(r * 1.2, 0, r * 1.6, 5, mat(s.hair ?? "#ccc"), head, 0, -r * 1.0, r * 0.55)).rotation.x = 0.35;
      eyes(r * 0.1, r * 0.95, r * 0.35);
      break;
    }
    case "crown": {
      add(K.ball(r * 2, 4, mat(s.skin), head, 0, 0, 0));
      add(K.cyl(r * 2.1, r * 2.3, r * 1.4, 8, mat(s.top, true), head, 0, r * 0.2, 0));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const spike = add(K.cyl(0, r * 0.35, r * 1.0, 4, K.mat("#8a6a3a", { spec: 0.7, emissive: "#ff5a1a", emissiveScale: 0.35 }), head, Math.sin(a) * r * 1.05, r * 1.25, Math.cos(a) * r * 1.05));
        spike.rotation.z = Math.sin(a) * 0.2;
      }
      add(K.box(r * 1.6, r * 0.22, 0.02, K.mat("#050505"), head, 0, r * 0.1, r * 1.06));
      eyes(r * 0.1, r * 1.08, r * 0.36, 0.05);
      break;
    }
    case "hair": default: {
      add(K.ball(r * 2, 4, mat(s.skin), head, 0, 0, 0));
      add(K.ball(r * 2.1, 3, mat(s.hair ?? "#3a2414"), head, 0, r * 0.35, -r * 0.2));
      eyes(r * 0.1, r * 0.95, r * 0.35);
      break;
    }
  }
  void w;
}

function buildWeapon(K: Kit, wpn: Weapon, hand: TransformNode, mat: MatFn, add: AddFn, glows: Mesh[], h: number, stone: boolean): void {
  if (!wpn) return;
  const steel = mat("#c9d1d9", true);
  const wood = mat("#6b4a2b");
  const grip = K.node("grip", hand);
  // Weapons point forward and up from the fist.
  grip.rotation.x = Math.PI / 2 - 0.5;
  switch (wpn) {
    case "sword": case "longsword": {
      const L = wpn === "longsword" ? 0.62 : 0.55;
      add(K.box(0.05, L * h, 0.018, steel, grip, 0, (L * h) / 2 + 0.05, 0));
      add(K.box(0.16, 0.025, 0.04, mat("#8a6a3a", true), grip, 0, 0.05, 0));
      add(K.box(0.03, 0.1, 0.03, wood, grip, 0, 0, 0));
      break;
    }
    case "scimitar": {
      const b = add(K.box(0.06, 0.4 * h, 0.015, steel, grip, 0.02, 0.22 * h, 0));
      b.rotation.z = -0.15;
      add(K.box(0.03, 0.09, 0.03, wood, grip, 0, 0, 0));
      break;
    }
    case "dagger": {
      add(K.box(0.04, 0.22, 0.015, steel, grip, 0, 0.15, 0));
      add(K.box(0.03, 0.08, 0.03, mat("#2a2a2a"), grip, 0, 0, 0));
      break;
    }
    case "staff": {
      grip.rotation.x = 0.05;
      add(K.cyl(0.04, 0.05, 1.05 * h, 6, wood, grip, 0, 0.25 * h, 0));
      const orb = add(K.ball(0.13, 3, stone ? mat("#888") : K.glow("#7fd8ff", 1.8), grip, 0, 0.82 * h, 0));
      if (!stone) glows.push(orb);
      for (let k = 0; k < 3; k++) {
        const prong = add(K.box(0.02, 0.16, 0.02, mat("#8a6a3a", true), grip, Math.sin(k * 2.1) * 0.06, 0.74 * h, Math.cos(k * 2.1) * 0.06));
        prong.rotation.z = Math.sin(k * 2.1) * 0.4;
      }
      break;
    }
    case "mace": {
      add(K.cyl(0.035, 0.035, 0.38 * h, 6, wood, grip, 0, 0.17 * h, 0));
      add(K.ball(0.14, 2, steel, grip, 0, 0.38 * h, 0));
      for (let k = 0; k < 4; k++) add(K.box(0.03, 0.1, 0.16, steel, grip, 0, 0.38 * h, 0)).rotation.y = (k * Math.PI) / 4;
      break;
    }
    case "axe": {
      add(K.cyl(0.04, 0.045, 0.75 * h, 6, wood, grip, 0, 0.3 * h, 0));
      const head = add(K.cyl(0.3, 0.3, 0.03, 3, steel, grip, 0.1, 0.6 * h, 0));
      head.rotation.x = Math.PI / 2;
      head.rotation.y = Math.PI / 2;
      break;
    }
    case "club": {
      add(K.cyl(0.18, 0.06, 0.7 * h, 6, wood, grip, 0, 0.32 * h, 0));
      for (let k = 0; k < 4; k++) add(K.rock(0.035, 1, mat("#555"), grip, Math.sin(k) * 0.08, 0.5 * h + k * 0.04, Math.cos(k) * 0.08));
      break;
    }
    case "morningstar": {
      add(K.cyl(0.04, 0.04, 0.5 * h, 6, wood, grip, 0, 0.22 * h, 0));
      add(K.ball(0.18, 2, steel, grip, 0, 0.5 * h, 0));
      for (let k = 0; k < 6; k++) {
        const sp = add(K.cyl(0, 0.04, 0.12, 4, steel, grip, Math.sin(k) * 0.1, 0.5 * h + Math.cos(k * 1.3) * 0.08, Math.cos(k) * 0.1));
        sp.rotation.z = k;
      }
      break;
    }
    case "emberblade": {
      const blade = add(K.box(0.07, 0.7 * h, 0.02, K.glow("#ff6a1a", 2.2), grip, 0, 0.38 * h, 0));
      glows.push(blade);
      add(K.box(0.2, 0.03, 0.05, mat("#3a2a20", true), grip, 0, 0.04, 0));
      add(K.box(0.035, 0.1, 0.035, mat("#1a1414"), grip, 0, 0, 0));
      break;
    }
    case "claws": {
      for (let k = -1; k <= 1; k++) add(K.cyl(0, 0.03, 0.16, 4, K.mat("#2a2622"), grip, k * 0.03, 0.08, 0));
      break;
    }
  }
}

function buildOffhand(K: Kit, s: Spec, hand: TransformNode, mat: MatFn, add: AddFn, glows: Mesh[], h: number): void {
  switch (s.offhand) {
    case "shield": {
      const sh = K.node("shield", hand, -0.04, 0.08, 0.06);
      sh.rotation.y = -Math.PI / 2 + 0.2;
      add(K.cyl(0.42 * h, 0.42 * h, 0.04, 8, mat(s.shield ?? "#555", true), sh, 0, 0, 0)).rotation.z = Math.PI / 2;
      add(K.cyl(0.32 * h, 0.32 * h, 0.05, 8, mat(s.emblem ?? "#888", true), sh, -0.012, 0, 0)).rotation.z = Math.PI / 2;
      add(K.cyl(0.22 * h, 0.22 * h, 0.055, 8, mat(s.shield ?? "#555", true), sh, -0.016, 0, 0)).rotation.z = Math.PI / 2;
      break;
    }
    case "dagger": {
      const g = K.node("grip", hand);
      g.rotation.x = Math.PI / 2 - 0.5;
      add(K.box(0.04, 0.2, 0.015, mat("#c9d1d9", true), g, 0, 0.14, 0));
      break;
    }
    case "bow": {
      const g = K.node("bow", hand, 0, 0, 0.05);
      g.rotation.x = 0.2;
      const wood = mat("#5a3a20");
      for (const sy of [-1, 1]) {
        const limb = add(K.box(0.03, 0.34 * h, 0.03, wood, g, 0, sy * 0.15 * h, -0.05));
        limb.rotation.x = sy * 0.35;
      }
      add(K.box(0.006, 0.6 * h, 0.006, K.mat("#e8e0cc"), g, 0, 0, -0.13));
      break;
    }
    case "holy": {
      const orb = add(K.ball(0.1, 2, K.glow("#ffd76a", 1.8), hand, 0, 0, 0.05));
      glows.push(orb);
      break;
    }
  }
}

function buildRat(K: Kit): Rig {
  const root = K.node("rat", null);
  const body = K.node("body", root, 0, 0.17, 0);
  const meshes: AbstractMesh[] = [];
  const glows: Mesh[] = [];
  const fur = K.mat("#5e5048");
  const pink = K.mat("#c98a84");
  const add = <T extends AbstractMesh>(m: T): T => { meshes.push(m); return m; };
  const torso = add(K.ball(0.3, 3, fur, body, 0, 0, 0));
  torso.scaling.set(1, 0.85, 1.7);
  const head = K.node("head", body, 0, 0.04, 0.27);
  add(K.cyl(0, 0.17, 0.26, 5, fur, head, 0, 0, 0.06)).rotation.x = Math.PI / 2;
  add(K.ball(0.04, 2, pink, head, 0, -0.01, 0.2));
  for (const sx of [-1, 1]) {
    add(K.ball(0.09, 2, pink, head, sx * 0.07, 0.08, -0.02)).scaling.set(1, 1, 0.4);
    const e = add(K.ball(0.035, 2, K.glow("#ff3a2a", 2.4), head, sx * 0.055, 0.04, 0.07));
    glows.push(e);
  }
  const tail = add(K.cyl(0.012, 0.04, 0.5, 4, pink, body, 0, -0.02, -0.45));
  tail.rotation.x = Math.PI / 2 + 0.25;
  const legL = K.node("legL", root, -0.08, 0.1, 0.12);
  const legR = K.node("legR", root, 0.08, 0.1, -0.12);
  const armL = K.node("armL", root, -0.08, 0.1, -0.12);
  const armR = K.node("armR", root, 0.08, 0.1, 0.12);
  for (const l of [legL, legR, armL, armR]) add(K.box(0.05, 0.12, 0.06, pink, l, 0, -0.05, 0));
  root.scaling.setAll(1.25);
  return { root, body, head, armR, armL, legL, legR, meshes, height: 0.45, hipY: 0.17, quad: true, glows };
}
