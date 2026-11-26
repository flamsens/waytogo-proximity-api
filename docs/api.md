# Shared-mobility proximity API

How many shared cars, bicycles, cargo bikes and scooters are available near a point in Belgium.

- **Base URL:** wherever the service runs, e.g. `http://localhost:3000`
- **Interactive docs (OpenAPI / Swagger UI):** `GET /docs`, machine-readable spec at `GET /docs-json`
- **Auth:** none (public, read-only). **CORS:** any origin.
- **Format:** JSON. Coordinates are WGS84 decimal degrees; distances are metres, straight-line (great-circle).

## Quick start

```sh
curl 'http://localhost:3000/v1/availability?lat=51.2194&lon=4.4025&radius=200&carRadius=500'
```

```js
const res = await fetch('/v1/availability?' + new URLSearchParams({ lat: 51.2194, lon: 4.4025, radius: 200, carRadius: 500 }));
if (res.status === 503) { /* data not loaded yet: retry later */ }
const { total, byFormFactor } = await res.json();
```

## `GET /v1/availability`

Counts the vehicles around one point.

| Parameter | Required | Range | Meaning |
|---|---|---|---|
| `lat` | yes | -90 … 90 | latitude |
| `lon` | yes | -180 … 180 | longitude |
| `radius` | yes | 1 … 1000 (inclusive, decimals allowed) | search radius in metres for **all** vehicles |
| `carRadius` | no | 1 … 1000 | search radius for **cars only**; defaults to `radius`. People walk further for a car, e.g. `radius=200&carRadius=500`. |

**Response `200`**

```json
{
  "query": { "lat": 51.2194, "lon": 4.4025, "radiusMeters": 200, "carRadiusMeters": 500 },
  "total": 161,
  "byFormFactor": { "car": 18, "bicycle": 84, "cargo_bicycle": 0, "scooter": 59 },
  "data": {
    "sources": { "waytogo-vehicles": "2026-11-26T10:29:41.271Z", "waytogo-stations": "2026-11-26T10:29:41.271Z" },
    "ageSeconds": 438
  }
}
```

| Field | Meaning |
|---|---|
| `query` | the request as interpreted; `carRadiusMeters` equals `radiusMeters` when `carRadius` was omitted |
| `total` | all vehicles within range |
| `byFormFactor` | vehicles per type. `car`, `bicycle`, `cargo_bicycle` and `scooter` are always present (0 when none); new types from the data source appear as extra keys, so don't assume a fixed set |
| `data.sources` | last successful fetch per data source |
| `data.ageSeconds` | age of the oldest data source. Data refreshes every hour by default, so values up to ~3600 are normal |

Responses carry `Cache-Control: public, max-age=30`.

## `POST /v1/availability/batch`

Same question for up to 100 points in one call (e.g. enriching a list of addresses). All points are
answered from the same data snapshot, in request order. `id` is optional and echoed back.

```sh
curl -X POST 'http://localhost:3000/v1/availability/batch' \
  -H 'content-type: application/json' \
  -d '{"points":[
        {"id":"antwerp","lat":51.2194,"lon":4.4025,"radius":200,"carRadius":500},
        {"id":"leuven","lat":50.8798,"lon":4.7005,"radius":300}
      ]}'
```

```json
{
  "results": [
    { "id": "antwerp", "query": { "lat": 51.2194, "lon": 4.4025, "radiusMeters": 200, "carRadiusMeters": 500 },
      "total": 161, "byFormFactor": { "car": 18, "bicycle": 84, "cargo_bicycle": 0, "scooter": 59 } },
    { "id": "leuven", "query": { "lat": 50.8798, "lon": 4.7005, "radiusMeters": 300, "carRadiusMeters": 300 },
      "total": 6, "byFormFactor": { "car": 2, "bicycle": 4, "cargo_bicycle": 0, "scooter": 0 } }
  ],
  "data": { "sources": { "...": "..." }, "ageSeconds": 438 }
}
```

One invalid point rejects the whole request with `400`; the message names it, e.g. `points.1.radius must not be greater than 1000`.

## `GET /health`

Operational status, not rate limited. `200` with `status` `ok` or `degraded` (data older than
3 × the update interval, or the last fetch of a source failed), `503` with `status: "unavailable"`
until data is loaded.

```json
{
  "status": "ok",
  "ageSeconds": 438,
  "sources": {
    "waytogo-vehicles": { "fetchedAt": "2026-11-26T10:29:41.271Z", "lastAttemptAt": "2026-11-26T10:29:41.271Z", "featureCount": 15999, "skipped": 0 },
    "waytogo-stations": { "fetchedAt": "2026-11-26T10:29:41.271Z", "lastAttemptAt": "2026-11-26T10:29:41.271Z", "featureCount": 4091, "skipped": 0 }
  },
  "operators": { "lime": "2026-08-19T16:30:08.000Z", "donkey": "2026-11-26T10:25:03.000Z" },
  "staleOperators": ["coopstroom", "klimaan", "lime", "stappin"]
}
```

`staleOperators` lists operators whose newest record is older than a day (their feed seems frozen;
their vehicles are still counted). It never changes `status`.

## `GET /v1/points`

All vehicle locations as a GeoJSON `FeatureCollection` (properties `formFactor` and `count` only),
about 20k features, gzip-compressed. Meant for maps; use `/v1/availability` for counts.

## Errors

| Status | When | Body |
|---|---|---|
| `400` | invalid or missing parameter | `{"statusCode":400,"error":"Bad Request","message":["radius must not be greater than 1000"]}` |
| `429` | rate limit exceeded: 120 requests/min per IP for GET endpoints, 30/min for batch | `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` |
| `503` | data not loaded yet (fresh start while the data source is unreachable) | `{"statusCode":503,"message":"data not loaded yet"}` — retry later; you never get misleading zeros |

## What the numbers mean

- **Live snapshot**, not an average: free-floating bikes and scooters move during the day.
- **Free-floating vehicles** count 1 each; **bike-share docks** count the bikes available right now;
  **car-sharing stations** count the cars based there (counted as available, although whether they are
  booked right now is unknown).
- No operator or propulsion information is exposed.
- Details and all data decisions: [README → Data decisions](../README.md#data-decisions).
