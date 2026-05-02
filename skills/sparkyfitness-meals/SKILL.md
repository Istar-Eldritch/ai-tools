---
name: sparkyfitness-meals
description: Plan and log meals against the user's SparkyFitness instance. Use when the user wants to plan a day or week of meals, check their nutrition goals/intake, build a saved meal, or write food entries to their diary.
user-invocable: true
---

<!--
Claude Code users: to allow the `sf` wrapper without per-call prompts, add to
~/.claude/settings.json under permissions.allow (path is wherever you symlink/
copy this skill — typically ~/.claude/skills/sparkyfitness-meals/sf):

  "Bash(~/.claude/skills/sparkyfitness-meals/sf *)"
  "Bash(jq *)"
  "Bash(date *)"
-->

# sparkyfitness-meals

Wraps the [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) REST API for meal planning. Two main flows:

1. **Plan a day or week interactively** — read goals, see what's logged, propose meals against remaining macros, then write food entries.
2. **Build / reuse named meals** — save common meals (e.g. "Morning Oats") via `/api/meals` and reference them when planning.

## Install

Either symlink this directory into `~/.claude/skills/`:

```bash
ln -s "$(pwd)/sparkyfitness-meals" ~/.claude/skills/sparkyfitness-meals
```

…or copy it. Symlink is preferred so updates flow without re-copying.

## Setup

Generate an API key in the SparkyFitness UI (Settings → API Keys) and put it at `~/.config/sparkyfitness/credentials` (chmod 600):

```
SPARKYFITNESS_BASE_URL=https://your-instance.example.com
SPARKYFITNESS_API_KEY=<key>
# Optional, only if your instance serves a non-trusted (e.g. self-signed) cert:
# SPARKYFITNESS_INSECURE=1
# Or pin a specific CA instead:
# SPARKYFITNESS_CA_BUNDLE=/path/to/ca.pem
```

```bash
install -d -m 700 ~/.config/sparkyfitness
install -m 600 /dev/null ~/.config/sparkyfitness/credentials
$EDITOR ~/.config/sparkyfitness/credentials
```

The credentials file is plaintext on disk (mode 600). If you'd rather not have it on disk, see [pass-secrets](../pass-secrets/) — `sf` reads `SPARKYFITNESS_*` from its environment, so you can also export them via `pass-run.sh` instead of using the credentials file.

## CLI helper

`./sf` (next to this SKILL.md) is a thin curl wrapper. Always use it — it adds auth and the base URL.

```
sf goals [YYYY-MM-DD]            # daily macro/water targets
sf today                          # full daily summary (goals + entries + balance)
sf summary <YYYY-MM-DD>
sf meals [searchTerm]             # list / search saved meals
sf meal-types                     # list meal-type IDs (breakfast/lunch/dinner/snacks)
sf foods <searchTerm> [page] [pageSize]
sf food <foodId>                  # one food + default variant
sf variants <foodId>              # list ALL variants of a food
sf add-variant <foodId> <body>    # add a new variant (different unit/serving size)
sf entries <YYYY-MM-DD>           # food entries logged on a date
sf templates                      # list meal-plan templates
sf weekly-plan [YYYY-MM-DD]       # active weekly plan for a date
sf providers                      # list configured external data providers
sf mealie-search <query> [page]   # search Mealie recipes via SF (needs Mealie provider)
sf mealie-details <slug>          # fetch one Mealie recipe in SF food shape
sf mealie-import <slug>           # import a Mealie recipe as a local SF food
sf <METHOD> <path> [body-json]    # raw request, pretty-printed
sf raw <METHOD> <path> [body-json]  # raw, no jq
```

## Verified contracts

These have been round-tripped against the live instance.

### `GET /api/goals/by-date/{date}` — daily targets

Returns `UserGoal`: calories, protein, carbs, fat, water_goal_ml, plus per-macro percentages and per-meal calorie split (`breakfast_percentage`, etc).

### `GET /api/daily-summary?date=YYYY-MM-DD` — the workhorse for "where am I today"

