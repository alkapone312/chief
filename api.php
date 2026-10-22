<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

final class ApiException extends RuntimeException
{
    public function __construct(string $message, public readonly int $statusCode = 400)
    {
        parent::__construct($message);
    }
}

final class Text
{
    public static function length(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
    }

    public static function validId(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $value) === 1;
    }

    public static function requireLabel(mixed $value): void
    {
        if (!is_string($value) || trim($value) === '' || self::length($value) > 120) {
            throw new ApiException('errors.api.invalidLabel');
        }
    }
}

abstract class MenuNode
{
    public function __construct(protected array $data)
    {
    }

    abstract public function validate(int $depth = 0): void;

    public function toArray(): array
    {
        return $this->data;
    }
}

/**
 * Composite menu node.
 *
 * "group" owns a list of MenuComponent children.
 * "optional" owns one MenuComponent child.
 * The other component types are leaves.
 */
final class MenuComponent extends MenuNode
{
    public function validate(int $depth = 0): void
    {
        if ($depth > 8) {
            throw new ApiException('errors.api.nestingLimit');
        }

        if (!Text::validId($this->data['id'] ?? null)) {
            throw new ApiException('errors.api.invalidComponentId');
        }

        Text::requireLabel($this->data['label'] ?? null);
        $type = $this->data['type'] ?? null;

        switch ($type) {
            case 'single-select':
            case 'multi-select':
                $this->validateOptions($type);
                break;

            case 'text':
                $limit = $this->data['maxLength'] ?? 250;

                if (!is_int($limit) || $limit < 1 || $limit > 1000) {
                    throw new ApiException('errors.api.invalidTextLimit');
                }
                break;

            case 'optional':
                $child = $this->data['child'] ?? null;

                if (!is_array($child)) {
                    throw new ApiException('errors.api.optionalChildRequired');
                }

                (new self($child))->validate($depth + 1);
                break;

            case 'group':
                $children = $this->data['children'] ?? null;

                if (!is_array($children) || !array_is_list($children) || count($children) > 30) {
                    throw new ApiException('errors.api.invalidGroup');
                }

                foreach ($children as $child) {
                    if (!is_array($child)) {
                        throw new ApiException('errors.api.invalidGroupChild');
                    }

                    (new self($child))->validate($depth + 1);
                }
                break;

            default:
                throw new ApiException('errors.api.unsupportedType');
        }
    }

    private function validateOptions(string $type): void
    {
        $options = $this->data['options'] ?? null;

        if (!is_array($options) || !array_is_list($options) ||
            count($options) < 1 || count($options) > 40) {
            throw new ApiException('errors.api.invalidOptions');
        }

        $usedIds = [];
        $defaultCount = 0;

        foreach ($options as $option) {
            if (!is_array($option) || !Text::validId($option['id'] ?? null)) {
                throw new ApiException('errors.api.invalidOptionId');
            }

            Text::requireLabel($option['label'] ?? null);

            if (isset($usedIds[$option['id']])) {
                throw new ApiException('errors.api.duplicateOptionId');
            }

            $usedIds[$option['id']] = true;
            $defaultCount += !empty($option['selectedByDefault']) ? 1 : 0;
            $delta = $option['priceDelta'] ?? 0;

            if (!is_int($delta) || $delta < 0 || $delta > 10000000) {
                throw new ApiException('errors.api.invalidPriceDelta');
            }
        }

        if ($type === 'single-select' && $defaultCount > 1) {
            throw new ApiException('errors.api.multipleDefaults');
        }

        if ($type === 'multi-select') {
            $minimum = $this->data['minSelected'] ?? 0;
            $maximum = $this->data['maxSelected'] ?? count($options);

            if (!is_int($minimum) || !is_int($maximum) ||
                $minimum < 0 || $maximum < $minimum || $maximum > 40) {
                throw new ApiException('errors.api.invalidChoiceLimits');
            }
        }
    }

