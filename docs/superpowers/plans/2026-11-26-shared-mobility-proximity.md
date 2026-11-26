# Shared-mobility proximity API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single containerized NestJS service that mirrors waytogo's shared-mobility feeds on a configurable interval (default hourly) into an in-memory spatial index and answers "how many vehicles within R m of (lat, lon)" for single and batch queries, plus a static playground map.

**Architecture:** Swappable `MobilityProvider`s fetch + validate + normalize upstream data into `MobilityPoint`s; `IngestService` keeps the last good result per provider, persists it to `/data/snapshot.json` and swaps it into a `MobilityStore` (KDBush implementation). Controllers aggregate the points inside the radius. Map is vanilla JS + MapLibre served from the app's assets (`apps/api/src/assets/map/`).

**Tech Stack:** Nx 24 workspace (`create-nx-workspace --preset=nest`, app `api`, webpack build, Jest 30), TypeScript (strict), NestJS 11 (Express adapter), `@nestjs/schedule`, `@nestjs/throttler`, `@nestjs/swagger`, `@nestjs/serve-static`, `class-validator`/`class-transformer` (HTTP DTOs), `zod` (env + upstream schemas), `kdbush` v4, `compression`, Jest + supertest, Docker / compose, MapLibre GL JS + OpenFreeMap (map only).

**Spec:** `docs/superpowers/specs/2026-11-26-shared-mobility-proximity-design.md`

## Global Constraints

- Repo root = `/home/flamsens/Code/waytogo/immo` (contains only `docs/` so far; not a git repo yet). It becomes an **Nx workspace**: NestJS app `api` in `apps/api`, generated e2e project `api-e2e` in `apps/api-e2e`.
- **Scaffold with tools, don't hand-write config.** The workspace, Jest, ESLint, Prettier, tsconfig and webpack config come from `create-nx-workspace`; Nest modules/controllers/services are created with `npx nx g @nx/nest:<module|controller|service> …` (use the nx plugin's `nx-generate` skill); the Dockerfile starts from `npx nx g @nx/node:setup-docker`. Generated config is only edited where a task says so (Jest `transformIgnorePatterns`, `tsconfig.spec.json` `allowJs`, Dockerfile). Plain TS files (domain, providers, store) are written by hand. Delete the generated sample `app.controller`/`app.service` (+ specs) and the sample `apps/api-e2e/src/api/api.spec.ts` content.
- Run everything through Nx: `npx nx test api`, `npx nx build api`, `npx nx serve api`, `npx nx lint api`, `npx nx e2e api-e2e`. Unit/HTTP tests are colocated `*.spec.ts` files under `apps/api/src`.
- Node: local Node ≥ 22.12; Docker image `node:24-alpine`. KDBush 4 is ESM-only: webpack bundles it for production, Jest needs the transform from Task 0.
- TypeScript `strict: true`. Every exported function/class/interface has a TSDoc comment saying *why*, not just what.
- `radius` (required) and `carRadius` (optional, defaults to `radius`, applies to `car` only) ∈ **[1, 1000] metres inclusive**, decimals allowed; lat ∈ [-90, 90]; lon ∈ [-180, 180].
- Always-present form factors: `car`, `bicycle`, `cargo_bicycle`, `scooter`.
- **No operator or propulsion data in any public response** (`/v1/*`). Operator exists internally only for `/health` freshness; propulsion is not modelled at all.
- Provider ids: `waytogo-vehicles`, `waytogo-stations`. Upstream base `https://map.waytogo.be`, paths `/api/vehicles`, `/api/stations`.
- Env defaults exactly as listed in the Design "Configuration" section (ingest default **3600 s**, minimum 60 s).
- README "Data decisions" section must cover all 9 points of the Design and stay in sync with the code.
- Format-error threshold: > 50 % invalid features, or not a non-empty array → `ProviderFormatError`.
- Batch: 1–100 points. Rate limits: 120/min GET, 30/min batch, `/health` unlimited.
- Distances are great-circle (haversine, R = 6 371 008.8 m).
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Radius / coordinate edges:** `radius=1` and `radius=1000` accepted; `0`, `1000.01`, `-5`, `abc`, empty and missing → 400 naming the field; same for `carRadius` (except missing is fine) and lat/lon out of range. → Task 7 e2e.
1b. **carRadius semantics:** `radius=200&carRadius=400` → a car 300 m away counts, a bike 300 m away doesn't; `radius=400&carRadius=200` (car radius smaller) → a car 300 m away doesn't count, a bike does. → Task 5 + Task 7 tests.
2. **No data yet:** any availability call before every provider has data → 503 with message "data not loaded yet", never zeros. → Task 7 e2e + Task 6 unit.
3. **Upstream garbage:** HTML body, `{}`, `[]`, truncated JSON, 500, timeout → provider fails, previous data for that provider still served, `/health` shows `lastError` + `degraded`. → Task 3 + Task 6 tests.
4. **Points on the boundary & far away:** a point 999 m away counts at radius 1000, one at 1001 m doesn't; a query in the North Sea returns 200 with zero totals and all four form factors present. → Task 4 + Task 5 tests.
5. **Batch edges:** 0 points / 101 points → 400; one bad point → 400 naming `points[i]`; results in request order with `id` echoed. → Task 7 e2e.

