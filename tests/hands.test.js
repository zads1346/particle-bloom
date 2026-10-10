import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HAND_STATE, deriveHandState, measureHandGesture, createHandController, resolveHandAssetUrls } from '../src/hands.js';

function pose(open = true, roll = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.70, z: 0 }));
  points[0] = { x: 0.5, y: 0.90, z: 0 };
  [5, 9, 13, 17].forEach((index, finger) => {
    const x = 0.32 + finger * 0.12;
    points[index] = { x, y: 0.60, z: 0 };
    points[index + 1] = { x, y: 0.45, z: 0 };
    points[index + 2] = { x, y: open ? 0.32 : 0.52, z: 0 };
    points[index + 3] = { x, y: open ? 0.20 : 0.65, z: 0 };
  });
  points[1] = { x: 0.33, y: 0.80, z: 0 };
  points[2] = { x: 0.22, y: 0.72, z: 0 };
  points[3] = { x: 0.12, y: 0.61, z: 0 };
  points[4] = { x: 0.06, y: 0.52, z: 0 };
  return points.map((p) => ({
    x: 0.5 + (p.x - 0.5) * Math.cos(roll) - (p.y - 0.9) * Math.sin(roll),
    y: 0.9 + (p.x - 0.5) * Math.sin(roll) + (p.y - 0.9) * Math.cos(roll), z: p.z,
  }));
}

const results = (...hands) => ({
  landmarks: hands.map((hand) => hand.points),
  handedness: hands.map((hand) => [{ categoryName: hand.label, score: hand.score ?? 0.95 }]),
});
const right = (points = pose()) => results({ label: 'Left', points });

test('a raw-video anatomical right palm gathers', () => {
  const state = deriveHandState(right());
  assert.equal(state.gather, 1);
  assert.equal(state.detected, true);
  assert.match(state.gesture, /右手张开/);
});

test('a raw-video anatomical right fist resets composition', () => {
  const state = deriveHandState(right(pose(false)), { gather: 1, rotation: 1, scale: 1.7, scan: 1 });
  assert.equal(state.gather, 0);
  assert.equal(state.rotation, 0);
  assert.equal(state.scale, 1);
  assert.equal(state.scan, 0);
});

test('handedness is swapped only for unmirrored source pixels', () => {
  const frame = results({ label: 'Right', points: pose() });
  assert.equal(deriveHandState(frame).gather, 0);
  assert.equal(deriveHandState(frame, undefined, { inputMirrored: true }).gather, 1);
});

test('left-hand opening controls scale without gathering', () => {
  const open = deriveHandState(results({ label: 'Right', points: pose() }));
  const closed = deriveHandState(results({ label: 'Right', points: pose(false) }));
  assert.equal(open.gather, 0);
  assert.equal(open.scale, 1.75);
  assert.equal(closed.scale, 0.65);
  assert.equal(open.hasRight, false);
  assert.equal(open.hasLeft, true);
  assert.equal(open.reset, false);
});

test('hand presence and reset flags describe only the current accepted frame', () => {
  const fist = deriveHandState(right(pose(false)));
  assert.equal(fist.hasRight, true);
  assert.equal(fist.hasLeft, false);
  assert.equal(fist.reset, true);
  const leftOnly = deriveHandState(results({ label: 'Right', points: pose() }), fist);
  assert.equal(leftOnly.hasRight, false);
  assert.equal(leftOnly.hasLeft, true);
  assert.equal(leftOnly.reset, false);
  const missing = deriveHandState({}, fist);
  assert.equal(missing.hasRight, false);
  assert.equal(missing.hasLeft, false);
  assert.equal(missing.reset, false);
  const uncertain = deriveHandState(results({ label: 'Left', points: pose(false), score: 0.5 }), fist);
  assert.equal(uncertain.hasRight, false);
  assert.equal(uncertain.reset, false);
});

test('pinching with other fingers extended triggers scan', () => {
  const points = pose();
  points[4] = { ...points[8] };
  assert.equal(deriveHandState(right(points)).scan, 1);
});

test('a fist does not accidentally trigger a pinch scan', () => {
  const points = pose(false);
  points[4] = { ...points[8] };
  assert.equal(deriveHandState(right(points)).scan, 0);
});

test('measurements are invariant to in-plane rotation', () => {
  assert.equal(measureHandGesture(pose()).open, true);
  assert.equal(measureHandGesture(pose(true, Math.PI / 2)).open, true);
  assert.equal(measureHandGesture(pose(false, Math.PI / 2)).fist, true);
});

