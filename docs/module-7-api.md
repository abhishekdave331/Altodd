# Module 7 API Reference — Personalized Job Search

This is the frontend-facing contract for Module 7 (resume upload → profile
enrichment → search configuration → personalized job search → pipeline
monitoring). It documents actual, implemented behavior only — every example
below was captured from a real request against the running API, not written
from memory of the code.

**Base URL:** the `market-intelligence` service, default `http://localhost:3003`.
All endpoints are mounted under `/api`. All request/response bodies are JSON
except the resume upload, which is `multipart/form-data`.

**Not implemented (by design, this module):** authentication, user accounts,
API keys, rate limiting. Every endpoint below is open — do not point a
public frontend at this API without adding an auth layer first.

---

## Quick reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/profiles/resume` | Upload a resume PDF → enrich → create a profile |
| GET | `/api/profiles/:id` | Fetch a profile + its enrichment result |
| POST | `/api/profiles/:id/search-configuration` | Generate a new search configuration for a profile |
| GET | `/api/profiles/:id/search-configurations` | List a profile's search-configuration history |
| GET | `/api/profiles/:id/search-configurations/latest` | Get the one valid configuration a job search would actually use |
| POST | `/api/profiles/:id/run-job-search` | One call: resolve/generate a config, then start the pipeline |
| POST | `/api/pipeline-runs` | Lower-level: start the pipeline using whatever config already exists |
| GET | `/api/pipeline-runs/:id` | Poll one pipeline run's status |
| GET | `/api/pipeline-runs?user_profile_id=` | List a profile's pipeline-run history |

---

## Complete frontend flow

```
1. POST /api/profiles/resume              → user_profile_id
2. GET  /api/profiles/:id                 → confirm enrichment_status
3. POST /api/profiles/:id/run-job-search  → pipeline_run_id   (recommended — see below)
4. GET  /api/pipeline-runs/:id            → poll until status is terminal
5. GET  /api/pipeline-runs?user_profile_id=...  → history / refresh recovery
```

Step 3 is a convenience endpoint that internally reuses or generates a
search configuration for you. If your frontend instead wants to show the
user their generated queries *before* starting a search (e.g. an editable
review screen), use the longer flow:

```
1. POST /api/profiles/resume
2. GET  /api/profiles/:id
3. POST /api/profiles/:id/search-configuration   → show queries to the user
4. GET  /api/profiles/:id/search-configurations/latest   (on later visits)
5. POST /api/pipeline-runs { user_profile_id }   → this reuses whatever
                                                    configuration already
                                                    exists (see "Search
                                                    configuration behavior"
                                                    below) — it does NOT
                                                    auto-generate one
6. GET  /api/pipeline-runs/:id  → poll
```

Both `run-job-search` and the plain `pipeline-runs` POST end up running the
exact same underlying pipeline; the only difference is whether search
configuration resolution happens automatically for you.

---

## Endpoint reference

### POST `/api/profiles/resume`

Upload a resume, extract its text, enrich it into a structured profile via
an LLM, and persist both.

- **Body:** `multipart/form-data`, one field: `resume` (the PDF file).
- **Constraints:** PDF only (checked by extension, declared MIME type, *and*
  file-content magic bytes — a renamed non-PDF is rejected); max size **10MB**;
  empty files rejected.
- **Timing:** synchronous. This call waits for the LLM enrichment call to
  finish before responding — typically **2–5 seconds**. There is no
  polling step for this endpoint.
- **Success:** `201 Created`

  ```json
  {
    "user_profile_id": "977ddda3-b585-440c-beee-33548611f315",
    "enrichment_status": "complete",
    "enriched_profile": {
      "target_roles": ["AI Engineer"],
      "skills": ["Python", "TensorFlow", "..."],
      "tools_technologies": ["Docker", "AWS", "..."],
      "seniority_level": null,
      "years_of_experience": 1,
      "preferred_industries": null,
      "education": [{ "degree": "B.Tech", "field": "...", "institution": "...", "year": "2025" }],
      "location": null,
      "keywords": ["AI Engineer", "RAG", "..."]
    },
    "created_at": "2026-09-08T16:12:21.849Z"
  }
  ```

  Any `enriched_profile` field can legitimately be `null` — the resume
  simply didn't state it. Never treat `null` there as an error.

- **Errors:**
  | Status | When |
  |---|---|
  | 400 | No file field, empty file, wrong extension/MIME type, or fails the PDF magic-byte check, or file exceeds 10MB |
  | 422 | File is a real PDF but no text could be extracted (e.g. a scanned image with no text layer) |
  | 502 | The file was stored fine, but the LLM enrichment call itself failed. Response includes `user_profile_id` and `enrichment_status: "failed"` — **a profile row was still created**, just with an empty enrichment. See "Search configuration behavior" for how this status is treated downstream. |
  | 500 | Internal storage/database failure |

