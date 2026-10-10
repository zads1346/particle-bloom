/** Deterministic botanical point sampling. No mesh or image assets are used. */
export const DEFAULT_FLOWER_TYPE = "peony";
export const FLOWER_TYPES = Object.freeze([
  { id: "peony", label: "牡丹", labelEnglish: "Peony", description: "粉白多层卷瓣，饱满盛放" },
  { id: "rose", label: "玫瑰", labelEnglish: "Rose", description: "酒红螺旋花心，绯红外翻花瓣" },
  { id: "lotus", label: "莲花", labelEnglish: "Lotus", description: "粉色尖瓣，金色莲蓬与宽绿叶" },
  { id: "sunflower", label: "向日葵", labelEnglish: "Sunflower", description: "金黄细长花瓣，深棕螺旋花盘" },
  { id: "tulip", label: "郁金香", labelEnglish: "Tulip", description: "紫粉六瓣杯形，修长花茎叶" },
  { id: "lily", label: "百合", labelEnglish: "Lily", description: "白粉反卷花瓣，长花蕊与金色花粉" },
].map(Object.freeze));

// CPU-only semantic regions support inspection without adding GPU resources.
export const FLOWER_REGIONS = Object.freeze({
  PETAL: 0, LEAF: 1, STEM: 2, CENTER: 3, SEED: 4, STAMEN: 5, POLLEN: 6,
});
const { PETAL, LEAF, STEM, CENTER, SEED, STAMEN, POLLEN } = FLOWER_REGIONS;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const clamp = (value) => Math.max(0, Math.min(1, value));

export function seededRandom(seed = 194) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function point(out, x, y, z, r, g, b, kind, region) {
  out[0] = x; out[1] = y; out[2] = z;
  out[3] = clamp(r); out[4] = clamp(g); out[5] = clamp(b);
  out[6] = kind; out[7] = region;
}

function radialPoint(out, angle, radial, tangent, z, r, g, b, kind, region) {
  const c = Math.cos(angle), s = Math.sin(angle);
  point(out, radial * c - tangent * s, radial * s + tangent * c, z,
    r, g, b, kind, region);
}

function stem(random, out, slim = false) {
  const t = random(), a = random() * TAU;
  const radius = slim ? 0.024 : 0.033;
  point(out,
    Math.sin(t * 3.4) * (slim ? 0.045 : 0.12) + Math.cos(a) * radius,
    -0.24 - t * 2.02,
    -0.36 - t * 0.08 + Math.sin(a) * radius,
    0.17 + random() * 0.14, 0.38 + random() * 0.2, 0.19 + random() * 0.12,
    1, STEM);
}

function blade(random, out, side, long = false) {
  const t = random(), v = random() * 2 - 1;
  const width = (long ? 0.115 : 0.23) * Math.pow(Math.sin(Math.PI * t), 0.85);
  const vein = Math.exp(-v * v * 130);
  point(out,
    side * ((long ? 0.08 : 0.16) + (long ? 0.75 : 1.12) * t) + width * v * 0.35,
    (long ? -1.91 : -1.61) + (long ? 1.81 : 0.77) * t + width * v,
    -0.34 + 0.16 * Math.sin(Math.PI * t) + (long ? 0.34 : 0.12) * t * t,
    0.19 + vein * 0.11 + random() * 0.1,
    0.47 + vein * 0.15 + random() * 0.13,
    0.24 + vein * 0.08 + random() * 0.1,
    1, LEAF);
}

