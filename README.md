# Altodd — AI Job Market Intelligence Platform

Two things live in this repo:

1. **Market intelligence** — scrapes AI/ML job postings from LinkedIn, analyzes each one with an LLM, stores the results in PostgreSQL with daily market-snapshot aggregation, and serves it all through a dashboard API.
2. **Personalized job search** — a user uploads a resume, an LLM extracts a structured profile, that profile becomes dynamic search parameters, and a per-user pipeline scrapes/analyzes/ingests jobs on demand — tracked end-to-end in `pipeline_runs`.

Each stage is currently run manually or via API call — see [Daily automation](#daily-automation) for why there's no scheduler.

## Architecture

**Static market intelligence** (the original pipeline — still runs manually, on demand):

```
linkedin-jobs-scraper (Apify Actor)
        ↓ scrapes public LinkedIn job search results
llm-pipeline
        ↓ analyzes each job with Groq → structured JSON
market-intelligence
        ↓ ingests raw JSON → normalized Postgres tables → daily aggregate tables → trend engine
        ↓ exposes REST API at /api/dashboard/*
dashboard (Next.js)
        ↓ reads the API, renders market intelligence live
```

**Personalized job search** (Module 7 — triggered per-user, via API):

```
resume upload (POST /api/profiles/resume)
        ↓ profile-enrichment: extract text → Groq → structured profile → user_profiles
search configuration (auto-generated, or POST /api/profiles/:id/search-configuration)
        ↓ profile-enrichment: deterministic filters + Groq-generated search queries
personalized pipeline (POST /api/profiles/:id/run-job-search)
        ↓ scraper-orchestration: dynamic Apify actor runs built from that profile's queries
        ↓ llm-pipeline: analyzes the resulting datasets with Groq
        ↓ market-intelligence: ingests + aggregates, same tables the static pipeline uses
        ↓ tracked throughout in pipeline_runs (poll via GET /api/pipeline-runs/:id)
```

Both pipelines converge on the same `market-intelligence` Postgres database and the same `daily_*` aggregate tables — a personalized run's jobs show up in the general market-intelligence dashboard too, not a separate silo.

Each stage writes its output to disk/DB; the next stage reads from there. Nothing upstream needs to be running for a downstream stage to serve existing data — the dashboard and API read from Postgres, not live from the scraper or LLM.

## Modules

| Directory | What it does | Stack |
|---|---|---|
| `linkedin-jobs-scraper/` | Apify Actor scraping LinkedIn's public (logged-out) job search pages, filtered to AI/ML titles | Node.js, Crawlee, deployed to Apify Cloud |
| `llm-pipeline/` | Pulls the scraper's latest dataset (or explicit scraper-orchestration datasets), runs each job through Groq, writes one structured analysis JSON per job | Node.js, Groq |
| `market-intelligence/` | Ingests those JSON files into PostgreSQL (raw + normalized), computes daily market metrics/trends/emerging skills/market health, governs the skill/role taxonomy (aliasing, merge/consolidation, review queue), and exposes the full REST API — both the market-intelligence dashboard and all of Module 7 | Node.js, Express, PostgreSQL |
| `profile-enrichment/` | Turns an uploaded resume into a structured profile (Groq) and, from that, a search configuration (deterministic filters + Groq-generated queries) | Node.js, Groq |
| `scraper-orchestration/` | Builds dynamic Apify actor input from a profile's search configuration and runs it, replacing the static scraper input for personalized searches | Node.js, Apify REST API |
| `dashboard/` | Renders the market intelligence API as a single-page dashboard | Next.js, Tailwind, anime.js |
| `scripts/run-daily-pipeline.ps1` | Orchestrates scraper → LLM → ingest/aggregate as one script, run manually (no longer scheduled — see [Daily automation](#daily-automation)) | PowerShell |
| `scripts/run-personalized-pipeline.js` | Cross-module sequencer for one personalized run: scraper-orchestration → llm-pipeline → market-intelligence, recording every stage in `pipeline_runs` — this is what `POST /api/profiles/:id/run-job-search` spawns | Node.js |

`profile-enrichment` and `scraper-orchestration` never import each other's or `market-intelligence`'s code directly — every module stays independently installable/deployable, and they coordinate only via child-process invocation or shared Postgres state, same as the original scraper/llm-pipeline/market-intelligence split.

See [`docs/module-7-api.md`](docs/module-7-api.md) for the complete frontend-facing API reference for Module 7 (every endpoint, request/response shapes, the pipeline status lifecycle, and how to recover state after a page refresh).

## Prerequisites

- Node.js ≥ 18 (repo built/tested on v24)
- A [Groq](https://console.groq.com) API key (used by `llm-pipeline` for job analysis and `profile-enrichment` for resume/search-config generation)
- PostgreSQL running locally (tested against v17 on port 5432)
- An [Apify](https://apify.com) account, logged in locally via `apify login` (Apify CLI: `npm install -g apify-cli`)
- Root `.env` with `APIFY_TOKEN` (used by `llm-pipeline`, `scraper-orchestration`, and, for local runs, `linkedin-jobs-scraper`) and `GROQ_API_KEY`/`GROQ_MODEL` (used by `llm-pipeline` and `profile-enrichment`)

## Running the static market-intelligence pipeline manually

```bash
# 1. Scrape (deployed Actor ID: WoIkcryaPU8xUSqP0)
cd linkedin-jobs-scraper
npm install
apify call WoIkcryaPU8xUSqP0 --input-file=storage/key_value_stores/default/INPUT.json
# (or `npm start` to run the crawler locally instead of on Apify's cloud)

# 2. Analyze with Groq
cd ../llm-pipeline
npm start                    # writes output/<jobId>.json per job

# 3. Ingest + aggregate into Postgres
cd ../market-intelligence
npm install
cp .env.example .env         # fill in the real DB_PASSWORD first
npm run db:setup             # idempotent — safe to rerun
npm run daily                # ingest + aggregate + market-health scoring

# 4. Serve the API and dashboard
npm run start                 # market-intelligence API on :3003 (also serves all Module 7 routes)
cd ../dashboard
npm install
npm run dev                   # dashboard on :3000
```

## Running a personalized job search (Module 7)

Everything below assumes `market-intelligence`'s API is running (step 4 above) — it hosts every Module 7 route too. Full request/response detail lives in [`docs/module-7-api.md`](docs/module-7-api.md); the short version:

```bash
# 1. Upload a resume (PDF) → profile enrichment happens synchronously
curl -F "resume=@resume.pdf" http://localhost:3003/api/profiles/resume
# → { "user_profile_id": "...", "enrichment_status": "complete", "enriched_profile": {...} }

# 2. Trigger the personalized search — auto-generates a search configuration
#    if none exists yet, then starts the pipeline and returns immediately
curl -X POST http://localhost:3003/api/profiles/<user_profile_id>/run-job-search
# → { "pipeline_run_id": "...", "status": "pending", ... }

# 3. Poll until the status is terminal
curl http://localhost:3003/api/pipeline-runs/<pipeline_run_id>
# statuses: pending → scraping → analyzing → ingesting → completed
#                                                       ↘ completed_with_errors
#           (any stage) ──────────────────────────────→ failed
```

Each of `profile-enrichment` and `scraper-orchestration` also exposes its logic as a standalone CLI for local testing, independent of the API:

```bash
cd profile-enrichment
npm run process-resume -- <path-to-resume.pdf>
npm run generate-search-config -- <user_profiles.id>

cd ../scraper-orchestration
npm run orchestrate -- <user_profiles.id>
```

### `llm-pipeline` configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `APIFY_ACTOR_ID` | `WoIkcryaPU8xUSqP0` | Which Actor's latest successful run to pull jobs from |
| `GROQ_API_KEY` | (required) | Groq API key |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model to use |
| `MAX_JOBS` | (all) | Cap how many jobs to process, useful for testing |
| `JOB_TIMEOUT_MS` | `300000` (5 min) | Per-job hard timeout — a stuck/slow analysis is skipped rather than hanging the whole batch |

### `market-intelligence` npm scripts

| Script | Does |
|---|---|
| `db:setup` | Applies the schema + every migration (schema + skill/role/search-config/pipeline-tracking tables), idempotent |
| `ingest` | Reads all JSON files from `../llm-pipeline/output/`, upserts into Postgres |
| `aggregate` | Computes the given date's (default: today) market/skill/role/capability/seniority/location/industry snapshot, atomically — a re-run for a past date correctly reconstructs that date rather than overwriting it with today's numbers |
| `trends` | Prints trend, emerging-skill, and market-health calculations for today |
| `daily` | Runs ingest + aggregate + market-health scoring in sequence |
| `dev` / `start` | Runs the Express API (with/without `--watch`) — serves both `/api/dashboard/*` and every Module 7 route |

### `profile-enrichment` / `scraper-orchestration` npm scripts

| Module | Script | Does |
|---|---|---|
| `profile-enrichment` | `process-resume -- <path.pdf>` | Extract → Groq-enrich → persist a resume, standalone (same logic the API uses) |
| `profile-enrichment` | `generate-search-config -- <user_profiles.id>` | Generate + persist a search configuration for an existing profile, standalone |
| `scraper-orchestration` | `orchestrate -- <user_profiles.id>` | Run one dynamic scraping cycle for a profile's latest search configuration, standalone |

## Daily automation

**The Windows Scheduled Task (`Altodd Daily Pipeline`) has been removed.** The product moved from a static, once-daily scraped snapshot toward the personalized model above — fetching in real time based on a user's own profile — so a fixed daily batch schedule no longer matches the intended architecture.

`scripts/run-daily-pipeline.ps1` still exists and still works (chains scrape → LLM analysis → ingest/aggregate, logging to `logs/pipeline-<timestamp>.log`) — it's just no longer scheduled. Run it manually when you want a fresh general-market snapshot:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-daily-pipeline.ps1
```
or run the individual `market-intelligence` npm scripts (`ingest`, `aggregate`, `daily`) directly, as described above. For a personalized, per-user snapshot instead, use the Module 7 API/CLI described above — nothing there is scheduled either; it runs on demand per user request.

The dashboard/API don't need restarting after a manual run — they read Postgres live on every request.

## Architecture principle: raw → normalized → aggregate → API

The dashboard API only ever reads from `daily_*` aggregate tables in `market-intelligence` — never recomputed from raw JSON on request. Raw LLM output is preserved forever in `job_analysis.analysis` (JSONB) for audit/drill-down/reprocessing, even for fields with no dedicated relational column. This holds regardless of whether a job arrived via the static scraper or a personalized run — both paths write through the same ingestion/aggregation code.

`pipeline_runs` is the single source of truth for a personalized run's lifecycle (`pending → scraping → analyzing → ingesting → completed`/`completed_with_errors`/`failed`) — a failure at any stage is always recorded honestly there rather than silently left looking like success, and only one active run per profile is ever allowed (enforced at the database level, not just in application code).

## Known behaviors and limitations (not bugs)

- **Skill-priority partial matching**: `skill_priority.critical/important/preferred` sometimes lists category-level labels (e.g. `"Machine Learning"`) instead of individual skill names. Those entries are silently ignored rather than fuzzy-matched — a deliberate choice, not a defect.
- **Aggregation correctly reconstructs historical dates**: every `daily_*` metrics computation is bounded to jobs whose `first_seen_at` falls on or before the target date and runs as one atomic transaction, so re-running `aggregate` for a past date recomputes that date's true historical snapshot rather than overwriting it with today's totals. One caveat: mutable job fields (e.g. `applicants`) reflect their *current* value, not necessarily their value as of that historical date, since individual fields aren't versioned — only which jobs counted toward a date is reconstructed precisely.
- **Skill/role taxonomy is alias-based, not exhaustive**: near-duplicate skill names (e.g. "LLM" vs "LLMs") are merged via an explicit alias list, backfilled as they're found — not a general fuzzy-matching system. Capability tagging currently canonicalizes only a handful of common patterns (RAG, AI agents, observability, etc.); anything that doesn't match one of those patterns is stored and displayed as its own raw, uncanonicalized text rather than dropped — expect the capabilities list to contain many one-off entries alongside the canonical ones.
- **Older-format source files**: `llm-pipeline/output/` may contain files from an earlier prompt version (missing several sections, `ai_lifecycle_coverage` as a flat array instead of an object). These are ingested best-effort — core fields always populate, everything else is left `NULL` rather than failing the whole file.
- **Tri-state coercion**: fields that arrive as `null`, `"implied"`, a literal boolean, or an evidence array all coerce to a single `BOOLEAN` column: `true`/non-empty-array → `true`, `false`/`[]` → `false`, `"implied"` → `true`, `null`/missing → `NULL`.
- **Market health / trends need 7+ days of history**: on a fresh install, `market_health.score` and `change_7d`/`change_30d` fields correctly report `null`/"Insufficient historical data" rather than fabricating a number. They start computing for real once the daily pipeline has run for a week. Every dashboard endpoint that reads a `daily_*` table also returns the `date` it's reporting on, so a caller can always tell what snapshot it's looking at.
- **No pagination on `GET /api/dashboard/jobs`**: it returns every job unconditionally. Fine at current data volume; would need adding before this dataset grows large.
- **Occasional unexplained personalized-pipeline failures**: a small fraction of real personalized runs fail at the scraper-orchestration stage with a generic process error and no further detail, for reasons not yet root-caused (suspected transient network/OS-level, not a logic bug — extensively investigated without reproducing it in isolation). When this happens the run is always correctly recorded as `failed` with an honest error message — it never shows as falsely `completed` — so it's a reliability nuisance, not a correctness or data-integrity risk.

## Legal / ethical note on scraping

`linkedin-jobs-scraper` only touches LinkedIn's **public, logged-out** job search pages — no login, no authenticated data. LinkedIn's Terms of Service still prohibit automated scraping, and public endpoints/markup can change or block requests without notice. Use residential proxies, keep concurrency low, and review LinkedIn's current ToS before using this commercially. Not legal advice.
