/**
 * Browser-only hand input. Camera pixels stay in this browser; the only network
 * requests made by this module download MediaPipe code, WASM, and model assets.
 * Constructing a controller does not load the model or request camera access.
 * Call start() only from the application's explicit camera-enable button.
 *
 * Coordinates: getUserMedia video pixels are unmirrored. A CSS scaleX(-1)
 * preview does NOT mirror pixels passed to MediaPipe. MediaPipe's handedness
 * model assumes selfie/mirrored input, so we swap its labels for raw video.
 * The pure helper supports inputMirrored: true for pre-mirrored image inputs.
 * Rotation is wrist-to-middle-knuckle roll in radians, clockwise in the user's
 * mirrored preview, with an upright hand at zero. Hand identity is anatomical,
 * never inferred from which half of the screen contains the hand.
 */

/** Default assets are deployed with the app. Explicit overrides never fall back. */
export function resolveHandAssetUrls(env = {}, overrides = {}) {
  const base = String(env.BASE_URL || '/').replace(/\/?$/, '/');
  return {
    wasmUrl: String(overrides.wasmUrl || env.VITE_MEDIAPIPE_WASM_URL || `${base}vendor/mediapipe/wasm`).replace(/\/$/, ''),
    modelUrl: String(overrides.modelUrl || env.VITE_MEDIAPIPE_MODEL_URL || `${base}models/hand_landmarker.task`),
  };
}
const DEFAULT_ASSETS = resolveHandAssetUrls(import.meta.env);
const MIN_HANDEDNESS_CONFIDENCE = 0.65;
const FRAME_INTERVAL = 1000 / 24;
const FINGERS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];

export const DEFAULT_HAND_STATE = Object.freeze({
  gather: 0,
  rotation: 0,
  scale: 1,
  scan: 0,
  detected: false,
  hasRight: false,
  hasLeft: false,
  reset: false,
  gesture: '等待双手入镜',
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const isPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && (point.z === undefined || Number.isFinite(point.z));
const isHand = (points) => Array.isArray(points) && points.length >= 21 && points.slice(0, 21).every(isPoint);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/** Pure, rotation-independent pose measurements; supports 2D or 3D landmarks. */
export function measureHandGesture(landmarks, { aspectRatio = 1 } = {}) {
  if (!isHand(landmarks)) return null;
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  // x and z use image-width units; y uses image-height units.
  const points = landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect }));
  const palm = Math.max(distance(points[0], points[9]), distance(points[5], points[17]));
  if (palm < 0.00001) return null;

  let openness = 0;
  for (const [base, joint, tip] of FINGERS) {
    const a = points[base];
    const b = points[joint];
    const c = points[tip];
    const firstLength = distance(a, b);
    const secondLength = distance(b, c);
    if (firstLength < 0.000001 || secondLength < 0.000001) continue;
    const dot = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)
      + (b.z - a.z) * (c.z - b.z)) / (firstLength * secondLength);
    const straightness = clamp((dot - 0.15) / 0.72);
    const reach = clamp((distance(c, points[0]) - distance(b, points[0])) / (palm * 0.30));
    openness += straightness * reach / 4;
  }

  const pinchDistance = distance(points[4], points[8]) / palm;
  const pinch = clamp((0.58 - pinchDistance) / 0.38);
  return { openness, pinch, open: openness > 0.76, fist: openness < 0.18, palm };
}

/**
 * Interpret one MediaPipe result without DOM, camera, timing, or mutable state.
 * Missing/uncertain hands hold composition/scale/rotation and release scan.
 * Right open palm gathers; right fist releases and resets scale/rotation.
 * Left finger opening maps continuously to scale 0.65–1.75.
 * A deliberate thumb/index pinch on either hand drives scan 0–1. A fist is
 * excluded from pinch detection to avoid treating every closed hand as a pinch.
 * Handedness confidence is identity confidence, not overall detector accuracy.
 */
