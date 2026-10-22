import {
    ApiClient,
    DialogService,
    SessionRepository,
    TemplateRepository,
    escapeHtml
} from "./js/core.js";
import { sampleMenu } from "./js/menu.js";
import { Translator } from "./js/translator.js";
import { ThemeController } from "./js/theme.js";
import { GuestController } from "./js/guest.js";
import { KitchenController, kitchenUrl } from "./js/kitchen.js";

class ChiefApplication {
    constructor(root) {
        this.root = root;
        const translator = new Translator();
        this.services = {
            translator,
            api: new ApiClient(translator),
            dialog: new DialogService(translator),
            session: new SessionRepository(),
            templates: new TemplateRepository([
                "home",
                "new-room",
                "editor",
                "item",
                "component",
                "option",
                "add-component"
            ], translator)
        };

        this.activeController = null;
        this.root.addEventListener("click", (event) => {
            const action = event.target.closest("[data-home-action], [data-action]");

            if (!action) {
                return;
            }

            if (action.dataset.action === "create-room") {
                this.openCreateRoom();
            } else if (action.dataset.homeAction === "open-kitchen") {
                location.href = kitchenUrl(action.dataset.roomId);
            }
        });
    }

    async start() {
        await this.services.translator.load();
        this.services.translator.applyStaticTranslations();

        this.theme = new ThemeController(
            document.getElementById("theme-toggle"),
            this.services.translator
        );
        this.theme.init();
        const selector = document.getElementById("language-select");
        selector.value = this.services.translator.language;
        selector.addEventListener("change", (event) => {
            this.services.translator.selectLanguage(event.target.value);
        });
        await this.services.templates.loadAll();

        const params = new URLSearchParams(location.search);

        if (params.has("chef")) {
            this.activeController = new KitchenController(
                this.root,
                this.services,
                params.get("chef")
            );
        } else if (params.has("room")) {
            this.activeController = new GuestController(
                this.root,
                this.services,
                params.get("room")
            );
        } else {
            this.renderHome();
            return;
        }

        await this.activeController.start();
    }

    renderHome() {
        const t = (key, params) => this.services.translator.t(key, params);
        const savedRooms = this.services.session.rooms;

        const roomCards = savedRooms.length
            ? [
                '<div class="section-heading">',
                "    <h2>" + escapeHtml(t("home.yourKitchens")) + "</h2>",
                '    <span class="muted">' + escapeHtml(t("home.savedHere")) + "</span>",
                "</div>",
                '<div class="rooms">',
                savedRooms.map((room) => {
                    return [
                        '<div class="tile">',
                        '    <span class="eyebrow">' + escapeHtml(t("home.yourKitchen")) + "</span>",
                        "    <h3>" + escapeHtml(room.name) + "</h3>",
                        '    <p>' + escapeHtml(t("home.room", { id: room.id })) + "</p>",
                        '    <button class="btn dark small" type="button"',
                        '        data-home-action="open-kitchen"',
                        '        data-room-id="' + escapeHtml(room.id) + '">',
                        "        " + escapeHtml(t("home.openDashboard")),
                        "    </button>",
                        "</div>"
                    ].join("\n");
                }).join(""),
                "</div>"
            ].join("\n")
            : "";

        this.root.innerHTML = this.services.templates.render("home", {
            savedRooms: roomCards
        });
    }

    openCreateRoom() {
        const overlay = this.services.dialog.open(
            this.services.templates.render("new-room")
        );

        const form = overlay.querySelector("#create-room-form");
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            this.createRoom(form).catch((error) => this.services.dialog.report(error));
        });

        overlay.querySelector("#new-room-name").focus();
    }

    async createRoom(form) {
        const name = form.querySelector("#new-room-name").value.trim();

        if (!name) {
            throw new Error("errors.client.enterKitchen");
        }

        const result = await this.services.api.request("create_room", {
            name,
            menu: sampleMenu()
        });

        this.services.session.saveRoom({
            id: result.roomId,
            name,
            token: result.ownerToken
        });

        location.href = kitchenUrl(result.roomId);
    }
}

const root = document.getElementById("app");
const application = new ChiefApplication(root);

application.start().catch((error) => {
    console.error(error);

    root.innerHTML = [
        '<div class="empty">',
        "    <strong>" + escapeHtml(application.services.translator.t("app.unavailable")) + "</strong>",
        "    <p>" + escapeHtml(application.services.translator.t(error.message)) + "</p>",
        '    <p><a href="./">' + escapeHtml(application.services.translator.t("app.backHome")) + "</a></p>",
        "</div>"
    ].join("\n");
});