---

### Task 0: Nx workspace scaffold, config, docs

**Files:**
- Generate: Nx workspace at the repo root (root `package.json`, `nx.json`, `tsconfig.base.json`, `jest.preset.js`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `CLAUDE.md`, `.claude/settings.json`, `apps/api/**`, `apps/api-e2e/**`)
- Modify (generated): `apps/api/jest.config.cts`, `apps/api/tsconfig.spec.json`
- Create: `apps/api/src/config/app-config.ts`, `apps/api/src/config/app-config.spec.ts`
- Create: `README.md` (replace the generated one) with a short purpose paragraph and the full **"Data decisions"** section (Design → "README Data decisions section", all 9 points); later tasks extend it. Keep a short "Working with Nx" section from the generated README.
- Commit (already present): `docs/superpowers/specs/2026-11-26-shared-mobility-proximity-design.md`, `docs/superpowers/plans/2026-11-26-shared-mobility-proximity.md`

**Interfaces:**
- Produces: `interface AppConfig { port; upstreamBaseUrl; ingestIntervalSeconds; upstreamTimeoutMs; snapshotPath; staleAfterSeconds; staleOperatorSeconds; rateLimitPerMinute; batchRateLimitPerMinute; batchMaxPoints; archiveDir; archiveIntervalSeconds; archiveRetentionDays; trustProxy: boolean }`, `loadConfig(env: Record<string, string | undefined>): AppConfig` (throws `Error` listing every invalid var), DI token `APP_CONFIG`.

- [ ] **Step 1: Generate the workspace.** The repo root is not empty (`docs/`), so generate into a temp dir and move it in: from `/home/flamsens/Code/waytogo` run
  `npx create-nx-workspace@24 immo-tmp --preset=nest --appName=api --unitTestRunner=jest --nxCloud=skip --packageManager=npm --skipGit=true --interactive=false --analytics=false`,
  then move all of `immo-tmp/` (including dotfiles) into `immo/`, delete `immo-tmp/`, and in `immo/` run `npm install` (lockfile paths) and `git init`. In root `package.json` set `"name": "immo"`. (Verified 2026-11-26: Nx 24.0.7, NestJS 11, Jest 30, TS 6; the preset generates `apps/api` with webpack + Jest and `apps/api-e2e`; it does **not** create a Dockerfile.)
