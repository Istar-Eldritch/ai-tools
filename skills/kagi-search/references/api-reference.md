# Kagi Search API Reference

Source: https://help.kagi.com/kagi/api/search.html

---

## Overview

The Kagi Search API provides programmatic access to Kagi's premium search results.

> **NOTE:** The Search API is in closed beta and available upon request. Contact support@kagi.com for an invite.

## Quick Start

1. Get the [API key](https://kagi.com/settings/api) (requires a Kagi account)
2. Call the API (see examples below)

## API Key

1. [Create a Kagi account](https://kagi.com/signup?plan_id=trial)
2. Navigate to Settings -> Advanced -> API portal, or go to [https://kagi.com/settings/api](https://kagi.com/settings/api)
3. Click "Generate API Token"

### Token Notes

- **The token will only be shown once** - store it securely
- Generating a new token invalidates the old one
- Tokens do not expire

## Pricing

- **$25 for 1000 queries** (2.5 cents per search)
- Add funds at the [API Billing panel](https://kagi.com/settings/billing_api)

## SDK

Python SDK: [kagiapi](https://github.com/kagisearch/kagiapi)

---

## Base URL

```
https://kagi.com/api/v0
```

Currently in beta with version "v0". Breaking changes may occur.

---

## Authentication

Pass authentication as a standard `Authorization` HTTP header:

```
Authorization: Bot YOUR_API_TOKEN
```

Token type: `Bot`

### IP Limit (Optional)

You can restrict API access to specific IP addresses in [API Settings](https://kagi.com/settings/api).

---

## Endpoints

### Execute Search

```
GET /search
```

Performs a search and returns an array of Search Objects.

#### Query Parameters

| Field | Type   | Description                          |
|-------|--------|--------------------------------------|
| q     | string | Search query                         |
| limit | int    | Limit number of Search Result items  |

#### Example Request

```shell
curl -v \
  -H "Authorization: Bot $TOKEN" \
  "https://kagi.com/api/v0/search?q=steve+jobs"
```

#### Example Response

```json
{
  "meta": {
    "id": "69c3f5c4168f66b860e951c585550f1c",
    "node": "us-central1",
    "ms": 213,
    "api_balance": 123.456
  },
  "data": [
    {
      "t": 0,
      "url": "https://en.wikipedia.org/wiki/Steve_Jobs",
      "title": "Steve Jobs - Wikipedia",
      "snippet": "Steven Paul Jobs (February 24, 1955 – October 5, 2011) was an American businessman...",
      "thumbnail": {
        "url": "/proxy/310px-Steve_Jobs_Headshot.jpg?c=...",
        "width": null,
        "height": null
      }
    },
    {
      "t": 0,
      "url": "https://www.apple.com/stevejobs/",
      "title": "Remembering Steve Jobs - Apple",
      "snippet": "He was a visionary that had the amazing ability to breath life into his ideas..."
    },
    {
      "t": 1,
      "list": [
        "Steve Jobs",
        "steve jobs death",
        "steve jobs net worth",
        "steve jobs quotes",
        "steve jobs movie"
      ]
    }
  ]
}
```

---

## Response Format

### Response Envelope

| Field | Type   | Description                                      |
|-------|--------|--------------------------------------------------|
| meta  | object | Request Metadata                                 |
| data  | any    | Response data (array of Search Objects)          |
| error | array  | Error Object, if an error occurred               |

### Request Metadata

| Field       | Type   | Description                            |
|-------------|--------|----------------------------------------|
| id          | string | Request ID                             |
| node        | string | Server node name                       |
| ms          | int    | Request duration in milliseconds       |
| api_balance | float  | Remaining API balance in dollars       |

### Error Object

| Field | Type    | Description              |
|-------|---------|--------------------------|
| code  | int     | Error code               |
| msg   | string  | Error message            |
| ref   | string? | Error location reference |

### Error Codes

| Code | Error                   |
|------|-------------------------|
| 0    | Internal error          |
| 1    | Malformed request       |
| 2    | Unauthorized            |
| 100  | No billing information  |
| 101  | Insufficient credit     |
| 200  | Summarize failed        |

---

## Search Objects

Search objects are identified by the integer type field `t`.

### Search Object Type ID

| t | Type             |
|---|------------------|
| 0 | Search Result    |
| 1 | Related Searches |

### Search Result (t=0)

| Field     | Type       | Description                           |
|-----------|------------|---------------------------------------|
| url       | string     | Result URL                            |
| title     | string     | Result title                          |
| snippet   | string?    | Result snippet                        |
| published | timestamp? | Publication date, if known            |
| thumbnail | Image?     | Associated image                      |

### Image Object

| Field  | Type    | Description        |
|--------|---------|--------------------|
| url    | string  | Proxied image URL  |
| height | int?    | Image height       |
| width  | int?    | Image width        |

### Related Searches (t=1)

| Field | Type             | Description          |
|-------|------------------|----------------------|
| list  | array of strings | Related search terms |

---

## Additional Settings

The Search API inherits settings from your Kagi account:

- Block or promote websites via [results personalization](https://help.kagi.com/kagi/getting-started/index.html)
- Configure snippet length in [Settings -> Search](https://help.kagi.com/kagi/settings/search.html)

---

## Support

- [Bug Reports](https://github.com/kagisearch/kagi-docs/issues/new/choose)
- [Q&A Forum](https://github.com/kagisearch/kagi-docs/discussions/categories/q-a?discussions_q=category%3AQ%26A+label%3Aproduct%3Akagi_search_api)
- [Feature Requests](https://github.com/kagisearch/kagi-docs/discussions/categories/kagi-search-api-feature-requests-ideas)
- [Discord](https://kagi.com/discord)

---

## Unofficial Client Libraries

- [kagigo](https://github.com/httpjamesm/kagigo) - Go (FastGPT & Universal Summarizer)
- [kagi-api](https://crates.io/crates/kagi-api) - Rust
- [kagi-api](https://alchemists.io/projects/kagi-api) - Ruby
- [kagi-dotnet](https://github.com/patchoulish/kagi-dotnet) - C#/.NET
