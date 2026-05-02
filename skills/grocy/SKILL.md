---
name: grocy
description: Track pantry stock, recipes, and meal plans on the user's self-hosted Grocy instance, and turn a meal plan into a stock-aware shopping list. Use when the user wants to record what's in stock, plan a week of meals, or generate a shopping list as the diff between planned recipes and current pantry contents.
user-invocable: true
---

<!--
Claude Code users: to allow the `grocy` wrapper without per-call prompts, add to
~/.claude/settings.json under permissions.allow (path is wherever you symlink/
copy this skill — typically ~/.claude/skills/grocy/grocy):

  "Bash(~/.claude/skills/grocy/grocy *)"
  "Bash(jq *)"
  "Bash(date *)"
-->

# grocy

Wraps the [Grocy](https://grocy.info/) REST API for pantry/stock tracking, recipe management, meal planning, and shopping lists. Grocy is a self-hosted "ERP for your home" — its strengths are stock tracking (every item has an amount, location, expiry, lot), recipe → stock fulfillment, and auto-shopping ("what do I need to buy to cook X given current stock").

The killer flow this skill enables: **plan meals → diff against stock → auto-populate the shopping list with only what's missing.** That is `POST /api/recipes/{recipeId}/add-not-fulfilled-products-to-shoppinglist` — Grocy does the math for you.

This skill is *separate* from `mealie` and `sparkyfitness-meals`:

- **Mealie** — better URL scraping and richer recipe UX, but doesn't model stock at all and only tracks macros (no micros — Mealie's nutrition schema is fixed at 11 fields).
- **SparkyFitness** — fitness goals + diary, per-user macro/micro tracking. No stock, no recipe library worth the name.
- **Grocy (this skill)** — stock + recipes + meal plan + shopping in one data model. Nutrition is one `calories` number per product (or use `userfields` for richer macros — see below).

The intended division of labour: Grocy plans + tracks stock + generates the shopping list; SparkyFitness logs what was actually eaten against per-person fitness goals. Bridge is currently manual; a `sf grocy-import` mirror of `sf mealie-import` is a future job.

## Install

Already lives at `~/code/ai-tools/skills/grocy/`. If `ai-tools/skills/` is registered as a plugin directory it auto-loads; otherwise symlink:

```bash
ln -s "$(pwd)/grocy" ~/.claude/skills/grocy
```

## Setup

Generate an API key in the Grocy UI (User → Manage API keys) and put it at `~/.config/grocy/credentials` (chmod 600):

```
GROCY_BASE_URL=https://your-instance.example.com
GROCY_API_KEY=<token>
# Optional, for self-signed certs:
# GROCY_INSECURE=1
# GROCY_CA_BUNDLE=/path/to/ca.pem
```

```bash
install -d -m 700 ~/.config/grocy
install -m 600 /dev/null ~/.config/grocy/credentials
$EDITOR ~/.config/grocy/credentials
```