- [ ] **Step 2: Add runtime deps** with npm (not by editing package.json): `npm i @nestjs/schedule @nestjs/throttler @nestjs/swagger @nestjs/serve-static class-validator class-transformer zod kdbush compression` and `npm i -D supertest @types/supertest @types/compression`. Remove the sample `app.controller`/`app.service` files and their specs; keep `app.module.ts` and `main.ts`.
- [ ] **Step 3: Jest + KDBush (ESM-only).** In `apps/api/jest.config.cts` add `transformIgnorePatterns: ['/node_modules/(?!kdbush)']` (the generated `transform` already covers `[tj]s` with ts-jest); in `apps/api/tsconfig.spec.json` add `"allowJs": true`. Verify with a throwaway spec `import KDBush from 'kdbush'; expect(new KDBush(1)).toBeDefined()` → `npx nx test api` PASS; delete it (Task 4 covers KDBush for real).
- [ ] **Step 4: Failing tests** `apps/api/src/config/app-config.spec.ts`: `loadConfig({})` equals all Design defaults (`port 3000`, `ingestIntervalSeconds 3600`, `staleAfterSeconds 10800`, `staleOperatorSeconds 86400`, `archiveDir '/data/archive'`, `archiveIntervalSeconds 3600`, `archiveRetentionDays 30`, …, `trustProxy false`); `loadConfig({ARCHIVE_RETENTION_DAYS:'0'})` → `0` (valid, disables archive); `loadConfig({INGEST_INTERVAL_SECONDS:'600'})` → `staleAfterSeconds 1800`; `loadConfig({INGEST_INTERVAL_SECONDS:'600', STALE_AFTER_SECONDS:'900'})` → `staleAfterSeconds 900`; `loadConfig({TRUST_PROXY:'true', PORT:'8080'})` → `trustProxy true, port 8080`; `loadConfig({INGEST_INTERVAL_SECONDS:'59'})` and `{PORT:'abc'}` throw with the var name in the message.
- [ ] **Step 5:** `npx nx test api --testPathPattern=config` → FAIL (module missing).
- [ ] **Step 6:** Implement `loadConfig` with a zod schema (`z.coerce.number().int().positive()` etc.); register `{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }` in `AppModule`.
- [ ] **Step 7:** `npx nx test api --testPathPattern=config` → PASS; `npx nx build api` and `npx nx lint api` → succeed.
- [ ] **Step 8:** Write `README.md` (purpose + "Data decisions" section, all 9 points from the Design + "Working with Nx").
- [ ] **Step 9:** Commit `chore: scaffold Nx NestJS workspace with typed config and data decisions`.

### Task 1: Domain model and geo helpers

**Files:**
- Create: `apps/api/src/domain/mobility.ts`, `apps/api/src/domain/geo.ts`, `apps/api/src/domain/geo.spec.ts`

**Interfaces:**
- Produces (`apps/api/src/domain/mobility.ts`): `MobilityPoint`, `Snapshot`, `ProviderData`, `SourceStatus` exactly as in the Design "Normalized model"; `const KNOWN_FORM_FACTORS = ['car','bicycle','cargo_bicycle','scooter'] as const`.
- Produces (`apps/api/src/domain/geo.ts`): `interface GeoPoint { lat: number; lon: number }`, `haversineMeters(a: GeoPoint, b: GeoPoint): number`, `boundingBox(center: GeoPoint, radiusMeters: number): { minLon: number; minLat: number; maxLon: number; maxLat: number }` (must fully contain the circle; clamp lat to ±90 and widen lon to ±180 when `cos(lat)` → 0).

- [ ] **Step 1: Failing tests:** haversine Gent-Sint-Pieters station (51.0359, 3.7108) → Gent Korenmarkt (51.0545, 3.7215) ≈ 2 200 m (±20 m); same point → 0; `boundingBox({lat:51,lon:4},1000)` contains the 4 points obtained by moving 1000 m N/E/S/W (check with haversine ≤ 1000.5); bbox at lat 89.999 has `minLon=-180, maxLon=180`.
- [ ] **Step 2:** `npx nx test api --testPathPattern=domain` → FAIL.
- [ ] **Step 3:** Implement (R = 6 371 008.8 m; bbox: `dLat = r/R` rad, `dLon = r/(R·cos(lat))` rad, pad by 0.1 %).
- [ ] **Step 4:** `npx nx test api --testPathPattern=domain` → PASS.
- [ ] **Step 5:** Commit `feat: add domain model and geo helpers`.

### Task 2: Waytogo schemas and normalization

**Files:**
- Create: `apps/api/src/providers/waytogo/waytogo.schemas.ts`, `apps/api/src/providers/waytogo/normalize.ts`
- Create: `apps/api/src/providers/waytogo/__fixtures__/waytogo-vehicles.sample.json`, `apps/api/src/providers/waytogo/__fixtures__/waytogo-stations.sample.json`, `apps/api/src/providers/waytogo/normalize.spec.ts`

