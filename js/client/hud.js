/**
 * 2D overlay HUD: crosshair, hitmarkers, damage numbers, minimap, killfeed,
 * objective markers and off-screen threat arrows.
 */
export class Hud {
  constructor(canvas, els) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.els = els;
    this.hitmarks = [];
    this.damageNumbers = [];
    this.killfeed = [];
    this.banner = null;
    this.map = null;
    this.teams = true;
    this.mode = 'tdm';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setMap(map) { this.map = map; }

  /* --------------------------- transient FX --------------------------- */

  hitmarker({ head = false, kill = false } = {}) {
    this.hitmarks.push({ life: kill ? 0.55 : 0.28, max: kill ? 0.55 : 0.28, head, kill });
  }

  damageNumber(amount, screen, head) {
    if (!screen || screen.behind) return;
    this.damageNumbers.push({
      x: screen.x + (Math.random() - 0.5) * 26,
      y: screen.y + (Math.random() - 0.5) * 14,
      life: 0.9, max: 0.9, amount: Math.round(amount), head,
      vy: -34
    });
  }

  pushKill(entry) {
    this.killfeed.unshift(entry);
    if (this.killfeed.length > 5) this.killfeed.pop();
    this.renderKillfeed();
  }

  setBanner(main, sub, duration = 2.4) {
    this.banner = { main, sub, life: duration, max: duration };
    if (this.els.banner) {
      this.els.banner.querySelector('.banner-main').textContent = main || '';
      this.els.banner.querySelector('.banner-sub').textContent = sub || '';
      this.els.banner.classList.toggle('show', !!main);
    }
  }

  renderKillfeed() {
    if (!this.els.killfeed) return;
    this.els.killfeed.innerHTML = this.killfeed.map((k) => {
      const killer = k.killer ? `<span class="kf-name ${k.killerTeam || ''}">${esc(k.killer)}</span>` : '';
      const icon = k.head ? '✸' : (k.cause === 'explosion' || k.cause === 'frag' || k.cause === 'semtex' || k.cause === 'thermite' ? '✹' : k.cause === 'fall' ? '▼' : '→');
      const victim = `<span class="kf-name ${k.victimTeam || ''}">${esc(k.victim)}</span>`;
      return `<div class="kf-row">${killer}<span class="kf-icon">${k.suicide ? '✖' : icon}</span>${victim}</div>`;
    }).join('');
  }

  /* ----------------------------- rendering ----------------------------- */

  draw(state, dt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawMinimap(state);
    this.drawObjectiveMarkers(state);
    this.drawDamageNumbers(dt);
    this.drawHitmarkers(dt);
    this.drawBanner(dt);
    if (state.stun) this.drawStun(state.stun);
  }

