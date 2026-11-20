interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done: () => void;
}

/** Tiny promise-based tween runner driven by the render loop. */
export class Tweens {
  private list: Tween[] = [];
  /** Playback speed: 1 normal, 2 fast. */
  speed = 1;

  add(dur: number, step: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) { step(1); resolve(); return; }
      this.list.push({ t: 0, dur, step, done: resolve });
    });
  }

  wait(sec: number): Promise<void> {
    return this.add(sec, () => {});
  }

  update(dt: number): void {
    const d = dt * this.speed;
    const current = this.list;
    this.list = [];
    const keep: Tween[] = [];
    for (const tw of current) {
      tw.t += d;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) tw.done(); else keep.push(tw);
    }
    // Anything added during a step landed in the fresh list: keep it too.
    this.list = keep.concat(this.list);
  }
}

export const ease = {
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t: number) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};
