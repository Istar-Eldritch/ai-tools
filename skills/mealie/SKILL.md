---
name: mealie
description: Browse, plan, and shop with the user's Mealie instance. Use when the user wants to find a recipe, scrape a recipe from a URL, schedule meals on the calendar, build a shopping list, or get "what can I cook with X" suggestions.
user-invocable: true
---

<!--
Claude Code users: to allow the `mealie` wrapper without per-call prompts, add to
~/.claude/settings.json under permissions.allow (path is wherever you symlink/
copy this skill — typically ~/.claude/skills/mealie/mealie):

  "Bash(~/.claude/skills/mealie/mealie *)"
  "Bash(jq *)"
  "Bash(date *)"
-->

# mealie

Wraps the [Mealie](https://mealie.io/) REST API for recipe management, meal planning, and shopping lists. Mealie is a self-hosted recipe manager — its strengths are URL scraping, ingredient parsing, and a structured food/unit database.

Four main flows:

1. **Find or scrape a recipe** — search the user's library, or pull one from a URL via Mealie's scraper.
2. **Author a recipe from scratch** — POST a skeleton, then PUT a full body with ingredients, instructions, and nutrition.
3. **Plan meals on the calendar** — schedule recipes (or freeform notes) per date+entryType (breakfast/lunch/dinner/side/snack/drink/dessert).
4. **Shopping** — create lists, add items (with the ingredient parser).

This skill is *separate* from `sparkyfitness-meals`. SparkyFitness tracks macros + calorie goals against logged food entries; Mealie manages recipes and meal calendars without nutrition tracking. They can complement each other: plan in Mealie, log to SparkyFitness. To import a Mealie recipe as a logged food in SparkyFitness, use `sf mealie-import <slug>` from the sparkyfitness-meals skill — see its **Mealie integration** section for the SF-side contract and the `recipeYield` shaping rule.

## Install

Symlink this directory into `~/.claude/skills/`:

```bash
ln -s "$(pwd)/mealie" ~/.claude/skills/mealie
```

…or just leave it under `ai-tools/skills/` if that directory is already a registered plugin (the `ai-tools` plugin auto-loads everything in its `skills/` subdir).

## Setup

Generate an API token in the Mealie UI (User Profile → API Tokens) and put it at `~/.config/mealie/credentials` (chmod 600):

```
MEALIE_BASE_URL=https://your-instance.example.com
MEALIE_API_KEY=<token>
# Optional, if your instance serves a non-trusted (e.g. self-signed) cert:
# MEALIE_INSECURE=1
# MEALIE_CA_BUNDLE=/path/to/ca.pem
```

```bash
install -d -m 700 ~/.config/mealie
install -m 600 /dev/null ~/.config/mealie/credentials
$EDITOR ~/.config/mealie/credentials
```

The wrapper also accepts `MEALIE_BASE_URL` / `MEALIE_API_KEY` from the environment, so you can inject them via [pass-secrets](../pass-secrets/) instead of writing to disk.

## CLI helper

`./mealie` (next to this SKILL.md) is a thin curl wrapper. Always use it — it adds auth and the base URL.

```
mealie self
mealie recipes [search] [page] [perPage]
mealie recipe <slug>
mealie suggestions [foodId,foodId,...] [limit]
mealie mealplans [start_date] [end_date]
mealie mealplan-add <date> <entryType> <recipeId>
mealie mealplan-text <date> <entryType> <title> [text]
mealie mealplan-delete <id>
mealie shopping-lists
mealie shopping-list <listId>
mealie shopping-list-create <name>
mealie shopping-list-delete <listId>
mealie shopping-add <listId> "<text>"      # parsed via NLP, attached as a note
mealie cookbooks
mealie foods [search] [perPage]
mealie units [search] [perPage]
mealie categories
mealie tags
mealie scrape-url <url>                     # scrape + create a recipe
mealie parse "<ingredient text>"            # parse, don't save
mealie <METHOD> <path> [body-json]          # raw request, pretty-printed
mealie raw <METHOD> <path> [body-json]      # raw, no jq
```

`entryType` is one of: `breakfast`, `lunch`, `dinner`, `side`, `snack`, `drink`, `dessert`.

## Verified contracts

These have been round-tripped against the live instance.

### `GET /api/users/self`

Returns the authenticated user including `householdId`, `groupId`, `admin`, and an array of API tokens. Mealie tokens carry the user's full permissions — there are no per-token scopes, so an admin's token can do everything.

### `GET /api/recipes?search=<q>&page=&perPage=` — list / search

Returns paginated `{page, per_page, total, total_pages, items, next, previous}` where each item is a *summary* (no ingredients/instructions). Use `mealie recipe <slug>` for the full body. The `search` param does fuzzy matching on name + description.

Other useful filters: `categories`, `tags`, `tools`, `foods` (UUID lists), `requireAllX=true`, `cookbook` (UUID), `orderBy`, `orderDirection`. List of food/category/tag UUIDs is comma-separated in the query string.

### `GET /api/recipes/{slug}` — full recipe

Returns the full recipe including:
- `recipeIngredient[]` — each ingredient is `{quantity, unit:{id,name,abbreviation,...}, food:{id,name,label,...}, note, display}`. The `display` field is the rendered "80 grams Oats" string.
- `recipeInstructions[]` — `{id, title, summary, text, ingredientReferences}`.
- `nutrition` — usually all `null` unless the user filled it in (Mealie doesn't auto-compute).
- `settings`, `assets`, `notes`, `extras`, `comments`.

Note: `recipeServings` is on the top-level (not under nutrition). `slug` is what you pass to GET/PUT/PATCH/DELETE.

### `POST /api/recipes` — create a skeleton from a name

Body: `{"name": "Filled Aubergines"}`. Returns the slug as a JSON string (e.g. `"filled-aubergines"`). The created row has only the name + auto-fields populated; everything else (`description`, ingredients, instructions, nutrition, times, yield) is empty/null. Always GET the slug and PUT a full body to flesh it out (see `PUT /api/recipes/{slug}` below).

### `PUT /api/recipes/{slug}` — update (full body required)

Mealie expects the **entire** recipe body on PUT — there is no partial update. Standard pattern:

```
GET  /api/recipes/{slug}   → full object
mutate fields locally
PUT  /api/recipes/{slug}   ← full object with edits
```

Top-level fields the user-facing UI cares about: `name`, `description`, `recipeServings` (float, **how many servings the `nutrition` block describes**), `recipeYield` (string, **describes ONE serving** — see SparkyFitness gotcha in Failure modes), `recipeYieldQuantity` (float, pair with `recipeYield`), `prepTime`/`cookTime`/`totalTime` (ISO-8601 e.g. `"PT15M"`), `recipeIngredient[]`, `recipeInstructions[]`, `nutrition`, `settings.showNutrition`.

For ingredients, the simplest shape is `{"note": "50 g rolled oats"}` per entry — Mealie keeps the literal note string and won't try to parse it. For structured ingredients with `food`/`unit` references, see the 422/500 PUT gotchas in Failure modes.

### `POST /api/recipes/create/url` — scrape a URL into a new recipe (schema-verified)

Body: `{"url": "https://...", "includeTags": true, "includeCategories": true}`. Mealie scrapes the page (recipe schema.org / JSON-LD / heuristics) and creates a real recipe row. Returns the new recipe's slug as a JSON string.

⚠️ Persistent state change. Always confirm with the user before scraping — a low-quality scrape pollutes their library and the slug is sticky.

### `GET /api/recipes/suggestions?foods=<uuid,uuid>&limit=N` — "what can I cook"

⚠️ Different response shape from `/api/recipes`. Returns `{items: [{recipe, missingFoods, missingTools}]}` — no pagination wrapper. Each item has the full recipe summary plus arrays of foods/tools you're missing for it. Empty `foods` query returns *all* recipes ranked by `(missingFoods + missingTools)` ascending.

To call this usefully: first `mealie foods <name>` to find food UUIDs, then pass them comma-separated.

### `GET /api/households/mealplans?start_date=&end_date=` — calendar

Returns paginated meal-plan entries. Each entry has integer `id` (not UUID), `date` (YYYY-MM-DD), `entryType`, `title`, `text`, `recipeId`, plus a joined `recipe` object when `recipeId` is set. Without a date filter you get *all* entries — almost always pass `start_date`/`end_date`.

### `POST /api/households/mealplans` — schedule a meal

Two modes:
- **Recipe entry**: `{date, entryType, recipeId}`. The wrapper's `mealplan-add` form.
- **Freeform note** (no recipe): `{date, entryType, title, text}`. The wrapper's `mealplan-text` form.

Verified: `POST` with `{date:"2026-04-27", entryType:"breakfast", recipeId:"<uuid>"}` returns the created entry with integer `id`. `DELETE /api/households/mealplans/{id}` cleans up. The `entryType` enum is `breakfast | lunch | dinner | side | snack | drink | dessert` — Mealie has more entry types than SparkyFitness's four meal types.

`POST /api/households/mealplans/random` body `{date, entryType}` picks a random recipe respecting any plan rules the user has configured.

### `GET /api/households/shopping/lists` and `POST` — shopping lists

Lists are simple: `POST` body is `{"name": "..."}`. The response includes auto-generated `labelSettings` (one per food label in the system, used to control list ordering) — you can ignore those for most flows.

`DELETE /api/households/shopping/lists/{listId}` removes the list and its items.

### `POST /api/households/shopping/items` — add an item

Required: `shoppingListId`. Common shapes:
- **Free text** (what the wrapper's `shopping-add` does): `{shoppingListId, note, display, quantity:1}`. The note shows up as a checkable line.
- **Structured** (linked to a Mealie food/unit): `{shoppingListId, foodId, unitId, quantity, note}`. Use this when the user wants the item to deduplicate against existing list items by food.

Bulk variant: `POST /api/households/shopping/items/create-bulk` accepts an array body — handy for materializing a recipe's ingredients onto a list.

⚠️ The endpoint has `extras` declared *twice* in the schema (once at the top-level, once inside the inner ingredient block). Send it once at the top level if you need it; the duplicate is a quirk of how the schema was generated.

### `POST /api/parser/ingredient` — parse "1 cup flour, sifted" without saving

Body: `{"parser": "nlp", "ingredient": "..."}`. Returns:

```jsonc
{
  "input": "1 1/2 tsp kosher salt, finely ground",
  "confidence": { "average": 0.999, "name": null, "unit": 0.999, "quantity": 1.0, "food": 0.998 },
  "ingredient": {
    "quantity": 1.5,
    "unit": { "id": "<uuid>", "name": "teaspoon", ... },   // resolved to existing unit
    "food": { "id": null, "name": "kosher salt", ... },     // id null = not in user's DB yet
    "note": "finely ground",
    "display": "..."
  }
}
```

The parser resolves units against the user's unit DB (returns existing unit with `id`), but only matches food names (`food.id` is null when there's no match — Mealie won't auto-create a food). Useful for converting a typed ingredient line into structured shopping/recipe data.

`parser` can be `"nlp"` (default, ML model) or `"brute"` (regex). NLP is better unless input is malformed.

### `GET /api/foods` and `GET /api/units`

Both paginated. `total` is the count across the whole instance — this user's instance ships with 2698 stock foods and 33 stock units, so always pass `search` or you'll get firehose pages. Each food has `{id, name, label}`. Each unit has `{id, name, pluralName, abbreviation, fraction, standardUnit}`.

### `GET /api/households/cookbooks`

Cookbooks are saved smart-searches. Each cookbook is `{name, queryFilterString, slug, public, position}`. The `queryFilterString` is a Mealie filter expression (e.g. `tags.name="dessert"`) — recipes matching it are members. Empty on this instance currently.

### `GET /api/organizers/{categories,tags,tools}`

Three parallel taxonomies. Each item is `{id, name, slug}`. Categories and tags are user-managed; tools are equipment ("oven", "blender") used by `recipes/suggestions` to filter on what the user has on hand.

## Standard "find me a recipe" flow

1. `mealie recipes <search>` — narrow by keyword. If nothing matches the user's library:
2. Either `mealie scrape-url <url>` (with explicit confirmation) to add one, or
3. `mealie suggestions <foodIds> <limit>` if they want something built from what's already in their food DB.
4. Always finish with `mealie recipe <slug>` to show the full ingredients/instructions.

## Standard "author a recipe from scratch" flow

Use when the user describes a recipe in conversation rather than giving a URL.

1. `mealie POST /api/recipes '{"name":"<title>"}'` — creates the skeleton, returns the slug.
2. `mealie recipe <slug>` — fetch the full object (you need it for the PUT round-trip).
3. Locally fill in `description`, `recipeServings`, `recipeYield` (per-serving unit, see gotcha), `recipeYieldQuantity:1`, ISO times, `recipeIngredient[]` as `{note}` items, `recipeInstructions[]` as `{text}` items, and `notes` if helpful.
4. `mealie PUT /api/recipes/<slug> "$(<file)"` — push the modified body. (For non-trivial bodies, write the JSON to a temp file rather than embedding in shell.)
5. Compute and PUT nutrition — see the **Nutrition** section below. SparkyFitness will show zero macros without it.

## Nutrition

Mealie does **not** auto-calculate nutrition from `recipeIngredient`. The `nutrition` object is a manual data-entry field that ships all-null. SparkyFitness's Mealie provider reads it directly — empty `nutrition` = imported food shows zero kcal.

### Schema

Schema.org-style names; **values are STRINGS, expressed per ONE serving** (matching `recipeServings`):

```json
{
  "calories":             "382",
  "proteinContent":       "12.0",
  "fatContent":           "28.6",
  "saturatedFatContent":  "6.0",
  "unsaturatedFatContent":"22.6",
  "transFatContent":      "0",
  "carbohydrateContent":  "22.6",
  "fiberContent":         "5.8",
  "sugarContent":         "8.8",
  "sodiumContent":        "136",
  "cholesterolContent":   "15"
}
```

Also flip `settings.showNutrition: true` so the panel renders in the Mealie UI.

### Computing from USDA FDC (the right way)

The user wants real per-100 g macros, not back-of-envelope estimates. Use USDA's Food Data Central API directly. The user's API key is in `pass ruben/usda` (single-line entry — `pass ruben/usda` prints the key directly).

```bash
KEY=$(pass ruben/usda)
curl "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=$KEY&query=eggplant&dataType=Foundation,SR%20Legacy&pageSize=5"
curl "https://api.nal.usda.gov/fdc/v1/food/{fdcId}?api_key=$KEY"
```

Pipeline:

1. For each ingredient, search USDA. Prefer `dataType=Foundation,SR Legacy`. Pick a fdcId.
2. Fetch `/food/{fdcId}` and read `foodNutrients`. Foundation/SR Legacy entries are normalised per 100 g of edible portion.
3. Multiply per-100g macros by gram amount per serving.
4. Sum ingredient contributions to get per-serving recipe totals.
5. PUT the result into Mealie's `nutrition` block.

A worked example computing nutrition for the `vegan-bechamel` and `filled-aubergines` recipes lives at `/home/istar/code/personal/meals/compute_nutrition.py` — adapt the per-recipe `(fdcId, grams)` tuple lists at the bottom for new recipes.

### USDA gotchas

- **Energy nutrient ID**: 1008 is kcal, 1062 is kJ. Some Foundation entries (e.g. `Oat milk, unsweetened` fdc 2257046) **omit 1008** and report Energy only as id **2047** (Atwater General Factors) or **2048** (Atwater Specific). Read 1008 first, fall back to 2047/2048 — otherwise that ingredient contributes 0 kcal silently. (Cost us a 12 % undercount on Filled Aubergines on first run.)
- **Fibre nutrient ID**: SR Legacy uses **1079** ("Fiber, total dietary") but Foundation uses **2033** ("Total dietary fiber (AOAC 2011.25)"). If your reader only checks 1079, Foundation entries (e.g. cannellini beans fdc 2644287) silently contribute zero fibre — caught a 60% undercount on Leek/Bean/Feta Bake before publishing. Read both ids.
- **Foundation 404s**: some Foundation fdcIds (e.g. `328637` "Cheese, cheddar") return from `/foods/search` but **404 on `/food/{id}`**. Fall back to the SR Legacy alternative (e.g. `170899` "Cheese, cheddar, sharp, sliced").
- **Branded foods** are last resort — quality varies, units are non-uniform. Only use when SR Legacy/Foundation has nothing.
- **Rate limit**: USDA's FDC key allows ~1000/hour. Cache fdcId responses within a single computation.
- **Don't go via SparkyFitness**: SparkyFitness exposes `/api/foods/usda/search?query=…` (with header `x-provider-id: <usda provider id>` — look it up in `/api/external-providers`) but it just proxies USDA upstream and gets rate-limited the same way. Direct USDA is one fewer moving part.

### Reference fdcIds (verified, fetchable)

Build up this table as new ingredients come up.

| Ingredient                | fdcId   | Type        | Notes                                |
| ------------------------- | ------- | ----------- | ------------------------------------ |
| Wheat flour, white, AP    | 168894  | SR Legacy   | enriched, bleached                   |
| Olive oil                 | 171413  | SR Legacy   | "Oil, olive, salad or cooking"       |
| Eggplant, raw             | 169228  | SR Legacy   | (Foundation 2685577 fetches but is less complete) |
| Onions, raw               | 170000  | SR Legacy   |                                      |
| Garlic, raw               | 169230  | SR Legacy   |                                      |
| Tofu, extra firm (nigari) | 174290  | SR Legacy   |                                      |
| Cheddar, sharp, sliced    | 170899  | SR Legacy   | use this — Foundation 328637 404s    |
| Oat milk, unsweetened     | 2257046 | Foundation  | uses Atwater Energy id 2047          |
| Leeks, raw                | 169246  | SR Legacy   | "(bulb and lower leaf-portion)"      |
| Cannellini beans, canned  | 2644287 | Foundation  | drained and rinsed; uses 2047 + fibre id 2033 |
| Feta cheese, crumbled     | 2259796 | Foundation  | whole milk                           |
| Lemon juice, raw          | 167747  | SR Legacy   |                                      |
| Bread crumbs, dry, plain  | 174928  | SR Legacy   | grated                               |
| Carrots, raw              | 170393  | SR Legacy   |                                      |
| Celery, raw               | 169988  | SR Legacy   |                                      |
| Tomatoes, red, ripe, raw  | 170457  | SR Legacy   | "year round average"                 |
| Tomatoes, crushed, canned | 170501  | SR Legacy   |                                      |
| Lentils, raw              | 172420  | SR Legacy   | use this — Foundation 2644283 has no fibre data |
| Bread, wheat              | 172686  | SR Legacy   | generic multigrain/wheat profile     |

## Standard "plan a week" flow

1. `mealie mealplans <monday> <sunday>` — see what's already on the calendar.
2. For each empty `(date, entryType)` slot, propose a recipe (search by name; resolve to slug → recipe id).
3. Confirm with the user — show a per-day summary of name + entryType.
4. Write entries: one `mealie mealplan-add <date> <entryType> <recipeId>` per slot. For ad-hoc meals with no recipe, use `mealplan-text` with a `title` (e.g. "leftovers").
5. Re-show `mealie mealplans <monday> <sunday>` so the user sees the final calendar.

For "plan today only", same flow with `start=end=$(date -u +%F)`.

## Standard "build a shopping list from a recipe" flow

1. `mealie recipe <slug>` — pull the ingredient list.
2. `mealie shopping-list-create "<name>"` if the user doesn't already have a target list. Save the returned `id`.
3. For each ingredient in `recipeIngredient[]`, decide structured-vs-text:
   - If `food.id` is non-null and the unit/food look stable, post structured `{shoppingListId, foodId, unitId, quantity, note}`.
   - Otherwise post text via `mealie shopping-add <listId> "<display>"` — Mealie keeps the literal string and the user can fix it in the UI.
4. `mealie shopping-list <listId>` to confirm.

For a multi-recipe shopping run, prefer `POST /api/households/shopping/items/create-bulk` with an array.

## Dates and the user's clock

The wrapper uses `date -u +%F` for "today" defaults. For user-facing "today", prefer the conversation's `currentDate` system context to avoid TZ drift on midnight-edge requests.

## Failure modes worth knowing

- **How SparkyFitness imports `recipeServings` + `recipeYield`** — the SF Mealie provider passes both fields through **completely raw, no parsing** (verified in source: `SparkyFitnessServer/integrations/mealie/mealieService.ts` `mapMealieRecipeToSparkyFood`):

  ```ts
  serving_size = recipeServings || 1     // raw number
  serving_unit = recipeYield || 'serving' // raw string, no leading-number extraction
  ```

  So whatever pair `(recipeServings, recipeYield)` is in Mealie becomes `(serving_size, serving_unit)` in SparkyFitness as-is. Examples (all verified live):

  | Mealie `(recipeServings, recipeYield)` | SF stores                | Logging UX |
  | -------------------------------------- | ------------------------ | ---------- |
  | `(2, "1 half")`                         | `size:2, unit:"1 half"`  | natural — log `quantity:2, unit:"1 half"` for whole serving |
  | `(4, "1 portion")`                      | `size:4, unit:"1 portion"` | log integer portions |
  | `(1, "1 portion (~300 g)")`             | `size:1, unit:"1 portion (~300 g)"` | natural — `quantity:1` = whole portion |
  | `(1, "300 g")`                          | `size:1, unit:"300 g"`   | clunky — to log 250 g you'd need `quantity:0.83` |

  **Rule: shape `recipeYield` as a discrete countable unit (`"1 portion"`, `"1 half"`, `"1 bowl"`), NOT a measurement (`"300 g"`, `"500 ml"`).** Mass/volume shapes don't get parsed — they end up as awkward unit strings that force fractional quantities for partial servings. Put grams/ml in parentheses (`"1 portion (~300 g)"`) for human reference instead. `recipeServings` should be the count of those units the recipe yields; nutrition is per ONE serving. After changing yield on an already-imported recipe, the user must delete the SF local food and re-import — Mealie changes don't auto-propagate, and SF's Mealie search dedupes already-imported recipes.

- **404 on `/api/recipes/{slug}`** — slugs are not URL-encoded paths; they're already safe ASCII. If you 404, double-check the slug from `mealie recipes` rather than guessing a transformation of the name.
- **422 on `/api/households/mealplans`** — `entryType` is restricted to the seven enum values above; sending "snacks" (plural) or "lunchtime" 422s. Same for `parse` — `parser` must be `nlp` or `brute`.
- **422 on `PUT /api/recipes/{slug}` "Field required: ...food/unit.name"** — the validator rejects `food: {id: <uuid>}` and `unit: {id: <uuid>}`. You **must** include both `id` AND `name` (and ideally the rest of the food/unit object) on every ingredient ref. Cheapest workaround: round-trip the existing object — `GET` the food/unit (or use the cached row from `/api/foods` listing) and pass the full server shape back.
- **500 "Unknown Error" / `ValueError` on `PUT /api/recipes/{slug}`** with multiple inline `food: {name: "..."}` creates. A single inline create works (we tested), but two or more in one recipe trips a server-side ValueError with no useful detail. **Workaround: pre-create the food via `POST /api/foods` body `{"name": "..."}`** (returns the full new food row), then reference it on the recipe. The `POST /api/foods` endpoint is fine to call repeatedly — it 200s and creates new rows even if a similar name already exists, so check first via the bulk listing.
- **`mealie foods <search>` and `mealie recipes <search>` return fuzzy/relevance matches, not exact matches.** `items[0]` is *not* guaranteed to be the food/recipe you searched for — if there's no match Mealie still returns *something*. ⚠️ This bit us once: piping the search result into a DELETE deleted an unrelated food row. Always verify `items[0].name == your_search` before mutating, or pre-list all foods once and resolve from a name→object map locally.
- **Empty `total: null` on suggestions** — that endpoint genuinely doesn't paginate (no `total` field); don't treat the missing field as an error.
- **TLS errors** — see Setup. `MEALIE_INSECURE=1` or `MEALIE_CA_BUNDLE=...`.
- **The OpenAPI spec at `/openapi.json` is fully accurate** for this instance (Mealie v3.16.0). Unlike SparkyFitness, you can trust it as a fallback.

## Don't

- Don't `scrape-url` without explicit confirmation — it creates a real recipe row whose slug is sticky and will show up in the user's library.
- Don't write meal plans silently — the calendar is shared per-household and the user may have other people viewing it. Show the plan and ask before `POST`.
- Don't pass `perPage` higher than ~200 to listing endpoints — the server doesn't hard-cap but very large pages slow down noticeably.
- Don't try to mutate `nutrition` via PATCH expecting auto-compute — Mealie stores whatever you send and never derives it from `recipeIngredient`.
- Don't confuse this with `sparkyfitness-meals`. Mealie's "meal plan" ≠ a calorie diary; if the user wants macro tracking, route to SparkyFitness instead.