  drawHitmarkers(dt) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    for (let i = this.hitmarks.length - 1; i >= 0; i--) {
      const h = this.hitmarks[i];
      h.life -= dt;
      if (h.life <= 0) { this.hitmarks.splice(i, 1); continue; }
      const k = h.life / h.max;
      const gap = 5 + (1 - k) * 6;
      const len = h.kill ? 12 : 8;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.strokeStyle = h.kill ? '#ff5a4d' : (h.head ? '#ffd24d' : '#ffffff');
      ctx.lineWidth = 2.2;
      ctx.translate(cx, cy);
      if (h.kill) ctx.rotate(Math.PI / 4);
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * gap, sy * gap);
        ctx.lineTo(sx * (gap + len), sy * (gap + len));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawDamageNumbers(dt) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.life -= dt;
      d.y += d.vy * dt;
      d.vy += 40 * dt;
      if (d.life <= 0) { this.damageNumbers.splice(i, 1); continue; }
      const k = d.life / d.max;
      ctx.globalAlpha = Math.min(1, k * 1.8);
      ctx.fillStyle = d.head ? '#ffd24d' : '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(String(d.amount), d.x, d.y);
      ctx.fillText(String(d.amount), d.x, d.y);
    }
    ctx.restore();
  }

  drawBanner(dt) {
    if (!this.banner) return;
    this.banner.life -= dt;
    if (this.banner.life <= 0) {
      this.banner = null;
      this.els.banner?.classList.remove('show');
    }
  }

  drawStun(stun) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(0.35, stun * 0.12);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  drawMinimap(state) {
    if (!this.map) return;
    const ctx = this.ctx;
    const size = Math.min(190, this.w * 0.22);
    const pad = 18;
    const cx = pad + size / 2;
    const cy = pad + size / 2;
    const range = 46;            // world units shown
    const scale = (size / 2) / range;
    const me = state.local;
    if (!me) return;

    ctx.save();
    // Frame
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,10,14,0.62)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(190,215,235,0.5)';
    ctx.stroke();
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(me.yaw);
    ctx.scale(scale, scale);

    // Geometry
    ctx.fillStyle = 'rgba(180,200,220,0.32)';
    for (const b of this.map.boxes) {
      const dx = b[0] - me.x, dz = b[2] - me.z;
      if (Math.abs(dx) > range + 8 || Math.abs(dz) > range + 8) continue;
      const rx = -(dz + b[5] / 2), rz = dx - b[3] / 2;
      ctx.fillRect(rx, rz, b[5], b[3]);
    }

    // Objectives
    if (state.flags) {
      for (const f of state.flags) {
        const rx = -(f.z - me.z), rz = f.x - me.x;
        ctx.beginPath();
        ctx.arc(rx, rz, f.r, 0, Math.PI * 2);
        ctx.fillStyle = f.owner === 'a' ? 'rgba(80,140,255,0.35)' : f.owner === 'b' ? 'rgba(255,90,70,0.35)' : 'rgba(255,255,255,0.14)';
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = f.team && f.owner !== f.team ? '#ffd24d' : 'rgba(255,255,255,0.5)';
        ctx.stroke();
      }
    }
    if (state.round && state.round.bombPos) {
      const b = state.round.bombPos;
      const rx = -(b.z - me.z), rz = b.x - me.x;
      ctx.beginPath();
      ctx.arc(rx, rz, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd24d';
      ctx.fill();
    }

    // Players
    for (const p of state.players) {
      if (!p.alive || p.id === state.you) continue;
      const hostile = state.teams ? p.team !== me.team : true;
      const visible = hostile
        ? (state.uavOn || p.spotted)
        : true;
      if (!visible) continue;
      const rx = -(p.z - me.z), rz = p.x - me.x;
      if (Math.hypot(rx, rz) > range) continue;
      ctx.beginPath();
      ctx.arc(rx, rz, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = hostile ? '#ff4b3a' : '#4da3ff';
      ctx.fill();
      ctx.lineWidth = 0.4;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    // Entities (crates, sentries, heli)
    for (const e of state.entities || []) {
      if (e.kind === 'smoke' || e.kind === 'grenade') continue;
      const rx = -(e.z - me.z), rz = e.x - me.x;
      if (Math.hypot(rx, rz) > range) continue;
      ctx.fillStyle = e.team === me.team ? '#4da3ff' : '#ffb347';
      ctx.fillRect(rx - 1.5, rz - 1.5, 3, 3);
    }
    ctx.restore();

    // Player arrow (always centred, pointing up)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // Compass letters
    ctx.save();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(220,235,245,0.8)';
    ctx.fillText('N', cx - Math.sin(-me.yaw) * (size / 2 - 9), cy - Math.cos(-me.yaw) * (size / 2 - 9) + 4);
    ctx.restore();
  }

  drawObjectiveMarkers(state) {
    if (!state.flags || !state.local) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of state.flags) {
      const s = state.project?.({ x: f.x, y: 1.4, z: f.z });
      if (!s || s.behind) continue;
      const color = f.owner === 'a' ? '#4da3ff' : f.owner === 'b' ? '#ff5a46' : '#dfe7ef';
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.fillText(f.id, s.x, s.y);
      if (f.progress > 0 && f.owner !== f.team && f.team) {
        ctx.fillStyle = '#ffd24d';
        ctx.fillRect(s.x - 12, s.y + 4, 24 * f.progress, 3);
      }
    }
    ctx.restore();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.killfeed = [];
    this.renderKillfeed();
    this.damageNumbers = [];
    this.hitmarks = [];
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