function peony(random, out) {
  const type = random();
  if (type < 0.835) {
    const layer = Math.floor(random() * 7);
    const petals = [13, 13, 12, 11, 9, 7, 5][layer];
    const petal = Math.floor(random() * petals);
    const angle = petal / petals * TAU + layer * 0.39 + Math.sin(petal * 7.13 + layer) * 0.045;
    const t = Math.pow(random(), 0.85), v = random() * 2 - 1;
    const length = (1.94 - layer * 0.205) * (1 + Math.sin(petal * 11.7 + layer * 3.1) * 0.105);
    const width = (0.52 - layer * 0.053) * (1 + Math.cos(petal * 4.3) * 0.12)
      * Math.pow(Math.sin(Math.PI * t), 0.66);
    const radial = 0.09 + layer * 0.055 + length * t + 0.035 * Math.cos(v * 5) * Math.sin(t * Math.PI);
    let z = layer * 0.11 + 0.44 * Math.sin(t * Math.PI) + 0.19 * v * v
      + Math.pow(t, 6) * (0.22 + layer * 0.02)
      + 0.035 * Math.sin(t * 26 + v * 9 + petal) * Math.pow(Math.abs(v), 1.6)
      + Math.sin(petal * 5.17 + layer) * t * t * 0.17
      + Math.sin(petal * 2.7) * v * t * 0.13;
    z += (random() - 0.5) * (0.024 + 0.04 * t);
    const veins = Math.pow(0.5 + 0.5 * Math.cos(v * 30 + t * 8), 12);
    const edge = Math.pow(Math.abs(v), 5), tip = Math.pow(t, 3), shine = random();
    const slope = (0.44 * Math.PI * Math.cos(t * Math.PI)
      + 6 * Math.pow(t, 5) * (0.22 + layer * 0.02)) / length;
    const nz = 1 / Math.sqrt(1 + slope * slope);
    const light = 0.76 + 0.24 * Math.max(0,
      -slope * Math.cos(angle) * nz * -0.4 - slope * Math.sin(angle) * nz * 0.58 + nz * 0.71);
    radialPoint(out, angle, radial, width * v, z,
      (0.64 + tip * 0.28 + edge * 0.18 + shine * 0.07 + veins * 0.11) * light,
      (0.2 + tip * 0.24 + edge * 0.3 + shine * 0.08 + veins * 0.12) * light,
      (0.36 + tip * 0.24 + edge * 0.25 + shine * 0.11 + veins * 0.12) * light,
      0, PETAL);
  } else if (type < 0.936) {
    const leaf = Math.floor(random() * 7), angle = leaf / 7 * TAU + 0.4;
    const t = random(), v = random() * 2 - 1;
    const radial = 0.4 + t * (1.72 + Math.sin(leaf * 3.7) * 0.17);
    const tangent = 0.29 * Math.pow(Math.sin(t * Math.PI), 0.8) * v;
    const vein = Math.exp(-v * v * 150)
      + Math.pow(0.5 + 0.5 * Math.cos(v * 17 - t * 35), 20) * 0.25;
    radialPoint(out, angle, radial, tangent,
      -0.3 - 0.25 * t + 0.13 * v * v + 0.035 * Math.sin(t * 24 + v * 8),
      0.25 + random() * 0.18 + vein * 0.16,
      0.49 + random() * 0.25 + vein * 0.17,
      0.26 + random() * 0.15 + vein * 0.1, 1, LEAF);
  } else if (type < 0.975) {
    if (random() < 0.65) blade(random, out, random() > 0.5 ? 1 : -1);
    else stem(random, out);
  } else {
    const a = random() * TAU, radius = Math.sqrt(random()) * 0.26;
    radialPoint(out, a, radius, 0, 0.86 + random() * 0.14,
      0.97, 0.65 + random() * 0.22, 0.36 + random() * 0.3, 2, CENTER);
  }
}

