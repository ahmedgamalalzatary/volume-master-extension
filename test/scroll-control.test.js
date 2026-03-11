const test = require('node:test');
const assert = require('node:assert/strict');

const { computeScrollDelta } = require('../src/scroll-control.js');

test('scroll up returns +5 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: -10, shiftKey: false }), 5);
});

test('scroll down returns -5 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: 10, shiftKey: false }), -5);
});

test('shift + scroll up returns +1 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: -1, shiftKey: true }), 1);
});

test('shift + scroll down returns -1 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: 1, shiftKey: true }), -1);
});

async function runIntegration(startVolume, deltaY) {
  const modulePath = require.resolve('../src/content-script.js');
  const originals = {
    window: global.window,
    browser: global.browser,
    document: global.document,
    location: global.location,
    MutationObserver: global.MutationObserver,
    AbortController: global.AbortController,
    VolumeController: global.VolumeController,
    VolumeState: global.VolumeState,
    ScrollControl: global.ScrollControl
  };

  const listeners = {};
  let volume = startVolume;

  global.window = { AudioContext: function FakeAudioContext() {} };
  global.browser = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {}
      }
    },
    runtime: {
      sendMessage: async () => {},
      onMessage: { addListener() {} }
    }
  };
  global.document = {
    querySelectorAll() { return []; },
    addEventListener(name, cb) { listeners[name] = cb; },
    documentElement: {}
  };
  global.location = { origin: 'https://example.com' };
  global.MutationObserver = class { observe() {} };
  global.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  global.ScrollControl = { computeScrollDelta };
  global.VolumeState = {
    normalizeVolume(v) {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) return 100;
      return Math.max(0, Math.min(200, n));
    }
  };
  global.VolumeController = {
    createVolumeController() {
      return {
        init: async () => {},
        resumeIfSuspended: async () => false,
        notifyMediaMutation() {},
        handleMessage: async () => undefined,
        async stepVolume(delta) {
          volume = Math.max(0, Math.min(200, volume + delta));
          return { ok: true, volume };
        }
      };
    }
  };

  delete require.cache[modulePath];
  try {
    require('../src/content-script.js');
    await new Promise(resolve => setTimeout(resolve, 0));
    const target = { closest: () => ({}) };
    await listeners.wheel({ target, deltaY, shiftKey: false, preventDefault() {} });
    return volume;
  } finally {
    delete require.cache[modulePath];
    Object.assign(global, originals);
  }
}

test('scroll up from 198 clamps final volume to 200', async () => {
  const finalVolume = await runIntegration(198, -100);
  assert.equal(finalVolume, 200);
});

test('scroll down from 2 clamps final volume to 0', async () => {
  const finalVolume = await runIntegration(2, 100);
  assert.equal(finalVolume, 0);
});
