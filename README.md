# Shared-mobility proximity API

Answers one question for any point in Belgium: **how many shared vehicles (cars, bicycles,
cargo bikes, scooters) are available within a given distance?** Data comes from the
[waytogo map](https://map.waytogo.be). The service also serves a small playground map.

Design: [`docs/superpowers/specs/2026-11-26-shared-mobility-proximity-design.md`](docs/superpowers/specs/2026-11-26-shared-mobility-proximity-design.md)

## Data decisions

1. **Sources.** Two undocumented endpoints of the waytogo map backend:
   `GET /api/vehicles` (free-floating vehicles, one feature per vehicle) and
   `GET /api/stations` (stations with the vehicles based or docked there). They are assumed
   stable but not guaranteed; all knowledge of their format lives behind the
   `MobilityProvider` interface (`apps/api/src/providers/waytogo/`), so the source can be replaced.
2. **Update frequency.** Upstream refreshes about every minute. We ingest every
   `INGEST_INTERVAL_SECONDS` (default 3600, i.e. hourly; minimum 60), so counts can be up to one
   interval old. Every response says how old the data is (`data.ageSeconds`).
3. **What counts as a vehicle.** All form factors: `car`, `bicycle`, `cargo_bicycle`, `scooter`
   (new ones appear automatically). Counts are per form factor only: operator and propulsion are
   deliberately **not** exposed, they are not needed for an impression of shared mobility.
   `radius` applies to all vehicles; the optional `carRadius` applies to cars only (you walk
   further for a car), e.g. the Dutch norm `radius=200&carRadius=400`.
4. **Counting rules.**
   - Free-floating vehicle = 1.
   - Bike-share docks (Villo, Blue-bike, Velo, Nextbike, Li Bia Velo): the live `availability`
     per vehicle type.
   - Car-sharing stations (Degage, Mobilize, Cozywheels, …): `capacity` = cars based there.
     These are **counted as available although their real-time booking status is unknown**.
   - Cambio lists each vehicle type once plus a station total (`capacity`). Each listed type
     counts 1; the remainder goes to the station's most common form factor (judgement call; the
     station total stays exact).
   - Empty docks and stations without vehicles are ignored.
5. **Stale feeds are kept**, not filtered, mirroring the waytogo map. At the time of writing all
   Lime records date from 2026-08-19. Stale operators are listed in `GET /health`
   (`staleOperators`, newest record older than `STALE_OPERATOR_SECONDS`, default 1 day).
6. **Invalid records** are skipped. If more than 50 % of a feed is invalid (or it isn't a
   non-empty array) it is treated as a format change: the previous data is kept and `/health`
   shows the error.
7. **Partial data.** Until every source has loaded at least once (from upstream or the snapshot
   on disk) the API answers `503`, never misleading zeros. Older data is still served, with its age.
8. **Distances** are straight-line (great-circle), not walking distance. `radius` and `carRadius`
   are 1–1000 m inclusive.
9. **History.** Snapshots are archived (hourly, kept 30 days; `ARCHIVE_*` settings) for a future
   "regions with good shared mobility" analysis. The playground heatmap shows one moment only:
   free-floating vehicles move during the day, stations are stable.

## Working with Nx

This is an [Nx](https://nx.dev) workspace; the API is the NestJS app `apps/api`.

```sh
npx nx serve api          # run locally on http://localhost:3000
npx nx test api           # unit + HTTP tests
npx nx run-many -t lint test build
```

## API

Full guide with examples: [docs/api.md](docs/api.md). Interactive docs: `/docs`.

| Endpoint | Purpose |
|---|---|
| `GET /v1/availability?lat=&lon=&radius=[&carRadius=]` | Vehicles near one point. `radius` (1–1000 m) for all vehicles, optional `carRadius` (1–1000 m) for cars only. |
| `POST /v1/availability/batch` | Same for up to 100 points: `{"points":[{"id":"a","lat":51.05,"lon":3.72,"radius":200,"carRadius":400}]}` |
| `GET /v1/points` | All points as GeoJSON (`formFactor`, `count`), used by the map |
| `GET /health` | Data age per source, stale operators. 503 until data is loaded. Not rate limited. |
| `GET /docs` | OpenAPI / Swagger UI |
| `GET /` | Playground map |

```sh
curl 'http://localhost:3000/v1/availability?lat=51.0545&lon=3.7215&radius=200&carRadius=400'
# {"query":{...},"total":20,"byFormFactor":{"car":8,"bicycle":12,"cargo_bicycle":0,"scooter":0},"data":{"sources":{...},"ageSeconds":12}}
```

Errors: `400` invalid input (message names the field), `429` rate limit (120/min per IP, batch 30/min), `503` data not loaded yet.

## Architecture

One NestJS app (`apps/api`), no database:

- `providers/` fetch, validate (zod) and normalize upstream data. To change the source, implement
  `MobilityProvider` and register it in `providers.module.ts`.
- `ingest/` runs the providers every `INGEST_INTERVAL_SECONDS`, keeps the last good data per provider,
  saves it to `SNAPSHOT_PATH` (fast restarts) and archives it.
- `store/` holds the data in an in-memory KD-tree (KDBush). It sits behind the `MobilityStore`
  interface; a PostGIS-backed store could replace it in `store.module.ts` without API changes.
- `availability/`, `points/`, `health/` are the HTTP endpoints; `assets/map/` is the playground map.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `UPSTREAM_BASE_URL` | https://map.waytogo.be | waytogo backend |
| `INGEST_INTERVAL_SECONDS` | 3600 | how often data is refreshed (min 60) |
| `UPSTREAM_TIMEOUT_MS` | 20000 | per-request timeout |
| `SNAPSHOT_PATH` | /data/snapshot.json | last snapshot, loaded at startup |
| `STALE_AFTER_SECONDS` | 3 × interval | `/health` reports `degraded` beyond this age |
| `STALE_OPERATOR_SECONDS` | 86400 | operators with older data are listed as stale |
| `RATE_LIMIT_PER_MINUTE` / `BATCH_RATE_LIMIT_PER_MINUTE` | 120 / 30 | per client IP |
| `BATCH_MAX_POINTS` | 100 | points per batch request |
| `ARCHIVE_DIR` / `ARCHIVE_INTERVAL_SECONDS` / `ARCHIVE_RETENTION_DAYS` | /data/archive / 3600 / 30 | snapshot history (0 days = off) |
| `TRUST_PROXY` | false | set `true` behind a reverse proxy so rate limits use the real client IP |

## Docker

```sh
docker compose up -d --build     # builds inside the image; data in the `mobility-data` volume
curl localhost:3000/health
```

Images are built by GitHub Actions (`.github/workflows/docker-publish.yaml`, after lint/test/build pass)
and published to `ghcr.io/flamsens/waytogo-proximity-api`: tag `main` on every push to main, and
`1.2.3`, `1.2`, `1`, `latest` for a git tag `v1.2.3`. Pull requests only build. To run the published
image instead of building locally, replace `build:` in `docker-compose.yml` with
`image: ghcr.io/flamsens/waytogo-proximity-api:latest`.

The port is bound to `127.0.0.1`; put a reverse proxy in front. Compose sets `TRUST_PROXY=true` so rate limits use the real client IP.
