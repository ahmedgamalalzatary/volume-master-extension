const test = require('node:test');
const assert = require('node:assert/strict');

const VolumeState = require('../volume-state.js');

test('builds a stable storage key from origin', () => {
  assert.equal(
    VolumeState.keyForOrigin('https://example.com'),
    'vc:origin:https://example.com'
  );
});

test('normalizes volume to an integer between 0 and 200', () => {
  assert.equal(VolumeState.normalizeVolume(150), 150);
  assert.equal(VolumeState.normalizeVolume('180'), 180);
  assert.equal(VolumeState.normalizeVolume(-1), 0);
  assert.equal(VolumeState.normalizeVolume(999), 200);
});

test('falls back to 100 for missing or invalid values', () => {
  assert.equal(VolumeState.normalizeVolume(undefined), 100);
  assert.equal(VolumeState.normalizeVolume(null), 100);
  assert.equal(VolumeState.normalizeVolume('abc'), 100);
});
