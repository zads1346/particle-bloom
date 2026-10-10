import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_FOV, FLOWER_BOUNDS, FLOWER_RADIUS, QUALITY_TIERS,
  getArtSafeArea, getFraming, getFramingForBounds, getQualitySettings,
  createAdaptiveQualityState, updateAdaptiveQuality, shortestAngleLerp,
} from '../src/render-utils.js';

const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
};

test('bounding sphere encloses all corners of the rotating specimen', () => {
  near(FLOWER_RADIUS, Math.hypot(FLOWER_BOUNDS.width, FLOWER_BOUNDS.height, FLOWER_BOUNDS.depth) / 2);
});

for (const [width, height] of [[390, 844], [768, 1024], [1600, 1000], [320, 568], [1024, 600], [2560, 1080]]) {
  test(`the full rotated specimen fits the art safe area at ${width}×${height}`, () => {
    const { cameraZ: z, positionX: x, positionY: y } = getFraming(width, height);
    const area = getArtSafeArea(width, height);
    const tanY = Math.tan(CAMERA_FOV * Math.PI / 360), tanX = tanY * width / height;
    const left = (area.left * 2 - 1) * tanX, right = (area.right * 2 - 1) * tanX;
    const bottom = (1 - 2 * area.bottom) * tanY, top = (1 - 2 * area.top) * tanY;
    assert.ok([z, x, y].every(Number.isFinite));
    // Distance to each of the four inward-facing sub-frustum planes.
    for (const distance of [
      (x - left * z) / Math.hypot(1, left),
      (right * z - x) / Math.hypot(1, right),
      (y - bottom * z) / Math.hypot(1, bottom),
      (top * z - y) / Math.hypot(1, top),
    ]) assert.ok(distance >= FLOWER_RADIUS, `${distance} < ${FLOWER_RADIUS}`);
    assert.ok(z > FLOWER_RADIUS);
  });
}

test('tablet/mobile are centered and desktop occupies the right-side safe area', () => {
  near(getFraming(390, 844).positionX, 0);
  near(getFraming(768, 1024).positionX, 0);
  assert.ok(getFraming(390, 844).positionY < 0);
  assert.ok(getFraming(1600, 1000).positionX > 0);
  const mobile = getArtSafeArea(390, 844);
  near(mobile.top * 844, 320);
  near(mobile.bottom * 844, 694);
});

test('invalid dimensions are explicitly rejected', () => {
  for (const dimensions of [[0, 844], [390, -1], [NaN, 800], [800, Infinity]]) {
    assert.throws(() => getFraming(...dimensions), RangeError);
  }
});

const initialBounds = { minX: -2.6, maxX: 2.6, minY: -3.1, maxY: 2.8, minZ: -1.65, maxZ: 1.65 };
for (const [width, height] of [[390, 844], [768, 1024], [1600, 1000]]) {
  test(`oriented bounds fit all perspective corners at ${width}×${height}`, () => {
    const area = getArtSafeArea(width, height);
    for (const bounds of [initialBounds,
      { minX: -4, maxX: 2, minY: -5, maxY: 1, minZ: -8, maxZ: 4 },
      { minX: 3, maxX: 7, minY: 2, maxY: 6, minZ: -5, maxZ: -2 },
    ]) {
      const framing = getFramingForBounds(width, height, bounds);
      const tanY = Math.tan(CAMERA_FOV * Math.PI / 360), tanX = tanY * width / height;
      const projected = [];
      for (const x of [bounds.minX, bounds.maxX]) {
        for (const y of [bounds.minY, bounds.maxY]) {
          for (const z of [bounds.minZ, bounds.maxZ]) {
            const depth = framing.cameraZ - z;
            assert.ok(depth > 0.1);
            const sx = (1 + (x + framing.positionX) / (depth * tanX)) / 2;
            const sy = (1 - (y + framing.positionY) / (depth * tanY)) / 2;
            assert.ok(sx >= area.left - 1e-10 && sx <= area.right + 1e-10, `x=${sx}`);
            assert.ok(sy >= area.top - 1e-10 && sy <= area.bottom + 1e-10, `y=${sy}`);
            projected.push({ x: sx, y: sy });
          }
        }
      }
      // At least one pair of opposite art edges must be filled at the minimum fit.
      const spanX = Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x));
      const spanY = Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y));
      assert.ok(Math.abs(spanX - (area.right - area.left)) < 1e-9
        || Math.abs(spanY - (area.bottom - area.top)) < 1e-9);
    }
    assert.ok(getFramingForBounds(width, height, initialBounds).cameraZ < getFraming(width, height).cameraZ);
  });
}

