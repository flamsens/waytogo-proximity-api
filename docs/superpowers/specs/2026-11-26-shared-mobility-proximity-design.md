# Shared-mobility proximity API — Design


## Context & intent

waytogo already shows all shared mobility in Belgium on https://map.waytogo.be. Another waytogo
project needs to answer: **"what shared vehicles can I take right now within N metres of this
point?"** We build a small, stable, fast, public HTTP API for that, plus a throw-away-quality
map to play with the data. Everything runs in containers.

Purpose is **live availability** ("what's here now"), not long-term/typical supply.

## What the source data looks like (analysed 2026-11-26)

The waytogo map loads two JSON endpoints (both: array of GeoJSON-like `Feature`s, Mongo-style `_id`):

| Endpoint | Size | Content |
|---|---|---|
| `GET https://map.waytogo.be/api/vehicles` | ~4.6 MB, ~15.5k features | Free-floating vehicles, 1 feature = 1 vehicle. `properties: {vehicle_id, vehicleType:{form_factor, propulsion_type, vehicle_accessories?}, operator, commune}` |
| `GET https://map.waytogo.be/api/stations` | ~2.7 MB, ~4.1k features | Stations. `properties: {station_id, name, operator, capacity?, vehicles:[{vehicleType:{form_factor, propulsion_type?, ...}, capacity?, availability?}], commune, ...}` |

Observations:
- **Update frequency:** both ETags changed within 60 s → upstream refreshes ~every minute.
  `_id` embeds an insertion timestamp (first 8 hex chars = unix seconds).
- **Free-floating** (snapshot): dott, donkey, bolt, voi (bikes/scooters), poppy (cars), lime.
  Form factors: `bicycle`, `scooter`, `car`. Vehicle ids rotate (GBFS privacy) → only counts are meaningful.
- **Stale data:** all 1,048 **lime** records have `_id` time 2026-08-19 while the rest is from today.
  Some station operators (klimaan 11-14, coopstroom 11-24, stappin 06-23) also have old `_id`s.
- **Stations — three counting semantics:**
  1. Bike-share docks (villo, bluebike, veloantwerpen, nextbike, libiavelo): `vehicles[].availability`
     = live free bikes of that type. nextbike has no station `capacity`.
  2. Car-sharing (degage, mobilize, cozywheels, battmobility, claus2you, coopstroom, klimaan, stappin):
     `vehicles[].capacity` = cars of that type based there; Σ equals station `capacity`.
  3. **cambio**: `vehicles[]` lists each distinct vehicle *type* once, no per-type count; station
     `capacity` = total cars (e.g. "Pupillen": types L/M/S, capacity 3; "Zone Astridpark": 3 types, capacity 4).
  4. wibee has both `capacity` and `availability` → use `availability`.
- Station form factors also include `cargo_bicycle`; `propulsion_type` is sometimes missing.
- 13 stations have an empty `vehicles` list. All geometries are valid points inside Belgium today.

## Decisions (made with the user)

