import {
BufferAttribute,
BufferGeometry,
Euler,
Matrix4,
Quaternion,
Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural geometry for the 晨雾琉璃 rotunda. Every shape is generated here
 * from profiles and parametric surfaces; nothing is loaded from disk.
 * Units are metres, y is up, the rotunda centre is the origin.
 */

export type Profile = Array<[number, number]>;

/** Small seeded PRNG so the scene is identical on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Duplicate a profile point so the lathe keeps a crisp crease there. */
export const crease = (r: number, y: number): Profile => [[r, y], [r, y]];

/**
 * Surface of revolution around +y. Profiles run from the outer bottom upward
 * (normals face away from the axis on the way up, upward on inward runs).
 * uv.x is the arc around the axis in metres at radius 1, uv.y the arc length
 * along the profile in metres.
 */
export function lathe(profile: Profile, segments: number, phiStart = 0, phiLength = Math.PI * 2) {
  const rows = profile.length;
  const positions = new Float32Array((segments + 1) * rows * 3);
  const uvs = new Float32Array((segments + 1) * rows * 2);
  const arc = [0];
  for (let i = 1; i < rows; i++) {
    arc.push(arc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  }
  let p = 0;
  let u = 0;
  for (let s = 0; s <= segments; s++) {
    const phi = phiStart + (s / segments) * phiLength;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    for (let i = 0; i < rows; i++) {
      const [r, y] = profile[i];
      positions[p++] = r * sin;
      positions[p++] = y;
      positions[p++] = r * cos;
      uvs[u++] = phi;
      uvs[u++] = arc[i];
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < rows - 1; i++) {
      const a = s * rows + i;
      const b = (s + 1) * rows + i;
      if (profile[i][0] === profile[i + 1][0] && profile[i][1] === profile[i + 1][1]) continue;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Applies a transform built from position / euler rotation / uniform or xyz scale. */
export function placed(geometry: BufferGeometry, position: Vector3 | [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1) {
  const m = new Matrix4();
  const q = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'YXZ'));
  const s = typeof scale === 'number' ? new Vector3(scale, scale, scale) : new Vector3(...scale);
  const pos = position instanceof Vector3 ? position : new Vector3(...position);
  m.compose(pos, q, s);
  const g = geometry.clone();
  g.applyMatrix4(m);
  return g;
}

export function merge(parts: BufferGeometry[]) {
  // mergeGeometries needs a consistent attribute set: drop extras that only some parts carry.
  const names = parts.map(part => Object.keys(part.attributes));
  const shared = names[0].filter(name => names.every(list => list.includes(name)));
  const prepared = parts.map(part => {
    const g = part.index ? part.toNonIndexed() : part;
    for (const name of Object.keys(g.attributes)) if (!shared.includes(name)) g.deleteAttribute(name);
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('dawn scene: geometry merge failed');
  return merged;
}

/* ─── Column ─────────────────────────────────────────────────────────────── */

export interface ColumnParts {
  marble: BufferGeometry;
  gold: BufferGeometry;
  inlay: BufferGeometry;
}

const FLUTES = 24;

/**
 * Tessellation of a column. The colonnade is most of the hall's triangles (16
 * columns, drawn again for the floor mirror), so the low quality tiers use the
 * lite set; at their render resolution the difference does not show.
 */
export interface ColumnDetail {
  /** Lathe segments per shaft flute, and rows up the shaft. */
  perFlute: number;
  shaftRows: number;
  /** Segments around the axis for the base mouldings, the bell and the gold rings. */
  lathe: number;
  bell: number;
  /** Steps around each gold ring's tube. */
  ringTube: number;
  /** Acanthus leaf grid [columns, rows] and volute [segments, ring steps]. */
  leaf: readonly [number, number];
  volute: readonly [number, number];
}

export const COLUMN_DETAIL = {
  full: { perFlute: 6, shaftRows: 40, lathe: 96, bell: 64, ringTube: 12, leaf: [8, 14], volute: [48, 8] },
  lite: { perFlute: 4, shaftRows: 20, lathe: 48, bell: 32, ringTube: 8, leaf: [5, 8], volute: [28, 6] },
} as const satisfies Record<string, ColumnDetail>;

/** Fluted shaft with entasis; flutes fade out a little before both ends. */
function fluteShaft(height: number, r0: number, r1: number, perFlute: number, rows: number) {
  const segments = FLUTES * perFlute;
  const profile: Profile = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const entasis = Math.sin(t * Math.PI) * 0.012;
    profile.push([r0 + (r1 - r0) * Math.pow(t, 1.2) + entasis, t * height]);
  }
  const g = lathe(profile, segments);
  const pos = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    const phi = Math.atan2(v.x, v.z);
    const local = ((phi / (Math.PI * 2)) * FLUTES % 1 + 1) % 1;
    const x = (local - 0.5) / 0.42;
    const flute = Math.abs(x) < 1 ? Math.sqrt(1 - x * x) : 0;
    const t = v.y / height;
    const ends = smooth(0.035, 0.07, t) * (1 - smooth(0.93, 0.965, t));
    const r = Math.hypot(v.x, v.z);
    const depth = 0.045 * flute * ends;
    const k2 = (r - depth) / r;
    pos.setXYZ(k, v.x * k2, v.y, v.z * k2);
  }
  g.computeVertexNormals();
  return g;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** One acanthus leaf: lobed outline, a raised midrib and an outward curl. */
function leaf(width: number, height: number, curl: number, [cols, rows]: readonly [number, number]) {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const lobes = 1 + 0.18 * Math.sin(v * Math.PI * 6) * (1 - v);
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(0.98, v * 0.92 + 0.04)), 0.7) * lobes;
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1;
      const x = (u * w) / 2;
      const rib = (1 - Math.abs(u)) * 0.025 + Math.abs(u) * Math.abs(u) * -0.02;
      const z = Math.pow(v, 2.6) * curl + rib + Math.sin(Math.abs(u) * Math.PI) * 0.015;
      const y = v * height - Math.pow(v, 3) * curl * 0.35;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Spiral volute under each abacus corner. */
function volute(radius: number, tube: number, turns: number, [segs, ring]: readonly [number, number]) {
  const positions: number[] = [];
  const centre: Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.78);
    centre.push(new Vector3(0, Math.sin(a) * r, Math.cos(a) * r));
  }
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const c = centre[i];
    const next = centre[Math.min(segs, i + 1)];
    const prev = centre[Math.max(0, i - 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new Vector3(1, 0, 0);
    const up = new Vector3().crossVectors(tangent, side).normalize();
    const tr = tube * (1 - (i / segs) * 0.6);
    for (let k = 0; k <= ring; k++) {
      const b = (k / ring) * Math.PI * 2;
      const p = c.clone().addScaledVector(side, Math.cos(b) * tr).addScaledVector(up, Math.sin(b) * tr);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * (ring + 1) + k;
      const b = a + ring + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, bevel = 0.02) {
  // A bevelled slab as a 4-sided lathe (square plan), rotated 45° so faces align with axes.
  const r = (w / 2) * Math.SQRT2;
  const b = bevel * Math.SQRT2;
  const profile: Profile = [
    [0, 0], ...crease(r - b, 0), ...crease(r, b), ...crease(r, h - b), ...crease(r - b, h), [0, h],
  ];
  const g = lathe(profile, 4, Math.PI / 4).toNonIndexed();
  if (d !== w) g.scale(1, 1, d / w);
  g.computeVertexNormals();
  return g;
}

/**
 * A complete column standing on y=0, with total height `height`.
 * Marble: plinth, attic base, fluted shaft, bell, abacus.
 * Gold: base tori bands, neck ring, acanthus leaves, volutes, abacus fillet.
 * Inlay: a crystal channel set into the shaft face that looks at the hall centre (+z).
 */
export function columnParts(height: number, radius: number, detail: ColumnDetail = COLUMN_DETAIL.full): ColumnParts {
  const plinthH = 0.28;
  const baseH = 0.42;
  const capH = 1.15;
  const shaftH = height - plinthH - baseH - capH;
  const r = radius;

  const plinth = box(r * 3.0, plinthH, r * 3.0, 0.03);
  const base = lathe([
    [r * 1.42, 0], ...crease(r * 1.42, 0.02), [r * 1.46, 0.07], [r * 1.42, 0.13], ...crease(r * 1.3, 0.15),
    [r * 1.18, 0.2], [r * 1.12, 0.25], ...crease(r * 1.2, 0.27), [r * 1.24, 0.31], [r * 1.2, 0.36], ...crease(r * 1.08, 0.38),
    ...crease(r * 1.04, baseH), [0, baseH],
  ], detail.lathe);
  base.translate(0, plinthH, 0);
  const shaft = fluteShaft(shaftH, r, r * 0.86, detail.perFlute, detail.shaftRows);
  shaft.translate(0, plinthH + baseH, 0);

  const capY = plinthH + baseH + shaftH;
  const neck = r * 0.86;
  const bell = lathe([
    [neck * 0.98, 0], [neck * 1.0, 0.25], [neck * 1.06, 0.55], [neck * 1.2, 0.82], ...crease(neck * 1.32, capH - 0.2), [0, capH - 0.2],
  ], detail.bell);
  bell.translate(0, capY, 0);
  const abacus = box(r * 3.1, 0.2, r * 3.1, 0.025);
  abacus.translate(0, capY + capH - 0.2, 0);

  const goldParts: BufferGeometry[] = [];
  const torus = (rr: number, y: number, tube: number) => {
    const steps = detail.ringTube;
    const g = lathe(Array.from({ length: steps + 1 }, (_, i) => {
      const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
      return [rr + Math.cos(a) * tube, y + Math.sin(a) * tube] as [number, number];
    }), detail.lathe);
    return g;
  };
  goldParts.push(torus(r * 1.455, plinthH + 0.07, 0.05));
  goldParts.push(torus(r * 1.235, plinthH + 0.31, 0.04));
  goldParts.push(torus(neck * 1.03, capY + 0.04, 0.045));
  goldParts.push(torus(neck * 1.0, capY - 0.12, 0.022));
  const fillet = box(r * 3.14, 0.035, r * 3.14, 0.01);
  fillet.translate(0, capY + capH - 0.2 + 0.08, 0);
  goldParts.push(fillet);
  // Two rows of acanthus leaves, the upper row offset by half a leaf and curling harder.
  const lower = leaf(0.36, 0.5, 0.16, detail.leaf);
  const upper = leaf(0.4, 0.68, 0.24, detail.leaf);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g1 = placed(lower, [Math.sin(a) * neck * 1.02, capY + 0.02, Math.cos(a) * neck * 1.02], [0, a, 0]);
    goldParts.push(g1);
    const a2 = a + Math.PI / 8;
    const g2 = placed(upper, [Math.sin(a2) * neck * 1.06, capY + 0.18, Math.cos(a2) * neck * 1.06], [-0.08, a2, 0]);
    goldParts.push(g2);
  }
  const v = volute(0.13, 0.03, 1.6, detail.volute);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    goldParts.push(placed(v, [Math.sin(a) * neck * 1.42, capY + capH - 0.36, Math.cos(a) * neck * 1.42], [0, a + Math.PI / 2, 0]));
  }

  // Crystal channel: a slim faceted bar set into the front fillets, with diamond studs.
  const inlayParts: BufferGeometry[] = [];
  const barH = shaftH * 0.62;
  const bar = crystalBar(0.16, barH, 0.06);
  inlayParts.push(placed(bar, [0, plinthH + baseH + shaftH * 0.2, r * 0.955]));
  for (const [t, size] of [[0.14, 0.17], [0.407, 0.13], [0.613, 0.13], [0.86, 0.17]] as const) {
    const stud = crystalStud(size);
    inlayParts.push(placed(stud, [0, plinthH + baseH + shaftH * t, r * 0.975]));
  }
  const goldFrame = lathe([[0.0, 0], [0.11, 0.02], [0.11, 0.03], [0, 0.05]], 4, 0);
  for (const t of [0.14, 0.86]) goldParts.push(placed(goldFrame, [0, plinthH + baseH + shaftH * t - 0.025, r * 0.95], [Math.PI / 2, 0, 0], [1.45, 1, 1.45]));

  const marble = merge([plinth, base, shaft, bell, abacus]);
  return { marble, gold: merge(goldParts), inlay: withCrystalAttributes(merge(inlayParts), 0.55) };
}

/* ─── Crystals ───────────────────────────────────────────────────────────── */

/**
 * Faceted crystal attributes:
 *   edge (vec3): distance-to-edge barycentrics with diagonals hidden, so the
 *                shader can draw crisp facet edges on quads;
 *   cseed (float): per-facet random for glints and inner flaws;
 *   ctint (float): 0 = clear white, 1 = deep teal.
 */
export function withCrystalAttributes(geometry: BufferGeometry, tint: number, seed = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = g.getAttribute('position').count;
  if (!g.getAttribute('edge')) {
    const edge = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 3) {
      edge.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 3);
    }
    g.setAttribute('edge', new BufferAttribute(edge, 3));
  }
  const cseed = new Float32Array(count);
  const ctint = new Float32Array(count);
  const random = rng(seed * 9973 + count);
  for (let i = 0; i < count; i += 3) {
    const s = random();
    cseed[i] = cseed[i + 1] = cseed[i + 2] = s;
  }
  ctint.fill(tint);
  g.setAttribute('cseed', new BufferAttribute(cseed, 1));
  g.setAttribute('ctint', new BufferAttribute(ctint, 1));
  g.computeVertexNormals();
  return g;
}

class FacetBuilder {
  positions: number[] = [];
  edges: number[] = [];

  tri(a: Vector3, b: Vector3, c: Vector3) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.edges.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  /** Quad a-b-c-d (counter-clockwise from outside); the a-c diagonal stays invisible. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.edges.push(1, 1, 0, 0, 1, 0, 0, 1, 1);
    this.positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    this.edges.push(1, 0, 1, 0, 1, 1, 0, 0, 1);
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('edge', new BufferAttribute(new Float32Array(this.edges), 3));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * A natural quartz-like point: hexagonal prism with irregular face widths, a
 * pyramidal termination whose apex is pulled off-axis, and a flat base.
 * Axis along +y, base at y=0.
 */
export function crystalPoint(radius: number, length: number, random: () => number, sides = 6) {
  const f = new FacetBuilder();
  const tip = length * (0.22 + random() * 0.16);
  const bodyH = length - tip;
  const angles: number[] = [];
  let acc = random() * Math.PI * 2;
  const weights = Array.from({ length: sides }, () => 0.7 + random() * 0.6);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < sides; i++) { angles.push(acc); acc += (weights[i] / total) * Math.PI * 2; }
  const ring = (y: number, scale: number) => angles.map(a => new Vector3(Math.cos(a) * radius * scale, y, Math.sin(a) * radius * scale));
  const bottom = ring(0, 0.92 + random() * 0.08);
  const shoulder = ring(bodyH, 1);
  const apex = new Vector3((random() - 0.5) * radius * 0.5, length, (random() - 0.5) * radius * 0.5);
  const base = new Vector3(0, 0, 0);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    f.quad(bottom[j], bottom[i], shoulder[i], shoulder[j]);
    f.tri(shoulder[j], shoulder[i], apex);
    f.tri(base, bottom[i], bottom[j]);
  }
  return f.build();
}

