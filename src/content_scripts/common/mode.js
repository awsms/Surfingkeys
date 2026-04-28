import {
    listElements,
    isInUIFrame,
    reportIssue,
    isElementDrawn,
} from './utils.js';
import { RUNTIME, dispatchSKEvent, runtime } from './runtime.js';
import KeyboardUtils from './keyboardUtils';

var mode_stack = [];

const Mode = function(name, statusLine) {
    this.name = name;
    this.statusLine = statusLine;
    this.eventListeners = {};
    this.addEventListener = function(evtName, handler) {
        this.eventListeners[evtName] = handler;

        if (!_listenedEvents.hasOwnProperty(evtName)) {
            _listenedEvents[evtName] = function(event) {
                handleStack(evtName, event);
            };
            window.addEventListener(evtName, _listenedEvents[evtName], true);
        }

        return this;
    };

    this.enter = function(priority, reentrant) {
        var pos = mode_stack.indexOf(this);
        if (!this.priority) {
            this.priority = priority || mode_stack.length;
        }

        if (pos === -1) {
            // push this mode into stack
            mode_stack.unshift(this);
        } else if (pos > 0) {
            if (reentrant) {
                // pop up all the modes over this
                mode_stack = mode_stack.slice(pos);
            } else {
                var modeList = mode_stack.map(function(u) { return u.name; }).join(',');
                reportIssue("Mode {0} pushed into mode stack again.".format(this.name), "Modes in stack: {0}".format(modeList));
            }
            // stackTrace();
        }

        mode_stack.sort(function(a,b) {
            return (a.priority < b.priority) ? 1 : ((b.priority < a.priority) ? -1 : 0);
        } );
        // var modes = mode_stack.map(function(m) {
        // return m.name;
        // }).join('->');
        // console.log('enter {0}, {1}'.format(this.name, modes));

        this.onEnter && this.onEnter();

        Mode.showStatus();
        return pos;
    };

    this.exit = function(peek) {
        var pos = mode_stack.indexOf(this);
        if (pos !== -1) {
            this.priority = 0;
            if (peek) {
                // for peek exit, we need push modes above this back to the stack.
                mode_stack.splice(pos, 1);
            } else {
                // otherwise, we just pop all modes above this inclusively.
                pos++;
                var popup = mode_stack.slice(0, pos);
                mode_stack = mode_stack.slice(pos);
            }

            // var modes = mode_stack.map(function(m) {
            // return m.name;
            // }).join('->');
            // console.log('exit {0}, {1}'.format(this.name, modes));
        }
        Mode.showStatus();
        this.onExit && this.onExit(pos);
    };
};

Mode.getCurrent = () => {
    return mode_stack[0];
};

Mode.specialKeys = {
    "<Alt-s>": ["<Alt-s>"],       // hotkey to toggleBlocklist
    "<Esc>": ["<Esc>"]
};

Mode.isSpecialKeyOf = function(specialKey, keyToCheck) {
    return (-1 !== Mode.specialKeys[specialKey].indexOf(KeyboardUtils.decodeKeystroke(keyToCheck)));
};

// Enable to stop propagation of the event whose keydown handler has been triggered
// Why we need this?
// For example, there is keyup event handler of `s` on some site to set focus on an input box,
// Now user presses `sg` to search with google, Surfingkeys got `s` and triggered its keydown handler.
// But keyup handler of the site also got triggered, then `g` was swallowed by the input box.
// This setting now is only turned on for Normal.
// For Hints, we could not turn on it, as keyup should be propagated to Normal
// to stop scrolling when holding a key.
var keysNeedKeyupSuppressed = [];
Mode.suppressKeyUp = function(keyCode) {
    if (keysNeedKeyupSuppressed.indexOf(keyCode) === -1) {
        keysNeedKeyupSuppressed.push(keyCode);
    }
};
var keysNeedKeypressSuppressed = [];
Mode.suppressKeyPress = function(keyCode) {
    if (keysNeedKeypressSuppressed.indexOf(keyCode) === -1) {
        keysNeedKeypressSuppressed.push(keyCode);
    }
};

let keyDebugSeq = 0;
let keyDebugLocalStorageFlag;

function safeLocalStorageFlag() {
    if (keyDebugLocalStorageFlag !== undefined) {
        return keyDebugLocalStorageFlag;
    }
    try {
        keyDebugLocalStorageFlag = window.localStorage
            && ["1", "true", "yes"].indexOf(window.localStorage.getItem("surfingkeysDebugKeystrokes")) !== -1;
    } catch (e) {
        keyDebugLocalStorageFlag = false;
    }
    return keyDebugLocalStorageFlag;
}

