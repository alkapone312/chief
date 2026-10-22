import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

async function availablePort() {
    const server = net.createServer();

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function waitForServer(baseUrl, process) {
    for (let attempt = 0; attempt < 70; attempt++) {
        if (process.exitCode !== null) {
            throw new Error("PHP server terminated before responding.");
        }

        try {
            const response = await fetch(baseUrl + "/api.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "get_room", roomId: "missing" })
            });

            if (response.status === 404) {
                return;
            }

            const data = await response.json();
            throw new Error("Unexpected PHP response: " + JSON.stringify(data));
        } catch (error) {
            if (!String(error.message).includes("fetch failed")) {
                throw error;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("PHP test server did not start.");
}

async function post(baseUrl, body) {
    const response = await fetch(baseUrl + "/api.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    return { status: response.status, body: await response.json() };
}

function queryDatabase(environment, statement) {
    const result = spawnSync("php", [
        "-r",
        "$db = new PDO('sqlite:' . getenv('DB_FILE')); " +
            "$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); " +
            statement
    ], { env: environment, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

test("rooms expire after 24 hours, owners can extend them and orders cascade", {
    timeout: 20000
}, async (context) => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "chief-room-lifetime-"));
    const environment = {
        ...process.env,
        DB_FILE: join(temporaryDirectory, "chief.sqlite"),
        CHIEF_DB_TABLE_PREFIX: "integration_"
    };

    const hasPhp = spawnSync("php", ["-v"], { encoding: "utf8" });
    assert.equal(hasPhp.status, 0, "PHP CLI must be installed to run integration tests.");

    const port = await availablePort();
    const baseUrl = "http://127.0.0.1:" + port;
    const server = spawn("php", ["-S", "127.0.0.1:" + port, "-t", projectDirectory], {
        env: environment,
        stdio: "ignore"
    });

    context.after(async () => {
        server.kill();
        await rm(temporaryDirectory, { recursive: true, force: true });
    });

    await waitForServer(baseUrl, server);

    const menu = {
        id: "test-menu",
        name: "Test menu",
        items: [{
            id: "coffee",
            name: "Coffee",
            description: "",
            basePrice: 1500,
            currency: "PLN",
            available: true,
            components: []
        }]
    };

    const created = await post(baseUrl, {
        action: "create_room",
        name: "Integration Test",
        menu
    });

    assert.equal(created.status, 200, JSON.stringify(created.body));
    const { roomId, ownerToken } = created.body;
    assert.ok(roomId);
    assert.ok(ownerToken);

    const guestRoom = await post(baseUrl, { action: "get_room", roomId });
    assert.equal(guestRoom.status, 200);
    assert.equal(Object.hasOwn(guestRoom.body.room, "expiresAt"), false);
    assert.equal(Object.hasOwn(guestRoom.body.room, "expires_at"), false);

    const kitchen = await post(baseUrl, {
        action: "get_kitchen",
        roomId,
        ownerToken
    });

    assert.equal(kitchen.status, 200);
    const initialExpiry = kitchen.body.expiresAt;
    assert.ok(initialExpiry >= Math.floor(Date.now() / 1000) + 86390);

    const order = await post(baseUrl, {
        action: "place_order",
        roomId,
        guestName: "Test guest",
        items: [{ itemId: "coffee", quantity: 1, selections: {} }]
    });

    assert.equal(order.status, 200);

    const forbidden = await post(baseUrl, {
        action: "extend_room",
        roomId,
        ownerToken: "wrong-token"
    });

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "errors.api.ownerRequired");

    const extended = await post(baseUrl, {
        action: "extend_room",
        roomId,
        ownerToken
    });

    assert.equal(extended.status, 200);
    assert.equal(extended.body.expiresAt, initialExpiry + 86400);

    const afterExtension = await post(baseUrl, {
        action: "get_kitchen",
        roomId,
        ownerToken
    });

    assert.equal(afterExtension.body.orders.length, 1, "Renewal must preserve orders.");

    queryDatabase(environment,
        '$db->exec("UPDATE integration_rooms SET expires_at = 1");');

    const expired = await post(baseUrl, { action: "get_room", roomId });

    assert.equal(expired.status, 404);
    assert.equal(expired.body.error, "errors.api.kitchenNotFound");

    const remaining = queryDatabase(environment,
        'echo $db->query("SELECT COUNT(*) FROM integration_orders")->fetchColumn();');

    assert.equal(remaining, "0", "Expired room orders should be deleted by cascade.");
});
