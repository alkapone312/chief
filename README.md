# Chief — Mobile Kitchen Ordering

> **VIBE-CODED PROJECT:** Chief was generated with AI assistance (vibe coding).
> It has not undergone an independent security audit or comprehensive production testing.
> Review the code before deploying it publicly.

Chief lets mobile kitchen owners create independent rooms, configure menus,
share guest QR codes, receive orders, and mark orders as completed. Guests can
place additional orders and monitor the status of previous orders.

## Requirements

- PHP 8.1 or newer with PDO and the pdo_sqlite driver
- A writable directory for the SQLite database
- Modern browser supporting ES modules, fetch, and structuredClone
- No Composer packages, PHP frameworks, or third-party JavaScript libraries

The entire JSON API and all PHP domain classes remain in **one file: api.php**.

## Quick start

~~~bash
cd /path/to/chafften.net/chief
mkdir -p /path/to/private-database-directory

export DB_FILE="/path/to/private-database-directory/chief.sqlite"
export CHIEF_DB_TABLE_PREFIX="chief_"
php -S 0.0.0.0:8000
~~~

Open **http://localhost:8000**.

**DB_FILE is required.** Provide an absolute path to a .sqlite file.
The parent directory must already exist and be writable by the PHP process.
The SQLite file will be created automatically if it does not exist.

To reuse an existing database, point DB_FILE at that file. Do not delete it.

For a guest QR link that works on a phone, access the website through a
reachable LAN IP such as http://192.168.1.20:8000 instead of localhost.

## Light and dark themes

Chief now supports a **LIGHT / DARK** theme switcher in the header.
Its light mode retains the original colours, while dark mode uses the
dark-green palette from One-Time Secret. The choice is saved under
`localStorage.theme`, so it is also shared with One-Time Secret and
Shared Checklist when the applications run on the same origin.

The saved theme is applied before the stylesheet loads to avoid a bright
flash. Switching takes effect immediately without reloading, and the
interface-language selector continues to work independently. The header
switcher's labels and accessibility descriptions are translated in
`translations/en_GB.json` and `translations/pl_PL.json`.

The theme code lives in `js/theme.js`, and all palette overrides remain
inside Chief's own `style.css`. No dependencies or backend changes are
required.

## Database table prefixes

The database table prefix is configurable through environment variables:

- `CHIEF_DB_TABLE_PREFIX` — Chief-specific setting (takes priority).
- `DB_TABLE_PREFIX` — shared fallback if `CHIEF_DB_TABLE_PREFIX` is not set.
- Both are optional. An unset or empty value keeps the original table names.

For example, `CHIEF_DB_TABLE_PREFIX=chief_` uses `chief_rooms`,
`chief_orders`, and `chief_idx_orders_room` instead of the original
`rooms`, `orders`, and `idx_orders_room` index.

The prefix must have **1–32 ASCII characters**, begin with a letter or
underscore, and contain only letters, digits, and underscores. Empty is
permitted to preserve backward compatibility. Invalid values are rejected
before SQL is executed.

**Important:** Adding or changing a prefix does not rename, migrate, or
delete previous tables. The application creates a separate set of tables
and will initially appear empty until existing data is migrated. Make a
backup and migrate the tables intentionally if you need to retain existing
rooms and orders.

When all applications share the same SQLite file and PHP environment, assign
each application a **different application-specific prefix** to prevent
collisions with the other applications' table names.

## Architecture

~~~text
chief/
    api.php                      Object-oriented PHP domain, SQLite, JSON API
    app.js                       Application bootstrap and route selection
    index.html                   HTML shell
    style.css                    Responsive stylesheet
    qr.js                        Dependency-free QR generator
    js/
        core.js                  Shared utilities, API, storage, dialogs, templates
        translator.js            Translator class and locale handling
        theme.js                 Independent light/dark mode controller
        menu.js                  Menu model, component factory, guest selections
        menu-editor.js           Recursive menu editor controller
        kitchen.js               Kitchen dashboard, orders, QR sharing
        guest.js                 Guest ordering and receipt status
    components/
        home.html                Home page
        new-room.html            Create-room form
        editor.html              Menu editor layout
        item.html                Editable dish
        component.html           Recursive component renderer
        option.html              Choice input
        add-component.html       Add-component dialog
    translations/
        en_GB.json               English (United Kingdom)
        pl_PL.json               Polish (Poland)
    tests/
        menu.test.mjs            Recursive menu model tests
        translator.test.mjs      Localisation and dictionary consistency tests
        theme.test.mjs           Theme persistence and switch behaviour
    README.md                    Documentation