test('bounds fit supports points but rejects missing, reversed, and nonfinite bounds', () => {
  const point = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  assert.ok(Object.values(getFramingForBounds(390, 844, point)).every(Number.isFinite));
  for (const bounds of [undefined, {}, { ...initialBounds, minX: 3 }, { ...initialBounds, maxZ: Infinity }]) {
    assert.throws(() => getFramingForBounds(390, 844, bounds), RangeError);
  }
});

test('quality tiers are exact and auto starts lower on mobile', () => {
  assert.deepEqual(QUALITY_TIERS, { high: 100000, medium: 60000, low: 28000 });
  assert.deepEqual(getQualitySettings('auto', { width: 390, devicePixelRatio: 3 }),
    { tier: 'medium', count: 60000, pixelRatio: 1.25 });
  assert.deepEqual(getQualitySettings('auto', { width: 1600, devicePixelRatio: 3 }),
    { tier: 'high', count: 100000, pixelRatio: 2 });
});

test('DPR caps decrease with quality and never exceed a device ratio', () => {
  for (const width of [390, 1600]) {
    const caps = ['high', 'medium', 'low'].map((quality) =>
      getQualitySettings(quality, { width, devicePixelRatio: 3 }).pixelRatio);
    assert.ok(caps[0] > caps[1] && caps[1] > caps[2]);
    near(getQualitySettings('high', { width, devicePixelRatio: 0.75 }).pixelRatio, 0.75);
    for (const ratio of [NaN, 0, -1, Infinity]) {
      near(getQualitySettings('high', { width, devicePixelRatio: ratio }).pixelRatio, 1);
    }
  }
  assert.throws(() => getQualitySettings('ultra'), RangeError);
});

const slow = (state, elapsedMs = 4000) => updateAdaptiveQuality(state, { fps: 24, elapsedMs });

test('auto quality progresses high → medium → low with sustained slow frames and cooldown', () => {
  const initial = createAdaptiveQualityState();
  let state = slow(initial);
  assert.equal(state.tier, 'high');
  state = slow(state);
  assert.deepEqual(state, { tier: 'medium', slowMs: 0, cooldownMs: 6000 });
  state = slow(state);
  assert.equal(state.cooldownMs, 2000);
  state = slow(state);
  assert.equal(state.slowMs, 2000);
  state = slow(state);
  assert.equal(state.tier, 'low');
  for (let i = 0; i < 10; i++) state = slow(state);
  assert.equal(state.tier, 'low');
  assert.deepEqual(initial, createAdaptiveQualityState(), 'input state was not mutated');
});

test('healthy samples reset the slow streak and do not automatically increase quality', () => {
  let state = slow(createAdaptiveQualityState());
  state = updateAdaptiveQuality(state, { fps: 60, elapsedMs: 4000 });
  state = slow(state);
  assert.equal(state.tier, 'high');
  assert.equal(state.slowMs, 4000);
  near(updateAdaptiveQuality(createAdaptiveQualityState('low'), { fps: 60, elapsedMs: 4000 }).slowMs, 0);
});

test('hidden, invalid, and long sample windows cannot cause false downgrades', () => {
  for (const sample of [
    { fps: 1, elapsedMs: 4000, active: false },
    { fps: NaN, elapsedMs: 4000 }, { fps: 0, elapsedMs: 4000 },
    { fps: 1, elapsedMs: 20000 }, { fps: 1, elapsedMs: -1 },
  ]) {
    const state = updateAdaptiveQuality(slow(createAdaptiveQualityState()), sample);
    assert.equal(state.tier, 'high');
    assert.equal(state.slowMs, 0);
  }
});

test('angles interpolate through the short path in both directions across the seam', () => {
  const radians = (degrees) => degrees * Math.PI / 180;
  near(shortestAngleLerp(radians(179), radians(-179), 0.5), Math.PI);
  near(shortestAngleLerp(radians(-179), radians(179), 0.5), -Math.PI);
  near(shortestAngleLerp(0, Math.PI * 6 + 0.4, 0.5), 0.2);
  near(shortestAngleLerp(Math.PI * 4, 0.4, 0.5), Math.PI * 4 + 0.2);
  near(shortestAngleLerp(0, Math.PI, 0.5), Math.PI / 2);
  near(shortestAngleLerp(0, -Math.PI, 0.5), -Math.PI / 2);
});

test('angle smoothing clamps interpolation and rejects nonfinite inputs', () => {
  near(shortestAngleLerp(0.2, 0.4, -1), 0.2);
  near(shortestAngleLerp(0.2, 0.4, 2), 0.4);
  assert.throws(() => shortestAngleLerp(NaN, 0, 1), RangeError);
  assert.throws(() => shortestAngleLerp(0, Infinity, 1), RangeError);
  assert.throws(() => shortestAngleLerp(0, 1, NaN), RangeError);
});
