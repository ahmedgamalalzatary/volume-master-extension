'use strict';

(function initScrollControl(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.ScrollControl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function scrollControlFactory() {
    function computeScrollDelta(event) {
        if (!event || typeof event.deltaY !== 'number' || event.deltaY === 0) {
            return 0;
        }

        const step = event.shiftKey ? 1 : 5;
        return event.deltaY < 0 ? step : -step;
    }

    return {
        computeScrollDelta
    };
});
