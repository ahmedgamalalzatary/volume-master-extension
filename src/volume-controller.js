'use strict';

(function initVolumeController(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.VolumeController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function volumeControllerFactory() {
    function assertRequiredDeps(deps) {
        if (!deps || typeof deps !== 'object') {
            throw new TypeError('createVolumeController requires a dependency object');
        }
        if (!deps.volumeState || typeof deps.volumeState.keyForOrigin !== 'function' || typeof deps.volumeState.normalizeVolume !== 'function') {
            throw new TypeError('createVolumeController requires volumeState with keyForOrigin() and normalizeVolume()');
        }
        if (typeof deps.origin !== 'string' || deps.origin.length === 0) {
            throw new TypeError('createVolumeController requires a non-empty origin');
        }
        if (typeof deps.getMediaElements !== 'function') {
            throw new TypeError('createVolumeController requires getMediaElements()');
        }
        if (!deps.storage || typeof deps.storage.get !== 'function' || typeof deps.storage.set !== 'function' || typeof deps.storage.remove !== 'function') {
            throw new TypeError('createVolumeController requires storage.get(), storage.set(), and storage.remove()');
        }
        if (typeof deps.createAudioContext !== 'function') {
            throw new TypeError('createVolumeController requires createAudioContext()');
        }
    }

    function createVolumeController(deps) {
        assertRequiredDeps(deps);

        const {
            volumeState,
            origin,
            getMediaElements,
            storage,
            createAudioContext,
            scheduleTask = setTimeout,
            cancelTask = clearTimeout
        } = deps;

        const storageKey = volumeState.keyForOrigin(origin);
        let desiredVolume = 100;
        let muted = false;
        let preMuteVolume = 100;
        let audioCtx = null;
        let gainNode = null;
        let mutationTaskId = null;
        let initTask = null;
        const elementStatus = new WeakMap();

        function ensureContext() {
            if (audioCtx) return;
            audioCtx = createAudioContext();
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }

        function getMediaList() {
            return Array.from(getMediaElements());
        }

        function canUseWebAudioBoost(el) {
            const src = el.currentSrc || el.src;
            if (!src) return false;

            try {
                const url = new URL(src, origin);
                if (url.protocol === 'data:') return true;
                if (url.protocol === 'blob:') return true;
                if (url.origin === origin) return true;
                return typeof el.crossOrigin === 'string' && el.crossOrigin.length > 0;
            } catch (_) {
                return false;
            }
        }

        function wireElement(el) {
            if (elementStatus.has(el)) return;
            if (!canUseWebAudioBoost(el)) {
                elementStatus.set(el, 'skipped');
                return;
            }

            try {
                const src = audioCtx.createMediaElementSource(el);
                src.connect(gainNode);
                elementStatus.set(el, 'wired');
            } catch (_) {
                elementStatus.set(el, 'skipped');
            }
        }

        async function loadPersistedVolume() {
            try {
                const data = await storage.get(storageKey);
                desiredVolume = volumeState.normalizeVolume(data[storageKey]);
            } catch (_) {
                desiredVolume = 100;
            }
        }

        async function persistVolume(vol) {
            try {
                await storage.set({ [storageKey]: volumeState.normalizeVolume(vol) });
            } catch (_) {
                // Ignore storage write failures and keep in-memory behavior.
            }
        }

        async function applyVolume() {
            const effectiveVolume = muted ? 0 : desiredVolume;
            const vol = effectiveVolume;
            const media = getMediaList();

            if (vol <= 100) {
                if (gainNode) gainNode.gain.value = vol / 100;
                media.forEach(el => {
                    if (elementStatus.get(el) === 'wired') {
                        el.volume = 1.0;
                    } else {
                        el.volume = vol / 100;
                    }
                });
                return;
            }

            ensureContext();
            gainNode.gain.value = vol / 100;

            if (audioCtx.state !== 'running') {
                media.forEach(el => {
                    el.volume = 1.0;
                });
                return;
            }

            media.forEach(el => {
                wireElement(el);
                el.volume = 1.0;
            });
        }

        async function init() {
            if (!initTask) {
                initTask = (async () => {
                    await loadPersistedVolume();
                    await applyVolume();
                })();
            }
            await initTask;
        }

        async function setVolume(value) {
            const normalized = volumeState.normalizeVolume(value);
            desiredVolume = normalized;
            if (muted) {
                preMuteVolume = normalized;
                return { ok: true, volume: normalized };
            }
            await Promise.allSettled([persistVolume(desiredVolume), applyVolume()]);
            return { ok: true, volume: desiredVolume };
        }

        function getVolume() {
            const mediaList = getMediaList();
            return {
                volume: desiredVolume,
                hasMedia: mediaList.length > 0,
                mediaCount: mediaList.length,
                isMuted: muted,
                preMuteVolume: preMuteVolume
            };
        }

        async function resetVolume() {
            desiredVolume = 100;
            preMuteVolume = 100;
            muted = false;
            await Promise.allSettled([
                storage.remove(storageKey),
                applyVolume()
            ]);
            return { ok: true, volume: 100 };
        }

        async function mute() {
            if (muted) return { ok: true, volume: 0, isMuted: true };
            preMuteVolume = desiredVolume;
            muted = true;
            await applyVolume();
            return { ok: true, volume: 0, isMuted: true };
        }

        async function unmute() {
            if (!muted) return { ok: true, volume: desiredVolume, isMuted: false };
            muted = false;
            desiredVolume = preMuteVolume;
            await applyVolume();
            return { ok: true, volume: desiredVolume, isMuted: false };
        }

        function isMuted() {
            return muted;
        }

        async function handleMediaChange() {
            await applyVolume();
        }

        function notifyMediaMutation() {
            if (mutationTaskId !== null) {
                cancelTask(mutationTaskId);
            }
            mutationTaskId = scheduleTask(async () => {
                mutationTaskId = null;
                await handleMediaChange();
            }, 150);
            return mutationTaskId;
        }

        async function resumeIfSuspended() {
            if (!audioCtx) return false;
            if (audioCtx.state !== 'suspended' && audioCtx.state !== 'interrupted') return false;
            try {
                await audioCtx.resume();
            } catch (_) {
                return false;
            }

            if (audioCtx.state === 'running') {
                await applyVolume();
                return true;
            }

            return false;
        }

        async function handleMessage(msg) {
            if (!msg || typeof msg !== 'object') return undefined;
            if (msg.action === 'set-volume') return setVolume(msg.volume);
            if (msg.action === 'get-volume') return getVolume();
            if (msg.action === 'reset-volume') return resetVolume();
            if (msg.action === 'mute') return mute();
            if (msg.action === 'unmute') return unmute();
            if (msg.action === 'toggle-mute') return muted ? unmute() : mute();
            return undefined;
        }

        return {
            init,
            setVolume,
            getVolume,
            resetVolume,
            mute,
            unmute,
            isMuted,
            handleMediaChange,
            notifyMediaMutation,
            resumeIfSuspended,
            handleMessage
        };
    }

    return {
        createVolumeController
    };
});