export function deriveHandState(result, previous = DEFAULT_HAND_STATE, {
  inputMirrored = false,
  aspectRatio = 1,
  minConfidence = MIN_HANDEDNESS_CONFIDENCE,
} = {}) {
  const state = {
    ...DEFAULT_HAND_STATE, ...previous, scan: 0, detected: false,
    hasRight: false, hasLeft: false, reset: false, gesture: '等待双手入镜',
  };
  const selected = {};
  const hands = result?.landmarks || [];
  for (let index = 0; index < hands.length; index += 1) {
    const category = result?.handedness?.[index]?.[0];
    if (!category || !Number.isFinite(category.score) || category.score < minConfidence || !isHand(hands[index])) continue;
    const label = category.categoryName || category.displayName;
    if (label !== 'Left' && label !== 'Right') continue;
    const side = inputMirrored ? label : (label === 'Left' ? 'Right' : 'Left');
    if (selected[side] && selected[side].confidence >= category.score) continue;
    const world = result?.worldLandmarks?.[index];
    const measured = isHand(world)
      ? measureHandGesture(world)
      : measureHandGesture(hands[index], { aspectRatio });
    if (measured) selected[side] = { ...measured, landmarks: hands[index], confidence: category.score };
  }

  const right = selected.Right;
  const left = selected.Left;
  state.hasRight = Boolean(right);
  state.hasLeft = Boolean(left);
  state.reset = Boolean(right?.fist);
  state.detected = Boolean(right || left);
  if (!state.detected) {
    if (hands.length) state.gesture = '识别不稳定，请将手掌正对镜头';
    return state;
  }

  const gestures = [];
  if (right) {
    if (right.fist) {
      state.gather = 0;
      state.rotation = 0;
      state.scale = 1;
      gestures.push('右手握拳 · 回归星尘');
    } else {
      if (right.open) state.gather = 1;
      const wrist = right.landmarks[0];
      const knuckle = right.landmarks[9];
      const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
      state.rotation = Math.atan2((knuckle.x - wrist.x) * aspect * (inputMirrored ? 1 : -1), wrist.y - knuckle.y);
      gestures.push(right.open ? '右手张开 · 粒子聚合' : '右手转腕 · 旋转');
    }
  }
  if (left && !right?.fist) {
    state.scale = 0.65 + left.openness * 1.10;
    gestures.push('左手开合 · 缩放');
  }
  for (const hand of [right, left]) {
    if (hand && !hand.fist && !right?.fist) state.scan = Math.max(state.scan, hand.pinch);
  }
  if (state.scan > 0.6) gestures.push('指尖捏合 · 色彩扫描');
  state.gesture = gestures.join(' / ') || '已识别手部';
  return state;
}

const abortError = () => Object.assign(new Error('Startup cancelled'), { name: 'AbortError' });

function withTimeout(promise, milliseconds, message, signal) {
  let timeout;
  let onAbort;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      // null disables the timer while retaining cancellation (native permission).
      if (milliseconds !== null) timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
    new Promise((_, reject) => {
      if (!signal) return;
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }),
  ]).finally(() => {
    clearTimeout(timeout);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function waitForVideo(video, signal) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('resize', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
    };
    const ready = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) { cleanup(); resolve(); }
    };
    const failed = () => { cleanup(); reject(new Error('摄像头画面无法播放，请关闭其他占用摄像头的应用后重试。')); };
    const cancelled = () => { cleanup(); reject(abortError()); };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('resize', ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    timeout = setTimeout(() => { cleanup(); reject(new Error('摄像头没有返回画面，请检查设备后重试。')); }, 10000);
    if (signal.aborted) cancelled();
  });
}

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return '未获得摄像头权限。请在浏览器中允许摄像头后重试；也可以继续使用鼠标演示。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '没有找到摄像头。连接设备后再试，或继续使用鼠标演示。';
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头可能正被其他应用占用。请关闭占用它的应用后重试。';
    case 'OverconstrainedError':
      return '当前摄像头不支持所需画面设置，请换一个摄像头后重试。';
    case 'SecurityError':
      return '浏览器阻止了摄像头访问。请在 HTTPS 页面或 localhost 中打开，并检查站点权限。';
    default:
      return /摄像头|手势模型/.test(error?.message || '') ? error.message : '手势模型加载失败。请检查网络后重试；鼠标演示仍然可用。';
  }
}

