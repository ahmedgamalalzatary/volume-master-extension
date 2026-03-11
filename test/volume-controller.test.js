const test = require('node:test');
const assert = require('node:assert/strict');

const { createVolumeController } = require('../src/volume-controller.js');

function createStorage(initialValue, options = {}) {
  const store = new Map(Object.entries(initialValue || {}));
  const writes = [];
  const removedKeys = [];
  let getCount = 0;

  return {
    writes,
    removedKeys,
    getCount() {
      return getCount;
    },
    async get(key) {
      getCount += 1;
      if (options.failGet) throw new Error('get failed');
      return { [key]: store.get(key) };
    },
    async set(payload) {
      if (options.failSet) throw new Error('set failed');
      writes.push(payload);
      for (const [key, value] of Object.entries(payload)) {
        store.set(key, value);
      }
    },
    async remove(key) {
      if (options.failRemove) throw new Error('remove failed');
      removedKeys.push(key);
      store.delete(key);
    }
  };
}

function createMedia(overrides = {}) {
  return {
    src: '',
    currentSrc: '',
    crossOrigin: null,
    volume: 0.25,
    ...overrides
  };
}

function createAudioHarness({ initialState = 'running' } = {}) {
  const sourceCalls = [];
  const resumeCalls = [];
  let contextCount = 0;
  let currentState = initialState;

  return {
    sourceCalls,
    resumeCalls,
    get contextCount() {
      return contextCount;
    },
    createAudioContext() {
      contextCount += 1;
      const destination = { id: 'destination' };
      return {
        destination,
        get state() {
          return currentState;
        },
        set state(value) {
          currentState = value;
        },
        createGain() {
          return {
            gain: { value: 1 },
            connect(target) {
              this.connectedTarget = target;
            }
          };
        },
        createMediaElementSource(element) {
          sourceCalls.push(element);
          return {
            connect(target) {
              this.connectedTarget = target;
            }
          };
        },
        async resume() {
          resumeCalls.push('resume');
          if (currentState === 'suspended' || currentState === 'interrupted') {
            currentState = 'running';
          }
        }
      };
    }
  };
}

function createController({
  media = [],
  origin = 'https://example.com',
  persistedVolume,
  storageOptions,
  audioOptions,
  autoRunScheduled = false
} = {}) {
  const storageKey = `vc:origin:${origin}`;
  const storage = createStorage(
    typeof persistedVolume === 'undefined' ? {} : { [storageKey]: persistedVolume },
    storageOptions
  );
  const audio = createAudioHarness(audioOptions);
  const scheduledTasks = [];
  let nextTimerId = 1;
  const controller = createVolumeController({
    volumeState: {
      keyForOrigin(value) {
        return `vc:origin:${value}`;
      },
      normalizeVolume(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 100;
        return Math.max(0, Math.min(200, parsed));
      }
    },
    origin,
    getMediaElements() {
      return media;
    },
    storage,
    createAudioContext: () => audio.createAudioContext(),
    scheduleTask(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      const task = { id, callback, delay, cleared: false };
      scheduledTasks.push(task);
      if (autoRunScheduled) {
        Promise.resolve().then(() => callback());
      }
      return id;
    },
    cancelTask(id) {
      const task = scheduledTasks.find(item => item.id === id);
      if (task) task.cleared = true;
    }
  });

  return { controller, storage, audio, scheduledTasks, storageKey };
}

test('init loads persisted origin volume and applies native volume', async () => {
  const media = [createMedia(), createMedia({ volume: 0.9 })];
  const { controller, audio } = createController({ media, persistedVolume: 35 });

  await controller.init();

  assert.equal(controller.getVolume().volume, 35);
  assert.equal(media[0].volume, 0.35);
  assert.equal(media[1].volume, 0.35);
  assert.equal(audio.contextCount, 0);
});

test('init falls back to 100 when persisted volume is invalid', async () => {
  const media = [createMedia({ volume: 0.9 })];
  const { controller } = createController({ media, persistedVolume: 'nope' });

  await controller.init();

  assert.equal(controller.getVolume().volume, 100);
  assert.equal(media[0].volume, 1);
});

test('setVolume above 100 creates gain path and forces native volume to 1.0', async () => {
  const media = [createMedia({ currentSrc: 'https://example.com/song.mp3' })];
  const { controller, audio } = createController({ media });

  await controller.init();
  const result = await controller.setVolume(150);

  assert.deepEqual(result, { ok: true, volume: 150 });
  assert.equal(audio.contextCount, 1);
  assert.equal(audio.sourceCalls.length, 1);
  assert.equal(media[0].volume, 1);
});

