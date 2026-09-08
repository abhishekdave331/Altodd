CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    external_job_id VARCHAR(100) UNIQUE NOT NULL,

    title TEXT NOT NULL,
    company TEXT,

    location TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),

    employment_type VARCHAR(50),
    job_function TEXT,
    industry TEXT,

    applicants INTEGER,

    posted_at TIMESTAMP,
    job_url TEXT,

    first_seen_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    analysis_version VARCHAR(30) DEFAULT 'v1',

    analysis JSONB NOT NULL,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(job_id, analysis_version)
);

CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(150) NOT NULL UNIQUE,

    normalized_name VARCHAR(150) NOT NULL UNIQUE,

    category VARCHAR(100),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_skills (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,

    skill_id UUID REFERENCES skills(id),

    category VARCHAR(100),

    priority VARCHAR(30),

    PRIMARY KEY(job_id, skill_id)
);

CREATE TABLE IF NOT EXISTS capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL UNIQUE,

    normalized_name TEXT NOT NULL UNIQUE,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_capabilities (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,

    capability_id UUID REFERENCES capabilities(id),

    PRIMARY KEY(job_id, capability_id)
);

CREATE TABLE IF NOT EXISTS job_roles (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,

    advertised_role VARCHAR(150),

    actual_role VARCHAR(150),

    seniority VARCHAR(50),

    minimum_experience NUMERIC,

    maximum_experience NUMERIC
);

CREATE TABLE IF NOT EXISTS job_attributes (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,

    production_systems BOOLEAN,
    scalability BOOLEAN,
    reliability BOOLEAN,

    cloud BOOLEAN,
    containerization BOOLEAN,
    deployment BOOLEAN,
    monitoring BOOLEAN,
    observability BOOLEAN,
    cicd BOOLEAN,

    backend_development BOOLEAN,
    api_development BOOLEAN,
    system_design BOOLEAN,
    clean_architecture BOOLEAN,

    testing BOOLEAN,
    code_quality BOOLEAN,

    domain_expertise_required BOOLEAN
);

CREATE TABLE IF NOT EXISTS job_ai_lifecycle (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,

    data_ingestion BOOLEAN,
    data_processing BOOLEAN,
    model_development BOOLEAN,

    rag_pipeline BOOLEAN,
    agent_development BOOLEAN,

    evaluation BOOLEAN,
    deployment BOOLEAN,
    monitoring BOOLEAN
);

CREATE TABLE IF NOT EXISTS daily_market_metrics (
    metric_date DATE PRIMARY KEY,

    total_jobs INTEGER,

    unique_companies INTEGER,

    average_applicants NUMERIC,

    market_health_score NUMERIC,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_skill_metrics (
    metric_date DATE NOT NULL,

    skill_id UUID REFERENCES skills(id),

    job_count INTEGER NOT NULL,

    demand_percentage NUMERIC,

    critical_count INTEGER DEFAULT 0,

    important_count INTEGER DEFAULT 0,

    preferred_count INTEGER DEFAULT 0,

    PRIMARY KEY(metric_date, skill_id)
);

CREATE TABLE IF NOT EXISTS daily_role_metrics (
    metric_date DATE NOT NULL,

    role VARCHAR(150),

    job_count INTEGER,

    demand_percentage NUMERIC,

    PRIMARY KEY(metric_date, role)
);

CREATE TABLE IF NOT EXISTS daily_capability_metrics (
    metric_date DATE NOT NULL,

    capability_id UUID REFERENCES capabilities(id),

    job_count INTEGER,

    demand_percentage NUMERIC,

    PRIMARY KEY(metric_date, capability_id)
);

CREATE TABLE IF NOT EXISTS daily_seniority_metrics (
    metric_date DATE NOT NULL,

    seniority VARCHAR(50),

    job_count INTEGER,

    demand_percentage NUMERIC,

    PRIMARY KEY(metric_date, seniority)
);

CREATE TABLE IF NOT EXISTS daily_location_metrics (
    metric_date DATE NOT NULL,

    city VARCHAR(100),

    job_count INTEGER,

    demand_percentage NUMERIC,

    PRIMARY KEY(metric_date, city)
);

CREATE TABLE IF NOT EXISTS daily_industry_metrics (
    metric_date DATE NOT NULL,

    industry TEXT,

    job_count INTEGER,

    demand_percentage NUMERIC,

    PRIMARY KEY(metric_date, industry)
);
