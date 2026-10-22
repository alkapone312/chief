import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { KitchenController } from "../js/kitchen.js";
import { GuestController } from "../js/guest.js";

const translator = {
    locale: "en-GB",
    t(key) {
        return key === "kitchen.roomExpired" ? "Expired" : key;
    }
};

function kitchenFixture() {
    const countdown = { textContent: "" };
    const extendButton = { disabled: false };
    const root = {
        addEventListener() {},
        querySelector(selector) {
            if (selector === "[data-room-countdown]") {
                return countdown;
            }

            if (selector === '[data-action="extend-room"]') {
                return extendButton;
            }

            return null;
        }
    };

    const kitchen = new KitchenController(root, {
        api: null,
        session: null,
        dialog: null,
        templates: null,
        translator
    }, "test-room");

    return { kitchen, countdown, extendButton };
}

test("chef countdown uses the server's expiration timestamp", () => {
    const fixture = kitchenFixture();
    const originalNow = Date.now;

    try {
        Date.now = () => 0;
        fixture.kitchen.expiresAt = 3661;
        fixture.kitchen.updateRoomCountdown();

        assert.equal(fixture.countdown.textContent, "01:01:01");
        assert.equal(fixture.extendButton.disabled, false);

        fixture.kitchen.expiresAt = 0;
        fixture.kitchen.updateRoomCountdown();

        assert.equal(fixture.countdown.textContent, "Expired");
        assert.equal(fixture.extendButton.disabled, true);
    } finally {
        Date.now = originalNow;
    }
});

test("guest interface contains no room expiration timer or renewal controls", () => {
    const root = {
        innerHTML: "",
        addEventListener() {}
    };

    const guest = new GuestController(root, {
        api: null,
        dialog: null,
        session: {
            readReceipts: () => [],
            guestName: ""
        },
        translator
    }, "test-room");

    guest.room = {
        name: "A test kitchen",
        menu: {
            name: "Menu",
            items: []
        }
    };

    guest.render();

    assert.doesNotMatch(root.innerHTML, /room-countdown|extend-room|room-lifetime/);
    assert.doesNotMatch(root.innerHTML, /expiresAt|expires_at/);
});

test("API exposes expiry only on chef endpoint", async () => {
    const source = await readFile(new URL("../api.php", import.meta.url), "utf8");
    const publicRoom = source.split("private function publicRoom(array $room): array")[1]
        .split("private function parseMenu")[0];
    const kitchen = source.split("private function getKitchen(array $room, array $request): array")[1]
        .split("private function saveMenu")[0];

    assert.doesNotMatch(publicRoom, /expiresAt|expires_at/);
    assert.match(kitchen, /'expiresAt' => \(int\) \$room\['expires_at'\]/);
    assert.match(source, /private function extendRoom\(/);
    assert.match(source, /ON DELETE CASCADE/);
});