test('suspended context fallback keeps media at native max and defers wiring until resume', async () => {
  const media = [createMedia({ currentSrc: 'https://example.com/song.mp3' })];
  const { controller, audio } = createController({
    media,
    audioOptions: { initialState: 'interrupted' }
  });

  await controller.init();
  await controller.setVolume(180);

  assert.equal(media[0].volume, 1);
  assert.equal(audio.sourceCalls.length, 0);
});

test('resumeIfSuspended re-applies boost after a suspended context resumes', async () => {
  const media = [createMedia({ currentSrc: 'https://example.com/song.mp3' })];
  const { controller, audio } = createController({
    media,
    audioOptions: { initialState: 'suspended' }
  });

  await controller.init();
  await controller.setVolume(180);

  assert.equal(audio.sourceCalls.length, 0);

  await controller.resumeIfSuspended();

  assert.equal(audio.resumeCalls.length, 1);
  assert.equal(audio.sourceCalls.length, 1);
  assert.equal(media[0].volume, 1);
});

test('resumeIfSuspended also resumes interrupted contexts', async () => {
  const media = [createMedia({ currentSrc: 'https://example.com/song.mp3' })];
  const { controller, audio } = createController({
    media,
    audioOptions: { initialState: 'interrupted' }
  });

  await controller.init();
  await controller.setVolume(180);
  await controller.resumeIfSuspended();

  assert.equal(audio.resumeCalls.length, 1);
  assert.equal(audio.sourceCalls.length, 1);
  assert.equal(media[0].volume, 1);
});

test('unsafe cross-origin media is skipped while safe media is wired once', async () => {
  const safeMedia = createMedia({ currentSrc: 'https://example.com/local.mp3' });
  const unsafeMedia = createMedia({ currentSrc: 'https://cdn.example.net/remote.mp3' });
  const corsMedia = createMedia({
    currentSrc: 'https://cdn.example.net/cors.mp3',
    crossOrigin: 'anonymous'
  });
  const { controller, audio } = createController({ media: [safeMedia, unsafeMedia, corsMedia] });

  await controller.init();
  await controller.setVolume(150);
  await controller.handleMediaChange();

  assert.equal(audio.sourceCalls.length, 2);
  assert.deepEqual(audio.sourceCalls, [safeMedia, corsMedia]);
  assert.equal(safeMedia.volume, 1);
  assert.equal(unsafeMedia.volume, 1);
  assert.equal(corsMedia.volume, 1);
});

test('blob and data media sources are treated as safe for boost wiring', async () => {
  const blobMedia = createMedia({ currentSrc: 'blob:https://example.com/1234' });
  const dataMedia = createMedia({ currentSrc: 'data:audio/mp3;base64,AAAA' });
  const { controller, audio } = createController({ media: [blobMedia, dataMedia] });

  await controller.init();
  await controller.setVolume(150);

  assert.deepEqual(audio.sourceCalls, [blobMedia, dataMedia]);
});

test('already wired media is not rewired on repeated reapply calls', async () => {
  const media = [createMedia({ currentSrc: 'https://example.com/song.mp3' })];
  const { controller, audio } = createController({ media });

  await controller.init();
  await controller.setVolume(150);
  await controller.handleMediaChange();
  await controller.handleMediaChange();

  assert.equal(audio.sourceCalls.length, 1);
});

test('getVolume reports current volume and media presence', async () => {
  const { controller } = createController({ media: [] });

  await controller.init();

  assert.deepEqual(controller.getVolume(), { volume: 100, hasMedia: false, mediaCount: 0, isMuted: false, preMuteVolume: 100, isLocked: false });
});

test('handleMessage routes get-volume and set-volume messages', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media });

  await controller.init();

  const getResponse = await controller.handleMessage({ action: 'get-volume' });
  const setResponse = await controller.handleMessage({ action: 'set-volume', volume: 45 });

  assert.deepEqual(getResponse, { volume: 100, hasMedia: true, mediaCount: 1, isMuted: false, preMuteVolume: 100, isLocked: false });
  assert.deepEqual(setResponse, { ok: true, volume: 45 });
  assert.equal(media[0].volume, 0.45);
});

