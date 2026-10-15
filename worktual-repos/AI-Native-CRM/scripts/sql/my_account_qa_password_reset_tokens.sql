-- Password reset tokens for public.users (my_account_qa).
-- Apply: psql "$ACCOUNT_DATABASE_URL" -f scripts/sql/my_account_qa_password_reset_tokens.sql

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON public.password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
  ON public.password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON public.password_reset_tokens (expires_at);