```jsonc
{
  "goals": { /* same shape as /api/goals/by-date */ },
  "foodEntries": [ /* logged entries with snapshotted nutrition */ ],
  "exerciseSessions": [],
  "waterIntake": 0,
  "calorieBalance": { "eaten": 190, "burned": 0, "remaining": 1781, "goal": 1970, "bmr": 1641, ... }
}
```

Use this every time before proposing meals — it has the goals AND what's already logged.

### `GET /api/foods/foods-paginated?searchTerm=…&page=1&pageSize=10`

Returns `{foods: [...], totalCount: N}`. Each food has a `default_variant` with `id`, `serving_size`, `serving_unit`, and per-serving macros. Use the variant's `id` as `variant_id` when logging.

⚠️ Other food-search-looking paths are misleading:
- `GET /api/foods?searchTerm=…` returns `{recentFoods, topFoods}` (history, not search).
- `GET /api/foods/search` requires a `name` param but enforces validations that frequently 400 — prefer `foods-paginated`.

### `GET /api/foods/usda/search?query=…&pageSize=…` — search USDA when food isn't local

`foods-paginated` only searches the user's *local* food DB. If a food isn't there yet, hit USDA. **Requires `x-provider-id` header**, which is the user's USDA provider UUID from `GET /api/external-providers` (filter `provider_type == "usda"`). The same pattern works for `openfoodfacts`, `fatsecret`, `nutritionix` — different mount, same `x-provider-id` requirement. Mount paths are under `/api/foods/<provider>/…` (NOT `/api/food-integration/…` despite the route file name).

Cache the provider UUID once per conversation. The `sf` wrapper doesn't currently set `x-provider-id` — fall back to raw `curl` for these calls (see existing usage in conversation).

Returns a `{foods: [...]}` array of USDA records with `fdcId`, `description`, `dataType` (prefer `SR Legacy` or `Foundation` for generic foods over `Branded`), `foodNutrients[]` (per 100 g for SR/Foundation; Branded items report per-serving in `labelNutrients` and per-100g in `foodNutrients`).

### `GET /api/foods/usda/details?fdcId=…` — full USDA record

Same `x-provider-id` requirement. Returns the full USDA item including all nutrients. Use to extract per-100g values before `POST /api/foods`.

### `POST /api/foods` — create a custom food (with default variant)

⚠️ Persistent state change. Ask the user before creating foods.

Body is **flat** — top-level food fields and variant fields on the same object (the server splits into `foods` + `food_variants` rows internally). Verified working body:

```json
{
  "name": "Bananas, raw",
  "brand": "",
  "is_custom": true,
  "shared_with_public": false,
  "provider_external_id": "173944",
  "provider_type": "usda",
  "serving_size": 100,
  "serving_unit": "g",
  "calories": 89,
  "protein": 1.09,
  "carbs": 22.84,
  "fat": 0.33,
  "saturated_fat": 0, "polyunsaturated_fat": 0, "monounsaturated_fat": 0, "trans_fat": 0,
  "cholesterol": 0, "sodium": 1, "potassium": 358,
  "dietary_fiber": 2.6, "sugars": 12.23,
  "vitamin_a": 3, "vitamin_c": 8.7, "calcium": 5, "iron": 0.26
}
```

Returns the created food with a populated `default_variant.id` — use that as `variant_id` when logging.

USDA → local food translation: keep `serving_size: 100` and `serving_unit` matching what you'll log in (`g` for solids, `ml` for liquids — espresso ≈ 1 g/ml so SR-Legacy per-100g values transfer to per-100ml directly). Default `shared_with_public: false` to keep the user's DB private.

### Multi-variant foods — `POST /api/foods/food-variants`, `GET /api/foods/food-variants?food_id=…`

A single food can carry multiple `food_variants`, each with its own `(serving_size, serving_unit)` + per-serving macros. SparkyFitness UI may not surface variant management for every food, but the API does. Useful pattern: when a recipe imports as `(1, "1 portion (~300 g)")` from Mealie, add a `(100, "g")` variant alongside it so the user can log either by whole portion (`quantity:1, unit:"1 portion (~300 g)"`) or by gram (`quantity:250, unit:"g"`).

