#!/usr/bin/env python3
import json
import sys

if len(sys.argv) != 2:
    print("usage: sf-food-from-usda.py <usda-details.json>", file=sys.stderr)
    sys.exit(1)

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

nutrients = {}
for item in data.get("foodNutrients", []):
    num = item.get("nutrient", {}).get("number") or item.get("nutrientNumber")
    amount = item.get("amount")
    if num is not None and amount is not None:
        nutrients[str(num)] = amount

# USDA nutrient number mapping
# 208 kcal, 203 protein, 205 carbs, 204 fat, 606 sat fat, 645 mono, 646 poly,
# 601 cholesterol, 307 sodium, 306 potassium, 291 fiber, 269 sugars,
# 318 vitamin A RAE, 401 vitamin C, 301 calcium, 303 iron
payload = {
    "name": data.get("description", "USDA food"),
    "brand": data.get("brandOwner") or "",
    "is_custom": True,
    "shared_with_public": False,
    "provider_external_id": str(data.get("fdcId", "")),
    "provider_type": "usda",
    "serving_size": 100,
    "serving_unit": "g",
    "calories": nutrients.get("208", 0),
    "protein": nutrients.get("203", 0),
    "carbs": nutrients.get("205", 0),
    "fat": nutrients.get("204", 0),
    "saturated_fat": nutrients.get("606", 0),
    "polyunsaturated_fat": nutrients.get("646", 0),
    "monounsaturated_fat": nutrients.get("645", 0),
    "trans_fat": nutrients.get("605", 0),
    "cholesterol": nutrients.get("601", 0),
    "sodium": nutrients.get("307", 0),
    "potassium": nutrients.get("306", 0),
    "dietary_fiber": nutrients.get("291", 0),
    "sugars": nutrients.get("269", 0),
    "vitamin_a": nutrients.get("318", 0),
    "vitamin_c": nutrients.get("401", 0),
    "calcium": nutrients.get("301", 0),
    "iron": nutrients.get("303", 0),
}

print(json.dumps(payload, indent=2))
