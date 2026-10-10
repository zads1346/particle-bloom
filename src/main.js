import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createFlower, seededRandom, FLOWER_TYPES, DEFAULT_FLOWER_TYPE } from "./flower.js";
import { createFlowerTransition } from "./flower-transition.js";
import { createCrystal } from "./crystal.js";
import { preserveBloomAlpha } from "./alpha-bloom.js";
import {
  getFramingForBounds,
  getQualitySettings,
  createAdaptiveQualityState,
  updateAdaptiveQuality,
  shortestAngleLerp,
} from "./render-utils.js";
import { vertexShader, fragmentShader } from "./shaders.js";
import { createHandController } from "./hands.js";
const $ = (id) => document.getElementById(id);
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reduced = motionPreference.matches;
const params = new URLSearchParams(location.search),
  mobile = innerWidth < 650;
const initialFlower = FLOWER_TYPES.some(({ id }) => id === params.get("flower"))
  ? params.get("flower") : DEFAULT_FLOWER_TYPE;
const transition = createFlowerTransition({
  initialType: initialFlower, initialGather: reduced ? 1 : 0.12, reducedMotion: reduced,
});
const flowerMetadata = (type) => FLOWER_TYPES.find(({ id }) => id === type) || FLOWER_TYPES[0];
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: $("scene"),
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
  });
} catch (e) {
  $("error").hidden = false;
  throw e;
}
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(39, innerWidth / innerHeight, 0.1, 80);
camera.position.set(0, 0.15, 9.5);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.48,
  0.45,
  0.5,
);
preserveBloomAlpha(bloomPass);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const flower = new THREE.Group();
scene.add(flower);
flower.rotation.set(-0.15, -0.3, -0.13);
let count, points, geometry, fitBounds = null;
const uniforms = {
  uTime: { value: 0 },
  uGather: { value: reduced ? 1 : 0.12 },
  uPixelRatio: { value: renderer.getPixelRatio() },
  uPointScale: { value: 1.55 },
  uScan: { value: 0 },
  uMotion: { value: reduced ? 0 : 1 },
};
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
  vertexColors: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
let qualityTier = "high",
  adaptiveQuality = createAdaptiveQualityState("high");
function rebuildFlower() {
  const data = createFlower(count, 194, transition.getState().currentType);
  const previous = geometry;
  if (points) flower.remove(points);
  geometry = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries({
    position: data.position, aScatter: data.scatter, color: data.color, aData: data.data,
  })) geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
  points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  flower.add(points);
  previous?.dispose();
}
function setQuality(value) {
  if (disposed) return;
  const settings = getQualitySettings(value, {
    width: innerWidth,
    devicePixelRatio,
  });
  qualityTier = settings.tier;
  count = settings.count;
  renderer.setPixelRatio(settings.pixelRatio);
  composer.setPixelRatio(settings.pixelRatio);
  uniforms.uPixelRatio.value = settings.pixelRatio;
  rebuildFlower();
  $("particle-count").textContent =
    `${count.toLocaleString("en-US")} LIVING PARTICLES`;
  window.__bloom.count = count;
  window.__bloom.quality = {
    tier: qualityTier,
    pixelRatio: settings.pixelRatio,
  };
}
const glass = createCrystal();
flower.add(glass);
const random = seededRandom(381),
  dustPositions = [],
  dustColors = [];