test('wrist roll is reflected into mirrored preview coordinates', () => {
  const upright = deriveHandState(right(pose())).rotation;
  const tilted = deriveHandState(right(pose(true, 0.5))).rotation;
  assert.ok(Math.abs((tilted - upright) + 0.5) < 0.0001);
});

test('uncertain identity is ignored and existing composition is held', () => {
  const previous = { ...DEFAULT_HAND_STATE, gather: 1, scale: 1.4, rotation: 0.3, scan: 1 };
  const state = deriveHandState(results({ label: 'Left', points: pose(false), score: 0.51 }), previous);
  assert.equal(state.detected, false);
  assert.equal(state.gather, 1);
  assert.equal(state.scale, 1.4);
  assert.equal(state.rotation, 0.3);
  assert.equal(state.scan, 0);
  assert.match(state.gesture, /不稳定/);
});

test('missing hands release scan and preserve the last composition', () => {
  const state = deriveHandState({ landmarks: [] }, { gather: 1, rotation: 0.2, scale: 1.2, scan: 1 });
  assert.equal(state.detected, false);
  assert.equal(state.gather, 1);
  assert.equal(state.rotation, 0.2);
  assert.equal(state.scale, 1.2);
  assert.equal(state.scan, 0);
});

test('malformed and degenerate landmarks are safely rejected', () => {
  assert.equal(measureHandGesture([]), null);
  assert.equal(measureHandGesture(Array(21).fill({ x: 0, y: 0 })), null);
  const malformed = pose();
  malformed[4].x = NaN;
  assert.equal(deriveHandState(right(malformed)).detected, false);
});

test('controller construction never requests the camera and dispose is repeatable', async () => {
  const messages = [];
  const controller = await createHandController({ video: {}, onStatus: (text) => messages.push(text) });
  assert.equal(messages.length, 0);
  controller.dispose();
  controller.dispose();
  assert.equal(await controller.start(), false);
});

function mockCamera(t, getUserMedia) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
}

test('permission denial reports a useful Chinese status and is retryable', async (t) => {
  let calls = 0;
  mockCamera(t, async () => {
    calls += 1;
    throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  });
  const messages = [];
  const controller = await createHandController({ video: {}, onStatus: (text) => messages.push(text) });
  assert.equal(calls, 0);
  assert.equal(await controller.start(), false);
  assert.match(messages.at(-1), /未获得摄像头权限/);
  assert.equal(await controller.start(), false);
  assert.equal(calls, 2);
  controller.dispose();
});

