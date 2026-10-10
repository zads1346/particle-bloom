/**
 * Headless DOM integration tests, NOT browser or GPU/rendering QA.
 *
 * These execute the actual main.js event wiring in jsdom with real Three scene,
 * geometry, material and postprocessing-pass objects. Rendering, RAF/time, the
 * hand-controller boundary and browser-only services are mocked.
 * Computed CSS/inert assertions do not establish browser layout or native focus
 * behavior. Controller-level permission failures, cancellation and hand-state
 * derivation have separate unit coverage in hands.test.js. The deterministic
 * controller here verifies UI synchronization, not actual camera/model operation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createFlower } from '../src/flower.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [html, css, main] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'src/style.css'), 'utf8'),
  readFile(path.join(root, 'src/main.js'), 'utf8'),
]);

// Preserve imports, wrapping only the application body to support its top-level
// await in a classic jsdom script. No production code or event handler is replaced.
const mainBodyStart = main.indexOf('const $ =');
assert.ok(mainBodyStart > 0, 'main.js entry boundary must be reviewed if it changes');
const wrappedMain = `${main.slice(0, mainBodyStart)}\n` +
  `globalThis.__appReady = (async () => {\n${main.slice(mainBodyStart)}\n})();`;
const threeModule = path.join(root, 'node_modules/three/build/three.module.js');
const bundle = await build({
  stdin: { contents: wrappedMain, resolveDir: path.join(root, 'src'), sourcefile: 'main.js' },
  bundle: true,
  format: 'iife',
  write: false,
  logLevel: 'silent',
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'headless-ui-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'ui-mock' }));
      builder.onResolve({ filter: /^three\/addons\/postprocessing\/EffectComposer\.js$/ },
        () => ({ path: 'composer', namespace: 'ui-mock' }));
      builder.onResolve({ filter: /^\.\/hands\.js$/ },
        () => ({ path: 'hands', namespace: 'ui-mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'ui-mock' }, ({ path: name }) => {
        if (name === 'three') return {
          contents: `
            export * from ${JSON.stringify(threeModule)};
            export class WebGLRenderer {
              constructor(options) { this.domElement = options.canvas; this.disposals = 0; window.__renderer = this; }
              setClearColor(color, alpha) { this.clearColor = color; this.clearAlpha = alpha; }
              setPixelRatio(ratio) { this.pixelRatio = ratio; }
              getPixelRatio() { return this.pixelRatio; }
              setSize(width, height) { this.width = width; this.height = height; }
              dispose() { this.disposals++; }
            }
          `,
          resolveDir: root,
        };
        if (name === 'composer') return {
          contents: `
            export class EffectComposer {
              constructor(renderer) { this.renderer = renderer; this.passes = []; this.frames = 0; this.disposals = 0; window.__composer = this; }
              addPass(pass) { this.passes.push(pass); }
              setPixelRatio(ratio) { this.pixelRatio = ratio; }
              setSize(width, height) { this.width = width; this.height = height; }
              render() { this.frames++; }
              dispose() { this.disposals++; }
            }
          `,
        };
        return {
          contents: `
            export async function createHandController(options) {
              const empty = { detected: false, hasRight: false, hasLeft: false, reset: false, scan: 0 };
              let pending = null;
              const emitPhase = (phase) => options.onLifecycle({ phase });
              const hand = {
                starts: 0, stops: 0, disposals: 0, initialStates: [],
                getInitialState: options.getInitialState,
                emit: options.onState,
                phase: emitPhase,
                status: options.onStatus,
                start() {
                  this.starts++;
                  this.initialStates.push(options.getInitialState());
                  options.onState({ ...empty });
                  emitPhase('requesting');
                  options.onStatus('等待摄像头授权');
                  return new Promise((resolve, reject) => { pending = { resolve, reject }; });
                },
                load() { if (pending) { emitPhase('loading'); options.onStatus('加载模型'); } },
                complete() {
                  if (!pending) return false;
                  const { resolve } = pending; pending = null;
                  emitPhase('active'); options.onStatus('手势已就绪'); resolve(true); return true;
                },
                fail(message = '模型加载失败') {
                  if (!pending) return;
                  const { resolve } = pending; pending = null;
                  options.onState({ ...empty }); emitPhase('error'); options.onStatus(message); resolve(false);
                },
                reject(message) {
                  const reject = pending?.reject; pending = null; reject?.(new Error(message));
                },
                stop() {
                  this.stops++;
                  const resolve = pending?.resolve; pending = null;
                  options.onState({ ...empty }); emitPhase('stopped');
                  options.onStatus('摄像头已关闭 · 可继续使用鼠标演示'); resolve?.(false);
                },
                dispose() { if (!this.disposals) { this.disposals++; this.stop(); } },
              };
              window.__hand = hand;
              emitPhase('idle');
              return hand;
            }
          `,
        };
      });
    },
  }],
});
const appScript = bundle.outputFiles[0].text;

async function createApp(t, { width = 1440, height = 900, dpr = 2, reduced = true } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://particle-bloom.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  Object.defineProperties(window, {
    innerWidth: { value: width, configurable: true },
    innerHeight: { value: height, configurable: true },
    devicePixelRatio: { value: dpr, configurable: true },
  });
  Object.defineProperties(document.getElementById('app'), {
    clientWidth: { value: width },
    clientHeight: { value: height },
  });
  const mediaQuery = new window.EventTarget();
  mediaQuery.matches = reduced;
  window.matchMedia = () => mediaQuery;
  window.ResizeObserver = class {
    constructor() { this.disconnections = 0; window.__resizeObserver = this; }
    observe() {}
    disconnect() { this.disconnections++; }
  };
  let now = 0;
  let nextRaf = 0;
  const rafs = new Map();
  window.performance.now = () => now;
  window.requestAnimationFrame = (callback) => { rafs.set(++nextRaf, callback); return nextRaf; };
  window.cancelAnimationFrame = (id) => rafs.delete(id);
  const canvas = document.getElementById('scene');
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.releasePointerCapture = (id) => captured.delete(id);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  window.eval(appScript);
  await window.__appReady;
  const $ = (id) => document.getElementById(id);
  const scene = window.__composer.passes[0].scene;
  const flower = scene.children.find((child) => child.isGroup);
  return {
    window, document, $, canvas, flower,
    get points() { return flower.children.find((child) => child.isPoints && child.material.isShaderMaterial); },
    get hand() { return window.__hand; },
    get debug() { return window.__bloom; },
    get uniforms() { return this.points.material.uniforms; },
    state: () => window.__bloom.getState(),
    targets: () => window.__hand.getInitialState(),
    key(key, code = key) {
      const event = new window.KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event;
    },
    pointer(type, id, x, y) {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: id, clientX: x, clientY: y });
      canvas.dispatchEvent(event);
    },
    change(id, value) {
      $(id).value = value;
      $(id).dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    reduceMotion(matches) {
      mediaQuery.matches = matches;
      const event = new window.Event('change');
      Object.assign(event, { matches });
      mediaQuery.dispatchEvent(event);
    },
    step(frames = 1, delta = 1000 / 60) {
      for (let i = 0; i < frames; i++) {
        now += delta;
        const callbacks = [...rafs.values()];
        rafs.clear();
        callbacks.forEach((callback) => callback(now));
      }
    },
  };
}

function approx(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be approximately ${expected}`);
}

function sameArrayValues(actual, expected, message) {
  // Typed arrays created inside jsdom have another realm's prototype; compare
  // their bytes to test geometry, without mistaking the realm for a data change.
  assert.deepEqual(
    Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
    Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    message,
  );
}

function cameraUi(app, { active = false, pending = false, background = active, mode = '自由演示' } = {}) {
  assert.equal(app.state().cameraActive, active);
  assert.equal(app.$('camera-button').getAttribute('aria-pressed'), String(active));
  assert.equal(app.$('camera-button').getAttribute('aria-busy'), String(pending));
  assert.equal(app.$('camera-button').querySelector('span').textContent,
    pending ? '取消开启' : active ? '关闭摄像头' : '开启手势交互');
  assert.equal(app.document.body.classList.contains('camera-on'), background);
  assert.equal(app.$('mode-label').textContent, mode);
}

async function activateCamera(app) {
  const start = app.$('camera-button').onclick();
  app.hand.load();
  assert.equal(app.hand.complete(), true);
  await start;
}

test('jsdom / mocked renderer: boot uses real geometry and advances controlled animation', async (t) => {
  const app = await createApp(t);
  assert.equal(app.debug.ready, false);
  assert.equal(app.points.geometry.attributes.position.count, 100000);
  assert.equal(app.$('particle-count').textContent, '100,000 LIVING PARTICLES');
  assert.equal(app.window.__renderer.clearAlpha, 0);
  assert.equal(app.window.__composer.passes.length, 3);
  app.step();
  assert.equal(app.debug.ready, true);
  assert.equal(app.state().frame, 1);
  assert.equal(app.window.__composer.frames, 1);
  assert.equal(app.debug.errors.length, 0);
  cameraUi(app);
});

test('jsdom / mocked renderer: Bloom and Scatter reset automatic mode and accessible control states', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.$('auto').click();
  assert.equal(app.state().auto, true);
  assert.equal(app.$('mode-label').textContent, '自动流转');
  assert.equal(app.$('bloom').getAttribute('aria-pressed'), 'false');
  assert.equal(app.$('scatter').getAttribute('aria-pressed'), 'false');
  app.$('bloom').click();
  assert.equal(app.state().auto, false);
  assert.equal(app.state().targetGather, 1);
  assert.equal(app.$('mode-label').textContent, '自由演示');
  assert.equal(app.$('auto').getAttribute('aria-pressed'), 'false');
  assert.equal(app.$('auto').classList.contains('selected'), false);
  app.$('auto').click();
  app.$('scatter').click();
  assert.equal(app.state().targetGather, 0);
  assert.equal(app.$('scatter').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('bloom').getAttribute('aria-pressed'), 'false');
  assert.equal(app.$('mode-label').textContent, '自由演示');
  await activateCamera(app);
  app.$('auto').click();
  app.$('bloom').click();
  assert.equal(app.$('mode-label').textContent, '手势交互');
});

test('jsdom / mocked renderer: Escape closes settings with the settings button focused', async (t) => {
  const app = await createApp(t);
  app.$('settings-toggle').click();
  app.$('settings-toggle').focus();
  assert.equal(app.$('settings').hidden, false);
  assert.equal(app.$('settings-toggle').getAttribute('aria-expanded'), 'true');
  app.key('Escape');
  assert.equal(app.$('settings').hidden, true);
  assert.equal(app.$('settings-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.$('settings-toggle'));
  app.key(' ', 'Space');
  assert.equal(app.state().targetGather, 1, 'keyboard shortcuts must not hijack focused buttons');
  app.canvas.focus();
  assert.equal(app.key(' ', 'Space').defaultPrevented, true);
  assert.equal(app.state().targetGather, 0);
});

test('jsdom / mocked renderer: H clean mode marks UI inert, applies hidden CSS, and restores it', async (t) => {
  const app = await createApp(t);
  app.$('settings-toggle').click();
  app.canvas.focus();
  app.key('h');
  assert.equal(app.document.body.classList.contains('clean'), true);
  assert.equal(app.$('settings').hidden, true);
  assert.equal(app.$('settings-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.canvas);
  const hiddenUi = app.document.querySelectorAll('header,.intro,.art-label,.status-card,.gesture-guide,footer,.settings');
  for (const element of hiddenUi) {
    assert.equal(element.inert, true);
    assert.equal(app.window.getComputedStyle(element).visibility, 'hidden');
    assert.equal(app.window.getComputedStyle(element).pointerEvents, 'none');
  }
  app.key('h');
  assert.equal(app.document.body.classList.contains('clean'), false);
  for (const element of hiddenUi) assert.equal(element.inert, false);
  assert.equal(app.window.getComputedStyle(app.$('camera-button')).visibility, 'visible');
});

for (const pendingPhase of ['requesting', 'loading']) {
  test(`jsdom / mocked renderer: camera ${pendingPhase} can be cancelled without stale activation`, async (t) => {
    const app = await createApp(t);
    const start = app.$('camera-button').onclick();
    if (pendingPhase === 'loading') app.hand.load();
    cameraUi(app, { pending: true });
    await app.$('camera-button').onclick();
    await start;
    assert.equal(app.hand.starts, 1);
    assert.equal(app.hand.stops, 1);
    cameraUi(app);
    assert.equal(app.hand.complete(), false, 'cancelled mocked model completion is ignored');
    cameraUi(app);
    await activateCamera(app);
    assert.equal(app.hand.starts, 2);
    cameraUi(app, { active: true, mode: '手势交互' });
    await app.$('camera-button').onclick();
    cameraUi(app);
  });
}

test('jsdom / mocked renderer: camera model failure and unexpected rejection leave restartable UI', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.$('auto').click();
  let start = app.$('camera-button').onclick();
  app.hand.load();
  app.hand.fail('模型加载失败，请重试');
  await start;
  cameraUi(app, { mode: '自动流转' });
  assert.equal(app.$('status').textContent, '模型加载失败，请重试');
  start = app.$('camera-button').onclick();
  app.hand.reject('测试中的意外启动错误');
  await start;
  cameraUi(app, { mode: '自动流转' });
  assert.equal(app.$('status').textContent, '测试中的意外启动错误');
  await activateCamera(app);
  cameraUi(app, { active: true, mode: '自动流转' });
  assert.equal(app.state().auto, true);
  app.hand.emit({ detected: true, hasRight: true, hasLeft: false, gather: 1, rotation: 0, scan: 0 });
  cameraUi(app, { active: true, mode: '手势交互' });
  assert.equal(app.state().auto, false);
});

test('jsdom / mocked renderer: active camera background, runtime error, and pagehide stay synchronized', async (t) => {
  const app = await createApp(t);
  await activateCamera(app);
  app.$('camera-background').checked = false;
  app.$('camera-background').dispatchEvent(new app.window.Event('change'));
  cameraUi(app, { active: true, background: false, mode: '手势交互' });
  app.$('camera-background').checked = true;
  app.$('camera-background').dispatchEvent(new app.window.Event('change'));
  cameraUi(app, { active: true, mode: '手势交互' });
  app.hand.phase('error');
  app.hand.status('摄像头已断开');
  cameraUi(app);
  assert.equal(app.$('status').textContent, '摄像头已断开');
  await activateCamera(app);
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  cameraUi(app);
  assert.equal(app.hand.stops, 1);
});

test('jsdom / mocked renderer: left-only hand scales without replacing gather or rotation', async (t) => {
  const app = await createApp(t);
  app.$('scatter').click();
  const seed = app.targets();
  await activateCamera(app);
  assert.equal(app.hand.initialStates[0].gather, 0);
  assert.equal(app.hand.initialStates[0].rotation, seed.rotation);
  app.hand.emit({ detected: true, hasRight: false, hasLeft: true, gather: 1, rotation: 2, scale: 1.4, scan: 0 });
  assert.equal(app.targets().gather, 0);
  assert.equal(app.targets().rotation, seed.rotation);
  assert.equal(app.targets().scale, 1.4);
  assert.equal(app.$('scatter').getAttribute('aria-pressed'), 'true');
  app.hand.emit({ detected: true, hasRight: true, hasLeft: false, gather: 1, rotation: 0.7, scale: 0.6, scan: 0 });
  assert.equal(app.targets().gather, 1);
  assert.equal(app.targets().rotation, 0.7);
  assert.equal(app.targets().scale, 1.4, 'a right hand without reset cannot overwrite scale');
  app.hand.emit({ detected: true, hasRight: false, hasLeft: true, gather: 0, rotation: -2, scale: 1.2, scan: 0 });
  assert.equal(app.targets().gather, 1);
  assert.equal(app.targets().rotation, 0.7);
  assert.equal(app.targets().scale, 1.2);
});

test('jsdom / mocked renderer: missing hands and stop release scan without resetting composition', async (t) => {
  const app = await createApp(t);
  await activateCamera(app);
  app.hand.emit({ detected: true, hasRight: true, hasLeft: false, gather: 0, rotation: 0.4, scale: 1, scan: 1 });
  app.step(60);
  assert.ok(app.uniforms.uScan.value > 0.9);
  app.hand.emit({ detected: false, hasRight: false, hasLeft: false, gather: 1, rotation: 0, scale: 1, scan: 0 });
  app.step(90);
  assert.ok(app.uniforms.uScan.value < 0.02);
  assert.equal(app.targets().gather, 0);
  assert.equal(app.targets().rotation, 0.4);
  app.hand.emit({ detected: true, hasRight: true, hasLeft: false, gather: 0, rotation: 0.4, scan: 1 });
  app.step(60);
  await app.$('camera-button').onclick();
  app.step(90);
  assert.ok(app.uniforms.uScan.value < 0.02);
  cameraUi(app);
});

test('jsdom / mocked renderer: manual quality updates count, GPU-facing DPR and disposes old geometry', async (t) => {
  const app = await createApp(t, { dpr: 3 });
  let oldDisposed = false;
  app.points.geometry.addEventListener('dispose', () => { oldDisposed = true; });
  for (const [tier, count, dpr] of [['medium', 60000, 1.5], ['low', 28000, 1], ['high', 100000, 2]]) {
    app.change('quality', tier);
    assert.equal(app.state().count, count);
    assert.equal(app.debug.quality.tier, tier);
    assert.equal(app.debug.quality.pixelRatio, dpr);
    assert.equal(app.window.__renderer.pixelRatio, dpr);
    assert.equal(app.window.__composer.pixelRatio, dpr);
    assert.equal(app.uniforms.uPixelRatio.value, dpr);
    assert.equal(app.$('particle-count').textContent, `${count.toLocaleString('en-US')} LIVING PARTICLES`);
    const points = app.flower.children.filter((child) => child.isPoints && child.material.isShaderMaterial);
    assert.equal(points.length, 1);
    assert.equal(points[0].geometry.attributes.position.count, count);
  }
  assert.equal(oldDisposed, true);
});

test('jsdom / mocked renderer: sustained slow frames reduce automatic quality but preserve manual choice', async (t) => {
  const app = await createApp(t, { dpr: 2 });
  app.step(250, 50);
  assert.equal(app.debug.quality.tier, 'medium');
  assert.equal(app.state().count, 60000);
  assert.equal(app.$('quality').value, 'auto');
  assert.equal(app.window.__renderer.pixelRatio, 1.5);
  app.change('quality', 'high');
  app.step(500, 50);
  assert.equal(app.debug.quality.tier, 'high');
  assert.equal(app.state().count, 100000);
  assert.equal(app.window.__renderer.pixelRatio, 2);
});

test('jsdom / mocked renderer: mobile automatic quality begins at 60,000 particles and capped DPR', async (t) => {
  const app = await createApp(t, { width: 390, height: 844, dpr: 3 });
  assert.equal(app.state().count, 60000);
  assert.equal(app.debug.quality.tier, 'medium');
  assert.equal(app.debug.quality.pixelRatio, 1.25);
  assert.equal(app.window.__renderer.width, 390);
  assert.equal(app.window.__composer.height, 844);
  app.change('quality', 'low');
  assert.equal(app.state().count, 28000);
  assert.equal(app.debug.quality.pixelRatio, 1);
});

for (const releaseEvent of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`jsdom / mocked renderer: ${releaseEvent} exits pinch, resumes remaining drag, and clears it`, async (t) => {
    const app = await createApp(t);
    app.pointer('pointerdown', 1, 0, 0);
    app.pointer('pointerdown', 2, 100, 0);
    app.pointer('pointermove', 2, 120, 0);
    approx(app.targets().scale, 1.2);
    app.pointer(releaseEvent, 2, 120, 0);
    app.pointer('pointermove', 1, 10, 20);
    app.step(100);
    assert.ok(app.flower.rotation.x > -0.04 && app.flower.rotation.x < -0.02);
    assert.ok(app.flower.rotation.y > -0.25 && app.flower.rotation.y < -0.23,
      'remaining pointer resumes from its own coordinates without a rotation jump');
    approx(app.targets().scale, 1.2);
    app.pointer(releaseEvent, 1, 10, 20);
    app.step(100);
    const before = { x: app.flower.rotation.x, y: app.flower.rotation.y };
    app.pointer('pointermove', 1, 1000, 1000);
    app.step(100);
    approx(app.flower.rotation.x, before.x, 0.00002);
    approx(app.flower.rotation.y, before.y, 0.00002);
    approx(app.targets().scale, 1.2);
  });
}

test('jsdom / mocked renderer: context loss stops camera and shows recoverable error UI', async (t) => {
  const app = await createApp(t);
  await activateCamera(app);
  const lost = new app.window.Event('webglcontextlost', { cancelable: true });
  app.canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(app.$('error').hidden, false);
  assert.match(app.$('error').textContent, /图形资源已中断/);
  cameraUi(app);
  app.canvas.dispatchEvent(new app.window.Event('webglcontextrestored'));
  assert.equal(app.$('error').hidden, true);
  assert.equal(app.$('status').textContent, '画面已恢复，可以继续探索');
});

test('jsdom / mocked renderer: right fist restores dragged view axes and releases scan', async (t) => {
  const app=await createApp(t);
  app.pointer('pointerdown',1,0,0);app.pointer('pointermove',1,140,100);app.pointer('pointerup',1,140,100);app.step(100);
  assert.ok(app.flower.rotation.x > .4);
  await activateCamera(app);
  app.hand.emit({detected:true,hasRight:true,hasLeft:false,reset:true,gather:0,rotation:0,scale:1,scan:0});app.step(240);
  approx(app.flower.rotation.x,-.15,.0001);approx(app.flower.rotation.y,-.3,.0001);
  assert.equal(app.targets().gather,0);assert.equal(app.targets().scale,1);assert.equal(app.targets().rotation,0);
});

test('jsdom / mocked renderer: Escape returns focus from a hidden settings control to its toggle', async (t) => {
 const app=await createApp(t);app.$('settings-toggle').click();app.$('quality').focus();
 assert.equal(app.document.activeElement,app.$('quality'));app.key('Escape');
 assert.equal(app.$('settings').hidden,true);assert.equal(app.document.activeElement,app.$('settings-toggle'));
 assert.equal(app.$('settings-toggle').getAttribute('aria-expanded'),'false');
});
test('jsdom / mocked renderer: clean mode never leaves focus on invisible controls', async (t) => {
 const app=await createApp(t);app.$('bloom').focus();app.key('h');
 assert.equal(app.document.body.classList.contains('clean'),true);assert.equal(app.document.activeElement,app.canvas);
 assert.equal(app.$('bloom').closest('footer').inert,true);app.key('h');
 assert.equal(app.document.body.classList.contains('clean'),false);assert.equal(app.document.activeElement,app.canvas);
 app.$('settings-toggle').click();app.$('quality').focus();app.key('h');
 assert.equal(app.document.body.classList.contains('clean'),false,'H must not hijack a focused select');
 assert.equal(app.$('settings').hidden,false);assert.equal(app.document.activeElement,app.$('quality'));
});

test('jsdom / mocked renderer: six Chinese flower choices expose descriptions without starting camera', async (t) => {
  const app = await createApp(t, { width: 390, height: 844 });
  const selector = app.$('flower-type');
  assert.ok(selector instanceof app.window.HTMLSelectElement);
  assert.deepEqual([...selector.options].map(({ value }) => value),
    ['peony', 'rose', 'lotus', 'sunflower', 'tulip', 'lily']);
  assert.deepEqual([...selector.options].map(({ textContent }) => textContent.trim()),
    ['牡丹', '玫瑰', '莲花', '向日葵', '郁金香', '百合']);
  assert.equal(selector.getAttribute('aria-describedby'), 'flower-description');
  assert.ok(app.$('flower-description').textContent.trim().length > 0);
  assert.equal(selector.disabled, false);
  assert.equal(app.state().flowerType, 'peony');
  selector.focus();
  app.key(' ', 'Space');
  assert.equal(app.state().targetGather, 1, 'canvas shortcut must not hijack the native flower selector');
  for (const id of ['rose', 'lotus', 'sunflower', 'tulip', 'lily', 'peony']) {
    app.change('flower-type', id);
    app.step();
    assert.equal(app.state().flowerType, id);
    assert.equal(app.state().selectedFlower, id);
    assert.equal(app.$('flower-type').value, id);
    assert.equal(app.state().transitionPhase, 'idle');
    assert.ok(app.$('flower-description').textContent.trim().length > 0);
  }
  assert.equal(app.hand.starts, 0, 'selecting or demonstrating flowers cannot request a camera');
});

test('jsdom / mocked renderer: rapid flower changes commit the latest choice after full scatter', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  const originalGeometry = app.points.geometry;
  let originalDisposals = 0;
  originalGeometry.addEventListener('dispose', () => originalDisposals++);
  app.change('flower-type', 'rose');
  assert.equal(app.state().flowerType, 'peony');
  assert.equal(app.state().selectedFlower, 'rose');
  assert.equal(app.state().pendingFlower, 'rose');
  assert.equal(app.state().transitionPhase, 'dispersing');
  assert.equal(app.$('flower-type').value, 'rose');
  assert.equal(app.$('flower-type').disabled, false);
  app.step(6);
  assert.equal(app.points.geometry, originalGeometry);
  assert.ok(app.state().gather > 0 && app.state().gather < 1);
  app.change('flower-type', 'lotus');
  app.change('flower-type', 'lily');
  let previousGeometry = originalGeometry;
  const committedSpecies = [];
  for (let frame = 0; frame < 100; frame++) {
    app.step();
    if (app.points.geometry !== previousGeometry) {
      committedSpecies.push(app.state().flowerType);
      assert.equal(app.state().gather, 0, 'GPU target buffers may swap only at the fully scattered cloud');
      previousGeometry = app.points.geometry;
    }
  }
  assert.deepEqual(committedSpecies, ['lily']);
  assert.equal(originalDisposals, 1);
  assert.equal(app.state().pendingFlower, null);
  assert.equal(app.state().transitionPhase, 'idle');
  assert.equal(app.state().flowerType, 'lily');
  assert.equal(app.$('flower-type').value, 'lily');
  assert.equal(app.flower.children.filter((child) => child.isPoints && child.material.isShaderMaterial).length, 1);
  assert.equal(app.hand.starts, 0);
});

test('jsdom / mocked renderer: gestures during switching preserve the swap and latest gather/rotation/scale', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  await activateCamera(app);
  app.change('flower-type', 'sunflower');
  app.step(6);
  app.hand.emit({ detected: true, hasRight: true, hasLeft: true, gather: 0.25, rotation: 0.6, scale: 1.3, scan: 0.2 });
  assert.equal(app.state().targetGather, 0.25);
  assert.equal(app.targets().rotation, 0.6);
  assert.equal(app.targets().scale, 1.3);
  app.step(140);
  assert.equal(app.state().flowerType, 'sunflower');
  assert.equal(app.state().transitionPhase, 'idle');
  approx(app.state().gather, 0.25, 0.00001);
  approx(app.flower.scale.x, 1.3, 0.001);
  approx(app.flower.rotation.z, 0.6, 0.001);
  assert.equal(app.state().auto, false);
  assert.equal(app.$('mode-label').textContent, '手势交互');
});

test('jsdom / mocked renderer: manual and automatic quality rebuilds preserve the active switching state', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  app.change('flower-type', 'lotus');
  app.step(6);
  const before = app.state();
  const oldGeometry = app.points.geometry;
  let oldDisposals = 0;
  oldGeometry.addEventListener('dispose', () => oldDisposals++);
  app.change('quality', 'low');
  assert.equal(oldDisposals, 1);
  assert.equal(app.state().count, 28000);
  assert.equal(app.state().flowerType, 'peony');
  assert.equal(app.state().pendingFlower, 'lotus');
  assert.equal(app.state().transitionPhase, 'dispersing');
  approx(app.state().gather, before.gather);
  sameArrayValues(app.points.geometry.attributes.position.array,
    createFlower(28000, 194, 'peony').position,
    'a quality rebuild must not reveal the pending flower before the cloud scatters');
  app.step(100);
  assert.equal(app.state().flowerType, 'lotus');
  assert.equal(app.points.geometry.attributes.position.count, 28000);
  sameArrayValues(app.points.geometry.attributes.position.array, createFlower(28000, 194, 'lotus').position);
  app.change('quality', 'auto');
  app.change('flower-type', 'tulip');
  app.step(250, 50);
  assert.equal(app.state().flowerType, 'tulip');
  assert.equal(app.debug.quality.tier, 'medium');
  assert.equal(app.points.geometry.attributes.position.count, 60000);
  sameArrayValues(app.points.geometry.attributes.position.array, createFlower(60000, 194, 'tulip').position);
});

test('jsdom / mocked renderer: a changed reduced-motion preference resolves pending flowers immediately', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  app.change('flower-type', 'rose');
  app.step(6);
  app.$('scatter').click();
  app.reduceMotion(true);
  app.step();
  assert.equal(app.state().flowerType, 'rose');
  assert.equal(app.state().pendingFlower, null);
  assert.equal(app.state().transitionPhase, 'idle');
  assert.equal(app.state().gather, 0);
  assert.equal(app.uniforms.uMotion.value, 0);
  app.reduceMotion(false);
  assert.equal(app.uniforms.uMotion.value, 1);
  app.change('flower-type', 'lily');
  app.step(100);
  assert.equal(app.state().flowerType, 'lily');
  assert.equal(app.state().gather, 1);
  assert.equal(app.state().transitionPhase, 'idle');
});

test('jsdom / mocked renderer: repeated selection and quality changes keep one shader points object and release geometry once', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  const material = app.points.material;
  const disposals = new Map();
  const observeGeometry = () => {
    const geometry = app.points.geometry;
    if (disposals.has(geometry)) return;
    disposals.set(geometry, 0);
    geometry.addEventListener('dispose', () => disposals.set(geometry, disposals.get(geometry) + 1));
  };
  observeGeometry();
  const flowers = ['rose', 'lotus', 'sunflower', 'tulip', 'lily', 'peony'];
  const qualities = ['low', 'medium', 'high'];
  for (let index = 0; index < 18; index++) {
    app.change('flower-type', flowers[index % flowers.length]);
    app.change('quality', qualities[index % qualities.length]);
    observeGeometry();
    app.step(8);
    observeGeometry();
    const points = app.flower.children.filter((child) => child.isPoints && child.material.isShaderMaterial);
    assert.equal(points.length, 1);
    assert.equal(points[0].material, material, 'switching must reuse the existing shader material');
  }
  app.change('flower-type', 'lily');
  app.step(100);
  observeGeometry();
  const live = app.points.geometry;
  for (const [geometry, count] of disposals) {
    assert.equal(count, geometry === live ? 0 : 1, 'every replaced geometry is disposed exactly once');
  }
  assert.equal(app.state().flowerType, 'lily');
  assert.equal(app.state().transitionPhase, 'idle');
  assert.equal(app.debug.errors.length, 0);
});

test('jsdom / mocked renderer: reduced motion suppresses automatic demonstration while keeping deliberate controls', async (t) => {
  const app = await createApp(t);
  assert.equal(app.$('auto').disabled, true);
  app.$('auto').click();
  assert.equal(app.state().auto, false);
  app.$('scatter').click();
  app.step();
  assert.equal(app.state().gather, 0);
  app.$('bloom').click();
  app.step();
  assert.equal(app.state().gather, 1);
  app.reduceMotion(false);
  assert.equal(app.$('auto').disabled, false);
  app.$('auto').click();
  assert.equal(app.state().auto, true);
  app.reduceMotion(true);
  assert.equal(app.state().auto, false);
  assert.equal(app.$('auto').getAttribute('aria-pressed'), 'false');
  assert.equal(app.uniforms.uMotion.value, 0);
});

test('jsdom / mocked renderer: permanent pagehide stops RAF and disposes each shared scene resource exactly once', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  app.change('flower-type', 'rose');
  app.step(6);
  const scene = app.window.__composer.passes[0].scene;
  const disposalCounts = new Map();
  scene.traverse((object) => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])]) {
      if (!resource || disposalCounts.has(resource)) continue;
      disposalCounts.set(resource, 0);
      resource.addEventListener('dispose', () => disposalCounts.set(resource, disposalCounts.get(resource) + 1));
    }
  });
  const frames = app.state().frame;
  const renders = app.window.__composer.frames;
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  assert.equal(app.state().disposed, true);
  assert.equal(app.debug.ready, false);
  assert.equal(app.window.__renderer.disposals, 1);
  assert.equal(app.window.__composer.disposals, 1);
  assert.equal(app.window.__resizeObserver.disconnections, 1);
  assert.equal(app.hand.disposals, 1);
  assert.ok(disposalCounts.size > 5);
  for (const count of disposalCounts.values()) assert.equal(count, 1);
  app.step(100);
  assert.equal(app.state().frame, frames);
  assert.equal(app.window.__composer.frames, renders);
  app.reduceMotion(true);
  assert.equal(app.state().reducedMotion, false, 'the detached media listener cannot mutate an exited scene');
  const liveGeometry = app.points.geometry;
  assert.equal(app.debug.selectFlower('lily'), false);
  assert.equal(app.points.geometry, liveGeometry, 'an exited scene cannot allocate another flower');
});

test('jsdom / mocked renderer: persisted pagehide keeps the scene usable for browser back/forward restore', async (t) => {
  const app = await createApp(t);
  app.step();
  const event = new app.window.Event('pagehide');
  Object.assign(event, { persisted: true });
  app.window.dispatchEvent(event);
  assert.equal(app.state().disposed, false);
  assert.equal(app.window.__renderer.disposals, 0);
  assert.equal(app.window.__composer.disposals, 0);
  assert.equal(app.hand.disposals, 0);
  app.step();
  assert.equal(app.state().frame, 2);
  app.change('flower-type', 'lily');
  app.step();
  assert.equal(app.state().flowerType, 'lily');
});

test('jsdom / mocked renderer: context loss pauses rendering, switching and adaptive quality until recovery', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  await activateCamera(app);
  app.change('flower-type', 'rose');
  app.step(6);
  const before = app.state();
  const renderCount = app.window.__composer.frames;
  const geometry = app.points.geometry;
  const lost = new app.window.Event('webglcontextlost', { cancelable: true });
  app.canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(app.debug.ready, false);
  assert.equal(app.state().contextLost, true);
  assert.equal(app.state().cameraActive, false);
  assert.equal(app.$('error').hidden, false);
  app.step(300, 50);
  assert.equal(app.state().frame, before.frame);
  assert.equal(app.window.__composer.frames, renderCount);
  assert.equal(app.debug.ready, false);
  assert.equal(app.debug.quality.tier, 'high', 'lost-context time must not cause a false automatic downgrade');
  assert.equal(app.state().flowerType, 'peony');
  assert.equal(app.state().pendingFlower, 'rose');
  approx(app.state().gather, before.gather);
  assert.equal(app.points.geometry, geometry);
  app.change('flower-type', 'lily');
  assert.equal(app.state().pendingFlower, 'lily');
  app.canvas.dispatchEvent(new app.window.Event('webglcontextrestored'));
  assert.equal(app.state().contextLost, false);
  assert.equal(app.debug.ready, false, 'recovery becomes ready only after an actual render step');
  assert.equal(app.$('error').hidden, true);
  app.step();
  assert.equal(app.debug.ready, true);
  assert.equal(app.state().frame, before.frame + 1);
  assert.equal(app.window.__composer.frames, renderCount + 1);
  assert.ok(app.state().gather > 0, 'the lost interval cannot jump the transition straight to commit');
  app.step(100);
  assert.equal(app.state().flowerType, 'lily');
  assert.equal(app.state().transitionPhase, 'idle');
  assert.equal(app.debug.quality.tier, 'high');
  assert.equal(app.state().cameraActive, false, 'recovery cannot restart camera permission or capture');
  assert.equal(app.hand.starts, 1);
});

test('jsdom / mocked renderer: canonical framing stays fixed through orbit, deliberate transforms, flower and quality changes', async (t) => {
  const app = await createApp(t, { reduced: false });
  app.step(120);
  const camera = app.window.__composer.passes[0].camera;
  const framing = { z: camera.position.z, x: app.flower.position.x, y: app.flower.position.y };
  app.step(100);
  approx(camera.position.z, framing.z);
  approx(app.flower.position.x, framing.x);
  approx(app.flower.position.y, framing.y);
  app.pointer('pointerdown', 1, 0, 0);
  app.pointer('pointermove', 1, 100, 70);
  app.pointer('pointerdown', 2, 200, 70);
  app.pointer('pointermove', 2, 230, 70);
  app.pointer('pointerup', 2, 230, 70);
  app.pointer('pointerup', 1, 100, 70);
  app.step(150);
  const scale = app.targets().scale;
  const rotation = app.flower.rotation.clone();
  assert.ok(scale > 1);
  assert.ok(rotation.x > 0.2 && rotation.y > 0.1);
  app.change('quality', 'low');
  approx(app.flower.scale.x, scale, 0.001);
  approx(app.flower.rotation.x, rotation.x);
  approx(app.flower.rotation.y, rotation.y);
  approx(camera.position.z, framing.z);
  approx(app.flower.position.x, framing.x);
  approx(app.flower.position.y, framing.y);
  for (const id of ['rose', 'lotus', 'sunflower', 'tulip', 'lily']) {
    app.change('flower-type', id);
    app.step(100);
    assert.equal(app.state().flowerType, id);
    approx(camera.position.z, framing.z);
    approx(app.flower.position.x, framing.x);
    approx(app.flower.position.y, framing.y);
    approx(app.flower.scale.x, scale, 0.001);
    approx(app.flower.rotation.x, rotation.x, 0.001);
    app.change('quality', 'medium');
    approx(camera.position.z, framing.z);
    approx(app.flower.position.x, framing.x);
    approx(app.flower.position.y, framing.y);
  }
});