### GET `/api/profiles/:id`

Fetch a profile and its enrichment result, plus non-sensitive resume
metadata.

- **Params:** `:id` — a `user_profiles.id` UUID.
- **Success:** `200 OK`

  ```json
  {
    "profile": {
      "user_profile_id": "977ddda3-b585-440c-beee-33548611f315",
      "resume_id": "aadfce1c-8f92-494e-b2de-beb2ede1f952",
      "seniority_level": null,
      "years_of_experience": 1,
      "location": null,
      "enriched_profile": { "...": "same shape as above" },
      "enrichment_status": "complete",
      "created_at": "2026-09-08T16:12:21.849Z",
      "original_filename": "resume.pdf",
      "file_format": "pdf",
      "uploaded_at": "2026-09-08T16:12:19.334Z"
    }
  }
  ```

  `original_filename`/`file_format`/`uploaded_at` describe the *resume*, not
  the profile itself — they're joined in for convenience. **Never
  returned:** the resume's full extracted text, or its on-disk storage path.

- **Errors:** `400` malformed id · `404` no such profile.

### POST `/api/profiles/:id/search-configuration`

Generate a **new** search configuration (job-title queries + filters) from
the profile's current enrichment data, and persist it as a new row —
existing configurations are never overwritten.

- **Params:** `:id` — a `user_profiles.id` UUID.
- **Body:** none.
- **Timing:** synchronous, one LLM call, typically **1–2 seconds**.
- **Success:** `201 Created`

  ```json
  {
    "search_configuration": {
      "id": "30aacfbf-15fd-4bbb-bd42-93700c243a3c",
      "user_profile_id": "977ddda3-b585-440c-beee-33548611f315",
      "primary_queries": ["AI Engineer", "Artificial Intelligence Engineer"],
      "secondary_queries": ["Machine Learning Engineer", "..."],
      "keywords": ["Python", "RAG", "..."],
      "seniority": null,
      "location": null,
      "industries": null,
      "employment_type": null,
      "generation_status": "complete",
      "created_at": "2026-09-08T16:12:37.898Z"
    }
  }
  ```

  `seniority` / `location` / `industries` / `employment_type` are copied
  **deterministically** from the profile (no LLM involved) — `employment_type`
  is always `null` today, because nothing upstream captures an employment
  preference yet. `primary_queries` / `secondary_queries` / `keywords` are
  LLM-generated and can legitimately be empty arrays (never `null`) if the
  profile had too little signal to work from.

- **Errors:**
  | Status | When |
  |---|---|
  | 400 | Malformed profile id |
  | 404 | No such profile |
  | 422 | The profile's `enrichment_status` is `"failed"` — there's no real data to generate from, so this is rejected before any LLM call is made |
  | 502 | The LLM call itself failed. A `search_configurations` row is still created with `generation_status: "failed"` and empty query arrays (deterministic filters are preserved). Response includes that row's `id` and `generation_status: "failed"`. |

### GET `/api/profiles/:id/search-configurations`

List a profile's search-configuration history, newest first. **Includes
failed configurations.**

- **Query params:** `limit` (optional, default 20, max 100).
- **Success:** `200 OK` — `{ "search_configurations": [ /* newest first */ ] }`,
  same object shape as the POST response above. Empty array if none exist yet.
- **Errors:** `400` malformed id · `404` no such profile.

### GET `/api/profiles/:id/search-configurations/latest`

Get the single configuration that `run-job-search` (or a plain
`POST /api/pipeline-runs`) would actually use right now.

- **Why this exists / why it's different from the list endpoint above:**
  the list is newest-first and includes failed rows. If the most recent
  generation attempt failed, it sorts first in the list — but a pipeline run
  would skip it and use the next-newest *valid* one instead. This endpoint
  applies that same "skip failed" rule, so what you see here always matches
  what a job search would actually use.
- **Success:** `200 OK`
  - A valid configuration exists: `{ "search_configuration": { ...same shape as above... } }`
  - **None exists yet** (fresh profile, or every attempt so far has failed):
    `{ "search_configuration": null }` — this is a normal, expected state,
    not an error. It means the next `run-job-search` call will generate one
    automatically.
- **Errors:** `400` malformed id · `404` no such profile.

### POST `/api/profiles/:id/run-job-search`

The recommended one-call way to start a personalized job search: resolves
(or generates) a search configuration, then starts the pipeline. Internally
composes the existing search-configuration and pipeline-run services —
it does not talk to Apify or Groq directly itself.