test('repeated start shares one request and stop closes a late permission grant', async (t) => {
  let grant;
  let calls = 0;
  let stopped = 0;
  mockCamera(t, () => {
    calls += 1;
    return new Promise((resolve) => { grant = resolve; });
  });
  const controller = await createHandController({ video: {} });
  const first = controller.start();
  const second = controller.start();
  assert.equal(first, second);
  assert.equal(calls, 1);
  controller.stop();
  // Cancellation resolves startup even while the browser permission prompt is pending.
  assert.equal(await first, false);
  grant({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
  await settle();
  assert.equal(stopped, 1);
  controller.dispose();
});

test('dispose invalidates a pending camera request without loading MediaPipe', async (t) => {
  let grant;
  let stopped = 0;
  mockCamera(t, () => new Promise((resolve) => { grant = resolve; }));
  const controller = await createHandController({ video: {} });
  const pending = controller.start();
  controller.dispose();
  assert.equal(await pending, false);
  grant({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
  await settle();
  assert.equal(stopped, 1);
  assert.equal(await controller.start(), false);
});

test('starting again while an old request settles cannot revive the old session', async (t) => {
  const requests = [];
  let stopped = 0;
  mockCamera(t, () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }));
  const messages = [];
  const controller = await createHandController({ video: {}, onStatus: (text) => messages.push(text) });
  const old = controller.start();
  controller.stop();
  const active = controller.start();
  assert.notEqual(old, active);
  requests[0].resolve({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
  assert.equal(await old, false);
  await settle();
  assert.equal(stopped, 1);
  assert.equal(controller.start(), active);
  requests[1].reject(Object.assign(new Error('Camera missing'), { name: 'NotFoundError' }));
  assert.equal(await active, false);
  assert.match(messages.at(-1), /没有找到摄像头/);
  controller.dispose();
});

test('asset URLs use the deployment base with only explicit override behavior', () => {
  assert.deepEqual(resolveHandAssetUrls(), {
    wasmUrl: '/vendor/mediapipe/wasm', modelUrl: '/models/hand_landmarker.task',
  });
  assert.equal(resolveHandAssetUrls({ BASE_URL: '/gallery/' }).modelUrl, '/gallery/models/hand_landmarker.task');
  assert.equal(resolveHandAssetUrls({ BASE_URL: './' }).wasmUrl, './vendor/mediapipe/wasm');
  assert.equal(resolveHandAssetUrls({ BASE_URL: 'https://example.test/demo/' }).modelUrl,
    'https://example.test/demo/models/hand_landmarker.task');
  assert.deepEqual(resolveHandAssetUrls({ VITE_MEDIAPIPE_WASM_URL: '/custom/wasm/', VITE_MEDIAPIPE_MODEL_URL: '/custom/model.task' }), {
    wasmUrl: '/custom/wasm', modelUrl: '/custom/model.task',
  });
});

function mockGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function cameraHarness(t, createModel) {
  let activeController;
  // Test hooks run in registration order: release resources before restoring globals.
  t.after(() => activeController?.dispose());
  const phases = [];
  const statuses = [];
  const track = new EventTarget();
  track.stopCount = 0;
  track.stop = () => { track.stopCount += 1; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = Object.assign(new EventTarget(), {
    readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0, srcObject: null,
    play: () => Promise.resolve(), pause: () => {},
  });
  const window = Object.assign(new EventTarget(), { isSecureContext: true });
  const frames = new Map();
  let nextFrame = 1;
  const model = { closeCount: 0, close() { this.closeCount += 1; }, detectForVideo: () => ({ landmarks: [] }) };
  const modelOptions = [];
  const wasmPaths = [];
  mockGlobal(t, 'window', window);
  mockGlobal(t, 'requestAnimationFrame', (callback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  mockGlobal(t, 'cancelAnimationFrame', (id) => frames.delete(id));
  mockCamera(t, async () => stream);
  return {
    phases, statuses, track, video, window, model, frames, modelOptions, wasmPaths,
    async create(options = {}) {
      const controller = await createHandController({
        video,
        onLifecycle: ({ phase }) => phases.push(phase),
        onStatus: (text) => statuses.push(text),
        loadVision: async () => ({
          FilesetResolver: { forVisionTasks: async (path) => { wasmPaths.push(path); return {}; } },
          HandLandmarker: { createFromOptions: (_, options) => {
            modelOptions.push(options);
            return createModel ? createModel(options) : Promise.resolve(model);
          } },
        }),
        ...options,
      });
      activeController = controller;
      return controller;
    },
    tick(timestamp = 100) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(timestamp);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('lifecycle reports successful startup and stop; assets remain local', async (t) => {
  const harness = cameraHarness(t);
  const controller = await harness.create();
  assert.deepEqual(harness.phases, ['idle']);
  assert.equal(await controller.start(), true);
  assert.deepEqual(harness.phases, ['idle', 'requesting', 'loading', 'active']);
  assert.deepEqual(harness.wasmPaths, ['/vendor/mediapipe/wasm']);
  assert.equal(harness.modelOptions[0].baseOptions.modelAssetPath, '/models/hand_landmarker.task');
  controller.stop();
  assert.equal(harness.phases.at(-1), 'stopped');
  assert.equal(harness.track.stopCount, 1);
  assert.equal(harness.model.closeCount, 1);
  assert.equal(harness.video.srcObject, null);
  assert.equal(harness.frames.size, 0);
});

test('track-ended failure reports error and releases the active camera/model', async (t) => {
  const harness = cameraHarness(t);
  const controller = await harness.create();
  assert.equal(await controller.start(), true);
  harness.track.dispatchEvent(new Event('ended'));
  assert.equal(harness.phases.at(-1), 'error');
  assert.match(harness.statuses.at(-1), /已断开/);
  assert.equal(harness.track.stopCount, 1);
  assert.equal(harness.model.closeCount, 1);
  assert.equal(harness.video.srcObject, null);
  assert.equal(harness.frames.size, 0);
});

test('inference failure reports error instead of leaving the UI active', async (t) => {
  const harness = cameraHarness(t);
  harness.model.detectForVideo = () => { throw new Error('GPU context lost'); };
  const controller = await harness.create();
  assert.equal(await controller.start(), true);
  harness.tick();
  assert.equal(harness.phases.at(-1), 'error');
  assert.equal(harness.track.stopCount, 1);
  assert.equal(harness.frames.size, 0);
});

test('pagehide ends an active camera session and emits stopped', async (t) => {
  const harness = cameraHarness(t);
  const controller = await harness.create();
  await controller.start();
  harness.window.dispatchEvent(new Event('pagehide'));
  assert.equal(harness.phases.at(-1), 'stopped');
  assert.equal(harness.track.stopCount, 1);
  assert.equal(harness.model.closeCount, 1);
});

test('model timeout emits error and disposes a model that resolves late', async (t) => {
  let finish;
  const harness = cameraHarness(t, () => new Promise((resolve) => { finish = resolve; }));
  const controller = await harness.create({ modelTimeoutMs: 10 });
  assert.equal(await controller.start(), false);
  assert.deepEqual(harness.phases, ['idle', 'requesting', 'loading', 'error']);
  assert.match(harness.statuses.at(-1), /模型加载超时/);
  assert.equal(harness.track.stopCount, 1);
  finish(harness.model);
  await settle();
  assert.equal(harness.model.closeCount, 1);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.phases.includes('active'), false);
});

test('stop immediately cancels model startup and disposes its late result once', async (t) => {
  let finish;
  const harness = cameraHarness(t, () => new Promise((resolve) => { finish = resolve; }));
  const controller = await harness.create();
  const pending = controller.start();
  await settle();
  assert.equal(harness.phases.at(-1), 'loading');
  controller.stop();
  assert.equal(await pending, false);
  assert.equal(harness.phases.at(-1), 'stopped');
  assert.equal(harness.track.stopCount, 1);
  finish(harness.model);
  await settle();
  assert.equal(harness.model.closeCount, 1);
  assert.equal(harness.track.stopCount, 1);
  assert.equal(harness.frames.size, 0);
});

test('GPU fallback reuses the same local model path and enters active only once', async (t) => {
  let calls = 0;
  const harness = cameraHarness(t, async () => {
    if (calls++ === 0) throw new Error('GPU unavailable');
    return harness.model;
  });
  const controller = await harness.create();
  assert.equal(await controller.start(), true);
  assert.deepEqual(harness.modelOptions.map((options) => options.baseOptions.delegate), ['GPU', 'CPU']);
  assert.equal(harness.modelOptions[0].baseOptions.modelAssetPath, harness.modelOptions[1].baseOptions.modelAssetPath);
  assert.equal(harness.phases.filter((phase) => phase === 'active').length, 1);
});

test('a left-only first frame preserves the current gathered and rotated composition', async (t) => {
  const harness = cameraHarness(t);
  harness.model.detectForVideo = () => results({ label: 'Right', points: pose() });
  const states = [];
  let seedCalls = 0;
  const controller = await harness.create({
    getInitialState: () => { seedCalls += 1; return { gather: 1, rotation: 0.8, scale: 1.3 }; },
    onState: (state) => states.push(state),
  });
  assert.equal(await controller.start(), true);
  assert.equal(await controller.start(), true);
  assert.equal(seedCalls, 1);
  harness.tick();
  const state = states.at(-1);
  assert.equal(state.gather, 1);
  assert.ok(Math.abs(state.rotation - 0.8) < 0.000001);
  assert.equal(state.hasLeft, true);
  assert.equal(state.hasRight, false);
  assert.equal(state.reset, false);
  assert.ok(state.scale > 1.3);
});

test('each new startup reseeds finite clamped composition and clears detection flags', async (t) => {
  const harness = cameraHarness(t);
  const states = [];
  let seed = { gather: 1.5, rotation: Math.PI * 4 + 0.4, scale: 99, hasRight: true, hasLeft: true, reset: true, scan: 1 };
  const controller = await harness.create({ getInitialState: () => seed, onState: (state) => states.push(state) });
  await controller.start();
  assert.equal(states[0].gather, 1);
  assert.equal(states[0].scale, 1.75);
  assert.ok(Math.abs(states[0].rotation - 0.4) < 0.000001);
  assert.equal(states[0].hasRight, false);
  assert.equal(states[0].hasLeft, false);
  assert.equal(states[0].reset, false);
  assert.equal(states[0].scan, 0);
  controller.stop();
  seed = { gather: -10, rotation: NaN, scale: Infinity };
  await controller.start();
  assert.equal(states.at(-1).gather, 0);
  assert.equal(states.at(-1).rotation, 0);
  assert.equal(states.at(-1).scale, 1);
});
