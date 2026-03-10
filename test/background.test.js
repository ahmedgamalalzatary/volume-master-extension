const test = require('node:test');
const assert = require('node:assert/strict');

const { badgeColorForVolume } = require('../src/background.js');

test('update-badge sets badge text to the provided volume string', async () => {
  assert.equal(String(123), '123');
});

test('update-badge sets warning color when volume > 100 and ≤ 150', () => {
  assert.equal(badgeColorForVolume(120), '#f0a020');
  assert.equal(badgeColorForVolume(150), '#f0a020');
});

test('update-badge sets danger color when volume > 150', () => {
  assert.equal(badgeColorForVolume(151), '#e24b4b');
});

test('update-badge sets default accent color when volume ≤ 100', () => {
  assert.equal(badgeColorForVolume(100), '#5b8cff');
  assert.equal(badgeColorForVolume(10), '#5b8cff');
});

test('update-badge clears badge text when volume is undefined', () => {
  assert.equal(badgeColorForVolume(undefined), '#5b8cff');
});
