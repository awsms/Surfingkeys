import { RUNTIME, dispatchSKEvent } from '../content_scripts/common/runtime.js';
import {
    aceVimMap,
    addVimMapKey,
    applyUserSettings,
    getBrowserName,
    getClickableElements,
    httpRequest,
    initSKFunctionListener,
    isElementPartiallyInViewport,
    showBanner,
    showPopup,
    tabOpenLink,
} from '../content_scripts/common/utils.js';

var EXTENSION_ROOT_URL = "";
function isInUIFrame() {
    return !document.location.href.startsWith("chrome://") && document.location.href.indexOf(EXTENSION_ROOT_URL) === 0;
}

    function _isDomainApplicable(domain) {
        return !domain || domain.test(document.location.href) || domain.test(window.origin);
    }

    function cmap(new_keystroke, old_keystroke, domain, new_annotation) {
        if (_isDomainApplicable(domain)) {
            dispatchSKEvent("front", ['addMapkey', "Omnibar", new_keystroke, old_keystroke]);
        }
    }

const userDefinedFunctions = {};
function mapkey(keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        const opt = options || {};
        userDefinedFunctions[`normal:${keys}`] = jscode;
        opt.codeHasParameter = jscode.length;
        dispatchSKEvent('api', ['mapkey', keys, annotation, opt]);
    }
}
function imapkey(keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        userDefinedFunctions[`insert:${keys}`] = jscode;
        dispatchSKEvent('api', ['imapkey', keys, annotation, options]);
    }
}
function vmapkey(keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        userDefinedFunctions[`visual:${keys}`] = jscode;
        dispatchSKEvent('api', ['vmapkey', keys, annotation, options]);
   }
}

const userDefinedCommands = {};
function addCommand(name, description, action) {
    userDefinedCommands[name] = action;
    dispatchSKEvent('front', ['addCommand', name, description]);
}

function map(new_keystroke, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['map', new_keystroke, old_keystroke, domain, new_annotation]);
}
function remap(new_keystroke, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['remap', new_keystroke, old_keystroke, domain, new_annotation]);
}
function mapWithPrefix(prefix, keys, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['mapWithPrefix', prefix, keys, old_keystroke, domain, new_annotation]);
}
function remapPrefix(oldPrefix, newPrefix, modeName = "normal") {
    dispatchSKEvent('api', ['remapPrefix', oldPrefix, newPrefix, modeName]);
}
function imap(new_keystroke, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['imap', new_keystroke, old_keystroke, domain, new_annotation]);
}
function lmap(new_keystroke, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['lmap', new_keystroke, old_keystroke, domain, new_annotation]);
}
function vmap(new_keystroke, old_keystroke, domain, new_annotation) {
    dispatchSKEvent('api', ['vmap', new_keystroke, old_keystroke, domain, new_annotation]);
}
function unmapPrefix(prefix, moveToPrefix, modeName = "normal") {
    dispatchSKEvent('api', ['unmapPrefix', prefix, moveToPrefix, modeName]);
}
function mapkeyWithPrefix(prefix, keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        const opt = options || {};
        const fullKeys = prefix + keys;
        userDefinedFunctions[`normal:${fullKeys}`] = jscode;
        opt.codeHasParameter = jscode.length;
        dispatchSKEvent('api', ['mapkeyWithPrefix', prefix, keys, annotation, opt]);
    }
}
function imapkeyWithPrefix(prefix, keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        const fullKeys = prefix + keys;
        userDefinedFunctions[`insert:${fullKeys}`] = jscode;
        dispatchSKEvent('api', ['imapkeyWithPrefix', prefix, keys, annotation, options]);
    }
}
function vmapkeyWithPrefix(prefix, keys, annotation, jscode, options) {
    if (!options || _isDomainApplicable(options.domain)) {
        const fullKeys = prefix + keys;
        userDefinedFunctions[`visual:${fullKeys}`] = jscode;
        dispatchSKEvent('api', ['vmapkeyWithPrefix', prefix, keys, annotation, options]);
   }
}

const functionsToListSuggestions = {};

