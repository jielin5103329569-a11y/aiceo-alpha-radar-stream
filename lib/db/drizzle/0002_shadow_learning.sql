CREATE TABLE IF NOT EXISTS "shadow_learning_triggers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" text NOT NULL,
  "schema_version" integer NOT NULL,
  "record_hash" text NOT NULL,
  "strategy_version" text NOT NULL,
  "scan_window" text NOT NULL,
  "scan_profile" text NOT NULL,
  "model_version" text NOT NULL,
  "candidate_source" text NOT NULL,
  "signal_type" text NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "sector" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "trigger_price" double precision NOT NULL,
  "direction" text NOT NULL,
  "state" text NOT NULL,
  "shadow_score" double precision NOT NULL,
  "status" text NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "freshness_snapshot" jsonb NOT NULL,
  "input_summary" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shadow_learning_price_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "observation_key" text NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "price" double precision NOT NULL,
  "source" text NOT NULL,
  "freshness" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shadow_learning_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outcome_key" text NOT NULL,
  "trigger_id" uuid NOT NULL,
  "horizon_days" integer NOT NULL,
  "checkpoint_status" text NOT NULL,
  "target_at" timestamp with time zone NOT NULL,
  "observed_at" timestamp with time zone,
  "observed_price" double precision,
  "raw_return_percent" double precision,
  "favorable_return_percent" double precision,
  "max_drawdown_percent" double precision,
  "hit" boolean,
  "lead_time_minutes" double precision,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shadow_learning_outcomes_trigger_id_shadow_learning_triggers_id_fk'
  ) THEN
    ALTER TABLE "shadow_learning_outcomes"
    ADD CONSTRAINT "shadow_learning_outcomes_trigger_id_shadow_learning_triggers_id_fk"
    FOREIGN KEY ("trigger_id") REFERENCES "shadow_learning_triggers"("id")
    ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shadow_learning_triggers_event_key_unique" ON "shadow_learning_triggers" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_triggers_query_idx" ON "shadow_learning_triggers" USING btree ("strategy_version","signal_type","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_triggers_symbol_idx" ON "shadow_learning_triggers" USING btree ("symbol","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shadow_learning_price_observations_key_unique" ON "shadow_learning_price_observations" USING btree ("observation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_price_observations_symbol_idx" ON "shadow_learning_price_observations" USING btree ("symbol","observed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shadow_learning_outcomes_key_unique" ON "shadow_learning_outcomes" USING btree ("outcome_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_outcomes_trigger_horizon_idx" ON "shadow_learning_outcomes" USING btree ("trigger_id","horizon_days");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_outcomes_pending_idx" ON "shadow_learning_outcomes" USING btree ("checkpoint_status","target_at");