function rose(random, out) {
  const type = random();
  if (type < 0.78) {
    const layer = Math.floor(random() * 5);
    const petals = [5, 7, 9, 11, 13][layer];
    const petal = Math.floor(random() * petals);
    const t = random(), v = random() * 2 - 1;
    const angle = petal / petals * TAU + layer * 0.47 + (0.36 - layer * 0.035) * t;
    const length = (0.37 + layer * 0.255) * (1 + 0.045 * Math.sin(petal * 3.8));
    const width = (0.22 + layer * 0.062) * Math.pow(Math.sin(Math.PI * t), 0.55);
    const radial = 0.07 + layer * 0.13 + length * t;
    const z = 0.93 - layer * 0.103 + 0.21 * Math.sin(Math.PI * t)
      - (0.29 + layer * 0.052) * Math.pow(t, 4) + 0.19 * v * v * t * t
      + 0.018 * Math.sin(v * 12 + t * 14 + petal) + (random() - 0.5) * 0.032;
    const edge = Math.pow(Math.abs(v), 4), shine = random();
    radialPoint(out, angle, radial, width * v, z,
      0.35 + t * 0.42 + edge * 0.12 + shine * 0.06,
      0.024 + t * 0.095 + edge * 0.052 + shine * 0.025,
      0.073 + t * 0.095 + edge * 0.06 + shine * 0.035,
      0, PETAL);
  } else if (type < 0.85) {
    // A continuous curled ribbon makes a tight spiral, rather than radial petals.
    const t = random(), v = random() * 2 - 1;
    const angle = 3.65 * TAU * t + v * 0.2;
    const radial = 0.026 + t * 0.32 + v * 0.018;
    radialPoint(out, angle, radial, 0, 1.105 - t * 0.19 + v * v * 0.04,
      0.37 + t * 0.26, 0.025 + t * 0.04, 0.075 + t * 0.075, 0, CENTER);
  } else if (type < 0.945) {
    const leaf = Math.floor(random() * 4), t = random(), v = random() * 2 - 1;
    const angle = 3.45 + leaf * 0.67;
    const edge = Math.abs(v), vein = Math.exp(-v * v * 120);
    const width = 0.27 * Math.pow(Math.sin(Math.PI * t), 0.82)
      * (1 + 0.04 * Math.sin(t * 65));
    radialPoint(out, angle, 0.4 + t * 1.38, width * v,
      -0.27 - 0.13 * t + 0.14 * v * v,
      0.13 + vein * 0.1 + edge * 0.035,
      0.33 + vein * 0.18 + random() * 0.13,
      0.16 + vein * 0.08 + random() * 0.055, 1, LEAF);
  } else if (type < 0.98) stem(random, out);
  else {
    const sepal = Math.floor(random() * 5), t = random(), v = random() * 2 - 1;
    radialPoint(out, sepal / 5 * TAU + 0.6, 0.13 + 0.97 * t,
      0.095 * Math.sin(Math.PI * t) * v, -0.12 - t * 0.31,
      0.2, 0.44 + random() * 0.12, 0.23, 1, LEAF);
  }
}

