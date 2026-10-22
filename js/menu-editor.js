import {
    actionButton,
    decodePath,
    encodePath,
    escapeHtml,
    field,
    priceToCents
} from "./core.js";
import { COMPONENT_TYPES, MenuEditorModel } from "./menu.js";

export class MenuEditorController {
    constructor(room, services, onSaved) {
        this.room = room;
        this.api = services.api;
        this.dialog = services.dialog;
        this.templates = services.templates;
        this.session = services.session;
        this.translator = services.translator;
        this.onSaved = onSaved;
        this.model = new MenuEditorModel(room, this.translator);
        this.root = null;
    }

    t(key, params = {}) {
        return this.translator.t(key, params);
    }

    mount(root) {
        this.root = root;
        this.render();

        root.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-editor-action]");

            if (button && root.contains(button)) {
                this.handleAction(button).catch((error) => this.dialog.report(error));
            }
        });

        root.addEventListener("input", (event) => {
            if (event.target.matches("[data-edit]") &&
                !["number", "checkbox"].includes(event.target.type)) {
                this.updateField(event.target);
            }
        });

        root.addEventListener("change", (event) => {
            if (event.target.matches("[data-edit]")) {
                this.updateField(event.target);
            }

            const select = event.target.closest('select[data-editor-change]');

            if (select) {
                this.changeComponentType(select);
            }
        });
    }

    render() {
        const menu = this.model.menu;

        this.root.innerHTML = this.templates.render("editor", {
            roomField: field(this.t("editor.kitchenName"), this.model.roomName, "room-name"),
            menuField: field(this.t("editor.menuTitle"), menu.name, "menu-name"),
            items: menu.items.map((item, index) => this.renderItem(item, index)).join("")
        });

        this.root.querySelector("#import-file").addEventListener("change", (event) => {
            this.importFile(event).catch((error) => this.dialog.report(error));
        });
    }

    renderItem(item, index) {
        return this.templates.render("item", {
            index,
            number: index + 1,
            nameField: field(this.t("editor.dishName"), item.name, "item:" + index + ":name"),
            description: escapeHtml(item.description || ""),
            priceField: field(
                this.t("editor.price"),
                item.basePrice == null ? "" : (item.basePrice / 100).toFixed(2),
                "item:" + index + ":basePrice",
                "number",
                'min="0" step="0.01"'
            ),
            availableYes: item.available !== false ? "selected" : "",
            availableNo: item.available === false ? "selected" : "",
            components: (item.components || []).map((node, childIndex) => {
                return this.renderComponent(node, [index, "components", childIndex]);
            }).join(""),
            childrenPath: encodePath([index, "components"])
        });
    }

    componentTypeKey(type) {
        return {
            'single-select': 'editor.type.single',
            'multi-select': 'editor.type.multi',
            optional: 'editor.type.optional',
            group: 'editor.type.group',
            text: 'editor.type.text'
        }[type] || 'editor.type.single';
    }

    typeOptions(selectedType) {
        return Object.entries(COMPONENT_TYPES).map(([type, label]) => {
            const selected = type === selectedType ? "selected" : "";

            return '<option value="' + escapeHtml(type) + '" ' + selected + '>' +
                escapeHtml(this.t(this.componentTypeKey(type))) + "</option>";
        }).join("");
    }

    renderComponent(component, path) {
        const pathValue = encodePath(path);
        const key = path.join(".");
        const type = component.type;
        let content = "";

        if (type === "single-select" || type === "multi-select") {
            content = this.renderChoiceComponent(component, path);
        } else if (type === "text") {
            content = [
                '<label class="switchline">',
                '    <input type="checkbox" data-edit="node:' + key + ':required" ' +
                    (component.required ? "checked" : "") + "> " + this.t("editor.requiredNotes"),
                "</label>",
                field(this.t("editor.maxCharacters"), component.maxLength ?? 250,
                    "node:" + key + ":maxLength", "number", 'min="1" max="1000"')
            ].join("\n");
        } else if (type === "optional") {
            content = [
                '<label class="switchline">',
                '    <input type="checkbox" data-edit="node:' + key + ':defaultEnabled" ' +
                    (component.defaultEnabled ? "checked" : "") + "> " + this.t("editor.enabledDefault"),
                "</label>",
                '<div class="details">',
                '    <label class="field">',
                '        <span>' + this.t("editor.childType") + '</span>',
                '        <select data-editor-change="child-type" data-path="' + pathValue + '">',
                this.typeOptions(component.child.type),
                "        </select>",
                "    </label>",
                '    <p class="mini-label">' + this.t("editor.nestedChild") + "</p>",
                this.renderComponent(component.child, [...path, "child"]),
                "</div>"
            ].join("\n");
        } else if (type === "group") {
            content = [
                '<div class="details">',
                '    <p class="mini-label">' + this.t("editor.groupChildren") + "</p>",
                component.children.map((child, index) => {
                    return this.renderComponent(child, [...path, "children", index]);
                }).join(""),
                actionButton(this.t("editor.addGroupChild"), "add-component", "ghost small",
                    'data-editor-action="add-component" data-path="' +
                    encodePath([...path, "children"]) + '"'),
                "</div>"
            ].join("\n");
        }

        return this.templates.render("component", {
            path: pathValue,
            typeName: escapeHtml(this.t(this.componentTypeKey(type))),
            typeOptions: this.typeOptions(type),
            labelField: field(this.t("editor.componentLabel"), component.label, "node:" + key + ":label"),
            body: content
        });
    }

    renderChoiceComponent(component, path) {
        const key = path.join(".");
        const encoded = encodePath(path);
        const options = component.options.map((option, index) => {
            return this.templates.render("option", {
                index,
                path: key,
                nodePath: encoded,
                label: escapeHtml(option.label),
                price: ((option.priceDelta || 0) / 100).toFixed(2)
            });
        }).join("");

        let constraints;

        if (component.type === "single-select") {
            const selected = component.options.find((option) => option.selectedByDefault)?.id || "";

            constraints = [
                '<label class="switchline">',
                '    <input type="checkbox" data-edit="node:' + key + ':required" ' +
                    (component.required ? "checked" : "") + "> " + this.t("editor.requiredChoice"),
                "</label>",
                '<div class="field">',
                "    <label>" + this.t("editor.defaultChoice") + "</label>",
                '    <select data-edit="node:' + key + ':defaultOption">',
                '        <option value="">' + this.t("editor.none") + "</option>",
                component.options.map((option) => {
                    return '<option value="' + escapeHtml(option.id) + '" ' +
                        (option.id === selected ? "selected" : "") + ">" +
                        escapeHtml(option.label) + "</option>";
                }).join(""),
                "    </select>",
                "</div>"
            ].join("\n");
        } else {
            constraints = [
                field(this.t("editor.minSelections"), component.minSelected ?? 0,
                    "node:" + key + ":minSelected", "number", 'min="0"'),
                field(this.t("editor.maxSelections"), component.maxSelected ?? component.options.length,
                    "node:" + key + ":maxSelected", "number", 'min="0"')
            ].join("");
        }

        return [
            '<div class="field">',
            "    <label>" + this.t("editor.choicesAndCharges") + "</label>",
            options,
            '    <button type="button" class="button-link" data-editor-action="add-option" ' +
                'data-path="' + encoded + '">' + this.t("editor.addChoice") + '</button>',
            "</div>",
            '<div class="two">',
            constraints,
            "</div>"
        ].join("\n");
    }

    updateField(element) {
        try {
            const binding = element.dataset.edit;
            let value = element.type === "checkbox" ? element.checked : element.value;

            if (binding === "room-name") {
                this.model.roomName = value;
                return;
            }

            if (binding === "menu-name") {
                this.model.menu.name = value;
                return;
            }

            const [category, pathString, fieldName, optionField] = binding.split(":");

            if (category === "item") {
                const item = this.model.menu.items[Number(pathString)];

                if (fieldName === "basePrice") {
                    value = priceToCents(value);
                }

                if (fieldName === "available") {
                    value = value === "yes";
                }

                item[fieldName] = value;
                return;
            }

            const path = pathString.split(".").map((part) => /^\d+$/.test(part)
                ? Number(part)
                : part);
            const component = this.model.at(path);

            if (category === "node") {
                if (fieldName === "defaultOption") {
                    this.model.setDefaultOption(path, value);
                    return;
                }

                if (["minSelected", "maxSelected", "maxLength"].includes(fieldName)) {
                    value = Number(value);
                }

                component[fieldName] = value;
            } else if (category === "opt") {
                component.options[Number(fieldName)][optionField] =
                    optionField === "priceDelta" ? priceToCents(value) ?? 0 : value;
            }
        } catch (error) {
            this.dialog.report(error);
        }
    }

    changeComponentType(select) {
        try {
            const path = decodePath(select.dataset.path);
            const oldType = select.dataset.editorChange === "child-type"
                ? this.model.at(path).child.type
                : this.model.at(path).type;

            if (oldType === select.value) {
                return;
            }

            if (confirm(this.t("confirm.changeType"))) {
                if (select.dataset.editorChange === "child-type") {
                    this.model.changeOptionalChildType(path, select.value);
                } else {
                    this.model.changeType(path, select.value);
                }
            }

            this.render();
        } catch (error) {
            this.dialog.report(error);
            this.render();
        }
    }

    async handleAction(button) {
        const action = button.dataset.editorAction;
        const path = button.dataset.path ? decodePath(button.dataset.path) : null;
        const index = Number(button.dataset.index);

        switch (action) {
            case "add-item":
                this.model.addItem();
                break;

            case "remove-item":
                this.model.removeItem(index);
                break;

            case "add-component":
                this.openComponentDialog(path);
                return;

            case "remove-component":
                this.model.removeComponent(path);
                break;

            case "add-option":
                this.model.addOption(path);
                break;

            case "remove-option":
                this.model.removeOption(path, index);
                break;

            case "save-menu":
                await this.saveMenu();
                return;

            case "export-menu":
                this.exportMenu();
                return;

            case "import-menu":
                this.root.querySelector("#import-file").click();
                return;

            default:
                return;
        }

        this.render();
    }

    openComponentDialog(path) {
        const backdrop = this.dialog.open(this.templates.render("add-component", {
            choices: this.typeOptions("single-select"),
            path: encodePath(path)
        }));

        backdrop.addEventListener("click", (event) => {
            const button = event.target.closest('[data-editor-action="confirm-add-component"]');

            if (!button) {
                return;
            }

            try {
                const targetPath = decodePath(button.dataset.path);
                const type = backdrop.querySelector("#new-component").value;
                this.model.addComponent(targetPath, type);
                this.dialog.close();
                this.render();
            } catch (error) {
                this.dialog.report(error);
            }
        });
    }

    async saveMenu() {
        const accepted = confirm(this.t("confirm.deleteOrders"));

        if (!accepted) {
            return;
        }

        const result = await this.api.request("save_menu", {
            roomId: this.room.id,
            ownerToken: this.session.ownerToken(this.room.id),
            revision: this.room.revision,
            name: this.model.roomName,
            menu: this.model.menu,
            confirmDeleteOrders: true
        });

        this.session.saveRoom({
            id: result.room.id,
            token: this.session.ownerToken(result.room.id),
            name: result.room.name
        });

        this.onSaved(result.room);
        this.dialog.notify("messages.menuSaved");
    }

    exportMenu() {
        const blob = new Blob([JSON.stringify(this.model.menu, null, 4)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = "chief-menu-" + this.room.id + ".json";
        anchor.click();

        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async importFile(event) {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        if (file.size > 250000) {
            throw new Error("errors.client.importTooLarge");
        }

        const menu = JSON.parse(await file.text());

        if (!menu || !Array.isArray(menu.items) ||
            typeof menu.id !== "string" || typeof menu.name !== "string") {
            throw new Error("errors.client.invalidMenuJson");
        }

        this.model.menu = menu;
        this.render();
        this.dialog.notify("messages.menuImported");
    }
}