function isKeyDebugEnabled() {
    return !!runtime.conf.debugKeystrokes
        || !!window.__surfingkeysDebugKeystrokes
        || safeLocalStorageFlag();
}

function decodeWord(word) {
    try {
        return KeyboardUtils.decodeKeystroke(word || "");
    } catch (e) {
        return word || "";
    }
}

function describeElement(element) {
    if (!element) {
        return "";
    }
    if (element === window) {
        return "window";
    }
    if (element === document) {
        return "document";
    }
    if (typeof(Node) !== "undefined" && element.nodeType === Node.TEXT_NODE) {
        element = element.parentElement;
    }
    if (!element || !element.localName) {
        return String(element);
    }

    var parts = [element.localName];
    if (element.id) {
        parts.push("#" + element.id);
    }
    if (element.classList && element.classList.length) {
        parts.push("." + Array.from(element.classList).slice(0, 4).join("."));
    }
    ["type", "name", "role", "aria-label", "data-testid", "contenteditable"].forEach(function(attr) {
        var value = element.getAttribute && element.getAttribute(attr);
        if (value) {
            parts.push("[{0}=\"{1}\"]".format(attr, String(value).slice(0, 80)));
        }
    });
    return parts.join("");
}

function describeMapNode(node, root) {
    if (!node) {
        return null;
    }
    var info = {
        position: node === root ? "root" : "partial",
        stem: node.stem ? decodeWord(node.stem) : ""
    };
    if (node.meta) {
        info.matchedWord = decodeWord(node.meta.word);
        info.annotation = node.meta.annotation;
        info.codeArity = node.meta.code && node.meta.code.length;
        info.hasStopPropagationOverride = !!node.meta.stopPropagation;
    }
    if (node !== root && node.getWords) {
        info.candidates = node.getWords("", true).slice(0, 12).map(decodeWord);
    }
    return info;
}

function describeMode(mode) {
    if (!mode) {
        return null;
    }
    return {
        name: mode.name,
        priority: mode.priority || 0,
        pendingMap: !!mode.pendingMap,
        repeats: mode.repeats,
        mapNode: describeMapNode(mode.map_node, mode.mappings)
    };
}

function describeModeStack() {
    return mode_stack.map(describeMode);
}

function describeEvent(event) {
    return {
        type: event.type,
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        skKeyName: event.sk_keyName ? decodeWord(event.sk_keyName) : "",
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        isTrusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        skStopPropagation: !!event.sk_stopPropagation,
        skSuppressed: !!event.sk_suppressed,
        target: describeElement(event.target),
        activeElement: describeElement(document.activeElement),
        eventPhase: event.eventPhase
    };
}

Mode.isKeyDebugEnabled = isKeyDebugEnabled;

Mode.describeElement = describeElement;

Mode.debugKey = function(event, stage, details) {
    if (!isKeyDebugEnabled()) {
        return;
    }
    if (!event.sk_debugTrace) {
        event.sk_debugTrace = [];
        event.sk_debugId = ++keyDebugSeq;
    }
    event.sk_debugTrace.push(Object.assign({
        stage: stage,
        stopped: !!event.sk_stopPropagation,
        suppressed: !!event.sk_suppressed
    }, details || {}));
};

Mode.flushKeyDebug = function(event, details) {
    if (!isKeyDebugEnabled() || !event.sk_debugTrace) {
        return;
    }
    var summary = describeEvent(event);
    var key = summary.skKeyName || summary.key || summary.code || "";
    var modes = mode_stack.map(function(m) { return m.name; }).join(">");
    var handled = summary.skStopPropagation ? "handled" : "passed";
    var title = "[SurfingKeys key #{0}] {1} {2} {3} modes={4}".format(
        event.sk_debugId,
        summary.type,
        key,
        handled,
        modes || "(empty)"
    );
    if (console.groupCollapsed) {
        console.groupCollapsed(title);
    } else {
        console.log(title);
    }
    console.log("event", summary);
    console.log("modeStack", describeModeStack());
    if (details) {
        console.log("outcome", details);
    }
    if (console.table) {
        console.table(event.sk_debugTrace);
    } else {
        console.log("trace", event.sk_debugTrace);
    }
    if (console.groupEnd) {
        console.groupEnd();
    }
};