The wrapper also accepts `GROCY_BASE_URL` / `GROCY_API_KEY` from the environment, so you can inject them via [pass-secrets](../pass-secrets/) (the user's instance currently has the key at `pass ruben/pantry`).

## CLI helper

`./grocy` (next to this SKILL.md) is a thin curl wrapper. Always use it — it adds the `GROCY-API-KEY` header and the base URL.

```
grocy self                                       # current user
grocy info                                       # version, db state
grocy products [search]                          # list / search products
grocy product <id>                               # joined view (product + stock + nutrition)
grocy stock                                      # everything currently in stock
grocy stock-volatile                             # missing / overdue / expiring
grocy stock-entries <productId>                  # individual lots for a product
grocy units [search]                             # quantity_units
grocy locations                                  # locations
grocy product-groups
grocy recipes
grocy recipe <id>                                # head + recipes_pos ingredients merged
grocy recipe-fulfillment [id]                    # can I cook this from current stock?
grocy mealplans [start] [end]                    # default: today only
grocy shopping-lists
grocy shopping-list <listId>                     # items in a list
grocy users
grocy fields <entity> [objectId]                 # userfields for entity (or row)

# stock writes
grocy stock-add <productId> <amount> [bestBefore=2999-12-31] [price]
grocy stock-consume <productId> <amount>
grocy stock-inventory <productId> <newAmount>    # adjust to absolute count
grocy stock-open <productId> <amount>
grocy stock-transfer <productId> <amount> <toLocId>

# recipe writes
grocy recipe-create <name> [servings]
grocy recipe-pos-add <recipeId> <productId> <amount> <quId> [note]
grocy recipe-consume <recipeId>
grocy recipe-copy <recipeId>
grocy recipe-fill-shopping <recipeId> [listId]   # ★ stock-aware shopping

# meal plan writes
grocy mealplan-add <date> <recipeId> [servings] [section_id]
grocy mealplan-note <date> <note>
grocy mealplan-delete <id>

# shopping writes
grocy shopping-list-create <name>
grocy shopping-list-delete <id>
grocy shopping-list-clear [listId=1]
grocy shopping-add <productId> <amount> [listId=1] [quId]
grocy shopping-remove <productId> [listId=1]
grocy shopping-add-missing [listId=1]            # adds below-min-stock items

# generic CRUD over /api/objects/{entity}
grocy list <entity> [field] [value]              # name uses LIKE %v%; other fields exact
grocy get <entity> <objectId>
grocy create <entity> <bodyJson>
grocy update <entity> <objectId> <bodyJson>
grocy delete <entity> <objectId>

# escape hatches
grocy <METHOD> <path> [body]                     # raw + jq pretty-printed
grocy raw <METHOD> <path> [body]                 # raw, no jq
```

## Verified contracts

These have been round-tripped against the live Grocy 4.6.0 instance. Anything not listed here, treat as advisory.

### Auth

`GROCY-API-KEY: <key>` header on every request. Tokens carry the user's full permissions — no per-token scopes. Tokens managed at `https://<instance>/manageapikeys`.

### `GET /api/system/info` — version and runtime

Returns `{grocy_version:{Version, ReleaseDate}, php_version, sqlite_version, db_version, os, client}`. Useful for confirming the API is reachable and the wrapper auth works.

### Generic CRUD: `/api/objects/{entity}` and `/api/objects/{entity}/{id}`

Almost every Grocy table is exposed via this generic CRUD. Verified entities (and the ones the wrapper subcommands map to): `products`, `quantity_units`, `locations`, `product_groups`, `recipes`, `recipes_pos`, `meal_plan`, `meal_plan_sections`, `shopping_lists`, `shopping_list`, `userfields`.

- `GET /api/objects/{entity}` → array of rows. Filter via `?query[]=<expr>` (URL-encoded). Operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `~` (SQL LIKE — use `%` wildcards), `!~`. Multiple `query[]=…` clauses AND together.
- `POST /api/objects/{entity}` body `{...}` → `{created_object_id: <int>}`. **Required fields are NOT in the OpenAPI**; the API only enforces NOT-NULL DB constraints. See "Failure modes" for the foot-guns.
- `PUT /api/objects/{entity}/{id}` body `{...}` → empty 200. Partial bodies work (unlike Mealie's PUT). Send only the fields you want to change.
- `DELETE /api/objects/{entity}/{id}` → empty 200 (or 400 "Object not found").
- `GET /api/objects/{entity}/{id}` → single row.

The wrapper's `grocy list <entity> name <search>` does a LIKE `%search%` match for convenience; for other fields it does exact match. Use raw `query[]=` for anything more complex.

### `GET /api/stock` — current stock (joined)

Returns one row per product currently held. Each row has `{product_id (int), amount (number), best_before_date, amount_aggregated, ...}` — note `product_id` is a JSON number here, not a string.

### `GET /api/stock/products/{id}` — joined product+stock+nutrition

Returns `{product, product_barcodes[], last_purchased, last_used, stock_amount, stock_amount_opened, stock_value, default_quantity_unit_purchase, last_price, ...}`. The single best read endpoint when you want everything about one product.

### `GET /api/stock/volatile` — actionable stock

Returns `{due_products, overdue_products, expired_products, missing_products}`. Use this for the "what should I cook tonight / what's about to expire" prompt.

### Stock mutation: add / consume / inventory / open / transfer

Each is `POST /api/stock/products/{id}/{verb}` and returns an array of stock-transaction rows (booking history). Verified bodies:

- **add** (purchase): `{amount, best_before_date, transaction_type:"purchase", price?}`. The wrapper defaults `best_before_date` to `2999-12-31` (no expiry) — change if you want real expiry tracking. Returns multiple rows when split over packs.
- **consume**: `{amount, transaction_type:"consume"}`. Negative-amount row appears in the response.
- **inventory**: `{new_amount}` — sets the absolute count. Internally Grocy emits an `inventory-correction` transaction for the delta.
- **open**: `{amount}` — flags `amount` units as opened (for "use within X days after opening" tracking).
- **transfer**: `{amount, location_id_to}` — move between locations.

### `GET /api/recipes/fulfillment` and `GET /api/recipes/{id}/fulfillment`

For each recipe (or one), returns `{recipe_id, need_fulfilled (0|1), need_fulfilled_with_shopping_list (0|1), missing_products_count, costs, costs_per_serving, calories, due_score, product_names_comma_separated, prices_incomplete}`. This is the "what can I cook?" endpoint — sort by `need_fulfilled DESC, due_score DESC` to surface viable recipes whose ingredients are about to expire.

### `POST /api/recipes/{id}/add-not-fulfilled-products-to-shoppinglist` ★

Body `{}` (defaults to list_id=1) or `{list_id: <int>}`. Adds shopping-list rows for the *delta* between recipe needs and current stock — converted to each product's purchase QU. Verified: a recipe needing 50 g (qu_id=2 Piece) with 3 g already in stock added a row with `amount: 47, qu_id: 3 (Pack)` to list 1.

This is the entire reason to use Grocy over Mealie for the meal-plan→shopping flow. Run it for each recipe in the week's plan to materialize the shopping list.

### `POST /api/recipes/{id}/consume`

Body empty. Consumes the recipe's ingredients in stock (one consume transaction per ingredient). Returns nothing useful on insufficient stock — silently no-ops. Always check `recipe-fulfillment` first if you care.

### `POST /api/recipes/{id}/copy`

Body empty. Returns `{id: <new_id>}`. Useful when authoring a variant of an existing recipe.

### `GET /api/objects/meal_plan` filtered by date

There's no dedicated meal-plan endpoint — it's just a CRUD entity. Filter via `query[]=day>=YYYY-MM-DD&query[]=day<=YYYY-MM-DD`. Each row: `{id, day, type ("recipe"|"note"|"product"), recipe_id, recipe_servings, product_id, product_amount, product_qu_id, note, section_id, done}`.

To schedule a recipe: `POST /api/objects/meal_plan` body `{day, type:"recipe", recipe_id, recipe_servings, section_id?}`. Sections are user-defined slots (breakfast/lunch/dinner/etc.); query `meal_plan_sections` to find the IDs.

### `POST /api/stock/shoppinglist/*` — bulk shopping list ops

- **add-product**: `{product_id, list_id, product_amount, qu_id?}` — append (or merge with existing line for same product).
- **remove-product**: `{product_id, list_id}` — drops all rows for that product.
- **clear**: `{list_id}` — empties the list.
- **add-missing-products**: `{list_id}` — fills list from products whose `min_stock_amount` exceeds current stock. Different from the recipe-driven flow above; useful for staples.
- **add-expired-products** / **add-overdue-products**: `{list_id}` — restock items that are about to expire/are expired.

## Standard "set up the pantry" flow

For an empty instance (which `pantry.ruben.io` currently is), the bootstrap order matters because of FK NOT-NULL constraints:

1. **Locations** — add at least the locations you'll use (Fridge default exists; create Pantry, Freezer, etc. via `grocy create locations '{"name":"Pantry"}'`).
2. **Quantity units** — verify defaults (`grocy units` — Piece + Pack ship). Add `grams`, `ml`, `L`, `kg` etc. as needed (`grocy create quantity_units '{"name":"gram","name_plural":"grams"}'`).
3. **Product groups** (optional, for UI sorting) — `grocy create product_groups '{"name":"Dairy"}'`.
4. **Products** — for each pantry/fridge item: `grocy create products '{"name":"...","location_id":<id>,"qu_id_purchase":<id>,"qu_id_stock":<id>,"qu_id_consume":<id>}'`. **`location_id` is NOT NULL** — see Failure modes.
5. **Initial stock** — `grocy stock-add <productId> <amount>` for each item currently in the pantry. Or `stock-inventory` to set absolute counts when doing a one-off audit.

Recipes and meal plan come later, on top of this foundation.

## Standard "plan a week with stock-aware shopping" flow

1. `grocy stock` — sanity-check current stock so you can spot stale data.
2. `grocy recipe-fulfillment` — sort by `need_fulfilled` to see which existing recipes can run from stock with no shopping at all (use those for the start of the week).
3. For each `(date, slot)` in the week, `grocy mealplan-add <date> <recipeId> <servings>`. Ad-hoc meals: `grocy mealplan-note <date> "<text>"`.
4. `grocy mealplans <monday> <sunday>` — show the plan for confirmation.
5. **Generate shopping list**: `grocy shopping-list-clear 1` then for each recipe in the plan run `grocy recipe-fill-shopping <recipeId>`. Grocy adds only the *missing* portion of each ingredient, in the product's purchase QU.
6. `grocy shopping-list 1` — show the materialized list. Manually adjust (round up to pack sizes, drop already-in-cart items) before going shopping.
7. After cooking on day N: `grocy recipe-consume <recipeId>` decrements stock automatically.

For the "cook tonight from what's around" question, skip steps 3–6 and just sort `recipe-fulfillment` by `need_fulfilled DESC, due_score DESC`.

## Nutrition

Grocy out-of-the-box has a single `calories` field on `products` (kcal per stock QU). For real macro/micro tracking you have two paths:

1. **Userfields on products** — define fields like `protein_g`, `fat_g`, `fiber_g`, `iron_mg` etc. via `POST /api/objects/userfields` body `{entity:"products", name:"protein_g", caption:"Protein (g)", type:"number", show_as_column_in_tables:1}`. Then per-product values go in via `PUT /api/userfields/products/{id}` body `{protein_g: 12.5, ...}`. Grocy will store and surface them, but won't aggregate them across recipes — you'd compute totals yourself.
2. **Mirror to SparkyFitness** — keep Grocy as the planning + stock layer, write actually-eaten meals to SparkyFitness for diary/goal tracking. This is the cleaner separation; SF already has full macro+micro columns and per-user diaries.

If the user just wants kcal estimates per recipe, Grocy's built-in `calories` field is enough — it surfaces in `recipe-fulfillment.calories`. For richer tracking, prefer option 2.

USDA-backed per-100 g values come from the `compute_nutrition.py` script at `/home/istar/code/personal/meals/compute_nutrition.py` and the reference fdcId table in the `mealie` skill — reuse those rather than re-deriving.

## Failure modes worth knowing

- **400 / `NOT NULL constraint failed: products.location_id`** when creating a product. Despite OpenAPI listing `location_id` as just `integer`, it's a hard NOT NULL — always provide a `location_id` (Fridge=2 ships by default). Same gotcha class applies to other tables — when you get a 400 with `Integrity constraint violation: 19`, the field name is in the message; just add it to the body.
- **`Argument must be of type int, string given`** 500s from `/api/stock/products/{id}/...` happen when `{id}` in the URL is the literal string "null" — usually because an earlier `create` call failed and you piped `null` from `created_object_id`. Always assert the create succeeded before passing the id forward.
- **`grocy list <entity> name <q>`** uses LIKE `%q%` — matches anywhere in the name. For exact match, use `grocy list <entity> name_field_other_than_name <q>` or pass the raw query: `grocy GET '/api/objects/products?query%5B%5D=name=Oats'`. **`grocy units <q>` and similar fuzzy listings can return more than one match — verify before using `items[0].id` in a destructive call** (same trap as Mealie's `foods <search>`).
- **Recipe consume silently no-ops on insufficient stock.** Always `recipe-fulfillment` first if downstream logic depends on the consume succeeding. The response is empty either way.
- **`recipe-fill-shopping` converts amounts to the product's purchase QU**, not the recipe's QU. A 50 g (Piece) recipe ingredient against a product with `qu_id_purchase=Pack` lands as a Pack quantity on the shopping list — Grocy uses the product's QU conversion table to do the math. If conversions aren't defined, the math is "1:1 in the new unit" which is usually wrong; configure `quantity_unit_conversions` for any product where stock-QU ≠ purchase-QU.
- **`/api/objects/meal_plan` has no `entryType` enum** like Mealie does — slots are *user-defined* `meal_plan_sections` rows. There's no built-in "breakfast/lunch/dinner" — you create those yourself. Until you do, `section_id` is null and the UI buckets everything together.
- **`grocy self` returns an array, not an object** — the endpoint is `/api/user` (singular) but the body is `[{...one user...}]`. Possibly a Grocy quirk; use `[0]` if you need to index.
- **The OpenAPI at `/api/openapi/specification` is *partially* accurate** — endpoint paths and verbs match, but request schemas under-specify required fields (NOT NULL DB constraints aren't reflected). Trust the live error messages over the spec when bodies fail validation.
- **Single-user instance** — `/api/users` returns one row. If multi-user gets configured later, household-scoped objects (meal plans, shopping lists) become per-user; revisit the wrapper.
- **TLS errors** — see Setup. `GROCY_INSECURE=1` or `GROCY_CA_BUNDLE=...`.

## Don't

- Don't `recipe-consume` without confirming. It mutates stock irreversibly (well, undoable via stock-bookings/{id}/undo, but a hassle to reverse a multi-ingredient consume).
- Don't `shopping-list-clear` without explicit user OK if there are unfinished items on it — there's no soft-delete.
- Don't bulk-create products from a generic "what's in your fridge" guess — every wrong product pollutes the products table and survives forever (slug-equivalent: the row id). Confirm each item with the user first, especially during initial pantry bootstrap.
- Don't write meal plans silently — Grocy is single-household but the calendar is shared with anyone using the instance.
- Don't confuse this with Mealie. If the user wants URL recipe scraping, Mealie is still better; if they want macro/micro per-meal diary tracking, route to SparkyFitness.
