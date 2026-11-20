import { PointerEventTypes, Vector3, type Texture } from "@babylonjs/core";
import { Sfx } from "./audio/sfx";
import { dist, type Pt } from "./core/grid";
import { hashSeed } from "./core/rng";
import { generate } from "./dungeon/generate";
import { idx, inBounds } from "./dungeon/map";
import { findPath, pathFromReach } from "./dungeon/path";
import { affectedTiles, blockedReason, findAction, heroActions, useAction, validTarget } from "./game/actions";
import { Game, type SaveData } from "./game/game";
import type { Actor, ClassId, GameEvent, Tone } from "./game/types";
import { ActorView } from "./render/actors";
import { Fx } from "./render/fx";
import { Kit } from "./render/kit";
import { LevelView } from "./render/level";
import { Overlay } from "./render/overlay";
import { Stage, detectQuality } from "./render/stage";
import { brickwork, flagstones, planks, ringTexture, softDot, tileFrame, type Surface } from "./render/textures";
import { Tweens } from "./render/tween";
import { Hud, type HudActor } from "./ui/hud";

const SAVE_KEY = "emberdeep.save.v1";
const TONE_COLOR: Record<Tone, string> = {
  info: "#efe6d6", good: "#8fe39a", bad: "#ff7a6e", crit: "#ffd34d", miss: "#b0b0b0", magic: "#9ab8ff", gold: "#e9c27a", dim: "#8a8070",
};
const DMG_COLOR: Record<string, string> = {
  fire: "#ff8a3d", radiant: "#ffe48a", force: "#b9a4ff", necrotic: "#a070ff", cold: "#8fd8ff", poison: "#9be05a",
};

/** Default attack per class when you tap an enemy with nothing selected. */
const DEFAULT_ATTACK: Record<ClassId, string[]> = {
  fighter: ["attack"],
  rogue: ["attack"],
  wizard: ["fire_bolt", "attack"],
  cleric: ["attack"],
};

