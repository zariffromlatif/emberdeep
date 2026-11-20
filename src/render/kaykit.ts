import {
  Color3, LoadAssetContainerAsync, Material, PBRMaterial, StandardMaterial, TransformNode,
  type AbstractMesh, type AnimationGroup, type AssetContainer, type Mesh, type Scene, type Texture,
} from "./babylon";
import type { Kit } from "./kit";

/**
 * KayKit character models (CC0, Kay Lousberg — www.kaylousberg.com), trimmed to the
 * clips we play by tools/trim_glb.py. One file can dress several creatures: we choose
 * which weapon/shield meshes to show and tint the shared palette texture.
 */
const BASE = "models/kaykit/";

type File = "Knight" | "Mage" | "Rogue_Hooded" | "Barbarian" | "Skeleton_Warrior" | "Skeleton_Rogue" | "Skeleton_Minion" | "Skeleton_Mage";
type Prop = "Skeleton_Blade" | "Skeleton_Crossbow" | "Skeleton_Staff";

/** Meshes that are optional gear; everything else (body, head...) always shows. */
const GEAR: Record<File, string[]> = {
  Knight: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword", "Knight_Helmet", "Knight_Cape"],
  Mage: ["Spellbook", "Spellbook_open", "1H_Wand", "2H_Staff", "Mage_Hat", "Mage_Cape"],
  Rogue_Hooded: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable", "Rogue_Cape"],
  Barbarian: ["1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "2H_Axe", "Mug", "Barbarian_Hat", "Barbarian_Cape"],
  Skeleton_Warrior: ["Skeleton_Warrior_Helmet", "Skeleton_Warrior_Cloak"],
  Skeleton_Rogue: ["Skeleton_Rogue_Hood", "Skeleton_Rogue_Cape"],
  Skeleton_Minion: ["Skeleton_Minion_Cloak"],
  Skeleton_Mage: ["Skeleton_Mage_Hat"],
};

export interface KaySpec {
  file: File;
  show: string[];
  /** Model height in tiles. */
  height: number;
  /** Multiplies the palette texture (palette swaps: goblins, orcs...). */
  tint?: string;
  /** Glow colour for skeleton eyes. */
  eyes?: string;
  /** Extra weapon model attached to the right hand. */
  prop?: Prop;
  /** Code-built weapon attached to the right hand (the Cleric's mace). */
  mace?: boolean;
  idle: string;
  walk: string;
  melee: string;
  ranged?: string;
  shield?: boolean;
  death: string;
}

const HERO_IDLE = "Idle";
export const KAY_SPECS: Record<string, KaySpec> = {
  fighter: { file: "Knight", show: ["1H_Sword", "Badge_Shield", "Knight_Helmet", "Knight_Cape"], height: 1.05, idle: HERO_IDLE, walk: "Walking_A", melee: "1H_Melee_Attack_Slice_Diagonal", shield: true, death: "Death_A" },
  cleric: { file: "Knight", show: ["Round_Shield", "Knight_Cape"], height: 1.05, tint: "#fff1dc", mace: true, idle: HERO_IDLE, walk: "Walking_A", melee: "1H_Melee_Attack_Chop", shield: true, death: "Death_A" },
  wizard: { file: "Mage", show: ["2H_Staff", "Mage_Hat", "Mage_Cape"], height: 1.05, idle: HERO_IDLE, walk: "Walking_A", melee: "1H_Melee_Attack_Chop", death: "Death_A" },
  rogue: { file: "Rogue_Hooded", show: ["Knife", "Knife_Offhand", "Rogue_Cape"], height: 1.0, idle: HERO_IDLE, walk: "Walking_A", melee: "Dualwield_Melee_Attack_Stab", ranged: "Throw", death: "Death_A" },

  goblin: { file: "Rogue_Hooded", show: ["Knife"], height: 0.72, tint: "#8fc46a", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Stab", death: "Death_A" },
  goblin_archer: { file: "Rogue_Hooded", show: ["1H_Crossbow", "Rogue_Cape"], height: 0.7, tint: "#9cc070", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Stab", ranged: "1H_Ranged_Shoot", death: "Death_A" },
  hobgoblin: { file: "Knight", show: ["1H_Sword", "Spike_Shield", "Knight_Helmet"], height: 1.0, tint: "#e09a78", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Chop", shield: true, death: "Death_A" },
  orc: { file: "Barbarian", show: ["2H_Axe", "Barbarian_Cape"], height: 1.12, tint: "#86c46e", idle: "Idle", walk: "Walking_A", melee: "2H_Melee_Attack_Chop", death: "Death_A" },
  bugbear: { file: "Barbarian", show: ["1H_Axe", "Barbarian_Hat"], height: 1.25, tint: "#c99a6a", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Chop", death: "Death_A" },
  ogre: { file: "Barbarian", show: ["2H_Axe"], height: 1.7, tint: "#d7bd96", idle: "Idle", walk: "Walking_A", melee: "2H_Melee_Attack_Slice", death: "Death_A" },

  skeleton: { file: "Skeleton_Warrior", show: ["Skeleton_Warrior_Helmet"], height: 1.0, eyes: "#7fe8ff", prop: "Skeleton_Blade", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Slice_Diagonal", death: "Death_C_Skeletons" },
  skeleton_archer: { file: "Skeleton_Rogue", show: ["Skeleton_Rogue_Hood"], height: 1.0, eyes: "#7fe8ff", prop: "Skeleton_Crossbow", idle: "Idle", walk: "Walking_A", melee: "Unarmed_Melee_Attack_Punch_A", ranged: "1H_Ranged_Shoot", death: "Death_C_Skeletons" },
  zombie: { file: "Skeleton_Minion", show: ["Skeleton_Minion_Cloak"], height: 1.0, tint: "#a7c08e", eyes: "#c8ff5a", idle: "Idle", walk: "Walking_D_Skeletons", melee: "Unarmed_Melee_Attack_Punch_A", death: "Death_C_Skeletons" },
  ghoul: { file: "Skeleton_Minion", show: [], height: 0.98, tint: "#d8d2c0", eyes: "#ffe14a", idle: "Idle", walk: "Walking_D_Skeletons", melee: "Unarmed_Melee_Attack_Punch_A", death: "Death_C_Skeletons" },
  wight: { file: "Skeleton_Mage", show: ["Skeleton_Mage_Hat"], height: 1.45, tint: "#ffb08a", eyes: "#ff6a1a", prop: "Skeleton_Staff", idle: "Idle", walk: "Walking_A", melee: "1H_Melee_Attack_Chop", ranged: "Spellcast_Shoot", death: "Death_C_Skeletons" },
};

export interface KayBody {
  root: TransformNode;
  meshes: AbstractMesh[];
  glows: Mesh[];
  height: number;
  spec: KaySpec;
  groups: Map<string, AnimationGroup>;
}

/** Loads each KayKit file once and hands out independent, animated copies. */
export class KayKitLibrary {
  private files = new Map<string, Promise<AssetContainer | null>>();
  private ready = new Map<string, AssetContainer>();
  private nativeHeight = new Map<string, number>();

  constructor(readonly scene: Scene, readonly kit: Kit, readonly maxLights: number) {}

  /** Monster ids (and class ids) we have a KayKit model for. */
  has(def: string): boolean {
    return def in KAY_SPECS;
  }

  isReady(def: string): boolean {
    const s = KAY_SPECS[def];
    return !!s && this.ready.has(s.file) && (!s.prop || this.ready.has(s.prop));
  }

  /** Fetch everything these creatures need. Missing files fall back to code-built models. */
  async preload(defs: Iterable<string>): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const d of new Set(defs)) {
      const s = KAY_SPECS[d];
      if (!s) continue;
      jobs.push(this.load(s.file, `${BASE}${s.file}.glb`));
      if (s.prop) jobs.push(this.load(s.prop, `${BASE}skeleton-weapons/${s.prop}.gltf`));
    }
    await Promise.all(jobs);
  }

  private load(key: string, url: string): Promise<AssetContainer | null> {
    let p = this.files.get(key);
    if (!p) {
      p = LoadAssetContainerAsync(url, this.scene)
        .then((c) => {
          this.prepare(c);
          this.ready.set(key, c);
          return c;
        })
        .catch((err) => {
          console.warn(`KayKit model ${url} failed to load; using the code-built model.`, err);
          return null;
        });
      this.files.set(key, p);
    }
    return p;
  }

  /** Swap glTF PBR materials for the same cheap lit material as the dungeon, so torches read the same. */
  private prepare(c: AssetContainer): void {
    const swap = new Map<string, StandardMaterial>();
    for (const m of c.materials) {
      if (!(m instanceof PBRMaterial)) continue;
      const s = new StandardMaterial(`kk-${m.name}`, this.scene);
      s.diffuseTexture = m.albedoTexture as Texture | null;
      s.diffuseColor = Color3.White();
      s.specularColor = new Color3(0.12, 0.12, 0.12);
      s.specularPower = 32;
      s.maxSimultaneousLights = this.maxLights;
      // glTF is right-handed: cull with counter-clockwise fronts, or we see the insides.
      s.sideOrientation = Material.CounterClockWiseSideOrientation;
      s.backFaceCulling = true;
      // A touch of self-light: torches sit overhead, and dark palettes would go black side-on.
      s.emissiveTexture = s.diffuseTexture;
      s.emissiveColor = new Color3(0.3, 0.28, 0.27);
      swap.set(m.uniqueId.toString(), s);
    }
    for (const mesh of c.meshes) {
      const m = mesh.material;
      if (m && swap.has(m.uniqueId.toString())) mesh.material = swap.get(m.uniqueId.toString())!;
    }
    for (const m of [...c.materials]) if (m instanceof PBRMaterial) { c.materials.splice(c.materials.indexOf(m), 1); m.dispose(); }
    for (const s of swap.values()) c.materials.push(s);
    for (const g of c.animationGroups) g.stop();
  }

  /** A fresh animated copy, or null if the files aren't loaded (caller falls back). */
  create(def: string): KayBody | null {
    const spec = KAY_SPECS[def];
    if (!spec || !this.isReady(def)) return null;
    const c = this.ready.get(spec.file)!;
    const inst = c.instantiateModelsToScene((n) => n, !!spec.tint, { doNotInstantiate: true });
    const root = new TransformNode(`kk-${def}`, this.scene);
    for (const n of inst.rootNodes) n.parent = root;

    const meshes: AbstractMesh[] = [];
    const glows: Mesh[] = [];
    const gear = GEAR[spec.file];
    for (const n of inst.rootNodes) {
      for (const m of n.getChildMeshes(false)) {
        // Multi-material meshes come in as "<name>_primitive0"; judge them by their node name.
        const own = m.name.replace(/_primitive\d+$/, "");
        const parentName = (m.parent?.name ?? "").replace(/_primitive\d+$/, "");
        const base = gear.includes(own) ? own : gear.includes(parentName) ? parentName : own;
        if (gear.includes(base) && !spec.show.includes(base)) {
          m.setEnabled(false);
          continue;
        }
        if (spec.eyes && /_Eyes$/.test(base)) {
          m.material = this.kit.glow(spec.eyes, 2);
          glows.push(m as Mesh);
        } else if (spec.tint && m.material instanceof StandardMaterial) {
          const c = Color3.FromHexString(spec.tint);
          m.material.diffuseColor = c;
          m.material.emissiveColor = c.scale(0.3);
        }
        m.isPickable = true;
        meshes.push(m);
      }
    }

    // Weapons for the empty-handed: KayKit skeleton props, or a code-built mace.
    const hand = root.getDescendants(false).find((n) => n.name === "handslot.r") as TransformNode | undefined;
    if (hand && spec.prop) {
      const pc = this.ready.get(spec.prop);
      const p = pc?.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      for (const r of p?.rootNodes ?? []) {
        for (const m of r.getChildMeshes(false)) {
          m.parent = hand;
          m.position.setAll(0);
          m.rotationQuaternion = null;
          m.rotation.setAll(0);
          m.scaling.setAll(1);
          m.isPickable = true;
          meshes.push(m);
        }
        r.dispose();
      }
    }

    // Normalise height so every model fits the tile grid the same way.
    const key = spec.file;
    if (!this.nativeHeight.has(key)) {
      const { min, max } = root.getHierarchyBoundingVectors(true, (m) => m.isEnabled());
      this.nativeHeight.set(key, Math.max(0.1, max.y - min.y));
    }
    const s = spec.height / this.nativeHeight.get(key)!;
    root.scaling.setAll(s);

    if (hand && spec.mace) {
      const K = this.kit;
      const g = K.node("mace", hand);
      const inv = 1 / s;
      g.scaling.setAll(inv);
      const wood = K.mat("#6b4a2b");
      const steel = K.mat("#d8dde3", { spec: 0.7, specPower: 48 });
      K.cyl(0.035, 0.035, 0.34, 6, wood, g, 0, 0.12, 0);
      K.ball(0.13, 2, steel, g, 0, 0.32, 0);
      for (let k = 0; k < 4; k++) K.box(0.025, 0.09, 0.15, steel, g, 0, 0.32, 0).rotation.y = (k * Math.PI) / 4;
      for (const m of g.getChildMeshes()) { m.isPickable = true; meshes.push(m); }
    }

    const groups = new Map<string, AnimationGroup>();
    for (const g of inst.animationGroups) {
      g.stop();
      g.enableBlending = true;
      g.blendingSpeed = 0.12;
      groups.set(g.name, g);
    }
    return { root, meshes, glows, height: spec.height, spec, groups };
  }
}
