-- Canonical role taxonomy foundation (Task 5.11). Purely additive - does not
-- touch jobs.title (fully raw scraped title, untouched) or
-- job_roles.advertised_role/actual_role (LLM-inferred + locally-aliased text
-- via normalizeRoles.js, also untouched). This table is a new layer ABOVE
-- those, exactly mirroring how taxonomy_aliases already sits above
-- skills/capabilities (see resolveTaxonomyValue.js).
--
-- 'role' has been a legal dimension value in both taxonomy_aliases and
-- taxonomy_review_queue's CHECK constraints since migration 001 - verified
-- live before writing this migration. No CHECK constraint change is needed;
-- only the canonical entity table itself was missing.
--
-- Column shape mirrors skills (VARCHAR(150) name/normalized_name, unique on
-- both) rather than capabilities (TEXT) - role titles are short labels like
-- skill names, not long sentences.
--
-- No job_roles/jobs backfill, no new FK columns on job_roles, and no seed
-- data are included here. Per Task 5.11 scope this is schema/normalization
-- foundation only - see the task's final report for the seeding decision.

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(150) NOT NULL UNIQUE,

    normalized_name VARCHAR(150) NOT NULL UNIQUE,

    created_at TIMESTAMP DEFAULT NOW()
);