test('handleMessage returns undefined for unknown actions', async () => {
  const { controller } = createController();

  await controller.init();

  assert.equal(await controller.handleMessage({ action: 'noop' }), undefined);
});

test('controller validates required dependencies up front', () => {
  assert.throws(
    () => createVolumeController({}),
    /volumeState/
  );
});

test('storage write failures do not break in-memory volume updates', async () => {
  const media = [createMedia()];
  const { controller } = createController({
    media,
    storageOptions: { failSet: true }
  });

  await controller.init();
  const result = await controller.setVolume(40);

  assert.deepEqual(result, { ok: true, volume: 40 });
  assert.equal(controller.getVolume().volume, 40);
  assert.equal(media[0].volume, 0.4);
});

test('handleMediaChange applies current volume to newly discovered media', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media });

  await controller.init();
  await controller.setVolume(25);

  const newMedia = createMedia({ volume: 1 });
  media.push(newMedia);

  await controller.handleMediaChange();

  assert.equal(newMedia.volume, 0.25);
});

test('notifyMediaMutation debounces re-application to the latest scheduled task', async () => {
  const media = [createMedia()];
  const { controller, scheduledTasks } = createController({ media });

  await controller.init();
  await controller.setVolume(25);

  controller.notifyMediaMutation();
  controller.notifyMediaMutation();

  assert.equal(scheduledTasks.length, 2);
  assert.equal(scheduledTasks[0].cleared, true);
  assert.equal(scheduledTasks[1].cleared, false);

  const newMedia = createMedia({ volume: 1 });
  media.push(newMedia);

  await scheduledTasks[1].callback();

  assert.equal(newMedia.volume, 0.25);
});

test('init is idempotent and only loads persisted state once', async () => {
  const media = [createMedia()];
  const { controller, storage, audio } = createController({ media, persistedVolume: 60 });

  await controller.init();
  await controller.init();

  assert.equal(storage.getCount(), 1);
  assert.equal(storage.writes.length, 0);
  assert.equal(audio.contextCount, 0);
  assert.equal(controller.getVolume().volume, 60);
});

// ─── Mute / Unmute ───────────────────────────────────────────────────────────

test('mute() sets volume to 0 and retains pre-mute level', async () => {
  const media = [createMedia()];
  const { controller, storage } = createController({ media, persistedVolume: 50 });

  await controller.init();
  const result = await controller.mute();

  assert.deepEqual(result, { ok: true, volume: 0, isMuted: true });
  assert.equal(media[0].volume, 0);
  assert.equal(controller.getVolume().isMuted, true);
  assert.equal(controller.getVolume().preMuteVolume, 50);
  assert.equal(controller.getVolume().volume, 50);
  assert.equal(storage.writes.length, 0);
});

test('unmute() restores pre-mute volume without touching storage', async () => {
  const media = [createMedia()];
  const { controller, storage } = createController({ media, persistedVolume: 50 });

  await controller.init();
  await controller.mute();
  const result = await controller.unmute();

  assert.deepEqual(result, { ok: true, volume: 50, isMuted: false });
  assert.equal(media[0].volume, 0.5);
  assert.equal(controller.getVolume().isMuted, false);
  assert.equal(controller.getVolume().volume, 50);
  assert.equal(storage.writes.length, 0);
});

test('calling mute() twice does not overwrite the saved pre-mute level', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 75 });

  await controller.init();
  await controller.mute();
  await controller.mute();

  assert.equal(controller.getVolume().preMuteVolume, 75);
  assert.equal(controller.getVolume().isMuted, true);
});

test('setVolume() while muted updates the pre-mute level, not the active gain', async () => {
  const media = [createMedia()];
  const { controller, storage } = createController({ media, persistedVolume: 40 });

  await controller.init();
  await controller.mute();
  const result = await controller.setVolume(80);

  assert.deepEqual(result, { ok: true, volume: 80 });
  assert.equal(media[0].volume, 0);
  assert.equal(controller.getVolume().volume, 80);
  assert.equal(controller.getVolume().preMuteVolume, 80);
  assert.equal(controller.getVolume().isMuted, true);
  assert.equal(storage.writes.length, 0);
});