for (let i = 0; i < 900; i++) {
  dustPositions.push(
    (random() - 0.5) * 18,
    (random() - 0.5) * 12,
    (random() - 0.5) * 10 - 2,
  );
  const c = random();
  dustColors.push(0.3 + c * 0.25, 0.4 + c * 0.25, 0.45 + c * 0.3);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(dustPositions, 3),
);
dustGeo.setAttribute("color", new THREE.Float32BufferAttribute(dustColors, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    size: 0.012,
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
scene.add(dust);
// Two airy, discontinuous filaments create a fine orbit around the specimen.
const trailPositions = [],
  trailColors = [];
for (let i = 0; i < 6500; i++) {
  const t = (i / 6500) * Math.PI * 7,
    r = 2.48 + Math.sin(t * 1.3) * 0.11,
    n = (random() - 0.5) * 0.035;
  trailPositions.push(
    Math.cos(t) * r + n,
    Math.sin(t) * r * 0.78 + n,
    Math.sin(t * 1.5) * 0.7 - 0.25,
  );
  trailColors.push(0.33, 0.51, 0.49);
}
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(trailPositions, 3),
);
trailGeo.setAttribute(
  "color",
  new THREE.Float32BufferAttribute(trailColors, 3),
);
const trails = new THREE.Points(
  trailGeo,
  new THREE.PointsMaterial({
    size: 0.0065,
    vertexColors: true,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
flower.add(trails);
let targetGather = 1,
  auto = false,
  targetScale = 1,
  targetX = -0.15,
  targetY = -0.3,
  targetZ = -0.13,
  dragging = false,
  lastX = 0,
  lastY = 0,
  scanTarget = 0,
  cameraActive = false,
  time = 0,
  last = performance.now(),
  fpsFrames = 0,
  fpsStart = last,
  autoQuality = true,
  frame = 0,
  animationFrame = 0,
  contextLost = false,
  disposed = false;
window.__bloom = {
  ready: false,
  count: 0,
  errors: [],
  getState: () => ({
    gather: uniforms.uGather.value,
    targetGather,
    auto,
    scale: flower.scale.x,
    cameraActive,
    count,
    frame,
    flowerType: transition.getState().currentType,
    selectedFlower: transition.getState().selectedType,
    pendingFlower: transition.getState().pendingType,
    transitionPhase: transition.getState().phase,
    reducedMotion: reduced,
    disposed,
    contextLost,
  }),
  setGather: (v) => setGather(v),
  selectFlower: (type) => selectFlower(type),
  setReducedMotion: (value) => applyMotionPreference(value),
};
setQuality("auto");
adaptiveQuality = createAdaptiveQualityState(qualityTier);
for (const { id, label } of FLOWER_TYPES) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = label;
  $("flower-type").append(option);
}
$("flower-type").value = initialFlower;
$("flower-type").onchange = (event) => selectFlower(event.target.value);
$("auto").disabled = reduced;
$("auto").title = reduced ? "系统已开启减弱动态效果，可手动绽放或星散" : "连续聚散演示";
syncFlowerLabels();
function syncFlowerLabels() {
  const state = transition.getState(),
    active = flowerMetadata(state.currentType),
    selected = flowerMetadata(state.selectedType),
    index = FLOWER_TYPES.findIndex(({ id }) => id === state.currentType) + 1;
  $("flower-type").value = state.selectedType;
  $("flower-description").textContent = selected.description;
  $("flower-title").textContent = `光之${active.label}`;
  $("study-number").textContent = String(index).padStart(3, "0");
  $("specimen-number").textContent = String(index).padStart(2, "0");
  $("flower-picker").setAttribute("aria-busy", String(state.phase !== "idle"));
}
function applyTransitionStep(dt) {
  const state = transition.step(dt);
  if (state.commitType) {
    rebuildFlower();
    syncFlowerLabels();
    if (!cameraActive) $("status").textContent = `${flowerMetadata(state.currentType).label}已切换，拖动探索花瓣与花心`;
  }
  uniforms.uGather.value = state.gather;
  if (state.phase === "idle") $("flower-picker").setAttribute("aria-busy", "false");
  return state;
}
function selectFlower(type) {
  if (disposed) return false;
  if (!transition.select(type)) return false;
  targetGather = 1;
  auto = false;
  $("auto").classList.remove("selected");
  $("auto").setAttribute("aria-pressed", "false");
  for (const id of ["bloom", "scatter"]) {
    $(id).classList.toggle("selected", id === "bloom");
    $(id).setAttribute("aria-pressed", String(id === "bloom"));
  }
  syncModeLabel();
  syncFlowerLabels();
  $("status").textContent = reduced
    ? `已选择${flowerMetadata(type).label}` : `星尘散开，正在聚合成${flowerMetadata(type).label}`;
  applyTransitionStep(0);
  return true;
}
function applyMotionPreference(value) {
  if (disposed) return;
  reduced = Boolean(value);
  transition.setReducedMotion(reduced);
  uniforms.uMotion.value = reduced ? 0 : 1;
  $("auto").disabled = reduced;
  $("auto").title = reduced ? "系统已开启减弱动态效果，可手动绽放或星散" : "连续聚散演示";
  if (reduced) {
    auto = false;
    $("auto").classList.remove("selected");
    $("auto").setAttribute("aria-pressed", "false");
    transition.setGather(targetGather);
    applyTransitionStep(0);
  }
  syncModeLabel();
}
const onMotionPreference = (event) => applyMotionPreference(event.matches);
motionPreference.addEventListener?.("change", onMotionPreference);
function syncModeLabel() {
  $("mode-label").textContent=auto?"自动流转":cameraActive?"手势交互":"自由演示";
}
function closeSettings({restoreFocus=true}={}) {
 const focusWasInside=$("settings").contains(document.activeElement);
 $("settings").hidden=true;
 $("settings-toggle").setAttribute("aria-expanded","false");
 if(restoreFocus && focusWasInside && !document.body.classList.contains("clean"))$("settings-toggle").focus();
}
function toggleClean() {
  const clean = document.body.classList.toggle("clean");
  for (const element of document.querySelectorAll(
    "header,.intro,.art-label,.status-card,.gesture-guide,footer,.settings,.flower-picker",
  ))
    element.inert = clean;
  if (clean) {
    closeSettings({restoreFocus:false});
    $("scene").focus();
  }
}
function setGather(value) {
  if (disposed || !Number.isFinite(value)) return;
  targetGather = THREE.MathUtils.clamp(value, 0, 1);
  transition.setGather(targetGather);
  if (reduced) applyTransitionStep(0);
  auto = false;
  syncModeLabel();
  $("auto").classList.remove("selected");
  $("auto").setAttribute("aria-pressed", "false");
  for (const [id, v] of [
    ["bloom", 1],
    ["scatter", 0],
  ]) {
    $(id).classList.toggle("selected", value === v);
    $(id).setAttribute("aria-pressed", String(value === v));
  }
  if (!cameraActive)
    $("status").textContent = value
      ? "拖动旋转，探索每一片光的纹理"
      : "星尘未曾远去，轻触「绽放」再次相聚";
}
$("bloom").onclick = () => setGather(1);
$("scatter").onclick = () => setGather(0);
$("auto").onclick = () => {
  if (reduced) return;
  auto = !auto;
  $("auto").classList.toggle("selected", auto);
  $("auto").setAttribute("aria-pressed", String(auto));
  syncModeLabel();
  if(auto)for(const id of ["bloom","scatter"]){$(id).classList.remove("selected");$(id).setAttribute("aria-pressed","false");}
};
function reset() {
  targetScale = 1;
  targetX = -0.15;
  targetY = -0.3;
  targetZ = -0.13;
  scanTarget = 0;
  setGather(1);
}
$("reset").onclick = reset;
$("settings-toggle").onclick = () => {
 if(!$("settings").hidden){closeSettings();return;}
 $("settings").hidden=false;
 $("settings-toggle").setAttribute("aria-expanded","true");
};
$("quality").onchange = (e) => {
  autoQuality = e.target.value === "auto";
  setQuality(e.target.value);
  adaptiveQuality = createAdaptiveQualityState(qualityTier);
};
$("cube").onchange = (e) => (glass.visible = e.target.checked);
$("camera-background").onchange = (e) =>
  document.body.classList.toggle("camera-on", cameraActive && e.target.checked);
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $("status").textContent = "此浏览器不支持全屏；仍可正常交互";
  }
};
const canvas = $("scene"),
  pointers = new Map();
let pinchDistance = 0;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()],
      d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0)
      targetScale = THREE.MathUtils.clamp(
        (targetScale * d) / pinchDistance,
        0.55,
        1.65,
      );
    pinchDistance = d;
  } else if (dragging) {
    targetY += (e.clientX - lastX) * 0.006;
    targetX += (e.clientY - lastY) * 0.006;
  }
  lastX = e.clientX;
  lastY = e.clientY;
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(event, (e) => {
    pointers.delete(e.pointerId);
    dragging = pointers.size > 0;
    pinchDistance = 0;
    if (pointers.size) {
      const p = [...pointers.values()][0];
      lastX = p.x;
      lastY = p.y;
    }
  });
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    targetScale = THREE.MathUtils.clamp(
      targetScale * Math.exp(-e.deltaY * 0.001),
      0.55,
      1.65,
    );
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSettings();
    return;
  }
  if(["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName)||document.activeElement.isContentEditable)return;
  if(e.key === "h"){e.preventDefault();toggleClean();return;}
  if(document.activeElement.tagName === "BUTTON")return;
  if (e.code === "Space") {
    e.preventDefault();
    setGather(targetGather > 0.5 ? 0 : 1);
  }
  if (e.key === "r") reset();
});
let cameraPhase = "idle";
function setCameraPhase({ phase }) {
  cameraPhase = phase;
  cameraActive = phase === "active";
  const pending = phase === "requesting" || phase === "loading";
  $("camera-button").querySelector("span").textContent = pending
    ? "取消开启"
    : cameraActive
      ? "关闭摄像头"
      : "开启手势交互";
  $("camera-button").setAttribute("aria-pressed", String(cameraActive));
  $("camera-button").setAttribute("aria-busy", String(pending));
  document.body.classList.toggle(
    "camera-on",
    cameraActive && $("camera-background").checked,
  );
  syncModeLabel();
}
const hand = await createHandController({
  video: $("camera"),
  onLifecycle: setCameraPhase,
  getInitialState: () => ({
    gather: targetGather,
    rotation: targetZ,
    scale: targetScale,
  }),
  onStatus: (message) => {
    $("status").textContent = message;
  },
  onState: (state) => {
    if (Number.isFinite(state.scan)) scanTarget = state.scan;
    if (!state.detected) return;
    if(state.reset){targetX=-.15;targetY=-.3;scanTarget=0;}
    auto = false;
    syncModeLabel();
    $("auto").classList.remove("selected");
    $("auto").setAttribute("aria-pressed", "false");
    if (state.hasRight && Number.isFinite(state.gather)) {
      targetGather = THREE.MathUtils.clamp(state.gather, 0, 1);
      transition.setGather(targetGather);
      for (const [id, v] of [
        ["bloom", 1],
        ["scatter", 0],
      ]) {
        $(id).classList.toggle("selected", targetGather === v);
        $(id).setAttribute("aria-pressed", String(targetGather === v));
      }
    }
    if (state.hasRight && Number.isFinite(state.rotation))
      targetZ = state.rotation;
    if ((state.hasLeft || state.reset) && Number.isFinite(state.scale))
      targetScale = state.scale;
  },
});
$("camera-button").onclick = async () => {
  if (["requesting", "loading", "active"].includes(cameraPhase)) {
    hand.stop();
    return;
  }
  try {
    await hand.start();
  } catch (e) {
    setCameraPhase({ phase: "error" });
    $("status").textContent = e.message || "摄像头暂不可用，可继续鼠标交互";
  }
};
function updateFramingBounds() {
  // All six specimens fit inside the case; the full orbit reaches radius 2.62.
  // A common authored envelope keeps framing invariant during a switch, a
  // quality rebuild, and the orbit's animation. User zoom/rotation stay independent.
  const bounds = new THREE.Box3(
    new THREE.Vector3(-2.65, -2.65, -1.65), new THREE.Vector3(2.65, 2.65, 1.65),
  ).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.15, -0.3, -0.13)));
  fitBounds = {
    minX: bounds.min.x - 0.1, maxX: bounds.max.x + 0.1,
    minY: bounds.min.y - 0.1, maxY: bounds.max.y + 0.1,
    minZ: bounds.min.z, maxZ: bounds.max.z,
  };
}
updateFramingBounds();
function resize() {
  if (disposed) return;
  const width = Math.max(1, $("app").clientWidth),
    height = Math.max(1, $("app").clientHeight);
  renderer.setSize(width, height);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const framing = getFramingForBounds(width, height, fitBounds);
  camera.position.z = framing.cameraZ;
  flower.position.set(
    framing.positionX,
    framing.positionY + camera.position.y,
    0,
  );
}
resize();
window.addEventListener("resize", resize);
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe($("app"));
function animate(now) {
  if (disposed) return;
  animationFrame = requestAnimationFrame(animate);
  if (document.hidden || contextLost) {
    last = now;
    fpsFrames = 0;
    fpsStart = now;
    return;
  }
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;
  frame++;
  if (auto) targetGather = (Math.sin(time * 0.24) + 1) / 2;
  const k = 1 - Math.exp(-dt * 3);
  transition.setGather(targetGather);
  applyTransitionStep(dt);
  uniforms.uTime.value = params.has("still") ? 8 : time;
  uniforms.uScan.value += (scanTarget - uniforms.uScan.value) * k;
  flower.scale.setScalar(THREE.MathUtils.lerp(flower.scale.x, targetScale, k));
  flower.rotation.x = THREE.MathUtils.lerp(flower.rotation.x, targetX, k);
  flower.rotation.y = THREE.MathUtils.lerp(
    flower.rotation.y,
    targetY + (!dragging && !reduced ? Math.sin(time * 0.17) * 0.13 : 0),
    k,
  );
  flower.rotation.z = shortestAngleLerp(flower.rotation.z, targetZ, k);
  dust.rotation.z = reduced ? 0 : time * 0.007;
  trails.rotation.z = reduced ? 0 : time * 0.035;
  trails.material.opacity = 0.13 + (1 - uniforms.uGather.value) * 0.12;
  composer.render();
  fpsFrames++;
  if (now - fpsStart > 4000) {
    const fps = (fpsFrames / (now - fpsStart)) * 1000;
    window.__bloom.fps = Math.round(fps);
    if (autoQuality && frame > 100) {
      const next = updateAdaptiveQuality(adaptiveQuality, {
        fps,
        elapsedMs: now - fpsStart,
        active: !document.hidden,
      });
      if (next.tier !== qualityTier) {
        setQuality(next.tier);
        resize();
      }
      adaptiveQuality = next;
    }
    fpsStart = now;
    fpsFrames = 0;
  }
  window.__bloom.ready = true;
}
animationFrame = requestAnimationFrame(animate);
window.addEventListener("pagehide", (event) => {
  if (event.persisted) { hand.stop(); return; }
  if (disposed) return;
  hand.dispose();
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.removeEventListener("resize", resize);
  resizeObserver.disconnect?.();
  motionPreference.removeEventListener?.("change", onMotionPreference);
  const geometries = new Set(), materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const value of [].concat(object.material || [])) materials.add(value);
  });
  for (const value of geometries) value.dispose();
  for (const value of materials) value.dispose();
  for (const pass of composer.passes) pass.dispose?.();
  composer.dispose();
  renderer.dispose();
  window.__bloom.ready = false;
});
window.addEventListener("error", (e) => window.__bloom.errors.push(e.message));

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
  window.__bloom.ready = false;
  fpsFrames = 0;
  hand.stop();
  $("error").hidden = false;
  $("error").querySelector("h2").textContent = "画面暂时休息了一下";
  $("error").querySelector("p").textContent =
    "图形资源已中断，正在等待浏览器恢复。若持续未恢复，请刷新页面。";
});
canvas.addEventListener("webglcontextrestored", () => {
  if (disposed) return;
  contextLost = false;
  last = performance.now();
  fpsStart = last;
  fpsFrames = 0;
  $("error").hidden = true;
  $("status").textContent = "画面已恢复，可以继续探索";
});