    public function selectedPrice(array $selections): int
    {
        $id = $this->data['id'];
        $type = $this->data['type'];

        if ($type === 'group') {
            $total = 0;

            foreach ($this->data['children'] as $child) {
                $total += (new self($child))->selectedPrice($selections);
            }

            return $total;
        }

        if ($type === 'optional') {
            $enabled = $selections[$id] ?? false;

            if ($enabled === false || $enabled === null) {
                return 0;
            }

            if ($enabled !== true) {
                throw new ApiException('errors.api.optionalBoolean');
            }

            return (new self($this->data['child']))->selectedPrice($selections);
        }

        if ($type === 'text') {
            $value = $selections[$id] ?? '';

            if (!is_string($value) ||
                Text::length($value) > ($this->data['maxLength'] ?? 250) ||
                (!empty($this->data['required']) && trim($value) === '')) {
                throw new ApiException('errors.api.invalidText');
            }

            return 0;
        }

        return $this->selectionPrice($selections);
    }

    private function selectionPrice(array $selections): int
    {
        $id = $this->data['id'];
        $type = $this->data['type'];
        $value = $selections[$id] ?? null;

        if ($value === null) {
            $defaultIds = array_column(
                array_filter(
                    $this->data['options'],
                    static fn (array $option): bool => !empty($option['selectedByDefault'])
                ),
                'id'
            );

            $value = $type === 'single-select' ? ($defaultIds[0] ?? '') : $defaultIds;
        }

        if ($type === 'single-select') {
            if (!is_string($value)) {
                throw new ApiException('errors.api.invalidSingleChoice');
            }

            $selected = $value === '' ? [] : [$value];
        } else {
            $selected = $value;
        }

        if (!is_array($selected) || !array_is_list($selected)) {
            throw new ApiException('errors.api.invalidSelectionList');
        }

        if (count($selected) !== count(array_unique($selected, SORT_REGULAR))) {
            throw new ApiException('errors.api.duplicateSelections');
        }

        $count = count($selected);

        if ($type === 'single-select' &&
            ($count > 1 || (!empty($this->data['required']) && $count !== 1))) {
            throw new ApiException('errors.api.requiredChoice');
        }

        if ($type === 'multi-select' &&
            ($count < ($this->data['minSelected'] ?? 0) ||
                $count > ($this->data['maxSelected'] ?? count($this->data['options'])))) {
            throw new ApiException('errors.api.selectionLimits');
        }

        $optionsById = array_column($this->data['options'], null, 'id');
        $total = 0;

        foreach ($selected as $optionId) {
            if (!is_string($optionId) || !isset($optionsById[$optionId])) {
                throw new ApiException('errors.api.unknownChoice');
            }

            $total += $optionsById[$optionId]['priceDelta'] ?? 0;
        }

        return $total;
    }

    public function collectIds(array &$ids): void
    {
        $id = $this->data['id'];

        if (isset($ids[$id])) {
            throw new ApiException('errors.api.duplicateComponentId');
        }

        $ids[$id] = true;

        if ($this->data['type'] === 'optional') {
            (new self($this->data['child']))->collectIds($ids);
        }

        if ($this->data['type'] === 'group') {
            foreach ($this->data['children'] as $child) {
                (new self($child))->collectIds($ids);
            }
        }
    }
}