test('unmute() after setVolume while muted applies the new volume', async () => {
  const media = [createMedia()];
  const { controller, storage } = createController({ media, persistedVolume: 40 });

  await controller.init();
  await controller.mute();
  await controller.setVolume(80);
  await controller.unmute();

  assert.equal(media[0].volume, 0.8);
  assert.equal(controller.getVolume().volume, 80);
  assert.equal(controller.getVolume().isMuted, false);
  assert.equal(storage.writes.length, 0);
});

test('handleMessage routes mute, unmute, and toggle-mute actions', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 60 });

  await controller.init();

  const muteResult = await controller.handleMessage({ action: 'mute' });
  assert.deepEqual(muteResult, { ok: true, volume: 0, isMuted: true });
  assert.equal(media[0].volume, 0);

  const unmuteResult = await controller.handleMessage({ action: 'unmute' });
  assert.deepEqual(unmuteResult, { ok: true, volume: 60, isMuted: false });
  assert.equal(media[0].volume, 0.6);

  const toggleResult1 = await controller.handleMessage({ action: 'toggle-mute' });
  assert.deepEqual(toggleResult1, { ok: true, volume: 0, isMuted: true });

  const toggleResult2 = await controller.handleMessage({ action: 'toggle-mute' });
  assert.deepEqual(toggleResult2, { ok: true, volume: 60, isMuted: false });
});

test('getVolume includes isMuted and preMuteVolume fields', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 55 });

  await controller.init();
  const state1 = controller.getVolume();

  assert.deepEqual(state1, { volume: 55, hasMedia: true, mediaCount: 1, isMuted: false, preMuteVolume: 100, isLocked: false });

  await controller.mute();
  const state2 = controller.getVolume();

  assert.deepEqual(state2, { volume: 55, hasMedia: true, mediaCount: 1, isMuted: true, preMuteVolume: 55, isLocked: false });
});

// ─── Reset Volume ────────────────────────────────────────────────────────────

test('handleMessage reset-volume sets volume to 100 and removes the storage key', async () => {
  const media = [createMedia()];
  const { controller, storage, storageKey } = createController({ media, persistedVolume: 75 });

  await controller.init();
  assert.equal(controller.getVolume().volume, 75);

  const result = await controller.handleMessage({ action: 'reset-volume' });

  assert.deepEqual(result, { ok: true, volume: 100 });
  assert.equal(controller.getVolume().volume, 100);
  assert.equal(media[0].volume, 1);
  assert.ok(storage.removedKeys.includes(storageKey));
});

test('handleMessage reset-volume returns { ok: true, volume: 100 }', async () => {
  const { controller } = createController({ persistedVolume: 50 });

  await controller.init();
  const result = await controller.handleMessage({ action: 'reset-volume' });

  assert.deepEqual(result, { ok: true, volume: 100 });
});

test('reset-volume at 100 still removes the storage key', async () => {
  const media = [createMedia()];
  const { controller, storage, storageKey } = createController({ media });

  await controller.init();
  assert.equal(controller.getVolume().volume, 100);

  const result = await controller.handleMessage({ action: 'reset-volume' });

  assert.deepEqual(result, { ok: true, volume: 100 });
  assert.equal(controller.getVolume().volume, 100);
  assert.equal(media[0].volume, 1);
  assert.ok(storage.removedKeys.includes(storageKey));
});

// ─── Media Count ─────────────────────────────────────────────────────────────

test('getVolume returns mediaCount: 0 when no elements exist', async () => {
  const { controller } = createController({ media: [] });

  await controller.init();
  const state = controller.getVolume();

  assert.equal(state.mediaCount, 0);
  assert.equal(state.hasMedia, false);
});

test('getVolume returns correct mediaCount matching the number of media elements', async () => {
  const media = [createMedia(), createMedia(), createMedia()];
  const { controller } = createController({ media });

  await controller.init();
  const state = controller.getVolume();

  assert.equal(state.mediaCount, 3);
  assert.equal(state.hasMedia, true);
});

test('getVolume hasMedia is false when mediaCount is 0 and true otherwise', async () => {
  const { controller } = createController({ media: [] });

  await controller.init();
  assert.equal(controller.getVolume().hasMedia, false);
  assert.equal(controller.getVolume().mediaCount, 0);

  const media = [createMedia()];
  const { controller: c2 } = createController({ media });
  await c2.init();
  assert.equal(c2.getVolume().hasMedia, true);
  assert.equal(c2.getVolume().mediaCount, 1);
});

