const TYPES = new Set(["peony", "rose", "lotus", "sunflower", "tulip", "lily"]);
const clamp = (value) => Math.max(0, Math.min(1, value));

// One frame-driven state machine. No timers or queued callbacks survive a new choice.
export function createFlowerTransition({
  initialType = "peony",
  initialGather = 1,
  reducedMotion = false,
} = {}) {
  let currentType = TYPES.has(initialType) ? initialType : "peony";
  let selectedType = currentType;
  let pendingType = null;
  let gather = Number.isFinite(initialGather) ? clamp(initialGather) : 1;
  let targetGather = 1;
  let phase = "idle";
  let elapsed = 0;
  let scatterStart = gather;
  let reduced = Boolean(reducedMotion);

  const getState = () => ({
    currentType, selectedType, pendingType, phase, gather, targetGather,
    reducedMotion: reduced,
  });

  function select(type) {
    if (!TYPES.has(type) || type === selectedType) return false;
    selectedType = type;
    targetGather = 1;
    if (type === currentType) {
      pendingType = null;
      phase = "settling";
      elapsed = 0;
    } else {
      pendingType = type;
      if (phase !== "dispersing") {
        scatterStart = gather;
        elapsed = 0;
      }
      phase = "dispersing";
    }
    return true;
  }

  function setGather(value) {
    if (Number.isFinite(value)) targetGather = clamp(value);
  }

  function step(seconds) {
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 0.25)) : 0;
    let commitType = null;
    if (pendingType && (reduced || gather === 0)) {
      currentType = pendingType;
      pendingType = null;
      gather = 0;
      phase = "settling";
      commitType = currentType;
    } else if (phase === "dispersing") {
      elapsed += dt;
      const progress = Math.min(1, elapsed / 0.34);
      gather = scatterStart * (1 - progress) ** 3;
      if (progress === 1) {
        gather = 0;
        currentType = pendingType;
        pendingType = null;
        phase = "settling";
        commitType = currentType;
      }
    }
    // A commit is rendered at exactly zero; gathering starts on the following frame.
    if (reduced) {
      gather = targetGather;
      phase = "idle";
    } else if (!commitType && phase !== "dispersing") {
      gather += (targetGather - gather) * (1 - Math.exp(-dt * 5.5));
      if (Math.abs(targetGather - gather) < 0.003) {
        gather = targetGather;
        phase = "idle";
      }
    }
    return { ...getState(), commitType };
  }

  return {
    select, setGather, step, getState,
    setReducedMotion: (value) => { reduced = Boolean(value); },
  };
}