let inlineQuery;
let hintsFunction;
let onClipboardReadFn;
let onEditorWriteFn;
let userScriptTask = () => {};
let hintsCreationResolve;
let _pendingOnEnter = null;
initSKFunctionListener("user", {
    applySettingsSnippets: (extensionRootUrl, snippets) => {
        EXTENSION_ROOT_URL = extensionRootUrl;
        runSettingsSnippets(snippets);
    },
    callUserFunction: (keys, para) => {
        if (userDefinedFunctions.hasOwnProperty(keys)) {
            userDefinedFunctions[keys](para);
        }
    },
    executeUserCommand: (name, args) => {
        if (userDefinedCommands.hasOwnProperty(name)) {
            userDefinedCommands[name](...args);
        }
    },
    getSearchSuggestions: async (url, response, request, callbackId, origin) => {
        if (functionsToListSuggestions.hasOwnProperty(url)) {
            try {
                const ret = await functionsToListSuggestions[url](response, request);
                dispatchSKEvent("front", [callbackId, ret]);
            } catch (e) {
                console.error("Search suggestion callback error:", e);
                dispatchSKEvent("front", [callbackId, []]);
            }
        }
    },
    performInlineQuery: (query, callbackId, origin) => {
        const url = (typeof(inlineQuery.url) === "function") ? inlineQuery.url(query) : inlineQuery.url + query;
        httpRequest({
            url,
            headers: inlineQuery.headers
        }, function(res) {
            if (res.error) {
                dispatchSKEvent("front", [callbackId, `${res.error} on ${url}`]);
            } else {
                dispatchSKEvent("front", [callbackId, inlineQuery.parseResult(res)]);
            }
        });
    },
    runUserScript: () => {
        userScriptTask();
    },
    onClipboardRead: (resp) => {
        onClipboardReadFn(resp);
    },
    onEditorWrite: (data) => {
        onEditorWriteFn(data);
    },
    onHintClicked: (shiftKey, element) => {
        if (typeof(hintsFunction) === 'function') {
            hintsFunction(element, shiftKey);
        }
    },
    onHintCreated: (found) => {
        if (hintsCreationResolve) {
            hintsCreationResolve(found);
            hintsCreationResolve = null;
        }
    },
    userURLs_onEnter: (item, ctrlKey, shiftKey) => {
        if (_pendingOnEnter) {
            _pendingOnEnter(item, ctrlKey, shiftKey);
            _pendingOnEnter = null;
        }
    },
}, true);

function addSearchAlias(alias, prompt, search_url, search_leader_key, suggestion_url, callback_to_parse_suggestion, only_this_site_key, options) {
    if (!/^[\u0000-\u007f]*$/.test(alias)) {
        throw `Invalid alias ${alias}, which must be ASCII characters.`;
    }
    functionsToListSuggestions[suggestion_url] = callback_to_parse_suggestion;
    dispatchSKEvent('api', ['addSearchAlias', alias, prompt, search_url, search_leader_key, suggestion_url, "user", only_this_site_key, options]);
}

function createCssSelectorForElements(cssSelector, elements) {
    if (elements instanceof HTMLElement) {
        elements = [elements];
    } else if (elements instanceof Array) {
        elements = elements.filter((m) => m instanceof HTMLElement);
    } else {
        elements = [];
    }
    elements.forEach((m) => {
        m.classList.add(cssSelector);
    });
    return elements.length;
}