~~~

HTML templates are fetched at startup using TemplateRepository. The code is
formatted with **4 spaces per indentation level**, and code naming,
application text and documentation are in English. Content provided by users
is HTML-escaped before being inserted into a rendered template.

### Object model and Composite pattern

- MenuNode: abstract base of the menu object tree.
- Menu: root of the menu and collection of dishes.
- MenuItem: dish with a base price and child components.
- MenuComponent: recursive Composite node. Group nodes own arrays of children;
  optional nodes own one configurable child; choices and text are leaves.
- Database: PDO SQLite access and transaction abstraction.
- ChiefApi: validates requests, manages rooms, orders, and menu updates.

The JavaScript model uses a MenuComponentFactory and MenuEditorModel to keep
component creation and mutation away from DOM rendering.

Prices and price deltas are integer **grosz** amounts (3200 = PLN 32.00).
A null/missing price means unspecified. A price of 0 represents a free dish.

### Menu component types

| Type | Behavior |
| --- | --- |
| single-select | One choice, optional or required, with a default |
| multi-select | Multiple choices with selection limits |
| optional | Enabled/disabled parent with exactly one child |
| group | Recursive collection of children |
| text | Free text notes with a length limit |

**Optional child configuration:** In the editor, every optional component now
offers a **Child component type** dropdown. The child may be single-select,
multi-select, optional, group, or text. The nested component itself also has a
Component type dropdown. Switching a type asks for confirmation, replaces the
old configuration, and preserves its label.

The editor also supports adding and removing group children, editing labels,
choice prices, defaults, requirements, notes, and selection limits. Nested
components are limited to eight levels on the server.

JSON menu export uses four-space indentation. A menu exported from one room
can be imported into another room.

**Saving a menu permanently deletes all orders in that room only.** A confirmation
is required both in the UI and API. Update and deletion run in a single SQLite
transaction; menu revision numbers prevent accidental concurrent overwrites.

## Internationalisation (i18n)

Chief supports **English (United Kingdom)** (`en_GB`, default) and
**Polish (Poland)** (`pl_PL`).

- Dictionary files are stored in `translations/en_GB.json` and
  `translations/pl_PL.json`. Every dictionary uses the same nested
  structure of English-language dotted keys, such as
  `editor.childType` and `errors.api.kitchenNotFound`.
- `js/translator.js` defines the **Translator** class, with methods
  `load()`, `t(key, params)`, `translateTemplate(html)` and
  `selectLanguage(language)`.
- The chosen locale is stored in browser `localStorage` under
  `chiefLanguage`. Changing the select box in the header saves the
  selection and **reloads the page**.
- At startup, Chief loads the chosen JSON language file, translates
  permanent page elements and loads the reusable HTML templates.
- In `components/*.html`, translate visible text by wrapping a dotted
  key inside **`$t('editor.childType')`**. The
  `TemplateRepository` passes each template through
  `Translator.translateTemplate()` before injecting model values.
- JavaScript controllers use `this.t("guest.addToCart")` or
  `this.translator.t(...)` for dynamic interface strings. Currency
  and times use the selected locale.
- The API is language independent: it returns **translation keys,
  not translated sentences** for all user-facing errors. For example:

~~~json
{
    "ok": false,
    "error": "errors.api.kitchenNotFound"
}
~~~

  `ApiClient` translates the value of `error` using the active
  `Translator`. For unexpected server faults, the API returns
  `errors.api.internal`. This avoids hardcoding a server-side language.
- Chef-provided menu names, descriptions and previously placed
  orders are **user data**: changing the interface language does not
  automatically translate that content.

To add another language, create a JSON dictionary mirroring the current
key structure, add the locale to `Translator.LANGUAGES`, and add an
option to the language selector in `index.html`. Add keys to **both**
existing dictionaries whenever adding new interface messages.

## Room lifetime and renewal

Chief automatically expires kitchen rooms **24 hours after creation**.
Submitting orders, viewing the kitchen, or editing the menu **does not**
reset this timer. The chef can explicitly extend the room at any time
before its expiry using **+ Extend 24 hours** in the kitchen dashboard.

Each extension adds exactly 24 hours (86,400 seconds) to the existing
deadline, keeping any remaining time. The dashboard shows the live
`HH:MM:SS` countdown and the local expiration date/time. This information
is deliberately **not included in the guest-facing `get_room` response**,
and the guest interface never displays a room timer.

