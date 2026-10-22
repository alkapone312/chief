export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

export function formatPrice(cents, translator = null) {
    return cents === null || cents === undefined
        ? (translator?.t("common.priceUnset") ?? "Price not set")
        : (cents / 100).toLocaleString(translator?.locale ?? "en-GB", {
            style: "currency",
            currency: "PLN"
        });
}

export function formatTime(value, translator = null) {
    return new Date(value.replace(" ", "T") + "Z").toLocaleTimeString(translator?.locale ?? "en-GB", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function priceToCents(value) {
    if (String(value).trim() === "") {
        return null;
    }

    const parsed = Number(String(value).replace(",", "."));

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
        throw new Error("errors.client.invalidPrice");
    }

    return Math.round(parsed * 100);
}

export function createId(prefix = "id") {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return prefix + "-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function field(label, value, binding, type = "text", attributes = "") {
    return [
        '<div class="field">',
        '    <label>' + escapeHtml(label) + '</label>',
        '    <input type="' + escapeHtml(type) + '" value="' + escapeHtml(value) + '"',
        '        data-edit="' + escapeHtml(binding) + '" ' + attributes + '>',
        '</div>'
    ].join("\n");
}

export function actionButton(label, action, variant = "dark", extra = "") {
    return '<button type="button" class="btn ' + variant + '" data-action="' +
        escapeHtml(action) + '" ' + extra + '>' + escapeHtml(label) + '</button>';
}

export function encodePath(path) {
    return escapeHtml(JSON.stringify(path));
}

export function decodePath(encoded) {
    const path = JSON.parse(encoded);

    if (!Array.isArray(path) || !Number.isInteger(path[0])) {
        throw new Error("errors.client.invalidPath");
    }

    return path;
}

export class TemplateRepository {
    constructor(names, translator) {
        this.translator = translator;
        this.names = names;
        this.templates = new Map();
    }

    async loadAll() {
        const loaded = await Promise.all(this.names.map(async (name) => {
            const response = await fetch("components/" + name + ".html", {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(this.translator.t("errors.client.templateLoad", { name }));
            }

            return [name, await response.text()];
        }));

        this.templates = new Map(loaded);
    }

    render(name, properties = {}) {
        const template = this.templates.get(name);

        if (!template) {
            throw new Error(this.translator.t("errors.client.templateMissing", { name }));
        }

        // Values containing user content must be escaped before passing here.
        return this.translator.translateTemplate(template)
            .replace(/\{\{(\w+)\}\}/g, (_, key) => String(properties[key] ?? ""));
    }
}

export class ApiRequestError extends Error {
    constructor(translationKey, translator, parameters = {}) {
        super(translator.t(translationKey, parameters));
        this.name = "ApiRequestError";
        this.translationKey = translationKey;
    }
}

export class ApiClient {
    constructor(translator) {
        this.translator = translator;
    }

    async request(action, data = {}) {
        const response = await fetch("api.php", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ action, ...data })
        });

        let result;

        try {
            result = await response.json();
        } catch {
            throw new Error(this.translator.t("errors.client.invalidResponse"));
        }

        if (!response.ok || !result.ok) {
            throw new ApiRequestError(
                result.error || "errors.client.http",
                this.translator,
                result.params || {}
            );
        }

        return result;
    }
}

export class SessionRepository {
    get rooms() {
        try {
            return JSON.parse(localStorage.getItem("chiefRooms") || "[]");
        } catch {
            return [];
        }
    }

    saveRoom(room) {
        const rooms = [room, ...this.rooms.filter((existing) => existing.id !== room.id)];
        localStorage.setItem("chiefRooms", JSON.stringify(rooms));
    }

    ownerToken(roomId) {
        return this.rooms.find((room) => room.id === roomId)?.token;
    }

    removeRoom(roomId) {
        localStorage.setItem(
            "chiefRooms",
            JSON.stringify(this.rooms.filter((room) => room.id !== roomId))
        );
    }

    get guestName() {
        return localStorage.getItem("chiefGuest") || "";
    }

    set guestName(value) {
        localStorage.setItem("chiefGuest", value);
    }

    readReceipts(roomId) {
        try {
            return JSON.parse(localStorage.getItem("chiefReceipts:" + roomId) || "[]");
        } catch {
            return [];
        }
    }

    saveReceipts(roomId, receipts) {
        localStorage.setItem("chiefReceipts:" + roomId, JSON.stringify(receipts));
    }
}

export class DialogService {
    constructor(translator) {
        this.translator = translator;
        this.toastTimer = null;
    }

    open(html) {
        this.close();

        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        backdrop.innerHTML = [
            '<section class="modal" role="dialog" aria-modal="true">',
            '    <button class="close" type="button" data-modal-close aria-label="' + escapeHtml(this.translator.t("common.close")) + '">×</button>',
            html,
            '</section>'
        ].join("\n");

        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop || event.target.closest("[data-modal-close]")) {
                this.close();
            }
        });

        document.body.append(backdrop);
        return backdrop;
    }

    close() {
        document.querySelector(".modal-backdrop")?.remove();
    }

    get isOpen() {
        return Boolean(document.querySelector(".modal-backdrop"));
    }

    notify(message) {
        const element = document.getElementById("toast");
        element.textContent = this.translator.has(message) ? this.translator.t(message) : message;
        element.style.display = "block";

        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            element.style.display = "none";
        }, 4000);
    }

    report(error) {
        console.error(error);
        this.notify(error?.message || String(error));
    }
}