/** Double-terminated lozenge (stretched octahedron with a girdle), centred on the origin. */
export function crystalLozenge(width: number, height: number, depth = width * 0.55) {
  const f = new FacetBuilder();
  const top = new Vector3(0, height / 2, 0);
  const bottom = new Vector3(0, -height / 2, 0);
  const sides = 8;
  const girdle: Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    girdle.push(new Vector3(Math.cos(a) * width / 2, 0, Math.sin(a) * depth / 2));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    f.tri(girdle[j], girdle[i], top);
    f.tri(girdle[i], girdle[j], bottom);
  }
  return f.build();
}

/** Slim faceted bar for the column channels. */
function crystalBar(width: number, height: number, depth: number) {
  const f = new FacetBuilder();
  const hw = width / 2;
  const p = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const tipH = width * 1.6;
  const l = [p(-hw, tipH, 0), p(0, tipH, depth), p(hw, tipH, 0)];
  const u = [p(-hw, height - tipH, 0), p(0, height - tipH, depth), p(hw, height - tipH, 0)];
  const bTip = p(0, 0, depth * 0.4);
  const tTip = p(0, height, depth * 0.4);
  f.quad(l[0], l[1], u[1], u[0]);
  f.quad(l[1], l[2], u[2], u[1]);
  f.tri(l[1], l[0], bTip); f.tri(l[2], l[1], bTip);
  f.tri(u[0], u[1], tTip); f.tri(u[1], u[2], tTip);
  return f.build();
}