function onAfterHandler(mode, event) {
    if (event.sk_stopPropagation) {
        Mode.debugKey(event, "event.stop", {
            mode: mode && mode.name,
            reason: "sk_stopPropagation set; calling stopImmediatePropagation and preventDefault"
        });
        event.stopImmediatePropagation();
        event.preventDefault();
    }
}

function handleStack(eventName, event, cb) {
    Mode.debugKey(event, "stack.start", {
        eventName: eventName,
        modeStack: describeModeStack()
    });
    for (var i = 0; i < mode_stack.length && !event.sk_stopPropagation; i++) {
        var m = mode_stack[i];
        if (event.sk_suppressed) {
            Mode.debugKey(event, "mode.skip", {
                mode: m.name,
                eventName: eventName,
                reason: "event.sk_suppressed is already set"
            });
        } else if (m.eventListeners.hasOwnProperty(eventName)) {
            var handler = m.eventListeners[eventName];
            Mode.debugKey(event, "mode.before", {
                mode: m.name,
                eventName: eventName,
                modeState: describeMode(m)
            });
            handler(event);
            Mode.debugKey(event, "mode.after", {
                mode: m.name,
                eventName: eventName,
                modeState: describeMode(m),
                skStopPropagation: !!event.sk_stopPropagation,
                skSuppressed: !!event.sk_suppressed,
                defaultPrevented: event.defaultPrevented
            });
            onAfterHandler(m, event);
        } else {
            Mode.debugKey(event, "mode.skip", {
                mode: m.name,
                eventName: eventName,
                reason: "mode has no listener for event"
            });
        }
        if (m.name === "Disabled") {
            Mode.debugKey(event, "stack.break", {
                mode: m.name,
                reason: "Disabled mode stops SurfingKeys mode traversal"
            });
            break;
        }
        cb && cb(m);
    }
    Mode.debugKey(event, "stack.end", {
        eventName: eventName,
        skStopPropagation: !!event.sk_stopPropagation,
        skSuppressed: !!event.sk_suppressed
    });
}

let eventListenerBeats = 0;
let _globalKeyInterceptor = null;
var suppressScrollEvent = 0, _listenedEvents = {
    "sentinel": (event) => {
        eventListenerBeats ++;
    },
    "keydown": function (event) {
        event.sk_keyName = KeyboardUtils.getKeyChar(event);
        Mode.debugKey(event, "keydown.start", {
            event: describeEvent(event)
        });
        if (_globalKeyInterceptor && _globalKeyInterceptor(event)) {
            Mode.debugKey(event, "keydown.globalInterceptor", {
                reason: "global key interceptor handled event"
            });
            onAfterHandler(null, event);
            Mode.flushKeyDebug(event, {
                reason: "global key interceptor handled event",
                skStopPropagation: !!event.sk_stopPropagation
            });
            return;
        }
        if (mode_stack.length === 0 && window !== top) {
            // automatically boots iframe on demand
            Mode.debugKey(event, "keydown.deferIframeBoot", {
                reason: "mode stack is empty in iframe; booting iframe before handling key"
            });
            dispatchSKEvent('iframeBoot');
            document.addEventListener("surfingkeys:userSettingsLoaded", () => {
                // proceed to handle the key event after userSettingsLoaded.
                Mode.debugKey(event, "keydown.resumeIframeBoot", {
                    reason: "iframe user settings loaded; resuming key handling"
                });
                handleStack("keydown", event);
                Mode.flushKeyDebug(event, {
                    reason: "iframe boot completed",
                    skStopPropagation: !!event.sk_stopPropagation,
                    skSuppressed: !!event.sk_suppressed
                });
            }, {once: true});
            Mode.flushKeyDebug(event, {
                reason: "deferred while iframe boots",
                skStopPropagation: !!event.sk_stopPropagation,
                skSuppressed: !!event.sk_suppressed
            });
            return;
        }
        handleStack("keydown", event);
        Mode.flushKeyDebug(event, {
            reason: "keydown complete",
            skStopPropagation: !!event.sk_stopPropagation,
            skSuppressed: !!event.sk_suppressed,
            defaultPrevented: event.defaultPrevented
        });
    },
    "keyup": function (event) {
        if (Mode.isKeyDebugEnabled()) {
            event.sk_keyName = KeyboardUtils.getKeyChar(event);
        }
        Mode.debugKey(event, "keyup.start", {
            event: describeEvent(event),
            keysNeedKeyupSuppressed: keysNeedKeyupSuppressed.slice()
        });
        handleStack("keyup", event, function (m) {
            var i = keysNeedKeyupSuppressed.indexOf(event.keyCode);
            if (i !== -1) {
                Mode.debugKey(event, "keyup.suppress", {
                    mode: m.name,
                    keyCode: event.keyCode,
                    reason: "matching keydown was suppressed"
                });
                event.stopImmediatePropagation();
                keysNeedKeyupSuppressed.splice(i, 1);
            }
        });
        Mode.flushKeyDebug(event, {
            reason: "keyup complete",
            skStopPropagation: !!event.sk_stopPropagation,
            skSuppressed: !!event.sk_suppressed,
            remainingSuppressedKeyups: keysNeedKeyupSuppressed.slice()
        });
    },
    "keypress": function(event) {
        if (Mode.isKeyDebugEnabled()) {
            event.sk_keyName = KeyboardUtils.getKeyChar(event);
        }
        Mode.debugKey(event, "keypress.start", {
            event: describeEvent(event),
            keysNeedKeypressSuppressed: keysNeedKeypressSuppressed.slice()
        });
        var i = keysNeedKeypressSuppressed.indexOf(event.keyCode);
        if (i !== -1) {
            Mode.debugKey(event, "keypress.suppress", {
                keyCode: event.keyCode,
                reason: "matching keydown was suppressed"
            });
            event.stopImmediatePropagation();
            event.preventDefault();
            keysNeedKeypressSuppressed.splice(i, 1);
        }
        Mode.flushKeyDebug(event, {
            reason: "keypress complete",
            remainingSuppressedKeypresses: keysNeedKeypressSuppressed.slice()
        });
    },
    "scroll": function (event) {
        handleStack("scroll", event);
        if (suppressScrollEvent > 0) {
            event.stopImmediatePropagation();
            event.preventDefault();
            suppressScrollEvent--;
        }
    }
};