final class MenuItem extends MenuNode
{
    public function validate(int $depth = 0): void
    {
        if (!Text::validId($this->data['id'] ?? null)) {
            throw new ApiException('errors.api.invalidDishId');
        }

        Text::requireLabel($this->data['name'] ?? null);

        if (!is_string($this->data['description'] ?? '') ||
            Text::length($this->data['description'] ?? '') > 1000) {
            throw new ApiException('errors.api.dishDescriptionTooLong');
        }

        $price = $this->data['basePrice'] ?? null;

        if ($price !== null && (!is_int($price) || $price < 0 || $price > 10000000)) {
            throw new ApiException('errors.api.invalidDishPrice');
        }

        if (isset($this->data['currency']) && $this->data['currency'] !== 'PLN') {
            throw new ApiException('errors.api.onlyPln');
        }

        if (isset($this->data['available']) && !is_bool($this->data['available'])) {
            throw new ApiException('errors.api.invalidAvailability');
        }

        $components = $this->data['components'] ?? [];

        if (!is_array($components) || !array_is_list($components) || count($components) > 40) {
            throw new ApiException('errors.api.tooManyComponents');
        }

        $ids = [];

        foreach ($components as $componentData) {
            if (!is_array($componentData)) {
                throw new ApiException('errors.api.invalidDishComponent');
            }

            $component = new MenuComponent($componentData);
            $component->validate();
            $component->collectIds($ids);
        }
    }

    public function price(array $selections): ?int
    {
        if (array_is_list($selections) && count($selections) !== 0) {
            throw new ApiException('errors.api.selectionsObject');
        }

        $total = $this->data['basePrice'] ?? null;
        $knownIds = [];

        foreach ($this->data['components'] ?? [] as $componentData) {
            $component = new MenuComponent($componentData);
            $component->collectIds($knownIds);
            $delta = $component->selectedPrice($selections);

            if ($total !== null) {
                $total += $delta;
            }
        }

        foreach ($selections as $id => $_) {
            if (!isset($knownIds[$id])) {
                throw new ApiException('errors.api.unknownComponent');
            }
        }

        return $total;
    }
}

final class Menu extends MenuNode
{
    public function validate(int $depth = 0): void
    {
        if (!Text::validId($this->data['id'] ?? null)) {
            throw new ApiException('errors.api.invalidMenuId');
        }

        Text::requireLabel($this->data['name'] ?? null);
        $items = $this->data['items'] ?? null;

        if (!is_array($items) || !array_is_list($items) || count($items) > 100) {
            throw new ApiException('errors.api.invalidMenuItems');
        }

        $usedIds = [];

        foreach ($items as $data) {
            if (!is_array($data)) {
                throw new ApiException('errors.api.invalidDishData');
            }

            $item = new MenuItem($data);
            $item->validate();

            if (isset($usedIds[$data['id']])) {
                throw new ApiException('errors.api.duplicateDishId');
            }

            $usedIds[$data['id']] = true;
        }
    }

    public function findItem(string $id): ?MenuItem
    {
        foreach ($this->data['items'] as $data) {
            if ($data['id'] === $id) {
                return new MenuItem($data);
            }
        }

        return null;
    }
}

final class Database
{
    public readonly PDO $connection;
    private readonly string $tablePrefix;
    public const ROOM_LIFETIME_SECONDS = 86400;

    public function __construct()
    {
        $prefix = getenv('CHIEF_DB_TABLE_PREFIX');

        if ($prefix === false) {
            $prefix = getenv('DB_TABLE_PREFIX');
        }

        $this->tablePrefix = $prefix === false ? '' : $prefix;

        if ($this->tablePrefix !== '' &&
            preg_match('/\A[A-Za-z_][A-Za-z0-9_]{0,31}\z/D', $this->tablePrefix) !== 1) {
            throw new RuntimeException(
                'DB_TABLE_PREFIX must contain up to 32 ASCII letters, digits or underscores ' .
                'and start with a letter or underscore.'
            );
        }

        $path = getenv('DB_FILE');

        if ($path === false || trim($path) === '') {
            throw new RuntimeException('DB_FILE must be configured.');
        }

        if (!str_starts_with($path, '/') || str_contains($path, "\0") ||
            !str_ends_with(strtolower($path), '.sqlite')) {
            throw new RuntimeException('DB_FILE must be an absolute .sqlite file path.');
        }

        $directory = dirname($path);

        if (!is_dir($directory) || !is_writable($directory)) {
            throw new RuntimeException('The database directory must exist and be writable.');
        }

        $this->connection = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);

