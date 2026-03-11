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
            notifyBadge = () => Promise.resolve(),
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
        let lockActive = false;
        let fadeVersion = 0;
        const elementStatus = new WeakMap();
        const lockedElements = new Set();

        function cancelActiveFade() {
            fadeVersion += 1;
        }

        function getNativeVolume(el) {
            const descriptor = Object.getOwnPropertyDescriptor(el, 'volume');
            if (descriptor && typeof descriptor.get === 'function') return descriptor.get.call(el);
            return el.volume;
        }

        function setNativeVolume(el, value) {
            const normalizedValue = Math.max(0, Math.min(1, Number(value)));
            const descriptor = Object.getOwnPropertyDescriptor(el, 'volume');
            if (descriptor && typeof descriptor.set === 'function') {
                descriptor.set.call(el, normalizedValue);
                return;
            }
            el.volume = normalizedValue;
        }

        function volumeForElement() {
            const effectiveVolume = muted ? 0 : desiredVolume;
            return effectiveVolume <= 100 ? effectiveVolume / 100 : 1;
        }

        function installVolumeLock(el) {
            if (lockedElements.has(el)) return;

            const initialValue = getNativeVolume(el);
            let backingVolume = Number.isFinite(initialValue) ? initialValue : volumeForElement();

            Object.defineProperty(el, 'volume', {
                configurable: true,
                enumerable: true,
                get() {
                    return backingVolume;
                },
                set() {
                    backingVolume = volumeForElement();
                }
            });
            setNativeVolume(el, volumeForElement());
            lockedElements.add(el);
        }

        function removeVolumeLock(el) {
            if (lockedElements.has(el)) {
                delete el.volume;
            }
            lockedElements.delete(el);
        }

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
            const elementVolume = volumeForElement();

            if (!lockActive) {
                lockedElements.forEach(removeVolumeLock);
            }

            if (vol <= 100) {
                if (gainNode) gainNode.gain.value = vol / 100;
                media.forEach(el => {
                    if (lockActive) installVolumeLock(el);
                    if (elementStatus.get(el) === 'wired') {
                        setNativeVolume(el, 1.0);
                    } else {
                        setNativeVolume(el, elementVolume);
                    }
                });
                return;
            }

            ensureContext();
            gainNode.gain.value = vol / 100;

            if (audioCtx.state !== 'running') {
                media.forEach(el => {
                    if (lockActive) installVolumeLock(el);
                    setNativeVolume(el, 1.0);
                });
                return;
            }

            media.forEach(el => {
                wireElement(el);
                if (lockActive) installVolumeLock(el);
                setNativeVolume(el, 1.0);
            });
        }

        async function init() {
            if (!initTask) {
                initTask = (async () => {
                    await loadPersistedVolume();
                    await applyVolume();
                    await notifyBadge(desiredVolume);
                })();
            }
            await initTask;
        }

        async function setVolume(value) {
            cancelActiveFade();
            const normalized = volumeState.normalizeVolume(value);
            desiredVolume = normalized;
            if (muted) {
                preMuteVolume = normalized;
                await notifyBadge(desiredVolume);
                return { ok: true, volume: normalized };
            }
            await Promise.allSettled([persistVolume(desiredVolume), applyVolume()]);
            await notifyBadge(desiredVolume);
            return { ok: true, volume: desiredVolume };
        }

        async function stepVolume(delta) {
            if (!Number.isFinite(delta)) {
                return { ok: true, volume: desiredVolume };
            }
            return setVolume(desiredVolume + Number(delta));
        }

        function getVolume() {
            const mediaList = getMediaList();
            return {
                volume: desiredVolume,
                hasMedia: mediaList.length > 0,
                mediaCount: mediaList.length,
                isMuted: muted,
                preMuteVolume: preMuteVolume,
                isLocked: lockActive
            };
        }

        function getState() {
            return getVolume();
        }

        async function resetVolume() {
            cancelActiveFade();
            desiredVolume = 100;
            preMuteVolume = 100;
            muted = false;
            await Promise.allSettled([
                storage.remove(storageKey),
                applyVolume()
            ]);
            await notifyBadge(100);
            return { ok: true, volume: 100 };
        }

        async function fadeToVolume(target, options = {}) {
            cancelActiveFade();
            const myVersion = fadeVersion;
            const normalizedTarget = volumeState.normalizeVolume(target);
            const steps = Number.isFinite(options.steps) && options.steps > 0 ? Math.floor(options.steps) : 10;
            const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs >= 0 ? Math.floor(options.intervalMs) : 30;
            const start = desiredVolume;
            for (let i = 1; i <= steps; i += 1) {
                if (fadeVersion !== myVersion) return { ok: true, volume: desiredVolume };
                const nextVol = volumeState.normalizeVolume(Math.round(start + ((normalizedTarget - start) * i) / steps));
                desiredVolume = nextVol;
                await applyVolume();
                if (i < steps) {
                    await new Promise(resolve => {
                        scheduleTask(resolve, intervalMs);
                    });
                }
            }
            if (fadeVersion !== myVersion) return { ok: true, volume: desiredVolume };
            await persistVolume(desiredVolume);
            await notifyBadge(desiredVolume);
            return { ok: true, volume: desiredVolume };
        }

        async function mute() {
            cancelActiveFade();
            if (muted) return { ok: true, volume: 0, isMuted: true };
            preMuteVolume = desiredVolume;
            muted = true;
            await applyVolume();
            return { ok: true, volume: 0, isMuted: true };
        }

        async function unmute() {
            cancelActiveFade();
            if (!muted) return { ok: true, volume: desiredVolume, isMuted: false };
            muted = false;
            desiredVolume = preMuteVolume;
            await applyVolume();
            return { ok: true, volume: desiredVolume, isMuted: false };
        }

        function isMuted() {
            return muted;
        }

        function isLocked() {
            return lockActive;
        }

        async function lockVolume() {
            lockActive = true;
            await applyVolume();
            return { ok: true, isLocked: true };
        }

        async function unlockVolume() {
            lockActive = false;
            lockedElements.forEach(removeVolumeLock);
            await applyVolume();
            return { ok: true, isLocked: false };
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
            if (msg.action === 'step-volume') return stepVolume(msg.delta);
            if (msg.action === 'get-volume') return getVolume();
            if (msg.action === 'get-state') return getState();
            if (msg.action === 'reset-volume') return resetVolume();
            if (msg.action === 'fade-volume') return fadeToVolume(msg.target, { steps: msg.steps, intervalMs: msg.intervalMs });
            if (msg.action === 'mute') return mute();
            if (msg.action === 'unmute') return unmute();
            if (msg.action === 'toggle-mute') return muted ? unmute() : mute();
            if (msg.action === 'toggle-lock') return lockActive ? unlockVolume() : lockVolume();
            return undefined;
        }

        return {
            init,
            setVolume,
            stepVolume,
            getVolume,
            getState,
            resetVolume,
            fadeToVolume,
            mute,
            unmute,
            isMuted,
            lockVolume,
            unlockVolume,
            isLocked,
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