- **Params:** `:id` — a `user_profiles.id` UUID.
- **Body:** none.
- **Timing:** returns immediately (**202**, typically well under a second)
  once a configuration is resolved and the pipeline has been *started* —
  it does **not** wait for the pipeline to finish. Poll
  `GET /api/pipeline-runs/:id` for progress. (The one exception: if no valid
  configuration exists yet, this call also does one synchronous LLM
  generation call first, adding ~1–2s before the 202.)
- **Success:** `202 Accepted`

  ```json
  {
    "pipeline_run_id": "23e5f4d6-1dc6-4268-87ff-b557365c8eff",
    "user_profile_id": "977ddda3-b585-440c-beee-33548611f315",
    "search_configuration_id": "30aacfbf-15fd-4bbb-bd42-93700c243a3c",
    "status": "pending",
    "started_at": "2026-09-08T16:13:44.616Z"
  }
  ```

  Note this response shape is flat (no `pipeline_run` wrapper) — see
  "Known inconsistencies" below.

- **Errors:**
  | Status | When |
  |---|---|
  | 400 | Malformed profile id |
  | 404 | No such profile |
  | 422 | `enrichment_status` is `"failed"` — nothing real to search with |
  | 409 | This profile already has a pipeline run in progress. Response includes the existing `pipeline_run` object — **poll that one instead of retrying.** |
  | 502 | No valid configuration existed and generating one failed. **No pipeline run is created in this case.** |

### POST `/api/pipeline-runs`

Lower-level endpoint: start the pipeline using whatever search
configuration already exists for the profile. **Does not auto-generate one**
— if none exists, the pipeline itself will run and cleanly reach a terminal
`"completed"` state with `error_message` explaining there was nothing to
search with (this is not a `4xx`/`5xx` — the request to start a run was
valid; the run itself just found nothing to do).

- **Body:** `{ "user_profile_id": "<uuid>" }`
- **Success:** `202 Accepted` — `{ "pipeline_run": { ...same shape as GET below... } }`
  Note this one *is* wrapped in `pipeline_run`, unlike `run-job-search`'s flat
  response — see "Known inconsistencies" below.
- **Errors:** `400` missing/malformed `user_profile_id` · `404` no such
  profile · `409` a run is already in progress (same shape as above).

### GET `/api/pipeline-runs/:id`

Poll a single pipeline run's status.

- **Success:** `200 OK`

  ```json
  {
    "pipeline_run": {
      "id": "23e5f4d6-1dc6-4268-87ff-b557365c8eff",
      "user_profile_id": "977ddda3-b585-440c-beee-33548611f315",
      "search_configuration_id": "30aacfbf-15fd-4bbb-bd42-93700c243a3c",
      "status": "completed",
      "jobs_scraped": 1,
      "jobs_analyzed": 2,
      "jobs_processed_successfully": 2,
      "error_message": null,
      "started_at": "2026-09-08T16:13:44.616Z",
      "completed_at": "2026-09-08T16:14:28.202Z",
      "created_at": "2026-09-08T16:13:44.616Z"
    }
  }
  ```

  All three job counts are `null` until the relevant stage has actually
  run — `null` means "not reached yet," not zero. See the lifecycle section
  below for exactly when each field populates.

- **Errors:** `400` malformed id (never a raw 500 — this is validated before
  it reaches the database) · `404` no such run.

### GET `/api/pipeline-runs?user_profile_id=...`

List a profile's pipeline-run history, newest first.

- **Query params:** `user_profile_id` (required, UUID) · `limit` (optional,
  default 20, max 100).
- **Success:** `200 OK` — `{ "pipeline_runs": [ /* newest first */ ] }`, same
  object shape as the GET-by-id response. Empty array if none exist.
- **Errors:** `400` missing/malformed `user_profile_id`.
- **This is also your "is anything currently running" check** — because
  only one active run per profile is ever allowed (see below), the
  newest item in this list (`limit=1`) is either the currently-active run
  or the most recent finished one. There is no separate "active run"
  endpoint; you don't need one.

---

## Pipeline status lifecycle

```
pending → scraping → analyzing → ingesting → completed
                                            ↘ completed_with_errors
   (any stage) ─────────────────────────────→ failed
```

| Status | Terminal? | Meaning |
|---|---|---|
| `pending` | No | Run created, not yet started |
| `scraping` | No | Apify actor run(s) in progress |
| `analyzing` | No | Groq is analyzing scraped jobs |
| `ingesting` | No | Writing results into the market-intelligence database and recomputing aggregates |
| `completed` | **Yes** | Finished with no errors, or (see below) no search configuration/no results — a clean, honest end state either way |
| `completed_with_errors` | **Yes** | Finished, but part of it failed (e.g. one of two scraper queries failed while the other succeeded) — check `error_message` |
| `failed` | **Yes** | The run could not produce a usable result at all (e.g. every scraper query failed, or a stage crashed) |

