import { createId } from "./core.js";

export const COMPONENT_TYPES = Object.freeze({
    "single-select": "Single choice",
    "multi-select": "Multiple choices",
    "optional": "Optional",
    "group": "Group",
    "text": "Text notes"
});

export class MenuComponentFactory {
    static create(type, translator = null) {
        const common = {
            id: createId("component"),
            type,
            label: translator?.t("editor.newComponentName") ?? "New component"
        };

        switch (type) {
            case "single-select":
                return {
                    ...common,
                    required: true,
                    options: [{
                        id: createId("option"),
                        label: translator?.t("editor.initialChoice") ?? "Option 1",
                        priceDelta: 0,
                        selectedByDefault: true
                    }]
                };

            case "multi-select":
                return {
                    ...common,
                    minSelected: 0,
                    maxSelected: 1,
                    options: [{
                        id: createId("option"),
                        label: "Option 1",
                        priceDelta: 0
                    }]
                };

            case "optional":
                return {
                    ...common,
                    defaultEnabled: false,
                    child: this.create("single-select", translator)
                };

            case "group":
                return {
                    ...common,
                    children: []
                };

            case "text":
                return {
                    ...common,
                    required: false,
                    maxLength: 250
                };

            default:
                throw new Error("errors.client.unsupportedType");
        }
    }
}

export class MenuEditorModel {
    constructor(room, translator = null) {
        this.translator = translator;
        this.roomName = room.name;
        this.menu = structuredClone(room.menu);
    }

    at(path) {
        if (!Array.isArray(path) || !Number.isInteger(path[0])) {
            throw new Error("errors.client.invalidModelPath");
        }

        let value = this.menu.items[path[0]];

        for (const key of path.slice(1)) {
            if (value === null || value === undefined) {
                throw new Error("errors.client.elementMissing");
            }

            value = value[key];
        }

        if (value === undefined) {
            throw new Error("errors.client.elementMissing");
        }

        return value;
    }

    addItem() {
        this.menu.items.push({
            id: createId("dish"),
            name: this.translator?.t("editor.newDishName") ?? "New dish",
            description: "",
            basePrice: null,
            currency: "PLN",
            available: true,
            components: []
        });
    }

    removeItem(index) {
        this.menu.items.splice(index, 1);
    }

    addComponent(collectionPath, type) {
        const collection = this.at(collectionPath);

        if (!Array.isArray(collection)) {
            throw new Error("errors.client.notCollection");
        }

        if (this.depth(collectionPath) > 8) {
            throw new Error("errors.client.nestingLimit");
        }

        collection.push(MenuComponentFactory.create(type, this.translator));
    }

    depth(path) {
        return path.filter((entry) => entry === "child" || entry === "children").length + 1;
    }

    removeComponent(path) {
        if (path.at(-1) === "child") {
            throw new Error("errors.client.optionalRequiresChild");
        }

        const collection = this.at(path.slice(0, -1));

        if (!Array.isArray(collection)) {
            throw new Error("errors.client.invalidCollection");
        }

        collection.splice(path.at(-1), 1);
    }

    changeType(path, type) {
        const oldNode = this.at(path);
        const replacement = MenuComponentFactory.create(type);

        // Preserve the user's visible label, but regenerate nested IDs/configuration.
        replacement.label = oldNode.label;

        const parent = this.at(path.slice(0, -1));
        parent[path.at(-1)] = replacement;
    }

    changeOptionalChildType(optionalPath, type) {
        const optional = this.at(optionalPath);

        if (optional.type !== "optional") {
            throw new Error("errors.client.notOptional");
        }

        const replacement = MenuComponentFactory.create(type);
        replacement.label = optional.child?.label || replacement.label;
        optional.child = replacement;
    }

    addOption(path) {
        const node = this.at(path);

        if (node.options.length >= 40) {
            throw new Error("errors.client.maxOptions");
        }

        node.options.push({
            id: createId("option"),
            label: this.translator?.t("editor.newChoiceName") ?? "New option",
            priceDelta: 0
        });

        if (node.type === "multi-select") {
            node.maxSelected = node.options.length;
        }
    }

    removeOption(path, index) {
        const node = this.at(path);

        if (node.options.length <= 1) {
            throw new Error("errors.client.minOptions");
        }

        node.options.splice(index, 1);

        if (node.type === "multi-select") {
            node.maxSelected = Math.min(node.maxSelected, node.options.length);
            node.minSelected = Math.min(node.minSelected, node.maxSelected);
        }
    }

    setDefaultOption(path, optionId) {
        const node = this.at(path);

        for (const option of node.options) {
            option.selectedByDefault = optionId !== "" && option.id === optionId;
        }
    }
}

export class MenuSelection {
    constructor(item) {
        this.item = item;
        this.values = {};

        this.walk(item.components || [], (node) => {
            switch (node.type) {
                case "optional":
                    this.values[node.id] = Boolean(node.defaultEnabled);
                    break;

                case "single-select":
                    this.values[node.id] = node.options.find((option) => option.selectedByDefault)?.id || "";
                    break;

                case "multi-select":
                    this.values[node.id] = node.options
                        .filter((option) => option.selectedByDefault)
                        .map((option) => option.id);
                    break;

                case "text":
                    this.values[node.id] = "";
                    break;
            }
        });
    }