export class App {
  readonly stage: Stage;
  readonly kit: Kit;
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly tweens = new Tweens();
  readonly fx: Fx;
  readonly overlay: Overlay;
  private surfaces: { floor: Surface; wall: Surface; planks: Texture; dot: Texture };
  private ringTex: Texture;
  private game: Game | null = null;
  private level: LevelView | null = null;
  private views = new Map<number, ActorView>();
  private seenShown = new Uint8Array(0);
  private busy = false;
  private selected: string | null = null;
  private mode: "title" | "play" | "menu" = "title";
  private time = 0;
  private pendingStairs = false;
  private orbit = 0;
  private lastAttacker = new Map<number, Vector3>();
  private turnId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas, detectQuality());
    this.kit = new Kit(this.stage.scene, this.stage.lightCount);
    const scene = this.stage.scene;
    this.surfaces = {
      floor: flagstones(scene),
      wall: brickwork(scene),
      planks: planks(scene),
      dot: softDot(scene),
    };
    this.ringTex = ringTexture(scene);
    this.fx = new Fx(this.stage, this.kit, this.surfaces.dot, this.tweens);
    this.overlay = new Overlay(scene, tileFrame(scene));
    this.overlay.glowExclude = (m) => this.stage.glow.addExcludedMesh(m);
    this.wireInput(canvas);
    this.wireHud();

    scene.onBeforeRenderObservable.add(() => this.frame());
    this.stage.engine.runRenderLoop(() => scene.render());
  }

  // ------------------------------------------------------------ screens & flow

  showTitle(): void {
    this.mode = "title";
    this.hud.unmountHud();
    this.clearLevel();
    this.game = null;
    // A living backdrop: a random dungeon, fully revealed, slowly orbiting.
    const map = generate(1 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 1e9));
    const level = new LevelView(this.stage, this.kit, map, this.surfaces);
    level.revealAll = true;
    level.setVisibility([], new Uint8Array(map.w * map.h));
    this.level = level;
    const room = [...map.rooms].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    this.stage.focus.set(room.x + room.w / 2, 0, room.y + room.h / 2);
    this.stage.camera.target.copyFrom(this.stage.focus);
    this.stage.camera.radius = 15;
    this.stage.heroLight.position.set(this.stage.focus.x, 2.5, this.stage.focus.z);
    for (const s of map.spawns.slice(0, 14)) {
      const a = { id: -1 - this.views.size, team: "enemy", def: s.monster, name: "", pos: s.pos, hp: 1, maxHp: 1 } as unknown as Actor;
      const v = new ActorView(this.kit, this.stage, a, this.ringTex);
      this.views.set(a.id, v);
    }
    this.hud.title(!!this.loadSave(), {
      newRun: () => { this.sfx.unlock(); this.sfx.click(); this.hud.heroSelect((c) => this.startRun(c), () => this.showTitle()); },
      resume: () => { this.sfx.unlock(); this.sfx.click(); this.resume(); },
      help: () => { this.sfx.unlock(); this.hud.help(() => this.showTitle()); },
    });
  }

  private startRun(cls: ClassId): void {
    this.sfx.unlock();
    this.sfx.click();
    const seed = hashSeed(`${Date.now()}-${Math.random()}`);
    this.game = Game.newRun(cls, seed);
    this.hud.clearLog();
    this.enterFloor();
  }

  private resume(): void {
    const data = this.loadSave();
    if (!data) { this.showTitle(); return; }
    this.game = Game.load(data);
    this.hud.clearLog();
    this.enterFloor();
  }

  private enterFloor(): void {
    const g = this.game!;
    this.hud.hideScreen();
    this.clearLevel();
    this.mode = "play";
    this.level = new LevelView(this.stage, this.kit, g.map, this.surfaces);
    this.seenShown = new Uint8Array(g.map.w * g.map.h);
    for (const a of g.actors) this.addView(a);
    this.applyFov([...g.visible]);
    const hv = this.views.get(g.hero.id)!;
    this.stage.focus.copyFrom(hv.world);
    this.stage.camera.target.copyFrom(hv.world);
    this.stage.camera.radius = 9.5;
    this.hud.mountHud();
    this.hud.banner(g.map.theme.name, g.map.theme.subtitle);
    this.hud.log(`${g.map.theme.subtitle}: ${g.map.theme.name}.`, "gold");
    if (g.depth === 1) this.hud.log("Tap a tile to move. Enemies that see you will fight.", "dim");
    this.sfx.ambience(true);
    this.save();
    this.refresh();
  }

  private clearLevel(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.level?.dispose();
    this.level = null;
    this.overlay.clear();
    this.hud.closePrompt();
  }

  private addView(a: Actor): ActorView {
    const v = new ActorView(this.kit, this.stage, a, this.ringTex);
    this.views.set(a.id, v);
    if (a.dead) { v.dead = true; v.setShown(false); }
    return v;
  }

  private campfire(): void {
    const g = this.game!;
    this.mode = "menu";
    this.sfx.ambience(false);
    this.hud.unmountHud();
    const h = g.hero;
    const before = { hp: h.hp, slots: h.slots };
    // Rest is applied when the next floor starts; describe it now.
    const healed = h.maxHp - before.hp;
    const recovered = `A long rest by the fire. ${healed > 0 ? `You recover ${healed} HP` : "You are already whole"}${h.slotsMax ? ", and all your spell slots" : ""}. Your class features are ready again.`;
    this.saveRaw({ ...g.toSave(), depth: g.depth + 1 });
    this.hud.campfire(g, {
      buy: (id) => {
        if (g.buy(id)) { this.sfx.coin(); this.saveRaw({ ...g.toSave(), depth: g.depth + 1 }); }
      },
      descend: () => {
        this.sfx.click();
        g.startFloor(g.depth + 1);
        this.enterFloor();
      },
    }, recovered);
  }

  private gameOver(win: boolean): void {
    this.mode = "menu";
    this.clearSave();
    this.sfx.ambience(false);
    if (win) this.sfx.victory(); else this.sfx.defeat();
    const g = this.game!;
    setTimeout(() => {
      this.hud.unmountHud();
      this.hud.results(win, g, () => this.hud.heroSelect((c) => this.startRun(c), () => this.showTitle()), () => this.showTitle());
    }, win ? 1800 : 1400);
  }

  // ------------------------------------------------------------ save

  private save(): void {
    if (!this.game || this.game.over) return;
    this.saveRaw(this.game.toSave());
  }

  private saveRaw(d: SaveData): void {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* private mode: no saves */ }
  }

  private loadSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const d = raw ? (JSON.parse(raw) as SaveData) : null;
      return d && d.version === 1 ? d : null;
    } catch {
      return null;
    }
  }

  private clearSave(): void {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ playback

  private async run(events: GameEvent[]): Promise<void> {
    if (!events.length) { this.refresh(); return; }
    this.busy = true;
    this.overlay.clear();
    this.hud.hideTip();
    for (let i = 0; i < events.length; i++) {
      // One broken effect must never stall the turn: log it and keep playing.
      try {
        await this.playEvent(events[i], events[i + 1]);
      } catch (err) {
        console.error(err);
      }
    }
    this.busy = false;
    for (const v of this.views.values()) v.stopWalking();
    const g = this.game;
    if (!g) return;
    if (g.over) {
      this.gameOver(g.over === "victory");
      return;
    }
    if (this.pendingStairs && g.canDescend()) {
      this.pendingStairs = false;
      this.hud.prompt(`${"The stairs spiral down into the dark."}`, [
        { label: "Descend", primary: true, run: () => this.campfire() },
        { label: "Not yet", run: () => {} },
      ]);
    }
    this.pendingStairs = false;
    if (!g.inCombat) this.save();
    this.refresh();
  }

  private world(p: Pt): Vector3 {
    return new Vector3(p.x, 0, p.y);
  }

  private shownTile(p: Pt): boolean {
    const g = this.game!;
    return this.level!.isVisibleTile(idx(g.map, p.x, p.y));
  }

  private applyFov(visible: number[]): void {
    for (const i of visible) this.seenShown[i] = 1;
    this.level!.setVisibility(visible, this.seenShown);
    const g = this.game!;
    for (const v of this.views.values()) {
      if (v.team === "hero" || v.dead) continue;
      const vis = this.level!.isVisibleTile(idx(g.map, Math.round(v.world.x), Math.round(v.world.z)));
      v.setShown(vis);
    }
  }

  private anchorFor(v: ActorView, lift = 0) {
    return () => (v ? this.stage.project(v.headPos.add(new Vector3(0, lift, 0))) : null);
  }

  private floatAt(v: ActorView | undefined, html: string, cls: string, color?: string): void {
    if (!v || (!v.shown && v.team !== "hero")) return;
    this.hud.float(this.anchorFor(v, 0.15 + Math.random() * 0.2), html, cls, color);
  }

  private async playEvent(e: GameEvent, next?: GameEvent): Promise<void> {
    const g = this.game!;
    const t = this.tweens;
    switch (e.t) {
      case "move": {
        const v = this.views.get(e.id);
        if (!v) return;
        const visible = e.id === g.hero.id || this.shownTile(e.from) || this.shownTile(e.to);
        if (!visible) { v.setTile(e.to.x, e.to.y); v.setShown(false); return; }
        if (v.team !== "hero") v.setShown(true);
        this.sfx.step();
        await v.moveTo(this.world(e.to), t, e.id === g.hero.id ? 0.17 : 0.15);
        if (!(next?.t === "move" && next.id === e.id)) v.stopWalking();
        if (v.team !== "hero") v.setShown(this.shownTile(e.to));
        return;
      }
      case "teleport": {
        const v = this.views.get(e.id)!;
        this.fx.burst(v.chestPos, { color: "#cfd8ff", color2: "#ffffff", count: 50, power: 1.5, size: 0.25, life: 0.8, gravity: 0.5 });
        this.sfx.magic();
        await t.add(0.2, (k) => v.rig.root.scaling.setAll(1 - k * 0.95));
        v.setTile(e.to.x, e.to.y);
        await t.add(0.2, (k) => v.rig.root.scaling.setAll(0.05 + k * 0.95));
        this.fx.burst(v.chestPos, { color: "#cfd8ff", color2: "#ffffff", count: 50, power: 1.5, size: 0.25, life: 0.8, gravity: 0.5 });
        return;
      }
      case "fov":
        this.applyFov(e.visible);
        return;
      case "door":
        this.level!.openDoor(e.at.x, e.at.y);
        this.sfx.door();
        return;
      case "combatStart": {
        for (const id of e.order) { const v = this.views.get(id); if (v) v.engaged = true; }
        this.hud.banner("Roll Initiative", "Combat", "red");
        this.sfx.initiative();
        this.stage.addShake(0.4);
        for (const id of e.surprised) this.floatAt(this.views.get(id), "Surprised!", "small", TONE_COLOR.gold);
        this.refreshOrder();
        await t.wait(1.0);
        return;
      }
      case "joinCombat":
        for (const id of e.order) { const v = this.views.get(id); if (v) v.engaged = true; }
        this.refreshOrder();
        return;
      case "turn": {
        this.turnId = e.id;
        for (const v of this.views.values()) v.active = v.id === e.id;
        this.refreshOrder();
        const v = this.views.get(e.id);
        if (e.id === g.hero.id) { this.refresh(); return; }
        if (v?.shown) await t.wait(0.12);
        return;
      }
      case "attack": {
        const a = this.views.get(e.attacker), d = this.views.get(e.target);
        if (!a || !d) return;
        const visible = a.shown || d.shown || a.team === "hero";
        if (!visible) return;
        this.lastAttacker.set(e.target, a.world.clone());
        this.hud.dice(e.roll, e.hit);
        this.sfx.dice();
        const spellFx: Record<string, string> = { firebolt: "#ff7a2a", guiding: "#fff2b0", cinder: "#ff5a1a" };
        if (spellFx[e.fx]) {
          await a.cast(d.world, t);
          this.sfx.fire();
          await this.fx.bolt(a.chestPos.add(new Vector3(0, 0.2, 0)), e.hit ? d.chestPos : d.chestPos.add(new Vector3(0.6, 0.5, 0.4)), spellFx[e.fx], e.fx === "guiding" ? 0.28 : 0.22);
          if (e.hit) this.fx.burst(d.chestPos, { color: spellFx[e.fx], color2: "#ffd27a", count: 40, power: 3, size: 0.18 });
        } else if (e.fx === "arrow" || e.fx === "dagger") {
          await a.strike(d.world, t, true);
          this.sfx.arrow();
          await this.fx.missile(a.chestPos, e.hit ? d.chestPos : d.chestPos.add(new Vector3(0.7, 0.3, -0.5)), e.fx);
        } else {
          this.sfx.swing();
          await a.strike(d.world, t, false);
          const dir = d.world.subtract(a.world);
          this.fx.slash(a.world.add(dir.scale(0.45)).add(new Vector3(0, a.rig.height * 0.6, 0)), dir, e.fx === "drain" ? "#a070ff" : e.crit ? "#ffd34d" : "#ffffff");
        }
        if (!e.hit) {
          this.sfx.miss();
          if (d.shown) d.recoil(a.world.add(d.world.subtract(a.world).scale(2)), t);
        } else if (e.crit) {
          this.sfx.crit();
          this.stage.addShake(0.9);
        }
        return;
      }
      case "save": {
        const v = this.views.get(e.target);
        if (v?.shown || e.target === g.hero.id) {
          this.hud.dice(e.roll, e.success, true);
          this.sfx.dice();
          this.floatAt(v, e.success ? `${e.roll.label}: saved` : `${e.roll.label}: failed`, "small", e.success ? TONE_COLOR.miss : TONE_COLOR.gold);
          await t.wait(0.25);
        }
        return;
      }
      case "damage": {
        const v = this.views.get(e.target);
        if (!v) return;
        v.hp = e.hpAfter;
        if (!v.shown && v.team !== "hero") return;
        const color = DMG_COLOR[e.type] ?? (v.team === "hero" ? "#ff6a5a" : "#ffffff");
        v.flash(v.team === "hero" ? "#ff2a2a" : "#ffffff", t, e.crit ? 0.95 : 0.7);
        const from = this.lastAttacker.get(e.target);
        if (from) v.recoil(from, t);
        this.fx.burst(v.chestPos, { color: DMG_COLOR[e.type] ?? (v.def.startsWith("skeleton") ? "#e8e0cc" : "#ffb070"), color2: "#ffffff", count: e.crit ? 50 : 24, power: 2.5, size: 0.1, life: 0.45 });
        const note = e.note ? `<span class="note">${e.note}</span>` : "";
        this.floatAt(v, `${e.amount}${note}`, e.crit ? "crit" : "", e.crit ? undefined : color);
        this.sfx.hit(e.amount >= 10);
        if (v.team === "hero") {
          this.hud.hurt();
          this.stage.addShake(e.crit ? 1.1 : 0.5);
        }
        this.refreshOrder();
        if (v.team === "hero") this.refresh();
        await t.wait(0.18);
        return;
      }
      case "heal": {
        const v = this.views.get(e.target);
        if (!v) return;
        v.hp = e.hpAfter;
        if (e.amount > 0 && (v.shown || v.team === "hero")) {
          this.floatAt(v, `+${e.amount}`, "", "#8fe39a");
          this.fx.burst(v.world.add(new Vector3(0, 0.3, 0)), { color: "#8fe39a", color2: "#ffe48a", count: 30, power: 1.2, size: 0.12, life: 1, gravity: 1.5, box: 0.3 });
        }
        if (v.team === "hero") this.refresh();
        this.refreshOrder();
        return;
      }
      case "death": {
        const v = this.views.get(e.id);
        if (!v) return;
        this.sfx.death();
        if (v.shown || v.team === "hero") {
          this.fx.burst(v.chestPos, { color: "#6a5a4a", color2: "#2a2420", count: 30, power: 1, size: 0.35, life: 1.2, gravity: 0.2 });
          void v.die(t);
          await t.wait(0.35);
        } else {
          v.dead = true;
          v.setShown(false);
        }
        this.refreshOrder();
        return;
      }
      case "spell":
        await this.playSpell(e);
        return;
      case "float": {
        this.floatAt(this.views.get(e.id), e.text, "small", TONE_COLOR[e.tone]);
        return;
      }
      case "log":
        this.hud.log(e.text, e.tone);
        return;
      case "xp": {
        this.floatAt(this.views.get(g.hero.id), `+${e.amount} XP`, "small", TONE_COLOR.gold);
        return;
      }
      case "levelUp": {
        const v = this.views.get(g.hero.id)!;
        this.hud.banner(`Level ${e.level}`, "Your power grows", "gold");
        this.sfx.levelUp();
        void this.fx.beam(v.world, "#ffd76a", 6, 1.2, 1.4);
        void this.fx.ring(v.world, "#ffd76a", 2.5, 1);
        this.fx.burst(v.world.add(new Vector3(0, 0.5, 0)), { color: "#ffd76a", color2: "#ffffff", count: 80, power: 2, size: 0.12, life: 1.4, gravity: -0.5, box: 0.4 });
        this.hud.toast(`<b style="color:var(--gold)">Level ${e.level}</b> — ${e.gains.join(" · ")}`, 4200);
        v.maxHp = e.maxHp;
        this.refresh();
        await t.wait(0.6);
        return;
      }
      case "chest": {
        this.level!.openChest(e.at.x, e.at.y);
        this.sfx.chest();
        this.fx.burst(new Vector3(e.at.x, 0.5, e.at.y), { color: "#ffd76a", color2: "#fff4c0", count: 50, power: 2, size: 0.1, life: 1.1, gravity: -1 });
        this.hud.toast(`${"Found"}: ${e.loot.join(", ")}`);
        this.refresh();
        await t.wait(0.4);
        return;
      }
      case "spawn": {
        const v = this.addView(e.actor);
        v.engaged = true;
        v.setShown(this.shownTile(e.actor.pos));
        if (v.shown) this.fx.burst(v.world.add(new Vector3(0, 0.2, 0)), { color: "#ff5a2a", color2: "#3a1010", count: 40, power: 1.5, size: 0.3, life: 1 });
        await t.wait(0.2);
        return;
      }
      case "combatEnd": {
        for (const v of this.views.values()) { v.engaged = false; v.active = false; }
        this.turnId = null;
        this.hud.order([], new Map(), null, 0, new Map());
        await t.wait(0.3);
        return;
      }
      case "stairs":
        this.pendingStairs = true;
        return;
      case "heroDied":
        this.hud.banner("You have fallen", "", "red");
        return;
      case "victory":
        this.hud.banner("Victory", "The Ember Throne is cold", "gold");
        return;
      case "hero":
        this.refresh();
        return;
    }
  }

  private async playSpell(e: Extract<GameEvent, { t: "spell" }>): Promise<void> {
    const caster = this.views.get(e.caster);
    const target = e.target !== undefined ? this.views.get(e.target) : undefined;
    const at = this.world(e.at);
    const t = this.tweens;
    if (caster && caster.team !== "hero" && !caster.shown) return;
    switch (e.fx) {
      case "missile": {
        if (!caster || !target) return;
        await caster.cast(target.world, t);
        this.sfx.magic();
        const shots = [0, 1, 2, 3].map((k) => new Promise<void>((res) => setTimeout(() => {
          const off = new Vector3(Math.sin(k * 2.1) * 0.5, 0.4 + k * 0.1, Math.cos(k * 2.1) * 0.5);
          void this.fx.bolt(caster.chestPos.add(off.scale(0.3)), target.chestPos, "#b9a4ff", 0.13, 11, 0.8 + k * 0.2).then(res);
        }, k * 90)));
        await Promise.all(shots);
        this.fx.burst(target.chestPos, { color: "#b9a4ff", color2: "#ffffff", count: 40, power: 2.5, size: 0.14 });
        return;
      }
      case "column": {
        if (caster) await caster.cast(at, t);
        this.sfx.holy();
        this.fx.light(at.add(new Vector3(0, 2, 0)), "#ffe48a", 3, 6);
        await this.fx.beam(at, "#ffe48a", 5, 0.8, 0.6);
        return;
      }
      case "cone": {
        if (!caster) return;
        await caster.cast(at, t);
        this.sfx.fire();
        const tiles = (e.tiles ?? []).map((p) => this.world(p));
        this.fx.cone(caster.world, tiles);
        this.fx.scorch(tiles, "#ff7a2a");
        await t.wait(0.35);
        return;
      }
      case "fireball": {
        if (!caster) return;
        await caster.cast(at, t);
        this.sfx.fire();
        await this.fx.bolt(caster.chestPos, at.add(new Vector3(0, 0.4, 0)), "#ffb36b", 0.18, 16, 1.5);
        this.sfx.fire(true);
        this.fx.scorch((e.tiles ?? []).map((p) => this.world(p)), "#ff5a1a");
        await this.fx.explosion(at, 3);
        return;
      }
      case "potion":
        this.sfx.heal();
        if (caster) this.fx.burst(caster.chestPos, { color: "#ff5a6a", color2: "#ffd0d0", count: 30, power: 1, size: 0.12, life: 0.9, gravity: 1, box: 0.25 });
        await t.wait(0.2);
        return;
      case "surge":
        this.sfx.levelUp();
        if (caster) {
          void this.fx.ring(caster.world, "#ffd76a", 1.5, 0.5);
          this.fx.burst(caster.chestPos, { color: "#ffd76a", color2: "#ffffff", count: 40, power: 2, size: 0.12, life: 0.7 });
        }
        await t.wait(0.25);
        return;
      case "heal":
        this.sfx.heal();
        if (caster) {
          void this.fx.beam(caster.world, "#a8ffb0", 3, 0.9, 0.8);
          await caster.cast(null, t);
        }
        return;
      case "turn":
        this.sfx.holy();
        if (caster) {
          await caster.cast(null, t);
          this.fx.light(caster.chestPos.add(new Vector3(0, 1, 0)), "#ffe48a", 3.5, 10);
          await this.fx.ring(caster.world, "#ffe48a", 6, 0.8);
        }
        return;
      case "rest": {
        this.sfx.heal();
        if (caster) void this.fx.ring(caster.world, "#ffb36b", 2, 1.2);
        await t.wait(0.5);
        return;
      }
      case "summon":
        this.sfx.fire(true);
        this.stage.addShake(0.8);
        this.fx.light(at.add(new Vector3(0, 1, 0)), "#ff3a1a", 4, 10);
        await this.fx.ring(at, "#ff3a1a", 3, 0.8);
        return;
    }
  }

  // ------------------------------------------------------------ input

  private wireInput(canvas: HTMLCanvasElement): void {
    const scene = this.stage.scene;
    scene.onPointerObservable.add((pi) => {
      if (this.mode !== "play") return;
      if (pi.type === PointerEventTypes.POINTERTAP) {
        this.sfx.unlock();
        this.onTap(scene.pointerX, scene.pointerY, (pi.event as PointerEvent).button === 2);
      } else if (pi.type === PointerEventTypes.POINTERMOVE && (pi.event as PointerEvent).pointerType === "mouse") {
        this.onHover(scene.pointerX, scene.pointerY);
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerleave", () => { this.overlay.setCursor(null); this.hud.hideTip(); });
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private wireHud(): void {
    const h = this.hud;
    h.onAction = (id) => this.selectAction(id);
    h.onEndTurn = () => this.endTurn();
    h.onRest = () => this.rest();
    h.onRotate = (d) => this.stage.rotate(d);
    h.onToggleSound = () => { this.sfx.unlock(); this.sfx.setMuted(!this.sfx.muted); return !this.sfx.muted; };
    h.onToggleSpeed = () => { this.tweens.speed = this.tweens.speed > 1 ? 1 : 2; return this.tweens.speed > 1; };
    h.onHelp = () => {
      const g = this.game;
      if (!g) return;
      this.mode = "menu";
      h.help(() => { h.hideScreen(); this.mode = "play"; });
    };
    h.onHoverAction = (id) => { if (this.game) h.actionTip(this.game, id); };
  }

  private canInput(): boolean {
    return this.mode === "play" && !this.busy && !!this.game && this.game.isHeroTurn();
  }

  private pickActor(x: number, y: number): Actor | null {
    const g = this.game!;
    const pick = this.stage.scene.pick(x, y, (m) => m.isPickable && m.metadata?.actorId !== undefined && m.isEnabled());
    if (pick?.hit && pick.pickedMesh) {
      const a = g.byId(pick.pickedMesh.metadata.actorId);
      if (a && !a.dead && (a.team === "hero" || g.isVisible(a.pos))) return a;
    }
    return null;
  }

  private tileAtScreen(x: number, y: number): Pt | null {
    const p = this.stage.floorPoint(x, y);
    if (!p) return null;
    const t = { x: Math.round(p.x), y: Math.round(p.z) };
    return inBounds(this.game!.map, t.x, t.y) ? t : null;
  }

  private onTap(x: number, y: number, rightClick: boolean): void {
    if (!this.canInput()) return;
    const g = this.game!;
    if (rightClick) { this.selectAction(null); return; }
    const actor = this.pickActor(x, y);
    const tile = actor ? actor.pos : this.tileAtScreen(x, y);
    if (!tile) return;
    this.hud.closePrompt();

    if (this.selected) {
      const a = findAction(g, this.selected);
      if (!a) { this.selectAction(null); return; }
      const target = actor && actor.team === "enemy" ? actor : g.actorAt(tile.x, tile.y) ?? null;
      if (!validTarget(g, a, target && target.team === "enemy" ? target : null, tile)) {
        this.hud.toast("Not a valid target");
        return;
      }
      const id = this.selected;
      this.selected = null;
      void this.run(useAction(g, id, target && target.team === "enemy" ? target : null, tile));
      return;
    }

    // Nothing selected: tap a foe to attack, a chest to open, the floor to move.
    const foe = actor && actor.team === "enemy" ? actor : g.actorAt(tile.x, tile.y);
    if (foe && foe.team === "enemy" && g.isVisible(foe.pos)) {
      const id = this.defaultAttack(foe);
      if (!id) { this.hud.toast(blockedReason(g, findAction(g, "attack")!) ?? "Out of range"); return; }
      void this.run(useAction(g, id, foe, foe.pos));
      return;
    }
    const chest = g.map.props.find((p) => p.kind === "chest" && !p.opened && p.x === tile.x && p.y === tile.y);
    if (chest) { void this.run(g.openChest(tile)); return; }
    if (g.map.stairs && tile.x === g.map.stairs.x && tile.y === g.map.stairs.y && g.canDescend()) {
      this.pendingStairs = true;
      void this.run([{ t: "stairs" }]);
      return;
    }
    if (!g.seen[idx(g.map, tile.x, tile.y)]) return;
    const evs = g.moveHero(tile);
    if (!evs.length && g.inCombat) this.hud.toast("Out of movement");
    void this.run(evs);
  }

  private defaultAttack(foe: Actor): string | null {
    const g = this.game!;
    for (const id of DEFAULT_ATTACK[g.hero.cls]) {
      const a = findAction(g, id);
      if (!a || blockedReason(g, a)) continue;
      if (!validTarget(g, a, foe, foe.pos)) continue;
      if (id === "attack" && g.inCombat && dist(foe.pos, g.hero.pos) > 1) {
        // Must be able to reach a tile next to it this turn.
        const reach = g.heroReach();
        let ok = false;
        for (const [i] of reach) {
          const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
          if (dist(p, foe.pos) === 1) { ok = true; break; }
        }
        if (!ok) continue;
      }
      return id;
    }
    return null;
  }

  private onHover(x: number, y: number): void {
    if (this.mode !== "play" || !this.game) return;
    const g = this.game;
    const actor = this.pickActor(x, y);
    const tile = actor ? actor.pos : this.tileAtScreen(x, y);
    if (this.busy || !g.isHeroTurn()) { this.overlay.setCursor(null); this.overlay.setPath(null); return; }
    if (!tile || !g.seen[idx(g.map, tile.x, tile.y)]) { this.overlay.setCursor(null); this.overlay.setPath(null); this.hud.hideTip(); return; }

    const foe = actor && actor.team === "enemy" ? actor : g.actorAt(tile.x, tile.y);
    const sel = this.selected ? findAction(g, this.selected) : null;
    if (sel && (sel.targeting === "area" || sel.targeting === "cone")) {
      const ok = validTarget(g, sel, null, tile);
      this.overlay.setRegion("area", ok ? affectedTiles(g, sel, tile) : null, "#ff7a2a", 0.3, 0.9);
      this.overlay.setCursor(tile, ok ? "#ffb36b" : "#ff4a3a");
      this.hud.hideTip();
      return;
    }

    if (foe && foe.team === "enemy" && g.isVisible(foe.pos)) {
      this.overlay.setCursor(foe.pos, "#ff5a4a");
      const actId = sel?.toHit ? sel.id : sel ? null : this.defaultAttack(foe);
      const act = actId ? findAction(g, actId) : null;
      let chance: string | null = null;
      if (act?.toHit) {
        const edge = g.attackEdge(g.hero, foe, act.range > 1);
        const mode = Math.sign(edge.adv.length - edge.dis.length);
        chance = `${Math.round(Game.hitChance(act.toHit(g), foe.ac, mode) * 100)}% to hit${mode > 0 ? " (adv.)" : mode < 0 ? " (disadv.)" : ""}`;
      } else if (sel && !sel.toHit) {
        chance = sel.id === "magic_missile" ? "Always hits" : "They must save";
      }
      const v = this.views.get(foe.id)!;
      this.hud.enemyTip(foe.name, foe.def, v.hp, foe.maxHp, foe.ac, chance, x, y);
      // Preview the walk-up path for melee.
      if (!sel && actId === "attack" && dist(foe.pos, g.hero.pos) > 1) {
        const path = this.previewPath(foe.pos, true);
        this.overlay.setPath(path);
      } else this.overlay.setPath(null);
      return;
    }
    this.hud.hideTip();
    const chest = g.map.props.find((p) => p.kind === "chest" && !p.opened && p.x === tile.x && p.y === tile.y);
    if (chest) { this.overlay.setCursor(tile, "#ffd76a"); this.overlay.setPath(this.previewPath(tile, true)); return; }
    if (sel?.targeting === "tile") {
      const ok = validTarget(g, sel, null, tile);
      this.overlay.setCursor(tile, ok ? "#cfd8ff" : "#ff4a3a");
      this.overlay.setPath(null);
      return;
    }
    const path = this.previewPath(tile, false);
    this.overlay.setCursor(tile, path ? "#ffffff" : "#ff4a3a");
    this.overlay.setPath(path);
  }

  private previewPath(to: Pt, adjacent: boolean): Pt[] | null {
    const g = this.game!;
    if (g.inCombat) {
      const reach = g.heroReach();
      if (adjacent) {
        let best: Pt | null = null, cost = Infinity;
        for (const [i, r] of reach) {
          const p = { x: i % g.map.w, y: (i / g.map.w) | 0 };
          if (dist(p, to) === 1 && r.cost < cost) { cost = r.cost; best = p; }
        }
        return best ? pathFromReach(g.map, reach, best) : null;
      }
      return pathFromReach(g.map, reach, to);
    }
    const path = findPath(g.map, g.hero.pos, to, g.occupiedBy(g.hero), adjacent, 3000);
    return path && path.length <= 60 ? path : null;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.mode !== "play" || !this.game) return;
    const k = e.key.toLowerCase();
    if (k === "q") { this.stage.rotate(-1); return; }
    if (k === "e") { this.stage.rotate(1); return; }
    if (k === "l") { this.hud.toggleLog(); return; }
    if (k === "=" || k === "+") { this.stage.zoom(-1.5); return; }
    if (k === "-") { this.stage.zoom(1.5); return; }
    if (k === "escape") { this.selectAction(null); this.hud.closePrompt(); return; }
    if (!this.canInput()) return;
    if (k === " " || k === "enter") { e.preventDefault(); this.endTurn(); return; }
    if (k === "r") { this.rest(); return; }
    if (/^[1-9]$/.test(k)) {
      const a = heroActions(this.game)[Number(k) - 1];
      if (a) this.selectAction(a.id);
      return;
    }
    const dirs: Record<string, Pt> = { arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 } };
    const d = dirs[k];
    if (d) {
      e.preventDefault();
      // Keys follow the camera: "up" walks away from the viewer.
      const rot = Math.round(((this.stage.camera.alpha + Math.PI / 2) / (Math.PI / 2)) % 4 + 4) % 4;
      let v = { ...d };
      for (let i = 0; i < rot; i++) v = { x: -v.y, y: v.x };
      const g = this.game;
      const to = { x: g.hero.pos.x + v.x, y: g.hero.pos.y + v.y };
      const foe = g.actorAt(to.x, to.y);
      if (foe && foe.team === "enemy") { const id = this.defaultAttack(foe); if (id) void this.run(useAction(g, id, foe, foe.pos)); return; }
      void this.run(g.moveHero(to));
    }
  }

  private selectAction(id: string | null): void {
    const g = this.game;
    if (!g) return;
    this.sfx.click();
    if (id === null || this.selected === id) {
      this.selected = null;
      this.refresh();
      return;
    }
    if (!this.canInput()) return;
    const a = findAction(g, id);
    if (!a) return;
    const reason = blockedReason(g, a);
    if (reason) { this.hud.toast(reason); return; }
    if (a.targeting === "self") {
      this.selected = null;
      void this.run(useAction(g, id, null, null));
      return;
    }
    this.selected = id;
    this.refresh();
  }

  private endTurn(): void {
    if (!this.canInput() || !this.game!.inCombat) return;
    this.selected = null;
    this.sfx.click();
    void this.run(this.game!.endTurn());
  }

  private rest(): void {
    if (!this.canInput()) return;
    const g = this.game!;
    const why = g.restBlocked();
    if (why) { this.hud.toast(why); return; }
    void this.run(g.shortRest());
  }

  // ------------------------------------------------------------ per frame

  private refresh(): void {
    const g = this.game;
    if (!g || this.mode !== "play") return;
    const hv = this.views.get(g.hero.id);
    this.hud.update(g, hv?.hp ?? g.hero.hp, this.busy, this.selected);
    this.refreshHighlights();
  }

  private refreshOrder(): void {
    const g = this.game;
    if (!g || !g.inCombat) return;
    const actors = new Map<number, HudActor>();
    const inits = new Map<number, number>();
    for (const id of g.order) {
      const a = g.byId(id);
      const v = this.views.get(id);
      if (!a || !v) continue;
      actors.set(id, { id, team: a.team, def: a.def, name: a.name, hp: v.hp, maxHp: a.maxHp, dead: v.dead });
      inits.set(id, a.initiative);
    }
    this.hud.order(g.order, actors, this.turnId, g.round, inits);
  }

  private refreshHighlights(): void {
    const g = this.game;
    if (!g) return;
    for (const v of this.views.values()) v.targeted = false;
    this.overlay.setRegion("range", null, "#000");
    this.overlay.setRegion("area", null, "#000");
    this.overlay.setPath(null);
    if (this.busy || !g.isHeroTurn() || this.mode !== "play") return;
    const sel = this.selected ? findAction(g, this.selected) : null;
    if (sel) {
      if (sel.targeting === "enemy") {
        for (const m of g.monsters) if (validTarget(g, sel, m, m.pos)) this.views.get(m.id)!.targeted = true;
      }
      if (sel.targeting === "tile") {
        const tiles: Pt[] = [];
        for (let y = g.hero.pos.y - sel.range; y <= g.hero.pos.y + sel.range; y++) {
          for (let x = g.hero.pos.x - sel.range; x <= g.hero.pos.x + sel.range; x++) {
            if (validTarget(g, sel, null, { x, y })) tiles.push({ x, y });
          }
        }
        this.overlay.setRegion("range", tiles, "#cfd8ff", 0.08, 0.6);
      }
      return;
    }
    if (g.inCombat && g.hero.movesLeft > 0) {
      const reach = g.heroReach();
      const tiles: Pt[] = [];
      for (const [i] of reach) tiles.push({ x: i % g.map.w, y: (i / g.map.w) | 0 });
      this.overlay.setRegion("range", tiles, "#5aa8ff", 0.05, 0.42);
    }
  }

  private frame(): void {
    const dt = Math.min(0.05, this.stage.engine.getDeltaTime() / 1000);
    this.time += dt;
    this.tweens.update(dt);
    this.overlay.update(dt);
    for (const v of this.views.values()) v.update(dt, this.time);
    const g = this.game;
    if (this.mode === "title" || !g) {
      // Slow cinematic orbit behind the title.
      this.orbit += dt * 0.06;
      this.stage.camera.alpha = -Math.PI * 0.75 + this.orbit;
      this.level?.update(dt, this.stage.focus);
      this.hud.frame([]);
      return;
    }
    const hv = this.views.get(g.hero.id);
    if (hv) {
      this.stage.focus.copyFrom(hv.rig.root.position);
      const lp = hv.rig.root.position;
      this.stage.heroLight.position.set(lp.x, 2.3 + Math.sin(this.time * 7) * 0.02, lp.z);
      this.stage.heroLight.intensity = 1.2 + Math.sin(this.time * 11) * 0.04 + Math.sin(this.time * 3.3) * 0.05;
    }
    this.level?.update(dt, this.stage.focus);
    const bars = [...this.views.values()].map((v) => ({
      id: v.id,
      team: v.team,
      hp: v.hp,
      maxHp: v.maxHp,
      show: !v.dead && v.shown && (v.engaged || v.hp < v.maxHp) && v.team !== "hero",
      pos: v.shown ? this.stage.project(v.headPos) : null,
    }));
    this.hud.frame(bars);
  }
}
