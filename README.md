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
