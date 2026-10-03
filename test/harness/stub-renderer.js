/** Test double for the WebGL renderer. The real one needs a GL context, which
 *  does not exist under jsdom. worldFor() must return real physics worlds
 *  because main.js feeds them to the shared integrator. */
import { getMapBoxes } from '../../js/shared/maps.js';
import { buildWorld } from '../../js/shared/physics.js';

const worlds = new Map();

export async function loadThree() { return { __stub: true }; }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.teamColors = { a: 0x4f9cff, b: 0xff5a4a };
    this.mapLoadedFor = null;
  }

  worldFor(mapId) {
    let w = worlds.get(mapId);
    if (!w) { w = buildWorld(getMapBoxes(mapId)); worlds.set(mapId, w); }
    return w;
  }

  loadMap(mapId) { this.mapLoadedFor = mapId; }
  project() { return { x: 0, y: 0, onScreen: true, dist: 0 }; }
  addExplosion() {}
  addImpact() {}
  addTracer() {}
  clearPlayers() {}
  removePlayer() {}
  render() {}
  resize() {}
  setMuzzleFlash() {}
  setViewModel() {}
  syncEntities() {}
  update() {}
  updatePlayer() {}
  updateViewModel() {}
}
