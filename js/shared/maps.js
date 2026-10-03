/**
 * Preset maps. Each map is described with a tiny builder DSL and compiled into a
 * flat list of AABB tuples [cx,cy,cz,sx,sy,sz,color,kind] that both the renderer
 * and the physics world consume — so what you see is exactly what you collide with.
 */

const C = {
  rust: ['#8d6f4f', '#6f563d', '#4a4038', '#9c4f3a', '#c2a06a'],
  urban: ['#9aa0a6', '#6b7280', '#b9c0c7', '#4d5560', '#d8dde2'],
  desert: ['#c8a97a', '#a98a5f', '#7d6a4d', '#e0cba3', '#8f7a55'],
  depot: ['#5d6470', '#3f454f', '#7b828d', '#2f343c', '#99a1ab'],
  snow: ['#dfe7ef', '#b9c6d4', '#8d9cad', '#f2f6fa', '#6f7f92']
};

function builder() {
  const boxes = [];
  const push = (x, y, z, sx, sy, sz, color, kind = 'solid') =>
    boxes.push([round2(x), round2(y), round2(z), round2(sx), round2(sy), round2(sz), color, kind]);
  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    boxes,
    box: push,
    /** Floor slab whose top surface sits at y = 0. */
    floor(w, d, color, y = 0) { push(0, y - 0.5, 0, w, 1, d, color); },
    /** Four perimeter walls. */
    walls(w, d, h, color, t = 1) {
      push(0, h / 2, -d / 2 - t / 2, w + t * 2, h, t, color);
      push(0, h / 2, d / 2 + t / 2, w + t * 2, h, t, color);
      push(-w / 2 - t / 2, h / 2, 0, t, h, d, color);
      push(w / 2 + t / 2, h / 2, 0, t, h, d, color);
    },
    /** Rising staircase. dir 'x+' | 'x-' | 'z+' | 'z-' */
    stairs(x, y, z, steps, stepH, stepD, width, color, dir = 'x+') {
      for (let i = 0; i < steps; i++) {
        const h = stepH * (i + 1);
        const off = stepD * i + stepD / 2;
        if (dir === 'x+') push(x + off, y + h / 2, z, stepD, h, width, color);
        if (dir === 'x-') push(x - off, y + h / 2, z, stepD, h, width, color);
        if (dir === 'z+') push(x, y + h / 2, z + off, width, h, stepD, color);
        if (dir === 'z-') push(x, y + h / 2, z - off, width, h, stepD, color);
      }
    },
    /** Grid of columns. */
    columns(xs, zs, sx, sy, sz, color) {
      for (const x of xs) for (const z of zs) push(x, sy / 2, z, sx, sy, sz, color);
    },
    /** Ring of small cover blocks around a point. */
    coverRing(cx, cz, r, count, sx, sy, sz, color, seedPhase = 0) {
      for (let i = 0; i < count; i++) {
        const a = seedPhase + (i / count) * Math.PI * 2;
        push(cx + Math.cos(a) * r, sy / 2, cz + Math.sin(a) * r, sx, sy, sz, color);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* 1. RUST — tiny industrial yard, three lanes, non-stop action        */
/* ------------------------------------------------------------------ */
function makeRust() {
  const b = builder();
  const [main, dark, trim, accent, sand] = C.rust;
  b.floor(38, 38, '#5b4a39');
  b.walls(38, 38, 12, dark);
  b.box(0, 0.02, 0, 38, 0.04, 38, '#6b5844');

  // Shipping containers + crates
  b.box(-8, 1.6, -6, 7, 3.2, 2.8, accent);
  b.box(8, 1.6, 6, 7, 3.2, 2.8, accent);
  b.box(0, 1.6, 0, 3.4, 3.2, 3.4, main);
  b.box(0, 4.8, 0, 3.4, 3.2, 3.4, trim);
  b.box(-11, 1.6, 8, 3.2, 3.2, 3.2, main);
  b.box(11, 1.6, -8, 3.2, 3.2, 3.2, main);
  b.box(4.5, 1, 9, 2, 2, 2, sand);
  b.box(4.5, 3, 9, 2, 2, 2, sand);
  b.box(-5, 1, -11, 2, 2, 2, sand);
  b.box(13, 1, 11, 2.4, 2, 2.4, trim);

  // Raised platforms with stairs on both sides
  b.box(-13.5, 2, 2.5, 7, 4, 8, dark);
  b.box(13.5, 2, -2.5, 7, 4, 8, dark);
  b.stairs(-9.6, 0, 2.5, 5, 0.8, 0.8, 3, main, 'x-');
  b.stairs(9.6, 0, -2.5, 5, 0.8, 0.8, 3, main, 'x+');

  // Mid walls creating three lanes
  b.box(0, 1.2, -10, 12, 2.4, 1, trim);
  b.box(0, 1.2, 10, 12, 2.4, 1, trim);
  b.box(-14, 1, 12, 1, 2, 6, main);
  b.box(14, 1, -12, 1, 2, 6, main);

  return {
    id: 'rust',
    name: 'Rust',
    subtitle: 'Industrial yard',
    size: 'small',
    players: '2-12',
    theme: {
      sky: '#c9a27a', skyBottom: '#f0d3a8', fog: '#d9b48c', fogDensity: 0.012,
      sun: { color: '#fff1d6', intensity: 2.6, dir: [-0.45, 0.82, -0.35] },
      ambient: '#8d7a63', ground: '#5b4a39'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-15, 0.2, 14], [-13, 0.2, 16], [-16, 0.2, 11], [-11, 0.2, 15], [-15, 0.2, 8], [-17, 0.2, 13]],
      b: [[15, 0.2, -14], [13, 0.2, -16], [16, 0.2, -11], [11, 0.2, -15], [15, 0.2, -8], [17, 0.2, -13]]
    },
    flags: [
      { id: 'A', x: -13.5, z: 13.5, r: 3.2 },
      { id: 'B', x: 0, z: 0, r: 3.6 },
      { id: 'C', x: 13.5, z: -13.5, r: 3.2 }
    ],
    sites: [
      { id: 'A', x: -8, z: 2, r: 3.4 },
      { id: 'B', x: 8, z: -2, r: 3.4 }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 2. SUBURBIA — two houses, one street, long sightlines down the road */
/* ------------------------------------------------------------------ */
function makeSuburbia() {
  const b = builder();
  const [light, mid, trim, dark, white] = C.urban;
  b.floor(60, 34, '#4c5142');
  b.walls(60, 34, 10, dark);
  b.box(0, 0.03, 0, 8, 0.06, 34, '#3b3f46'); // asphalt road

  // House A (west)
  b.box(-16, 2.2, -9, 14, 4.4, 11, light);
  b.box(-16, 5.2, -9, 15, 1.6, 12, '#8a5a3c');
  b.box(-13, 2.2, -3.2, 4, 4.4, 1, mid);   // porch wall
  b.box(-19, 2.2, -3.2, 4, 4.4, 1, mid);
  b.box(-16, 3.4, 3, 14, 0.6, 6, trim);    // flat roof edge over yard
  b.box(-22, 1, -14, 3, 2, 3, white);

  // House B (east)
  b.box(16, 2.2, 9, 14, 4.4, 11, light);
  b.box(16, 5.2, 9, 15, 1.6, 12, '#8a5a3c');
  b.box(13, 2.2, 3.2, 4, 4.4, 1, mid);
  b.box(19, 2.2, 3.2, 4, 4.4, 1, mid);
  b.box(22, 1, 14, 3, 2, 3, white);

  // Street cover: cars, fences, bus stop
  b.box(-6, 0.9, -6, 4.4, 1.8, 2.2, '#a33b3b');
  b.box(6, 0.9, 6, 4.4, 1.8, 2.2, '#2f5fa3');
  b.box(0, 1, 0, 3, 2, 3, mid);
  b.box(-3, 1, 11, 6, 2, 1, trim);
  b.box(3, 1, -11, 6, 2, 1, trim);
  b.box(-9, 1.1, 3, 1, 2.2, 8, white);
  b.box(9, 1.1, -3, 1, 2.2, 8, white);
  b.box(0, 1.5, -13, 5, 3, 1.2, trim);

  // Side ramps up to the roofs
  b.stairs(-24, 0, -9, 6, 0.75, 0.9, 3, mid, 'x+');
  b.stairs(24, 0, 9, 6, 0.75, 0.9, 3, mid, 'x-');
  b.box(-16, 4.6, -9, 13, 0.4, 10, '#7d5236');
  b.box(16, 4.6, 9, 13, 0.4, 10, '#7d5236');

  return {
    id: 'suburbia',
    name: 'Suburbia',
    subtitle: 'Quiet street, loud guns',
    size: 'medium',
    players: '4-16',
    theme: {
      sky: '#7fb2e5', skyBottom: '#cfe6f7', fog: '#a9c8e2', fogDensity: 0.0075,
      sun: { color: '#fff6e0', intensity: 3.0, dir: [-0.3, 0.9, 0.32] },
      ambient: '#93a7bd', ground: '#4c5142'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-26, 0.2, -12], [-26, 0.2, -6], [-24, 0.2, -15], [-27, 0.2, 2], [-22, 0.2, -2], [-26, 0.2, 6]],
      b: [[26, 0.2, 12], [26, 0.2, 6], [24, 0.2, 15], [27, 0.2, -2], [22, 0.2, 2], [26, 0.2, -6]]
    },
    flags: [
      { id: 'A', x: -16, z: -3, r: 3.4 },
      { id: 'B', x: 0, z: 0, r: 3.6 },
      { id: 'C', x: 16, z: 3, r: 3.4 }
    ],
    sites: [
      { id: 'A', x: -8, z: -6, r: 3.6 },
      { id: 'B', x: 8, z: 6, r: 3.6 }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 3. SKYLINE — rooftop, tight corners, deadly drops blocked by glass  */
/* ------------------------------------------------------------------ */
function makeSkyline() {
  const b = builder();
  const [light, mid, trim, dark, glass] = C.urban;
  b.floor(40, 40, '#3d434c');
  b.walls(40, 40, 3, '#2b3038');
  b.box(0, 3.4, 0, 40, 0.8, 0.4, '#7f8b99');
  b.box(0, 3.4, -20, 40, 0.8, 0.4, '#7f8b99');
  b.box(0, 0.03, 0, 40, 0.06, 40, '#4a5058');

  // Central AC block + stair tower
  b.box(0, 2, 0, 10, 4, 10, mid);
  b.box(0, 4.6, 0, 11, 1.2, 11, trim);
  b.stairs(5.5, 0, 0, 6, 0.78, 0.85, 3.4, dark, 'x+');
  b.box(0, 5.4, 0, 10, 0.4, 10, light);

  // Corner structures
  b.box(-14, 1.5, -14, 7, 3, 7, light);
  b.box(14, 1.5, 14, 7, 3, 7, light);
  b.box(-14, 1.5, 14, 5, 3, 5, mid);
  b.box(14, 1.5, -14, 5, 3, 5, mid);
  b.stairs(-9.5, 0, -14, 4, 0.8, 0.85, 3, dark, 'x-');
  b.stairs(9.5, 0, 14, 4, 0.8, 0.85, 3, dark, 'x+');
  b.box(-14, 3.3, -14, 6.6, 0.6, 6.6, trim);
  b.box(14, 3.3, 14, 6.6, 0.6, 6.6, trim);

  // Perimeter ducts and cover
  b.columns([-18, -6, 6, 18], [-18, 18], 1.6, 1.4, 1.6, dark);
  b.box(-6, 1, 12, 8, 2, 1.2, glass);
  b.box(6, 1, -12, 8, 2, 1.2, glass);
  b.box(17, 1, 4, 1.4, 2, 6, trim);
  b.box(-17, 1, -4, 1.4, 2, 6, trim);
  b.box(0, 1, 16, 6, 2, 1.6, mid);
  b.box(0, 1, -16, 6, 2, 1.6, mid);

  return {
    id: 'skyline',
    name: 'Skyline',
    subtitle: 'Rooftop at dusk',
    size: 'medium',
    players: '4-16',
    theme: {
      sky: '#2b3f66', skyBottom: '#f08a5d', fog: '#5d6a86', fogDensity: 0.009,
      sun: { color: '#ffb27a', intensity: 2.2, dir: [0.55, 0.5, -0.66] },
      ambient: '#5b6480', ground: '#3d434c'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-18, 0.2, 15], [-13, 0.2, 17], [-17, 0.2, 12], [-10, 0.2, 16], [-17, 0.2, 6], [-8, 0.2, 17]],
      b: [[18, 0.2, -15], [13, 0.2, -17], [17, 0.2, -12], [10, 0.2, -16], [17, 0.2, -6], [8, 0.2, -17]]
    },
    flags: [
      { id: 'A', x: -14, z: -14, r: 3.2 },
      { id: 'B', x: 0, z: 0, r: 3.8 },
      { id: 'C', x: 14, z: 14, r: 3.2 }
    ],
    sites: [
      { id: 'A', x: -7, z: 7, r: 3.4 },
      { id: 'B', x: 7, z: -7, r: 3.4 }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 4. SANDSTORM — big desert compound, long lanes, vehicle wrecks      */
/* ------------------------------------------------------------------ */
function makeSandstorm() {
  const b = builder();
  const [sand, dark, mid, light, rock] = C.desert;
  b.floor(80, 80, '#b99a6b');
  b.walls(80, 80, 9, dark);

  // Central compound with two entrances
  b.box(0, 2.5, 0, 18, 5, 1.2, light);
  b.box(0, 2.5, -14, 1.2, 5, 28, light);
  b.box(0, 2.5, 14, 1.2, 5, 28, light);
  b.box(-9, 2.5, 0, 1.2, 5, 20, light);
  b.box(9, 2.5, 0, 1.2, 5, 20, light);
  b.box(0, 2.5, -14, 12, 5, 1.2, light);
  b.box(0, 2.5, 14, 12, 5, 1.2, light);
  b.stairs(-4, 0, -13, 6, 0.85, 0.9, 3, mid, 'z+');
  b.stairs(4, 0, 13, 6, 0.85, 0.9, 3, mid, 'z-');
  b.box(0, 5.6, 0, 8, 0.5, 8, mid);

  // Corner compounds (team sides)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(27 * sx, 1.6, 27 * sz, 8, 3.2, 8, sand);
      b.box(27 * sx, 3.4, 27 * sz, 8.6, 0.6, 8.6, mid);
      b.box(27 * sx, 1.2, 27 * sz - 6.4 * sz, 4, 2.4, 1, rock);
    }
  }
  // Stairs butt right up against the compound face so the roof is reachable.
  b.stairs(19, 0, 27, 4, 0.8, 1.0, 3, mid, 'x+');
  b.stairs(-19, 0, -27, 4, 0.8, 1.0, 3, mid, 'x-');

  // Vehicle wrecks + rocks along the lanes
  b.box(-20, 1.1, 8, 6, 2.2, 2.6, '#7a6a52');
  b.box(20, 1.1, -8, 6, 2.2, 2.6, '#7a6a52');
  b.box(8, 1.1, 22, 2.6, 2.2, 6, '#7a6a52');
  b.box(-8, 1.1, -22, 2.6, 2.2, 6, '#7a6a52');
  b.coverRing(0, 26, 8, 6, 2.4, 2.2, 2.4, rock, 0.4);
  b.coverRing(0, -26, 8, 6, 2.4, 2.2, 2.4, rock, 0.9);
  b.columns([-30, -14, 14, 30], [-14, 0, 14], 2, 2.4, 2, rock);

  return {
    id: 'sandstorm',
    name: 'Sandstorm',
    subtitle: 'Open desert lanes',
    size: 'large',
    players: '6-24',
    theme: {
      sky: '#e3c088', skyBottom: '#f7e2b8', fog: '#dcb87f', fogDensity: 0.006,
      sun: { color: '#fff3d0', intensity: 3.3, dir: [-0.2, 0.92, 0.34] },
      ambient: '#b39a72', ground: '#b99a6b'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-34, 0.2, 34], [-30, 0.2, 36], [-36, 0.2, 30], [-28, 0.2, 34], [-36, 0.2, 24], [-32, 0.2, 30]],
      b: [[34, 0.2, -34], [30, 0.2, -36], [36, 0.2, -30], [28, 0.2, -34], [36, 0.2, -24], [32, 0.2, -30]]
    },
    flags: [
      { id: 'A', x: -22, z: 22, r: 4 },
      { id: 'B', x: 0, z: 0, r: 4.4 },
      { id: 'C', x: 22, z: -22, r: 4 }
    ],
    sites: [
      { id: 'A', x: -14, z: 8, r: 4 },
      { id: 'B', x: 14, z: -8, r: 4 }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 5. DEPOT — indoor warehouse, catwalks, close quarters (FFA heaven)  */
/* ------------------------------------------------------------------ */
function makeDepot() {
  const b = builder();
  const [main, dark, trim, black, light] = C.depot;
  b.floor(48, 36, '#363b43');
  b.walls(48, 36, 11, black);
  b.box(0, 0.03, 0, 48, 0.06, 36, '#404651');

  // Columns
  b.columns([-18, -9, 0, 9, 18], [-11, 0, 11], 1.2, 9, 1.2, dark);

  // Catwalks around the perimeter
  b.box(0, 4, -15.5, 44, 0.5, 4, trim);
  b.box(0, 4, 15.5, 44, 0.5, 4, trim);
  b.box(-22, 4, 0, 4, 0.5, 26, trim);
  b.box(22, 4, 0, 4, 0.5, 26, trim);
  b.stairs(-19, 0, -8, 6, 0.7, 0.9, 2.4, main, 'z+');
  b.stairs(19, 0, 8, 6, 0.7, 0.9, 2.4, main, 'z-');
  b.stairs(-8, 0, -14, 6, 0.7, 0.9, 2.4, main, 'x+');
  b.stairs(8, 0, 14, 6, 0.7, 0.9, 2.4, main, 'x-');

  // Stacked crates in the middle
  b.box(-5, 1.2, 0, 3, 2.4, 3, main);
  b.box(-5, 3.6, 0, 3, 2.4, 3, trim);
  b.box(5, 1.2, 0, 3, 2.4, 3, main);
  b.box(5, 3.6, 0, 3, 2.4, 3, trim);
  b.box(0, 1.2, 6, 3, 2.4, 3, main);
  b.box(0, 1.2, -6, 3, 2.4, 3, main);
  b.box(12, 1.6, -6, 6, 3.2, 2.4, '#5a6472');
  b.box(-12, 1.6, 6, 6, 3.2, 2.4, '#5a6472');
  b.coverRing(0, 0, 11, 8, 2, 2, 2, main, 0.2);
  b.box(-16, 1, 10, 4, 2, 1, light);
  b.box(16, 1, -10, 4, 2, 1, light);

  return {
    id: 'depot',
    name: 'Depot',
    subtitle: 'Warehouse close quarters',
    size: 'medium',
    players: '4-16',
    theme: {
      sky: '#20242b', skyBottom: '#3a4049', fog: '#252a31', fogDensity: 0.016,
      sun: { color: '#ffe9c2', intensity: 1.7, dir: [-0.3, 0.95, -0.1] },
      ambient: '#4e5663', ground: '#363b43'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-20, 0.2, -14], [-17, 0.2, -15], [-21, 0.2, -10], [-14, 0.2, -14], [-21, 0.2, -5], [-16, 0.2, -16]],
      b: [[20, 0.2, 14], [17, 0.2, 15], [21, 0.2, 10], [14, 0.2, 14], [21, 0.2, 5], [16, 0.2, 16]]
    },
    flags: [
      { id: 'A', x: -14, z: 0, r: 3.4 },
      { id: 'B', x: 0, z: 0, r: 3.8 },
      { id: 'C', x: 14, z: 0, r: 3.4 }
    ],
    sites: [
      { id: 'A', x: -8, z: -6, r: 3.6 },
      { id: 'B', x: 8, z: 6, r: 3.6 }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 6. OUTPOST — snowy mountain base, medium-long engagements           */
/* ------------------------------------------------------------------ */
function makeOutpost() {
  const b = builder();
  const [snow, mid, dark, white, rock] = C.snow;
  b.floor(58, 58, '#cdd8e4');
  b.walls(58, 58, 10, dark);

  // Main bunker
  b.box(0, 2, -16, 20, 4, 10, mid);
  b.box(0, 4.4, -16, 21, 0.8, 11, white);
  b.box(-6, 2, -10.6, 3.4, 4, 1.2, mid);
  b.box(6, 2, -10.6, 3.4, 4, 1.2, mid);
  b.stairs(-11, 0, -16, 5, 0.8, 0.9, 3, snow, 'x+');
  b.stairs(11, 0, -16, 5, 0.8, 0.9, 3, snow, 'x-');

  // Radar tower
  b.box(18, 4, 16, 5, 8, 5, mid);
  b.box(18, 8.4, 16, 6, 0.8, 6, white);
  b.stairs(14.5, 0, 16, 9, 0.9, 0.9, 2.6, snow, 'x+');

  // Snow berms / crates / rocks
  b.box(-18, 1.4, 14, 12, 2.8, 2.4, snow);
  b.box(-2, 1.2, 6, 4, 2.4, 4, mid);
  b.box(8, 1.2, -2, 4, 2.4, 4, mid);
  b.box(-10, 1.2, -4, 4, 2.4, 4, mid);
  b.coverRing(0, 18, 9, 7, 2.6, 2.4, 2.6, rock, 0.6);
  b.columns([-21, -11, 11, 21], [-21, 0, 21], 1.8, 2.2, 1.8, rock);
  b.box(0, 1, 24, 8, 2, 1.4, snow);
  b.box(-24, 1, 2, 1.4, 2, 8, snow);

  return {
    id: 'outpost',
    name: 'Outpost',
    subtitle: 'Frozen radar station',
    size: 'large',
    players: '6-20',
    theme: {
      sky: '#9db4cc', skyBottom: '#e7f0f8', fog: '#c9d7e6', fogDensity: 0.0085,
      sun: { color: '#eaf4ff', intensity: 2.7, dir: [0.4, 0.8, -0.45] },
      ambient: '#a8bccf', ground: '#cdd8e4'
    },
    boxes: b.boxes,
    spawns: {
      a: [[-24, 0.2, -24], [-20, 0.2, -26], [-26, 0.2, -20], [-18, 0.2, -24], [-26, 0.2, -14], [-28, 0.2, -28]],
      b: [[24, 0.2, 24], [20, 0.2, 26], [26, 0.2, 20], [18, 0.2, 24], [26, 0.2, 14], [28, 0.2, 28]]
    },
    flags: [
      { id: 'A', x: -16, z: 8, r: 3.6 },
      { id: 'B', x: 0, z: -6, r: 3.8 },
      { id: 'C', x: 16, z: 12, r: 3.6 }
    ],
    sites: [
      { id: 'A', x: -8, z: 2, r: 3.8 },
      { id: 'B', x: 8, z: -2, r: 3.8 }
    ]
  };
}

const MAPS = [makeRust(), makeSuburbia(), makeSkyline(), makeSandstorm(), makeDepot(), makeOutpost()];

export const MAP_LIST = MAPS.map((m) => ({
  id: m.id, name: m.name, subtitle: m.subtitle, size: m.size, players: m.players
}));

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

/** Clone the compiled box tuples so a consumer can't mutate the source data. */
export function getMapBoxes(id) {
  return getMap(id).boxes.map((b) => b.slice());
}

export { MAPS };
