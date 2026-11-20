import { Color3, MeshBuilder, StandardMaterial, Vector3, type AbstractMesh, type AnimationGroup, type Mesh, type Texture, type TransformNode } from "./babylon";
import type { Actor } from "../game/types";
import type { Kit } from "./kit";
import type { KayBody, KayKitLibrary } from "./kaykit";
import { buildModel, type Rig } from "./models";
import type { Stage } from "./stage";
import { ease, type Tweens } from "./tween";

/** Fraction of each one-shot clip at which the blow (or spell) lands. */
const IMPACT = 0.42;

/**
 * One creature on screen: its model, animation, and floor ring.
 * Uses an animated KayKit model when one is loaded, else the code-built rig.
 */
export class ActorView {
  readonly rig: Rig | null;
  readonly body: KayBody | null;
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly glows: Mesh[];
  readonly height: number;
  readonly id: number;
  readonly team: Actor["team"];
  readonly def: string;
  readonly name: string;
  world = new Vector3();
  hp: number;
  maxHp: number;
  dead = false;
  shown = true;
  /** In the turn order (shows its ring). */
  engaged = false;
  active = false;
  targeted = false;
  private facing = 0;
  private targetFacing = 0;
  private walkAmt = 0;
  private walkPhase = Math.random() * 6;
  private seed = Math.random() * 100;
  private ring: Mesh;
  private ringMat: StandardMaterial;
  private hunch = false;
  private restR = 0;
  private restL = 0;
  /** KayKit animation state. */
  private loop: AnimationGroup | null = null;
  private oneShot: AnimationGroup | null = null;
  private speed = 1;

  constructor(readonly kit: Kit, readonly stage: Stage, a: Actor, ringTex: Texture, lib?: KayKitLibrary) {
    this.id = a.id;
    this.team = a.team;
    this.def = a.def;
    this.name = a.name;
    this.hp = a.hp;
    this.maxHp = a.maxHp;
    this.body = lib?.create(a.def) ?? null;
    if (this.body) {
      this.rig = null;
      this.root = this.body.root;
      this.meshes = this.body.meshes;
      this.glows = this.body.glows;
      this.height = this.body.height;
      // Their soft self-light is emissive; keep it out of the bloom glow (eyes still glow).
      for (const m of this.body.meshes) if (!this.body.glows.includes(m as Mesh)) stage.glow.addExcludedMesh(m as Mesh);
      this.playLoop(this.body.spec.idle, Math.random());
    } else {
      const rig = (this.rig = buildModel(kit, a.def));
      this.root = rig.root;
      this.meshes = rig.meshes;
      this.glows = rig.glows;
      this.height = rig.height;
      this.hunch = rig.armR.rotation.x < -1;
      this.restR = rig.armR.rotation.x;
      this.restL = rig.armL.rotation.x;
    }
    for (const m of this.meshes) {
      m.isPickable = true;
      m.metadata = { actorId: a.id };
    }
    this.ringMat = new StandardMaterial(`ring${a.id}`, stage.scene);
    this.ringMat.diffuseTexture = ringTex;
    this.ringMat.opacityTexture = ringTex;
    this.ringMat.disableLighting = true;
    this.ringMat.emissiveColor = a.team === "hero" ? Color3.FromHexString("#ffc861") : Color3.FromHexString("#ff4a3a");
    this.ringMat.fogEnabled = false;
    this.ringMat.disableDepthWrite = true;
    this.ring = MeshBuilder.CreateGround(`ringm${a.id}`, { width: 1, height: 1 }, stage.scene);
    this.ring.material = this.ringMat;
    this.ring.isPickable = false;
    const size = this.height > 1.3 ? 1.5 : this.rig?.quad ? 0.85 : 0.95;
    this.ring.scaling.set(size, 1, size);
    this.setTile(a.pos.x, a.pos.y);
    this.facing = this.targetFacing = Math.random() * Math.PI * 2;
    this.root.rotation.y = this.facing;
  }

  // ------------------------------------------------------------ KayKit clips

  private group(name: string | undefined): AnimationGroup | null {
    return name ? this.body?.groups.get(name) ?? null : null;
  }

  private playLoop(name: string, offset = 0): void {
    const g = this.group(name);
    if (!g || this.loop === g) return;
    if (!this.oneShot) this.loop?.stop();
    this.loop = g;
    if (!this.oneShot) {
      g.start(true, this.speed, g.from + (g.to - g.from) * offset, g.to);
    }
  }

  /** Play a clip once; resolves at `at` (0..1) of its length, then drifts back to the loop. */
  private playOnce(name: string | undefined, tweens: Tweens, at = IMPACT, hold = false): Promise<void> {
    const g = this.group(name);
    if (!g) return Promise.resolve();
    this.speed = tweens.speed;
    this.loop?.stop();
    this.oneShot?.stop();
    this.oneShot = g;
    g.start(false, this.speed);
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    const secs = (g.to - g.from) / fps;
    g.onAnimationGroupEndObservable.addOnce(() => {
      if (this.oneShot !== g) return;
      this.oneShot = null;
      if (hold || this.dead) return;
      this.loop?.start(true, this.speed);
    });
    return tweens.wait(secs * at);
  }

