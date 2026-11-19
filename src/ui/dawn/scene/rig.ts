import { MathUtils,PerspectiveCamera,Vector2,Vector3 } from 'three';
import { getOrbitGeometry,getOrbitSlot } from '../../../components/start/orrery/orbitLayout';
import type { HallLayout } from './sceneBus';

/**
 * Camera poses for the two entry screens and the flights between them.
 * A pose aims at a target and shifts the principal point (setViewOffset) so a
 * world point can land exactly under an HTML element without tilting verticals.
 */

export interface Pose {
  position: Vector3;
  target: Vector3;
  fov: number;
  /** Principal point offset from the viewport centre, px (positive = right / down). */
  shift: Vector2;
}

const clone = (p: Pose): Pose => ({ position: p.position.clone(), target: p.target.clone(), fov: p.fov, shift: p.shift.clone() });

/** Title screen: standing inside the rotunda, the bonfire ahead, the armillary over the title. */
export function homePose(width: number, height: number): Pose {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.8) {
    return { position: new Vector3(0, 2.3, 11.6), target: new Vector3(0, 5.9, 0), fov: 70, shift: new Vector2(0, 0) };
  }
  if (aspect < 1.25) {
    return { position: new Vector3(0, 2.1, 11.4), target: new Vector3(0, 5.6, 0), fov: 60, shift: new Vector2(0, 0) };
  }
  // The bowl rim lands at ~89% of the height, leaving the start plaque room below the logs.
  return { position: new Vector3(0, 1.8, 11.4), target: new Vector3(0, 5.9, 0), fov: 56, shift: new Vector2(0, 0) };
}

/** Rough hall layout before the hall has mounted (used to aim the warp flight). */
export function estimateHallLayout(width: number, height: number): HallLayout {
  const top = Math.min(80, height * 0.09);
  const bottom = width < 640 ? 118 : 74;
  const stage = { width, height: Math.max(200, height - top - bottom) };
  const g = getOrbitGeometry(stage);
  return {
    viewportWidth: width,
    viewportHeight: height,
    coreX: g.cx,
    coreY: top + g.cy,
    core: g.core,
    lens: g.lens,
    slots: g.angles.map((_, i) => {
      const s = getOrbitSlot(g, i);
      return { x: s.x, y: top + s.y, occupied: true, accent: null };
    }),
  };
}

/** Max horizontal distance from the axis the hall camera may take (stays inside the colonnade). */
const INSIDE = 11.6;
/** Highest the hall camera may rise: inside the vault, at least 2 m under the dome shell. */
const CEILING = 21.5;
export const HALL_TARGET_Y = 2.25;
/** Height of the HTML lenses above their floor medallions. */
export const LENS_HEIGHT = 1.55;

/**
 * Hall: looking down at the bonfire from above the floor. The elevation comes
 * from the lens ellipse, the distance from the core size (the hearth and
 * flames fill the core circle), and the principal point sits on the core.
 */
export function hallPose(layout: HallLayout, width: number, height: number): Pose {
  let rx = 1;
  let ry = 1;
  for (const s of layout.slots) {
    rx = Math.max(rx, Math.abs(s.x - layout.coreX));
    ry = Math.max(ry, Math.abs(s.y - layout.coreY));
  }
  const portrait = width < height * 1.18;
  const elev = MathUtils.clamp(Math.asin(Math.min(0.97, ry / rx)), MathUtils.degToRad(30), MathUtils.degToRad(64));
  const pxPerM = Math.max(20, layout.core / 6.4);
  let fov = portrait ? 48 : 40;
  let dist = (height / 2) / (pxPerM * Math.tan(MathUtils.degToRad(fov / 2)));
  // Portrait stages look down steeply; without the ceiling the camera would leave through the dome.
  const maxDist = Math.min(INSIDE / Math.cos(elev), (CEILING - HALL_TARGET_Y) / Math.sin(elev));
  if (dist > maxDist) {
    dist = maxDist;
    fov = MathUtils.radToDeg(2 * Math.atan((height / 2) / (pxPerM * dist)));
  }
  fov = MathUtils.clamp(fov, 24, 80);
  const target = new Vector3(0, HALL_TARGET_Y, 0);
  const position = new Vector3(0, HALL_TARGET_Y + Math.sin(elev) * dist, Math.cos(elev) * dist);
  return { position, target, fov, shift: new Vector2(layout.coreX - width / 2, layout.coreY - height / 2) };
}

