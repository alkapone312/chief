import {
    actionButton,
    escapeHtml,
    formatPrice,
    formatTime
} from "./core.js";
import { MenuEditorController } from "./menu-editor.js";
import { selectionSummary } from "./menu.js";

export function guestUrl(roomId) {
    return location.origin + location.pathname + "?room=" + encodeURIComponent(roomId);
}

export function kitchenUrl(roomId) {
    return location.origin + location.pathname + "?chef=" + encodeURIComponent(roomId);
}

export class KitchenController {
    constructor(root, services, roomId) {
        this.root = root;
        this.api = services.api;
        this.dialog = services.dialog;
        this.templates = services.templates;
        this.session = services.session;
        this.translator = services.translator;
        this.roomId = roomId;
        this.room = null;
        this.orders = [];
        this.editor = null;
        this.tab = "orders";
        this.pollTimer = null;
        this.countdownTimer = null;
        this.expiresAt = null;
        this.expired = false;
        this.extendingRoom = false;
        this.isRefreshing = false;

        this.root.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            this.handleAction(button).catch((error) => this.dialog.report(error));
        });
    }

    t(key, parameters = {}) {
        return this.translator.t(key, parameters);
    }

    async start() {
        if (!this.session.ownerToken(this.roomId)) {
            this.root.innerHTML = [
                '<div class="empty">',
                "    <strong>" + escapeHtml(this.t("kitchen.accessUnavailable")) + "</strong>",
                "    " + escapeHtml(this.t("kitchen.accessHelp")),
                '    <p><a href="./">' + escapeHtml(this.t("app.backHome")) + "</a></p>",
                "</div>"
            ].join("\n");
            return;
        }

        await this.refresh();

        if (this.expired) {
            return;
        }

        this.countdownTimer = setInterval(() => this.updateRoomCountdown(), 1000);
        this.pollTimer = setInterval(() => {
            if (this.tab === "orders" && !this.dialog.isOpen) {
                this.refresh().catch((error) => console.error(error));
            }
        }, 4000);
    }

    stop() {
        clearInterval(this.pollTimer);
        clearInterval(this.countdownTimer);
    }

    updateRoomCountdown() {
        const label = this.root.querySelector("[data-room-countdown]");

        if (!label || this.expiresAt === null) {
            return;
        }

        const seconds = Math.max(0, Math.ceil(this.expiresAt - Date.now() / 1000));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = seconds % 60;
        const twoDigits = (number) => String(number).padStart(2, "0");

        label.textContent = seconds === 0
            ? this.t("kitchen.roomExpired")
            : [hours, minutes, remainder].map(twoDigits).join(":");

        const extendButton = this.root.querySelector('[data-action="extend-room"]');

        if (extendButton) {
            extendButton.disabled = seconds === 0 || this.extendingRoom;
        }
    }

    showExpiredRoom() {
        this.expired = true;
        this.stop();
        this.session.removeRoom(this.roomId);
        this.root.innerHTML = [
            '<div class="empty">',
            "    <strong>" + escapeHtml(this.t("kitchen.roomClosed")) + "</strong>",
            "    <p>" + escapeHtml(this.t("kitchen.roomClosedHelp")) + "</p>",
            '    <p><a href="./">' + escapeHtml(this.t("app.backHome")) + "</a></p>",
            "</div>"
        ].join("\n");
    }

    async refresh() {
        if (this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;

        try {
            const result = await this.api.request("get_kitchen", {
                roomId: this.roomId,
                ownerToken: this.session.ownerToken(this.roomId)
            });

            this.room = result.room;
            this.orders = result.orders;
            this.expiresAt = Math.max(this.expiresAt ?? 0, result.expiresAt);

            if (this.tab === "orders") {
                this.render();
            } else {
                this.updateRoomCountdown();
            }
        } catch (error) {
            if (error.translationKey === "errors.api.kitchenNotFound") {
                this.showExpiredRoom();
                return;
            }

            throw error;
        } finally {
            this.isRefreshing = false;
        }
    }

    render() {
        const room = this.room;

        this.root.innerHTML = [
            '<div class="workspace-head">',
            "    <div>",
            '        <p class="eyebrow">' + escapeHtml(this.t("kitchen.panel", { id: room.id })) + "</p>",
            "        <h1>" + escapeHtml(room.name) + "</h1>",
            '        <span class="muted">' + escapeHtml(this.t("kitchen.panelDesc")) + "</span>",
            "    </div>",
            '    <div class="room-lifetime">',
            '        <div class="room-lifetime-info">',
            '            <span class="eyebrow">' + escapeHtml(this.t("kitchen.timeRemaining")) + "</span>",
            '            <strong class="room-countdown" data-room-countdown>--:--:--</strong>',
            '            <span class="muted room-expiry-date">' +
                escapeHtml(this.t("kitchen.expiresOn")) + " " +
                escapeHtml(new Date(this.expiresAt * 1000).toLocaleString(this.translator.locale, {
                    dateStyle: "medium",
                    timeStyle: "short"
                })) + "</span>",
            "        </div>",
            actionButton(this.t("kitchen.extendRoom"), "extend-room", "ghost small"),
            "    </div>",
            '    <div class="actions">',
            actionButton(this.t("kitchen.guestView"), "guest-view", "ghost small"),
            actionButton(this.t("kitchen.shareQr"), "share", "dark small"),
            "    </div>",
            "</div>",
            '<nav class="tabs" aria-label="Kitchen tabs">',
            this.tabButton("orders", this.t("kitchen.tabOrders")),
            this.tabButton("menu", this.t("kitchen.tabMenu")),
            this.tabButton("share", this.t("kitchen.tabShare")),
            "</nav>",
            '<div id="tab-body"></div>'
        ].join("\n");

        this.updateRoomCountdown();

        const body = this.root.querySelector("#tab-body");

        switch (this.tab) {
            case "orders":
                body.innerHTML = this.renderOrders();
                break;

            case "menu":
                if (!this.editor) {
                    this.editor = new MenuEditorController(
                        room,
                        {
                            api: this.api,
                            dialog: this.dialog,
                            templates: this.templates,
                            session: this.session,
                            translator: this.translator
                        },
                        (updatedRoom) => {
                            this.room = updatedRoom;
                            this.orders = [];
                            this.editor = null;
                            this.tab = "orders";
                            this.render();
                        }
                    );
                }

                this.editor.mount(body);
                break;

            case "share":
                body.innerHTML = this.renderSharing();
                break;
        }
    }

    tabButton(tab, label) {
        return '<button type="button" class="tab ' +
            (this.tab === tab ? "active" : "") +
            '" data-action="switch-tab" data-tab="' + tab + '">' +
            escapeHtml(label) + "</button>";
    }

    renderOrders() {
        const pending = this.orders.filter((order) => order.status === "new").length;
        const completed = this.orders.length - pending;

        const stats = [
            [this.t("kitchen.allOrders"), this.orders.length],
            [this.t("kitchen.toPrepare"), pending],
            [this.t("kitchen.completed"), completed]
        ].map(([label, value]) => {
            return [
                '<div class="stat">',
                "    <small>" + label + "</small>",
                "    <strong>" + value + "</strong>",
                "</div>"
            ].join("\n");
        }).join("");

        const orders = this.orders.map((order) => this.renderOrder(order)).join("");

        return [
            '<div class="stats">' + stats + "</div>",
            orders
                ? '<div class="orders">' + orders + "</div>"
                : '<div class="empty"><strong>' + escapeHtml(this.t("kitchen.noOrders")) + "</strong>" +
                    escapeHtml(this.t("kitchen.noOrdersDesc")) + "</div>"
        ].join("\n");
    }

    renderOrder(order) {
        const completed = order.status === "done";
        const lines = order.items.map((item) => {
            return [
                '<div class="orderline">',
                "    <b>" + item.quantity + " × " + escapeHtml(item.name) + "</b>",
                selectionSummary(item.components || [], item.selections || {}, escapeHtml),
                "</div>"
            ].join("\n");
        }).join("");

        return [
            '<article class="order">',
            "    <header>",
            '        <span class="eyebrow">#' + escapeHtml(order.id.slice(-6).toUpperCase()) + "</span>",
            '        <span class="status ' + (completed ? "done" : "") + '">' +
                (completed ? escapeHtml(this.t("kitchen.statusDone")) : escapeHtml(this.t("kitchen.statusNew"))) + "</span>",
            "    </header>",
            "    <h3>" + escapeHtml(order.guest_name) + "</h3>",
            '    <p class="muted">' + formatTime(order.created_at, this.translator) + "</p>",
            lines,
            "    <p><b>" + formatPrice(order.total_cents, this.translator) + "</b></p>",
            '    <button type="button" class="btn ' + (completed ? "ghost" : "dark") +
                '" data-action="change-status" data-id="' + escapeHtml(order.id) +
                '" data-status="' + (completed ? "new" : "done") + '">' +
                (completed ? escapeHtml(this.t("kitchen.markNew")) : escapeHtml(this.t("kitchen.markDone"))) + "</button>",
            "</article>"
        ].join("\n");
    }

    renderSharing() {
        const url = guestUrl(this.room.id);
        let qrMarkup;

        try {
            qrMarkup = window.QR.make(url);
        } catch (error) {
            qrMarkup = "<p>" + escapeHtml(this.t(error.message)) + "</p>";
        }

        return [
            '<div class="panel share-panel">',
            '    <p class="eyebrow">' + escapeHtml(this.t("kitchen.invite")) + "</p>",
            "    <h2>" + escapeHtml(this.t("kitchen.scan")) + "</h2>",
            '    <p class="muted">' + escapeHtml(this.t("kitchen.shareHelp")) + "</p>",
            '    <div class="qr-holder">' + qrMarkup + "</div>",
            '    <p class="share-url">' + escapeHtml(url) + "</p>",
            '    <div class="actions">',
            actionButton(this.t("kitchen.copyLink"), "copy-link", "dark"),
            actionButton(this.t("kitchen.printQr"), "print-qr", "ghost"),
            "    </div>",
            "</div>"
        ].join("\n");
    }

    async handleAction(button) {
        switch (button.dataset.action) {
            case "switch-tab":
                this.tab = button.dataset.tab;
                this.render();
                break;

            case "extend-room": {
                if (this.extendingRoom) {
                    break;
                }

                this.extendingRoom = true;
                button.disabled = true;

                try {
                    const result = await this.api.request("extend_room", {
                        roomId: this.room.id,
                        ownerToken: this.session.ownerToken(this.room.id)
                    });

                    this.expiresAt = result.expiresAt;
                    this.render();
                    this.dialog.notify("messages.roomExtended");
                } catch (error) {
                    if (error.translationKey === "errors.api.kitchenNotFound") {
                        this.showExpiredRoom();
                    } else {
                        throw error;
                    }
                } finally {
                    this.extendingRoom = false;
                    this.updateRoomCountdown();
                }

                break;
            }

            case "guest-view":
                location.href = guestUrl(this.room.id);
                break;

            case "share":
                this.tab = "share";
                this.render();
                break;

            case "change-status":
                await this.api.request("update_order", {
                    roomId: this.room.id,
                    ownerToken: this.session.ownerToken(this.room.id),
                    orderId: button.dataset.id,
                    status: button.dataset.status
                });
                await this.refresh();
                break;

            case "copy-link":
                try {
                    await navigator.clipboard.writeText(guestUrl(this.room.id));
                    this.dialog.notify("messages.linkCopied");
                } catch {
                    prompt(this.t("messages.copyLinkFallback"), guestUrl(this.room.id));
                }
                break;

            case "print-qr":
                this.printQr();
                break;
        }
    }

    printQr() {
        const printWindow = window.open("", "_blank");

        if (!printWindow) {
            throw new Error("errors.client.popupBlocked");
        }

        const link = guestUrl(this.room.id);
        const qr = window.QR.make(link);

        printWindow.document.write([
            '<!doctype html><html lang="en"><head><meta charset="utf-8">',
            "<title>Chief — QR</title>",
            "<style>body { text-align: center; font-family: sans-serif; padding: 50px; }",
            "svg { width: 340px; }</style></head><body>",
            "<h1>" + escapeHtml(this.room.name) + "</h1>",
            qr,
            "<p>" + escapeHtml(this.t("kitchen.scanToOrder")) + "</p>",
            "<small>" + escapeHtml(link) + "</small>",
            "</body></html>"
        ].join("\n"));

        printWindow.document.close();
        printWindow.focus();
        printWindow.addEventListener("load", () => printWindow.print(), { once: true });
    }
}
