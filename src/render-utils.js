/** Pure rendering decisions, shared by the scene and headless tests. */
export const CAMERA_FOV = 39;
export const FLOWER_BOUNDS = Object.freeze({ width: 5.2, height: 5.9, depth: 3.3 });
// A sphere around the entire specimen stays valid under arbitrary rotation.
export const FLOWER_RADIUS = Math.hypot(
  FLOWER_BOUNDS.width, FLOWER_BOUNDS.height, FLOWER_BOUNDS.depth,
) / 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Screen fractions, with y measured down from the top of the viewport. */
export function getArtSafeArea(width, height) {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new RangeError('Viewport width and height must be positive finite numbers.');
  }
  if (width <= 650) {
    return { left: 0.06, right: 0.94,
      top: Math.min(320 / height, 0.44), bottom: 1 - Math.min(150 / height, 0.22) };
  }
  if (width <= 1000) return { left: 0.09, right: 0.91, top: 0.30, bottom: 0.82 };
  return { left: 0.35, right: 0.85, top: 0.16, bottom: 0.80 };
}

/**
 * Fits a rotation-safe sphere inside the art's sub-frustum, not just the whole
 * viewport. Unlike width / tan(fov), this includes perspective/depth and an
 * off-center specimen. Camera looks down -Z from (0, 0, cameraZ); flower z = 0.
 * Returned positions are world-space offsets relative to camera x/y.
 * This protects scale = 1; intentional zoom and scattered particles may exceed it.
 */
export function getFraming(width, height) {
  const area = getArtSafeArea(width, height);
  const tanY = Math.tan(CAMERA_FOV * Math.PI / 360);
  const tanX = tanY * width / height;
  const left = (area.left * 2 - 1) * tanX;
  const right = (area.right * 2 - 1) * tanX;
  const bottom = (1 - area.bottom * 2) * tanY;
  const top = (1 - area.top * 2) * tanY;
  const radius = FLOWER_RADIUS * 1.025; // Leave a small point/bloom halo margin.
  const inset = (slope) => radius * Math.hypot(1, slope);
  const cameraZ = Math.max(
    (inset(left) + inset(right)) / (right - left),
    (inset(bottom) + inset(top)) / (top - bottom),
  );
  // Midpoint of legal sphere-center intervals between each pair of clip planes.
  return {
    cameraZ,
    positionX: ((left + right) * cameraZ + inset(left) - inset(right)) / 2,
    positionY: ((bottom + top) * cameraZ + inset(bottom) - inset(top)) / 2,
  };
}

/**
 * Tighter fit for an already-oriented, axis-aligned world-space bounding box.
 * Include the flower/glass at their initial rotation, before its layout offset.
 * Each corner is projected at its own depth. The result fits this orientation;
 * later intentional rotation/zoom can exceed the art area.
 */
export function getFramingForBounds(width, height, bounds) {
  const area = getArtSafeArea(width, height);
  for (const axis of ['X', 'Y', 'Z']) {
    const min = bounds?.[`min${axis}`], max = bounds?.[`max${axis}`];
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new RangeError(`Bounds require finite min${axis} <= max${axis}.`);
    }
  }
  const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
  const tanY = Math.tan(CAMERA_FOV * Math.PI / 360), tanX = tanY * width / height;
  const left = (area.left * 2 - 1) * tanX, right = (area.right * 2 - 1) * tanX;
  const bottom = (1 - area.bottom * 2) * tanY, top = (1 - area.top * 2) * tanY;
  const minAtDepth = (slope) => Math.min(slope * minZ, slope * maxZ);
  const maxAtDepth = (slope) => Math.max(slope * minZ, slope * maxZ);
  const cameraZ = Math.max(
    (maxX - minX + maxAtDepth(right) - minAtDepth(left)) / (right - left),
    (maxY - minY + maxAtDepth(top) - minAtDepth(bottom)) / (top - bottom),
    maxZ + 0.11, // Keep every corner beyond the scene's 0.1 near plane.
    0.11,
  );
  const minPositionX = left * cameraZ - minX - minAtDepth(left);
  const maxPositionX = right * cameraZ - maxX - maxAtDepth(right);
  const minPositionY = bottom * cameraZ - minY - minAtDepth(bottom);
  const maxPositionY = top * cameraZ - maxY - maxAtDepth(top);
  return {
    cameraZ,
    positionX: (minPositionX + maxPositionX) / 2,
    positionY: (minPositionY + maxPositionY) / 2,
  };
}

export const QUALITY_TIERS = Object.freeze({ high: 100000, medium: 60000, low: 28000 });
const QUALITY_ORDER = Object.freeze(['high', 'medium', 'low']);

function requireTier(tier) {
  if (!Object.hasOwn(QUALITY_TIERS, tier)) throw new RangeError(`Unknown quality tier: ${tier}`);
  return tier;
}

/** Device DPR is never increased; expensive high-DPR rendering is capped by tier. */
export function getQualitySettings(quality = 'auto', { width = 1280, devicePixelRatio = 1 } = {}) {
  const mobile = width <= 650;
  const tier = quality === 'auto' ? (mobile ? 'medium' : 'high') : requireTier(quality);
  const cap = { high: mobile ? 1.5 : 2, medium: mobile ? 1.25 : 1.5, low: 1 }[tier];
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { tier, count: QUALITY_TIERS[tier], pixelRatio: Math.min(ratio, cap) };
}

export function createAdaptiveQualityState(tier = 'high') {
  return { tier: requireTier(tier), slowMs: 0, cooldownMs: 0 };
}

/**
 * Feed consecutive visible, warmed-up FPS windows while auto quality is enabled.
 * Six seconds below 30 FPS reduces one tier, then six seconds of cooldown lets
 * GPU allocation settle. No automatic upgrade means no visual/performance flaps.
 * Inactive, invalid, or long (> 5 s) windows break the sustained-slow streak.
 */
export function updateAdaptiveQuality(state, { fps, elapsedMs, active = true }) {
  const next = { ...state, tier: requireTier(state.tier) };
  if (!active || !Number.isFinite(fps) || fps <= 0
      || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > 5000) {
    return { ...next, slowMs: 0 };
  }
  const elapsedAfterCooldown = Math.max(0, elapsedMs - next.cooldownMs);
  next.cooldownMs = Math.max(0, next.cooldownMs - elapsedMs);
  next.slowMs = fps < 30 ? next.slowMs + elapsedAfterCooldown : 0;
  if (next.tier === 'low') return { ...next, slowMs: 0 };
  if (next.slowMs >= 6000) {
    next.tier = QUALITY_ORDER[QUALITY_ORDER.indexOf(next.tier) + 1];
    next.slowMs = 0;
    next.cooldownMs = 6000;
  }
  return next;
}

/** Radians. Output stays continuous near `from`, even across the +/-PI seam. */
export function shortestAngleLerp(from, to, alpha) {
  if (![from, to, alpha].every(Number.isFinite)) {
    throw new RangeError('Angles and interpolation amount must be finite.');
  }
  const tau = Math.PI * 2;
  // Reduce operands separately to avoid overflow when subtracting finite angles.
  const difference = (to % tau) - (from % tau);
  let delta = ((difference + Math.PI) % tau + tau) % tau - Math.PI;
  if (delta === -Math.PI && difference > 0) delta = Math.PI;
  return from + delta * clamp(alpha, 0, 1);
}
