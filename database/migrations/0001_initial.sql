CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rewrite_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  tone TEXT NOT NULL,
  strength INTEGER NOT NULL CHECK (strength >= 0 AND strength <= 100),
  provider TEXT NOT NULL,
  original_text TEXT NOT NULL,
  rewritten_text TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rewrite_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rewrite_session_id UUID NOT NULL REFERENCES rewrite_sessions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rewrite_session_id, version_number)
);

CREATE TABLE rewrite_sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rewrite_session_id UUID NOT NULL REFERENCES rewrite_sessions(id) ON DELETE CASCADE,
  sentence_index INTEGER NOT NULL,
  original_text TEXT NOT NULL,
  rewritten_text TEXT NOT NULL,
  change_ratio NUMERIC(5, 4) NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (rewrite_session_id, sentence_index)
);

CREATE TABLE presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  tone TEXT NOT NULL,
  strength INTEGER NOT NULL CHECK (strength >= 0 AND strength <= 100),
  meaning_lock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rewrite_session_id UUID REFERENCES rewrite_sessions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rewrite_session_id UUID NOT NULL REFERENCES rewrite_sessions(id) ON DELETE CASCADE,
  meaning_score NUMERIC(5, 4) NOT NULL,
  confidence_score NUMERIC(5, 4) NOT NULL,
  facts_preserved BOOLEAN NOT NULL,
  citations_preserved BOOLEAN NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_preview TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_workspace_created ON documents(workspace_id, created_at DESC);
CREATE INDEX idx_rewrite_sessions_workspace_created ON rewrite_sessions(workspace_id, created_at DESC);
CREATE INDEX idx_rewrite_sessions_user_created ON rewrite_sessions(user_id, created_at DESC);
CREATE INDEX idx_rewrite_versions_session_number ON rewrite_versions(rewrite_session_id, version_number DESC);
CREATE INDEX idx_rewrite_sentences_session_index ON rewrite_sentences(rewrite_session_id, sentence_index);
CREATE INDEX idx_presets_workspace ON presets(workspace_id, name);
CREATE INDEX idx_ai_requests_created ON ai_requests(created_at DESC);
CREATE INDEX idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_usage_events_workspace_created ON usage_events(workspace_id, created_at DESC);
