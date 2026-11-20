// Captures the README screenshots by driving headless Chrome over the DevTools protocol.
// No dependencies: Node 22's built-in fetch and WebSocket.
//
//   node tools/screenshots.mjs [url]
//   (default url: the live site; use http://localhost:5173/?capture for a dev build)
//
// Set CHROME to your Chrome/Edge path if it isn't found automatically.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.argv[2] ?? "https://zariffromlatif.github.io/emberdeep/?capture";
const OUT = "docs/screenshots";
const PORT = 9333;
/** Camera turns (45° steps) for the two scenes where a doorway blocks the default view. */
const ROT = Number(process.env.ROT ?? 2);
const BOOM_DELAY = Number(process.env.BOOM_DELAY ?? 180);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const CHROME = process.env.CHROME ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));
if (!CHROME) throw new Error("Chrome not found: set CHROME=/path/to/chrome");

const profile = mkdtempSync(join(tmpdir(), "emberdeep-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,720", "--hide-scrollbars", "--mute-audio", "--no-first-run",
  "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("Chrome DevTools did not come up");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

/** Run an async snippet in the page and return its value. */
async function run(js) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description ?? ""}`);
  return r.result.value;
}

async function shot(name) {
  await sleep(150);
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  if (ONLY && !ONLY.includes(name)) return;
  writeFileSync(join(OUT, `${name}${process.env.SUFFIX ?? ""}.jpg`), Buffer.from(data, "base64"));
  console.log(`  ${name}.jpg`);
}

async function viewport(width, height, mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}

// Shared page helpers: wait for the game, wait for playback, skip CSS intros, clear banners.
const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240 && !window.emberdeep; i++) await sleep(250);
  const app = window.emberdeep;
  const idle = async () => { for (let i = 0; i < 400 && app.busy; i++) await sleep(50); };
  const calm = () => { document.querySelectorAll(".banner, .loading, .toast").forEach((e) => e.remove()); };
  const finishCss = () => document.getAnimations().forEach((a) => { try { const end = a.effect?.getComputedTiming().endTime; if (isFinite(end)) a.finish(); } catch {} });
  const ready = async () => { await app.whenReady(); for (let i = 0; i < 40 && document.querySelector(".loading:not(.done)"); i++) await sleep(250); await sleep(600); calm(); };
`;

async function newPage() {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: URL });
  await sleep(1500);
  await run(`${HELPERS} await ready(); return true;`);
}

/** Start a fixed-seed run (so every capture is the same) and wait for the floor. */
const START = (cls, seed, xp = 0) => `
  ${HELPERS}
  await idle(); await sleep(1500); // let the previous scene's playback finish logging
  try { localStorage.clear(); } catch {}
  app.startRun("${cls}");
  for (let i = 0; i < 200 && app.mode !== "play"; i++) await sleep(100);
  await idle();
  for (let i = 0; i < 200 && app.mode !== "play"; i++) await sleep(100);
  const G = app.game.constructor;
  app.game = G.newRun("${cls}", ${seed}, "normal");
  if (${xp}) { app.game.gainXp(${xp}); app.game.takeEvents(); app.game.hero.hp = app.game.hero.maxHp; }
  app.hud.clearLog();
  await app.enterFloor();
  await ready(); await idle(); calm();
`;

try {
  mkdirSync(OUT, { recursive: true });
  await viewport(1280, 720);
  await newPage();
  console.log("Capturing from", URL);

  // 1. Title
  await run(`${HELPERS} await sleep(2500); finishCss(); return true;`);
  await shot("title");

  // 2. Hero select
  await run(`${HELPERS} document.querySelector("[data-a=new]").click(); await sleep(1200); finishCss(); document.querySelector(".screen:last-child")?.scrollTo(0, 0); return true;`);
  await shot("heroes");

  // 3. Exploring a torchlit room
  await run(`${START("fighter", 4242)}
    app.stage.camera.radius = 8.5; await sleep(1500); return true;`);
  await shot("explore");

  // 4. Melee: walk in, roll initiative, swing — captured with the d20 on screen.
  await run(`${HELPERS}
    const g = app.game; await app.run(g.moveHero({ x: 20, y: 11 })); await idle(); await sleep(400); calm();
    app.stage.camera.radius = 7.5; await sleep(600);
    const foe = g.monsters.find((m) => m.awake);
    const v = app.views.get(foe.id); const p = app.stage.project(v.chestPos);
    const k = app.stage.engine.getRenderWidth() / app.stage.canvas.clientWidth;
    app.onTap(p.x * k, p.y * k, false);
    await sleep(520); return true;`);
  await shot("combat");

  // 5. Fireball (level-5 Wizard) into a guarded room.
  await run(`${START("wizard", 4242, 2300)}
    const g = app.game; g.hero.pos = { x: 31, y: 11 }; app.views.get(0).setTile(31, 11); g.refreshFov(); g.takeEvents();
    await app.run(g.moveHero({ x: 32, y: 13 })); await idle(); await sleep(300); calm();
    app.stage.camera.alpha += ${ROT} * Math.PI / 4; app.stage.targetAlpha = app.stage.camera.alpha; app.stage.camera.radius = 10.5; await sleep(1200);
    const t = g.monsters.find((m) => m.awake);
    app.selected = "fireball";
    const v = app.views.get(t.id); const p = app.stage.project(v.world);
    const k = app.stage.engine.getRenderWidth() / app.stage.canvas.clientWidth;
    app.onTap(p.x * k, p.y * k, false);
    for (let i = 0; i < 100 && !app.stage.scene.getMeshByName("boom"); i++) await sleep(30);
    await sleep(${BOOM_DELAY}); return true;`);
  await shot("fireball");

  // 6. Bestiary: every KayKit creature in one torchlit room.
  await run(`${START("cleric", 4242)}
    const lineup = ["rogue", "wizard", "fighter", "goblin", "goblin_archer", "hobgoblin", "orc", "bugbear", "skeleton", "skeleton_archer", "zombie", "ghoul", "wight", "ogre"];
    await app.kay.preload(lineup);
    const ActorView = app.views.get(0).constructor;
    const h = app.game.hero.pos;
    lineup.forEach((d, i) => {
      const a = { id: 900 + i, team: "enemy", def: d, name: d, pos: { x: h.x - 3 + (i % 5) * 1.5, y: h.y - 2 + Math.floor(i / 5) * 1.6 }, hp: 5, maxHp: 5 };
      const v = new ActorView(app.kit, app.stage, a, app.ringTex, app.kay);
      v.targetFacing = -Math.PI * 0.75;
      app.views.set(a.id, v);
    });
    app.stage.camera.radius = 9.5; await sleep(2500); calm(); return true;`);
  await shot("bestiary");

  // 7. Phone layout, mid-fight.
  await viewport(390, 844, true);
  await run(`${START("rogue", 4242)}
    const g = app.game; await app.run(g.moveHero({ x: 20, y: 11 })); await idle(); await sleep(500); calm();
    app.stage.camera.alpha += ${ROT} * Math.PI / 4; app.stage.targetAlpha = app.stage.camera.alpha; app.stage.camera.radius = 9; await sleep(1500); return true;`);
  await shot("mobile");
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}