Expiration uses the new `expires_at` (Unix epoch seconds) column in
the prefixed Chief rooms table. When upgrading an existing database, the
column is added automatically. **Existing rooms receive at least 24 hours
from their first migration**, so deploying this change does not immediately
destroy old rooms and their orders.

Expired rooms and all their orders are deleted from SQLite using the
existing foreign key with `ON DELETE CASCADE`. Cleanup runs automatically
whenever the Chief API is accessed, like Shared Checklist. The chef's
local list also drops an expired room after visiting its dashboard.
Guest pages show a generic closed-kitchen message, without a countdown.

To remove expired rooms even on an otherwise idle site, schedule the
same cleanup from the command line, for example with cron (every minute):

```cron
* * * * * DB_FILE=/absolute/path/to/database.sqlite CHIEF_DB_TABLE_PREFIX=chief_ /usr/bin/php /absolute/path/to/chafften.net/chief/api.php cleanup-expired >/dev/null 2>&1
```

Use the environment variables applicable to your deployment. Without
cron, SQLite rows are physically removed on the **next Chief API request**
after expiration (the room cannot be accessed again once expired).

Only the chef's owner token can authorize `extend_room`. Example JSON:

```json
{
    "action": "extend_room",
    "roomId": "YOUR_ROOM_ID",
    "ownerToken": "YOUR_OWNER_TOKEN"
}
```

The successful response includes the renewed `expiresAt` timestamp
in seconds. `get_kitchen` also returns `expiresAt` to the chef.
Renewal does not delete existing orders or modify the menu.

## Room ownership and ordering

Kitchen owners receive a random owner token when creating a room. The token is
saved in localStorage and its SHA-256 hash is stored in SQLite. A browser that
does not have the token cannot access the kitchen dashboard. Clearing local
storage loses access; there is currently no account recovery.

Each guest order has an independent receipt token needed to check its status.
Menu selections are validated and prices recalculated on the server; order
records keep a snapshot of selected options.

The kitchen polls for orders every 4 seconds, and guests check status every
5 seconds. Multiple rooms can be active simultaneously.

## JSON API

POST requests to api.php accept a JSON object containing the action field:

| Action | Relevant properties |
| --- | --- |
| create_room | name, menu |
| get_room | roomId |
| get_kitchen | roomId, ownerToken |
| save_menu | roomId, ownerToken, revision, name, menu, confirmDeleteOrders: true |
| place_order | roomId, guestName, items: [{itemId, quantity, selections}] |
| order_status | roomId, orderId, receiptToken |
| update_order | roomId, ownerToken, orderId, status: new/done |
| extend_room | roomId, ownerToken |

Responses use ok: true on success. Errors return ok: false with a dotted
translation key in the error property, never a localized API message.

## Optional automated JavaScript tests

The menu model has dependency-free Node.js tests in tests/menu.test.mjs.
Node.js 20+ is needed only to run these tests, not to run the web app.

~~~bash
npm test
~~~

The test suite checks menu nesting, optional child types, translation
interpolation, safe HTML substitution, dictionary key consistency, and
the chef-only countdown rendering.

No npm install or external packages are required.

For a separate end-to-end room-lifetime test, run:

```bash
npm run test:integration
```

This starts an isolated local PHP server with a temporary SQLite database,
tests 24-hour room creation, owner-only renewal, guest response privacy,
and cascading order deletion. It requires PHP CLI with `pdo_sqlite` and
Node.js, and does not access or modify your production database.

## Manual regression checklist

1. Create two independent kitchens with distinct orders.
2. Add a dish, a group, and nested children, then save and reload.
3. Add an optional component; change its child to multi-select, group, text,
   and another optional component. Verify labels and new input fields.
4. Edit choice labels, prices, required flags, and selection limits.
5. Export JSON and import it into a different room.
6. Place an order with a nested optional choice and mark it completed.
7. Confirm that editing one menu deletes only that room's orders.
8. Check guest status updates from another device.
9. Ensure a missing DB_FILE prevents unintended database creation.
10. Verify the room countdown is visible only to the chef, and guest API responses have no expiry timestamp.
11. Confirm the chef can extend a room by 24 hours without clearing orders.
12. Confirm rooms are deleted after expiry with cascading order cleanup (with an isolated test database).

## Production notes

Use HTTPS, add rate limits, back up SQLite, protect the database from the web
document root, and implement proper owner account recovery before public use.

The built-in QR generator encodes UTF-8 URLs up to 106 bytes. Longer URLs
require an expanded QR implementation or a shorter public base URL.
