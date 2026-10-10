import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlower, makeFlowerData, FLOWER_TYPES, FLOWER_REGIONS } from '../src/flower.js';

const ids = ['peony', 'rose', 'lotus', 'sunflower', 'tulip', 'lily'];
const labels = ['牡丹', '玫瑰', '莲花', '向日葵', '郁金香', '百合'];
const expectedRegions = {
  peony: ['PETAL', 'LEAF', 'STEM', 'CENTER'],
  rose: ['PETAL', 'LEAF', 'STEM', 'CENTER'],
  lotus: ['PETAL', 'LEAF', 'STEM', 'CENTER', 'SEED'],
  sunflower: ['PETAL', 'LEAF', 'STEM', 'CENTER', 'SEED'],
  tulip: ['PETAL', 'LEAF', 'STEM', 'CENTER'],
  lily: ['PETAL', 'LEAF', 'STEM', 'STAMEN', 'POLLEN'],
};

test('the flower catalog exposes six distinct Chinese selections and immutable metadata', () => {
  assert.deepEqual(FLOWER_TYPES.map(({ id }) => id), ids);
  assert.deepEqual(FLOWER_TYPES.map(({ label }) => label), labels);
  assert.equal(new Set(FLOWER_TYPES.map(({ id }) => id)).size, 6);
  assert.ok(Object.isFrozen(FLOWER_TYPES));
  for (const entry of FLOWER_TYPES) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(entry.labelEnglish.length > 0);
    assert.ok(entry.description.length > 0);
  }
  assert.ok(Object.isFrozen(FLOWER_REGIONS));
  assert.deepEqual(Object.keys(FLOWER_REGIONS), ['PETAL', 'LEAF', 'STEM', 'CENTER', 'SEED', 'STAMEN', 'POLLEN']);
});

for (const id of ids) {
  test(`${id}: particle arrays, region tags, colors and coordinates are finite and correctly sized`, () => {
    const flower = createFlower(10000, 194, id);
    assert.equal(flower.flowerType, id);
    assert.equal(flower.count, 10000);
    for (const key of ['position', 'scatter', 'color', 'data']) {
      assert.ok(flower[key] instanceof Float32Array, key);
      assert.equal(flower[key].length, 30000, key);
      assert.ok(flower[key].every(Number.isFinite), key);
    }
    assert.ok(flower.regions instanceof Uint8Array);
    assert.equal(flower.regions.length, 10000);
    assert.ok(flower.regions.every((region) => Object.values(FLOWER_REGIONS).includes(region)));
    assert.ok(flower.color.every((value) => value >= 0 && value <= 1));
    assert.ok(flower.scatter.every((value) => Math.abs(value) < 6));
    for (let index = 0; index < flower.data.length; index += 3) {
      assert.ok(flower.data[index] >= 0 && flower.data[index] <= 1);
      assert.ok(flower.data[index + 1] >= 0.55 - 1e-6 && flower.data[index + 1] <= 1.65 + 1e-6);
      assert.ok([0, 1, 2].includes(flower.data[index + 2]));
    }
    for (const regionName of expectedRegions[id]) {
      assert.ok(flower.regions.includes(FLOWER_REGIONS[regionName]), `missing ${regionName}`);
    }
  });

  test(`${id}: a dense gathered specimen fits inside the existing crystal case`, () => {
    const flower = createFlower(100000, 194, id);
    for (let index = 0; index < flower.position.length; index += 3) {
      assert.ok(Math.abs(flower.position[index]) <= 2.375, `${id} x exceeds the crystal`);
      assert.ok(flower.position[index + 1] >= -2.275 && flower.position[index + 1] <= 2.475, `${id} y exceeds the crystal`);
      assert.ok(Math.abs(flower.position[index + 2]) <= 1.6, `${id} z exceeds the crystal`);
    }
  });

  test(`${id}: geometric sampling is reproducible and responds to the seed`, () => {
    assert.deepEqual(createFlower(200, 42, id), createFlower(200, 42, id));
    assert.notDeepEqual(createFlower(200, 42, id).position, createFlower(200, 43, id).position);
  });
}

test('scatter positions and shader phase/size remain stable when the flower changes', () => {
  const reference = createFlower(1000, 81, 'peony');
  for (const id of ids.slice(1)) {
    const flower = createFlower(1000, 81, id);
    assert.deepEqual(flower.scatter, reference.scatter, `${id} must not shift the shared scattered cloud`);
    for (let index = 0; index < flower.data.length; index += 3) {
      assert.equal(flower.data[index], reference.data[index], `${id} phase at ${index / 3}`);
      assert.equal(flower.data[index + 1], reference.data[index + 1], `${id} size at ${index / 3}`);
    }
  }
});

