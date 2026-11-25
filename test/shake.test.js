import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CLIENT_CODE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function setupShake({ reducedMotion = false, initialConfig = undefined } = {}) {
  let intervalFn = null;
  let intervalCleared = false;
  let now = 1000;
  let screenX = 100;
  const dispatched = [];
  const formSubs = new Set();
  let formSnap = initialConfig === undefined
    ? null
    : { status: 'ready', value: initialConfig };

  const windowMock = {
    screenX,
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({
      matches: reducedMotion,
      addEventListener() {},
      removeEventListener() {},
    }),
    dispatchEvent(evt) {
      dispatched.push(evt);
    },
  };

  let loadedMod = null;
  windowMock.__ModuleLoader__ = { load(m) { loadedMod = m; } };

  const sandbox = {
    window: windowMock,
    document: { hidden: false },
    navigator: { userAgent: 'Mozilla/5.0 Electron/31.0.0' },
    Date: { now: () => now },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    setInterval(fn) {
      intervalFn = fn;
      return 1;
    },
    clearInterval() {
      intervalCleared = true;
      intervalFn = null;
    },
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  let cleanup = null;
  const ctx = {
    ...(formSnap ? {
      configForms: {
        get: () => ({
          getSnapshot: () => formSnap,
          subscribe: (fn) => { formSubs.add(fn); return () => formSubs.delete(fn); },
        }),
      },
    } : {}),
    effect(fn) {
      cleanup = fn();
      return cleanup;
    },
  };
  loadedMod.factory().apply(ctx);

  return {
    step(nextX, deltaMs = 50) {
      now += deltaMs;
      windowMock.screenX = nextX;
      intervalFn?.();
    },
    setConfig(value) {
      formSnap = { status: 'ready', value };
      for (const fn of formSubs) fn();
    },
    dispatched,
    get hasInterval() { return intervalFn !== null; },
    get intervalCleared() { return intervalCleared; },
    dispose() { cleanup?.(); },
  };
}

test('does not register sampling when prefers-reduced-motion is enabled', () => {
  const h = setupShake({ reducedMotion: true });
  assert.equal(h.hasInterval, false);
  h.dispose();
});

test('normal drag does not trigger, vigorous shaking triggers once and enforces 60s cooldown', () => {
  const h = setupShake({ reducedMotion: false });
  assert.equal(h.hasInterval, true);

  // Normal monotonic drag across 300px -> 0 reversals -> no trigger
  h.step(100);
  h.step(200);
  h.step(300);
  h.step(400);
  assert.equal(h.dispatched.length, 0);

  // Vigorous back-and-forth shake: 400 -> 460 -> 390 -> 460 -> 390 (3 reversals, > 150px)
  h.step(460, 50);
  h.step(390, 50);
  h.step(460, 50);
  h.step(390, 50);
  assert.equal(h.dispatched.length, 1);
  assert.equal(h.dispatched[0].type, 'dsh:window-shake');
  assert.equal(h.dispatched[0].detail.durationMs, 4000);

  // Immediate second shake within 60s cooldown -> ignored
  h.step(460, 200);
  h.step(390, 200);
  h.step(460, 200);
  h.step(390, 200);
  assert.equal(h.dispatched.length, 1);

  // After 60s -> triggers again
  h.step(460, 60_500);
  h.step(390, 50);
  h.step(460, 50);
  h.step(390, 50);
  assert.equal(h.dispatched.length, 2);

  h.dispose();
  assert.equal(h.intervalCleared, true);
});

test('configForms controls enabled polling state and live cooldownMs updates', () => {
  const h = setupShake({
    reducedMotion: false,
    initialConfig: { enabled: false, cooldownMs: 5000 },
  });
  assert.equal(h.hasInterval, false);

  h.setConfig({ enabled: true, cooldownMs: 5000 });
  assert.equal(h.hasInterval, true);

  h.step(200, 50);
  h.step(300, 50);
  h.step(200, 50);
  h.step(300, 50);
  h.step(200, 50);
  assert.equal(h.dispatched.length, 1);

  // Within 5s cooldown -> blocked; after 5.1s -> triggers again
  h.step(300, 2000);
  h.step(200, 50);
  h.step(300, 50);
  h.step(200, 50);
  assert.equal(h.dispatched.length, 1);

  h.step(300, 3500);
  h.step(200, 50);
  h.step(300, 50);
  h.step(200, 50);
  assert.equal(h.dispatched.length, 2);

  // Disabling stops polling
  h.setConfig({ enabled: false, cooldownMs: 5000 });
  assert.equal(h.hasInterval, false);
  h.dispose();
});

test('declares inject configForms and passes strict Cordis Proxy property access checks', () => {
  let loadedMod = null;
  const sandbox = {
    window: {
      __ModuleLoader__: { load(m) { loadedMod = m; } },
      screenX: 0,
      innerWidth: 1200,
      innerHeight: 800,
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    },
    document: { hidden: false },
    navigator: { userAgent: 'Mozilla/5.0 Electron/31.0.0' },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  const plugin = loadedMod.factory();
  assert.equal(Array.isArray(plugin.inject), true);
  assert.equal(plugin.inject.includes('configForms'), true);

  const declared = new Set(plugin.inject);
  const rawCtx = {
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { enabled: true, cooldownMs: 60_000 } }),
        subscribe: () => () => {},
      }),
    },
    effect: (fn) => fn(),
  };
  const strictCtx = new Proxy(rawCtx, {
    get(target, prop) {
      if (prop === 'effect' || prop === 'inject' || prop === 'on' || declared.has(prop)) {
        return target[prop];
      }
      throw new Error(`cannot get property "${String(prop)}" without inject`);
    },
  });

  const cleanup = plugin.apply(strictCtx);
  cleanup?.();
});