Variants are **independent** — each one carries its own copy of macros (no automatic cross-derivation). If you edit one variant's nutrition you must edit the others. The server doesn't link them by gram-equivalence the way USDA/Cronometer would.

Endpoints (mounted under `/api/foods` by way of `foodCrudRoutes`):
- `POST /api/foods/food-variants` — body `{food_id, serving_size, serving_unit, calories, protein, …}`. Returns the created variant with its `id`.
- `GET  /api/foods/food-variants?food_id=…` — list all variants.
- `GET  /api/foods/food-variants/:id` — fetch one.
- `PUT  /api/foods/food-variants/:id` — update.
- `DELETE /api/foods/food-variants/:id` — remove.

⚠️ **The POST response is misleading**: `POST /api/foods/food-variants` returns `{id: "<new-uuid>", food_id: null, serving_size: null, serving_unit: null, calories: null, …}` — every field except `id` comes back null even when the variant is correctly stored on the server. Don't trust the POST response; verify with `GET /api/foods/food-variants?food_id=…` instead. (Same pattern as `POST /api/food-entries` returning `meal_type: null`.)

When logging a food entry, use the variant's `id` as `variant_id` and pass `unit` matching that variant's `serving_unit` so the calorie math is consistent.

### Mealie integration — `GET /api/foods/mealie/{search,details}` + `POST /api/foods` to import

SparkyFitness's Mealie provider exposes recipes as foods. **Important quirks:**
- Both endpoints require an `x-provider-id` header — the UUID of the Mealie provider from `GET /api/external-providers` (filter `provider_type=="mealie"`). Cache it once. The `sf` wrapper auto-discovers it; override via `SPARKYFITNESS_MEALIE_PROVIDER_ID` env if you have multiple Mealie providers.
- `GET /api/foods/mealie/search?query=…` returns an **array** (not paginated wrapper) of mapped recipes. **Already-imported recipes are deduplicated out of the search results** — to re-import after editing the Mealie recipe, the user must first delete the existing local food.
- `GET /api/foods/mealie/details?slug=…` returns `{food: {...}, variant: {...}}` — the same shape `mapMealieRecipeToSparkyFood` produces.
- **There is no dedicated `/import` endpoint.** To materialize as a local food, flatten `food + variant` into a single object and `POST /api/foods` (which accepts `provider_external_id` + `provider_type` to mark it as Mealie-sourced). The `sf mealie-import <slug>` wrapper command does exactly this.

⚠️ **Raw passthrough of Mealie's yield fields** — the SF Mealie service (verified in source: `SparkyFitnessServer/integrations/mealie/mealieService.ts`, `mapMealieRecipeToSparkyFood`) does:

```ts
serving_size = mealieRecipe.recipeServings || 1     // raw number
serving_unit = mealieRecipe.recipeYield     || 'serving' // raw string, no parsing
```

There is **no parsing** of leading numbers from `recipeYield`. So a Mealie recipe with `recipeServings: 1, recipeYield: "300 g"` imports as `serving_size: 1, serving_unit: "300 g"` — meaning to log 250 g you'd need `quantity: 0.83`. **Rule of thumb: Mealie's `recipeYield` should be a discrete countable unit (`"1 portion"`, `"1 half"`, `"1 bowl"`), not a measurement (`"300 g"`).** Put grams in parentheses for human reference instead: `"1 portion (~300 g)"`.

If gram-based logging matters for a Mealie-imported food, add a second variant via `POST /api/foods/food-variants` with `(100, "g")` and per-100g macros. See the multi-variant section above.

### `GET /api/meals[?searchTerm=…]` and `GET /api/meals/search?searchTerm=…`

Both return saved meals (e.g. "Morning Oats") with their full `foods[]` array — each food in a meal has `food_id`, `variant_id`, `quantity`, `unit`, plus snapshotted nutrition.

### `GET /api/meal-types`

Returns the four system meal types: breakfast (sort 10), lunch (20), snacks (30), dinner (40). Their UUIDs are stable per-instance — cache them in conversation if needed.

### `POST /api/food-entries` — log a planned/eaten food

