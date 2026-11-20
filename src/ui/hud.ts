import { signed } from "../core/dice";
import { CLASSES, XP_LEVELS, MAX_LEVEL } from "../rules/classes";
import { MONSTERS } from "../rules/monsters";
import type { Game, RunStats, ShopItem } from "../game/game";
import { blockedReason, heroActions, type HeroAction } from "../game/actions";
import type { ClassId, RollInfo, Tone } from "../game/types";
import { DIFFICULTIES, type Difficulty } from "../rules/difficulty";
import { CLASS_ICON, icon } from "./icons";

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const MONSTER_ICON: Record<string, string> = {
  rat: "skull", goblin: "dagger", goblin_archer: "dagger", skeleton: "skull", skeleton_archer: "skull", zombie: "skull",
  orc: "sword", hobgoblin: "shield", ghoul: "skull", bugbear: "sword", ogre: "sword", wight: "flame",
};

export interface HudActor {
  id: number;
  team: string;
  def: string;
  name: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

interface FloatItem {
  el: HTMLElement;
  anchor: () => { x: number; y: number; visible: boolean } | null;
  until: number;
}

/** All the HTML on top of the 3D view. */
export class Hud {
  readonly ui = document.getElementById("ui")!;
  readonly world = document.getElementById("world")!;
  private screen: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private tipEl: HTMLElement | null = null;
  private floats: FloatItem[] = [];
  private hpBars = new Map<number, HTMLElement>();
  private logLines: { text: string; tone: Tone }[] = [];
  private diceTimer = 0;
  private hurtEl: HTMLElement;
  /** Click handlers wired by the app. */
  onAction: (id: string) => void = () => {};
  onEndTurn: () => void = () => {};
  onRest: () => void = () => {};
  onRotate: (dir: number) => void = () => {};
  onToggleSound: () => boolean = () => true;
  onToggleSpeed: () => boolean = () => false;
  onHelp: () => void = () => {};
  onHoverAction: (id: string | null) => void = () => {};

  constructor() {
    this.hurtEl = document.createElement("div");
    this.hurtEl.className = "hurt";
    this.world.appendChild(this.hurtEl);
  }

  // ------------------------------------------------------------ screens

  private show(html: string, cls = ""): HTMLElement {
    this.hideScreen();
    const el = document.createElement("div");
    el.className = `screen ${cls}`;
    el.innerHTML = html;
    this.ui.appendChild(el);
    this.screen = el;
    return el;
  }

  hideScreen(): void {
    const s = this.screen;
    if (!s) return;
    this.screen = null;
    s.classList.add("leaving");
    setTimeout(() => s.remove(), 400);
  }

