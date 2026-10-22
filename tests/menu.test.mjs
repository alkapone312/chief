import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
    MenuComponentFactory,
    MenuEditorModel,
    MenuSelection,
    sampleMenu
} from "../js/menu.js";

globalThis.crypto ??= webcrypto;

function createEditor() {
    return new MenuEditorModel({
        id: "test-room",
        name: "Test kitchen",
        menu: sampleMenu(),
        revision: 1
    });
}

function testOptionalChildTypes() {
    const editor = createEditor();
    const optionalPath = [0, "components", 2];

    for (const type of [
        "single-select",
        "multi-select",
        "group",
        "text",
        "optional"
    ]) {
        editor.changeOptionalChildType(optionalPath, type);

        assert.equal(editor.at([...optionalPath, "child"]).type, type);
        assert.equal(editor.at(optionalPath).type, "optional");
    }
}

function testNestedGroups() {
    const editor = createEditor();
    const optionalPath = [0, "components", 2];

    editor.changeOptionalChildType(optionalPath, "group");

    const childrenPath = [...optionalPath, "child", "children"];
    editor.addComponent(childrenPath, "multi-select");

    assert.equal(editor.at([...childrenPath, 0]).type, "multi-select");

    editor.changeType([...childrenPath, 0], "text");
    assert.equal(editor.at([...childrenPath, 0]).type, "text");

    editor.removeComponent([...childrenPath, 0]);
    assert.equal(editor.at(childrenPath).length, 0);
}

function testOptionOperations() {
    const editor = createEditor();
    const choicePath = [0, "components", 0];
    const before = editor.at(choicePath).options.length;

    editor.addOption(choicePath);
    assert.equal(editor.at(choicePath).options.length, before + 1);

    editor.removeOption(choicePath, before);
    assert.equal(editor.at(choicePath).options.length, before);
}

function testGuestSelection() {
    const selection = new MenuSelection(sampleMenu().items[0]);

    selection.set("extra-sauce", true);
    selection.set("sauce", "bbq");
    selection.set("extras", "cheese", true, "multi-select");
    selection.validate();

    assert.deepEqual(selection.values.extras, ["cheese"]);

    selection.set("extras", "cheese", false, "multi-select");
    assert.deepEqual(selection.values.extras, []);
}

function testComponentFactory() {
    assert.equal(MenuComponentFactory.create("group").children.length, 0);
    assert.equal(MenuComponentFactory.create("optional").child.type, "single-select");
    assert.equal(MenuComponentFactory.create("text").maxLength, 250);
}

testOptionalChildTypes();
testNestedGroups();
testOptionOperations();
testGuestSelection();
testComponentFactory();

console.log("All Chief menu model tests passed.");