test('reset-volume while muted clears mute state so unmute does not restore old level', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 150 });

  await controller.init();
  await controller.mute();
  assert.equal(controller.getVolume().isMuted, true);
  assert.equal(controller.getVolume().preMuteVolume, 150);

  await controller.handleMessage({ action: 'reset-volume' });

  assert.equal(controller.getVolume().volume, 100);
  assert.equal(controller.getVolume().isMuted, false);
  assert.equal(controller.getVolume().preMuteVolume, 100);

  const unmuteResult = await controller.unmute();
  assert.equal(unmuteResult.volume, 100);
  assert.equal(media[0].volume, 1);
});

test('reset-volume still sets desiredVolume to 100 in memory when storage.remove fails', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 80, storageOptions: { failRemove: true } });

  await controller.init();
  const result = await controller.handleMessage({ action: 'reset-volume' });

  assert.deepEqual(result, { ok: true, volume: 100 });
  assert.equal(controller.getVolume().volume, 100);
  assert.equal(media[0].volume, 1);
});

test('getVolume mediaCount reflects elements added between calls', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media });

  await controller.init();
  assert.equal(controller.getVolume().mediaCount, 1);

  media.push(createMedia(), createMedia());
  assert.equal(controller.getVolume().mediaCount, 3);

  media.length = 0;
  assert.equal(controller.getVolume().mediaCount, 0);
});

test('step-volume increments desiredVolume by the given positive delta', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 100 });

  await controller.init();
  const res = await controller.handleMessage({ action: 'step-volume', delta: 15 });

  assert.deepEqual(res, { ok: true, volume: 115 });
  assert.equal(controller.getVolume().volume, 115);
});

test('step-volume decrements desiredVolume by the given negative delta', async () => {
  const { controller } = createController({ persistedVolume: 100 });
  await controller.init();
  await controller.handleMessage({ action: 'step-volume', delta: -30 });
  assert.equal(controller.getVolume().volume, 70);
});

test('step-volume clamps the result to [0, 200]', async () => {
  const { controller } = createController({ persistedVolume: 190 });
  await controller.init();
  await controller.handleMessage({ action: 'step-volume', delta: 25 });
  assert.equal(controller.getVolume().volume, 200);
  await controller.handleMessage({ action: 'step-volume', delta: -500 });
  assert.equal(controller.getVolume().volume, 0);
});

test('step-volume with non-finite delta leaves volume unchanged', async () => {
  const { controller } = createController({ persistedVolume: 90 });
  await controller.init();
  const res = await controller.handleMessage({ action: 'step-volume', delta: Infinity });
  assert.deepEqual(res, { ok: true, volume: 90 });
  assert.equal(controller.getVolume().volume, 90);
});

test('get-state returns volume, hasMedia, isMuted and preMuteVolume when not muted', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 66 });
  await controller.init();
  const res = await controller.handleMessage({ action: 'get-state' });
  assert.deepEqual(res, { volume: 66, hasMedia: true, mediaCount: 1, isMuted: false, preMuteVolume: 100, isLocked: false });
});

test('get-state reflects muted=true and correct preMuteVolume after muting', async () => {
  const { controller } = createController({ persistedVolume: 80 });
  await controller.init();
  await controller.mute();
  const res = await controller.handleMessage({ action: 'get-state' });
  assert.equal(res.isMuted, true);
  assert.equal(res.preMuteVolume, 80);
});

test('get-state reflects isMuted=false after unmuting', async () => {
  const { controller } = createController({ persistedVolume: 80 });
  await controller.init();
  await controller.mute();
  await controller.unmute();
  const res = await controller.handleMessage({ action: 'get-state' });
  assert.equal(res.isMuted, false);
});

test('fadeToVolume transitions to target volume and persists the final value', async () => {
  const media = [createMedia()];
  const { controller, storage, storageKey } = createController({ media, persistedVolume: 100, autoRunScheduled: true });
  await controller.init();
  const res = await controller.fadeToVolume(140, { steps: 4, intervalMs: 1 });
  assert.deepEqual(res, { ok: true, volume: 140 });
  assert.equal(controller.getVolume().volume, 140);
  assert.deepEqual(storage.writes.at(-1), { [storageKey]: 140 });
});

test('fade-volume message routes to fadeToVolume with provided options', async () => {
  const { controller } = createController({ persistedVolume: 100, autoRunScheduled: true });
  await controller.init();
  const res = await controller.handleMessage({ action: 'fade-volume', target: 120, steps: 2, intervalMs: 1 });
  assert.deepEqual(res, { ok: true, volume: 120 });
});

