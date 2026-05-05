---
name: usda-foods
description: Search the USDA FoodData Central API, fetch canonical food nutrient details, normalize per-100g nutrition, and generate SparkyFitness-compatible food payloads. Use when adding missing foods to SF, validating food nutrition, or comparing local foods against USDA references.
---

# usda-foods

Use this skill when you need authoritative food nutrition from USDA FoodData Central, especially for creating or correcting SparkyFitness foods.

## Security

Use the `pass-secrets` skill for the USDA API key at:

- `ruben/usda`

Never run `pass show` directly.

## Files

- `./usda.sh` — search/details/raw wrapper for USDA FoodData Central
- `./sf-food-from-usda.py` — convert USDA details JSON into a SparkyFitness `POST /api/foods` payload

## Commands

### Search USDA

```bash
/home/istar/code/ai-tools/skills/pass-secrets/pass-run.sh exec ruben/usda USDA_API_KEY -- \
  /home/istar/code/ai-tools/skills/usda-foods/usda.sh search "cod raw"
```

### Fetch USDA details

```bash
/home/istar/code/ai-tools/skills/pass-secrets/pass-run.sh exec ruben/usda USDA_API_KEY -- \
  /home/istar/code/ai-tools/skills/usda-foods/usda.sh details 173944
```

### Generate SF payload from USDA details

```bash
/home/istar/code/ai-tools/skills/pass-secrets/pass-run.sh exec ruben/usda USDA_API_KEY -- bash -lc '
  /home/istar/code/ai-tools/skills/usda-foods/usda.sh details 173944 > /tmp/usda-food.json && \
  /home/istar/code/ai-tools/skills/usda-foods/sf-food-from-usda.py /tmp/usda-food.json
'
```

## Workflow: add a USDA food to SparkyFitness

1. Search USDA for the food.
2. Prefer generic foods such as `Foundation` or `SR Legacy` over branded items.
3. Fetch details for the chosen `fdcId`.
4. Convert the USDA details JSON with `./sf-food-from-usda.py`.
5. Review the resulting per-100g payload.
6. Ask before writing persistent SF foods.
7. Create the food in SF with:

```bash
/home/istar/code/ai-tools/skills/sparkyfitness-meals/sf POST /api/foods '<payload-json>'
```

## Notes

- USDA generic foods are usually normalized per 100g, which maps well to SF custom foods.
- The converter extracts common SF nutrients when present: calories, protein, carbs, fat, saturated fat, polyunsaturated fat, monounsaturated fat, cholesterol, sodium, potassium, fiber, sugars, vitamin A, vitamin C, calcium, iron.
- Missing nutrients default to `0` in the generated SF payload.
- For liquids, you may still choose `serving_unit: "ml"` manually when density is effectively 1 g/ml, but the default output is `100 g`.

## Don’t

- Don’t expose the USDA API key in output.
- Don’t create SF foods without user confirmation.
- Don’t blindly choose branded USDA entries when a generic raw/cooked entry exists.
