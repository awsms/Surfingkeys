describe('normal mode', () => {
    let insert, normal, runtime, Mode;

    beforeAll(async () => {
        global.chrome = {
            runtime: {
                getURL: jest.fn((path) => path),
                sendMessage: jest.fn(),
                onMessage: {
                    addListener: jest.fn()
                }
            },
            extension: {
                getURL: jest.fn()
            }
        }
        global.DOMRect = jest.fn();

        runtime = require('src/content_scripts/common/runtime.js').runtime;
        Mode = require('src/content_scripts/common/mode.js').default;
        Mode.init();
        insert = require('src/content_scripts/common/insert.js').default();
        normal = require('src/content_scripts/common/normal.js').default(insert);
    });

    test("normal /", async () => {
        normal.enter();
        await new Promise((r) => {
            document.addEventListener("surfingkeys:front", function(evt) {
                if (evt.detail.length && evt.detail[0] === "openFinder") {
                    r(evt);
                }
            });
            document.body.dispatchEvent(new KeyboardEvent('keydown',{'key':'/'}));
        });
    });

    test("normal enter", async () => {
        normal.captureElement = jest.fn();
        normal.enter();
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'y'}));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'G'}));
        expect(normal.captureElement).toHaveBeenCalledTimes(1);

        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'y'}));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'G'}));
        expect(normal.captureElement).toHaveBeenCalledTimes(2);
    });

    test("normal once", async () => {
        normal.captureElement = jest.fn();
        normal.once();
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'y'}));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'G'}));
        expect(normal.captureElement).toHaveBeenCalledTimes(1);

        // the 2nd yG won't trigger action.
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'y'}));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {'key': 'G'}));
        expect(normal.captureElement).toHaveBeenCalledTimes(1);
    });

    test("normal suppresses unmatched keys after a mapped prefix", async () => {
        normal.enter();
        normal.mappings.add(",x", {
            annotation: "test prefix",
            feature_group: 0,
            code: jest.fn()
        });
        const pageListener = jest.fn();
        document.body.addEventListener("keydown", pageListener);

        const comma = new KeyboardEvent("keydown", { key: ",", bubbles: true, cancelable: true });
        const shift = new KeyboardEvent("keydown", { key: "Shift", keyCode: 16, bubbles: true, cancelable: true });
        const question = new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, cancelable: true });

        document.body.dispatchEvent(comma);
        document.body.dispatchEvent(shift);
        document.body.dispatchEvent(question);

        document.body.removeEventListener("keydown", pageListener);
        normal.mappings.remove(",x");

        expect(comma.defaultPrevented).toBe(true);
        expect(shift.defaultPrevented).toBe(false);
        expect(question.defaultPrevented).toBe(true);
        expect(pageListener).toHaveBeenCalledTimes(1);
        expect(pageListener.mock.calls[0][0].key).toBe("Shift");
    });

    test("normal mouse up", async () => {
        runtime.conf.mouseSelectToQuery = [ "http://localhost" ];
        await new Promise((r) => {
            document.addEventListener("surfingkeys:front", function(evt) {
                if (evt.detail.length && evt.detail[0] === "querySelectedWord") {
                    r(evt);
                }
            });
            document.body.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0
            }));
        });
    });
});
