import { escapeHtml } from "./core.js";

/**
 * Loads a JSON dictionary and resolves dotted translation keys.
 * The dictionary is intentionally kept separate from JavaScript source files.
 */
export class Translator {
    static LANGUAGES = Object.freeze(["en_GB", "pl_PL"]);
    static STORAGE_KEY = "chiefLanguage";

    constructor() {
        const stored = localStorage.getItem(Translator.STORAGE_KEY);
        this.language = Translator.LANGUAGES.includes(stored) ? stored : "en_GB";
        this.messages = {};
    }

    get locale() {
        return this.language.replace("_", "-");
    }

    async load() {
        const response = await fetch("translations/" + this.language + ".json", {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Cannot load translations/" + this.language + ".json");
        }

        this.messages = await response.json();
        document.documentElement.lang = this.locale;
    }

    has(key) {
        return this.lookup(key) !== undefined;
    }

    lookup(key) {
        if (typeof key !== "string") {
            return undefined;
        }

        return key.split(".").reduce((value, segment) => {
            if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
                return undefined;
            }

            return value[segment];
        }, this.messages);
    }

    /**
     * Returns translated text, interpolating {name} placeholders.
     * Missing keys remain visible to simplify debugging.
     */
    t(key, parameters = {}) {
        const value = this.lookup(key);
        const text = typeof value === "string" ? value : key;

        return text.replace(/\{([a-zA-Z]\w*)\}/g, (match, name) => (
            Object.hasOwn(parameters, name) ? String(parameters[name]) : match
        ));
    }

    /**
     * Resolves literal $t('dotted.key') expressions within HTML templates.
     * Translation content is escaped, including when used in HTML attributes.
     */
    translateTemplate(template) {
        return template.replace(/\$t\('([a-zA-Z][\w.]*)'\)/g, (_, key) => {
            return escapeHtml(this.t(key));
        });
    }

    applyStaticTranslations(root = document) {
        root.querySelectorAll("[data-i18n]").forEach((element) => {
            element.textContent = this.t(element.dataset.i18n);
        });

        root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
            element.setAttribute("aria-label", this.t(element.dataset.i18nAriaLabel));
        });
    }

    selectLanguage(language) {
        if (!Translator.LANGUAGES.includes(language) || language === this.language) {
            return;
        }

        localStorage.setItem(Translator.STORAGE_KEY, language);
        location.reload();
    }
}