test('the legacy default and alias still produce the peony specimen', () => {
  assert.deepEqual(createFlower(100, 42), createFlower(100, 42, 'peony'));
  assert.deepEqual(makeFlowerData(100, 42, 'lily'), createFlower(100, 42, 'lily'));
  assert.deepEqual(createFlower(100, 42, 'unknown'), createFlower(100, 42, 'peony'));
});

test('zero particles are supported and invalid particle counts are rejected', () => {
  for (const id of ids) {
    const flower = createFlower(0, 42, id);
    assert.equal(flower.count, 0);
    for (const key of ['position', 'scatter', 'color', 'data', 'regions']) assert.equal(flower[key].length, 0);
  }
  for (const count of [-1, 0.5, NaN, Infinity]) assert.throws(() => createFlower(count), RangeError);
});

// Inspect actual sampled buffers, independently of the display labels. These
// broad structural constraints catch a recolored copy or a missing flower part;
// they are not a claim of browser/GPU visual acceptance.
const specimens = new Map(ids.map((id) => [id, createFlower(30000, 194, id)]));
function regionPoints(flower, region) {
  const points = [];
  for (let index = 0; index < flower.count; index++) {
    if (flower.regions[index] !== region) continue;
    points.push({
      x: flower.position[index * 3], y: flower.position[index * 3 + 1], z: flower.position[index * 3 + 2],
      red: flower.color[index * 3], green: flower.color[index * 3 + 1], blue: flower.color[index * 3 + 2],
    });
  }
  return points;
}
const mean = (points, getValue) => points.reduce((sum, point) => sum + getValue(point), 0) / points.length;
const radial = ({ x, y }) => Math.hypot(x, y - 0.25);
const span = (points, key) => Math.max(...points.map((point) => point[key])) - Math.min(...points.map((point) => point[key]));
function sixfold(points, angleOf) {
  const cos = mean(points, (point) => Math.cos(6 * angleOf(point)));
  const sin = mean(points, (point) => Math.sin(6 * angleOf(point)));
  return Math.hypot(cos, sin);
}

test('peony and rose have different layered volumes, and the rose keeps a tight red spiral center', () => {
  const peonyPetals = regionPoints(specimens.get('peony'), FLOWER_REGIONS.PETAL);
  const rosePetals = regionPoints(specimens.get('rose'), FLOWER_REGIONS.PETAL);
  const roseCenter = regionPoints(specimens.get('rose'), FLOWER_REGIONS.CENTER);
  assert.ok(span(peonyPetals, 'z') > 0.9, 'peony petals must occupy a multilayer volume');
  assert.ok(mean(peonyPetals, radial) > mean(rosePetals, radial) + 0.1);
  assert.ok(roseCenter.every((point) => radial(point) < 0.4), 'rose spiral must stay compact');
  assert.ok(mean(roseCenter, ({ red, green }) => red - green * 4) > 0.2);
  const innerRose = rosePetals.filter((point) => radial(point) < 0.4);
  const outerRose = rosePetals.filter((point) => radial(point) > 1.4);
  assert.ok(innerRose.length > 500 && outerRose.length > 500);
  assert.ok(mean(innerRose, ({ z }) => z) > mean(outerRose, ({ z }) => z) + 0.2,
    'outer rose petals must flare out below the tight center');
});

test('lotus has broad green leaf pads and a raised gold receptacle containing seeds', () => {
  const flower = specimens.get('lotus');
  const leaves = regionPoints(flower, FLOWER_REGIONS.LEAF);
  const center = regionPoints(flower, FLOWER_REGIONS.CENTER);
  const seeds = regionPoints(flower, FLOWER_REGIONS.SEED);
  assert.ok(span(leaves, 'x') > 3.8 && span(leaves, 'y') > 1.3);
  assert.ok(mean(leaves, ({ green, red }) => green - red) > 0.2);
  assert.ok(mean(center, ({ red }) => red) > 0.85 && mean(center, ({ green }) => green) > 0.65);
  assert.ok(mean(center, ({ z }) => z) > 1);
  assert.ok(seeds.length > 300);
  assert.ok(seeds.every((point) => radial(point) < 0.35));
  assert.ok(mean(seeds, ({ z }) => z) > mean(center, ({ z }) => z));
});