/** Rose-cut stud facing +z. */
function crystalStud(size: number) {
  const f = new FacetBuilder();
  const n = 8;
  const top = new Vector3(0, 0, size * 0.42);
  const ring: Vector3[] = [];
  const inner: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = size * (i % 2 ? 0.5 : 0.62);
    ring.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r * 1.35, 0));
    inner.push(new Vector3(Math.cos(a + Math.PI / n) * size * 0.28, Math.sin(a + Math.PI / n) * size * 0.28 * 1.35, size * 0.26));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.tri(ring[i], ring[j], inner[i]);
    f.tri(inner[i], ring[j], inner[j]);
    f.tri(inner[i], inner[j], top);
  }
  return f.build();
}

/** A cluster of points radiating from a common root, tilted outward. */
export function crystalCluster(random: () => number, count: number, size: number, spread = 0.55) {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const len = size * (main ? 1 : 0.35 + random() * 0.55);
    const rad = len * (0.13 + random() * 0.06);
    const g = crystalPoint(rad, len, random);
    const tilt = main ? random() * 0.15 : spread * (0.4 + random() * 0.8);
    const yaw = random() * Math.PI * 2;
    const offset = main ? 0 : size * 0.08 * (0.5 + random());
    parts.push(placed(g, [Math.cos(yaw) * offset, -len * 0.05, Math.sin(yaw) * offset], [tilt, yaw, 0]));
  }
  return merge(parts);
}