function lotus(random, out) {
  const type = random();
  if (type < 0.705) {
    const layer = Math.floor(random() * 3);
    const petals = [10, 8, 6][layer], petal = Math.floor(random() * petals);
    const angle = petal / petals * TAU + layer * 0.34;
    const t = random(), v = random() * 2 - 1;
    const length = [1.93, 1.53, 1.07][layer];
    const width = [0.43, 0.38, 0.30][layer] * Math.pow(Math.sin(Math.PI * t), 0.86);
    const radial = 0.11 + layer * 0.07 + length * t;
    const z = 0.015 + layer * 0.21 + (0.5 + layer * 0.08) * t
      + 0.19 * Math.sin(Math.PI * t) + 0.12 * v * v + (random() - 0.5) * 0.02;
    const tip = Math.pow(t, 4), edge = Math.pow(Math.abs(v), 4);
    const vein = Math.pow(0.5 + 0.5 * Math.cos(v * 22 + t * 6), 14);
    radialPoint(out, angle, radial, width * v, z,
      0.84 + tip * 0.12 + random() * 0.035,
      0.43 - tip * 0.2 + edge * 0.16 + vein * 0.07,
      0.59 - tip * 0.09 + edge * 0.1 + vein * 0.05,
      0, PETAL);
  } else if (type < 0.885) {
    // Two broad, nearly circular notched pads with radiating veins.
    const side = random() > 0.5 ? 1 : -1;
    const a = 0.19 + random() * (TAU - 0.38), radius = Math.sqrt(random());
    const x = side * 1.08 + Math.cos(a) * radius * 1.04;
    const y = -0.61 + Math.sin(a) * radius * 0.75;
    const vein = Math.pow(0.5 + 0.5 * Math.cos(a * 14 + radius * 3), 18);
    point(out, x, y, -0.42 + radius * radius * 0.12 + 0.032 * Math.sin(a * 7),
      0.16 + vein * 0.11 + random() * 0.055,
      0.44 + vein * 0.17 + random() * 0.13,
      0.23 + vein * 0.06 + random() * 0.055, 1, LEAF);
  } else if (type < 0.915) stem(random, out, true);
  else if (type < 0.978) {
    const a = random() * TAU;
    const top = random() > 0.3, h = random();
    const radius = top ? 0.34 * Math.sqrt(h) : 0.22 + 0.12 * h;
    radialPoint(out, a, radius, 0, top ? 1.10 + random() * 0.018 : 0.87 + h * 0.23,
      0.91 + random() * 0.07, 0.68 + random() * 0.15, 0.18 + random() * 0.13, 2, CENTER);
  } else {
    const n = Math.floor(random() * 17), a = n * GOLDEN_ANGLE;
    const radius = 0.275 * Math.sqrt((n + 0.5) / 17);
    const jitterA = random() * TAU, jitterR = 0.032 * Math.sqrt(random());
    point(out, Math.cos(a) * radius + Math.cos(jitterA) * jitterR,
      Math.sin(a) * radius + Math.sin(jitterA) * jitterR, 1.127 + random() * 0.015,
      0.39 + random() * 0.16, 0.32 + random() * 0.1, 0.07, 2, SEED);
  }
}

function sunflower(random, out) {
  const type = random();
  if (type < 0.46) {
    const layer = random() > 0.62 ? 1 : 0;
    const petals = 34, petal = Math.floor(random() * petals);
    const angle = petal / petals * TAU + layer * Math.PI / petals;
    const t = random(), v = random() * 2 - 1;
    const length = 1.31 + 0.08 * Math.sin(petal * 8.13) - layer * 0.1;
    const width = 0.14 * Math.pow(Math.sin(Math.PI * t), 0.73);
    const radial = 0.72 + length * t;
    const ridge = Math.exp(-v * v * 20), edge = Math.pow(Math.abs(v), 4);
    radialPoint(out, angle, radial, width * v,
      0.09 - layer * 0.085 + 0.09 * Math.sin(Math.PI * t) + 0.07 * ridge
        - 0.07 * t * t + (random() - 0.5) * 0.015,
      0.91 + random() * 0.08,
      0.43 + t * 0.26 + ridge * 0.1 + edge * 0.06,
      0.04 + t * 0.055 + edge * 0.06, 0, PETAL);
  } else if (type < 0.675) {
    const a = random() * TAU, radius = Math.sqrt(random()) * 0.79;
    radialPoint(out, a, radius, 0, 0.205 + 0.115 * (1 - radius * radius / 0.625),
      0.042 + random() * 0.018, 0.014 + random() * 0.009, 0.004 + random() * 0.006, 0, CENTER);
  } else if (type < 0.865) {
    // Vogel phyllotaxis: each small seed has a distinct golden-angle center.
    const n = Math.floor(random() * 1100), a = n * GOLDEN_ANGLE;
    const radius = 0.763 * Math.sqrt((n + 0.5) / 1100);
    const localA = random() * TAU, localR = Math.sqrt(random()) * 0.014;
    // Dense additive points otherwise bleach the dark disc into yellow.
    // Fixed occasional gold glints leave the seed spiral visible in deep brown.
    const glint = n % 19 === 0 ? 1 : 0;
    point(out, Math.cos(a) * radius + Math.cos(localA) * localR,
      Math.sin(a) * radius + Math.sin(localA) * localR,
      0.23 + 0.118 * (1 - radius * radius / 0.625) + random() * 0.018,
      0.12 + random() * 0.045 + radius * 0.025 + glint * 0.21,
      0.043 + random() * 0.02 + radius * 0.012 + glint * 0.13,
      0.012 + random() * 0.01 + glint * 0.014, 2, SEED);
  } else if (type < 0.96) {
    const side = random() > 0.5 ? 1 : -1, t = random(), v = random() * 2 - 1;
    const width = 0.45 * Math.pow(Math.sin(Math.PI * t), 0.64);
    const vein = Math.exp(-v * v * 125);
    point(out, side * (0.14 + 1.2 * t) + width * v * 0.18,
      -1.37 + t * 0.67 + width * v, -0.36 + 0.17 * v * v + 0.08 * t,
      0.19 + vein * 0.11, 0.42 + vein * 0.19 + random() * 0.12,
      0.19 + random() * 0.1, 1, LEAF);
  } else stem(random, out);
}

