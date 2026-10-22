import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Translator } from "../js/translator.js";
import { ApiClient, ApiRequestError } from "../js/core.js";

const memory = new Map();

globalThis.localStorage = {
    getItem(key) {
        return memory.get(key) ?? null;
    },
    setItem(key, value) {
        memory.set(key, String(value));
    }
};

async function dictionary(language) {
    const location = new URL("../translations/" + language + ".json", import.meta.url);
    return JSON.parse(await readFile(location, "utf8"));
}

function allKeys(object, prefix = "") {
    return Object.entries(object).flatMap(([name, value]) => {
        const key = prefix + name;

        return typeof value === "string"
            ? [key]
            : allKeys(value, key + ".");
    });
}

test("English and Polish dictionaries contain matching keys", async () => {
    const english = await dictionary("en_GB");
    const polish = await dictionary("pl_PL");

    assert.deepEqual(
        allKeys(english).sort(),
        allKeys(polish).sort()
    );
});

test("translator resolves nested keys and interpolates parameters", async () => {
    memory.set(Translator.STORAGE_KEY, "pl_PL");

    const translator = new Translator();
    translator.messages = await dictionary("pl_PL");

    assert.equal(translator.language, "pl_PL");
    assert.equal(translator.t("editor.childType"), "Typ komponentu dziecka");
    assert.equal(translator.t("home.room", { id: "xyz" }), "Pokój: xyz");
    assert.equal(translator.t("missing.translation.key"), "missing.translation.key");
});

test("HTML templates resolve $t expressions and escape translations", () => {
    memory.set(Translator.STORAGE_KEY, "en_GB");

    const translator = new Translator();
    translator.messages = {
        test: {
            label: "A < B & C"
        }
    };

    assert.equal(
        translator.translateTemplate("<span>$t('test.label')</span>"),
        "<span>A &lt; B &amp; C</span>"
    );
});

test("API errors are translated on the client and preserve their original keys", async () => {
    const translator = new Translator();
    translator.messages = await dictionary("pl_PL");

    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({
            ok: false,
            error: "errors.api.kitchenNotFound"
        })
    });

    try {
        const client = new ApiClient(translator);

        await assert.rejects(client.request("get_room", { roomId: "missing" }), (error) => {
            assert.ok(error instanceof ApiRequestError);
            assert.equal(error.translationKey, "errors.api.kitchenNotFound");
            assert.equal(error.message, "Nie znaleziono kuchni.");
            return true;
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