| Topic | Decision |
|---|---|
| Purpose | Live "what's here now" counts |
| Architecture | **One NestJS service, in-memory spatial index, storage behind an interface** so a PostGIS implementation can replace it later without API changes |
| Vehicle types | **All form factors**, counted **per form factor only**. **No operator or propulsion data in the API output** — it isn't needed for an impression of shared mobility. |
| Search radius | `radius` (required, 1–1000 m) applies to **all** vehicles; optional `carRadius` (1–1000 m) overrides it **for cars only** (you walk further for a car). E.g. Dutch norm: `radius=200&carRadius=400`. |
| Station-based cars | **Counted as available** (same totals as live vehicles) |
| Stale records (e.g. lime) | **Keep everything** (mirror waytogo), but **surface it** in `/health` (operational endpoint, per-operator freshness) and a note in the README |
| Location score | **Future work**, not built now. The per-form-factor counts + radius/carRadius are the inputs it would build on. |
| Access | **Public, no auth**; rate limited; CORS open |
| Consumers | **Both** browsers (single queries) and a server doing bulk enrichment → add a **batch endpoint** |
| Production runtime | **docker compose on a VM**, one instance, behind a reverse proxy (`TRUST_PROXY`) |
| Data source | waytogo map endpoints (only source available; assumed stable but not guaranteed) → **provider abstraction** + per-record shape validation so the source can change later |
| Update frequency | **Configurable** via `INGEST_INTERVAL_SECONDS` (min 60). **Default 3600 (hourly)** — the user is fine with counts up to an hour old; set 60 for near-live. |
| Heatmap & history | Playground map gets a **live heatmap layer per form factor**. The service **archives snapshots** (at most once per `ARCHIVE_INTERVAL_SECONDS`, default hourly; kept `ARCHIVE_RETENTION_DAYS`, default 30) so a later "regions with good shared mobility" project starts with history. Analysing that history is **out of scope** here. |
| Documentation of data choices | Every decision in this table + the counting rules + data-quality notes go in a **"Data decisions" section of the repo README** (repo created in Task 0; folder isn't a git repo yet). |
| Partial / old data *(Claude's call)* | `/v1/availability` returns 503 until **every** provider has loaded at least once (from network or snapshot file). Old data is still served, with `ageSeconds`. `/health` is `degraded` only when the snapshot is older than `STALE_AFTER_SECONDS` or a provider's last fetch failed; stale operators (lime) are informational only. |

## Goals / non-goals / anti-goals

- **Goals:** answer `lat, lon, radius (1–1000 m)[, carRadius]` → vehicle counts per form factor in < 10 ms server time; data no older than one ingest interval (default 1 h, configurable down to 60 s);
  survives upstream outages and restarts; readable, documented (TSDoc + OpenAPI + README) code; `docker compose up` runs it all.
- **Non-goals:** history *analysis*/trends (we only collect the archive), a location score (future work), operator/propulsion breakdowns, per-vehicle tracking, routing/walking distance (straight-line distance only),
  auth, multi-region.
- **Anti-goals:** an API that returns zeros when it simply has no data yet (must be a 503); a half-updated
  index being visible to queries; hammering waytogo with overlapping fetches.

## Architecture

Code lives in an **Nx workspace** (scaffolded with `create-nx-workspace --preset=nest`; app `apps/api`, smoke tests in `apps/api-e2e`). Config files come from Nx generators, not hand-written. Runtime is still one container:

```
docker compose
└─ app (apps/api: Node 24, NestJS 11)                   volume: /data
   ├─ IngestService ── every INGEST_INTERVAL_SECONDS (default 3600)
   │    for each MobilityProvider (parallel, timeout, no overlap):
   │      WaytogoVehiclesProvider / WaytogoStationsProvider
   │        fetch JSON → zod-validate per feature → normalize → MobilityPoint[]
   │    keep last good result per provider; merge → Snapshot
   │    MobilityStore.replace(snapshot)                    (atomic reference swap)
   │    SnapshotFile.save(snapshot) → /data/snapshot.json  (tmp + rename)
   │    SnapshotArchive: ≤ 1×/ARCHIVE_INTERVAL → /data/archive/<UTC>.json.gz, prune > retention
   ├─ MobilityStore (interface)  ← InMemoryMobilityStore (KDBush on lon/lat + haversine filter)
   ├─ GET  /v1/availability        (public API, single point)
   ├─ POST /v1/availability/batch  (≤ 100 points per call)
   ├─ GET  /v1/points              (compact GeoJSON for the map)
   ├─ GET /health            (data age, per-operator freshness)
   ├─ GET /docs              (Swagger UI / OpenAPI)
   └─ GET /                  (static map: MapLibre GL, vanilla JS, no build step)
```

### Normalized model

```ts
type FormFactor = string;                 // 'car' | 'bicycle' | 'cargo_bicycle' | 'scooter' | future values
interface MobilityPoint {
  lon: number; lat: number;
  operator: string;                       // internal only: used for /health freshness, never in API output
  formFactor: FormFactor;
  count: number;                          // ≥ 1
  source: 'free_floating' | 'station';
  stationId?: string; stationName?: string;
  recordedAt: string;                     // ISO time decoded from upstream _id
}
/** Last good data per provider; the index is built from all providers' points. */
interface Snapshot {
  builtAt: string;
  providers: Record<string, ProviderData>;   // key = MobilityProvider.id
}
interface ProviderData { points: MobilityPoint[]; status: SourceStatus; }
interface SourceStatus {
  fetchedAt: string;          // last successful fetch
  featureCount: number; skipped: number;
  lastAttemptAt: string; lastError?: string;  // set when the latest attempt failed
}
```

### Counting rules (normalize)

1. Vehicle feature → one point, `count = 1`, `source = 'free_floating'`.
2. Station feature → one point per `vehicles[]` entry, `source = 'station'`:
   - `count = entry.availability ?? entry.capacity`.
   - If **no** entry has `availability` or `capacity` (cambio): total = `station.capacity ?? entries.length`;
     each entry gets 1; the remainder `total − entries.length` (if > 0) goes to the entry whose
     `formFactor` occurs most often in that station (tie → first entry). Station total stays exact.
     *(Builder's call, documented in README.)*
   - Entries with resulting `count ≤ 0` are dropped (empty docks don't need index entries).
3. Features without a valid `[lon, lat]` (finite, lon ∈ [-180,180], lat ∈ [-90,90]) are skipped and counted in `skipped`.
4. `recordedAt` = `new Date(parseInt(_id.slice(0, 8), 16) * 1000)`; if `_id` isn't parseable → snapshot fetch time.

### Data providers (swappable source)

```ts
/** A source of shared-mobility data. Add a new class + register it to change/extend the data source. */
interface MobilityProvider {
  readonly id: string;                         // e.g. 'waytogo-vehicles', used as key in Snapshot.sources
  fetchPoints(signal: AbortSignal): Promise<ProviderResult>;
}
interface ProviderResult { points: MobilityPoint[]; featureCount: number; skipped: number; }
```
Providers are registered via a Nest multi-provider token `MOBILITY_PROVIDERS`. Nothing outside
`src/providers/waytogo/` knows the waytogo format. Each upstream feature is validated with a zod schema
(`safeParse`, unknown keys allowed); invalid features are skipped and counted. If **more than 50 %** of a
feed's features are invalid, or the feed is not a non-empty array, the provider throws
`ProviderFormatError` → treated as a failed fetch (format change), shown in `/health.sources[id].lastError`.

### Ingest robustness

- Providers refresh independently: if one fails (network, non-2xx, timeout, format error),
  keep the previous points of that provider and log a warning; the others still update.
- A run never starts while the previous run is in progress.
- On startup: load `/data/snapshot.json` if present (serve immediately), then fetch right away.
- **Archive:** after an ingest run in which at least one provider succeeded, if the newest archive file is older
  than `ARCHIVE_INTERVAL_SECONDS`, write the snapshot (same `Snapshot` JSON, gzipped) to
  `ARCHIVE_DIR/<YYYY-MM-DDTHH-mm-ssZ>.json.gz` (tmp + rename), then delete files older than `ARCHIVE_RETENTION_DAYS`.
  `ARCHIVE_RETENTION_DAYS=0` disables archiving. Archive failures are logged and never fail the ingest.
  Size: ~1 MB/file → ~720 MB for 30 days hourly.
- Request with `Accept-Encoding: gzip` (Node fetch default) to keep upstream traffic small (~7 MB raw/min).

### Public API

`GET /v1/availability?lat={-90..90}&lon={-180..180}&radius={1..1000}[&carRadius={1..1000}]` — metres,
inclusive, decimals allowed. `radius` applies to every form factor; `carRadius` (optional, defaults to `radius`)
applies to `car` only. Implementation: one index search with `max(radius, carRadius)`, then each point is kept
if its distance ≤ `carRadius` (cars) or ≤ `radius` (everything else).

```json
{
  "query": { "lat": 51.0543, "lon": 3.7174, "radiusMeters": 200, "carRadiusMeters": 400 },
  "total": 37,
  "byFormFactor": { "bicycle": 21, "car": 4, "cargo_bicycle": 0, "scooter": 12 },
  "data": { "sources": { "waytogo-vehicles": "2026-11-26T08:20:01Z", "waytogo-stations": "2026-11-26T08:20:02Z" },
            "ageSeconds": 34 }
}
```
`ageSeconds` = now − oldest source `fetchedAt`.

- `car`, `bicycle`, `cargo_bicycle`, `scooter` are always present (zeros allowed) so clients get a stable shape;
  unknown future form factors appear additionally.
- `query.carRadiusMeters` is always echoed (equals `radiusMeters` when `carRadius` was omitted).
- No operator or propulsion information in any public response.
- Errors: `400` (validation, message lists the offending field), `429` (rate limit), `503` (no snapshot loaded yet).
- Headers: `Cache-Control: public, max-age=30`; CORS `*`.

`POST /v1/availability/batch` — body `{ "points": [{ "id"?: string, "lat", "lon", "radius", "carRadius"? }] }`, 1–100 points,
same per-point validation. Response `{ "results": [{ "id", "query", "total", "byFormFactor" }], "data": {...} }`
in request order; one invalid point → `400` for the whole request (error names the index). All results come
from the same snapshot.

**Rate limits** (per client IP; `TRUST_PROXY=true` behind the VM's reverse proxy so the IP comes from `X-Forwarded-For`):
GET availability `RATE_LIMIT_PER_MINUTE=120`; batch `BATCH_RATE_LIMIT_PER_MINUTE=30` (≤ 3,000 points/min);
`/v1/points` shares the GET limit; `/health` is not limited.

`GET /health` → `200 {status:'ok'|'degraded'}` or `503 {status:'unavailable'}` when not every provider
has data. `degraded` = snapshot older than `STALE_AFTER_SECONDS` (default 3 × interval) or a provider's last fetch failed.
Body: per-source `{fetchedAt, featureCount, skipped, lastError}`, per-operator newest `recordedAt`, and
`staleOperators` (newest record older than `STALE_OPERATOR_SECONDS`, informational — never changes status).
The Docker healthcheck only fails on 503, so lime's stale feed cannot cause restart loops.

`GET /v1/points` → GeoJSON FeatureCollection of all normalized points (props: `formFactor`, `count`
only — no operator/propulsion). Gzip-compressed, `Cache-Control: max-age=30`.

### Map (playground)

Static `index.html` + `map.js` + `map.css` in the app assets (`apps/api/src/assets/map/`), served at `/`. MapLibre GL JS (pinned CDN version)
with OpenFreeMap basemap (no key). Points coloured per form factor, toggles per form factor.
View switch **Points / Heatmap**: heatmap = MapLibre `heatmap` layer on the same `/v1/points` source,
weighted by `count`, filtered by the selected form factors (all form factors combined when several are
checked); intensity/radius scale with zoom; a caption says "snapshot of <fetchedAt>, not an average".
Click map → set centre; slider + number input 1–1000 m for `radius`, plus a "separate car radius" checkbox
with its own slider for `carRadius`; one circle per radius drawn (car circle dashed); result panel shows the
`/v1/availability` counts per form factor and the data age. No framework, no build.

### Configuration (env)

`PORT=3000`, `UPSTREAM_BASE_URL=https://map.waytogo.be`, `INGEST_INTERVAL_SECONDS=3600` (integer ≥ 60),
`UPSTREAM_TIMEOUT_MS=20000`, `SNAPSHOT_PATH=/data/snapshot.json`,
`STALE_AFTER_SECONDS` (default `3 × INGEST_INTERVAL_SECONDS`, i.e. 10800),
`STALE_OPERATOR_SECONDS=86400` (operators whose newest record is older than a day are flagged, e.g. lime), `RATE_LIMIT_PER_MINUTE=120`, `BATCH_RATE_LIMIT_PER_MINUTE=30`,
`BATCH_MAX_POINTS=100`, `TRUST_PROXY=false`, `ARCHIVE_DIR=/data/archive`, `ARCHIVE_INTERVAL_SECONDS=3600`
(integer ≥ 60), `ARCHIVE_RETENTION_DAYS=30` (0 = off). Invalid env values fail fast at startup.

### Deployment

`docker compose up -d` on a VM: one `app` service, named volume `/data`, `restart: unless-stopped`,
port bound to `127.0.0.1:3000` (reverse proxy in front), Docker `HEALTHCHECK` on `/health`.
Multi-stage Dockerfile (`node:24-alpine`, prod deps only, non-root user).

### README "Data decisions" section (required content)

1. Sources: the two waytogo endpoints, what each contains, that they're undocumented frontend endpoints (assumed stable, not guaranteed) and isolated behind `MobilityProvider`.
2. Update frequency: upstream refreshes ~every minute; we ingest every `INGEST_INTERVAL_SECONDS` (default hourly) — counts can be up to one interval old; `data.ageSeconds` tells how old.
3. What counts as a vehicle: all form factors (car, bicycle, cargo_bicycle, scooter, + new ones), counted per form factor; operator and propulsion are deliberately not exposed (not needed for an impression of shared mobility). `radius` applies to all, `carRadius` optionally to cars only (e.g. Dutch norm 200 m / 400 m).
4. Counting rules per source type: free-floating = 1; docks = live `availability`; car-sharing stations = `capacity` (cars based there) **counted as available although real-time booking status is unknown**; cambio remainder rule (judgement call); empty docks/stations dropped.
5. Stale feeds are kept, not filtered (mirrors waytogo map); lime has been frozen since 2026-08-19 at time of writing; how to spot this (`/health.staleOperators`).
6. Invalid records skipped; > 50 % invalid → treated as format change, previous data kept.
7. Partial-data behaviour (503 until every provider loaded once; old data served with its age).
8. Distances are straight-line (great-circle), not walking distance; radius 1–1000 m inclusive.
9. History: snapshots archived hourly for 30 days (configurable) in normalized form, for a future coverage analysis; the live heatmap shows one moment only (free-floating vehicles move during the day, stations are stable).

### Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| A. Single NestJS service, in-memory KDBush index | ~0.05 ms queries, 1 container, no DB ops; no history; each replica fetches upstream | Base |
| B. Ingester + PostGIS + NestJS | Shared DB for many replicas, easy history/SQL; 3 containers, migrations, ~1–5 ms queries, churn of rewriting 20k rows/min | Rejected for now |
| **A with storage behind `MobilityStore` interface** | A's simplicity, B reachable later by adding a `PostgisMobilityStore` | **Chosen by user** |

### Left to the builder

Logging format, exact Swagger decorators, colours of the map, test fixture selection, minor naming.