function init(cb) {
    mode_stack = [];
    for (var evtName in _listenedEvents) {
        window.addEventListener(evtName, _listenedEvents[evtName], true);
    }
    cb && cb();
}

Mode.hasScroll = function (el, direction, barSize) {
    const style = window.getComputedStyle(el);
    if (!style) {
        return false;
    }
    const overflow = (direction === 'y') ? style.overflowY : style.overflowX;
    if (!['auto', 'scroll', 'overlay'].includes(overflow)) {
        return false;
    }

    var offset = (direction === 'y') ? ['scrollTop', 'height'] : ['scrollLeft', 'width'];
    var result = el[offset[0]];

    if (result < barSize) {
        // set scroll offset to barSize, and verify if we can get scroll offset as barSize
        var originOffset = el[offset[0]];
        el[offset[0]] = el.getBoundingClientRect()[offset[1]];
        result = el[offset[0]];
        if (result !== originOffset) {
            // this is valid for some site such as http://mail.live.com/
            suppressScrollEvent++;
        }
        el[offset[0]] = originOffset;
    }
    return result >= barSize;
};

Mode.getScrollableElements = function () {
    var nodes = listElements(document.body, NodeFilter.SHOW_ELEMENT, function(n) {
        return isElementDrawn(n) && ((Mode.hasScroll(n, 'y', 16) && n.scrollHeight > 200 ) || (Mode.hasScroll(n, 'x', 16) && n.scrollWidth > 200));
    });
    nodes.sort(function(a, b) {
        if (b.contains(a)) return 1;
        else if (a.contains(b)) return -1;
        return b.scrollHeight * b.scrollWidth - a.scrollHeight * a.scrollWidth;
    });
    // document.scrollingElement will be null when document.body.tagName === "FRAMESET", for example http://www.knoppix.org/
    if (document.scrollingElement && (document.scrollingElement.scrollHeight > window.innerHeight
        || document.scrollingElement.scrollWidth > window.innerWidth)) {
        nodes.unshift(document.scrollingElement);
    }
    return nodes;
};

Mode.init = (cb)=> {
    // For blank page in frames, we defer init to page loaded
    // as document.write will clear added eventListeners.
    if (window.location.href === "about:blank" && window.frameElement &&
        (!document.body || document.body.childElementCount === 0)) {
        window.frameElement.addEventListener("load", function(evt) {
            try {
                init(cb);
            } catch (e) {
                console.log("Error on blank iframe loaded: " + e);
            }
        });
    } else {
        init(cb);
    }
};