**Interfaces:**
- Consumes: `MobilityPoint` (Task 1).
- Produces: zod schemas `vehicleFeatureSchema`, `stationFeatureSchema` (coordinates validated finite & in range; `.passthrough()` on objects) and inferred types `VehicleFeature`, `StationFeature`; `recordedAtFromObjectId(id: string | undefined, fallback: Date): string`; `normalizeVehicle(f: VehicleFeature, fallback: Date): MobilityPoint`; `normalizeStation(f: StationFeature, fallback: Date): MobilityPoint[]`.

Fixtures are hand-written in the real upstream shape (see Design "What the source data looks like"); one feature per case below.

- [ ] **Step 1: Failing tests** (`normalize.spec.ts`):
  - lime scooter (copy a real lime `_id` from the live feed into the fixture) → `{formFactor:'scooter', count:1, source:'free_floating', operator:'lime'}` (and no `propulsion` key) and `recordedAt === new Date(parseInt(_id.slice(0,8),16)*1000).toISOString()`.
  - `recordedAtFromObjectId('nothex', fallback)` → `fallback.toISOString()`.
  - villo station with `availability` 7 (human) and 5 (electric_assist) → two points, counts 7 and 5.
  - degage station with `vehicles[0].capacity` 2 → one point count 2.
  - wibee with `capacity` 2, `availability` 1 → count 1.
  - cambio "Pupillen": capacity 3, three car types without counts → counts sum to 3, each 1.
  - cambio "Zone Astridpark": capacity 4, entries (car, cargo_bicycle, car) → counts `[2,1,1]` (remainder to the most common form factor, its first entry).
  - cambio with capacity missing and 2 entries → total 2.
  - cozywheels bicycle with no `propulsion_type` → still valid, one bicycle point.
  - villo dock with `availability` 0 → no point.
  - station with `vehicles: []` → `[]`.
  - `stationFeatureSchema.safeParse` of a feature with `coordinates:[null,51]` → `success:false`.
- [ ] **Step 2:** `npx nx test api --testPathPattern=normalize` → FAIL.
- [ ] **Step 3:** Implement schemas and the counting rules from the Design "Counting rules" verbatim.
- [ ] **Step 4:** `npx nx test api --testPathPattern=normalize` → PASS.
- [ ] **Step 5:** Commit `feat: validate and normalize waytogo features`.

### Task 3: Provider abstraction and waytogo providers

**Files:**
- Create: `apps/api/src/providers/mobility-provider.ts`, `apps/api/src/providers/waytogo/fetch-json.ts`, `apps/api/src/providers/waytogo/parse-feed.ts`, `apps/api/src/providers/waytogo/waytogo-vehicles.provider.ts`, `apps/api/src/providers/waytogo/waytogo-stations.provider.ts`, `apps/api/src/providers/providers.module.ts`
- Test: `apps/api/src/providers/waytogo/parse-feed.spec.ts`, `apps/api/src/providers/waytogo/waytogo-providers.spec.ts`

**Interfaces:**
- Consumes: Task 2 schemas + normalizers, `AppConfig`.
- Produces: `interface MobilityProvider { readonly id: string; fetchPoints(signal: AbortSignal): Promise<ProviderResult> }`, `interface ProviderResult { points: MobilityPoint[]; featureCount: number; skipped: number }`, `class ProviderFormatError extends Error`, token `MOBILITY_PROVIDERS` (value: `MobilityProvider[]`), `fetchJson(url: string, timeoutMs: number, signal: AbortSignal): Promise<unknown>` (throws on non-2xx, timeout, invalid JSON), `parseFeed<T>(raw: unknown, schema: z.ZodType<T>, maxInvalidRatio = 0.5): { items: T[]; featureCount: number; skipped: number }`. `ProvidersModule` exports `MOBILITY_PROVIDERS`.

- [ ] **Step 1: Failing tests:**
  - `parseFeed` with `{}`, `"<html>"`, `[]` → throws `ProviderFormatError`; 10 features, 4 invalid → `items.length 6, skipped 4`; 10 features, 6 invalid → throws.
  - `WaytogoVehiclesProvider.fetchPoints` with `global.fetch` mocked to return the vehicles fixture → points length = valid features, `id === 'waytogo-vehicles'`, requested URL `https://map.waytogo.be/api/vehicles`.
  - Mocked fetch returning status 500 → rejects; mocked fetch that never resolves with `upstreamTimeoutMs: 50` → rejects within 1 s.
