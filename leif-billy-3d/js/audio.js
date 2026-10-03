// Procedural ljud (WebAudio) – helt originalsyntetiserat, inga samples.
let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function initAudio() { ac(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }

function env(g, t0, a, d, peak = 1) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function tone({ freq = 440, type = 'sine', dur = 0.2, attack = 0.005, peak = 0.5, slide = 0, delay = 0 }) {
  if (muted) return;
  const c = ac();
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  env(g, t0, attack, dur, peak);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + attack + 0.05);
}

function noise({ dur = 0.2, peak = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, slide = 0 }) {
  if (muted) return;
  const c = ac();
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  const g = c.createGain();
  env(g, t0, 0.005, dur, peak);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

export const SFX = {
  coin()    { tone({ freq: 988, type: 'square', dur: 0.07, peak: 0.22 }); tone({ freq: 1319, type: 'square', dur: 0.16, peak: 0.22, delay: 0.07 }); },
  snus()    { tone({ freq: 300, type: 'sawtooth', dur: 0.1, peak: 0.25, slide: 500 }); noise({ dur: 0.18, freq: 2600, peak: 0.15 }); },
  boost()   { tone({ freq: 220, type: 'sawtooth', dur: 0.35, peak: 0.3, slide: 660 }); noise({ dur: 0.3, freq: 900, peak: 0.2, slide: 2400 }); },
  jump()    { tone({ freq: 320, type: 'triangle', dur: 0.16, peak: 0.3, slide: 300 }); },
  land()    { noise({ dur: 0.09, freq: 260, peak: 0.25, type: 'lowpass' }); },
  step()    { noise({ dur: 0.05, freq: 420 + Math.random() * 160, peak: 0.07, type: 'lowpass' }); },
  caught()  { tone({ freq: 196, type: 'sawtooth', dur: 0.5, peak: 0.4, slide: -120 }); tone({ freq: 147, type: 'square', dur: 0.7, peak: 0.3, delay: 0.12, slide: -60 }); noise({ dur: 0.4, freq: 500, peak: 0.25, slide: -300 }); },
  alert()   { tone({ freq: 660, type: 'square', dur: 0.09, peak: 0.2 }); tone({ freq: 660, type: 'square', dur: 0.09, peak: 0.2, delay: 0.13 }); },
  level()   { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, peak: 0.3, delay: i * 0.11 })); },
  over()    { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.3, peak: 0.28, delay: i * 0.16 })); },
  win()     { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.25, peak: 0.22, delay: i * 0.12 })); },
  moose()   { tone({ freq: 140, type: 'sawtooth', dur: 0.7, peak: 0.35, slide: -60 }); tone({ freq: 98, type: 'sawtooth', dur: 0.9, peak: 0.3, delay: 0.1, slide: -40 }); },
  click()   { tone({ freq: 700, type: 'square', dur: 0.05, peak: 0.15 }); },
};

// enkel slinga i "visstil" (originaalkomposition) som ambient musik
let musicTimer = null;
const MELODY = [0, 3, 5, 7, 5, 3, 0, -2, 0, 3, 5, 8, 7, 5, 3, 1];
const BASE = 196; // g3
function semi(n) { return BASE * Math.pow(2, n / 12); }

export function startMusic() {
  if (musicTimer || muted) return;
  let i = 0;
  musicTimer = setInterval(() => {
    if (muted) return;
    const n = MELODY[i % MELODY.length];
    tone({ freq: semi(n), type: 'triangle', dur: 0.34, peak: 0.10 });
    if (i % 4 === 0) tone({ freq: semi(n - 12) / 2, type: 'sine', dur: 0.5, peak: 0.12 });
    if (i % 8 === 4) noise({ dur: 0.05, freq: 5000, peak: 0.02 });
    i++;
  }, 260);
}
export function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