function tulip(random, out) {
  const type = random();
  if (type < 0.825) {
    const petal = Math.floor(random() * 6), t = random(), v = random() * 2 - 1;
    const angle = petal / 6 * TAU + (petal % 2 ? 0.025 : -0.025) + v * 0.49;
    const radius = 0.15 + 0.82 * Math.sin(t * Math.PI * 0.5)
      - 0.09 * Math.pow(t, 8) + 0.035 * Math.sin(Math.PI * t) * v * v;
    const y = -0.08 + t * 1.87 - 0.18 * v * v * Math.pow(t, 3)
      + (petal % 2 ? 0.025 : 0) * t;
    const stripe = Math.exp(-v * v * 17), shine = random();
    point(out, Math.cos(angle) * radius, y,
      0.08 + Math.sin(angle) * radius + (random() - 0.5) * 0.015,
      0.43 + stripe * 0.4 + t * 0.09 + shine * 0.055,
      0.14 + stripe * 0.17 + t * 0.17 + shine * 0.035,
      0.59 + stripe * 0.1 + t * 0.15 + shine * 0.04, 0, PETAL);
  } else if (type < 0.95) blade(random, out, random() > 0.5 ? 1 : -1, true);
  else if (type < 0.989) stem(random, out, true);
  else {
    const n = Math.floor(random() * 6), a = n / 6 * TAU;
    const t = random();
    point(out, Math.cos(a) * (0.05 + t * 0.14), 0.13 + t * 0.57,
      0.08 + Math.sin(a) * (0.05 + t * 0.14),
      0.89, 0.67 + random() * 0.16, 0.22, 2, CENTER);
  }
}

function lily(random, out) {
  const type = random();
  if (type < 0.78) {
    const petal = Math.floor(random() * 6), t = random(), v = random() * 2 - 1;
    const angle = petal / 6 * TAU + Math.PI / 6 + (petal % 2 ? 0.07 : -0.07);
    const length = petal % 2 ? 2.04 : 1.87;
    // Radius retreats as the tip curls backwards, while depth turns negative.
    const radial = 0.13 + length * Math.sin(t * Math.PI * 0.5) - 0.3 * Math.pow(t, 7);
    const width = (petal % 2 ? 0.39 : 0.33) * Math.pow(Math.sin(Math.PI * t), 0.85);
    const z = 0.34 + 0.72 * Math.sin(Math.PI * t) - 0.97 * Math.pow(t, 3)
      + 0.16 * v * v + (random() - 0.5) * 0.022;
    const stripe = Math.exp(-v * v * 11), base = Math.pow(1 - t, 3);
    const fleck = Math.pow(0.5 + 0.5 * Math.sin(t * 77 + v * 44 + petal * 5), 24)
      * stripe * (1 - t) * 0.1;
    radialPoint(out, angle, radial, width * v, z,
      0.96 - base * 0.075 - fleck,
      0.88 - stripe * 0.34 - base * 0.24 - fleck * 2,
      0.85 - stripe * 0.17 - base * 0.19 - fleck, 0, PETAL);
  } else if (type < 0.885) {
    const side = random() > 0.5 ? 1 : -1;
    blade(random, out, side, true);
  } else if (type < 0.935) stem(random, out, true);
  else if (type < 0.979) {
    const n = Math.floor(random() * 6), a = n / 6 * TAU + 0.2;
    const t = random(), jitterA = random() * TAU;
    const radius = 0.06 + 0.48 * t;
    point(out, Math.cos(a) * radius + Math.cos(jitterA) * 0.009,
      Math.sin(a) * radius + Math.sin(jitterA) * 0.009,
      0.46 + 0.85 * t,
      0.91, 0.83 + random() * 0.12, 0.61 + random() * 0.12, 2, STAMEN);
  } else {
    const n = Math.floor(random() * 6), a = n / 6 * TAU + 0.2;
    const length = (random() - 0.5) * 0.22;
    const localA = random() * TAU, localR = Math.sqrt(random()) * 0.052;
    point(out, Math.cos(a) * (0.54 + length) + Math.cos(localA) * localR,
      Math.sin(a) * (0.54 + length) + Math.sin(localA) * localR,
      1.31 + Math.sin(localA) * localR * 0.65,
      0.94 + random() * 0.055, 0.54 + random() * 0.21, 0.08 + random() * 0.1, 2, POLLEN);
  }
}

