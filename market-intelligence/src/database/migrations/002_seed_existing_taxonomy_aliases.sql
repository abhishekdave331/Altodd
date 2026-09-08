-- Seeds taxonomy_aliases with alias knowledge that already exists in
-- src/ingestion/normalizeSkills.js (SKILL_ALIASES).
--
-- Scope note: src/ingestion/normalizeRoles.js also defines ROLE_ALIASES (3
-- entries) and SENIORITY_ALIASES (15 entries), but neither a `roles` nor a
-- `seniority_levels` canonical entity table exists yet (Task 5.5 explicitly
-- did not create them). Seeding an alias requires a real canonical_id
-- pointing at a real row, and inventing a placeholder ID would violate that -
-- so role/seniority aliases are intentionally deferred to a future migration
-- once their canonical entity tables exist. This migration seeds skill
-- aliases only.
--
-- normalized_alias_text is computed as LOWER(TRIM(collapsed-whitespace)),
-- matching the exact transformation in normalizeSkills.js's toNormalizedKey()
-- and normalizeRoles.js's toKey() (both: .toLowerCase().trim().replace(/\s+/g, ' ')).
--
-- Fail-fast: the INSERT...SELECT only produces a row when its VALUES entry's
-- canonical skill actually exists (via the JOIN). The row count is checked
-- immediately after - if it doesn't match the exact count of aliases in the
-- source file (19), the migration raises an exception and the whole
-- transaction is rolled back by the migration runner, rather than silently
-- seeding a partial set.

DO $$
DECLARE
    inserted_count INTEGER;
    expected_count INTEGER := 19;
BEGIN
    INSERT INTO taxonomy_aliases (dimension, alias_text, normalized_alias_text, canonical_id, source)
    SELECT
        'skill',
        v.alias_text,
        LOWER(TRIM(REGEXP_REPLACE(v.alias_text, '\s+', ' ', 'g'))),
        s.id,
        'seed'
    FROM (VALUES
        ('lang chain',                     'langchain'),
        ('langchain',                      'langchain'),
        ('langchain framework',            'langchain'),

        ('lang graph',                     'langgraph'),
        ('langgraph',                      'langgraph'),

        ('postgres',                       'postgresql'),
        ('postgresql',                     'postgresql'),
        ('postgresql database',            'postgresql'),

        ('aws',                            'aws'),
        ('aws cloud',                      'aws'),

        ('rag',                            'rag'),
        ('retrieval augmented generation', 'rag'),
        ('retrieval-augmented generation', 'rag'),

        ('vector db',                      'vector databases'),
        ('vector database',                'vector databases'),
        ('vector databases',               'vector databases'),

        ('ci/cd',                          'ci/cd'),
        ('ci/cd pipeline',                 'ci/cd'),
        ('cicd',                           'ci/cd')
    ) AS v(alias_text, canonical_normalized_name)
    JOIN skills s ON s.normalized_name = v.canonical_normalized_name;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count != expected_count THEN
        RAISE EXCEPTION 'Expected to seed % skill aliases but inserted %. A canonical skill target is missing from the skills table - aborting so this is never silently partial.', expected_count, inserted_count;
    END IF;

    RAISE NOTICE 'Seeded % skill aliases successfully.', inserted_count;
END $$;
