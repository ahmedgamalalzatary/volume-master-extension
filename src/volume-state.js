'use strict';

(function initVolumeState(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.VolumeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function volumeStateFactory() {
    const STORAGE_PREFIX = 'vc:origin:';

    function keyForOrigin(origin) {
        return `${STORAGE_PREFIX}${origin}`;
    }

    function normalizeVolume(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 100;
        return Math.max(0, Math.min(200, parsed));
    }

    return {
        STORAGE_PREFIX,
        keyForOrigin,
        normalizeVolume
    };
});
