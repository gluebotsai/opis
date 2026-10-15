-- Dummy skills database schema (run against ticketing_skills)
-- Agents and skills live here; ticketing app queries this DB for assignment.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS skill_agents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'Active'
               CHECK (status IN ('Active', 'Inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES skill_agents(id) ON DELETE CASCADE,
  skill       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (agent_id, skill)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON agent_skills(skill);