- [ ] **Step 2:** `npx nx test api --testPathPattern=providers` → new tests FAIL.
- [ ] **Step 3:** Implement. `fetchJson` combines caller signal with `AbortSignal.timeout(timeoutMs)` via `AbortSignal.any`. Each provider = fetchJson → parseFeed → normalize (stations: `flatMap`).
- [ ] **Step 4:** `npx nx test api --testPathPattern=providers` → PASS.
- [ ] **Step 5:** Commit `feat: add swappable mobility providers for waytogo`.

### Task 4: MobilityStore and in-memory implementation

**Files:**
- Create: `apps/api/src/store/mobility-store.ts`, `apps/api/src/store/in-memory-mobility-store.ts`, `apps/api/src/store/store.module.ts`
- Test: `apps/api/src/store/in-memory-mobility-store.spec.ts`

**Interfaces:**
- Consumes: `Snapshot`, `MobilityPoint`, `GeoPoint`, `haversineMeters`, `boundingBox`.
- Produces: `interface PointMatch { point: MobilityPoint; distanceMeters: number }`, `interface MobilityView { readonly snapshot: Snapshot; findWithin(center: GeoPoint, radiusMeters: number): Promise<PointMatch[]> }`, `interface MobilityStore { replace(snapshot: Snapshot): void; view(): MobilityView | null }`, token `MOBILITY_STORE`. A view is immutable: a `replace()` after `view()` does not change what that view returns (this is what makes batch results consistent and what a PostGIS store would emulate with a snapshot id).

- [ ] **Step 1: Failing tests:** `view()` is `null` before `replace`; point 999 m north of centre found at radius 1000, point 1001 m not found; radius 1 finds a point at the exact centre; view taken before a second `replace` still returns old results; **brute-force cross-check**: 5 000 seeded-random points in Belgium bbox, 50 random queries with random radius 1–1000 → result set equals a linear `haversine ≤ r` filter.
- [ ] **Step 2:** `npx nx test api --testPathPattern=store` → FAIL.
- [ ] **Step 3:** Implement: `replace` builds `new KDBush(n)` from all providers' points (`add(lon, lat)`, `finish()`), wraps it with the points array in a frozen view object, assigns it to a single field. `findWithin` = `index.range(bbox)` → haversine filter.
- [ ] **Step 4:** `npx nx test api --testPathPattern=store` → PASS.
- [ ] **Step 5:** Commit `feat: add in-memory spatial mobility store`.

### Task 5: Aggregation

**Files:**
- Create: `apps/api/src/availability/aggregate.ts`
- Test: `apps/api/src/availability/aggregate.spec.ts`

**Interfaces:**
- Consumes: `PointMatch`, `KNOWN_FORM_FACTORS`.
- Produces: `interface AvailabilityCounts { total: number; byFormFactor: Record<string, number> }`, `aggregate(matches: PointMatch[], radiusMeters: number, carRadiusMeters: number): AvailabilityCounts` — a match counts when `distanceMeters ≤ (formFactor === 'car' ? carRadiusMeters : radiusMeters)`; callers search with `max(radius, carRadius)`.