/**
 * @returns {Promise<{start: () => Promise<boolean>, stop: () => void, dispose: () => void}>}
 * start() resolves true when ready, false when cancelled or unavailable. Errors
 * are reported through onStatus(text), never as unhandled promise rejections.
 * Repeated start clicks share one startup; stop/dispose invalidate late work.
 * onLifecycle({ phase }) emits idle → requesting → loading → active. User stop,
 * dispose, and pagehide emit stopped; startup/track/inference failures emit error.
 */
export async function createHandController({
  video,
  onState = () => {},
  onStatus = () => {},
  onLifecycle = () => {},
  getInitialState = () => DEFAULT_HAND_STATE,
  wasmUrl = DEFAULT_ASSETS.wasmUrl,
  modelUrl = DEFAULT_ASSETS.modelUrl,
  modelTimeoutMs = 45000,
  // Dependency seam for deterministic lifecycle tests; production stays lazy.
  loadVision = () => import('@mediapipe/tasks-vision'),
}) {
  if (!video) throw new TypeError('createHandController requires a video element.');
  let current = null;
  let disposed = false;
  let state = { ...DEFAULT_HAND_STATE };
  let lastStatus = '';
  let phase = null;

  const lifecycle = (nextPhase) => {
    if (phase !== nextPhase) { phase = nextPhase; onLifecycle({ phase }); }
  };

  const status = (message) => {
    if (message !== lastStatus) { lastStatus = message; onStatus(message); }
  };
  const isCurrent = (session) => !disposed && current === session && !session.abort.signal.aborted;
  const closeModel = (model) => { try { model?.close(); } catch { /* Already closed or lost GPU context. */ } };
  const release = (session) => {
    if (!session) return;
    session.abort.abort();
    if (session.raf !== null) { cancelAnimationFrame(session.raf); session.raf = null; }
    const stream = session.stream;
    session.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
    closeModel(session.model);
    session.model = null;
  };

  function halt(nextPhase) {
    const old = current;
    current = null;
    release(old);
    state = { ...DEFAULT_HAND_STATE };
    onState({ ...state });
    lifecycle(nextPhase);
  }

  function stop() {
    halt('stopped');
    status('摄像头已关闭 · 可继续使用鼠标演示');
  }

  async function createModel(session) {
    const { FilesetResolver, HandLandmarker } = await loadVision();
    if (!isCurrent(session)) throw abortError();
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    if (!isCurrent(session)) throw abortError();
    const options = {
      baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    let model;
    try {
      model = await HandLandmarker.createFromOptions(vision, options);
    } catch (error) {
      if (!isCurrent(session)) throw abortError();
      status('正在切换兼容模式加载手势模型…');
      model = await HandLandmarker.createFromOptions(vision, {
        ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
    if (!isCurrent(session)) { closeModel(model); throw abortError(); }
    session.model = model;
    return model;
  }

  function frame(session, timestamp) {
    if (!isCurrent(session)) return;
    session.raf = requestAnimationFrame((time) => frame(session, time));
    if (typeof document !== 'undefined' && document.hidden) return;
    if (video.readyState < 2 || video.currentTime === session.lastVideoTime || timestamp - session.lastFrame < FRAME_INTERVAL) return;
    session.lastVideoTime = video.currentTime;
    session.lastFrame = timestamp;
    try {
      const result = session.model.detectForVideo(video, timestamp);
      const next = deriveHandState(result, state, { aspectRatio: video.videoWidth / video.videoHeight });
      // A short confidence hold prevents a single uncertain frame changing mode.
      if (next.detected && next.gather !== state.gather) {
        session.gatherCount = session.gatherCandidate === next.gather ? session.gatherCount + 1 : 1;
        session.gatherCandidate = next.gather;
        if (session.gatherCount < 3) next.gather = state.gather;
      } else session.gatherCount = 0;
      next.rotation = wrapAngle(state.rotation + wrapAngle(next.rotation - state.rotation) * 0.30);
      next.scale = state.scale + (next.scale - state.scale) * 0.28;
      next.scan = next.detected ? state.scan + (next.scan - state.scan) * 0.42 : 0;
      state = next;
      onState({ ...state });
      status(next.detected ? `手势已连接 · ${next.gesture}` : next.gesture === '等待双手入镜'
        ? '摄像头已开启 · 请将双手放入画面' : next.gesture);
    } catch {
      halt('error');
      status('手势识别中断，摄像头已关闭。请重新开启；鼠标演示仍然可用。');
    }
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    if (current) return current.promise;
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      lifecycle('error');
      status('摄像头需要安全连接。请使用 HTTPS 或 localhost 打开此页面。');
      return Promise.resolve(false);
    }
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      lifecycle('error');
      status('当前浏览器无法使用摄像头。请尝试新版 Chrome、Edge 或 Safari；鼠标演示仍然可用。');
      return Promise.resolve(false);
    }
    const session = {
      abort: new AbortController(), stream: null, model: null, raf: null,
      lastFrame: -Infinity, lastVideoTime: -1, gatherCount: 0, gatherCandidate: null, promise: null,
    };
    current = session;
    session.promise = (async () => {
      try {
        // Seed each new session from the current visual composition so an
        // isolated left-hand gesture cannot undo an existing gather/rotation.
        // Only composition values are accepted; detection flags are frame-local.
        const seed = getInitialState() || {};
        state = {
          ...DEFAULT_HAND_STATE,
          gather: Number.isFinite(seed.gather) ? clamp(seed.gather) : DEFAULT_HAND_STATE.gather,
          rotation: Number.isFinite(seed.rotation) ? wrapAngle(seed.rotation) : DEFAULT_HAND_STATE.rotation,
          scale: Number.isFinite(seed.scale) ? clamp(seed.scale, 0.65, 1.75) : DEFAULT_HAND_STATE.scale,
        };
        onState({ ...state });
        lifecycle('requesting');
        status('请允许摄像头访问 · 画面仅在本机处理');
        const cameraRequest = navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
          audio: false,
        }).then((stream) => {
          // A native permission prompt cannot be dismissed programmatically.
          // If it is answered after cancellation, immediately release its tracks.
          session.stream = stream;
          if (!isCurrent(session)) { release(session); throw abortError(); }
          return stream;
        });
        const stream = await withTimeout(cameraRequest, null, '', session.abort.signal);
        if (!isCurrent(session)) { release(session); return false; }
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
          if (isCurrent(session)) { halt('error'); status('摄像头已断开。请检查设备或权限后重新开启。'); }
        }, { once: true, signal: session.abort.signal }));
        lifecycle('loading');
        status('摄像头已开启 · 正在加载本地手势模型…');
        await withTimeout(Promise.resolve(video.play()), 10000, '摄像头播放超时，请检查浏览器权限后重试。', session.abort.signal);
        if (!isCurrent(session)) return false;
        await waitForVideo(video, session.abort.signal);
        await withTimeout(createModel(session), modelTimeoutMs, '手势模型加载超时，请检查网络后重试。', session.abort.signal);
        if (!isCurrent(session)) return false;
        status('摄像头已开启 · 请将双手放入画面');
        lifecycle('active');
        session.raf = requestAnimationFrame((time) => frame(session, time));
        return true;
      } catch (error) {
        const shouldReport = isCurrent(session);
        if (current === session) current = null;
        release(session);
        if (shouldReport && error?.name !== 'AbortError') {
          state = { ...DEFAULT_HAND_STATE };
          onState({ ...state });
          lifecycle('error');
          status(cameraErrorMessage(error));
        }
        return false;
      }
    })();
    return session.promise;
  }

  const pageHide = () => stop();
  globalThis.window?.addEventListener('pagehide', pageHide);
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    globalThis.window?.removeEventListener('pagehide', pageHide);
  }
  lifecycle('idle');
  return { start, stop, dispose };
}
