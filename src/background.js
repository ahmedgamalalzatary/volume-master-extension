'use strict';

const BADGE_COLORS = {
    accent: '#3b82f6',
    warning: '#f59e0b',
    danger: '#ef4444'
};

function badgeColorForVolume(volume) {
    if (typeof volume !== 'number') return BADGE_COLORS.accent;
    if (volume > 150) return BADGE_COLORS.danger;
    if (volume > 100) return BADGE_COLORS.warning;
    return BADGE_COLORS.accent;
}

browser.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.action !== 'update-badge') return undefined;
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    if (typeof tabId !== 'number') return undefined;

    const vol = Number.isFinite(msg.volume) ? Math.round(msg.volume) : undefined;
    const text = typeof vol === 'number' ? String(vol) : '';

    return Promise.all([
        browser.action.setBadgeText({ text, tabId }),
        browser.action.setBadgeBackgroundColor({ color: badgeColorForVolume(vol), tabId })
    ]).then(() => ({ ok: true }));
});

if (browser.tabs && browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(async ({ tabId }) => {
        try {
            await browser.tabs.sendMessage(tabId, { action: 'get-state' });
        } catch (_) {
            await browser.action.setBadgeText({ text: '', tabId });
        }
    });
}

if (browser.tabs && browser.tabs.onUpdated) {
    browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
        if (changeInfo.status !== 'loading') return;
        await browser.action.setBadgeText({ text: '', tabId });
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        badgeColorForVolume,
        BADGE_COLORS
    };
}
