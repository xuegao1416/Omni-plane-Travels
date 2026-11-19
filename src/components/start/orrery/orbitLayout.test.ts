import { describe,expect,test } from 'bun:test';
import { captionDrop,captionHalfWidth,getOrbitGeometry,getOrbitSlot } from './orbitLayout';

const VIEWPORTS = [
  { name: '21:9', width: 2560, height: 1000 },
  { name: '16:9', width: 1440, height: 760 },
  { name: '4:3', width: 1024, height: 680 },
  { name: 'square', width: 820, height: 800 },
  { name: 'laptop stage', width: 1440, height: 660 },
  { name: 'near-square stage', width: 900, height: 700 },
  { name: 'phone', width: 390, height: 640 },
  { name: 'small phone', width: 360, height: 560 },
];

describe('orrery orbit layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`keeps all six lenses inside the ${viewport.name} stage`, () => {
      const geometry = getOrbitGeometry(viewport);
      for (let index = 0; index < 6; index += 1) {
        const slot = getOrbitSlot(geometry, index);
        const half = geometry.lens / 2;
        expect(slot.x - half).toBeGreaterThanOrEqual(0);
        expect(slot.x + half).toBeLessThanOrEqual(viewport.width);
        expect(slot.y - half).toBeGreaterThanOrEqual(0);
        expect(slot.y + half).toBeLessThanOrEqual(viewport.height);
        // Lens (with caption) never touches the central astrolabe.
        expect(Math.hypot(slot.x - geometry.cx, slot.y - geometry.cy)).toBeGreaterThan(geometry.core / 2 + half);
      }
    });

    test(`does not let neighbouring lenses overlap at ${viewport.name}`, () => {
      const geometry = getOrbitGeometry(viewport);
      const slots = Array.from({ length: 6 }, (_, index) => getOrbitSlot(geometry, index));
      for (let index = 0; index < 6; index += 1) {
        const a = slots[index];
        const b = slots[(index + 1) % 6];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(geometry.lens);
      }
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`keeps lens captions clear of every other lens at ${viewport.name}`, () => {
      const geometry = getOrbitGeometry(viewport);
      const boxes = Array.from({ length: 6 }, (_, index) => {
        const slot = getOrbitSlot(geometry, index);
        return { l: slot.x - captionHalfWidth(geometry.lens), r: slot.x + captionHalfWidth(geometry.lens), t: slot.y - geometry.lens / 2, b: slot.y + captionDrop(geometry.lens) };
      });
      for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        expect(overlap).toBe(false);
      }
    });
  }

  test('switches to a vertical hexagon on portrait screens', () => {
    expect(getOrbitGeometry({ width: 390, height: 640 }).portrait).toBe(true);
    expect(getOrbitGeometry({ width: 1440, height: 760 }).portrait).toBe(false);
  });
});
