'use strict';

const DEFAULT_COLOR = '#5b8cff';
const WARNING_COLOR = '#f0a020';
const DANGER_COLOR = '#e24b4b';

function badgeColorForVolume(volume) {
    if (typeof volume !== 'number') return DEFAULT_COLOR;
    if (volume > 150) return DANGER_COLOR;
    if (volume > 100) return WARNING_COLOR;
    return DEFAULT_COLOR;
}

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(async (msg, sender) => {
    if (!msg || msg.action !== 'update-badge') return undefined;

    const tabId = typeof msg.tabId === 'number' ? msg.tabId : sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return undefined;

    if (typeof msg.volume !== 'number') {
        await browser.action.setBadgeText({ text: '', tabId });
        return { ok: true };
    }

    const vol = Math.round(msg.volume);
    await Promise.all([
        browser.action.setBadgeBackgroundColor({ color: badgeColorForVolume(vol), tabId }),
        browser.action.setBadgeText({ text: String(vol), tabId })
    ]);

    return { ok: true };
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { badgeColorForVolume };
}
