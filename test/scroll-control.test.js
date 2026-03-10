const test = require('node:test');
const assert = require('node:assert/strict');

const { computeScrollDelta } = require('../src/scroll-control.js');
const { createVolumeController } = require('../src/volume-controller.js');

function controllerAt(volume) {
  const media = [{ volume: 1 }];
  const controller = createVolumeController({
    volumeState: {
      keyForOrigin(value) { return `vc:origin:${value}`; },
      normalizeVolume(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 100;
        return Math.max(0, Math.min(200, parsed));
      }
    },
    origin: 'https://example.com',
    getMediaElements() { return media; },
    storage: {
      async get() { return {}; },
      async set() {},
      async remove() {}
    },
    createAudioContext() {
      return {
        destination: {},
        state: 'running',
        createGain() { return { gain: { value: 1 }, connect() {} }; },
        createMediaElementSource() { return { connect() {} }; }
      };
    }
  });
  return controller.init().then(() => controller.setVolume(volume).then(() => controller));
}

test('scroll up returns +5 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: -1, shiftKey: false }), 5);
});

test('scroll down returns -5 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: 1, shiftKey: false }), -5);
});

test('shift + scroll up returns +1 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: -1, shiftKey: true }), 1);
});

test('shift + scroll down returns -1 delta', () => {
  assert.equal(computeScrollDelta({ deltaY: 1, shiftKey: true }), -1);
});

test('scroll up from 198 clamps final volume to 200', async () => {
  const controller = await controllerAt(198);
  const delta = computeScrollDelta({ deltaY: -1, shiftKey: false });
  await controller.stepVolume(delta);
  assert.equal(controller.getVolume().volume, 200);
});

test('scroll down from 2 clamps final volume to 0', async () => {
  const controller = await controllerAt(2);
  const delta = computeScrollDelta({ deltaY: 1, shiftKey: false });
  await controller.stepVolume(delta);
  assert.equal(controller.getVolume().volume, 0);
});
