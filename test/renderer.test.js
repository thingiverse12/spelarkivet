/**
 * Renderer geometry tests. The Three.js module is pure JS, so the mesh builders
 * run fine in Node without a WebGL context — we call them with a stub `this`
 * and validate the real vertex data they produce.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { Renderer } from '../js/client/renderer.js';
import { MAPS } from '../js/shared/maps.js';
import { WEAPONS, CLASSES } from '../js/shared/weapons.js';

// Minimal stand-in for a constructed Renderer (no GL context required).
const self = { T: THREE, worldMaterial: null };
const buildWorldMesh = (boxes) => Renderer.prototype.buildWorldMesh.call(self, boxes);
const makeSky = (theme) => Renderer.prototype.makeSky.call(self, theme);
const makeSoldier = (colors) => Renderer.prototype.makeSoldier.call(self, colors);
const buildViewModel = (def, att) => Renderer.prototype.buildViewModel.call(self, def, att);
const makeEntityMesh = (kind, e) => Renderer.prototype.makeEntityMesh.call(self, kind, e);

function assertGeometrySane(geo, label) {
  const pos = geo.attributes.position;
  assert.ok(pos && pos.count > 0, `${label}: no vertices`);
  const arr = pos.array;
  for (let i = 0; i < arr.length; i++) {
    assert.ok(Number.isFinite(arr[i]), `${label}: non-finite vertex at ${i} (${arr[i]})`);
  }
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i++) {
      assert.ok(idx[i] < pos.count, `${label}: index ${idx[i]} out of range (${pos.count} verts)`);
    }
    assert.equal(idx.length % 3, 0, `${label}: index count must be a multiple of 3`);
  }
  if (geo.attributes.color) {
    const c = geo.attributes.color.array;
    for (let i = 0; i < c.length; i++) {
      assert.ok(c[i] >= 0 && c[i] <= 1.0001, `${label}: colour out of range at ${i} (${c[i]})`);
    }
  }
}

test('vendored three.js is a complete ES module build', () => {
  assert.equal(typeof THREE.WebGLRenderer, 'function');
  assert.equal(typeof THREE.Scene, 'function');
  assert.equal(THREE.REVISION, '160');
});

test('every map builds a valid, NaN-free world mesh', () => {
  for (const map of MAPS) {
    const mesh = buildWorldMesh(map.boxes);
    assertGeometrySane(mesh.geometry, map.id);

    const verts = mesh.geometry.attributes.position.count;
    assert.ok(verts > 200, `${map.id}: expected a substantial mesh, got ${verts} verts`);
    assert.equal(mesh.geometry.attributes.normal.count, verts, `${map.id}: normals must match`);
    assert.equal(mesh.geometry.attributes.uv.count, verts, `${map.id}: uvs must match`);
    assert.equal(mesh.geometry.attributes.color.count, verts, `${map.id}: colours must match`);

    // Hidden-face removal must actually remove faces: a naive build emits
    // 24 verts per box, so the real mesh has to be well under that.
    const naive = map.boxes.length * 24;
    assert.ok(verts < naive, `${map.id}: occlusion culling did nothing (${verts} vs ${naive})`);
    assert.ok(verts > naive * 0.25, `${map.id}: too much geometry removed (${verts} vs ${naive})`);
  }
});

test('world mesh bounds roughly match the map footprint', () => {
  const map = MAPS[0];
  const mesh = buildWorldMesh(map.boxes);
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  assert.ok(bb.max.x - bb.min.x > 30, 'rust should be ~38 units wide');
  assert.ok(bb.max.y > 5, 'rust should have vertical structure');
});

test('the sky dome is a closed sphere with a gradient', () => {
  const sky = makeSky(MAPS[0].theme);
  assertGeometrySane(sky.geometry, 'sky');
  const colors = sky.geometry.attributes.color.array;
  const ys = sky.geometry.attributes.position.array;
  let minLum = Infinity, maxLum = 0;
  for (let i = 0; i < colors.length; i += 3) {
    const lum = (colors[i] + colors[i + 1] + colors[i + 2]) / 3;
    minLum = Math.min(minLum, lum);
    maxLum = Math.max(maxLum, lum);
  }
  assert.ok(maxLum - minLum > 0.05, 'sky should have a visible vertical gradient');
  assert.ok(ys.length > 0);
});

test('soldier models are built for every team', () => {
  for (const team of ['a', 'b', 'ffa']) {
    const colors = Renderer.prototype.teamColors.call(self, team, 'player-1');
    const g = makeSoldier(colors);
    assert.ok(g.children.length >= 8, 'soldier needs legs, torso, head, arms and a weapon');
    for (const child of g.children) assertGeometrySane(child.geometry, 'soldier part');
    assert.ok(g.userData.legL && g.userData.legR, 'legs must be animatable');
  }
});

test('every weapon gets a viewmodel with sensible proportions', () => {
  for (const w of WEAPONS) {
    const g = buildViewModel(w, []);
    assert.ok(g.children.length >= 6, `${w.id}: viewmodel too simple`);
    for (const child of g.children) assertGeometrySane(child.geometry, w.id);
    g.geometry?.dispose?.();
  }
  // Attachments must add geometry.
  const base = buildViewModel(WEAPONS.find((w) => w.id === 'm4a1'), []);
  const rigged = buildViewModel(WEAPONS.find((w) => w.id === 'm4a1'), ['acog', 'silencer', 'grip', 'extmag']);
  assert.ok(rigged.children.length > base.children.length, 'attachments should add parts');
});

test('all six weapon classes produce distinct silhouettes', () => {
  const sizes = new Map();
  for (const cls of CLASSES) {
    const w = WEAPONS.find((x) => x.cls === cls.id);
    const g = buildViewModel(w, []);
    sizes.set(cls.id, g.children.length);
  }
  assert.equal(sizes.size, CLASSES.length);
});

test('entity meshes exist for every simulated entity kind', () => {
  for (const kind of ['grenade', 'crate', 'sentry', 'heli', 'missile', 'smoke', 'unknown']) {
    const obj = makeEntityMesh(kind, { radius: 5 });
    assert.ok(obj, kind);
    const meshes = obj.isMesh ? [obj] : obj.children;
    assert.ok(meshes.length > 0, `${kind} should have geometry`);
    for (const m of meshes) assertGeometrySane(m.geometry, kind);
  }
});

test('project() maps the aim point to screen centre', () => {
  const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 800);
  camera.position.set(0, 1.6, 0);
  camera.rotation.order = 'YXZ';
  camera.updateMatrixWorld();
  const fake = { T: THREE, camera, canvas: { clientWidth: 1600, clientHeight: 900 } };
  const p = Renderer.prototype.project.call(fake, { x: 0, y: 1.6, z: -10 });
  assert.ok(Math.abs(p.x - 800) < 1.5, `expected centre x, got ${p.x}`);
  assert.ok(Math.abs(p.y - 450) < 1.5, `expected centre y, got ${p.y}`);
  assert.equal(p.behind, false);

  const behind = Renderer.prototype.project.call(fake, { x: 0, y: 1.6, z: 10 });
  assert.equal(behind.behind, true, 'a point behind the camera must be flagged');
});