        $this->initialize();
    }

    /**
     * Quote an approved table or index name. PDO placeholders cannot be used
     * for SQL identifiers, so the environment prefix is validated first.
     */
    public function table(string $name): string
    {
        if (!in_array($name, ['rooms', 'orders', 'idx_orders_room', 'idx_rooms_expires_at'], true)) {
            throw new InvalidArgumentException('Unknown database identifier.');
        }

        return '"' . $this->tablePrefix . $name . '"';
    }

    private function initialize(): void
    {
        $rooms = $this->table('rooms');
        $orders = $this->table('orders');
        $ordersIndex = $this->table('idx_orders_room');
        $expiryIndex = $this->table('idx_rooms_expires_at');

        $this->connection->exec(
            'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;'
        );

        $this->connection->exec(
            "CREATE TABLE IF NOT EXISTS {$rooms} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_hash TEXT NOT NULL,
                menu_json TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at INTEGER
            )"
        );

        $this->connection->exec(
            "CREATE TABLE IF NOT EXISTS {$orders} (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES {$rooms}(id) ON DELETE CASCADE,
                receipt_hash TEXT NOT NULL,
                guest_name TEXT NOT NULL,
                items_json TEXT NOT NULL,
                total_cents INTEGER,
                status TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"
        );

        $this->connection->exec(
            "CREATE INDEX IF NOT EXISTS {$ordersIndex} ON {$orders}(room_id, created_at)"
        );

        // Existing databases predate the expiration column. Preserve the
        // original creation time, with a 24-hour deployment grace period.
        $columns = $this->connection->query("PRAGMA table_info({$rooms})")->fetchAll();
        $hasExpirationColumn = in_array('expires_at', array_column($columns, 'name'), true);

        if (!$hasExpirationColumn) {
            $this->connection->exec("ALTER TABLE {$rooms} ADD COLUMN expires_at INTEGER");
        }

        // Existing rooms receive at least one full day to avoid deleting
        // old kitchens immediately when the feature is first deployed.
        $this->execute(
            "UPDATE {$rooms}
             SET expires_at = MAX(
                 COALESCE(CAST(strftime('%s', created_at) AS INTEGER), 0) + ?,
                 ?
             )
             WHERE expires_at IS NULL",
            [self::ROOM_LIFETIME_SECONDS, time() + self::ROOM_LIFETIME_SECONDS]
        );

        $this->connection->exec(
            "CREATE INDEX IF NOT EXISTS {$expiryIndex} ON {$rooms}(expires_at)"
        );

        $this->deleteExpiredRooms();
    }

    /**
     * Expiration is enforced on every API request, like Shared Checklist.
     * Foreign-key cascading removes the room's orders with the room.
     */
    public function deleteExpiredRooms(): int
    {
        $rooms = $this->table('rooms');

        return $this->execute(
            "DELETE FROM {$rooms} WHERE expires_at <= ?",
            [time()]
        );
    }

    public function find(string $sql, array $values = []): ?array
    {
        $statement = $this->connection->prepare($sql);
        $statement->execute($values);
        return $statement->fetch() ?: null;
    }

    public function fetchAll(string $sql, array $values = []): array
    {
        $statement = $this->connection->prepare($sql);
        $statement->execute($values);
        return $statement->fetchAll();
    }

    public function execute(string $sql, array $values = []): int
    {
        $statement = $this->connection->prepare($sql);
        $statement->execute($values);
        return $statement->rowCount();
    }

    public function transaction(callable $action): mixed
    {
        $this->connection->beginTransaction();

        try {
            $result = $action();
            $this->connection->commit();
            return $result;
        } catch (Throwable $error) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }

            throw $error;
        }
    }
}

final class ChiefApi
{
    public function __construct(private readonly Database $database)
    {
    }