/* ─── Bonfire ────────────────────────────────────────────────────────────── */

/** A split log: irregular bark cross-section, gently bent, axis along +y from 0 to length. */
export function logGeometry(length: number, radius: number, random: () => number) {
  const radial = 14;
  const rows = 18;
  const phase = random() * 10;
  const bend = (random() - 0.5) * 0.12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const knots = Array.from({ length: 3 }, () => ({ v: random(), a: random() * Math.PI * 2, s: 0.25 + random() * 0.3 }));
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = v * length;
    const taper = 1 - v * 0.12;
    const offX = Math.sin(v * Math.PI) * bend * length;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      let r = radius * taper * (1 + 0.07 * Math.sin(a * 3 + phase) + 0.05 * Math.sin(a * 7 + phase * 2.3) + 0.035 * Math.sin(v * 19 + a * 2));
      for (const k of knots) {
        const d = Math.hypot((v - k.v) * length / radius, Math.atan2(Math.sin(a - k.a), Math.cos(a - k.a)) * 1.2);
        r += radius * k.s * Math.exp(-d * d * 2.5);
      }
      const end = v < 0.02 || v > 0.98 ? 0.93 : 1;
      positions.push(Math.cos(a) * r * end + offX, y, Math.sin(a) * r * end);
      uvs.push(i / radial, v * length);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // End caps (fan), using the rim of the first/last row: the bottom faces -y, the top +y.
  const capCenter = (row: number) => {
    const centreIndex = positions.length / 3;
    const y = (row / rows) * length;
    positions.push(Math.sin((row / rows) * Math.PI) * bend * length, y, 0);
    uvs.push(0.5, -1);
    for (let i = 0; i < radial; i++) {
      const a = row * (radial + 1) + i;
      if (row === 0) indices.push(centreIndex, a, a + 1);
      else indices.push(centreIndex, a + 1, a);
    }
  };
  capCenter(0);
  capCenter(rows);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/* ─── Architecture ───────────────────────────────────────────────────────── */

/**
 * Curved wall with arched windows between radii rIn/rOut from y0 to y1.
 * Windows are centred at `windowAngles`, `halfWidth` metres wide at rIn,
 * sill at `sill`, semicircular arch springing at `spring`.
 */
export function archedDrum(opts: {
  rIn: number; rOut: number; y0: number; y1: number; windows: number; halfWidth: number; sill: number; spring: number; offset: number;
}) {
  const { rIn, rOut, y0, y1, windows, halfWidth, sill, spring, offset } = opts;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bay = (Math.PI * 2) / windows;
  const arcSteps = 20;

  const vtx = (r: number, a: number, y: number) => {
    positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
    uvs.push(a * r, y);
    return positions.length / 3 - 1;
  };
  /** Ribbon between two polylines (same length). */
  const ribbon = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length - 1; i++) indices.push(a[i], b[i], a[i + 1], b[i], b[i + 1], a[i + 1]);
  };
  const archY = (x: number) => spring + Math.sqrt(Math.max(0, halfWidth * halfWidth - x * x));

  for (let w = 0; w < windows; w++) {
    const c = offset + (w + 0.5) * bay;
    const start = c - bay / 2;
    const end = c + bay / 2;
    for (const [r, inward] of [[rIn, true], [rOut, false]] as Array<[number, boolean]>) {
      const ah = halfWidth / r;
      // piers: start → window left, window right → end, full height (6 angular steps each)
      for (const [a0, a1] of [[start, c - ah], [c + ah, end]]) {
        const lowRow: number[] = [];
        const highRow: number[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = a0 + ((a1 - a0) * i) / 6;
          lowRow.push(vtx(r, a, y0));
          highRow.push(vtx(r, a, y1));
        }
        if (inward) ribbon(lowRow, highRow); else ribbon(highRow, lowRow);
      }
      // sill panel and arch spandrel across the window width
      const sillLow: number[] = [];
      const sillHigh: number[] = [];
      const archLow: number[] = [];
      const archHigh: number[] = [];
      for (let i = 0; i <= arcSteps; i++) {
        const x = -halfWidth + (2 * halfWidth * i) / arcSteps;
        const a = c + x / r;
        sillLow.push(vtx(r, a, y0));
        sillHigh.push(vtx(r, a, sill));
        archLow.push(vtx(r, a, archY(x)));
        archHigh.push(vtx(r, a, y1));
      }
      if (inward) { ribbon(sillLow, sillHigh); ribbon(archLow, archHigh); } else { ribbon(sillHigh, sillLow); ribbon(archHigh, archLow); }
    }
    // reveals: sill top, jambs, soffit (connect rIn and rOut along the opening outline)
    const outline: Array<[number, number]> = [];
    outline.push([halfWidth, sill]);
    outline.push([halfWidth, spring]);
    for (let i = 1; i < arcSteps; i++) {
      const t = i / arcSteps;
      const ang = t * Math.PI;
      outline.push([Math.cos(ang) * halfWidth, spring + Math.sin(ang) * halfWidth]);
    }
    outline.push([-halfWidth, spring]);
    outline.push([-halfWidth, sill]);
    outline.push([halfWidth, sill]);
    const inner = outline.map(([x, y]) => vtx(rIn, c + x / rIn, y));
    const outer = outline.map(([x, y]) => vtx(rOut, c + x / rOut, y));
    ribbon(inner, outer);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Inner shell of a dome (normals facing the centre) from the springline up to the oculus. */
export function domeShell(radius: number, oculusAngle: number, segments = 128, rings = 48) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const polar = Math.PI / 2 - t * (Math.PI / 2 - oculusAngle); // from horizon up to the oculus edge
    const y = Math.cos(polar) * radius;
    const r = Math.sin(polar) * radius;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uvs.push(i / segments, t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** A turned baluster (vase profile), standing on y=0. */
export function baluster(height: number, radius: number, segments = 24) {
  const h = height;
  const r = radius;
  return lathe([
    [r * 1.0, 0], ...crease(r * 1.0, h * 0.06), [r * 0.7, h * 0.09], [r * 0.62, h * 0.14],
    [r * 0.92, h * 0.3], [r * 1.0, h * 0.42], [r * 0.82, h * 0.56], [r * 0.48, h * 0.72], [r * 0.4, h * 0.8],
    [r * 0.62, h * 0.86], ...crease(r * 0.62, h * 0.9), ...crease(r * 0.9, h * 0.92), ...crease(r * 0.9, h), [0, h],
  ], segments);
}

/** Ring with a rectangular-ish moulded section (rails, kerbs, plinth bands). */
export function ringMoulding(rIn: number, rOut: number, y0: number, y1: number, segments = 160, lip = 0.03) {
  return lathe([
    [rIn, y1], ...crease(rIn, y0), ...crease(rOut, y0), ...crease(rOut, y1 - lip), [rOut - lip, y1], ...crease(rIn, y1),
  ], segments);
}