test('fadeToVolume uses default steps and intervalMs when options are omitted', async () => {
  const { controller } = createController({ persistedVolume: 100, autoRunScheduled: true });
  await controller.init();
  const res = await controller.fadeToVolume(110);
  assert.deepEqual(res, { ok: true, volume: 110 });
});

test('fadeToVolume clamps target to [0, 200] via normalizeVolume', async () => {
  const { controller } = createController({ persistedVolume: 100, autoRunScheduled: true });
  await controller.init();
  await controller.fadeToVolume(999, { steps: 1, intervalMs: 1 });
  assert.equal(controller.getVolume().volume, 200);
});

test('lockVolume prevents external volume writes from changing effective volume', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 40 });
  await controller.init();
  await controller.lockVolume();
  media[0].volume = 1;
  assert.equal(media[0].volume, 0.4);
});

test('unlockVolume restores normal volume setter behaviour', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 40 });
  await controller.init();
  await controller.lockVolume();
  await controller.unlockVolume();
  media[0].volume = 1;
  assert.equal(media[0].volume, 1);
});

test('toggle-lock message toggles the lock state and returns current isLocked', async () => {
  const { controller } = createController({ persistedVolume: 50 });
  await controller.init();
  const r1 = await controller.handleMessage({ action: 'toggle-lock' });
  const r2 = await controller.handleMessage({ action: 'toggle-lock' });
  assert.deepEqual(r1, { ok: true, isLocked: true });
  assert.deepEqual(r2, { ok: true, isLocked: false });
});

test('setVolume while locked still updates desiredVolume and re-applies the lock', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media, persistedVolume: 40 });
  await controller.init();
  await controller.lockVolume();
  await controller.setVolume(80);
  media[0].volume = 0.1;
  assert.equal(controller.getVolume().volume, 80);
  assert.equal(media[0].volume, 0.8);
});

test('getVolume includes isLocked field reflecting current lock state', async () => {
  const { controller } = createController();
  await controller.init();
  assert.equal(controller.getVolume().isLocked, false);
  await controller.lockVolume();
  assert.equal(controller.getVolume().isLocked, true);
});

test('setVolume mid-fade cancels remaining fade steps and keeps new volume', async () => {
  const { controller, scheduledTasks } = createController({ persistedVolume: 50 });
  await controller.init();

  // Start a 4-step fade 50→100. Step 1 runs synchronously, then suspends on the timer.
  const fadePromise = controller.fadeToVolume(100, { steps: 4, intervalMs: 10 });

  // Yield so the fade async function runs up to its first await-on-timer.
  await Promise.resolve();

  // Interrupt: setVolume cancels the fade by bumping fadeVersion.
  await controller.setVolume(75);
  assert.equal(controller.getVolume().volume, 75);

  // Flush the pending fade timer — the loop should exit early without overwriting 75.
  const pendingTask = scheduledTasks.find(t => !t.cleared);
  if (pendingTask) await pendingTask.callback();

  // fadePromise should now resolve (cancelled early).
  await fadePromise;
  assert.equal(controller.getVolume().volume, 75);
});

test('resetVolume mid-fade cancels the fade', async () => {
  const { controller, scheduledTasks } = createController({ persistedVolume: 50 });
  await controller.init();

  const fadePromise = controller.fadeToVolume(100, { steps: 4, intervalMs: 10 });
  await Promise.resolve();

  await controller.resetVolume();
  assert.equal(controller.getVolume().volume, 100);

  const pendingTask = scheduledTasks.find(t => !t.cleared);
  if (pendingTask) await pendingTask.callback();

  await fadePromise;
  assert.equal(controller.getVolume().volume, 100);
});

test('starting a new fade cancels the previous in-flight fade', async () => {
  const { controller, scheduledTasks } = createController({ persistedVolume: 50 });
  await controller.init();

  const fade1 = controller.fadeToVolume(100, { steps: 4, intervalMs: 10 });
  await Promise.resolve();

  // Start a second fade — cancels the first.
  const fade2 = controller.fadeToVolume(60, { steps: 1, intervalMs: 0 });

  // Flush any remaining tasks from the first fade.
  for (const task of scheduledTasks.filter(t => !t.cleared)) {
    await task.callback();
  }

  await Promise.all([fade1, fade2]);
  assert.equal(controller.getVolume().volume, 60);
});