    public function handle(array $request): array
    {
        $action = $request['action'] ?? '';

        if ($action === 'create_room') {
            return $this->createRoom($request);
        }

        $roomId = (string) ($request['roomId'] ?? '');
        $room = $this->findRoom($roomId);

        return match ($action) {
            'get_room' => ['room' => $this->publicRoom($room)],
            'get_kitchen' => $this->getKitchen($room, $request),
            'save_menu' => $this->saveMenu($room, $request),
            'place_order' => $this->placeOrder($room, $request),
            'order_status' => $this->getOrderStatus($room, $request),
            'update_order' => $this->updateOrder($room, $request),
            'extend_room' => $this->extendRoom($room, $request),
            default => throw new ApiException('errors.api.unknownAction', 404)
        };
    }

    private function findRoom(string $id): array
    {
        $rooms = $this->database->table('rooms');
        $room = $this->database->find("SELECT * FROM {$rooms} WHERE id = ?", [$id]);

        if (!$room || (int) $room['expires_at'] <= time()) {
            $this->database->deleteExpiredRooms();
            throw new ApiException('errors.api.kitchenNotFound', 404);
        }

        return $room;
    }

    private function requireOwner(array $room, array $request): void
    {
        $token = $request['ownerToken'] ?? null;

        if (!is_string($token) ||
            !hash_equals($room['owner_hash'], hash('sha256', $token))) {
            throw new ApiException('errors.api.ownerRequired', 403);
        }
    }

    private function publicRoom(array $room): array
    {
        return [
            'id' => $room['id'],
            'name' => $room['name'],
            'revision' => (int) $room['revision'],
            'menu' => json_decode($room['menu_json'], true, 64, JSON_THROW_ON_ERROR)
        ];
    }

    private function parseMenu(mixed $data): Menu
    {
        if (!is_array($data)) {
            throw new ApiException('errors.api.menuObject');
        }

        $menu = new Menu($data);
        $menu->validate();

        if (strlen($this->encodeJson($data)) > 250000) {
            throw new ApiException('errors.api.menuTooLarge');
        }

        return $menu;
    }

    private function encodeJson(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private function createRoom(array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));

        if ($name === '' || Text::length($name) > 100) {
            throw new ApiException('errors.api.invalidKitchenName');
        }

        $menu = $this->parseMenu($request['menu'] ?? [
            'id' => 'restaurant-menu',
            'name' => 'Menu',
            'items' => []
        ]);

        $roomId = bin2hex(random_bytes(7));
        $ownerToken = bin2hex(random_bytes(24));
        $rooms = $this->database->table('rooms');

        $this->database->execute(
            "INSERT INTO {$rooms} (id, name, owner_hash, menu_json, expires_at) VALUES (?, ?, ?, ?, ?)",
            [
                $roomId,
                $name,
                hash('sha256', $ownerToken),
                $this->encodeJson($menu->toArray()),
                time() + Database::ROOM_LIFETIME_SECONDS
            ]
        );

