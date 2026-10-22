import {
    actionButton,
    escapeHtml,
    formatPrice
} from "./core.js";
import { MenuSelection, selectionSummary } from "./menu.js";

export class GuestController {
    constructor(root, services, roomId) {
        this.root = root;
        this.api = services.api;
        this.dialog = services.dialog;
        this.session = services.session;
        this.translator = services.translator;
        this.roomId = roomId;
        this.room = null;
        this.cart = [];
        this.receipts = this.session.readReceipts(roomId);
        this.guestName = this.session.guestName;
        this.editing = null;
        this.pollTimer = null;
        this.roomPollTimer = null;
        this.closed = false;

        this.root.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (button) {
                this.handleAction(button).catch((error) => this.dialog.report(error));
            }
        });
    }

    t(key, parameters = {}) {
        return this.translator.t(key, parameters);
    }

    async start() {
        try {
            const result = await this.api.request("get_room", { roomId: this.roomId });
            this.room = result.room;
        } catch (error) {
            if (error.translationKey === "errors.api.kitchenNotFound") {
                this.showClosedRoom();
                return;
            }

            throw error;
        }

        this.render();

        this.pollTimer = setInterval(() => {
            this.refreshReceipts().catch((error) => console.error(error));
        }, 5000);

        this.roomPollTimer = setInterval(() => {
            this.checkRoomAvailable().catch((error) => console.error(error));
        }, 30000);
    }

    stop() {
        clearInterval(this.pollTimer);
        clearInterval(this.roomPollTimer);
    }

    showClosedRoom() {
        this.closed = true;
        this.stop();
        this.cart = [];
        this.receipts = [];
        this.session.saveReceipts(this.roomId, []);
        this.dialog.close();
        this.root.innerHTML = [
            '<div class="empty">',
            '    <strong>' + escapeHtml(this.t("guest.kitchenClosed")) + '</strong>',
            '    <p>' + escapeHtml(this.t("guest.kitchenClosedDescription")) + '</p>',
            '</div>'
        ].join("\n");
    }

    async checkRoomAvailable() {
        if (this.closed) {
            return;
        }

        try {
            await this.api.request("get_room", { roomId: this.roomId });
        } catch (error) {
            if (error.translationKey === "errors.api.kitchenNotFound") {
                this.showClosedRoom();
                return;
            }

            throw error;
        }
    }

    render() {
        const room = this.room;
        const available = room.menu.items.filter((item) => item.available !== false);

        const dishes = available.map((item, index) => {
            return [
                '<article class="dish">',
                '    <span class="eyebrow">' + escapeHtml(this.t("guest.dishNumber", { number: String(index + 1).padStart(2, "0") })) + "</span>",
                "    <h3>" + escapeHtml(item.name) + "</h3>",
                "    <p>" + escapeHtml(item.description || "") + "</p>",
                '    <div class="price">' + formatPrice(item.basePrice, this.translator) + "</div>",
                '    <button class="btn dark" type="button" data-action="customize" ' +
                    'data-id="' + escapeHtml(item.id) + '">'+ escapeHtml(this.t("guest.addToOrder")) + '</button>',
                "</article>"
            ].join("\n");
        }).join("");

        const receiptsSection = this.receipts.length
            ? '<section><div class="section-heading"><h2>' + escapeHtml(this.t("guest.yourOrders")) + '</h2></div>' +
                this.renderReceipts() + "</section>"
            : "";

        const checkout = this.cart.length
            ? [
                '<div class="checkout">',
                "    <div>",
                "        <strong>" + escapeHtml(this.t("guest.cartItems", { count: this.cart.reduce((sum, item) => sum + item.quantity, 0) })) +
                    "</strong>",
                '        <div class="checkout-hint">' + escapeHtml(this.t("guest.readyToSend")) + "</div>",
                "    </div>",
                actionButton(this.t("guest.viewCart"), "open-cart", ""),
                "</div>"
            ].join("\n")
            : "";

        this.root.innerHTML = [
            '<div class="workspace-head">',
            "    <div>",
            '        <p class="eyebrow">' + escapeHtml(this.t("guest.welcome")) + "</p>",
            "        <h1>" + escapeHtml(room.name) + "</h1>",
            '        <span class="muted">' + escapeHtml(this.t("guest.intro")) + "</span>",
            "    </div>",
            '    <div class="top-pill">' + escapeHtml(this.t("guest.menuOpen")) + "</div>",
            "</div>",
            receiptsSection,
            '<div class="section-heading">',
            "    <h2>" + escapeHtml(room.menu.name) + "</h2>",
            '    <span class="muted">' + escapeHtml(this.t("guest.dishes", { count: available.length })) + "</span>",
            "</div>",
            '<section class="menu-list">',
            dishes,
            "</section>",
            available.length ? "" : '<div class="empty">' + escapeHtml(this.t("guest.noDishes")) + "</div>",
            checkout
        ].join("\n");
    }

    renderReceipts() {
        return '<div class="rooms">' + this.receipts.map((receipt) => {
            const complete = receipt.status === "done";

            return [
                '<div class="receipt">',
                '    <p class="eyebrow">' + escapeHtml(this.t("guest.orderNumber", { id: receipt.id.slice(-6).toUpperCase() })) + "</p>",
                "    <h3>" + escapeHtml(receipt.name) + "</h3>",
                '    <span class="status ' + (complete ? "done" : "") + '">' +
                    (complete ? escapeHtml(this.t("guest.ready")) : escapeHtml(this.t("guest.preparing"))) + "</span>",
                "</div>"
            ].join("\n");
        }).join("") + "</div>";
    }

    async refreshReceipts() {
        if (!this.receipts.length || !this.room) {
            return;
        }

        let changed = false;

        for (const receipt of [...this.receipts]) {
            try {
                const result = await this.api.request("order_status", {
                    roomId: this.roomId,
                    orderId: receipt.id,
                    receiptToken: receipt.token
                });

                if (receipt.status !== result.order.status) {
                    receipt.status = result.order.status;
                    changed = true;
                }
            } catch (error) {
                if (error.translationKey === "errors.api.kitchenNotFound") {
                    this.showClosedRoom();
                    return;
                }

                if (error.translationKey === "errors.api.orderExpired") {
                    this.receipts = this.receipts.filter((entry) => entry !== receipt);
                    changed = true;
                }
            }
        }

        if (changed) {
            this.session.saveReceipts(this.roomId, this.receipts);
            this.render();
        }
    }

    async handleAction(button) {
        switch (button.dataset.action) {
            case "customize":
                this.openCustomize(button.dataset.id);
                break;

            case "open-cart":
                this.openCart();
                break;
        }
    }

    openCustomize(itemId) {
        const item = this.room.menu.items.find((entry) => entry.id === itemId);

        if (!item || item.available === false) {
            throw new Error("errors.client.dishUnavailable");
        }

        this.editing = {
            item,
            selection: new MenuSelection(item),
            quantity: 1
        };

        this.renderCustomize();
    }

    renderCustomize() {
        const { item, selection, quantity } = this.editing;

        const markup = [
            '<p class="eyebrow">' + escapeHtml(this.t("guest.customize")) + "</p>",
            "<h2>" + escapeHtml(item.name) + "</h2>",
            '<p class="muted">' + escapeHtml(item.description || "") + "</p>",
            '<div class="divider"></div>',
            this.renderGuestComponents(item.components || [], selection.values),
            '<div class="divider"></div>',
            '<div class="field">',
            '    <label for="order-quantity">' + escapeHtml(this.t("guest.quantity")) + "</label>",
            '    <input type="number" id="order-quantity" min="1" max="20" value="' +
                quantity + '">',
            "</div>",
            '<div class="divider"></div>',
            actionButton(this.t("guest.addToCart"), "confirm-customization", "dark"),
        ].join("\n");

        const backdrop = this.dialog.open(markup);

        backdrop.addEventListener("change", (event) => {
            const choice = event.target.closest("[data-choice-id]");

            if (choice) {
                this.updateChoice(choice);
            }
        });

        backdrop.addEventListener("input", (event) => {
            if (event.target.id === "order-quantity") {
                this.editing.quantity = Number(event.target.value);
            }

            if (event.target.matches('textarea[data-choice-id]')) {
                this.updateChoice(event.target);
            }
        });

        backdrop.addEventListener("click", (event) => {
            if (event.target.closest('[data-action="confirm-customization"]')) {
                try {
                    this.confirmCustomization();
                } catch (error) {
                    this.dialog.report(error);
                }
            }
        });
    }

    renderGuestComponents(nodes, values) {
        return nodes.map((node) => {
            const id = escapeHtml(node.id);
            let control = "";

            if (node.type === "group") {
                control = this.renderGuestComponents(node.children, values);
            } else if (node.type === "optional") {
                control = [
                    '<label class="choice">',
                    '    <input type="checkbox" data-choice-id="' + id +
                        '" data-choice-type="optional" ' +
                        (values[node.id] ? "checked" : "") + "> " + escapeHtml(this.t("guest.enableOption")),
                    "</label>",
                    values[node.id] ? this.renderGuestComponents([node.child], values) : ""
                ].join("\n");
            } else if (node.type === "text") {
                control = '<textarea class="styled" data-choice-id="' + id +
                    '" data-choice-type="text" maxlength="' + (node.maxLength ?? 250) +
                    '" placeholder="' + escapeHtml(this.t("guest.notePlaceholder")) + '">' + escapeHtml(values[node.id] || "") +
                    "</textarea>";
            } else {
                control = '<div class="choices">' + node.options.map((option) => {
                    const multi = node.type === "multi-select";
                    const checked = multi
                        ? (values[node.id] || []).includes(option.id)
                        : values[node.id] === option.id;
                    const type = multi ? "checkbox" : "radio";

                    return [
                        '<label class="choice">',
                        '    <input type="' + type + '" name="component-' + id + '"',
                        '        data-choice-id="' + id + '"',
                        '        data-choice-type="' + node.type + '"',
                        '        value="' + escapeHtml(option.id) + '"',
                        checked ? "checked" : "",
                        "    >",
                        "    <span>" + escapeHtml(option.label) + "</span>",
                        option.priceDelta
                            ? "    <small>+" + formatPrice(option.priceDelta, this.translator) + "</small>"
                            : "",
                        "</label>"
                    ].join("\n");
                }).join("") + "</div>";
            }

            return [
                '<div class="details">',
                "    <p><b>" + escapeHtml(node.label) + "</b></p>",
                control,
                "</div>"
            ].join("\n");
        }).join("");
    }

    updateChoice(element) {
        const type = element.dataset.choiceType;
        const value = type === "optional" ? element.checked : element.value;

        this.editing.selection.set(
            element.dataset.choiceId,
            value,
            element.checked,
            type
        );

        if (type === "optional") {
            const quantityInput = document.getElementById("order-quantity");
            this.editing.quantity = Number(quantityInput?.value || 1);
            this.renderCustomize();
        }
    }

    confirmCustomization() {
        const { item, selection } = this.editing;
        const quantity = Number(document.getElementById("order-quantity").value);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            throw new Error("errors.client.invalidQuantity");
        }

        selection.validate();

        this.cart.push({
            itemId: item.id,
            name: item.name,
            quantity,
            selections: structuredClone(selection.values)
        });

        this.dialog.close();
        this.render();
        this.dialog.notify("messages.addedCart");
    }

    openCart() {
        const lines = this.cart.map((entry, index) => {
            const item = this.room.menu.items.find((dish) => dish.id === entry.itemId);

            return [
                '<div class="cart-row">',
                "    <div>",
                "        <b>" + entry.quantity + " × " + escapeHtml(entry.name) + "</b>",
                selectionSummary(item?.components || [], entry.selections, escapeHtml),
                "    </div>",
                '    <button class="btn danger small" type="button" data-remove-cart="' +
                    index + '" aria-label="' + escapeHtml(this.t("guest.removeFromCart")) + '">×</button>',
                "</div>"
            ].join("\n");
        }).join("");

        const backdrop = this.dialog.open([
            '<p class="eyebrow">' + escapeHtml(this.t("guest.cartSummary")) + "</p>",
            "<h2>" + escapeHtml(this.t("guest.yourCart")) + "</h2>",
            lines,
            '<div class="divider"></div>',
            '<div class="field">',
            '    <label for="guest-name">' + escapeHtml(this.t("guest.yourName")) + "</label>",
            '    <input id="guest-name" maxlength="80" value="' +
                escapeHtml(this.guestName) + '" placeholder="' + escapeHtml(this.t("guest.yourNamePlaceholder")) + '">',
            "</div>",
            '<p class="side-note">' + escapeHtml(this.t("guest.orderAgain")) + "</p>",
            actionButton(this.t("guest.send"), "submit-cart", "dark")
        ].join("\n"));

        backdrop.addEventListener("click", (event) => {
            const removeButton = event.target.closest("[data-remove-cart]");

            if (removeButton) {
                this.cart.splice(Number(removeButton.dataset.removeCart), 1);

                if (this.cart.length) {
                    this.openCart();
                } else {
                    this.dialog.close();
                    this.render();
                }

                return;
            }

            if (event.target.closest('[data-action="submit-cart"]')) {
                this.submitCart().catch((error) => {
                    if (error.translationKey === "errors.api.kitchenNotFound") {
                        this.showClosedRoom();
                    } else {
                        this.dialog.report(error);
                    }
                });
            }
        });
    }

    async submitCart() {
        const name = document.getElementById("guest-name").value.trim();

        if (!name) {
            throw new Error("errors.client.enterName");
        }

        const result = await this.api.request("place_order", {
            roomId: this.roomId,
            guestName: name,
            items: this.cart.map((item) => ({
                itemId: item.itemId,
                quantity: item.quantity,
                selections: item.selections
            }))
        });

        this.guestName = name;
        this.session.guestName = name;
        this.receipts.unshift({
            id: result.orderId,
            token: result.receiptToken,
            status: "new",
            name
        });
        this.session.saveReceipts(this.roomId, this.receipts);
        this.cart = [];
        this.dialog.close();
        this.render();
        this.dialog.notify("messages.orderSent");
    }
}
