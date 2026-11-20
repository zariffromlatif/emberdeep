import {
  ArcRotateCamera, Color3, Color4, DefaultRenderingPipeline, Engine, GlowLayer, HemisphericLight,
  ImageProcessingConfiguration, Matrix, Plane, PointLight, Scene, Vector3,
} from "./babylon";

export type Quality = "low" | "medium" | "high";

/** Capability-based quality guess: small touch screens and weak GPUs start lower. */
export function detectQuality(): Quality {
  const touch = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (touch && small) return cores >= 8 ? "medium" : "low";
  if (cores <= 4) return "medium";
  return "high";
}

/** Engine, scene, camera, lights shared by every depth, and the cinematic post-processing. */
export class Stage {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly ambient: HemisphericLight;
  readonly heroLight: PointLight;
  /** Pool of torch lights moved to the nearest flames each frame (keeps shader count fixed). */
  readonly torchLights: PointLight[] = [];
  /** One light reserved for spell flashes. */
  readonly fxLight: PointLight;
  readonly glow: GlowLayer;
  pipeline: DefaultRenderingPipeline | null = null;
  quality: Quality;
  /** Where the camera wants to look; eased toward each frame. */
  focus = new Vector3(0, 0, 0);
  private targetAlpha: number;
  private shake = 0;
  private shakeT = 0;

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.engine = new Engine(canvas, quality !== "low", { stencil: true, preserveDrawingBuffer: new URLSearchParams(location.search).has("capture"), powerPreference: "high-performance" }, false);
    this.applyResolution();
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = new Color4(0.012, 0.01, 0.016, 1);
    scene.ambientColor = new Color3(0.06, 0.06, 0.08);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.012, 0.01, 0.016);
    scene.fogDensity = 0.035;
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;

    const cam = (this.camera = new ArcRotateCamera("cam", -Math.PI / 4 - Math.PI / 2, 0.86, 13, Vector3.Zero(), scene));
    this.targetAlpha = cam.alpha;
    cam.lowerBetaLimit = cam.upperBetaLimit = 0.86;
    cam.lowerRadiusLimit = 6.5;
    cam.upperRadiusLimit = 22;
    cam.panningSensibility = 0;
    cam.wheelDeltaPercentage = 0.01;
    cam.pinchDeltaPercentage = 0.004;
    cam.angularSensibilityX = 700;
    cam.minZ = 0.3;
    cam.maxZ = 80;
    cam.fov = 0.72;
    cam.inertia = 0.82;
    cam.attachControl(canvas, true);
    // Left-drag rotates around the hero; right-drag too. Taps still go to the game.
    (cam.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [0, 2];

    this.ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
    this.ambient.intensity = 0.55;
    this.ambient.specular = Color3.Black();

    this.heroLight = new PointLight("heroLight", Vector3.Zero(), scene);
    this.heroLight.diffuse = Color3.FromHexString("#ffcf94");
    this.heroLight.specular = Color3.FromHexString("#5a4a38");
    this.heroLight.range = 9;
    this.heroLight.intensity = 1.25;

    const torchCount = quality === "low" ? 3 : quality === "medium" ? 5 : 7;
    for (let i = 0; i < torchCount; i++) {
      const l = new PointLight(`torch${i}`, new Vector3(0, -50, 0), scene);
      l.range = 6.5;
      l.intensity = 0;
      l.specular = new Color3(0.25, 0.18, 0.1);
      this.torchLights.push(l);
    }
    this.fxLight = new PointLight("fxLight", new Vector3(0, -50, 0), scene);
    this.fxLight.range = 8;
    this.fxLight.intensity = 0;

    this.glow = new GlowLayer("glow", scene, { mainTextureRatio: quality === "high" ? 0.5 : 0.25, blurKernelSize: 48 });
    this.glow.intensity = 0.85;

    this.setupPipeline();
    scene.onBeforeRenderObservable.add(() => this.tick());
    window.addEventListener("resize", () => {
      this.applyResolution();
      this.engine.resize();
    });
  }

  get lightCount(): number {
    return 2 + this.torchLights.length + 1;
  }

  private applyResolution(): void {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1;
    this.engine.setHardwareScalingLevel(1 / Math.min(dpr, cap));
  }

  setupPipeline(): void {
    this.pipeline?.dispose();
    const p = (this.pipeline = new DefaultRenderingPipeline("pipe", this.quality !== "low", this.scene, [this.camera]));
    p.fxaaEnabled = true;
    p.bloomEnabled = this.quality !== "low";
    p.bloomThreshold = 0.62;
    p.bloomWeight = 0.42;
    p.bloomKernel = 64;
    p.bloomScale = 0.5;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.35;
    ip.contrast = 1.25;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.6;
    ip.vignetteStretch = 0.35;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    p.grainEnabled = this.quality === "high";
    p.grain.intensity = 7;
    p.grain.animated = true;
    p.chromaticAberrationEnabled = this.quality === "high";
    p.chromaticAberration.aberrationAmount = 12;
    p.chromaticAberration.radialIntensity = 0.8;
    p.sharpenEnabled = this.quality !== "low";
    p.sharpen.edgeAmount = 0.25;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyResolution();
    this.setupPipeline();
  }

  /** Rotate the view by 45° steps (Q/E or the on-screen buttons). */
  rotate(dir: number): void {
    this.targetAlpha += (dir * Math.PI) / 4;
  }

  zoom(delta: number): void {
    const c = this.camera;
    c.radius = Math.min(c.upperRadiusLimit!, Math.max(c.lowerRadiusLimit!, c.radius + delta));
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  private tick(): void {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const cam = this.camera;
    // Ease toward the focus point and any keyboard rotation.
    const k = 1 - Math.pow(0.0025, dt);
    const t = cam.target.clone();
    t.x += (this.focus.x - t.x) * k;
    t.y += (this.focus.y - t.y) * k;
    t.z += (this.focus.z - t.z) * k;
    if (Math.abs(this.targetAlpha - cam.alpha) > 0.0005 && !cam.inertialAlphaOffset) {
      cam.alpha += (this.targetAlpha - cam.alpha) * Math.min(1, dt * 9);
    } else {
      this.targetAlpha = cam.alpha;
    }
    if (this.shake > 0.001) {
      this.shakeT += dt * 60;
      t.x += Math.sin(this.shakeT * 1.7) * this.shake * 0.12;
      t.z += Math.cos(this.shakeT * 2.3) * this.shake * 0.12;
      t.y += Math.sin(this.shakeT * 3.1) * this.shake * 0.06;
      this.shake *= Math.pow(0.02, dt);
    }
    cam.setTarget(t);
  }

  /** Where a screen point lands on the floor plane (y = 0). */
  floorPoint(x: number, y: number): Vector3 | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    const plane = Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up());
    const d = ray.intersectsPlane(plane);
    if (d === null) return null;
    return ray.origin.add(ray.direction.scale(d));
  }

  /** World position to CSS pixels (for floating text and health bars). */
  project(p: Vector3): { x: number; y: number; visible: boolean } {
    const engine = this.engine;
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    const v = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    const scale = this.canvas.clientWidth / w;
    return { x: v.x * scale, y: v.y * scale, visible: v.z > 0 && v.z < 1 };
  }
}