    walk(nodes, visitor) {
        for (const node of nodes) {
            visitor(node);

            if (node.type === "group") {
                this.walk(node.children, visitor);
            }

            if (node.type === "optional") {
                this.walk([node.child], visitor);
            }
        }
    }

    set(id, value, checked = true, kind = "") {
        if (kind === "multi-select") {
            const current = this.values[id] || [];

            this.values[id] = checked
                ? [...new Set([...current, value])]
                : current.filter((entry) => entry !== value);

            return;
        }

        this.values[id] = value;
    }

    isActive(id, nodes = this.item.components || []) {
        for (const node of nodes) {
            if (node.id === id) {
                return true;
            }

            if (node.type === "group" && this.isActive(id, node.children)) {
                return true;
            }

            if (node.type === "optional" && this.values[node.id] &&
                this.isActive(id, [node.child])) {
                return true;
            }
        }

        return false;
    }

    validate() {
        let invalid = "";

        this.walk(this.item.components || [], (node) => {
            if (invalid || !this.isActive(node.id)) {
                return;
            }

            const value = this.values[node.id];

            if (node.type === "single-select" && node.required && !value) {
                invalid = "errors.client.requiredChoice";
            }

            if (node.type === "multi-select") {
                const count = value.length;
                const max = node.maxSelected ?? node.options.length;

                if (count < (node.minSelected || 0) || count > max) {
                    invalid = "errors.client.invalidChoiceCount";
                }
            }

            if (node.type === "text" && node.required && !String(value).trim()) {
                invalid = "errors.client.requiredText";
            }
        });

        if (invalid) {
            throw new Error(invalid);
        }
    }
}

export function selectionSummary(nodes, selections, escapeHtml) {
    const details = [];

    const visit = (children, enabled = true) => {
        for (const node of children) {
            if (node.type === "group") {
                visit(node.children, enabled);
            } else if (node.type === "optional") {
                visit([node.child], enabled && Boolean(selections[node.id]));
            } else if (enabled) {
                const selected = selections[node.id];

                if (node.type === "text" && selected) {
                    details.push(escapeHtml(node.label) + ": " + escapeHtml(selected));
                } else if (node.options) {
                    const ids = Array.isArray(selected) ? selected : (selected ? [selected] : []);
                    const labels = ids.map((id) => node.options.find((option) => option.id === id)?.label)
                        .filter(Boolean)
                        .map(escapeHtml);

                    if (labels.length) {
                        details.push(escapeHtml(node.label) + ": " + labels.join(", "));
                    }
                }
            }
        }
    };

    visit(nodes);
    return details.length
        ? '<div class="muted selection-summary">' + details.join("<br>") + "</div>"
        : "";
}

export function sampleMenu() {
    return {
        id: "restaurant-menu",
        name: "Restaurant menu",
        items: [{
            id: "burger-classic",
            name: "Classic beef burger",
            description: "Beef burger with lettuce and tomato",
            basePrice: 3200,
            currency: "PLN",
            available: true,
            components: [
                {
                    id: "doneness",
                    type: "single-select",
                    label: "Doneness",
                    required: true,
                    options: [
                        { id: "medium", label: "Medium", priceDelta: 0, selectedByDefault: true },
                        { id: "medium-well", label: "Medium well", priceDelta: 0 },
                        { id: "well-done", label: "Well done", priceDelta: 0 }
                    ]
                },
                {
                    id: "extras",
                    type: "multi-select",
                    label: "Extras",
                    minSelected: 0,
                    maxSelected: 3,
                    options: [
                        { id: "cheese", label: "Cheddar", priceDelta: 300 },
                        { id: "bacon", label: "Bacon", priceDelta: 500 },
                        { id: "jalapeno", label: "Jalapeño", priceDelta: 200 }
                    ]
                },
                {
                    id: "extra-sauce",
                    type: "optional",
                    label: "Extra sauce",
                    defaultEnabled: false,
                    child: {
                        id: "sauce",
                        type: "single-select",
                        label: "Sauce type",
                        required: true,
                        options: [
                            { id: "bbq", label: "BBQ", priceDelta: 200 },
                            { id: "garlic", label: "Garlic", priceDelta: 200 },
                            { id: "spicy", label: "Spicy", priceDelta: 300 }
                        ]
                    }
                },
                {
                    id: "notes",
                    type: "text",
                    label: "Order notes",
                    required: false,
                    maxLength: 250
                },
                {
                    id: "packaging",
                    type: "group",
                    label: "Packaging",
                    children: [{
                        id: "cutlery",
                        type: "optional",
                        label: "Cutlery",
                        child: {
                            id: "cutlery-type",
                            type: "single-select",
                            label: "Cutlery type",
                            required: true,
                            options: [
                                { id: "wooden", label: "Wooden", priceDelta: 0 },
                                { id: "reusable", label: "Reusable", priceDelta: 200 }
                            ]
                        }
                    }]
                }
            ]
        }]
    };
}
