const test = require('node:test');
const assert = require('node:assert/strict');

function loadBackground() {
  const modulePath = require.resolve('../src/background.js');
  delete require.cache[modulePath];
  return require('../src/background.js');
}

function withMockBrowser(run) {
  const original = global.browser;
  let listener;
  const textCalls = [];
  const colorCalls = [];

  global.browser = {
    runtime: { onMessage: { addListener(cb) { listener = cb; } } },
    action: {
      async setBadgeText(payload) { textCalls.push(payload); },
      async setBadgeBackgroundColor(payload) { colorCalls.push(payload); }
    },
    tabs: {
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      sendMessage: async () => ({})
    }
  };

  return Promise.resolve(run({ listenerRef: () => listener, textCalls, colorCalls, exports: loadBackground() }))
    .finally(() => {
      delete require.cache[require.resolve('../src/background.js')];
      global.browser = original;
    });
}

test('update-badge sets badge text to the provided volume string', async () => {
  await withMockBrowser(async ({ listenerRef, textCalls }) => {
    await listenerRef()({ action: 'update-badge', volume: 123 }, { tab: { id: 7 } });
    assert.deepEqual(textCalls[0], { text: '123', tabId: 7 });
  });
});

test('update-badge sets warning color when volume > 100 and ≤ 150', async () => {
  await withMockBrowser(async ({ exports }) => {
    assert.equal(exports.badgeColorForVolume(140), exports.BADGE_COLORS.warning);
  });
});

test('update-badge sets danger color when volume > 150', async () => {
  await withMockBrowser(async ({ exports }) => {
    assert.equal(exports.badgeColorForVolume(151), exports.BADGE_COLORS.danger);
  });
});

test('update-badge sets default accent color when volume ≤ 100', async () => {
  await withMockBrowser(async ({ exports }) => {
    assert.equal(exports.badgeColorForVolume(100), exports.BADGE_COLORS.accent);
  });
});

test('update-badge clears badge text when volume is undefined', async () => {
  await withMockBrowser(async ({ listenerRef, textCalls }) => {
    await listenerRef()({ action: 'update-badge' }, { tab: { id: 9 } });
    assert.deepEqual(textCalls[0], { text: '', tabId: 9 });
  });
});
