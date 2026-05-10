const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../src/pages/markdown.html'), 'utf8');
import { waitForEvent } from '../utils';

describe('markdown viewer', () => {
    let dispatchSKEvent, createClipboard, createInsert, createNormal,
        createHints, createVisual, createFront, createAPI, createDefaultMappings;

    let normal, clipboard, api, Mode;

    beforeAll(async () => {
        const navigator = { userAgent: "Chrome", platform: "Mac" };
        Object.defineProperty(window, 'navigator', {
            value: navigator,
            writable: true
        });

        global.chrome = {
            runtime: {
                getURL: jest.fn(),
                sendMessage: jest.fn(),
                onMessage: {
                    addListener: jest.fn()
                }
            },
            storage: {
                local: {
                    get: jest.fn()
                }
            }
        }
        global.DOMRect = jest.fn();
        window.focus = jest.fn();
        document.documentElement.innerHTML = html.toString();

        dispatchSKEvent = require('src/content_scripts/common/runtime.js').dispatchSKEvent;
        createClipboard = require('src/content_scripts/common/clipboard.js').default;
        Mode = require('src/content_scripts/common/mode.js').default;
        createInsert = require('src/content_scripts/common/insert.js').default;
        createNormal = require('src/content_scripts/common/normal.js').default;
        createHints = require('src/content_scripts/common/hints.js').default;
        createVisual = require('src/content_scripts/common/visual.js').default;
        createFront = require('src/content_scripts/front.js').default;
        createAPI = require('src/content_scripts/common/api.js').default;
        createDefaultMappings = require('src/content_scripts/common/default.js').default;
        require('src/content_scripts/markdown');

        Mode.init();
        document.scrollingElement = {};
        clipboard = createClipboard();
        const insert = createInsert();
        normal = createNormal(insert);
        normal.enter();
        const hints = createHints(insert, normal);
        const visual = createVisual(clipboard, hints);
        const front = createFront(insert, normal, hints, visual);
        api = createAPI(clipboard, insert, normal, hints, visual, front, {});
        createDefaultMappings(api, clipboard, insert, normal, hints, visual, front);
    });

    test("verify local shortcuts for markdown preview", async () => {
        document.execCommand = jest.fn();

        expect(normal.mappings.find('of')).toBe(undefined);
        expect(document.execCommand).toHaveBeenCalledTimes(0);

        await waitForEvent(document, "surfingkeys:defaultSettingsLoaded", () => {
            return true;
        }, () => {
            dispatchSKEvent('defaultSettingsLoaded', {normal, api});
        });

        expect(normal.mappings.find('of').meta.word).toBe('of');
        expect(document.execCommand).toHaveBeenCalledTimes(1);
    });

    test("render markdown from clipboard", async () => {
        jest.spyOn(clipboard, 'read').mockImplementationOnce((onReady) => {
            onReady({data: "* [github](https://github.com)\n* [google](https://google.com)"});
        });
        await waitForEvent(document, "surfingkeys:defaultSettingsLoaded", () => {
            return true;
        }, () => {
            dispatchSKEvent('defaultSettingsLoaded', {normal, api});
        });
        const links = document.querySelectorAll("a");
        expect(links.length).toBe(2);
        expect(links[0].href).toBe("https://github.com/");
    });

    test("keep dense link hints on target rows", async () => {
        document.body.innerHTML = Array.from({ length: 35 }, (_, i) => {
            return `<a href="https://example.com/${i}">link${i}</a>`;
        }).join("");

        const links = document.querySelectorAll("a");
        links.forEach((l, i) => {
            l.style.opacity = "1";
            const rect = { width: 100, height: 10, top: 18 * i, left: 0, bottom: 18 * i + 10, right: 100 };
            Object.defineProperty(l, "getBoundingClientRect", {
                value: jest.fn(() => rect),
                configurable: true
            });
            Object.defineProperty(l, "getClientRects", {
                value: jest.fn(() => []),
                configurable: true
            });
        });
        document.scrollingElement.clientTop = 0;
        document.scrollingElement.clientLeft = 0;
        document.scrollingElement.scrollTop = 0;
        document.scrollingElement.scrollLeft = 0;
        document.elementFromPoint = jest.fn(() => {
            return null;
        });
        expect(document.querySelector("div.surfingkeys_hints_host")).toBe(null);

        const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
        const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
        const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
        HTMLElement.prototype.getBoundingClientRect = jest.fn(function() {
            const top = parseFloat(this.style.top) || 0;
            const left = parseFloat(this.style.left) || 0;
            return { width: 8, height: 10, top, left, bottom: top + 10, right: left + 8 };
        });
        Object.defineProperty(HTMLElement.prototype, "offsetTop", {
            get() {
                return parseFloat(this.style.top) || 0;
            },
            configurable: true
        });
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            get() {
                return parseFloat(this.style.height) || 10;
            },
            configurable: true
        });
        try {
            normal.enter(undefined, true);
            document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'e'}));
            const hint_labels = document.querySelector("div.surfingkeys_hints_host").shadowRoot.querySelectorAll("section>div");
            const denseHints = Array.from(hint_labels).filter((hint) => {
                const href = hint.link && hint.link.getAttribute && hint.link.getAttribute("href");
                return href && href.startsWith("https://example.com/");
            });
            expect(denseHints.length).toBe(35);
            expect(denseHints.some((hint) => hint.label === "SQ")).toBe(true);
            expect(denseHints.some((hint) => hint.label === "SW")).toBe(true);
            denseHints.forEach((hint) => {
                const targetIndex = Number(hint.link.getAttribute("href").match(/\/(\d+)$/)[1]);
                expect(hint.style.top).toBe(`${18 * targetIndex}px`);
            });
        } finally {
            HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
            Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
        }
    });
});
