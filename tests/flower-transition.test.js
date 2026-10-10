import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowerTransition } from '../src/flower-transition.js';

const near = (value, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(value - expected) < tolerance, `${value} should be near ${expected}`);
};

function finish(transition, { frames = 240, dt = 1 / 60 } = {}) {
  const commits = [];
  const snapshots = [];
  for (let frame = 0; frame < frames; frame++) {
    const snapshot = transition.step(dt);
    snapshots.push(snapshot);
    assert.ok(Number.isFinite(snapshot.gather));
    assert.ok(snapshot.gather >= 0 && snapshot.gather <= 1);
    if (snapshot.commitType !== null) {
      commits.push(snapshot.commitType);
      near(snapshot.gather, 0);
    }
  }
  return { commits, snapshots, state: transition.getState() };
}

test('a flower switch fully scatters before one commit and regathers the selected shape', () => {
  const transition = createFlowerTransition();
  assert.equal(transition.select('rose'), true);
  let state = transition.getState();
  assert.equal(state.currentType, 'peony');
  assert.equal(state.selectedType, 'rose');
  assert.equal(state.pendingType, 'rose');
  assert.equal(state.targetGather, 1);
  const { commits, snapshots } = finish(transition);
  assert.deepEqual(commits, ['rose']);
  const commitIndex = snapshots.findIndex((snapshot) => snapshot.commitType === 'rose');
  assert.ok(commitIndex > 0, 'normal switching must spend time scattering');
  assert.ok(snapshots.slice(0, commitIndex).every((snapshot) => snapshot.currentType === 'peony'));
  state = transition.getState();
  assert.equal(state.currentType, 'rose');
  assert.equal(state.selectedType, 'rose');
  assert.equal(state.pendingType, null);
  assert.equal(state.phase, 'idle');
  near(state.gather, 1);
});

test('rapid flower requests commit only the latest request without restarting scattering', () => {
  const transition = createFlowerTransition();
  transition.select('rose');
  transition.step(0.2);
  const gatherBefore = transition.getState().gather;
  assert.ok(gatherBefore > 0 && gatherBefore < 1);
  assert.equal(transition.select('lotus'), true);
  assert.equal(transition.select('sunflower'), true);
  assert.equal(transition.select('sunflower'), false);
  const next = transition.step(0.2);
  assert.equal(next.commitType, 'sunflower', 'changing the pending shape must not restart elapsed scattering');
  near(next.gather, 0);
  assert.deepEqual(finish(transition).commits, []);
  assert.equal(transition.getState().currentType, 'sunflower');
});

test('gather intent received during a switch cannot interrupt the scatter and applies afterward', () => {
  for (const intent of [0, 0.27, 1]) {
    const transition = createFlowerTransition();
    transition.select('lily');
    transition.step(0.1);
    transition.setGather(intent);
    const { commits, state } = finish(transition);
    assert.deepEqual(commits, ['lily']);
    near(state.targetGather, intent);
    near(state.gather, intent);
    assert.equal(state.phase, 'idle');
  }
});

test('changing an already gathering flower restarts from its actual gather rather than jumping', () => {
  const transition = createFlowerTransition();
  transition.select('rose');
  const first = finish(transition, { frames: 24 });
  assert.deepEqual(first.commits, ['rose']);
  transition.step(0.05);
  const before = transition.getState().gather;
  assert.ok(before > 0 && before < 1);
  transition.select('tulip');
  near(transition.getState().gather, before);
  const { commits, state } = finish(transition);
  assert.deepEqual(commits, ['tulip']);
  assert.equal(state.currentType, 'tulip');
  near(state.gather, 1);
});

test('reselecting the current flower cancels a pending replacement and settles safely', () => {
  const transition = createFlowerTransition();
  transition.select('lotus');
  transition.step(0.15);
  const before = transition.getState().gather;
  assert.equal(transition.select('peony'), true);
  near(transition.getState().gather, before);
  assert.equal(transition.getState().pendingType, null);
  const { commits, state } = finish(transition);
  assert.deepEqual(commits, []);
  assert.equal(state.currentType, 'peony');
  assert.equal(state.selectedType, 'peony');
  assert.equal(state.phase, 'idle');
  near(state.gather, 1);
});

test('a fully scattered starting flower switches once and still honors subsequent scatter intent', () => {
  const transition = createFlowerTransition({ initialType: 'lotus', initialGather: 0 });
  assert.equal(transition.select('sunflower'), true);
  transition.setGather(0);
  const { commits, state } = finish(transition);
  assert.deepEqual(commits, ['sunflower']);
  assert.equal(state.currentType, 'sunflower');
  near(state.gather, 0);
  assert.equal(state.phase, 'idle');
});

test('reduced motion commits the latest selected flower immediately without queued commits', () => {
  const transition = createFlowerTransition({ reducedMotion: true });
  transition.select('rose');
  transition.select('lotus');
  transition.setGather(0.4);
  const next = transition.step(0);
  assert.equal(next.commitType, 'lotus');
  near(next.gather, 0.4);
  assert.equal(next.phase, 'idle');
  assert.equal(next.reducedMotion, true);
  assert.deepEqual(finish(transition).commits, []);
});

test('enabling reduced motion mid transition resolves once and keeps the final interaction intent', () => {
  const transition = createFlowerTransition();
  transition.select('lily');
  transition.step(0.1);
  transition.setGather(0.2);
  transition.setReducedMotion(true);
  const next = transition.step(0);
  assert.equal(next.commitType, 'lily');
  near(next.gather, 0.2);
  assert.equal(next.phase, 'idle');
  transition.setReducedMotion(false);
  assert.deepEqual(finish(transition).commits, []);
  transition.select('tulip');
  assert.equal(transition.step(0).commitType, null, 'animation resumes when the preference is removed');
  assert.deepEqual(finish(transition).commits, ['tulip']);
});

test('invalid and duplicate selections leave state unchanged', () => {
  const transition = createFlowerTransition();
  const initial = transition.getState();
  for (const value of ['peony', 'missing', '', null, undefined]) {
    assert.equal(transition.select(value), false);
    assert.deepEqual(transition.getState(), initial);
  }
});

test('gather inputs clamp finite numbers and ignore nonfinite input', () => {
  const transition = createFlowerTransition({ reducedMotion: true });
  for (const [input, expected] of [[-4, 0], [0.25, 0.25], [7, 1]]) {
    transition.setGather(input);
    near(transition.step(0).gather, expected);
  }
  const previous = transition.getState();
  for (const value of [NaN, Infinity, -Infinity, undefined]) {
    transition.setGather(value);
    assert.deepEqual(transition.getState(), previous);
  }
});

test('invalid dt does not move a transition and long dt is bounded', () => {
  const transition = createFlowerTransition();
  transition.select('rose');
  const before = transition.getState();
  for (const dt of [NaN, Infinity, -Infinity, -1, undefined]) {
    assert.equal(transition.step(dt).commitType, null);
    assert.deepEqual(transition.getState(), before);
  }
  const bounded = createFlowerTransition();
  bounded.select('rose');
  transition.step(40);
  bounded.step(0.25);
  assert.deepEqual(transition.getState(), bounded.getState());
});

test('snapshot consumers cannot mutate internal transition state', () => {
  const transition = createFlowerTransition();
  const state = transition.getState();
  state.currentType = 'lily';
  state.gather = -100;
  assert.equal(transition.getState().currentType, 'peony');
  near(transition.getState().gather, 1);
});