Mode.showStatus = function() {
    if (document.hasFocus() && mode_stack.length) {
        var cm = mode_stack[0];
        var sl = cm.statusLine || (runtime.conf.showModeStatus ? cm.name : "");
        if (sl !== "" && window !== top && !isInUIFrame()) {
            var pathname = window.location.pathname.split('/');
            if (pathname.length) {
                sl += " - frame: " + pathname[pathname.length - 1];
            }
        }
        dispatchSKEvent("front", ['showStatus', [sl]]);
    }
};

Mode.finish = function (mode) {
    var ret = false;
    if (mode.map_node !== mode.mappings || mode.pendingMap != null || mode.repeats) {
        mode.map_node = mode.mappings;
        mode.pendingMap = null;
        mode.isTrustedEvent && dispatchSKEvent("front", ['hideKeystroke']);
        if (mode.repeats) {
            mode.repeats = "";
        }
        ret = true;
    }
    return ret;
};

Mode.handleMapKey = function(event, onNoMatched) {
    var thisMode = this,
        key = event.sk_keyName;
    this.isTrustedEvent = this.__trust_all_events__ || event.isTrusted;
    Mode.debugKey(event, "map.start", {
        mode: thisMode.name,
        key: decodeWord(key),
        isTrustedEvent: !!this.isTrustedEvent,
        mapNode: describeMapNode(this.map_node, this.mappings),
        pendingMap: !!this.pendingMap,
        repeats: this.repeats
    });

    var isEscKey = Mode.isSpecialKeyOf("<Esc>", key);
    if (isEscKey) {
        key = KeyboardUtils.encodeKeystroke("<Esc>");
        Mode.debugKey(event, "map.normalize", {
            mode: thisMode.name,
            reason: "key matched <Esc> special key",
            normalizedKey: decodeWord(key)
        });
    }

    var actionDone = false;
    if (isEscKey && Mode.finish(this)) {
        event.sk_stopPropagation = true;
        event.sk_suppressed = true;
        actionDone = true;
        Mode.debugKey(event, "map.finishEsc", {
            mode: thisMode.name,
            reason: "<Esc> cancelled pending mapping/repeats",
            skStopPropagation: !!event.sk_stopPropagation,
            skSuppressed: !!event.sk_suppressed
        });
    } else if (this.pendingMap) {
        this.setLastKeys && this.setLastKeys(this.map_node.meta.word + key);
        var pf = this.pendingMap.bind(this);
        event.sk_stopPropagation = (!this.map_node.meta.stopPropagation
            || this.map_node.meta.stopPropagation(key));
        Mode.debugKey(event, "map.pendingArgument", {
            mode: thisMode.name,
            key: decodeWord(key),
            pendingWord: this.map_node.meta && decodeWord(this.map_node.meta.word),
            annotation: this.map_node.meta && this.map_node.meta.annotation,
            hasStopPropagationOverride: !!(this.map_node.meta && this.map_node.meta.stopPropagation),
            skStopPropagation: !!event.sk_stopPropagation
        });
        pf(key);
        actionDone = Mode.finish(thisMode);
        Mode.debugKey(event, "map.pendingDone", {
            mode: thisMode.name,
            actionDone: actionDone,
            mapNode: describeMapNode(this.map_node, this.mappings)
        });
    } else if (this.repeats !== undefined &&
        this.map_node === this.mappings &&
        runtime.conf.digitForRepeat &&
        (key >= "1" || (this.repeats !== "" && key >= "0")) && key <= "9" &&
        this.map_node.getWords().length > 0
    ) {
        // reset only after target action executed or cancelled
        this.repeats += key;
        this.isTrustedEvent && dispatchSKEvent("front", ['showKeystroke', key, this]);
        event.sk_stopPropagation = true;
        Mode.debugKey(event, "map.repeatDigit", {
            mode: thisMode.name,
            key: decodeWord(key),
            repeats: this.repeats,
            skStopPropagation: !!event.sk_stopPropagation
        });
    } else {
        var last = this.map_node;
        this.map_node = this.map_node.find(key);
        if (!this.map_node) {
            Mode.debugKey(event, "map.noMatch", {
                mode: thisMode.name,
                key: decodeWord(key),
                previousNode: describeMapNode(last, this.mappings),
                partialMappingWasActive: last !== this.mappings,
                onNoMatched: !!onNoMatched,
                reason: last !== this.mappings
                    ? "key did not complete any mapping from an active prefix"
                    : "key is not mapped in this mode"
            });
            onNoMatched && onNoMatched(last);
            if (!event.sk_suppressed) {
                event.sk_suppressed = (last !== this.mappings);
            }
            actionDone = Mode.finish(this);
            Mode.debugKey(event, "map.noMatchDone", {
                mode: thisMode.name,
                actionDone: actionDone,
                skSuppressed: !!event.sk_suppressed,
                skStopPropagation: !!event.sk_stopPropagation,
                reason: event.sk_suppressed
                    ? "unmatched key followed a SurfingKeys prefix, so later SurfingKeys modes are skipped"
                    : "unmatched key at mapping root, so page can handle it"
            });
        } else {
            if (this.map_node.meta) {
                var code = this.map_node.meta.code;
                if (code.length) {
                    // bound function needs arguments
                    this.pendingMap = code;
                    this.isTrustedEvent && dispatchSKEvent("front", ['showKeystroke', key, this]);
                    event.sk_stopPropagation = true;
                    Mode.debugKey(event, "map.matchNeedsArgument", {
                        mode: thisMode.name,
                        key: decodeWord(key),
                        matchedWord: decodeWord(this.map_node.meta.word),
                        annotation: this.map_node.meta.annotation,
                        codeArity: code.length,
                        reason: "mapping function expects the next key as an argument",
                        skStopPropagation: !!event.sk_stopPropagation
                    });
                } else {
                    this.setLastKeys && this.setLastKeys(this.map_node.meta.word);
                    RUNTIME.repeats = parseInt(this.repeats) || 1;
                    event.sk_stopPropagation = (!this.map_node.meta.stopPropagation
                        || this.map_node.meta.stopPropagation(key));
                    Mode.debugKey(event, "map.match", {
                        mode: thisMode.name,
                        key: decodeWord(key),
                        matchedWord: decodeWord(this.map_node.meta.word),
                        annotation: this.map_node.meta.annotation,
                        repeats: RUNTIME.repeats,
                        hasStopPropagationOverride: !!this.map_node.meta.stopPropagation,
                        skStopPropagation: !!event.sk_stopPropagation,
                        reason: event.sk_stopPropagation
                            ? "mapping matched and will prevent page handling"
                            : "mapping matched but stopPropagation override allowed page handling"
                    });
                    if (!this.map_node.meta.repeatNoThrottling && RUNTIME.repeats > runtime.conf.repeatThreshold) {
                        Mode.debugKey(event, "map.repeatConfirm", {
                            mode: thisMode.name,
                            repeats: RUNTIME.repeats,
                            repeatThreshold: runtime.conf.repeatThreshold
                        });
                        dispatchSKEvent("front", ['showDialog', `Do you really want to repeat this action (${this.map_node.meta.annotation}) ${RUNTIME.repeats} times?`, () => {
                            while(RUNTIME.repeats > 0) {
                                code();
                                RUNTIME.repeats--;
                            }
                        }]);
                    } else {
                        while(RUNTIME.repeats > 0) {
                            code();
                            RUNTIME.repeats--;
                        }
                    }
                    actionDone = Mode.finish(thisMode);
                    Mode.debugKey(event, "map.matchDone", {
                        mode: thisMode.name,
                        actionDone: actionDone,
                        mapNode: describeMapNode(this.map_node, this.mappings),
                        skStopPropagation: !!event.sk_stopPropagation
                    });
                }
            } else {
                this.isTrustedEvent && dispatchSKEvent("front", ['showKeystroke', key, this]);
                event.sk_stopPropagation = true;
                Mode.debugKey(event, "map.partial", {
                    mode: thisMode.name,
                    key: decodeWord(key),
                    mapNode: describeMapNode(this.map_node, this.mappings),
                    reason: "key is a prefix of one or more mappings; waiting for next key",
                    skStopPropagation: !!event.sk_stopPropagation
                });
            }
        }
    }
    Mode.debugKey(event, "map.end", {
        mode: thisMode.name,
        actionDone: actionDone,
        skStopPropagation: !!event.sk_stopPropagation,
        skSuppressed: !!event.sk_suppressed,
        mapNode: describeMapNode(this.map_node, this.mappings),
        pendingMap: !!this.pendingMap,
        repeats: this.repeats
    });
    return actionDone;
};

Mode.checkEventListener = (onMissing) => {
    const previousState = eventListenerBeats;
    window.dispatchEvent(new CustomEvent("sentinel"))
    if (previousState === eventListenerBeats) {
        init();
        onMissing();
    }
};

Mode.setGlobalKeyInterceptor = (fn) => {
    _globalKeyInterceptor = fn;
};

export default Mode;