Verified working body:
```json
{
  "food_id": "<uuid from foods-paginated>",
  "variant_id": "<uuid from food.default_variant.id>",
  "meal_type": "breakfast",        // or use meal_type_id with a UUID
  "quantity": 50,
  "unit": "g",                      // should match variant.serving_unit for correct calorie math
  "entry_date": "2026-04-27"
}
```

Server snapshots the variant's nutrition into the row. The `eaten` total in `daily-summary` is computed as `quantity * (per_serving_calories / serving_size)` when units match — verified: 50g of a 100g/379kcal variant → eaten=190; also verified across a 3-item breakfast (354g banana + 55g sourdough + 72ml espresso) summing to eaten=450.

Returns the created entry with `id`. Future-dated `entry_date` works fine — that's how you "plan ahead".

⚠️ **The POST response misleadingly returns `meal_type: null`** even when you sent `"meal_type": "breakfast"` (and the entry actually lands in breakfast). Don't trust the POST response's `meal_type` field — verify by hitting `sf today` (or `/api/daily-summary`), where each entry has both `meal_type` (string) and the resolved `meal_type_id` (UUID).

### `DELETE /api/food-entries/{id}` — undo

Returns `{"message": "Food entry deleted successfully."}`.

### `POST /api/food-entries/copy-all`, `/copy`, `/copy-yesterday`

Powerful for planning: clone a whole day to another date.
- `copy-all`: `{sourceDate, targetDate}` — copies every entry across all meals.
- `copy`: `{sourceDate, sourceMealType, targetDate, targetMealType}`.
- `copy-yesterday`: `{mealType, targetDate}`.

### `GET /api/meals/{id}`, `POST /api/meals`, `PUT /api/meals/{id}`, `DELETE /api/meals/{id}`

CRUD for named saved meals. Body shape mirrors what `GET /api/meals` returns: `{name, description, is_public, serving_size, serving_unit, foods: [{food_id, variant_id, quantity, unit}, ...]}`.

### `GET /api/meal-plan-templates`, `POST /api/meal-plan-templates`, `DELETE /api/meal-plan-templates/{id}`

Full template CRUD works. Verified body for `POST`:

```json
{
  "plan_name": "High-protein cut",
  "description": "...",
  "start_date": "2026-04-27",
  "end_date": null,
  "is_active": false,
  "assignments": [
    {"day_of_week": 1, "meal_type": "breakfast", "item_type": "meal", "meal_id": "<saved-meal-uuid>"},
    {"day_of_week": 1, "meal_type": "lunch",     "item_type": "food", "food_id": "<uuid>", "variant_id": "<uuid>", "quantity": 200, "unit": "g"},
    ...
  ]
}
```

Notes:
- `assignments[].day_of_week` is an integer per assignment (one row per day per slot — e.g. for a 7-day plan with 4 meals each, expect ~28 assignments). Use `meal_type` string ("breakfast"/"lunch"/"snacks"/"dinner") or `meal_type_id` UUID.
- Each assignment is either `item_type: "meal"` (with `meal_id`, optional `quantity`/`unit` defaulting to 1/serving) or `item_type: "food"` (with `food_id`, `variant_id`, `quantity`, `unit`).
- ⚠️ **`is_active: true` triggers a side effect**: `createFoodEntriesFromTemplate` writes real food-entries to today's diary for whichever day-of-week today matches. Default to `is_active: false` and ask the user before activating.
- Server-returned object includes a joined `assignments` array with `meal_name`/`food_name` for display.

⚠️ Dead routes on every version up to v0.16.5.8 (latest as of 2026-04): the four `/meal-plan-templates/presets[/:id]` routes (POST/GET/PUT/DELETE) all 500 with `mealPlanTemplateService.<fn> is not a function`. The route handlers reference unimplemented service methods that were silenced with `@ts-expect-error` during the JS→TS migration in PR #1118. There is no `meal_day_presets` table — the *real* data model is `meal_plan_template_assignments`, accessible via the regular `/meal-plan-templates` routes above. **Don't call `/presets`.**

### `GET /api/weekly-goal-plans/active?date=YYYY-MM-DD`

Returns the active `WeeklyGoalPlan` for a date (or empty body if none). This is the goals-side equivalent of meal plan templates — references day-presets that aren't implemented either, so probably safer to use `/api/meal-plan-templates` for the planning side and ignore weekly-goal-plans unless the user has set them up via the UI.