test('sunflower separates an outer ring of gold petals from a dark disk and dense seed field', () => {
  const flower = specimens.get('sunflower');
  const petals = regionPoints(flower, FLOWER_REGIONS.PETAL);
  const center = regionPoints(flower, FLOWER_REGIONS.CENTER);
  const seeds = regionPoints(flower, FLOWER_REGIONS.SEED);
  assert.ok(petals.every((point) => radial(point) > 0.7));
  assert.ok(petals.every(({ z }) => z < 0.4), 'sunflower head should be a shallow disk');
  assert.ok(mean(petals, ({ red }) => red) > 0.9);
  assert.ok(mean(petals, ({ green }) => green) > 0.4);
  assert.ok(mean(petals, ({ blue }) => blue) < 0.2);
  assert.ok(center.every((point) => radial(point) < 0.81));
  assert.ok(mean(center, ({ red, green, blue }) => (red + green + blue) / 3) < 0.2);
  assert.ok(seeds.length > flower.count * 0.15);
  assert.ok(seeds.every((point) => radial(point) < 0.81));
  assert.ok(mean(seeds, radial) > 0.45 && mean(seeds, radial) < 0.6);
});

test('tulip is a tall narrow purple cup with six separated rim directions and a slender stem', () => {
  const flower = specimens.get('tulip');
  const petals = regionPoints(flower, FLOWER_REGIONS.PETAL);
  const stem = regionPoints(flower, FLOWER_REGIONS.STEM);
  const rim = petals.filter(({ y }) => y > 1.99);
  assert.ok(span(petals, 'y') > 1.8);
  assert.ok(span(petals, 'x') < 2 && span(petals, 'z') < 2);
  assert.ok(mean(petals, ({ blue, green }) => blue - green) > 0.25);
  assert.ok(rim.length > 150);
  assert.ok(sixfold(rim, ({ x, z }) => Math.atan2(z - 0.08, x)) > 0.5,
    'upper petal tips must form six cup directions around the vertical axis');
  assert.ok(span(stem, 'y') > 1.8 && span(stem, 'x') < 0.4);
});

test('lily has pale recurved petals, six projecting stamens and high gold pollen clusters', () => {
  const flower = specimens.get('lily');
  const petals = regionPoints(flower, FLOWER_REGIONS.PETAL);
  const stamens = regionPoints(flower, FLOWER_REGIONS.STAMEN);
  const pollen = regionPoints(flower, FLOWER_REGIONS.POLLEN);
  assert.ok(petals.filter(({ z }) => z < 0).length > petals.length * 0.05,
    'recurved petal tips must turn back past the flower plane');
  assert.ok(mean(petals, ({ red, green, blue }) => Math.min(red, green, blue)) > 0.65);
  assert.ok(span(stamens, 'z') > 0.75);
  assert.ok(sixfold(stamens, ({ x, y }) => Math.atan2(y - 0.25, x)) > 0.9);
  assert.ok(pollen.every(({ z }) => z > 1.25 && z < 1.4));
  assert.ok(sixfold(pollen, ({ x, y }) => Math.atan2(y - 0.25, x)) > 0.9);
  assert.ok(mean(pollen, ({ red, green, blue }) => Math.min(red, green) - blue) > 0.4);
});

function positionProfile(flower) {
  const bins = Array(30).fill(0);
  for (let index = 0; index < flower.count; index++) {
    const x = flower.position[index * 3], y = flower.position[index * 3 + 1], z = flower.position[index * 3 + 2];
    for (const [offset, value, min, max] of [
      [0, Math.hypot(x, y - 0.25), 0, 2.5], [10, z, -0.6, 1.6], [20, y, -2.275, 2.475],
    ]) {
      const bin = Math.max(0, Math.min(9, Math.floor((value - min) / (max - min) * 10)));
      bins[offset + bin]++;
    }
  }
  return bins.map((count) => count / flower.count);
}

test('all six point clouds differ in spatial distribution independently of color', () => {
  const profiles = ids.map((id) => ({ id, bins: positionProfile(specimens.get(id)) }));
  for (let first = 0; first < profiles.length; first++) {
    for (const second of profiles.slice(first + 1)) {
      const distance = profiles[first].bins.reduce((sum, value, index) => sum + Math.abs(value - second.bins[index]), 0);
      assert.ok(distance > 0.35, `${profiles[first].id} and ${second.id} have overly similar geometry (${distance})`);
    }
  }
});