**Poll only while status is one of `pending` / `scraping` / `analyzing` /
`ingesting`.** Any of the other three means stop polling — the run is done.
There is no separate "cancel" endpoint; a run always runs to one of these
three end states on its own.

A recommended polling interval is **5–10 seconds**; a full run typically
takes anywhere from ~20 seconds to a few minutes depending on how many
Apify actor runs it needs.

**Important:** `completed` does not always mean "jobs were found." A
profile whose search configuration currently has no usable queries, or
whose Apify search simply returns zero results this cycle, still reaches
`completed` with `jobs_scraped: 0` — that's a genuine, honest outcome, not
a bug. Only `failed` / `completed_with_errors` indicate something actually
went wrong.

---

## Search configuration behavior

- **"Latest valid configuration"** means: the newest `search_configurations`
  row for a profile whose `generation_status` is **not** `"failed"` (`"complete"`
  and `"partial"` both count as valid — `"partial"` just means some LLM
  field needed coercion, not that the configuration is unusable).
- **Failed configurations are never selected automatically** — not by
  `run-job-search`, not by the plain `POST /api/pipeline-runs`'s internal
  config lookup. They still appear in `GET .../search-configurations`
  (full history) but never in `GET .../search-configurations/latest`.
- **`run-job-search`'s reuse-vs-regenerate rule:** it looks up the latest
  valid configuration first. If one exists, it is reused as-is — **no new
  LLM call is made**, even if it's old. A new configuration is only
  generated automatically when none exists yet (fresh profile, or every
  past attempt failed). If you want a fresh configuration reflecting an
  updated profile, call `POST /api/profiles/:id/search-configuration`
  yourself first.
- **`GET .../latest` returning `null`** is expected and not an error — it
  means either the profile has never had a configuration generated, or
  every attempt so far has failed. The next `run-job-search` call will
  generate one automatically in that case.

---

## Frontend state recovery (page refresh)

A frontend only needs to persist one value client-side: **`user_profile_id`**
(e.g. in the URL or `localStorage`). Everything else can be reconstructed:

```
GET /api/profiles/:id
  → enrichment_status, enriched_profile

GET /api/profiles/:id/search-configurations/latest
  → the configuration currently in effect (or null)

GET /api/pipeline-runs?user_profile_id=:id&limit=1
  → the most recent run.
    - status is pending/scraping/analyzing/ingesting → resume polling
      GET /api/pipeline-runs/:id with that run's id
    - status is terminal → nothing to poll; show it as the last result

GET /api/pipeline-runs?user_profile_id=:id&limit=20   (or higher)
  → full run history, e.g. for a "past searches" list
```

No endpoint needs to be called more than once per page load beyond this —
three requests are sufficient to fully restore UI state after a refresh at
any point in the flow.

---

## Error handling reference

| Status | Meaning across this API | Typical body |
|---|---|---|
| 400 | Malformed input — bad UUID format, missing required field, unsupported/oversized/empty file upload | `{ "error": "..." }` |
| 404 | The referenced profile or pipeline run does not exist | `{ "error": "..." }` |
| 409 | A pipeline run is already active for this profile | `{ "error": "...", "pipeline_run": { ... } }` — poll the included run |
| 422 | The request is well-formed but semantically impossible to fulfill honestly — a failed-enrichment profile with no data to search from, or a PDF with no extractable text | `{ "error": "..." }` |
| 502 | A downstream LLM call (Groq) failed. The request itself was valid; an upstream dependency wasn't reachable/working. Any state that *could* be safely recorded (a `'failed'` profile or configuration row) already was — check for an included `id`/`user_profile_id`. | `{ "error": "...", ... }` |
| 500 | Unexpected internal/database failure | `{ "error": "..." }` |

**General rule:** a non-2xx response never means a row was silently created
and mislabeled as successful. Where a partial write did happen (e.g. a
resume was stored before enrichment failed), the response body tells you
its id and honest status explicitly rather than leaving you to guess.

---

## Known inconsistencies (documented, not fixed)

- `POST /api/profiles/resume` and `POST /api/profiles/:id/run-job-search`
  return their fields at the top level of the response. Every other
  endpoint wraps its resource in a named key (`profile`, `search_configuration`,
  `pipeline_run`, etc.). This was reviewed and intentionally left as-is to
  avoid a breaking change to two already-relied-upon response shapes — not
  an oversight.
- There is no endpoint to fetch a single search configuration by its own id
  (only profile-scoped list + latest). Not currently needed by the flow
  above.

## Explicitly out of scope

Authentication, multi-tenant user accounts, resume re-upload/versioning,
canceling an in-flight pipeline run, and WebSocket/push-based status updates
(polling is the only supported mechanism) are all absent by design — adding
any of them is a larger, separate decision, not an oversight in this API.
