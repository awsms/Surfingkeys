import { RUNTIME, dispatchSKEvent, runtime } from './runtime.js';
import KeyboardUtils from './keyboardUtils';
import {
    actionWithSelectionPreserved,
    getBrowserName,
    getCssSelectorsOfEditable,
    getLargeElements,
    getRealEdit,
    getTextNodePos,
    getWordUnderCursor,
    htmlEncode,
    setSanitizedContent,
    showBanner,
    showPopup,
    tabOpenLink,
    toggleQuote,
} from './utils.js';

export default function(api, clipboard, insert, normal, hints, visual, front, browser) {
    const {
        addSearchAlias,
        cmap,
        map,
        mapWithPrefix,
        mapkey,
        mapkeyWithPrefix,
        imapkey,
        readText,
        vmapkey,
        vmapkeyWithPrefix,
        searchSelectedWith,
    } = api;

    mapkeyWithPrefix("[", "[", '#1Click on the previous link on current page', hints.previousPage);
    mapkeyWithPrefix("]", "]", '#1Click on the next link on current page', hints.nextPage);
    mapkey('T', '#3Choose a tab', function() {
        front.chooseTab();
    });
    mapkeyWithPrefix(";", "G", '#3Group this tab', function() {
        front.groupTab();
    });
    mapkey('?', '#0Show usage', function() {
        front.showUsage();
    });
    mapkey('Q', '#8Open omnibar for word translation', function() {
        front.openOmniquery({query: getWordUnderCursor(), style: "opacity: 0.8;"});
    });
    imapkey("<Ctrl-'>", '#15Toggle quotes in an input element', toggleQuote);
    function openVim(useNeovim) {
        var element = getRealEdit();
        element.blur();
        insert.exit();
        front.showEditor(element, null, null, useNeovim);
    }
    imapkey('<Ctrl-i>', '#15Open vim editor for current input', function() {
        openVim(false);
    });
    const browserName = getBrowserName();
    if (browserName === "Chrome") {
        imapkey('<Ctrl-Alt-i>', '#15Open neovim for current input', function() {
            openVim(true);
        });
        mapkeyWithPrefix(";", "s", 'Toggle PDF viewer from SurfingKeys', function() {
            var pdfUrl = window.location.href;
            if (pdfUrl.indexOf(chrome.runtime.getURL("/pages/pdf_viewer.html")) === 0) {
                const filePos = window.location.search.indexOf("=") + 1;
                pdfUrl = window.location.search.substr(filePos);
                RUNTIME('updateSettings', {
                    settings: {
                        "noPdfViewer": 1
                    }
                }, (resp) => {
                    window.location.replace(pdfUrl);
                });
            } else {
                if (document.querySelector("EMBED") && document.querySelector("EMBED").getAttribute("type") === "application/pdf") {
                    RUNTIME('updateSettings', {
                        settings: {
                            "noPdfViewer": 0
                        }
                    }, (resp) => {
                        window.location.replace(pdfUrl);
                    });
                } else {
                    RUNTIME('getSettings', {
                        key: 'noPdfViewer'
                    }, function(resp) {
                        const info = resp.settings.noPdfViewer ? "PDF viewer enabled." : "PDF viewer disabled.";
                        RUNTIME('updateSettings', {
                            settings: {
                                "noPdfViewer": !resp.settings.noPdfViewer
                            }
                        }, (r) => {
                            showBanner(info);
                        });
                    });
                }
            }
        });
    }

    mapkeyWithPrefix(";", "ql", '#0Show last action', function() {
        showPopup(htmlEncode(runtime.conf.lastKeys.map(function(k) {
            return KeyboardUtils.decodeKeystroke(k);
        }).join(' → ')));
    }, {repeatIgnore: true});

    mapkeyWithPrefix("g", "i", '#1Go to the first edit box', function() {
        hints.createInputLayer();
    });
    mapkey('i', '#1Go to edit box', function() {
        hints.create(getCssSelectorsOfEditable(), hints.dispatchMouseClick);
    });
    mapkey('I', '#1Go to edit box with vim editor', function() {
        hints.create(getCssSelectorsOfEditable(), function(element) {
            front.showEditor(element);
        });
    });
    mapkey('L', '#1Enter regional Hints mode', function() {
        hints.create(getLargeElements(), (e) => { }, { regionalHints: true });
    });

    mapkeyWithPrefix("z", "v", '#9Enter visual mode, and select whole element', function() {
        visual.toggle("z");
    });
    mapkeyWithPrefix("y", "v", '#7Yank text of an element', function() {
        hints.create(runtime.conf.textAnchorPat, function (element) {
            clipboard.write(element[1] === 0 ? element[0].data.trim() : element[2].trim());
        });
    });
    mapkeyWithPrefix("y", "mv", '#7Yank text of multiple elements', function() {
        var textToYank = [];
        hints.create(runtime.conf.textAnchorPat, function (element) {
            textToYank.push(element[1] === 0 ? element[0].data.trim() : element[2].trim());
            clipboard.write(textToYank.join('\n'));
        }, { multipleHits: true });
    });

    mapkey('V', '#9Restore visual mode', function() {
        visual.restore();
    });
    mapkey('*', '#9Find selected text in current page', function() {
        visual.star();
        visual.toggle();
    });

    vmapkey('<Ctrl-u>', '#9Backward 20 lines', function() {
        visual.feedkeys('20k');
    });
    vmapkey('<Ctrl-d>', '#9Forward 20 lines', function() {
        visual.feedkeys('20j');
    });

    mapkey('m', '#10Add current URL to vim-like marks', normal.addVIMark);
    mapkey("'", '#10Jump to vim-like mark', normal.jumpVIMark);
    mapkey("<Ctrl-'>", '#10Jump to vim-like mark in new tab.', function(mark) {
        normal.jumpVIMark(mark);
    });

    mapkey('w', '#2Switch frames', function() {
        // ensure frontend ready so that ui related actions can be available in iframes.
        dispatchSKEvent('ensureFrontEnd');
        if (window === top) {
            hints.create("iframe", function(element) {
                element.scrollIntoView({
                    behavior: 'auto',
                    block: 'center',
                    inline: 'center'
                });
                normal.highlightElement(element);
                element.contentWindow.focus();
            }).then((hintsTotal) => {
                if (hintsTotal === 0) {
                    normal.rotateFrame();
                }
            });
        } else {
            normal.rotateFrame();
        }
    });

    mapkeyWithPrefix("y", "g", '#7Capture current page', function() {
        front.toggleStatus(false);
        setTimeout(function() {
            RUNTIME('captureVisibleTab', null, function(response) {
                front.toggleStatus(true);
                showPopup("<img src='{0}' />".format(response.dataUrl));
            });
        }, 500);
    });

    mapkeyWithPrefix("g", "u", '#4Go up one path in the URL', function() {
        var pathname = location.pathname;
        if (pathname.length > 1) {
            pathname = pathname.endsWith('/') ? pathname.substr(0, pathname.length - 1) : pathname;
            var last = pathname.lastIndexOf('/'), repeats = RUNTIME.repeats;
            RUNTIME.repeats = 1;
            while (repeats-- > 1) {
                var p = pathname.lastIndexOf('/', last - 1);
                if (p === -1) {
                    break;
                } else {
                    last = p;
                }
            }
            pathname = pathname.substr(0, last);
        }
        window.location.href = location.origin + pathname;
    });

    mapkeyWithPrefix(";", "m", '#1mouse out last element', function() {
        hints.mouseoutLastElement();
    });

    mapkeyWithPrefix(";", "pp", '#7Paste html on current page', function() {
        clipboard.read(function(response) {
            document.documentElement.removeAttributes();
            document.body.removeAttributes();
            setSanitizedContent(document.head, "<title>" + new Date() +" updated by Surfingkeys</title>");
            setSanitizedContent(document.body, response.data);
        });
    });

    function openGoogleTranslate() {
        if (window.getSelection().toString()) {
            searchSelectedWith('https://translate.google.com/?hl=en#auto/en/', false, false, '');
        } else {
            tabOpenLink("https://translate.google.com/translate?js=n&sl=auto&tl=zh-CN&u=" + window.location.href);
        }
    }
    mapkeyWithPrefix(";", "t", 'Translate selected text with google', () => {
        if (chrome.surfingkeys) {
            chrome.surfingkeys.translateCurrentPage();
        } else {
            openGoogleTranslate()
        }
    });
    vmapkey('t', '#9Translate selected text with google', openGoogleTranslate);

    mapkey('O', '#1Open detected links from text', function() {
        hints.create(runtime.conf.clickablePat, function(element) {
            window.location.assign(element[2]);
        }, {statusLine: "Open detected links from text"});
    });

    mapkey(".", '#0Repeat last action', function() {
        // lastKeys in format: <keys in normal mode>[,(<mode name>\t<keys in this mode>)*], examples
        // ['se']
        // ['f', 'Hints\tBA']
        const lastKeys = runtime.conf.lastKeys;
        normal.feedkeys(lastKeys[0]);
        var modeKeys = lastKeys.slice(1);
        for (var i = 0; i < modeKeys.length; i++) {
            var modeKey = modeKeys[i].split('\t');
            if (modeKey[0] === 'Hints') {
                function closureWrapper() {
                    var hintKeys = modeKey[1];
                    return function() {
                        hints.feedkeys(hintKeys);
                    };
                }
                setTimeout(closureWrapper(), 120 + i*100);
            }
        }
    }, {repeatIgnore: true});

    // mapkey('f', '#1Open a link, press SHIFT to flip overlapped hints, hold SPACE to hide hints', function () {
    //     hints.create("", hints.dispatchMouseClick);
    // }, { repeatIgnore: true });

    let linkHintsActive = false;
    const resetLinkHintsActive = () => {
        linkHintsActive = false;
    };
    const originalHintsOnExit = hints.onExit;
    hints.onExit = function (...args) {
        originalHintsOnExit && originalHintsOnExit.apply(this, args);
        resetLinkHintsActive();
    };

    mapkey('e', '#1Open a link, press SHIFT to flip overlapped hints, hold SPACE to hide hints', function () {
        if (linkHintsActive) {
            resetLinkHintsActive();
            api.Normal.feedkeys('<Esc>');
            return;
        }
        linkHintsActive = true;
        hints.create("", hints.dispatchMouseClick, { multipleHits: false });
    }, { repeatIgnore: true });

    mapkey("v", '#9Toggle visual mode', function() {
        visual.toggle();
    }, {repeatIgnore: true});

    mapkey("n", '#9Next found text', function() {
        visual.next(false);
    }, {repeatIgnore: true});

    mapkey("N", '#9Previous found text', function() {
        visual.next(true);
    }, {repeatIgnore: true});

    mapkeyWithPrefix(";", "fs", '#1Display hints to focus scrollable elements', function() {
        hints.create(normal.refreshScrollableElements(), hints.dispatchMouseClick);
    });

    vmapkey("q", '#9Translate word under cursor', function() {
        var w = getWordUnderCursor();
        browser.readText(w);
        var b = visual.getCursorPixelPos();
        front.performInlineQuery(w, {
            top: b.top,
            left: b.left,
            height: b.height,
            width: b.width
        }, function(pos, queryResult) {
            dispatchSKEvent("front", ['showBubble', pos, queryResult, true]);
        });
    });

    function getSentence(textNode, offset) {
        var sentence = "";

        actionWithSelectionPreserved(function(sel) {
            sel.setPosition(textNode, offset);
            sel.modify("extend", "backward", "sentence");
            sel.collapseToStart();
            sel.modify("extend", "forward", "sentence");

            sentence = sel.toString();
        });

        return sentence.replace(/\n/g, '');
    }

    mapkeyWithPrefix("c", "q", '#7Query word with Hints', function() {
        hints.create(runtime.conf.textAnchorPat, function (element) {
            var word = element[2].trim().replace(/[^A-z].*$/, "");
            var b = getTextNodePos(element[0], element[1], element[2].length);
            front.performInlineQuery(word, {
                top: b.top,
                left: b.left,
                height: b.height,
                width: b.width
            }, function (pos, queryResult) {
                dispatchSKEvent("front", ['showBubble', pos, queryResult, false]);
            });
        });
    });


    mapWithPrefix("g", "0", ':feedkeys 99E', 0, "#3Go to the first tab");
    mapWithPrefix("g", "$", ':feedkeys 99R', 0, "#3Go to the last tab");
    mapkeyWithPrefix("z", "r", '#3zoom reset', function() {
        RUNTIME('setZoom', {
            zoomFactor: 0
        });
    });
    mapkeyWithPrefix("z", "i", '#3zoom in', function() {
        RUNTIME('setZoom', {
            zoomFactor: 0.1
        });
    });
    mapkeyWithPrefix("z", "o", '#3zoom out', function() {
        RUNTIME('setZoom', {
            zoomFactor: -0.1
        });
    });

    mapWithPrefix("Z", "Q", ':quit');
    mapkeyWithPrefix("Z", "Z", '#5Save session and quit', function() {
        RUNTIME('createSession', {
            name: 'LAST',
            quitAfterSaved: true
        });
    });
    mapkeyWithPrefix("Z", "R", '#5Restore last session', function() {
        RUNTIME('openSession', {
            name: 'LAST'
        });
    });
    map('u', 'gf');
    mapkeyWithPrefix("a", "f", '#1Open a link in active new tab', function() {
        hints.create("", hints.dispatchMouseClick, {tabbed: true, active: true});
    });
    mapkeyWithPrefix("g", "f", '#1Open a link in non-active new tab', function() {
        hints.create("", hints.dispatchMouseClick, {tabbed: true, active: false});
    });
    mapkeyWithPrefix("c", "f", '#1Open multiple links in a new tab', function() {
        hints.create("", hints.dispatchMouseClick, {multipleHits: true});
    });
    map('C', 'gf');
    // mapkey('<Ctrl-h>', '#1Mouse over elements.', function () {
    //     hints.create("", (element, event) => {
    //         if (chrome.surfingkeys) {
    //             const r = element.getClientRects()[0];
    //             chrome.surfingkeys.sendMouseEvent(2, Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), 0);
    //         } else {
    //             hints.dispatchMouseClick(element, event);
    //         }
    //     }, { mouseEvents: ["mouseover"] });
    // });
    mapkey('<Ctrl-j>', '#1Mouse out elements.', function() {
        hints.create("", hints.dispatchMouseClick, {mouseEvents: ["mouseout"]});
    });
    mapkeyWithPrefix("y", "a", '#7Copy a link URL to the clipboard', function() {
        hints.create('*[href]', function(element) {
            clipboard.write(element.href);
        });
    });
    mapkeyWithPrefix("y", "ma", '#7Copy multiple link URLs to the clipboard', function() {
        var linksToYank = [];
        hints.create('*[href]', function(element) {
            linksToYank.push(element.href);
            clipboard.write(linksToYank.join('\n'));
        }, {multipleHits: true});
    });
    function getTableColumnHeads() {
        var tds = [];
        document.querySelectorAll("table").forEach(function(t) {
            var tr = t.querySelector("tr");
            if (tr) {
                tds.push(...tr.children);
            }
        });
        return tds;
    }
    mapkeyWithPrefix("y", "c", '#7Copy a column of a table', function() {
        hints.create(getTableColumnHeads(), function(element) {
            var column = Array.from(element.closest("table").querySelectorAll("tr")).map(function(tr) {
                return tr.children.length > element.cellIndex ? tr.children[element.cellIndex].innerText : "";
            });
            clipboard.write(column.join("\n"));
        });
    });
    mapkeyWithPrefix("y", "mc", '#7Copy multiple columns of a table', function() {
        var rows = null;
        hints.create(getTableColumnHeads(), function(element) {
            var column = Array.from(element.closest("table").querySelectorAll("tr")).map(function(tr) {
                return tr.children.length > element.cellIndex ? tr.children[element.cellIndex].innerText : "";
            });
            if (!rows) {
                rows = column;
            } else {
                column.forEach(function(c, i) {
                    rows[i] += "\t" + c;
                });
            }
            clipboard.write(rows.join("\n"));
        }, {multipleHits: true});
    });
    mapkeyWithPrefix("y", "q", '#7Copy pre text', function() {
        hints.create("pre", function(element) {
            clipboard.write(element.innerText);
        });
    });

    map('<Ctrl-i>', 'I');
    cmap('<ArrowDown>', '<Ctrl-n>');
    cmap('<ArrowUp>', '<Ctrl-p>');
    mapkey('q', '#1Click on an Image or a button', function() {
        hints.create("img, button", hints.dispatchMouseClick);
    });
    mapkey('<Alt-p>', '#3pin/unpin current tab', function() {
        RUNTIME("togglePinTab");
    });
    mapkey('<Alt-m>', '#3mute/unmute current tab', function() {
        RUNTIME("muteTab");
    });
    mapkey('B', '#4Go one tab history back', function() {
        RUNTIME("historyTab", {backward: true});
    }, {repeatIgnore: true});
    mapkey('F', '#4Go one tab history forward', function() {
        RUNTIME("historyTab", {backward: false});
    }, {repeatIgnore: true});
    mapkey('<Ctrl-6>', '#4Go to last used tab', function() {
        RUNTIME("goToLastTab");
    });
    mapkeyWithPrefix("g", "T", '#4Go to first activated tab', function() {
        RUNTIME("historyTab", {index: 0});
    }, {repeatIgnore: true});
    mapkeyWithPrefix("g", "t", '#4Go to last activated tab', function() {
        RUNTIME("historyTab", {index: -1});
    }, {repeatIgnore: true});
    mapkeyWithPrefix("g", "p", '#4Go to the playing tab', function() {
        RUNTIME('getTabs', { queryInfo: {audible: true}}, response => {
            if (response.tabs?.at(0)) {
                const tab = response.tabs[0]
                RUNTIME('focusTab', {
                    windowId: tab.windowId,
                    tabId: tab.id
                });
            }
        })
    }, { repeatIgnore: true });
    mapkey('S', '#4Go back in history', function() {
        history.go(-1);
    }, {repeatIgnore: true});
    // mapkey('D', '#4Go forward in history', function () {
    //     history.go(1);
    // }, { repeatIgnore: true });
    mapkey('r', '#4Reload the page', function() {
        RUNTIME("reloadTab", { nocache: false });
    });
    mapkeyWithPrefix("o", "i", '#8Open incognito window', function() {
        RUNTIME('openIncognito', {
            url: window.location.href
        });
    });

    mapkey('H', '#8Open opened URL in current tab', function() {
        front.openOmnibar({type: "TabURLs"});
    });
    mapkeyWithPrefix("o", "m", '#8Open URL from vim-like marks', function() {
        front.openOmnibar({type: "VIMarks"});
    });
    mapkey(':', '#8Open commands', function() {
        front.openOmnibar({type: "Commands"});
    });
    mapkey('A', '#8Open llm chat', function() {
        front.openOmnibar({type: "LLMChat"});
    });
    vmapkey('A', '#8Open llm chat', function() {
        const sel = window.getSelection().toString();
        front.openOmnibar({type: "LLMChat", extra: {
            system: sel
        }});
    });
    mapkeyWithPrefix("y", "i", '#7Yank text of an input', function() {
        hints.create("input, textarea, select", function(element) {
            clipboard.write(element.value);
        });
    });
    mapkey('x', '#3Close current tab', function() {
        RUNTIME("closeTab");
    });
    mapkeyWithPrefix(";", "w", '#2Focus top window', function() {
        top.focus();
    });
    mapkeyWithPrefix("c", "c", '#7Open selected link or link from clipboard', function() {
        if (window.getSelection().toString()) {
            tabOpenLink(window.getSelection().toString());
        } else {
            clipboard.read(function(response) {
                tabOpenLink(response.data);
            });
        }
    });
    mapkeyWithPrefix(";", "cq", '#7Clear all URLs in queue to be opened', function() {
        RUNTIME('clearQueueURLs');
    });
    mapkeyWithPrefix("y", "s", "#7Copy current page's source", function() {
        var aa = document.documentElement.cloneNode(true);
        clipboard.write(aa.outerHTML);
    });
    mapkeyWithPrefix("y", "j", "#7Copy current settings", function() {
        RUNTIME('getSettings', {
            key: "RAW"
        }, function(response) {
            clipboard.write(JSON.stringify(response.settings, null, 4));
        });
    });
    mapkeyWithPrefix(";", "pj", "#7Restore settings data from clipboard", function() {
        clipboard.read(function(response) {
            RUNTIME('updateSettings', {
                settings: JSON.parse(response.data.trim())
            });
        });
    });
    mapkeyWithPrefix("y", "t", '#3Duplicate current tab', function() {
        RUNTIME("duplicateTab");
    });
    mapkeyWithPrefix("y", "T", '#3Duplicate current tab in background', function() {
        RUNTIME("duplicateTab", {active: false});
    });
    mapkeyWithPrefix("y", "y", "#7Copy current page's URL", function() {
        var url = window.location.href;
        if (url.indexOf(chrome.runtime.getURL("/pages/pdf_viewer.html")) === 0) {
            const filePos = window.location.search.indexOf("=") + 1;
            url = window.location.search.substr(filePos);
        }
        clipboard.write(url);
    });
    mapkeyWithPrefix("y", "Y", "#7Copy all tabs's url", function() {
        RUNTIME('getTabs', null, function (response) {
            clipboard.write(response.tabs.map(tab => tab.url).join('\n'));
        });
    });
    mapkeyWithPrefix("y", "h", "#7Copy current page's host", function() {
        var url = new URL(window.location.href);
        clipboard.write(url.host);
    });
    mapkeyWithPrefix("y", "l", "#7Copy current page's title", function() {
        clipboard.write(document.title);
    });
    mapkeyWithPrefix("y", "Q", '#7Copy all query history of OmniQuery.', function() {
        RUNTIME('getSettings', {
            key: 'OmniQueryHistory'
        }, function(response) {
            clipboard.write(response.settings.OmniQueryHistory.join("\n"));
        });
    });

    function getFormData(form, format) {
        var formData = new FormData(form);
        if (format === "json") {
            var obj = {};

            formData.forEach(function (value, key) {
                if (obj.hasOwnProperty(key)) {
                    if (value.length) {
                        var p = obj[key];
                        if (p.constructor.name === "Array") {
                            p.push(value);
                        } else {
                            obj[key] = [];
                            if (p.length) {
                                obj[key].push(p);
                            }
                            obj[key].push(value);
                        }
                    }
                } else {
                    obj[key] = value;
                }
            });

            return obj;
        } else {
            return new URLSearchParams(formData).toString();
        }
    }
    function generateFormKey(form) {
        return (form.method || "get") + "::" + new URL(form.action).pathname;
    }
    mapkeyWithPrefix("y", "f", '#7Copy form data in JSON on current page', function() {
        var fd = {};
        document.querySelectorAll('form').forEach(function(form) {
            fd[generateFormKey(form)] = getFormData(form, "json");
        });
        clipboard.write(JSON.stringify(fd, null, 4));
    });
    mapkeyWithPrefix(";", "pf", '#7Fill form with data from yf', function() {
        hints.create('form', function(element, event) {
            var formKey = generateFormKey(element);
            clipboard.read(function(response) {
                var forms = JSON.parse(response.data.trim());
                if (forms.hasOwnProperty(formKey)) {
                    var fd = forms[formKey];
                    element.querySelectorAll('input, textarea').forEach(function(ip) {
                        if (fd.hasOwnProperty(ip.name) && ip.type !== "hidden") {
                            if (ip.type === "radio") {
                                var op = element.querySelector(`input[name='${ip.name}'][value='${fd[ip.name]}']`);
                                if (op) {
                                    op.checked = true;
                                }
                            } else if (Array.isArray(fd[ip.name])) {
                                element.querySelectorAll(`input[name='${ip.name}']`).forEach(function(ip) {
                                    ip.checked = false;
                                });
                                var vals = fd[ip.name];
                                vals.forEach(function(v) {
                                    var op = element.querySelector(`input[name='${ip.name}'][value='${v}']`);
                                    if (op) {
                                        op.checked = true;
                                    }
                                });
                            } else if (typeof(fd[ip.name]) === "string") {
                                ip.value = fd[ip.name];
                            }
                        }
                    });
                } else {
                    showBanner("No form data found for your selection from clipboard.");
                }
            });
        });
    });
    mapkeyWithPrefix("y", "p", '#7Copy form data for POST on current page', function() {
        var aa = [];
        document.querySelectorAll('form').forEach(function(form) {
            var fd = {};
            fd[(form.method || "get") + "::" + form.action] = getFormData(form);
            aa.push(fd);
        });
        clipboard.write(JSON.stringify(aa, null, 4));
    });

    mapkeyWithPrefix("g", "?", '#4Reload current page without query string(all parts after question mark)', function() {
        window.location.href = window.location.href.replace(/\?[^\?]*$/, '');
    });
    mapkeyWithPrefix("g", "#", '#4Reload current page without hash fragment', function() {
        window.location.href = window.location.href.replace(/\#[^\#]*$/, '');
    });
    mapkeyWithPrefix("g", "U", '#4Go to root of current URL hierarchy', function() {
        window.location.href = window.location.origin;
    });
    mapkeyWithPrefix("g", "xt", '#3Close tab on left', function() {
        RUNTIME("closeTabLeft");
    });
    mapkeyWithPrefix("g", "xT", '#3Close tab on right', function() {
        RUNTIME("closeTabRight");
    });
    mapkeyWithPrefix("g", "x0", '#3Close all tabs on left', function() {
        RUNTIME("closeTabsToLeft");
    });
    mapkeyWithPrefix("g", "x$", '#3Close all tabs on right', function() {
        RUNTIME("closeTabsToRight");
    });
    mapkeyWithPrefix("g", "xx", '#3Close all tabs except current one', function() {
        RUNTIME("tabOnly");
    });
    mapkeyWithPrefix("g", "xp", '#3Close playing tab', function() {
        RUNTIME("closeAudibleTab");
    });
    mapkeyWithPrefix(";", "e", '#11Edit Settings', function() {
        tabOpenLink("/pages/options.html");
    });
    mapkeyWithPrefix(";", "u", '#4Edit current URL with vim editor, and open in new tab', function() {
        front.showEditor(window.location.href, function(data) {
            tabOpenLink(data);
        }, 'url');
    });
    mapkeyWithPrefix(";", "U", '#4Edit current URL with vim editor, and reload', function() {
        front.showEditor(window.location.href, function(data) {
            window.location.href = data;
        }, 'url');
    });

    addSearchAlias('g', 'google', 'https://www.google.com/search?q=', 's', 'https://www.google.com/complete/search?client=chrome-omni&gs_ri=chrome-ext&oit=1&cp=1&pgcl=7&q=', function(response) {
        var res = JSON.parse(response.text);
        return res[1];
    });
    addSearchAlias('d', 'duckduckgo', 'https://duckduckgo.com/?q=', 's', 'https://duckduckgo.com/ac/?q=', function(response) {
        var res = JSON.parse(response.text);
        return res.map(function(r){
            return r.phrase;
        });
    });
    addSearchAlias('b', 'baidu', 'https://www.baidu.com/s?wd=', 's', 'https://suggestion.baidu.com/su?cb=&wd=', function(response) {
        var res = response.text.match(/,s:\[("[^\]]+")]}/);
        return res ? res[1].replace(/"/g, '').split(",") : [];
    });

    addSearchAlias('e', 'wikipedia', 'https://en.wikipedia.org/wiki/', 's', 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&formatversion=2&namespace=0&limit=40&search=', function(response) {
        return JSON.parse(response.text)[1];
    });
    addSearchAlias('w', 'bing', 'https://www.bing.com/search?setmkt=en-us&setlang=en-us&q=', 's', 'https://api.bing.com/osjson.aspx?query=', function(response) {
        var res = JSON.parse(response.text);
        return res[1];
    });
    addSearchAlias('s', 'stackoverflow', 'https://stackoverflow.com/search?q=');
    addSearchAlias('h', 'github', 'https://github.com/search?q=', 's', 'https://api.github.com/search/repositories?order=desc&q=', function(response) {
        var res = JSON.parse(response.text)['items'];
        return res ? res.map(function(r){
            return {
                title: r.description,
                url: r.html_url
            };
        }) : [];
    });
    addSearchAlias('y', 'youtube', 'https://www.youtube.com/results?search_query=', 's',
    'https://clients1.google.com/complete/search?client=youtube&ds=yt&callback=cb&q=', function(response) {
        var res = JSON.parse(response.text.substr(9, response.text.length-10));
        return res[1].map(function(d) {
            return d[0];
        });
    });

    const bn = getBrowserName();
    if (bn === "Firefox") {
        mapkeyWithPrefix("o", "n", '#3Open newtab', function() {
            tabOpenLink("about:blank");
        });
    } else if (bn === "Chrome") {
        mapkeyWithPrefix("c", "p", '#13Toggle proxy for current site', function() {
            var host = window.location.host.replace(/:\d+/,'');
            if (host && host.length) {
                RUNTIME('updateProxy', {
                    host: host,
                    operation: "toggle"
                });
            }
        });
        mapkeyWithPrefix(";", "cp", '#13Copy proxy info', function() {
            RUNTIME('getSettings', {
                key: ['proxyMode', 'proxy', 'autoproxy_hosts']
            }, function(response) {
                clipboard.write(JSON.stringify(response.settings, null, 4));
            });
        });
        mapkeyWithPrefix(";", "ap", '#13Apply proxy info from clipboard', function() {
            clipboard.read(function(response) {
                var proxyConf = JSON.parse(response.data);
                RUNTIME('updateProxy', {
                    operation: 'set',
                    host: proxyConf.autoproxy_hosts,
                    proxy: proxyConf.proxy,
                    mode: proxyConf.proxyMode
                });
            });
        });
        // create shortcuts for the command with different parameters
        mapWithPrefix(";", "pa", ':setProxyMode always', 0, '#13set proxy mode `always`');
        mapWithPrefix(";", "pb", ':setProxyMode byhost', 0, '#13set proxy mode `byhost`');
        mapWithPrefix(";", "pd", ':setProxyMode direct', 0, '#13set proxy mode `direct`');
        mapWithPrefix(";", "ps", ':setProxyMode system', 0, '#13set proxy mode `system`');
        mapWithPrefix(";", "pc", ':setProxyMode clear', 0, '#13set proxy mode `clear`');
        mapkeyWithPrefix("g", "r", '#14Read selected text or text from clipboard', function() {
            clipboard.read(function(response) {
                readText(window.getSelection().toString() || response.data, {verbose: true});
            });
        });
        vmapkeyWithPrefix("g", "r", '#9Read selected text', function() {
            readText(window.getSelection().toString(), {verbose: true});
        });

        mapkeyWithPrefix("o", "n", '#3Open newtab', function() {
            tabOpenLink("chrome://newtab/");
        });
        mapkeyWithPrefix("g", "a", '#12Open Chrome About', function() {
            tabOpenLink("chrome://help/");
        });
        mapkeyWithPrefix("g", "b", '#12Open Chrome Bookmarks', function() {
            tabOpenLink("chrome://bookmarks/");
        });
        mapkeyWithPrefix("g", "c", '#12Open Chrome Cache', function() {
            tabOpenLink("chrome://cache/");
        });
        mapkeyWithPrefix("g", "d", '#12Open Chrome Downloads', function() {
            tabOpenLink("chrome://downloads/");
        });
        mapkeyWithPrefix("g", "h", '#12Open Chrome History', function() {
            tabOpenLink("chrome://history/");
        });
        mapkeyWithPrefix("g", "k", '#12Open Chrome Cookies', function() {
            tabOpenLink("chrome://settings/cookies");
        });
        mapkeyWithPrefix("g", "e", '#12Open Chrome Extensions', function() {
            tabOpenLink("chrome://extensions/");
        });
        mapkeyWithPrefix("g", "n", '#12Open Chrome net-internals', function() {
            tabOpenLink("chrome://net-internals/#proxy");
        });
        mapkeyWithPrefix(";", "i", '#12Open Chrome Inspect', function() {
            tabOpenLink("chrome://inspect/#devices");
        });
        mapkeyWithPrefix(";", "v", '#11Open neovim', function() {
            tabOpenLink("/pages/neovim.html");
        });
    }

    mapkey('X', '#3Restore closed tab', function() {
        RUNTIME("openLast");
    });

    if (!getBrowserName().startsWith("Safari")) {
        mapkey('t', '#8Open a URL', function() {
            front.openOmnibar({type: "URLs"});
        });
        mapkeyWithPrefix("g", "o", '#8Open a URL in current tab', function() {
            front.openOmnibar({type: "URLs", tabbed: false});
        });
        mapkeyWithPrefix("o", "x", '#8Open recently closed URL', function() {
            front.openOmnibar({type: "RecentlyClosed"});
        });
        mapkey('b', '#8Open a bookmark', function() {
            front.openOmnibar(({type: "Bookmarks"}));
        });
        mapkeyWithPrefix(";", "x", '#3Close tabs by URL', function() {
            front.openOmnibar({type: "CloseTabs"});
        });
        mapkey('ab', '#8Bookmark current page to selected folder', function() {
            var page = {
                url: window.location.href,
                title: document.title
            };
            front.openOmnibar(({type: "AddBookmark", extra: page}));
        });
        mapkeyWithPrefix("o", "h", '#8Open URL from history', function() {
            front.openOmnibar({type: "History"});
        });
        mapkeyWithPrefix("o", "s", '#8Search TSM sessions', function() {
            front.openOmnibar({type: "TSMSessions"});
        });
        mapkeyWithPrefix("o", "t", '#8Search all TSM tabs', function() {
            front.openOmnibar({type: "TSMAllTabs"});
        });
        mapkey('W', '#3Move current tab to another window', function() {
            front.openOmnibar(({type: "Windows"}));
        });
        mapkeyWithPrefix(";", "gt", '#3Gather filtered tabs into current window', function() {
            front.openOmnibar({type: "Tabs", extra: {
                action: "gather"
            }});
        });
        mapkeyWithPrefix(";", "gw", '#3Gather all tabs into current window', function() {
            RUNTIME("gatherWindows");
        });
        mapkeyWithPrefix("<", "<", '#3Move current tab to left', function() {
            RUNTIME('moveTab', {
                step: -1
            });
        });
        mapkeyWithPrefix(">", ">", '#3Move current tab to right', function() {
            RUNTIME('moveTab', {
                step: 1
            });
        });
        mapkeyWithPrefix("y", "d", "#7Copy current downloading URL", function() {
            RUNTIME('getDownloads', {
                query: {state: "in_progress"}
            }, function(response) {
                var items = response.downloads.map(function(o) {
                    return o.url;
                });
                clipboard.write(items.join(','));
            });
        });
        mapkeyWithPrefix("g", "s", '#12View page source', function() {
            RUNTIME("viewSource", { tab: { tabbed: true }});
        });
        mapkeyWithPrefix(";", "pm", '#11Preview markdown', function() {
            tabOpenLink("/pages/markdown.html");
        });
        mapkeyWithPrefix(";", "di", '#1Download image', function() {
            hints.create('img', function(element) {
                RUNTIME('download', {
                    url: element.src
                });
            });
        });
        mapkeyWithPrefix(";", "j", '#12Close Downloads Shelf', function() {
            RUNTIME("closeDownloadsShelf", {clearHistory: true});
        });
        mapkeyWithPrefix(";", "dh", '#14Delete history older than 30 days', function() {
            RUNTIME('deleteHistoryOlderThan', {
                days: 30
            });
        });
        mapkeyWithPrefix(";", "yh", '#14Yank histories', function() {
            RUNTIME('getHistory', {}, function(response) {
                clipboard.write(response.history.map(h => h.url).join("\n"));
            });
        });
        mapkeyWithPrefix(";", "ph", '#14Put histories from clipboard', function() {
            clipboard.read(function(response) {
                RUNTIME('addHistories', {history: response.data.split("\n")});
            });
        });
        mapkeyWithPrefix(";", "db", '#14Remove bookmark for current page', function() {
            RUNTIME('removeBookmark');
        });
    }
}