- [ ] **Step 1: Failing tests:** `aggregate([], 500, 500)` → `{ total: 0, byFormFactor: { car:0, bicycle:0, cargo_bicycle:0, scooter:0 } }`; matches {bicycle count 2 @150 m, bicycle 1 @300 m, car count 3 @300 m, scooter 1 @50 m}: with `(200, 400)` → `bicycle 2, car 3, scooter 1, total 6`; with `(400, 200)` → `bicycle 3, car 0, scooter 1, total 4`; unknown form factor `moped` appears as an extra key; result object has no keys other than `total` and `byFormFactor`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npx nx test api --testPathPattern=aggregate` PASS.
- [ ] **Step 5:** Commit `feat: aggregate vehicle counts per form factor with car radius`.

### Task 6: Ingest service, snapshot persistence and archive

**Files:**
- Create: `apps/api/src/ingest/snapshot-file.ts`, `apps/api/src/ingest/snapshot-archive.ts`, `apps/api/src/ingest/ingest.service.ts`, `apps/api/src/ingest/ingest.module.ts`
- Test: `apps/api/src/ingest/snapshot-file.spec.ts`, `apps/api/src/ingest/snapshot-archive.spec.ts`, `apps/api/src/ingest/ingest.service.spec.ts`

**Interfaces:**
- Consumes: `MOBILITY_PROVIDERS`, `MOBILITY_STORE`, `APP_CONFIG`, `Snapshot`.
- Produces: `saveSnapshot(path: string, s: Snapshot): Promise<void>` (write `path.tmp` then `rename`), `loadSnapshot(path: string): Promise<Snapshot | null>` (missing or corrupt file → `null` + warning); `IngestService` with `runOnce(): Promise<void>`, `isReady(): boolean` (every registered provider id has data), `sourceStatuses(): Record<string, SourceStatus>`. On `onApplicationBootstrap`: load file → `store.replace` if present → `runOnce()` (not awaited) → `setInterval` registered in `SchedulerRegistry` with `ingestIntervalSeconds`. `onModuleDestroy` aborts an in-flight run.
- Produces (`snapshot-archive.ts`): `archiveFileName(at: Date): string` (`2026-11-26T08-00-00Z.json.gz`, sortable, filesystem-safe), `maybeArchive(dir: string, s: Snapshot, now: Date, intervalSeconds: number): Promise<boolean>` (writes only if newest file in `dir` is older than `intervalSeconds`; creates `dir`), `pruneArchive(dir: string, retentionDays: number, now: Date): Promise<number>` (deletes by timestamp in file name, returns count). `IngestService.runOnce` calls both after a run where ≥ 1 provider succeeded and `archiveRetentionDays > 0`; errors are logged, never thrown.

- [ ] **Step 1: Failing tests** (fake providers, temp dir):
  - save → load round-trips; corrupt JSON file → `null`.
  - `maybeArchive` twice 10 min apart with interval 3600 → one file; again 61 min later → two files; file gunzips to the snapshot JSON.
  - `pruneArchive(dir, 30, now)` with files dated 29 and 31 days ago → deletes only the 31-day one; ignores files not matching the name pattern.
  - `runOnce` with `archiveRetentionDays: 0` → no archive dir created; with an unwritable archive dir → run still succeeds and store updated.
  - `runOnce` with two succeeding fakes → `store.view().snapshot.providers` has both ids, `isReady()` true, snapshot file written.
  - second run where provider B throws → B keeps previous points, `status.lastError` set, `fetchedAt` unchanged, A updated.
  - first run where B throws and no file → `isReady()` false.
  - calling `runOnce` twice concurrently while a fake is slow → provider called once (no overlap).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npx nx test api --testPathPattern=ingest` PASS.
- [ ] **Step 5:** Commit `feat: ingest providers on an interval with persisted snapshot and archive`.

### Task 7: Availability API (single + batch), rate limits, OpenAPI

**Files:**
- Create: `apps/api/src/availability/availability.dto.ts`, `apps/api/src/availability/availability.service.ts`, `apps/api/src/availability/availability.controller.ts`, `apps/api/src/availability/availability.module.ts`
- Modify: `apps/api/src/main.ts` (global `ValidationPipe({transform:true, whitelist:true, forbidNonWhitelisted:true})`, CORS `*`, `compression()`, `trust proxy` from config, Swagger at `/docs`), `apps/api/src/app.module.ts` (ThrottlerModule with named throttlers `default` 120/min and `batch` 30/min, `ThrottlerGuard` global)
- Test: `apps/api/src/availability/availability.http.spec.ts`, `apps/api/src/testing/test-app.ts` (helper: builds the app with `MOBILITY_PROVIDERS` overridden by in-memory fakes and the interval disabled)

