const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../../src/content_scripts/ui/frontend.html'), 'utf8');

import { waitForEvent } from '../../utils';

const waitUntil = async (predicate) => {
    for (let i = 0; i < 20; i++) {
        if (predicate()) {
            return;
        }
        await new Promise((r) => setTimeout(r, 0));
    }
    expect(predicate()).toBe(true);
};

const postFrontendMessage = (message) => {
    window.postMessage({surfingkeys_frontend_data: message}, document.location.origin);
};

const pressKey = (key, options = {}) => {
    const usageSearchInput = document.querySelector("#sk_usage .usage-search-query");
    const activeElement = document.activeElement && document.activeElement.isConnected && document.activeElement !== document.body ? document.activeElement : document.body;
    const target = usageSearchInput || activeElement;
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options
    });
    target.dispatchEvent(event);
    if (!event.defaultPrevented && target instanceof HTMLInputElement && key.length === 1 && !options.ctrlKey && !options.metaKey && !options.altKey) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        target.value = target.value.substr(0, start) + key + target.value.substr(end);
        target.setSelectionRange(start + key.length, start + key.length);
        target.dispatchEvent(new Event("input", {bubbles: true}));
    }
    return event;
};

describe('ui front', () => {

    let Front;

    beforeAll(async () => {
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn()
                },
                getURL: jest.fn((path) => path)
            },
            storage: {
                local: {
                    get: jest.fn()
                }
            }
        }
        global.DOMRect = jest.fn();
        Object.defineProperty(window.navigator, "language", {
            value: "en-US",
            configurable: true
        });
        document.documentElement.innerHTML = html.toString();
        Front = require('src/content_scripts/ui/frontend');

        window.focus = jest.fn();
        document.dispatchEvent = jest.fn();
        await waitForEvent(window, "message", (_msg) => {
            return _msg.surfingkeys_uihost_data && _msg.surfingkeys_uihost_data.action === "initFrontendAck";
        }, () => {
            postFrontendMessage({ action: "initFrontend", ack: true, origin: document.location.origin });
        });
    });

    test('show omnibar', async () => {
        const elmOmnibarStyle = document.getElementById("sk_omnibar").style;
        expect(elmOmnibarStyle).toHaveProperty('display', 'none');
        await waitForEvent(window, "message", (_msg) => {
            return _msg.surfingkeys_uihost_data && _msg.surfingkeys_uihost_data.action === "setFrontFrame";
        }, () => {
            postFrontendMessage({ action: "openOmnibar", type: "SearchEngine", extra: "b" });
        });
        expect(elmOmnibarStyle).not.toHaveProperty('display', 'none');
    });

    test('searches usage by fuzzy command name', async () => {
        const usage = document.getElementById("sk_usage");
        postFrontendMessage({
            action: "showUsage",
            metas: [
                {word: "d", annotation: "Move down", feature_group: 2},
                {word: "cq", annotation: "Copy query string", feature_group: 7},
                {word: "ou", annotation: "Open URL from clipboard", feature_group: 8},
                {word: "pt", annotation: "Enter PassThrough mode to temporarily suppress SurfingKeys", feature_group: 14},
                {word: "sg", annotation: "Search selected text with Google", feature_group: 6},
                {word: "zz", annotation: "Zoom current page", feature_group: 14}
            ]
        });
        await waitUntil(() => usage.querySelector(".usage-entry"));

        const entries = Array.from(usage.querySelectorAll(".usage-entry"));
        const moveDown = entries.find((entry) => entry.textContent.includes("Move down"));
        const copyQuery = entries.find((entry) => entry.textContent.includes("Copy query string"));
        const openUrl = entries.find((entry) => entry.textContent.includes("Open URL from clipboard"));
        const passThrough = entries.find((entry) => entry.textContent.includes("PassThrough mode"));
        const searchSelected = entries.find((entry) => entry.textContent.includes("Search selected text with Google"));

        pressKey("/");
        "cop qu".split("").forEach((key) => pressKey(key));

        expect(usage.querySelector(".usage-search-query").value).toBe("cop qu");
        expect(copyQuery.classList.contains("usage-filtered-out")).toBe(false);
        expect(openUrl.classList.contains("usage-filtered-out")).toBe(true);

        pressKey("Escape");

        expect(usage.querySelector(".usage-search")).toBe(null);
        expect(openUrl.classList.contains("usage-filtered-out")).toBe(false);

        pressKey("/");
        "scr pag".split("").forEach((key) => pressKey(key));

        expect(usage.querySelector(".usage-search-query").value).toBe("scr pag");
        expect(moveDown.classList.contains("usage-filtered-out")).toBe(false);
        expect(copyQuery.classList.contains("usage-filtered-out")).toBe(true);

        const ctrlBackspace = pressKey("Backspace", {ctrlKey: true});
        expect(ctrlBackspace.defaultPrevented).toBe(false);

        pressKey("/");

        expect(usage.querySelector(".usage-search")).toBe(null);

        pressKey("/");
        "asst".split("").forEach((key) => pressKey(key));

        expect(passThrough.classList.contains("usage-filtered-out")).toBe(false);
        expect(searchSelected.classList.contains("usage-filtered-out")).toBe(true);

        pressKey("Escape");
    });

    test('does not leak unmatched usage keys to normal mode', async () => {
        const usage = document.getElementById("sk_usage");
        postFrontendMessage({
            action: "showUsage",
            metas: [
                {word: "cq", annotation: "Copy query string", feature_group: 7}
            ]
        });
        await waitUntil(() => usage.querySelector(".usage-entry"));

        const event = pressKey("s");

        expect(event.defaultPrevented).toBe(true);
        expect(usage.style).not.toHaveProperty('display', 'none');
    });
});