const SAMPLERS = Object.freeze({ peony, rose, lotus, sunflower, tulip, lily });
const TYPE_SEEDS = Object.freeze({ peony: 0, rose: 0x17495, lotus: 0x24851, sunflower: 0x33671, tulip: 0x42739, lily: 0x51787 });

export function resolveFlowerType(type = DEFAULT_FLOWER_TYPE) {
  const id = typeof type === "object" && type !== null ? type.id : type;
  return Object.hasOwn(SAMPLERS, id) ? id : DEFAULT_FLOWER_TYPE;
}

/** All blooms fit the same case. Scatter and motion phases do not depend on type. */
export function createFlower(count = 100000, seed = 194, flowerType = DEFAULT_FLOWER_TYPE) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Particle count must be a non-negative integer.");
  flowerType = resolveFlowerType(flowerType);
  const random = seededRandom((seed | 0) ^ TYPE_SEEDS[flowerType]);
  const scatterRandom = seededRandom((seed | 0) ^ 0x9e3779b9);
  const phaseRandom = seededRandom((seed | 0) ^ 0x51ed270b);
  const position = new Float32Array(count * 3), scatter = new Float32Array(count * 3);
  const color = new Float32Array(count * 3), data = new Float32Array(count * 3);
  const regions = new Uint8Array(count), out = new Float64Array(8);
  const sample = SAMPLERS[flowerType];
  for (let i = 0; i < count; i++) {
    sample(random, out);
    const offset = i * 3;
    position[offset] = out[0]; position[offset + 1] = out[1] + 0.25; position[offset + 2] = out[2];
    color[offset] = out[3]; color[offset + 1] = out[4]; color[offset + 2] = out[5];
    regions[i] = out[7];
    const arm = i % 3;
    const radius = 0.62 + Math.pow(scatterRandom(), 0.72) * 3.3;
    const diffuse = scatterRandom() < 0.12;
    const angle = arm * TAU / 3 + radius * 1.02
      + (scatterRandom() - 0.5) * (diffuse ? 1.8 : 0.22 + 0.08 * radius);
    scatter[offset] = Math.cos(angle) * radius;
    scatter[offset + 1] = Math.sin(angle) * radius * 0.76;
    scatter[offset + 2] = Math.sin(radius * 1.4 + arm * 1.3) * 0.85
      + (scatterRandom() - 0.5) * (diffuse ? 1.7 : 0.24);
    data[offset] = phaseRandom(); data[offset + 1] = 0.55 + phaseRandom() * 1.1; data[offset + 2] = out[6];
  }
  return { position, scatter, color, data, count, flowerType, regions };
}

export const makeFlowerData = createFlower;
