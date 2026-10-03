/** Test double for the 2D canvas HUD (jsdom has no 2D context without the
 *  native canvas package, and the HUD is irrelevant to movement). */
export class Hud {
  constructor() { this.banner = null; this.killfeed = null; }
  setMap() {}
  hitmarker() {}
  damageNumber() {}
  pushKill() {}
  setBanner() {}
  draw() {}
  clear() {}
  resize() {}
}