**Interfaces:**
- Consumes: `MOBILITY_STORE`, `IngestService.isReady/sourceStatuses`, `aggregate`.
- Produces: `GET /v1/availability`, `POST /v1/availability/batch` with responses exactly as in the Design; `AvailabilityService.query(view, q: { lat; lon; radius; carRadius? })` → searches `findWithin(center, max(radius, carRadius ?? radius))` then `aggregate(...)`; 503 via `ServiceUnavailableException('data not loaded yet')`.

- [ ] **Step 1: Failing HTTP tests (in-process, `@nestjs/testing` + supertest):** Review Focus 1, 1b, 2, 4 (North Sea `lat=51.6&lon=2.5` → zeros), 5; happy path with fakes (known points at Korenmarkt) → exact counts and `data.sources` keys; without `carRadius` → `query.carRadiusMeters === query.radiusMeters`; response JSON (single and batch) contains no `operator`, `propulsion` or `byOperator` anywhere (deep key scan); `Cache-Control: public, max-age=30`; `Access-Control-Allow-Origin: *`; with `rateLimitPerMinute: 3` in the test config the 4th GET → 429, and with `batchRateLimitPerMinute: 2` the 3rd batch → 429; `/docs-json` contains `/v1/availability`.
- [ ] **Step 2:** `npx nx test api --testPathPattern=http.spec` → FAIL.
- [ ] **Step 3:** Generate `availability` module/controller/service with `npx nx g @nx/nest:module|controller|service apps/api/src/availability/availability`, then implement DTOs (`@Type(() => Number) @IsNumber() @Min(1) @Max(1000) radius`, same + `@IsOptional()` for `carRadius`, `@ApiProperty` docs; batch DTO `@ArrayMinSize(1) @ArrayMaxSize(batchMaxPoints) @ValidateNested`), controller, service (one `store.view()` per request).
- [ ] **Step 4:** `npx nx test api --testPathPattern=http.spec` → PASS.
- [ ] **Step 5:** Commit `feat: expose single and batch availability endpoints`.

### Task 8: Health and points endpoints

**Files:**
- Create: `apps/api/src/health/health.controller.ts`, `apps/api/src/points/points.controller.ts` (+ modules)
- Test: `apps/api/src/health/health-points.http.spec.ts`

**Interfaces:**
- Produces: `GET /health` (`@SkipThrottle()`), `GET /v1/points` as in the Design.

- [ ] **Step 1: Failing HTTP tests (in-process, `@nestjs/testing` + supertest):** before data → `/health` 503 `{status:'unavailable'}`; after ingest → 200 `ok` with both sources; fake operator with `recordedAt` 2 h old → listed in `staleOperators`, status still `ok`; one provider's last run failed → `degraded` with `lastError`; `/v1/points` returns a FeatureCollection whose feature count = number of points, each feature's `properties` keys are exactly `formFactor` and `count`, and `Content-Encoding: gzip` when requested.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npx nx test api --testPathPattern=http.spec` PASS.
- [ ] **Step 5:** Commit `feat: add health and points endpoints`.

### Task 9: Playground map

**Files:**
- Create: `apps/api/src/assets/map/index.html`, `map.js`, `map.css`
- Modify: `apps/api/src/app.module.ts` (`ServeStaticModule.forRoot({ rootPath: join(__dirname, 'assets', 'map'), exclude: ['/v1/(.*)', '/health', '/docs(.*)'] })`)

**Interfaces:**
- Consumes: `GET /v1/points`, `GET /v1/availability`.

- [ ] **Step 1:** Build the page: MapLibre GL JS (exact pinned version from unpkg/jsdelivr) + OpenFreeMap "positron" style, centred on Belgium; GeoJSON source from `/v1/points` with a circle layer coloured by `formFactor` and a checkbox per form factor (layer filter); click → marker + circle polygon (64 vertices computed in JS) → `/v1/availability`; range slider + number input 1–1000 for `radius` (debounced 250 ms) re-queries; checkbox "separate car radius" reveals a second slider for `carRadius` and draws a dashed second circle; side panel shows total and count per form factor, plus data age. Add the Points/Heatmap switch as described in the Design "Map" section (heatmap layer weighted by `count`, honouring the form-factor checkboxes, snapshot caption). Comment the JS by section.
- [ ] **Step 2: Verify:** `npx nx serve api`, open `http://localhost:3000/`, click Gent Korenmarkt, set 500 m → panel totals equal `curl 'localhost:3000/v1/availability?lat=…&lon=…&radius=500' | jq .total`; toggling scooters hides them; with radius 200 + car radius 400 the panel matches `curl '…&radius=200&carRadius=400'`; Heatmap view with only "car" checked shows hot spots over Brussels/Antwerp/Ghent and changes when "scooter" is checked instead; works at 375 px width.
- [ ] **Step 3:** Commit `feat: add playground map`.

