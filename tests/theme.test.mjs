import test from "node:test";
import assert from "node:assert/strict";

import { ThemeController } from "../js/theme.js";

function createDom() {
    const stored = new Map();
    const attributes = new Map();
    const handlers = new Map();

    const makeClassList = () => {
        const classes = new Set();

        return {
            toggle(name, enabled) {
                if (enabled) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
            },
            contains(name) {
                return classes.has(name);
            }
        };
    };

    const label = { textContent: "" };
    const button = {
        querySelector() {
            return label;
        },
        addEventListener(name, callback) {
            handlers.set(name, callback);
        },
        setAttribute(name, value) {
            attributes.set(name, value);
        }
    };
    const meta = { content: null, setAttribute(name, value) { this.content = value; } };

    globalThis.localStorage = {
        getItem(key) {
            return stored.get(key) ?? null;
        },
        setItem(key, value) {
            stored.set(key, value);
        }
    };
    globalThis.document = {
        documentElement: { classList: makeClassList() },
        body: { classList: makeClassList() },
        querySelector(selector) {
            return selector === 'meta[name="theme-color"]' ? meta : null;
        }
    };

    return { stored, attributes, handlers, button, label, meta };
}

test("Chief respects the One-Time Secret theme setting and switches without reload", () => {
    const dom = createDom();
    dom.stored.set("theme", "dark");

    const translator = {
        t(key) {
            return { "app.theme.dark": "DARK", "app.theme.light": "LIGHT",
                "app.theme.switchToLight": "Switch to light mode",
                "app.theme.switchToDark": "Switch to dark mode" }[key] || key;
        }
    };

    const controller = new ThemeController(dom.button, translator);
    controller.init();

    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(document.body.classList.contains("dark"), true);
    assert.equal(dom.attributes.get("aria-pressed"), "true");
    assert.equal(dom.label.textContent, "DARK");
    assert.equal(dom.meta.content, "#111d18");

    dom.handlers.get("click")();

    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(dom.stored.get("theme"), "light");
    assert.equal(dom.attributes.get("aria-label"), "Switch to dark mode");
    assert.equal(dom.label.textContent, "LIGHT");
    assert.equal(dom.meta.content, "#f5f4ed");
});
