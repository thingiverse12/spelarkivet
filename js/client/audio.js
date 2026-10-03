/**
 * All sound is synthesized with WebAudio — no asset downloads, no licensing.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.noise = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // One shared noise buffer for guns/explosions/footsteps.
    const len = this.ctx.sampleRate * 1.2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  noiseSource(duration, filterType, freq, q, gain, pan = 0) {
    if (!this.ctx || !this.enabled) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q || 1;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    src.connect(filter);
    filter.connect(g);
    if (panner) { panner.pan.value = pan; g.connect(panner); panner.connect(this.master); }
    else g.connect(this.master);
    src.start(this.time, Math.random() * 0.5);
    src.stop(this.time + duration);
    return { src, filter, gain: g };
  }

  tone(freq, duration, type = 'sine', gain = 0.2, freqEnd = null, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.time + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Distance attenuation + stereo pan from a world position relative to the listener. */
  spatial(pos, listener, yaw) {
    if (!pos || !listener) return { gain: 1, pan: 0 };
    const dx = pos.x - listener.x, dz = pos.z - listener.z;
    const d = Math.hypot(dx, dz);
    const gain = Math.max(0.04, 1 - Math.min(1, d / 55));
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = fz, rz = -fx;
    const dot = (dx * rx + dz * rz) / (d || 1);
    return { gain, pan: Math.max(-1, Math.min(1, dot)) };
  }

  /* ----------------------------- weapon sounds ----------------------------- */

  shot(kind, { gain = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.time;
    const presets = {
      smg: { dur: 0.09, freq: 1800, q: 0.8, g: 0.32, thump: 190 },
      ar: { dur: 0.13, freq: 1400, q: 0.9, g: 0.42, thump: 150 },
      lmg: { dur: 0.17, freq: 1100, q: 0.8, g: 0.5, thump: 120 },
      shotgun: { dur: 0.26, freq: 800, q: 0.6, g: 0.6, thump: 90 },
      sniper: { dur: 0.4, freq: 900, q: 0.5, g: 0.6, thump: 70 },
      pistol: { dur: 0.1, freq: 2000, q: 1, g: 0.3, thump: 220 },
      sentry: { dur: 0.08, freq: 2400, q: 1.2, g: 0.24, thump: 260 },
      heli: { dur: 0.08, freq: 2200, q: 1.1, g: 0.22, thump: 240 }
    };
    const p = presets[kind] || presets.ar;
    const n = this.noiseSource(p.dur, 'lowpass', p.freq, p.q, p.g * gain, pan);
    if (n) {
      n.gain.gain.setValueAtTime(p.g * gain, t);
      n.gain.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
      n.filter.frequency.setValueAtTime(p.freq * 1.6, t);
      n.filter.frequency.exponentialRampToValueAtTime(p.freq * 0.35, t + p.dur);
    }
    this.tone(p.thump, 0.11, 'sine', 0.35 * gain, p.thump * 0.35);
    // Mechanical click
    const click = this.noiseSource(0.02, 'highpass', 3000, 1, 0.12 * gain, pan);
    if (click) click.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  }

  explosion({ gain = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.time;
    const n = this.noiseSource(0.9, 'lowpass', 500, 0.6, 0.8 * gain, pan);
    if (n) {
      n.filter.frequency.setValueAtTime(900, t);
      n.filter.frequency.exponentialRampToValueAtTime(70, t + 0.8);
      n.gain.gain.setValueAtTime(0.9 * gain, t);
      n.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    }
    this.tone(90, 0.7, 'sine', 0.7 * gain, 28);
    this.tone(160, 0.25, 'triangle', 0.3 * gain, 40);
  }

  reload(stage = 0) {
    if (stage === 0) {
      this.tone(320, 0.06, 'square', 0.14, 180);
      this.noiseSource(0.05, 'bandpass', 1200, 3, 0.16);
    } else {
      this.tone(520, 0.07, 'square', 0.16, 300);
      this.noiseSource(0.06, 'bandpass', 1800, 3, 0.18);
    }
  }

  swap() { this.tone(260, 0.05, 'triangle', 0.12, 420); }
  dryfire() { this.noiseSource(0.035, 'highpass', 2600, 2, 0.2); this.tone(900, 0.03, 'square', 0.08, 500); }

  hitmarker(head) {
    this.tone(head ? 1500 : 1000, 0.06, 'square', 0.16, head ? 900 : 700);
    this.tone(head ? 2400 : 1600, 0.05, 'sine', 0.1, 1200, 0.02);
  }

  killConfirm() {
    this.tone(880, 0.09, 'square', 0.2, 660);
    this.tone(1320, 0.14, 'sine', 0.16, 1760, 0.06);
  }

  death() {
    this.tone(220, 0.5, 'sawtooth', 0.2, 60);
    this.noiseSource(0.4, 'lowpass', 600, 1, 0.25);
  }

  footstep(sprint, { gain = 1, pan = 0 } = {}) {
    const g = (sprint ? 0.16 : 0.11) * gain;
    const n = this.noiseSource(0.08, 'lowpass', sprint ? 900 : 600, 1, g, pan);
    if (n) n.gain.gain.exponentialRampToValueAtTime(0.0001, this.time + 0.08);
    this.tone(sprint ? 120 : 90, 0.05, 'sine', g * 0.6, 50);
  }

  grenadeThrow() { this.noiseSource(0.12, 'bandpass', 700, 1.5, 0.2); this.tone(300, 0.1, 'sine', 0.1, 180); }
  bounce() { this.tone(180, 0.05, 'square', 0.1, 120); }
  flash() { this.tone(2600, 0.25, 'sine', 0.16, 400); this.noiseSource(0.3, 'highpass', 3000, 1, 0.2); }
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, f, i * 0.08));
  }
  streakReady() { this.tone(1200, 0.1, 'square', 0.14, 1800); this.tone(1800, 0.14, 'sine', 0.1, 2400, 0.07); }
  uav() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.12, f, i * 0.1)); }
  capture() { [440, 587, 880].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.14, f, i * 0.07)); }
  plant() { this.tone(200, 0.2, 'square', 0.14, 120); this.tone(880, 0.3, 'sine', 0.12, 440, 0.15); }
  ui() { this.tone(700, 0.04, 'square', 0.07, 900); }
  uiBack() { this.tone(400, 0.05, 'square', 0.07, 280); }
  matchFound() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'square', 0.1, f, i * 0.06)); }
  heliLoop(on) {
    if (!this.ctx || !this.enabled) return;
    if (on && !this.heliOsc) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 62;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      osc.connect(filter); filter.connect(g); g.connect(this.master);
      osc.start();
      g.gain.linearRampToValueAtTime(0.09, this.time + 0.6);
      this.heliOsc = { osc, gain: g };
    } else if (!on && this.heliOsc) {
      const { osc, gain } = this.heliOsc;
      gain.gain.linearRampToValueAtTime(0.0001, this.time + 0.4);
      osc.stop(this.time + 0.5);
      this.heliOsc = null;
    }
  }
}

export const audio = new Audio();