## Standard "plan today" flow

1. `sf today` → read `goals` and current `calorieBalance.remaining`, plus what's already logged in `foodEntries`.
2. Compute remaining macros (`goals.{calories,protein,carbs,fat}` minus current totals).
3. Propose meals to the user against the per-meal split (`breakfast_percentage`, etc). Reference saved meals (`sf meals`) if the user has good ones.
4. For each chosen item, find the food: `sf foods <name>` → grab `id` and `default_variant.id`. If multiple variants matter, `sf food <foodId>` to see them all.
5. Confirm with the user before writing — show a per-meal summary with calories/macros.
6. Write entries: one `POST /api/food-entries` per food. Use the variant's `serving_unit` as `unit` so the math is correct.
7. Show the resulting `sf today` so the user can see where they land vs. goals.

## Standard "plan a week" flow

Three options, pick whichever fits the request:

1. **Copy from history** (fastest): find a representative past day with `sf entries <date>`, then `POST /api/food-entries/copy-all` (or `/copy` per meal slot) for each of the 7 target dates. Best when the user already has a day they like.
2. **Author from saved meals into food-entries** (no template): for each day, decide breakfast/lunch/dinner/snacks from `sf meals`, then write entries day-by-day. Works when the plan only matters for one specific week.
3. **Reusable meal-plan template** (when the user wants something they can re-apply): `POST /api/meal-plan-templates` with one assignment per `(day_of_week × meal_type)` slot. Keep `is_active: false` while authoring; activate later from the UI or by `PUT`-ing `is_active: true` (which writes today's day-of-week assignments to the diary as a side effect).

Always finish by showing a per-day `sf summary` so the user sees where they land vs. goals.

## Authoring a new saved meal

When the user describes a meal they eat often:

1. Resolve each component food via `sf foods <name>`. If the user's instance doesn't have it, you can `POST /api/foods` with custom nutrition — but ask first.
2. `POST /api/meals` with:
```json
{
  "name": "Greek Yogurt Bowl",
  "description": "",
  "is_public": false,
  "serving_size": 1,
  "serving_unit": "serving",
  "foods": [
    {"food_id": "<uuid>", "variant_id": "<uuid>", "quantity": 200, "unit": "g"},
    {"food_id": "<uuid>", "variant_id": "<uuid>", "quantity": 30,  "unit": "g"}
  ]
}
```
3. From then on it shows up in `sf meals`.

## Dates and the user's clock

`date -u +%F` is what `sf` uses internally. Today is what the conversation context says (currentDate from the system prompt) — prefer that when the user says "today" so we don't drift on TZ.

## Failure modes worth knowing

- **400 "X is required."** — the param name in the docstring may be different from the route's actual handler. The route source is authoritative; check `https://github.com/CodeWithCJ/SparkyFitness/tree/main/SparkyFitnessServer/routes`.
- **500 "X is not a function"** — that endpoint is broken on this build (e.g. `meal-plan-templates/presets`). Note it and route around.
- **403** — the API key lacks the required permission/scope. The missing scope is usually in the response body. The full set of scopes isn't well-documented upstream; if a request 403s repeatedly, generate a fresh key with broader access from the UI.
- **TLS / cert errors** — see Setup. Set `SPARKYFITNESS_INSECURE=1` or `SPARKYFITNESS_CA_BUNDLE=…` in the credentials file.

## Don't

- Don't write food entries silently — always show the user the day's plan and ask before `POST`. The diary is real and visible.
- Don't change `meal_type_id` directly unless you've already pulled the IDs from `sf meal-types` — using the `meal_type` string ("breakfast", "lunch", "snacks", "dinner") is simpler and verified to work.
- Don't `POST /api/foods` (custom food creation) without explicit confirmation — these pollute the food DB and have a public-share flag.
- Don't trust `/openapi.json`, `/swagger`, or `/api-docs` at the root — they're SPA fallthroughs returning HTML. The real spec is `GET /api/api-docs/json` (auth required) and is incomplete (paths block is empty); treat the route source on GitHub as the source of truth.