  title(hasSave: boolean, h: { newRun: () => void; resume: () => void; help: () => void }): void {
    const el = this.show(`
      <h1 class="logo">Emberdeep</h1>
      <p class="tagline">A solo descent beneath Hollowmere</p>
      <div class="rule"></div>
      <div class="menu">
        ${hasSave ? `<button class="btn" data-a="resume">${icon("rest")} Continue the descent</button>` : ""}
        <button class="btn ${hasSave ? "ghost" : ""}" data-a="new">${icon("stairs")} New descent</button>
        <button class="btn ghost" data-a="help">${icon("book")} How to play</button>
      </div>
      <p class="footnote">Turn-based tactics on the 5e System Reference Document rules · tap or click to move · works on phone, tablet and PC<br/>Characters: KayKit by Kay Lousberg (CC0)</p>
    `, "title");
    el.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("[data-a]")?.getAttribute("data-a");
      if (a === "new") h.newRun();
      if (a === "resume") h.resume();
      if (a === "help") h.help();
    });
  }

  heroSelect(onPick: (c: ClassId, d: Difficulty) => void, onBack: () => void, initial: Difficulty = "normal"): void {
    let diff: Difficulty = initial;
    const cards = () => (Object.keys(CLASSES) as ClassId[]).map((id) => {
      const c = CLASSES[id];
      const conMod = Math.floor((c.scores.con - 10) / 2);
      const hp = c.hitDie + conMod + 10 + DIFFICULTIES[diff].heroHp;
      const ac = c.baseAc + (c.acDex ? Math.floor((c.scores.dex - 10) / 2) : 0);
      return `
        <button class="panel ornate ccard" data-c="${id}">
          <div class="crest">${icon(CLASS_ICON[id])}</div>
          <div><h3>${c.name}</h3><div class="ctitle">${c.title}</div></div>
          <p>${c.blurb}</p>
          <ul>${c.traits.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          <div class="stats">
            <span class="chip">${icon("heart")} <b>${hp}</b> HP</span>
            <span class="chip">${icon("shield")} <b>${ac}</b> AC</span>
            <span class="chip diff-${c.difficulty}">${c.difficulty}</span>
          </div>
        </button>`;
    }).join("");
    const picker = () => `
      <div class="diffpick" role="radiogroup" aria-label="Difficulty">
        ${(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => `<button class="diffopt ${d === diff ? "on" : ""}" role="radio" aria-checked="${d === diff}" data-d="${d}">${DIFFICULTIES[d].name}</button>`).join("")}
      </div>
      <p class="diffblurb">${esc(DIFFICULTIES[diff].blurb)}</p>`;
    const el = this.show(`
      <h2 class="title">Choose your hero</h2>
      <p class="subtitle">Beneath Hollowmere the old dwarven forge has woken, and something down there is burning.
      Five depths stand between you and the thing that lit it. You go alone.</p>
      <div data-picker>${picker()}</div>
      <div class="classes" data-cards>${cards()}</div>
      <div class="select-actions"><button class="btn ghost" data-back>Back</button></div>
    `);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-back]")) { onBack(); return; }
      const d = t.closest("[data-d]")?.getAttribute("data-d") as Difficulty | null;
      if (d) {
        diff = d;
        $(el, "[data-picker]").innerHTML = picker();
        $(el, "[data-cards]").innerHTML = cards();
        el.querySelectorAll(".ccard").forEach((c) => ((c as HTMLElement).style.animation = "none"));
        return;
      }
      const c = t.closest("[data-c]")?.getAttribute("data-c") as ClassId | null;
      if (c) onPick(c, diff);
    });
  }

  help(onClose: () => void): void {
    const el = this.show(`
      <div class="panel ornate help">
        <h2 class="title">How to play</h2>
        <dl>
          <dt>Explore</dt><dd>Tap or click a tile to walk there. Tap a chest to open it. Find the glowing stairs to go deeper.</dd>
          <dt>Fight</dt><dd>When enemies see you, everyone rolls initiative. On your turn you have <b>movement</b> (blue tiles), one <b>action</b> (gold circle) and one <b>bonus action</b> (teal triangle).</dd>
          <dt>Attack</dt><dd>Tap an enemy to attack it with your default attack, or pick an ability first. Hover an enemy to see your chance to hit.</dd>
          <dt>Dice</dt><dd>Attacks roll a d20 plus your bonus against the target's Armour Class. A natural 20 is a critical hit and doubles the damage dice.</dd>
          <dt>Careful</dt><dd>Walking away from an adjacent enemy gives it a free <b>opportunity attack</b>. Spells that hit an area can hit you too.</dd>
          <dt>Rest</dt><dd>Out of combat you can take two short rests per depth: spend hit dice to heal and recover your abilities. Something may hear you.</dd>
          <dt>Campfire</dt><dd>Between depths you fully recover and can spend gold on potions and gear.</dd>
        </dl>
        <h4>Keys</h4>
        <p class="subtitle" style="margin:0;text-align:left">
          <span class="kbd">1</span>–<span class="kbd">9</span> abilities · <span class="kbd">Space</span> end turn · <span class="kbd">Esc</span> cancel ·
          <span class="kbd">Q</span>/<span class="kbd">E</span> rotate · drag to orbit · wheel or pinch to zoom · <span class="kbd">R</span> rest · <span class="kbd">L</span> log
        </p>
        <div class="select-actions"><button class="btn" data-close>Got it</button></div>
      </div>`);
    el.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-close]")) onClose(); });
  }

  campfire(g: Game, h: { buy: (id: ShopItem["id"]) => void; descend: () => void }, recovered: string): void {
    const hero = g.hero;
    const next = g.depth + 1;
    const render = () => {
      const wares = g.shop().map((it) => `
        <div class="ware">
          <h4>${icon(it.id === "potion" ? "potion" : it.id === "weapon" ? "sword" : "shield")} ${esc(it.name)}</h4>
          <p>${esc(it.desc)}</p>
          <button class="btn ghost" data-buy="${it.id}" ${it.soldOut || hero.gold < it.price ? "disabled" : ""}>
            ${it.soldOut ? "Maxed out" : `${icon("coin")} ${it.price} gold`}
          </button>
        </div>`).join("");
      return `
        <div class="panel ornate camp">
          <h2 class="title">Campfire</h2>
          <p class="subtitle" style="margin-bottom:14px">You made it through depth ${g.depth}. The stairs wind down into the dark. Below lies <b style="color:var(--gold)">${esc(themeName(next))}</b>.</p>
          <div class="rested">${icon("rest")}<div>${esc(recovered)}</div></div>
          <div class="purse">
            <span>${icon("coin")} <b>${hero.gold}</b> gold</span>
            <span>${icon("potion")} <b>${hero.potions}</b> potions</span>
            <span>${icon("sword")} weapon <b>${signed(hero.weaponBonus)}</b></span>
            <span>${icon("shield")} AC <b>${hero.ac}</b></span>
          </div>
          <div class="shop">${wares}</div>
          <div class="select-actions"><button class="btn" data-go>${icon("stairs")} Descend to depth ${next}</button></div>
        </div>`;
    };
    const el = this.show(render());
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const buy = t.closest("[data-buy]")?.getAttribute("data-buy") as ShopItem["id"] | null;
      if (buy) { h.buy(buy); el.innerHTML = render(); return; }
      if (t.closest("[data-go]")) h.descend();
    });
  }

  results(win: boolean, g: Game, onAgain: () => void, onTitle: () => void): void {
    const s: RunStats = g.stats;
    const c = CLASSES[g.hero.cls];
    const el = this.show(`
      <div class="panel ornate camp" style="text-align:center">
        <div style="font-size:48px;color:${win ? "var(--gold)" : "var(--bad)"}">${icon(win ? "flame" : "skull")}</div>
        <h2 class="title">${win ? "The Ember Throne is cold" : "Here ends the descent"}</h2>
        <p class="subtitle">${win
          ? `Varrow falls, and the forge-fire beneath Hollowmere gutters out. Your ${c.name.toLowerCase()} climbs back into the morning, a legend in a town that will never know.`
          : `Your ${c.name.toLowerCase()} fell on depth ${g.depth}, ${esc(g.map.theme.name)}. Someone else will have to finish this.`}</p>
        <div class="statgrid">
          <div class="stat"><b>${g.depth}</b><span>Depth · ${DIFFICULTIES[g.difficulty].name}</span></div>
          <div class="stat"><b>${g.hero.level}</b><span>Level</span></div>
          <div class="stat"><b>${g.hero.kills}</b><span>Foes slain</span></div>
          <div class="stat"><b>${s.damageDealt}</b><span>Damage dealt</span></div>
          <div class="stat"><b>${s.crits}</b><span>Critical hits</span></div>
          <div class="stat"><b>${g.hero.gold}</b><span>Gold</span></div>
        </div>
        <div class="select-actions">
          <button class="btn" data-again>${icon("stairs")} Descend again</button>
          <button class="btn ghost" data-title>Title screen</button>
        </div>
      </div>`);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-again]")) onAgain();
      if (t.closest("[data-title]")) onTitle();
    });
  }

  // ------------------------------------------------------------ in-game HUD

  mountHud(): void {
    this.unmountHud();
    const el = document.createElement("div");
    el.className = "passthru";
    el.style.position = "absolute";
    el.style.inset = "0";
    el.innerHTML = `
      <div class="hud-top">
        <div class="panel ornate plate">
          <div class="medal"><span data-crest></span><span class="lvl" data-lvl>1</span></div>
          <div class="who">
            <div class="name"><span data-name></span><small data-cls></small></div>
            <div class="bar" data-hpbar><i class="ghost"></i><i class="fill"></i><b data-hp></b></div>
            <div class="xpbar"><i data-xp></i></div>
            <div class="chips" data-chips></div>
          </div>
        </div>
        <div class="center-top">
          <div class="depth-tag" data-depth></div>
          <div class="panel order" data-order hidden></div>
        </div>
        <div class="corner">
          <button class="iconbtn" data-k="sound" title="Sound">${icon("sound")}</button>
          <button class="iconbtn" data-k="speed" title="Fast animations">${icon("fast")}</button>
          <button class="iconbtn" data-k="rotl" title="Rotate (Q)">${icon("rotl")}</button>
          <button class="iconbtn" data-k="rotr" title="Rotate (E)">${icon("rotr")}</button>
          <button class="iconbtn" data-k="help" title="Help">${icon("question")}</button>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="panel ornate actions">
          <div class="econ" data-econ></div>
          <div class="slots" data-slots></div>
        </div>
        <button class="endturn" data-end hidden>${icon("hourglass")}End<br/>turn</button>
      </div>
      <div class="panel log" data-log>
        <header data-logtoggle><span>${icon("book")} Chronicle</span><span data-logcaret>▾</span></header>
        <div class="lines" data-lines></div>
      </div>
      <div class="dice passthru" data-dice></div>
    `;
    this.ui.appendChild(el);
    this.hud = el;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const slot = t.closest("[data-act]")?.getAttribute("data-act");
      if (slot) { this.onAction(slot); return; }
      if (t.closest("[data-end]")) { this.onEndTurn(); return; }
      if (t.closest("[data-rest]")) { this.onRest(); return; }
      if (t.closest("[data-logtoggle]")) { this.toggleLog(); return; }
      const k = t.closest("[data-k]")?.getAttribute("data-k");
      if (k === "sound") { const on = this.onToggleSound(); const b = $(el, '[data-k="sound"]'); b.innerHTML = icon(on ? "sound" : "mute"); }
      if (k === "speed") { const fast = this.onToggleSpeed(); $(el, '[data-k="speed"]').classList.toggle("on", fast); }
      if (k === "rotl") this.onRotate(-1);
      if (k === "rotr") this.onRotate(1);
      if (k === "help") this.onHelp();
    });
    el.addEventListener("pointerover", (e) => {
      const slot = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (slot) this.onHoverAction(slot.getAttribute("data-act"));
    });
    el.addEventListener("pointerout", (e) => {
      if ((e.target as HTMLElement).closest("[data-act]")) this.onHoverAction(null);
    });
    if (matchMedia("(max-width: 760px)").matches) this.toggleLog(true);
    this.renderLog();
  }

  unmountHud(): void {
    this.hud?.remove();
    this.hud = null;
    for (const b of this.hpBars.values()) b.remove();
    this.hpBars.clear();
    this.hideTip();
  }

  toggleLog(force?: boolean): void {
    if (!this.hud) return;
    const log = $(this.hud, "[data-log]");
    const collapsed = force ?? !log.classList.contains("collapsed");
    log.classList.toggle("collapsed", collapsed);
    $(this.hud, "[data-logcaret]").textContent = collapsed ? "▸" : "▾";
  }

  update(g: Game, displayHp: number, busy: boolean, selected: string | null): void {
    if (!this.hud) return;
    const h = g.hero;
    const c = CLASSES[h.cls];
    const el = this.hud;
    $(el, "[data-crest]").innerHTML = icon(CLASS_ICON[h.cls]);
    $(el, "[data-lvl]").textContent = String(h.level);
    $(el, "[data-name]").textContent = c.name;
    $(el, "[data-cls]").textContent = c.title;
    const pct = Math.max(0, displayHp / h.maxHp) * 100;
    const bar = $(el, "[data-hpbar]");
    (bar.querySelector(".fill") as HTMLElement).style.width = `${pct}%`;
    (bar.querySelector(".ghost") as HTMLElement).style.width = `${pct}%`;
    bar.classList.toggle("low", pct <= 30);
    $(el, "[data-hp]").textContent = `${Math.max(0, displayHp)} / ${h.maxHp}`;
    const lo = XP_LEVELS[h.level - 1] ?? 0, hi = XP_LEVELS[h.level] ?? lo;
    $(el, "[data-xp]").style.width = h.level >= MAX_LEVEL ? "100%" : `${Math.min(100, ((h.xp - lo) / (hi - lo)) * 100)}%`;
    const slots = h.slotsMax ? `<span class="chip" title="Spell slots"><span class="pips">${Array.from({ length: h.slotsMax }, (_, i) => `<i class="${i < h.slots ? "on" : ""}"></i>`).join("")}</span></span>` : "";
    $(el, "[data-chips]").innerHTML = `
      <span class="chip" title="Armour Class">${icon("shield")} <b>${h.ac}</b></span>
      ${h.ward ? `<span class="chip ward" title="Ember Ward: absorbs damage this fight">${icon("sparkle")} <b>${h.ward}</b></span>` : ""}
      ${slots}
      <span class="chip" title="Potions of Healing">${icon("potion")} <b>${h.potions}</b></span>
      <span class="chip" title="Gold">${icon("coin")} <b>${h.gold}</b></span>
      <span class="chip" title="Hit dice for short rests">${icon("heart")} <b>${h.hitDice}</b></span>`;
    const dname = g.difficulty === "normal" ? "" : ` · ${DIFFICULTIES[g.difficulty].name}`;
    $(el, "[data-depth]").innerHTML = `${esc(g.map.theme.subtitle)}${dname}<b>${esc(g.map.theme.name)}</b>`;

    // Economy: action, bonus, movement.
    const econ = $(el, "[data-econ]");
    if (g.inCombat) {
      const moves = Array.from({ length: Math.max(h.speed, h.movesLeft) }, (_, i) => `<i class="${i < h.movesLeft ? "" : "off"}"></i>`).join("");
      econ.innerHTML = `
        <span class="${h.actionUsed && h.attacksLeft <= 0 ? "spent" : ""}"><i class="shape act"></i>Action</span>
        <span class="${h.bonusUsed ? "spent" : ""}"><i class="shape bon"></i>Bonus</span>
        <span class="${h.movesLeft <= 0 ? "spent" : ""}"><span class="moves">${moves}</span>${h.movesLeft * 5} ft</span>`;
    } else {
      econ.innerHTML = `<span>${icon("eye")} Exploring — tap to move</span>`;
    }

    const acts = heroActions(g);
    const slotsHtml = acts.map((a, i) => this.slotHtml(g, a, i, selected)).join("");
    const restReason = g.restBlocked();
    const rest = g.inCombat ? "" : `<div class="slot divider"></div>
      <button class="slot ${restReason ? "off" : ""}" data-rest title="Short rest">${icon("rest")}<span class="key">R</span><span class="count">${g.restsLeft()}</span></button>`;
    $(el, "[data-slots]").innerHTML = slotsHtml + rest;

    const end = $(el, "[data-end]");
    end.hidden = !g.inCombat;
    const heroTurn = g.isHeroTurn() && !busy;
    end.classList.toggle("wait", !heroTurn);
    const exhausted = heroTurn && (h.actionUsed && h.attacksLeft <= 0) && h.movesLeft <= 0;
    end.classList.toggle("nudge", exhausted);
  }

  private slotHtml(g: Game, a: HeroAction, i: number, selected: string | null): string {
    const reason = blockedReason(g, a);
    const kind = a.slots || ["fire_bolt", "sacred_flame"].includes(a.id) ? "spell" : ["potion", "second_wind", "cure_wounds", "healing_word"].includes(a.id) ? "heal" : "";
    const count = a.id === "potion" ? g.hero.potions : a.slots ? "" : a.feature ? (g.hero.featureUses[a.feature] ? 0 : 1) : "";
    const ico = a.id === "attack" ? weaponIcon(g.hero.cls) : a.icon;
    return `<button class="slot ${kind} ${reason ? "off" : ""} ${selected === a.id ? "sel" : ""}" data-act="${a.id}" aria-label="${esc(a.name)}">
      ${icon(ico)}<span class="key">${i + 1}</span><span class="cost ${a.cost}"></span>${count !== "" ? `<span class="count">${count}</span>` : ""}
    </button>`;
  }

  actionTip(g: Game, id: string | null): void {
    if (!id || !this.hud) { this.hideTip(); return; }
    const a = heroActions(g).find((x) => x.id === id);
    if (!a) { this.hideTip(); return; }
    const slot = this.hud.querySelector(`[data-act="${id}"]`) as HTMLElement | null;
    if (!slot) return;
    const reason = blockedReason(g, a);
    const r = slot.getBoundingClientRect();
    const costTxt = a.cost === "action" ? "Action" : a.cost === "bonus" ? "Bonus action" : "Free";
    const slotTxt = a.slots ? ` · ${a.slots} slot${a.slots > 1 ? "s" : ""}` : "";
    this.tip(`<h5>${esc(a.id === "attack" ? CLASSES[g.hero.cls].weapon.name : a.name)}<small>${costTxt}${slotTxt}</small></h5>
      <div class="numbers">${esc(a.stat(g))}</div><p>${esc(a.desc)}</p>${reason ? `<div class="why">${esc(reason)}</div>` : ""}`,
      r.left + r.width / 2, r.top - 10, "above");
  }

  tip(html: string, x: number, y: number, where: "above" | "right" = "right"): void {
    if (!this.tipEl) {
      this.tipEl = document.createElement("div");
      this.tipEl.className = "panel tip";
      this.ui.appendChild(this.tipEl);
    }
    const t = this.tipEl;
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, hgt = t.offsetHeight;
    let left = where === "above" ? x - w / 2 : x + 18;
    let top = where === "above" ? y - hgt : y + 18;
    left = Math.max(8, Math.min(innerWidth - w - 8, left));
    top = Math.max(8, Math.min(innerHeight - hgt - 8, top));
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }

  hideTip(): void {
    if (this.tipEl) this.tipEl.hidden = true;
  }

  enemyTip(name: string, def: string, hp: number, maxHp: number, ac: number, chance: string | null, x: number, y: number): void {
    const m = MONSTERS[def];
    const state = hp >= maxHp ? "Unhurt" : hp > maxHp * 0.5 ? "Wounded" : hp > maxHp * 0.25 ? "Bloodied" : "Near death";
    this.tip(`<h5>${esc(name)}<small>AC ${ac}</small></h5>
      <div class="numbers">${state} · ${hp}/${maxHp} HP${chance ? ` · ${chance}` : ""}</div>
      <p>${esc(m?.lore ?? "")}</p>`, x, y);
  }

  order(ids: number[], actors: Map<number, HudActor>, active: number | null, round: number, inits: Map<number, number>): void {
    if (!this.hud) return;
    const el = $(this.hud, "[data-order]");
    if (!ids.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span class="round">ROUND ${round}</span>` + ids.map((id) => {
      const a = actors.get(id);
      if (!a) return "";
      const ico = a.team === "hero" ? CLASS_ICON[a.def] : MONSTER_ICON[a.def] ?? "skull";
      const pct = Math.max(0, a.hp / a.maxHp) * 100;
      return `<div class="tok ${a.team === "hero" ? "hero" : ""} ${id === active ? "now" : ""} ${a.dead ? "dead" : ""}" title="${esc(a.name)}">
        ${icon(ico)}<span class="init">${Math.floor(inits.get(id) ?? 0)}</span><span class="hpd"><i style="width:${pct}%"></i></span></div>`;
    }).join("");
    const now = el.querySelector(".now") as HTMLElement | null;
    now?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  // ------------------------------------------------------------ log, dice, banners

  log(text: string, tone: Tone): void {
    this.logLines.push({ text, tone });
    if (this.logLines.length > 80) this.logLines.shift();
    if (!this.hud) return;
    const lines = $(this.hud, "[data-lines]");
    const p = document.createElement("p");
    p.className = `t-${tone}`;
    p.textContent = text;
    lines.appendChild(p);
    while (lines.children.length > 80) lines.firstChild?.remove();
    lines.scrollTop = lines.scrollHeight;
  }

  clearLog(): void {
    this.logLines = [];
    if (this.hud) $(this.hud, "[data-lines]").innerHTML = "";
  }

  private renderLog(): void {
    if (!this.hud) return;
    const lines = $(this.hud, "[data-lines]");
    lines.innerHTML = this.logLines.map((l) => `<p class="t-${l.tone}">${esc(l.text)}</p>`).join("");
    lines.scrollTop = lines.scrollHeight;
  }

  dice(r: RollInfo, success: boolean, isSave = false): void {
    if (!this.hud) return;
    const tray = $(this.hud, "[data-dice]");
    clearTimeout(this.diceTimer);
    const die = (n: number, cls: string) => `
      <div class="die ${cls}">
        <svg viewBox="0 0 100 100"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="#2a1a12" stroke="#d4aa5c" stroke-width="3"/>
        <polygon points="50,3 26,45 74,45" fill="rgba(255,220,160,0.08)" stroke="#d4aa5c" stroke-width="1.5"/>
        <path d="M26 45 7 73M74 45l19 28M26 45 50 97 74 45" stroke="rgba(212,170,92,0.55)" stroke-width="1.5" fill="none"/></svg>
        <span class="num">${n}</span>
      </div>`;
    const nat = r.d20.natural;
    const cls = nat === 20 && !isSave ? "crit" : nat === 1 && !isSave ? "fumble" : "";
    const other = r.d20.dice.length > 1 ? r.d20.dice.find((d, i) => d !== nat || i === 1)! : null;
    const mode = r.d20.mode > 0 ? "Advantage" : r.d20.mode < 0 ? "Disadvantage" : "";
    const verdict = isSave ? (success ? "Saved" : "Failed") : nat === 20 ? "Critical!" : nat === 1 ? "Fumble" : success ? "Hit" : "Miss";
    const color = isSave ? (success ? "var(--muted)" : "var(--ember-hot)") : success ? "var(--good)" : "var(--miss)";
    tray.innerHTML = `<div class="dicewrap">
      ${other !== null ? die(other, "second") : ""}${die(nat, cls)}
      <div class="dicecap">${esc(r.label)}${mode ? ` · ${mode}` : ""}<br/>${nat} ${signed(r.bonus)} = <b>${r.total}</b> vs ${isSave ? "DC" : "AC"} ${r.target} · <span class="res" style="color:${color}">${verdict}</span></div>
    </div>`;
    this.diceTimer = window.setTimeout(() => tray.querySelector(".dicewrap")?.classList.add("fade"), 1900);
  }

  banner(big: string, small = "", cls = ""): void {
    const el = document.createElement("div");
    el.className = `banner ${cls}`;
    el.innerHTML = `${small ? `<div class="small">${esc(small)}</div>` : ""}<div class="big">${esc(big)}</div>`;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  toast(html: string, ms = 2600): void {
    const el = document.createElement("div");
    el.className = "panel toast";
    el.innerHTML = html;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  prompt(text: string, buttons: { label: string; primary?: boolean; run: () => void }[]): void {
    this.closePrompt();
    const el = document.createElement("div");
    el.className = "panel ornate prompt";
    el.dataset.prompt = "1";
    el.innerHTML = `<span>${text}</span>` + buttons.map((b, i) => `<button class="btn ${b.primary ? "" : "ghost"}" data-i="${i}">${esc(b.label)}</button>`).join("");
    el.addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest("[data-i]")?.getAttribute("data-i");
      if (i !== null && i !== undefined) { this.closePrompt(); buttons[Number(i)].run(); }
    });
    this.ui.appendChild(el);
  }

  closePrompt(): void {
    this.ui.querySelectorAll("[data-prompt]").forEach((e) => e.remove());
  }

  hurt(): void {
    this.hurtEl.classList.add("on");
    setTimeout(() => this.hurtEl.classList.remove("on"), 60);
  }

  // ------------------------------------------------------------ world-space

  float(anchor: FloatItem["anchor"], html: string, cls: string, color?: string): void {
    const el = document.createElement("div");
    el.className = `float ${cls}`;
    if (color) el.style.color = color;
    el.innerHTML = html;
    this.world.appendChild(el);
    const life = cls.includes("crit") ? 1500 : 1300;
    this.floats.push({ el, anchor, until: performance.now() + life });
    this.placeFloat(this.floats[this.floats.length - 1]);
  }

  private placeFloat(f: FloatItem): void {
    const p = f.anchor();
    if (!p || !p.visible) { f.el.style.display = "none"; return; }
    f.el.style.display = "";
    f.el.style.left = `${p.x}px`;
    f.el.style.top = `${p.y}px`;
  }

  /** Per-frame: move floating text and health bars with their creatures. */
  frame(bars: { id: number; team: string; hp: number; maxHp: number; pos: { x: number; y: number; visible: boolean } | null; show: boolean }[]): void {
    const now = performance.now();
    this.floats = this.floats.filter((f) => {
      if (now > f.until) { f.el.remove(); return false; }
      this.placeFloat(f);
      return true;
    });
    const seen = new Set<number>();
    for (const b of bars) {
      seen.add(b.id);
      let el = this.hpBars.get(b.id);
      if (!b.show || !b.pos || !b.pos.visible) { if (el) el.style.opacity = "0"; continue; }
      if (!el) {
        el = document.createElement("div");
        el.className = `hpb ${b.team === "hero" ? "hero" : ""}`;
        el.innerHTML = "<i></i>";
        this.world.appendChild(el);
        this.hpBars.set(b.id, el);
      }
      el.style.opacity = "1";
      el.style.left = `${b.pos.x}px`;
      el.style.top = `${b.pos.y}px`;
      (el.firstChild as HTMLElement).style.width = `${Math.max(0, (b.hp / b.maxHp) * 100)}%`;
    }
    for (const [id, el] of this.hpBars) if (!seen.has(id)) { el.remove(); this.hpBars.delete(id); }
  }
}

function weaponIcon(cls: ClassId): string {
  return cls === "rogue" ? "dagger" : cls === "wizard" ? "sword" : "sword";
}

function themeName(depth: number): string {
  const names = ["The Cellars of Hollowmere", "The Ossuary", "The Drowned Forge", "The Gloomvaults", "The Ember Throne"];
  return names[Math.min(depth, names.length) - 1];
}