        return [
            'roomId' => $roomId,
            'ownerToken' => $ownerToken,
            'room' => $this->publicRoom($this->findRoom($roomId))
        ];
    }

    private function getKitchen(array $room, array $request): array
    {
        $this->requireOwner($room, $request);
        $ordersTable = $this->database->table('orders');

        $orders = $this->database->fetchAll(
            "SELECT id, guest_name, items_json, total_cents, status, created_at, updated_at
             FROM {$ordersTable}
             WHERE room_id = ?
             ORDER BY CASE WHEN status = 'new' THEN 0 ELSE 1 END, created_at ASC",
            [$room['id']]
        );

        foreach ($orders as &$order) {
            $order['items'] = json_decode($order['items_json'], true, 64, JSON_THROW_ON_ERROR);
            unset($order['items_json']);
        }
        unset($order);

        return [
            'room' => $this->publicRoom($room),
            'orders' => $orders,
            'expiresAt' => (int) $room['expires_at']
        ];
    }

    private function saveMenu(array $room, array $request): array
    {
        $this->requireOwner($room, $request);

        if (($request['confirmDeleteOrders'] ?? false) !== true) {
            throw new ApiException('errors.api.deleteConfirmation');
        }

        $revision = $request['revision'] ?? null;

        if (!is_int($revision) || $revision !== (int) $room['revision']) {
            throw new ApiException('errors.api.revisionConflict', 409);
        }

        $menu = $this->parseMenu($request['menu'] ?? null);
        $name = trim((string) ($request['name'] ?? $room['name']));

        if ($name === '' || Text::length($name) > 100) {
            throw new ApiException('errors.api.invalidKitchenName');
        }

        $rooms = $this->database->table('rooms');
        $orders = $this->database->table('orders');

        $this->database->transaction(function () use ($room, $revision, $name, $menu, $rooms, $orders): void {
            $updated = $this->database->execute(
                "UPDATE {$rooms}
                 SET name = ?, menu_json = ?, revision = revision + 1
                 WHERE id = ? AND revision = ?",
                [
                    $name,
                    $this->encodeJson($menu->toArray()),
                    $room['id'],
                    $revision
                ]
            );

            if ($updated !== 1) {
                throw new ApiException('errors.api.revisionConflict', 409);
            }

            $this->database->execute(
                "DELETE FROM {$orders} WHERE room_id = ?",
                [$room['id']]
            );
        });

        return [
            'room' => $this->publicRoom($this->findRoom($room['id'])),
            'deletedOrders' => true
        ];
    }

    private function placeOrder(array $room, array $request): array
    {
        $guestName = trim((string) ($request['guestName'] ?? 'Guest'));

        if ($guestName === '' || Text::length($guestName) > 80) {
            throw new ApiException('errors.api.invalidGuestName');
        }

        $requestedItems = $request['items'] ?? null;

        if (!is_array($requestedItems) || !array_is_list($requestedItems) ||
            count($requestedItems) < 1 || count($requestedItems) > 30) {
            throw new ApiException('errors.api.invalidCart');
        }

        $menu = new Menu(json_decode($room['menu_json'], true, 64, JSON_THROW_ON_ERROR));
        $orderItems = [];
        $total = 0;
        $hasUnpricedItem = false;

        foreach ($requestedItems as $line) {
            if (!is_array($line)) {
                throw new ApiException('errors.api.invalidOrderLine');
            }

            $item = $menu->findItem((string) ($line['itemId'] ?? ''));

            if (!$item) {
                throw new ApiException('errors.api.dishMissing');
            }

            $data = $item->toArray();

            if (($data['available'] ?? true) === false) {
                throw new ApiException('errors.api.dishUnavailable');
            }

            $quantity = $line['quantity'] ?? 1;

            if (!is_int($quantity) || $quantity < 1 || $quantity > 20) {
                throw new ApiException('errors.api.invalidQuantity');
            }

            $selections = $line['selections'] ?? [];

            if (!is_array($selections)) {
                throw new ApiException('errors.api.invalidSelections');
            }

            $unitPrice = $item->price($selections);

            if ($unitPrice === null) {
                $hasUnpricedItem = true;
            } else {
                $total += $unitPrice * $quantity;
            }

            $orderItems[] = [
                'itemId' => $data['id'],
                'name' => $data['name'],
                'quantity' => $quantity,
                'selections' => $selections,
                'unitPrice' => $unitPrice,
                'components' => $data['components'] ?? []
            ];
        }

        $orderId = bin2hex(random_bytes(8));
        $receiptToken = bin2hex(random_bytes(24));
        $orders = $this->database->table('orders');

        $this->database->execute(
            "INSERT INTO {$orders}
                (id, room_id, receipt_hash, guest_name, items_json, total_cents)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $orderId,
                $room['id'],
                hash('sha256', $receiptToken),
                $guestName,
                $this->encodeJson($orderItems),
                $hasUnpricedItem ? null : $total
            ]
        );

        return [
            'orderId' => $orderId,
            'receiptToken' => $receiptToken,
            'status' => 'new'
        ];
    }

    private function getOrderStatus(array $room, array $request): array
    {
        $orders = $this->database->table('orders');
        $order = $this->database->find(
            "SELECT id, status, guest_name, items_json, total_cents,
                    created_at, updated_at, receipt_hash
             FROM {$orders} WHERE id = ? AND room_id = ?",
            [(string) ($request['orderId'] ?? ''), $room['id']]
        );

        $token = $request['receiptToken'] ?? null;

        if (!$order || !is_string($token) ||
            !hash_equals($order['receipt_hash'], hash('sha256', $token))) {
            throw new ApiException('errors.api.orderExpired', 404);
        }

        unset($order['receipt_hash']);
        $order['items'] = json_decode($order['items_json'], true, 64, JSON_THROW_ON_ERROR);
        unset($order['items_json']);

        return ['order' => $order];
    }

    private function extendRoom(array $room, array $request): array
    {
        $this->requireOwner($room, $request);
        $rooms = $this->database->table('rooms');

        // Add one full day to the existing deadline rather than resetting the
        // countdown. An early extension therefore never loses remaining time.
        $updated = $this->database->execute(
            "UPDATE {$rooms} SET expires_at = ?
             WHERE id = ? AND expires_at > ?",
            [time() + Database::ROOM_LIFETIME_SECONDS, $room['id'], time()]
        );

        if ($updated !== 1) {
            $this->database->deleteExpiredRooms();
            throw new ApiException('errors.api.kitchenNotFound', 404);
        }

        $current = $this->findRoom($room['id']);

        return ['expiresAt' => (int) $current['expires_at']];
    }

    private function updateOrder(array $room, array $request): array
    {
        $this->requireOwner($room, $request);

        $status = $request['status'] ?? null;

        if (!in_array($status, ['new', 'done'], true)) {
            throw new ApiException('errors.api.invalidOrderStatus');
        }

        $orders = $this->database->table('orders');
        $updated = $this->database->execute(
            "UPDATE {$orders}
             SET status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND room_id = ?",
            [$status, (string) ($request['orderId'] ?? ''), $room['id']]
        );

        if ($updated !== 1) {
            throw new ApiException('errors.api.orderMissing', 404);
        }

        return ['updated' => true];
    }
}