### Task 10: Containerization and README

**Files:**
- Generate: `apps/api/Dockerfile` (+ `docker:build` target in `apps/api/project.json`) via `npx nx g @nx/node:setup-docker --project=api --outputPath=dist/apps/api --skipDockerPlugin --no-interactive`
- Modify: `apps/api/Dockerfile`, `apps/api/project.json` (`docker:build` command), `.dockerignore` (create: `node_modules`, `dist`, `.nx`, `.git`)
- Create: `docker-compose.yml`
- Modify: `README.md`

- [ ] **Step 1: Generate, then fix the Dockerfile.** The generated file (verified with Nx 24.0.7) uses `node:lts-alpine`, expects `nx build` to have run on the host and does `COPY ../../dist/apps/api .`, which escapes the build context and fails. Make these edits and nothing more: (a) build context = repo root (`docker build -f apps/api/Dockerfile .`; update the `docker:build` command accordingly); (b) add a build stage `FROM node:24-alpine AS build` → `npm ci` → `npx nx build api --configuration=production`; (c) runtime stage `FROM node:24-alpine`: `COPY --from=build /app/dist/apps/api .`, `npm ci --omit=dev` using the generated `package.json`/lockfile in dist (the generated `prune` target produces the lockfile — run `npx nx run api:prune` in the build stage), `USER node`, `VOLUME /data`, `EXPOSE 3000`, `HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1`, keep `CMD ["node","main.js"]`. Comment each stage. `docker-compose.yml` (hand-written, short): `build: { context: ., dockerfile: apps/api/Dockerfile }`, service `app`, named volume `mobility-data:/data`, `ports: ["127.0.0.1:3000:3000"]`, `restart: unless-stopped`, env with Design defaults (`TRUST_PROXY=true` commented with explanation).
- [ ] **Step 2:** Extend README: architecture diagram (from Design), endpoint reference with curl examples, configuration table (incl. how to change `INGEST_INTERVAL_SECONDS` and its effect on staleness), how to add a new provider, how a PostGIS store would plug in. Re-check the "Data decisions" section still matches the code (counts, thresholds, defaults).
- [ ] **Step 3: Verify:** `docker compose up -d --build`; within 90 s `curl -s localhost:3000/health | jq .status` → `"ok"`; `docker compose restart app` then `/v1/availability?...` answers immediately (snapshot from volume); `docker inspect --format '{{.State.Health.Status}}'` → `healthy`; `docker compose exec app ls /data/archive` lists one `.json.gz` file.
- [ ] **Step 4:** Commit `chore: containerize service and document it`.

## Verification (end-to-end)

1. `npx nx run-many -t lint test build` → all green; with `npx nx serve api` running, `npx nx e2e api-e2e` → green (replace the generated sample in `apps/api-e2e/src/api/api.spec.ts` with smoke tests: `/health` 200 once data loaded, `/v1/availability?lat=51.0545&lon=3.7215&radius=500` 200 with the four form factors).
2. `docker compose up -d --build`, wait for `/health` = `ok`.
3. Cross-check against an independent calculation: download `/v1/points`, compute with a short `python3 -I` script the haversine sum for Gent Korenmarkt (51.0545, 3.7215) at 500 m, compare to `/v1/availability` `total` (equal, given both from the same snapshot — fetch both within the same minute or compare against `data.sources` timestamps).
4. Batch: POST 100 points → 200 in < 100 ms; 101 points → 400.
5. Latency: `npx autocannon -c 20 -d 10 'http://localhost:3000/v1/availability?lat=51.2194&lon=4.4025&radius=1000'` (with rate limit raised via env) → p99 < 20 ms.
6. Map: open `http://localhost:3000/`, run the Task 9 checks, screenshot via Chrome DevTools.
