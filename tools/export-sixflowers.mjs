// Export the application's real particle arrays for the offline six-flower study.
// This does not launch a browser, use a camera, or validate hardware rendering.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Matrix4, Euler, PerspectiveCamera } from 'three';
import { createFlower, FLOWER_TYPES, FLOWER_REGIONS } from '../src/flower.js';
import { vertexShader, fragmentShader } from '../src/shaders.js';

const output = resolve(process.argv[2] || '.sixflower-study');
const count = Number(process.argv[3] || 100000);
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Particle count must be a positive integer.');
mkdirSync(output, { recursive: true });
const seed = 194;
const regionNames = Object.fromEntries(Object.entries(FLOWER_REGIONS).map(([key, value]) => [value, key]));
const allBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const source = [];

function statsFor(array, dimension = 3) {
  const min = Array(dimension).fill(Infinity), max = Array(dimension).fill(-Infinity), mean = Array(dimension).fill(0);
  let finite = true;
  for (let i = 0; i < array.length; i++) {
    const axis = i % dimension, value = array[i];
    finite &&= Number.isFinite(value);
    min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); mean[axis] += value;
  }
  const n = array.length / dimension;
  return { finite, min, max, mean: mean.map(value => value / n) };
}

for (const type of FLOWER_TYPES) {
  const flower = createFlower(count, seed, type.id);
  const directory = `${output}/${type.id}`;
  mkdirSync(directory, { recursive: true });
  const buffers = {};
  for (const [name, array] of Object.entries(flower)) {
    if (!ArrayBuffer.isView(array)) continue;
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    writeFileSync(`${directory}/${name}.bin`, bytes);
    buffers[name] = { bytes: bytes.length, dtype: array.constructor.name, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const positions = statsFor(flower.position), colors = statsFor(flower.color);
  const regions = {};
  for (let i = 0; i < flower.count; i++) {
    const key = regionNames[flower.regions[i]] || `REGION_${flower.regions[i]}`;
    const entry = regions[key] ||= { count: 0, meanColor: [0, 0, 0], bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } };
    entry.count++;
    for (let axis = 0; axis < 3; axis++) {
      const index = i * 3 + axis, value = flower.position[index];
      entry.meanColor[axis] += flower.color[index];
      entry.bounds.min[axis] = Math.min(entry.bounds.min[axis], value);
      entry.bounds.max[axis] = Math.max(entry.bounds.max[axis], value);
    }
  }
  for (const entry of Object.values(regions)) entry.meanColor = entry.meanColor.map(value => value / entry.count);
  for (let axis = 0; axis < 3; axis++) {
    allBounds.min[axis] = Math.min(allBounds.min[axis], positions.min[axis]);
    allBounds.max[axis] = Math.max(allBounds.max[axis], positions.max[axis]);
  }
  if (!positions.finite || !colors.finite || colors.min.some(value => value < 0) || colors.max.some(value => value > 1)) {
    throw new Error(`${type.id}: invalid point position or RGB range`);
  }
  source.push({ ...type, flower, stats: { count: flower.count, positions, colors, regions, buffers } });
}

// All types use one camera distance and the same world coordinate origin.
// Fit a common bounding sphere with a small margin, also covering the rotated view.
const center = allBounds.min.map((value, axis) => (value + allBounds.max[axis]) / 2);
let radius = 0;
for (const { flower } of source) for (let i = 0; i < flower.position.length; i += 3) {
  radius = Math.max(radius, Math.hypot(flower.position[i] - center[0], flower.position[i + 1] - center[1], flower.position[i + 2] - center[2]));
}
const camera = new PerspectiveCamera(39, 1, 0.1, 80);
camera.position.set(0, 0, radius / Math.sin(39 * Math.PI / 360) * 1.08);
camera.updateMatrixWorld();
const views = [{ id: 'front', label: '正面聚合', angle: 0, elevation: 0.20 }, { id: 'oblique', label: '55° 斜侧 / 微俯', angle: 55 * Math.PI / 180, elevation: 0.48 }];
for (const view of views) {
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(view.elevation, view.angle, 0));
  const model = rotation.multiply(new Matrix4().makeTranslation(-center[0], -center[1], -center[2]));
  view.modelView = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, model).toArray();
}
const differences = [];
for (let a = 0; a < source.length; a++) for (let b = a + 1; b < source.length; b++) {
  let squaredPosition = 0, squaredColor = 0;
  for (let i = 0; i < source[a].flower.position.length; i++) {
    squaredPosition += (source[a].flower.position[i] - source[b].flower.position[i]) ** 2;
    squaredColor += (source[a].flower.color[i] - source[b].flower.color[i]) ** 2;
  }
  differences.push({ types: [source[a].id, source[b].id], rmsPosition: Math.sqrt(squaredPosition / count), rmsColor: Math.sqrt(squaredColor / count) });
}
const manifest = {
  title: '六种粒子花卉 · 离线几何预览',
  evidence: 'Actual createFlower() buffers and adapted application GLSL; not a browser screenshot.',
  generator: 'src/flower.js', seed, countPerFlower: count,
  sourceFiles: Object.fromEntries(['src/flower.js', 'src/shaders.js'].map(name => [name, createHash('sha256').update(readFileSync(new URL(`../${name}`, import.meta.url))).digest('hex')])),
  camera: { fov: 39, position: camera.position.toArray(), center, commonRadius: radius, commonScale: true },
  allBounds, differences, flowers: source.map(({ flower, ...type }) => type),
};
writeFileSync(`${output}/study.json`, JSON.stringify({ ...manifest, vertexShader, fragmentShader, projection: camera.projectionMatrix.toArray(), views }, null, 2));
writeFileSync(`${output}/metrics.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, flowers: source.length, particleCount: count, views: views.length, commonCameraZ: camera.position.z }));