// Run "php api.php cleanup-expired" from cron for timely cleanup even
// when nobody visits the website. Regular API requests also enforce expiry.
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'cleanup-expired') {
    try {
        new Database();
        fwrite(STDOUT, "Expired-room cleanup finished.\n");
        exit(0);
    } catch (Throwable $error) {
        fwrite(STDERR, $error->getMessage() . "\n");
        exit(1);
    }
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new ApiException('errors.api.postRequired', 405);
    }

    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 300000) {
        throw new ApiException('errors.api.payloadTooLarge', 413);
    }

    $request = json_decode(
        file_get_contents('php://input'),
        true,
        64,
        JSON_THROW_ON_ERROR
    );

    if (!is_array($request)) {
        throw new ApiException('errors.api.requestObject');
    }

    $response = (new ChiefApi(new Database()))->handle($request);

    echo json_encode(
        ['ok' => true] + $response,
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
} catch (Throwable $error) {
    $status = $error instanceof ApiException ? $error->statusCode : 500;
    http_response_code($status);

    echo json_encode([
        'ok' => false,
        'error' => $status === 500
            ? 'errors.api.internal'
            : $error->getMessage()
    ], JSON_UNESCAPED_UNICODE);

    if ($status === 500) {
        error_log((string) $error);
    }
}
