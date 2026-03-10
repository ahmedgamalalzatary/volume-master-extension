const test = require('node:test');
const assert = require('node:assert/strict');

test('content script uses webkitAudioContext fallback when AudioContext is unavailable', async () => {
  const modulePath = require.resolve('../src/content-script.js');
  const originals = {
    window: global.window,
    AudioContext: global.AudioContext,
    browser: global.browser,
    document: global.document,
    location: global.location,
    MutationObserver: global.MutationObserver,
    AbortController: global.AbortController,
    VolumeController: global.VolumeController,
    VolumeState: global.VolumeState,
    ScrollControl: global.ScrollControl
  };

  let capturedDeps = null;
  let messageListener = null;

  function FakeWebkitAudioContext() {
    this.kind = 'webkit';
  }

  global.window = { webkitAudioContext: FakeWebkitAudioContext };
  global.AudioContext = undefined;
  global.browser = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {}
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };
  global.document = {
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    documentElement: {}
  };
  global.location = { origin: 'https://example.com' };
  global.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
  };
  global.AbortController = class {
    constructor() {
      this.signal = {};
    }
    abort() {}
  };
  global.VolumeState = {};
  global.ScrollControl = { computeScrollDelta: () => 0 };
  global.VolumeController = {
    createVolumeController(deps) {
      capturedDeps = deps;
      return {
        init: async () => {},
        handleMessage: async () => undefined,
        resumeIfSuspended: async () => false,
        notifyMediaMutation() {}
      };
    }
  };

  delete require.cache[modulePath];

  try {
    require('../src/content-script.js');

    assert.equal(typeof messageListener, 'function');
    const audioContext = capturedDeps.createAudioContext();
    assert.equal(audioContext.kind, 'webkit');
  } finally {
    delete require.cache[modulePath];
    global.window = originals.window;
    global.AudioContext = originals.AudioContext;
    global.browser = originals.browser;
    global.document = originals.document;
    global.location = originals.location;
    global.MutationObserver = originals.MutationObserver;
    global.AbortController = originals.AbortController;
    global.VolumeController = originals.VolumeController;
    global.VolumeState = originals.VolumeState;
    global.ScrollControl = originals.ScrollControl;
  }
});
