CREATE TABLE IF NOT EXISTS schema_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    filename VARCHAR(255) UNIQUE NOT NULL,

    applied_at TIMESTAMP DEFAULT NOW()
);