export function applyPose(camera: PerspectiveCamera, pose: Pose, width: number, height: number) {
  camera.position.copy(pose.position);
  camera.fov = pose.fov;
  camera.aspect = width / Math.max(1, height);
  camera.up.set(0, 1, 0);
  camera.lookAt(pose.target);
  camera.setViewOffset(width, height, -pose.shift.x, -pose.shift.y, width, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Floor medallions: un-project every lens centre onto the plane LENS_HEIGHT
 * above the floor, so the lens floats exactly over its medallion on screen.
 */
export function medallionsFor(layout: HallLayout, pose: Pose, width: number, height: number) {
  const cam = new PerspectiveCamera(pose.fov, width / height, 0.1, 600);
  applyPose(cam, pose, width, height);
  const out: Array<{ x: number; z: number; radius: number; occupied: boolean; accent: string | null }> = [];
  const origin = new Vector3();
  const dir = new Vector3();
  for (const slot of layout.slots) {
    const ndc = new Vector3((slot.x / width) * 2 - 1, -(slot.y / height) * 2 + 1, 0.5);
    origin.copy(cam.position);
    dir.copy(ndc).unproject(cam).sub(origin).normalize();
    if (Math.abs(dir.y) < 1e-4) continue;
    const t = (LENS_HEIGHT - origin.y) / dir.y;
    if (t <= 0) continue;
    const hit = origin.clone().addScaledVector(dir, t);
    const distance = hit.distanceTo(cam.position);
    const pxPerM = (height / 2) / (distance * Math.tan(MathUtils.degToRad(pose.fov / 2)));
    out.push({ x: hit.x, z: hit.z, radius: MathUtils.clamp((layout.lens * 0.44) / pxPerM, 0.35, 2.4), occupied: slot.occupied, accent: slot.accent });
  }
  return out;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export type FlightKind = 'warp' | 'return' | 'settle';

/**
 * Moves the camera between poses. The warp is a rising crane move: the camera
 * lifts through the light, swings a little around the fire and settles above
 * the hall; the field of view breathes wider mid-flight for a sense of speed.
 */
export class CameraRig {
  private pose: Pose;
  private flight: { from: Pose; to: Pose; t: number; duration: number; kind: FlightKind } | null = null;
  private pointer = new Vector2();
  private smooth = new Vector2();
  private parallax = 1;

  constructor(initial: Pose) { this.pose = clone(initial); }

  get flying() { return this.flight !== null; }
  get progress() { return this.flight ? this.flight.t / this.flight.duration : 1; }
  get kind() { return this.flight?.kind ?? null; }

  setPointer(x: number, y: number) { this.pointer.set(x, y); }
  setParallax(amount: number) { this.parallax = amount; }

  jump(pose: Pose) { this.pose = clone(pose); this.flight = null; }

  fly(to: Pose, duration: number, kind: FlightKind) {
    this.flight = { from: this.current(), to: clone(to), t: 0, duration, kind };
  }

  /** Retarget an active flight (the real hall layout arrived mid-warp) or settle into it. */
  retarget(to: Pose) {
    if (this.flight) this.flight.to = clone(to);
    else this.fly(to, 0.6, 'settle');
  }

  private current(): Pose {
    if (!this.flight) return clone(this.pose);
    return this.sample(this.flight, this.flight.t / this.flight.duration);
  }

  private sample(f: NonNullable<CameraRig['flight']>, raw: number): Pose {
    const t = MathUtils.clamp(raw, 0, 1);
    const k = f.kind === 'settle' ? easeOut(t) : easeInOut(t);
    const from = f.from;
    const to = f.to;
    const position = new Vector3();
    if (f.kind === 'warp' || f.kind === 'return') {
      // Quadratic Bezier through a control point above the midpoint, plus a swing around the axis.
      const mid = from.position.clone().lerp(to.position, 0.5);
      mid.y += f.kind === 'warp' ? 2.6 : 1.4;
      mid.z = Math.min(mid.z, 10.8);
      const a = from.position.clone().multiplyScalar((1 - k) * (1 - k));
      const b = mid.multiplyScalar(2 * (1 - k) * k);
      const c = to.position.clone().multiplyScalar(k * k);
      position.copy(a).add(b).add(c);
      const swing = Math.sin(Math.PI * k) * (f.kind === 'warp' ? 0.34 : -0.2);
      const cos = Math.cos(swing);
      const sin = Math.sin(swing);
      const x = position.x * cos + position.z * sin;
      const z = -position.x * sin + position.z * cos;
      position.x = x;
      position.z = z;
    } else {
      position.copy(from.position).lerp(to.position, k);
    }
    const target = from.target.clone().lerp(to.target, f.kind === 'warp' ? Math.min(1, k * 1.25) : k);
    const bump = f.kind === 'warp' ? Math.sin(Math.PI * k) * 14 : f.kind === 'return' ? Math.sin(Math.PI * k) * 8 : 0;
    const fov = MathUtils.lerp(from.fov, to.fov, k) + bump;
    const shift = from.shift.clone().lerp(to.shift, k);
    return { position, target, fov, shift };
  }

  /** Advances the flight; returns the pose to render (with pointer parallax and idle drift). */
  update(dt: number, time: number): Pose {
    if (this.flight) {
      this.flight.t += dt;
      if (this.flight.t >= this.flight.duration) {
        this.pose = clone(this.flight.to);
        this.flight = null;
      }
    }
    const base = this.current();
    const follow = 1 - Math.exp(-dt * 3);
    this.smooth.lerp(this.pointer, follow);
    const amount = this.parallax;
    const yaw = -this.smooth.x * 0.05 * amount + Math.sin(time * 0.11) * 0.006 * amount;
    const pitch = this.smooth.y * 0.028 * amount + Math.sin(time * 0.17) * 0.004 * amount;
    const offset = base.position.clone().sub(base.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), yaw);
    const side = new Vector3().crossVectors(offset, new Vector3(0, 1, 0)).normalize();
    if (side.lengthSq() > 0) offset.applyAxisAngle(side, pitch);
    base.position.copy(base.target).add(offset);
    base.position.y += Math.sin(time * 0.23) * 0.03 * amount;
    return base;
  }
}
