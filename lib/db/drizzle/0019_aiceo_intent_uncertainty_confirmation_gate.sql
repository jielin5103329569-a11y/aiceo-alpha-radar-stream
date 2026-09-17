CREATE TABLE IF NOT EXISTS "aiceo_intent_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "confirmation_key" varchar(180) NOT NULL,
  "owner_actor_id" varchar(180) NOT NULL,
  "continuity_revision" integer NOT NULL CHECK (continuity_revision > 0),
  "owner_expression" text NOT NULL CHECK (length(btrim(owner_expression)) > 0),
  "interpreted_intent" text NOT NULL CHECK (length(btrim(interpreted_intent)) > 0),
  "action_target" text NOT NULL CHECK (length(btrim(action_target)) > 0),
  "context_hash" varchar(128) NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  "intent_hash" varchar(128) NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  "risk_level" varchar(24) NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','PROTECTED')),
  "reasonable_interpretations" jsonb NOT NULL CHECK (
    jsonb_typeof(reasonable_interpretations) = 'array'
    AND jsonb_array_length(reasonable_interpretations) >= 1
  ),
  "status" varchar(24) NOT NULL DEFAULT 'CONFIRMED' CHECK (status = 'CONFIRMED'),
  "production_authority" boolean NOT NULL DEFAULT false CHECK (production_authority = false),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, confirmation_key)
);

CREATE INDEX IF NOT EXISTS "aiceo_intent_confirmation_revision_idx"
  ON "aiceo_intent_confirmations" ("project_id", "continuity_revision", "created_at");

CREATE OR REPLACE FUNCTION reject_aiceo_intent_confirmation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Owner intent confirmation is append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS "aiceo_intent_confirmation_immutable" ON "aiceo_intent_confirmations";
CREATE TRIGGER "aiceo_intent_confirmation_immutable"
BEFORE UPDATE OR DELETE ON "aiceo_intent_confirmations"
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_intent_confirmation_mutation();