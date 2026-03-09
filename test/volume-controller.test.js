const test = require('node:test');
const assert = require('node:assert/strict');

const { createVolumeController } = require('../src/volume-controller.js');

function createStorage(initialValue, options = {}) {
  const store = new Map(Object.entries(initialValue || {}));
  const writes = [];
  let getCount = 0;

  return {
    writes,
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
  audioOptions
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
      scheduledTasks.push({ id, callback, delay, cleared: false });
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

  assert.deepEqual(controller.getVolume(), { volume: 100, hasMedia: false });
});

test('handleMessage routes get-volume and set-volume messages', async () => {
  const media = [createMedia()];
  const { controller } = createController({ media });

  await controller.init();

  const getResponse = await controller.handleMessage({ action: 'get-volume' });
  const setResponse = await controller.handleMessage({ action: 'set-volume', volume: 45 });

  assert.deepEqual(getResponse, { volume: 100, hasMedia: true });
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
