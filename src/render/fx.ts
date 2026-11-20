import { Color3, Color4, Mesh, MeshBuilder, ParticleSystem, StandardMaterial, Vector3, type Texture } from "./babylon";
import type { Kit } from "./kit";
import type { Stage } from "./stage";
import { ease, type Tweens } from "./tween";

export interface BurstOpts {
  color: string;
  color2?: string;
  count?: number;
  power?: number;
  size?: number;
  life?: number;
  gravity?: number;
  spread?: number;
  up?: number;
  box?: number;
}

/** Spell and combat effects: particles, projectiles, flashes. */
export class Fx {
  private flashT = 0;
  private flashMax = 0;

  constructor(readonly stage: Stage, readonly kit: Kit, readonly dot: Texture, readonly tweens: Tweens) {
    stage.scene.onBeforeRenderObservable.add(() => {
      if (this.flashT > 0) {
        this.flashT = Math.max(0, this.flashT - stage.engine.getDeltaTime() / 1000);
        stage.fxLight.intensity = this.flashMax * (this.flashT / 0.5);
      }
    });
  }

  burst(at: Vector3, o: BurstOpts): void {
    const scene = this.stage.scene;
    const count = o.count ?? 40;
    const ps = new ParticleSystem("burst", count, scene);
    ps.particleTexture = this.dot;
    ps.emitter = at.clone();
    const b = o.box ?? 0.1;
    ps.minEmitBox = new Vector3(-b, -b * 0.5, -b);
    ps.maxEmitBox = new Vector3(b, b * 0.5, b);
    const c1 = Color3.FromHexString(o.color);
    const c2 = Color3.FromHexString(o.color2 ?? o.color);
    ps.color1 = new Color4(c1.r, c1.g, c1.b, 1);
    ps.color2 = new Color4(c2.r, c2.g, c2.b, 1);
    ps.colorDead = new Color4(c1.r * 0.3, c1.g * 0.2, c1.b * 0.2, 0);
    const size = o.size ?? 0.12;
    ps.minSize = size * 0.5;
    ps.maxSize = size * 1.3;
    const life = o.life ?? 0.6;
    ps.minLifeTime = life * 0.5;
    ps.maxLifeTime = life;
    const sp = o.spread ?? 1;
    const up = o.up ?? 0.6;
    ps.direction1 = new Vector3(-sp, up - 0.2, -sp);
    ps.direction2 = new Vector3(sp, up + 0.8, sp);
    const pw = o.power ?? 2.5;
    ps.minEmitPower = pw * 0.4;
    ps.maxEmitPower = pw;
    ps.gravity = new Vector3(0, o.gravity ?? -4, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.manualEmitCount = count;
    ps.disposeOnStop = true;
    ps.targetStopDuration = life + 0.2;
    ps.start();
  }

  light(at: Vector3, color: string, intensity = 2.2, range = 8): void {
    const l = this.stage.fxLight;
    l.position.copyFrom(at);
    l.diffuse = Color3.FromHexString(color);
    l.range = range;
    this.flashMax = intensity;
    this.flashT = 0.5;
    l.intensity = intensity;
  }

  /** A glowing ball that flies from a to b, with a particle trail. */
  async bolt(from: Vector3, to: Vector3, color: string, size = 0.22, speed = 14, arc = 0.4): Promise<void> {
    const scene = this.stage.scene;
    const orb = MeshBuilder.CreateSphere("bolt", { diameter: size, segments: 6 }, scene);
    orb.material = this.kit.glow(color, 1.25);
    orb.isPickable = false;
    orb.position.copyFrom(from);
    const trail = new ParticleSystem("trail", 120, scene);
    trail.particleTexture = this.dot;
    trail.emitter = orb;
    const c = Color3.FromHexString(color);
    trail.color1 = new Color4(c.r, c.g, c.b, 1);
    trail.color2 = new Color4(Math.min(1, c.r * 1.2), Math.min(1, c.g * 1.1), c.b, 0.7);
    trail.colorDead = new Color4(c.r * 0.2, c.g * 0.1, c.b * 0.1, 0);
    trail.minSize = size * 0.4;
    trail.maxSize = size * 0.9;
    trail.minLifeTime = 0.15;
    trail.maxLifeTime = 0.35;
    trail.emitRate = 160;
    trail.minEmitPower = 0.1;
    trail.maxEmitPower = 0.4;
    trail.blendMode = ParticleSystem.BLENDMODE_ADD;
    trail.start();
    const dist = Vector3.Distance(from, to);
    const l = this.stage.fxLight;
    l.diffuse = c;
    l.range = 6;
    await this.tweens.add(Math.max(0.12, dist / speed), (k) => {
      Vector3.LerpToRef(from, to, k, orb.position);
      orb.position.y += Math.sin(k * Math.PI) * arc;
      l.position.copyFrom(orb.position);
      l.intensity = 1.4;
    });
    l.intensity = 0;
    orb.dispose();
    trail.stop();
    trail.disposeOnStop = true;
  }

  /** A physical projectile (arrow or dagger) that flies point-first. */
  async missile(from: Vector3, to: Vector3, kind: "arrow" | "dagger"): Promise<void> {
    const scene = this.stage.scene;
    const K = this.kit;
    const root = K.node("missile", null);
    if (kind === "arrow") {
      K.box(0.025, 0.025, 0.6, K.mat("#6b4a2b"), root, 0, 0, 0);
      K.cyl(0, 0.06, 0.1, 4, K.mat("#b8bec6", { spec: 0.6 }), root, 0, 0, 0.32).rotation.x = Math.PI / 2;
      K.box(0.08, 0.005, 0.12, K.mat("#d8d0c0"), root, 0, 0, -0.26);
    } else {
      const blade = K.box(0.05, 0.015, 0.25, K.mat("#d0d8e0", { spec: 0.8 }), root, 0, 0, 0.05);
      blade.rotation.z = 0.3;
      K.box(0.03, 0.03, 0.1, K.mat("#222"), root, 0, 0, -0.12);
    }
    root.position.copyFrom(from);
    const dir = to.subtract(from);
    root.rotation.y = Math.atan2(dir.x, dir.z);
    const dist = dir.length();
    await this.tweens.add(Math.max(0.1, dist / 18), (k) => {
      Vector3.LerpToRef(from, to, k, root.position);
      root.position.y += Math.sin(k * Math.PI) * dist * 0.04;
      if (kind === "dagger") root.rotation.x = k * 14;
    });
    root.dispose();
    void scene;
  }

  /** Crescent swoosh in front of an attacker. */
  slash(at: Vector3, facing: Vector3, color = "#ffffff"): void {
    const scene = this.stage.scene;
    const arc = MeshBuilder.CreateTorus("slash", { diameter: 0.9, thickness: 0.05, tessellation: 24 }, scene);
    const m = new StandardMaterial("slashm", scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color);
    m.alpha = 0.9;
    m.fogEnabled = false;
    arc.material = m;
    arc.isPickable = false;
    arc.position.copyFrom(at);
    arc.rotation.y = Math.atan2(facing.x, facing.z);
    arc.rotation.z = 0.5;
    arc.scaling.set(1, 1, 0.5);
    void this.tweens.add(0.25, (k) => {
      m.alpha = 0.9 * (1 - k);
      arc.rotation.y += 0.12;
      arc.scaling.x = 1 + k * 0.4;
    }).then(() => { arc.dispose(); m.dispose(); });
  }

  /** Expanding ring on the floor (turn undead, level up, heals). */
  ring(at: Vector3, color: string, radius: number, dur = 0.6): Promise<void> {
    const scene = this.stage.scene;
    const ring = MeshBuilder.CreateTorus("wave", { diameter: 1, thickness: 0.06, tessellation: 40 }, scene);
    const m = new StandardMaterial("wavem", scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color).scale(1.6);
    m.fogEnabled = false;
    ring.material = m;
    ring.isPickable = false;
    ring.position.set(at.x, 0.1, at.z);
    return this.tweens.add(dur, (k) => {
      const s = 0.2 + radius * 2 * ease.out(k);
      ring.scaling.set(s, 1, s);
      m.alpha = 1 - k;
    }).then(() => { ring.dispose(); m.dispose(); });
  }

  /** Vertical beam of light (Sacred Flame, level up). */
  beam(at: Vector3, color: string, height = 4, width = 0.6, dur = 0.7): Promise<void> {
    const scene = this.stage.scene;
    const beam = MeshBuilder.CreateCylinder("beam", { diameterTop: width * 0.6, diameterBottom: width, height, tessellation: 16 }, scene);
    const m = new StandardMaterial("beamm", scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color).scale(1.8);
    m.alpha = 0.7;
    m.fogEnabled = false;
    m.disableDepthWrite = true;
    beam.material = m;
    beam.isPickable = false;
    beam.position.set(at.x, height / 2, at.z);
    return this.tweens.add(dur, (k) => {
      m.alpha = 0.75 * Math.sin(k * Math.PI);
      beam.scaling.x = beam.scaling.z = 1 - k * 0.6;
    }).then(() => { beam.dispose(); m.dispose(); });
  }

  /** Expanding sphere of fire. */
  async explosion(at: Vector3, radius: number, color = "#ff7a2a"): Promise<void> {
    const scene = this.stage.scene;
    const ball = MeshBuilder.CreateSphere("boom", { diameter: 1, segments: 16 }, scene);
    const m = new StandardMaterial("boomm", scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color).scale(0.85);
    m.alpha = 0.5;
    m.fogEnabled = false;
    m.disableDepthWrite = true;
    ball.material = m;
    ball.isPickable = false;
    ball.position.set(at.x, 0.5, at.z);
    this.stage.glow.addExcludedMesh(ball);
    const core = MeshBuilder.CreateSphere("core", { diameter: 1, segments: 12 }, scene);
    const cm = new StandardMaterial("corem", scene);
    cm.disableLighting = true;
    cm.emissiveColor = Color3.FromHexString("#ffc46a");
    cm.alpha = 0.7;
    cm.fogEnabled = false;
    core.material = cm;
    core.isPickable = false;
    core.position.copyFrom(ball.position);
    this.stage.glow.addExcludedMesh(core);
    this.light(at.add(new Vector3(0, 1.5, 0)), color, 3, radius * 4);
    this.stage.addShake(1.2);
    this.burst(at.add(new Vector3(0, 0.4, 0)), { color, color2: "#ffd27a", count: 160, power: 6, size: 0.35, life: 0.9, gravity: 1, spread: 1.2, box: radius * 0.4 });
    this.burst(at.add(new Vector3(0, 0.2, 0)), { color: "#3a2a22", count: 50, power: 2, size: 0.6, life: 1.6, gravity: 0.5, spread: 1, box: radius * 0.5 });
    await this.tweens.add(0.55, (k) => {
      const s = radius * 2.1 * ease.out(k);
      ball.scaling.setAll(Math.max(0.01, s));
      core.scaling.setAll(Math.max(0.01, s * 0.45 * (1 - k * 0.6)));
      m.alpha = 0.5 * (1 - k);
      cm.alpha = 0.7 * (1 - k) ** 2;
    });
    ball.dispose();
    m.dispose();
    core.dispose();
    cm.dispose();
  }

  /** Fan of fire from a caster toward a set of tiles. */
  cone(from: Vector3, tiles: Vector3[], color = "#ff8a3a"): void {
    for (const t of tiles) {
      const d = t.subtract(from);
      this.burst(from.add(d.scale(0.5)).add(new Vector3(0, 0.5, 0)), { color, color2: "#ffd27a", count: 18, power: 1.5, size: 0.28, life: 0.5, gravity: 2, box: 0.4 });
    }
    this.light(from.add(new Vector3(0, 1, 0)), color, 2.5, 6);
  }

  /** Brief flat glowing tile highlights (area spell landing). */
  scorch(tiles: Vector3[], color: string): void {
    const scene = this.stage.scene;
    const m = new StandardMaterial("scorch", scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color);
    m.alpha = 0.5;
    m.fogEnabled = false;
    const meshes: Mesh[] = tiles.map((t) => {
      const g = MeshBuilder.CreateGround("sc", { width: 0.96, height: 0.96 }, scene);
      g.material = m;
      g.position.set(t.x, 0.02, t.z);
      g.isPickable = false;
      return g;
    });
    void this.tweens.add(0.8, (k) => { m.alpha = 0.5 * (1 - k); }).then(() => { meshes.forEach((x) => x.dispose()); m.dispose(); });
  }
}
