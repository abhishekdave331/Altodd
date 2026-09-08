-- Non-destructive role consolidation (Task 5.14). Adds a self-referencing
-- merge pointer to roles so two canonical role rows can be consolidated
-- without ever deleting the historical row - see Task 5.13's finding that
-- taxonomy_aliases cannot consolidate two rows that already both exist as
-- canonical entities (exact_match always intercepts before the alias table
-- is ever checked, verified live in that task).
--
-- Unlike taxonomy_aliases.canonical_id (deliberately polymorphic across
-- multiple possible tables depending on dimension, so no FK is possible
-- there - see migration 001), merged_into_id always points within this same
-- table, so a normal self-referencing FK is safe and appropriate - it
-- guarantees merged_into_id can never point at a nonexistent role, which a
-- polymorphic reference could never guarantee.
--
-- By design (enforced in roleConsolidation.js's mergeRole(), not here), a
-- merge target must always be an ACTIVE role (merged_into_id IS NULL). This
-- makes every merge pointer exactly one hop, which structurally rules out
-- circular or multi-hop chains without needing a database trigger.
--
-- roles has 7 existing rows as of this migration; adding a nullable column
-- with no default is a metadata-only change with nothing to backfill.

ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS merged_into_id UUID NULL REFERENCES roles(id);

ALTER TABLE roles
    DROP CONSTRAINT IF EXISTS roles_merged_into_not_self;

ALTER TABLE roles
    ADD CONSTRAINT roles_merged_into_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);

-- Supports "which roles have been merged into this one" / "is this role
-- active" lookups. Partial - most roles are expected to stay active
-- (merged_into_id NULL), so only merged rows need indexing.
CREATE INDEX IF NOT EXISTS idx_roles_merged_into_id ON roles(merged_into_id) WHERE merged_into_id IS NOT NULL;
