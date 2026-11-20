/**
 * Every sound is synthesised on the fly with Web Audio: zero downloads, zero licences.
 * The audio context starts on the first tap or click (browsers require a gesture).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.0;
    this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Fade the dungeon ambience in or out. */
  ambience(on: boolean): void {
    if (!this.ctx) return;
    this.ambBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 1.2);
  }

  // ------------------------------------------------------------ building blocks

  /** Safe before the first tap: with no audio context every sound is simply silent. */
  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseHit(o: { t?: number; type?: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; decay: number; sweepTo?: number; bus?: GainNode }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = o.t ?? this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.attack ?? 0.005) + o.decay);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.attack ?? 0.005, o.decay);
    src.connect(f).connect(g).connect(o.bus ?? this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
  }

  private tone(o: { t?: number; type?: OscillatorType; freq: number; to?: number; peak: number; attack?: number; decay: number; bus?: GainNode; detune?: number }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = o.t ?? this.now();
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.01) + o.decay);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.attack ?? 0.01, o.decay);
    osc.connect(g).connect(o.bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.01) + o.decay + 0.05);
  }

  // ------------------------------------------------------------ the sounds

  step(): void {
    this.noiseHit({ type: "lowpass", freq: 500 + Math.random() * 200, peak: 0.12, decay: 0.07 });
  }

  swing(): void {
    this.noiseHit({ freq: 900, sweepTo: 2600, q: 2, peak: 0.25, attack: 0.04, decay: 0.12 });
  }

  hit(heavy = false): void {
    this.noiseHit({ type: "lowpass", freq: heavy ? 900 : 1500, peak: heavy ? 0.7 : 0.5, decay: heavy ? 0.22 : 0.14 });
    this.tone({ type: "triangle", freq: heavy ? 110 : 160, to: 50, peak: heavy ? 0.6 : 0.4, decay: 0.18 });
  }

  clang(): void {
    this.tone({ type: "square", freq: 1800, to: 1500, peak: 0.07, decay: 0.25 });
    this.tone({ type: "sine", freq: 2600, peak: 0.08, decay: 0.35 });
    this.noiseHit({ freq: 4000, q: 3, peak: 0.2, decay: 0.08 });
  }

  miss(): void {
    this.noiseHit({ freq: 1400, sweepTo: 500, q: 1.5, peak: 0.18, attack: 0.03, decay: 0.16 });
  }

  crit(): void {
    this.hit(true);
    const t = this.now() + 0.05;
    for (const [i, f] of [523, 784, 1046].entries()) this.tone({ t: t + i * 0.04, type: "triangle", freq: f, peak: 0.12, decay: 0.4 });
  }

  arrow(): void {
    this.noiseHit({ freq: 3000, sweepTo: 1200, q: 4, peak: 0.12, attack: 0.01, decay: 0.2 });
  }

  fire(big = false): void {
    this.noiseHit({ type: "lowpass", freq: big ? 2500 : 1800, sweepTo: 200, peak: big ? 0.9 : 0.45, attack: 0.02, decay: big ? 1.1 : 0.45 });
    if (big) this.tone({ type: "sawtooth", freq: 80, to: 30, peak: 0.5, decay: 0.9 });
  }

  magic(): void {
    const t = this.now();
    for (let i = 0; i < 5; i++) this.tone({ t: t + i * 0.035, type: "sine", freq: 900 + i * 220, peak: 0.07, decay: 0.3 });
  }

  holy(): void {
    const t = this.now();
    for (const [i, f] of [392, 494, 587, 784].entries()) this.tone({ t: t + i * 0.02, type: "sine", freq: f, peak: 0.1, attack: 0.08, decay: 0.9 });
  }

  heal(): void {
    const t = this.now();
    for (const [i, f] of [523, 659, 784, 1046].entries()) this.tone({ t: t + i * 0.08, type: "triangle", freq: f, peak: 0.09, decay: 0.5 });
  }

  door(): void {
    this.tone({ type: "sawtooth", freq: 140, to: 90, peak: 0.06, attack: 0.05, decay: 0.5 });
    this.noiseHit({ type: "lowpass", freq: 400, peak: 0.25, decay: 0.25, t: this.ctx ? this.now() + 0.35 : 0 });
  }

  chest(): void {
    this.door();
    const t = this.now() + 0.3;
    for (let i = 0; i < 6; i++) this.tone({ t: t + i * 0.05, type: "triangle", freq: 1400 + Math.random() * 1400, peak: 0.06, decay: 0.15 });
  }

  coin(): void {
    const t = this.now();
    this.tone({ t, type: "square", freq: 1318, peak: 0.05, decay: 0.08 });
    this.tone({ t: t + 0.07, type: "square", freq: 1760, peak: 0.05, decay: 0.2 });
  }

  dice(): void {
    const t = this.now();
    for (let i = 0; i < 5; i++) this.noiseHit({ t: t + i * 0.05 + Math.random() * 0.03, freq: 2500 + Math.random() * 1500, q: 6, peak: 0.12, decay: 0.03 });
  }

  click(): void {
    this.tone({ type: "triangle", freq: 660, peak: 0.06, decay: 0.05 });
  }

  initiative(): void {
    const t = this.now();
    for (let i = 0; i < 3; i++) {
      this.tone({ t: t + i * 0.16, type: "sine", freq: 70, to: 40, peak: 0.8, decay: 0.3 });
      this.noiseHit({ t: t + i * 0.16, type: "lowpass", freq: 300, peak: 0.4, decay: 0.2 });
    }
    this.tone({ t: t + 0.5, type: "sawtooth", freq: 110, peak: 0.12, attack: 0.05, decay: 1.2, detune: 7 });
    this.tone({ t: t + 0.5, type: "sawtooth", freq: 165, peak: 0.08, attack: 0.05, decay: 1.2, detune: -7 });
  }

  levelUp(): void {
    const t = this.now();
    for (const [i, f] of [392, 523, 659, 784, 1046].entries()) this.tone({ t: t + i * 0.09, type: "triangle", freq: f, peak: 0.12, decay: 0.6 });
  }

  death(): void {
    this.tone({ type: "sawtooth", freq: 220, to: 55, peak: 0.15, decay: 0.7 });
    this.noiseHit({ type: "lowpass", freq: 600, peak: 0.3, decay: 0.4 });
  }

  defeat(): void {
    const t = this.now();
    for (const [i, f] of [196, 185, 165, 131].entries()) this.tone({ t: t + i * 0.4, type: "triangle", freq: f, peak: 0.15, attack: 0.05, decay: 0.8 });
  }

  victory(): void {
    const t = this.now();
    for (const [i, f] of [392, 523, 659, 784, 659, 784, 1046].entries()) this.tone({ t: t + i * 0.14, type: "triangle", freq: f, peak: 0.14, decay: 0.5 });
  }

  // ------------------------------------------------------------ ambience

  private startAmbience(): void {
    const ctx = this.ctx!;
    // A low, slowly breathing drone.
    for (const [f, d] of [[55, 0], [82.4, 6], [110, -5]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = d;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 180;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.03;
      lfo.connect(lg).connect(g.gain);
      o.connect(lp).connect(g).connect(this.ambBus);
      o.start();
      lfo.start();
    }
    // Wind through the tunnels.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 400;
    bp.Q.value = 0.7;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(bp.frequency);
    src.connect(bp).connect(wg).connect(this.ambBus);
    src.start();
    lfo.start();
    const drip = () => {
      if (!this.ctx) return;
      const t = this.now();
      const f = 1200 + Math.random() * 1800;
      this.tone({ t, type: "sine", freq: f, to: f * 1.6, peak: 0.05, attack: 0.002, decay: 0.12, bus: this.ambBus });
      window.setTimeout(drip, 1800 + Math.random() * 5000);
    };
    window.setTimeout(drip, 3000);
  }
}
