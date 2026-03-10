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
            notifyBadge = async () => {},
            scheduleTask = setTimeout,
            cancelTask = clearTimeout
        } = deps;

        const storageKey = volumeState.keyForOrigin(origin);
        let desiredVolume = 100;
        let muted = false;
        let preMuteVolume = 100;
        let locked = false;
        let audioCtx = null;
        let gainNode = null;
        let mutationTaskId = null;
        let initTask = null;
        let fadeTaskId = null;
        const elementStatus = new WeakMap();
        const lockedElements = new WeakMap();

        function ensureContext() {
            if (audioCtx) return;
            audioCtx = createAudioContext();
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }

        function getMediaList() {
            return Array.from(getMediaElements());
        }

        function getActiveVolume() {
            return muted ? 0 : desiredVolume;
        }

        function notifyBadgeSafe(vol) {
            return Promise.resolve(notifyBadge(vol)).catch(() => {});
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

        function ensureLockOnElement(el) {
            if (!locked || lockedElements.has(el)) return;

            let descriptor = Object.getOwnPropertyDescriptor(el, 'volume');
            let owner = el;
            if (!descriptor) {
                owner = Object.getPrototypeOf(el);
                while (owner && !descriptor) {
                    descriptor = Object.getOwnPropertyDescriptor(owner, 'volume');
                    owner = Object.getPrototypeOf(owner);
                }
            }

            const state = {
                descriptor,
                value: Number.isFinite(el.volume) ? el.volume : 1
            };

            Object.defineProperty(el, 'volume', {
                configurable: true,
                enumerable: true,
                get() {
                    return state.value;
                },
                set(_) {
                    state.value = desiredVolume / 100;
                }
            });

            lockedElements.set(el, state);
        }

        function removeLockFromElement(el) {
            const state = lockedElements.get(el);
            if (!state) return;

            if (state.descriptor) {
                Object.defineProperty(el, 'volume', state.descriptor);
                try {
                    el.volume = state.value;
                } catch (_) {}
            } else {
                delete el.volume;
            }

            lockedElements.delete(el);
        }

        function setElementVolume(el, value) {
            if (locked) {
                ensureLockOnElement(el);
                const state = lockedElements.get(el);
                if (state) {
                    state.value = value;
                    return;
                }
            }
            el.volume = value;
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
            const vol = getActiveVolume();
            const media = getMediaList();

            if (vol <= 100) {
                if (gainNode) gainNode.gain.value = vol / 100;
                media.forEach(el => {
                    const targetVolume = elementStatus.get(el) === 'wired' ? 1.0 : vol / 100;
                    setElementVolume(el, targetVolume);
                });
                return;
            }

            ensureContext();
            gainNode.gain.value = vol / 100;

            if (audioCtx.state !== 'running') {
                media.forEach(el => {
                    setElementVolume(el, 1.0);
                });
                return;
            }

            media.forEach(el => {
                wireElement(el);
                setElementVolume(el, 1.0);
            });
        }

        async function init() {
            if (!initTask) {
                initTask = (async () => {
                    await loadPersistedVolume();
                    await applyVolume();
                    await notifyBadgeSafe(getActiveVolume());
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
            await notifyBadgeSafe(getActiveVolume());
            return { ok: true, volume: desiredVolume };
        }

        async function stepVolume(delta) {
            if (!Number.isFinite(delta)) {
                return { ok: true, volume: desiredVolume };
            }
            return setVolume(desiredVolume + delta);
        }

        async function fadeToVolume(target, options = {}) {
            const normalizedTarget = volumeState.normalizeVolume(target);
            const steps = Number.isFinite(options.steps) && options.steps > 0 ? Math.floor(options.steps) : 10;
            const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs >= 0 ? Math.floor(options.intervalMs) : 30;
            const start = desiredVolume;

            if (fadeTaskId !== null) {
                cancelTask(fadeTaskId);
                fadeTaskId = null;
            }

            if (steps === 1 || start === normalizedTarget) {
                return setVolume(normalizedTarget);
            }

            let tick = 0;
            return new Promise(resolve => {
                const run = async () => {
                    tick += 1;
                    const progress = tick / steps;
                    desiredVolume = volumeState.normalizeVolume(Math.round(start + (normalizedTarget - start) * progress));
                    await applyVolume();
                    await notifyBadgeSafe(getActiveVolume());

                    if (tick >= steps) {
                        fadeTaskId = null;
                        if (!muted) {
                            await persistVolume(desiredVolume);
                        }
                        resolve({ ok: true, volume: desiredVolume });
                        return;
                    }

                    fadeTaskId = scheduleTask(() => {
                        Promise.resolve(run()).catch(() => {});
                    }, intervalMs);
                };

                fadeTaskId = scheduleTask(() => {
                    Promise.resolve(run()).catch(() => {});
                }, intervalMs);
            });
        }

        function getVolume() {
            const mediaList = getMediaList();
            return {
                volume: desiredVolume,
                hasMedia: mediaList.length > 0,
                mediaCount: mediaList.length,
                isMuted: muted,
                preMuteVolume,
                isLocked: locked
            };
        }

        function getState() {
            const state = getVolume();
            return {
                volume: state.volume,
                hasMedia: state.hasMedia,
                mediaCount: state.mediaCount,
                isMuted: state.isMuted,
                preMuteVolume: state.preMuteVolume,
                isLocked: state.isLocked
            };
        }

        async function resetVolume() {
            desiredVolume = 100;
            preMuteVolume = 100;
            muted = false;
            await Promise.allSettled([
                storage.remove(storageKey),
                applyVolume(),
                notifyBadgeSafe(getActiveVolume())
            ]);
            return { ok: true, volume: 100 };
        }

        async function mute() {
            if (muted) return { ok: true, volume: 0, isMuted: true };
            preMuteVolume = desiredVolume;
            muted = true;
            await applyVolume();
            await notifyBadgeSafe(getActiveVolume());
            return { ok: true, volume: 0, isMuted: true };
        }

        async function unmute() {
            if (!muted) return { ok: true, volume: desiredVolume, isMuted: false };
            muted = false;
            desiredVolume = preMuteVolume;
            await applyVolume();
            await notifyBadgeSafe(getActiveVolume());
            return { ok: true, volume: desiredVolume, isMuted: false };
        }

        function isMuted() {
            return muted;
        }

        async function lockVolume() {
            locked = true;
            getMediaList().forEach(ensureLockOnElement);
            await applyVolume();
            return { ok: true, isLocked: true };
        }

        async function unlockVolume() {
            locked = false;
            getMediaList().forEach(removeLockFromElement);
            await applyVolume();
            return { ok: true, isLocked: false };
        }

        function isLocked() {
            return locked;
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
            if (msg.action === 'fade-volume') return fadeToVolume(msg.target, { steps: msg.steps, intervalMs: msg.intervalMs });
            if (msg.action === 'get-volume') return getVolume();
            if (msg.action === 'get-state') return getState();
            if (msg.action === 'reset-volume') return resetVolume();
            if (msg.action === 'mute') return mute();
            if (msg.action === 'unmute') return unmute();
            if (msg.action === 'toggle-mute') return muted ? unmute() : mute();
            if (msg.action === 'toggle-lock') return locked ? unlockVolume() : lockVolume();
            return undefined;
        }

        return {
            init,
            setVolume,
            stepVolume,
            fadeToVolume,
            getVolume,
            getState,
            resetVolume,
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