  // ------------------------------------------------------------ placement

  setTile(x: number, y: number): void {
    this.world.set(x, 0, y);
    this.root.position.copyFrom(this.world);
  }

  get headPos(): Vector3 {
    return this.world.add(new Vector3(0, this.height + 0.25, 0));
  }

  get chestPos(): Vector3 {
    return this.world.add(new Vector3(0, this.height * 0.6, 0));
  }

  setShown(v: boolean): void {
    if (this.dead) v = false;
    this.shown = v;
    this.root.setEnabled(v);
    this.ring.setEnabled(v);
  }

  faceToward(p: Vector3): void {
    const dx = p.x - this.world.x, dz = p.z - this.world.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.01) return;
    this.targetFacing = Math.atan2(dx, dz);
  }

  async moveTo(to: Vector3, tweens: Tweens, dur: number): Promise<void> {
    const from = this.world.clone();
    this.faceToward(to);
    this.walkAmt = 1;
    if (this.body) {
      this.speed = tweens.speed;
      this.playLoop(this.body.spec.walk);
    }
    await tweens.add(dur, (k) => {
      Vector3.LerpToRef(from, to, k, this.world);
      this.root.position.copyFrom(this.world);
    });
  }

  stopWalking(): void {
    this.walkAmt = 0;
    if (this.body) this.playLoop(this.body.spec.idle);
  }

  // ------------------------------------------------------------ actions

  /** Wind up, strike, resolve at the moment of impact, then recover in the background. */
  async strike(target: Vector3, tweens: Tweens, ranged: boolean): Promise<void> {
    this.faceToward(target);
    if (this.body) {
      const s = this.body.spec;
      await this.playOnce(ranged ? s.ranged ?? s.melee : s.melee, tweens, ranged ? 0.5 : IMPACT);
      return;
    }
    const r = this.rig!;
    const dir = target.subtract(this.world);
    dir.y = 0;
    dir.normalize();
    const base = this.world.clone();
    if (ranged) {
      await tweens.add(0.16, (k) => { r.armL.rotation.x = this.restL + (-1.5 - this.restL) * ease.out(k); r.armR.rotation.x = this.restR + (-1.6 - this.restR) * ease.out(k); });
      void tweens.add(0.25, (k) => { r.armL.rotation.x = -1.5 + (this.restL + 1.5) * k; r.armR.rotation.x = -1.6 + (this.restR + 1.6) * k; });
      return;
    }
    await tweens.add(0.14, (k) => {
      r.armR.rotation.x = this.restR + (-2.5 - this.restR) * ease.out(k);
      r.body.rotation.x = -0.15 * k;
    });
    await tweens.add(0.09, (k) => {
      r.armR.rotation.x = -2.5 + (0.7 + 2.5) * ease.in(k);
      r.body.rotation.x = -0.15 + 0.35 * k;
      Vector3.LerpToRef(base, base.add(dir.scale(0.28)), ease.out(k), r.root.position);
    });
    void tweens.add(0.25, (k) => {
      r.armR.rotation.x = 0.7 + (this.restR - 0.7) * ease.inOut(k);
      r.body.rotation.x = 0.2 * (1 - k);
      Vector3.LerpToRef(base.add(dir.scale(0.28)), base, ease.inOut(k), r.root.position);
    });
  }

  /** Spellcasting pose. `kind`: a thrown bolt, a long channel, or a raised blessing. */
  async cast(target: Vector3 | null, tweens: Tweens, kind: "shoot" | "long" | "raise" | "summon" = "shoot"): Promise<void> {
    if (target) this.faceToward(target);
    if (this.body) {
      const clip = { shoot: "Spellcast_Shoot", long: "Spellcast_Long", raise: "Spellcast_Raise", summon: "Spellcast_Summon" }[kind];
      await this.playOnce(this.group(clip) ? clip : "Spellcast_Shoot", tweens, kind === "long" ? 0.55 : 0.45);
      return;
    }
    const r = this.rig!;
    await tweens.add(0.22, (k) => {
      r.armR.rotation.x = this.restR + (-2.3 - this.restR) * ease.out(k);
      r.armL.rotation.x = this.restL + (-1.9 - this.restL) * ease.out(k);
    });
    void tweens.add(0.35, (k) => {
      r.armR.rotation.x = -2.3 + (this.restR + 2.3) * ease.inOut(k);
      r.armL.rotation.x = -1.9 + (this.restL + 1.9) * ease.inOut(k);
    });
  }

  /** Short celebratory or utility gesture (potions, chests, victory). */
  gesture(kind: "cheer" | "item" | "interact", tweens: Tweens): void {
    if (!this.body) return;
    void this.playOnce({ cheer: "Cheer", item: "Use_Item", interact: "Interact" }[kind], tweens, 1);
  }

  flash(color: string, tweens: Tweens, strength = 0.75): void {
    const c = Color3.FromHexString(color);
    for (const m of this.meshes) {
      m.overlayColor = c;
      m.renderOverlay = true;
      m.overlayAlpha = strength;
    }
    void tweens.add(0.35, (k) => {
      for (const m of this.meshes) {
        m.overlayAlpha = strength * (1 - k);
        if (k >= 1) m.renderOverlay = false;
      }
    });
  }

  /** Knocked back by a blow from `from`. */
  recoil(from: Vector3, tweens: Tweens): void {
    const dir = this.world.subtract(from);
    dir.y = 0;
    if (dir.lengthSquared() < 0.001) return;
    dir.normalize();
    const base = this.world.clone();
    if (this.body) void this.playOnce(Math.random() < 0.5 ? "Hit_A" : "Hit_B", tweens, 1);
    void tweens.add(0.22, (k) => {
      const push = Math.sin(k * Math.PI) * 0.16;
      this.root.position.set(base.x + dir.x * push, 0, base.z + dir.z * push);
      if (this.rig) this.rig.body.rotation.x = -Math.sin(k * Math.PI) * 0.3;
    });
  }

  /** A blow that missed: block with a shield, or sway out of the way. */
  evade(from: Vector3, tweens: Tweens): void {
    if (this.body) {
      this.faceToward(from);
      void this.playOnce(this.body.spec.shield ? "Block_Hit" : "Dodge_Backward", tweens, 1);
      return;
    }
    this.recoil(this.world.add(this.world.subtract(from)), tweens);
  }

  async die(tweens: Tweens): Promise<void> {
    this.dead = true;
    this.ring.setEnabled(false);
    if (this.body) {
      await this.playOnce(this.body.spec.death, tweens, 1, true);
      await tweens.wait(0.9);
      await tweens.add(0.6, (k) => {
        this.root.position.y = -0.35 * k;
        const s = this.root.scaling.x;
        if (k > 0.5) this.root.scaling.setAll(s * (1 - (k - 0.5) * 0.3));
      });
      this.root.setEnabled(false);
      return;
    }
    const r = this.rig!;
    const side = Math.random() < 0.5 ? -1 : 1;
    await tweens.add(0.45, (k) => {
      const e = ease.in(k);
      r.root.rotation.z = side * 1.45 * e;
      r.root.position.y = 0.08 * e;
    });
    await tweens.wait(0.5);
    await tweens.add(0.5, (k) => {
      r.root.scaling.setAll(Math.max(0.001, 1 - k));
      r.root.position.y = -0.2 * k;
    });
    r.root.setEnabled(false);
  }

  update(dt: number, time: number): void {
    if (this.dead || !this.shown) return;
    // Turn smoothly toward the facing we want.
    let d = this.targetFacing - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * Math.min(1, dt * 12);
    this.root.rotation.y = this.facing;

    if (this.rig) this.animateRig(dt, time, this.rig);

    // Glowing bits breathe.
    for (const g of this.glows) {
      const s = 1 + Math.sin(time * 4 + this.seed) * 0.08;
      g.scaling.set(s, s, s);
    }

    // Ring: shown for combatants; the active one pulses.
    const showRing = this.engaged || this.team === "hero" || this.targeted;
    this.ring.isVisible = showRing;
    this.ring.position.set(this.root.position.x, 0.03, this.root.position.z);
    const pulse = this.active || this.targeted ? 0.75 + Math.sin(time * 6) * 0.25 : 0.55;
    this.ringMat.alpha = pulse;
    this.ring.rotation.y = time * (this.active ? 0.8 : 0.2);
  }

  /** Procedural walk/idle for code-built models. */
  private animateRig(dt: number, time: number, r: Rig): void {
    const walking = this.walkAmt > 0.01;
    if (walking) this.walkPhase += dt * (r.quad ? 22 : 13);
    const swing = Math.sin(this.walkPhase) * this.walkAmt;
    if (r.quad) {
      r.legL.rotation.x = swing * 0.8;
      r.armR.rotation.x = swing * 0.8;
      r.legR.rotation.x = -swing * 0.8;
      r.armL.rotation.x = -swing * 0.8;
      r.body.position.y = r.hipY + Math.abs(swing) * 0.03 + Math.sin(time * 3 + this.seed) * 0.005;
      r.head.rotation.x = Math.sin(time * 7 + this.seed) * 0.08;
    } else {
      r.legL.rotation.x = swing * 0.65;
      r.legR.rotation.x = -swing * 0.65;
      const breathe = Math.sin(time * 2.2 + this.seed);
      r.body.position.y = r.hipY + Math.abs(swing) * 0.03 + breathe * 0.006;
      if (!this.hunch) {
        r.head.rotation.y = Math.sin(time * 0.7 + this.seed) * 0.25 * (1 - this.walkAmt);
      } else {
        r.head.rotation.z = Math.sin(time * 1.3 + this.seed) * 0.15;
      }
    }
  }

  dispose(): void {
    if (this.body) for (const g of this.body.groups.values()) g.dispose();
    this.root.dispose();
    this.ring.dispose();
    this.ringMat.dispose();
  }
}
