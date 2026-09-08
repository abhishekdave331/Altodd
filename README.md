# Altodd — AI Job Market Intelligence Platform

Scrapes AI/ML job postings from LinkedIn, analyzes each one with a self-hosted LLM, stores the results in PostgreSQL with daily market-snapshot aggregation, and serves it all through a dashboard. Runs on a daily automated schedule.

> **Note**: the project was renamed from "Vektor" to "Altodd" — all code, docs, the database name, and the scheduled task now say Altodd, but the folder on disk is still physically named `Vektor` (a running terminal session had it open as its working directory, and Windows won't allow renaming a folder that's in use). `scripts/run-daily-pipeline.ps1` and the scheduled task both correctly point at the real `...\Documents\Vektor\...` path — rename the folder yourself whenever convenient (close all terminals/Explorer windows pointed at it first), then update the `$root` path at the top of `scripts/run-daily-pipeline.ps1` to match.

## Architecture

```
linkedin-jobs-scraper (Apify Actor)
        ↓ scrapes public LinkedIn job search results
llm-pipeline
        ↓ analyzes each job with a local Ollama model → structured JSON
market-intelligence
        ↓ ingests raw JSON → normalized Postgres tables → daily aggregate tables → trend engine
        ↓ exposes REST API at /api/dashboard/*
dashboard (Next.js)
        ↓ reads the API, renders market intelligence live
```

Each stage writes its output to disk/DB; the next stage reads from there. Nothing upstream needs to be running for a downstream stage to serve existing data — the dashboard and API read from Postgres, not live from the scraper or LLM.

## Modules

| Directory | What it does | Stack |
|---|---|---|
| `linkedin-jobs-scraper/` | Apify Actor scraping LinkedIn's public (logged-out) job search pages, filtered to AI/ML titles | Node.js, Crawlee, deployed to Apify Cloud |
| `llm-pipeline/` | Pulls the scraper's latest dataset, runs each job through a local Ollama model, writes one structured analysis JSON per job | Node.js, Ollama (`llama3.2:3b`) |
| `market-intelligence/` | Ingests those JSON files into PostgreSQL (raw + normalized), computes daily market metrics, trends, emerging skills, and market health, exposes a REST API | Node.js, Express, PostgreSQL |
| `dashboard/` | Renders the market intelligence API as a single-page dashboard | Next.js, Tailwind, anime.js |
| `scripts/run-daily-pipeline.ps1` | Orchestrates scraper → LLM → ingest/aggregate as one script, registered as a Windows Scheduled Task | PowerShell |

## Prerequisites

- Node.js ≥ 18 (repo built/tested on v24)
- [Ollama](https://ollama.com/download) installed, with `llama3.2:3b` pulled (`ollama pull llama3.2:3b`)
- PostgreSQL running locally (tested against v17 on port 5432)
- An [Apify](https://apify.com) account, logged in locally via `apify login` (Apify CLI: `npm install -g apify-cli`)
- Root `.env` with `APIFY_TOKEN` (used by `llm-pipeline` and, for local runs, `linkedin-jobs-scraper`)

## Running each module manually

```bash
# 1. Scrape (deployed Actor ID: WoIkcryaPU8xUSqP0)
cd linkedin-jobs-scraper
npm install
apify call WoIkcryaPU8xUSqP0 --input-file=storage/key_value_stores/default/INPUT.json
# (or `npm start` to run the crawler locally instead of on Apify's cloud)

# 2. Analyze with the local LLM
cd ../llm-pipeline
npm start                    # writes output/<jobId>.json per job

# 3. Ingest + aggregate into Postgres
cd ../market-intelligence
npm install
cp .env.example .env         # fill in the real DB_PASSWORD first
npm run db:setup             # idempotent — safe to rerun
npm run daily                # ingest + aggregate + market-health scoring

# 4. Serve the API and dashboard
npm run start                 # market-intelligence API on :3003
cd ../dashboard
npm install
npm run dev                   # dashboard on :3000
```

### `llm-pipeline` configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `APIFY_ACTOR_ID` | `WoIkcryaPU8xUSqP0` | Which Actor's latest successful run to pull jobs from |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2:3b` | Model tag to use |
| `MAX_JOBS` | (all) | Cap how many jobs to process, useful for testing |
| `JOB_TIMEOUT_MS` | `300000` (5 min) | Per-job hard timeout — a stuck/slow analysis is skipped rather than hanging the whole batch |

### `market-intelligence` npm scripts

| Script | Does |
|---|---|
| `db:setup` | Creates the Postgres schema (16 tables + pgcrypto extension), idempotent |
| `ingest` | Reads all JSON files from `../llm-pipeline/output/`, upserts into Postgres |
| `aggregate` | Computes today's market/skill/role/capability/seniority/location/industry snapshot |
| `trends` | Prints trend, emerging-skill, and market-health calculations for today |
| `daily` | Runs ingest + aggregate + market-health scoring in sequence |
| `dev` / `start` | Runs the Express API (with/without `--watch`) |

## Daily automation

`scripts/run-daily-pipeline.ps1` chains scrape → LLM analysis → ingest/aggregate, with logging to `logs/pipeline-<timestamp>.log`. It's registered as a Windows Scheduled Task (`Altodd Daily Pipeline`, daily at 6:00 AM, "Interactive only" logon mode — runs once you're logged into Windows, including from a locked screen; starts as soon as possible if a run was missed, and runs on battery power too).

Check it with:
```powershell
schtasks /Query /TN "Altodd Daily Pipeline" /V /FO LIST
```

The dashboard/API don't need restarting after a daily run — they read Postgres live on every request.

## Architecture principle: raw → normalized → aggregate → API

The dashboard API only ever reads from `daily_*` aggregate tables in `market-intelligence` — never recomputed from raw JSON on request. Raw LLM output is preserved forever in `job_analysis.analysis` (JSONB) for audit/drill-down/reprocessing, even for fields with no dedicated relational column.

## Known data-quality behaviors (not bugs)

- **Skill-priority partial matching**: `skill_priority.critical/important/preferred` sometimes lists category-level labels (e.g. `"Machine Learning"`) instead of individual skill names. Those entries are silently ignored rather than fuzzy-matched — a deliberate choice, not a defect.
- **Aggregation is a live snapshot, not a time machine**: every `daily_*` metrics query reads the *current* state of the normalized tables. Running `aggregate` for a past date does not reconstruct history — it just stamps today's live numbers under that date. Only ever run aggregation for "today."
- **Older-format source files**: `llm-pipeline/output/` may contain files from an earlier prompt version (missing several sections, `ai_lifecycle_coverage` as a flat array instead of an object). These are ingested best-effort — core fields always populate, everything else is left `NULL` rather than failing the whole file.
- **Tri-state coercion**: fields that arrive as `null`, `"implied"`, a literal boolean, or an evidence array all coerce to a single `BOOLEAN` column: `true`/non-empty-array → `true`, `false`/`[]` → `false`, `"implied"` → `true`, `null`/missing → `NULL`.
- **Market health / trends need 7+ days of history**: on a fresh install, `market_health.score` and `change_7d`/`change_30d` fields correctly report `null`/"Insufficient historical data" rather than fabricating a number. They start computing for real once the daily pipeline has run for a week.

## Legal / ethical note on scraping

`linkedin-jobs-scraper` only touches LinkedIn's **public, logged-out** job search pages — no login, no authenticated data. LinkedIn's Terms of Service still prohibit automated scraping, and public endpoints/markup can change or block requests without notice. Use residential proxies, keep concurrency low, and review LinkedIn's current ToS before using this commercially. Not legal advice.