const api = {
    RUNTIME,
    aceVimMap,
    addVimMapKey,
    addSearchAlias,
    addCommand,
    cmap,
    imap,
    imapkey,
    imapkeyWithPrefix,
    isElementPartiallyInViewport,
    getBrowserName,
    getClickableElements,
    lmap,
    vmap,
    vmapkey,
    vmapkeyWithPrefix,
    map,
    remap,
    mapWithPrefix,
    unmapPrefix,
    remapPrefix,
    mapkey,
    mapkeyWithPrefix,
    unmap: (keystroke, domain) => {
        dispatchSKEvent('api', ['unmap', keystroke, domain]);
    },
    iunmap: (keystroke, domain) => {
        dispatchSKEvent('api', ['iunmap', keystroke, domain]);
    },
    vunmap: (keystroke, domain) => {
        dispatchSKEvent('api', ['vunmap', keystroke, domain]);
    },
    unmapAllExcept: (keystrokes, domain) => {
        dispatchSKEvent('api', ['unmapAllExcept', keystrokes, domain]);
    },
    readText: (text, options) => {
        dispatchSKEvent('api', ['readText', text, options]);
    },
    removeSearchAlias: (alias, search_leader_key, only_this_site_key) => {
        dispatchSKEvent('api', ['removeSearchAlias', alias, search_leader_key, only_this_site_key]);
    },
    searchSelectedWith: (se, onlyThisSite, interactive, alias) => {
        dispatchSKEvent('api', ['searchSelectedWith', se, onlyThisSite, interactive, alias]);
    },
    tabOpenLink,
    Clipboard: {
        write: (text) => {
            dispatchSKEvent('api', ['clipboard:write', text]);
        },
        read: (cb) => {
            onClipboardReadFn = cb;
            dispatchSKEvent('api', ['clipboard:read']);
        },
    },
    Hints: {
        click: (links, force) => {
            if (typeof(links) !== 'string') {
                const hintsClicking = "surfingkeys--hints--clicking";
                if (createCssSelectorForElements(hintsClicking, links) === 0) {
                    return;
                }
                links = `.${hintsClicking}`;
            }
            dispatchSKEvent('api', ['hints:click', links, force]);
        },
        create: (cssSelector, onHintKey, attrs) => {
            if (typeof(cssSelector) !== 'string') {
                const hintsCreating = "surfingkeys--hints--creating";
                if (createCssSelectorForElements(hintsCreating, cssSelector) === 0) {
                    return false;
                }
                cssSelector = `.${hintsCreating}`;
            }
            hintsFunction = onHintKey;
            const promise = new Promise((resolve, reject) => {
                hintsCreationResolve = resolve;
            });
            dispatchSKEvent('api', ['hints:create', cssSelector, "user", attrs]);
            return promise;
        },
        dispatchMouseClick: (element) => {
            dispatchSKEvent('hints', ['dispatchMouseClick'], element);
        },
        style: (css, mode) => {
            dispatchSKEvent('api', ['hints:style', css, mode]);
        },
        setCharacters: (chars) => {
            dispatchSKEvent('api', ['hints:setCharacters', chars]);
        },
        setNumeric: () => {
            dispatchSKEvent('api', ['hints:setNumeric']);
        },
    },
    Normal: {
        feedkeys: (keys) => {
            dispatchSKEvent('api', ['normal:feedkeys', keys]);
        },
        jumpVIMark: (mark) => {
            dispatchSKEvent('api', ['normal:jumpVIMark', mark]);
        },
        passThrough: (timeout) => {
            dispatchSKEvent('api', ['normal:passThrough', timeout]);
        },
        scroll: (type) => {
            dispatchSKEvent('api', ['normal:scroll', type]);
        },
    },
    Visual: {
        style: (element, style) => {
            dispatchSKEvent('api', ['visual:style', element, style]);
        },
    },
    Front: {
        registerInlineQuery: (args) => {
            inlineQuery = args;
            dispatchSKEvent('api', ['front:registerInlineQuery']);
        },
        showEditor: (element, onWrite, type, useNeovim) => {
            if (typeof(element) !== 'string') {
                const elementEditing = "surfingkeys--element--editing";
                if (createCssSelectorForElements(elementEditing, element) === 0) {
                    return;
                }
                element = `.${elementEditing}`;
            }
            onEditorWriteFn = onWrite;
            dispatchSKEvent('api', ['front:showEditor', element, type, useNeovim]);
        },
        openOmnibar: (args) => {
            _pendingOnEnter = null;
            if (typeof args.onEnter === 'function') {
                _pendingOnEnter = args.onEnter;
                args = Object.assign({}, args, { _hasCustomOnEnter: true });
                delete args.onEnter;
            }
            dispatchSKEvent('api', ['front:openOmnibar', args]);
        },
        showBanner,
        showPopup
    },
};

function applyUserFunction(uf) {
    var settings = {}, error = "";
    try {
        uf(api, settings);
    } catch(e) {
        error = e.toString();
    }
    applyUserSettings({settings, error});
}

function clearObject(obj) {
    for (const key in obj) {
        delete obj[key];
    }
}

function resetUserScriptState() {
    clearObject(userDefinedFunctions);
    clearObject(userDefinedCommands);
    clearObject(functionsToListSuggestions);
    inlineQuery = undefined;
    hintsFunction = undefined;
    onClipboardReadFn = undefined;
    onEditorWriteFn = undefined;
    hintsCreationResolve = undefined;
    _pendingOnEnter = null;
}

function runSettingsSnippets(snippets) {
    resetUserScriptState();
    applyUserFunction((api, settings) => {
        (new Function('api', 'settings', snippets))(api, settings);
    });
}

export default (extensionRootUrl, uf) => {
    EXTENSION_ROOT_URL = extensionRootUrl;
    if (isInUIFrame()) return;
    userScriptTask = () => applyUserFunction(uf);
    if (window === top) {
        userScriptTask();
    }
};
