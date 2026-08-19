CREATE TABLE IF NOT EXISTS "radar_signal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"record_hash" text NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"from_state" text NOT NULL,
	"state" text NOT NULL,
	"confirmation_status" text NOT NULL,
	"signal_type" text NOT NULL,
	"direction" text NOT NULL,
	"trigger_price" double precision NOT NULL,
	"alpha_score" double precision,
	"signal_score" double precision,
	"confidence" double precision NOT NULL,
	"volume_value" double precision,
	"volume_score" double precision,
	"velocity_30s" double precision,
	"velocity_60s" double precision,
	"momentum_acceleration" double precision,
	"volume_acceleration" double precision,
	"order_flow_shift" double precision,
	"spread_tightening" double precision,
	"sector" text,
	"sector_confirmation" text NOT NULL,
	"sector_confirmation_reason" text NOT NULL,
	"evidence_count" integer NOT NULL,
	"evidence_summary" jsonb NOT NULL,
	"satisfied_evidence" jsonb NOT NULL,
	"missing_evidence" jsonb NOT NULL,
	"data_fresh" boolean NOT NULL,
	"freshness" jsonb NOT NULL,
	"source" text NOT NULL,
	"catalyst_status" text DEFAULT 'unavailable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radar_signal_outcome_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outcome_key" text NOT NULL,
	"signal_id" uuid NOT NULL,
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
CREATE TABLE IF NOT EXISTS "radar_signal_price_observations" (
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
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'radar_signal_outcome_events_signal_id_radar_signal_events_id_fk'
 ) THEN
  ALTER TABLE "radar_signal_outcome_events"
  ADD CONSTRAINT "radar_signal_outcome_events_signal_id_radar_signal_events_id_fk"
  FOREIGN KEY ("signal_id") REFERENCES "radar_signal_events"("id")
  ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radar_signal_events_event_key_unique" ON "radar_signal_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_signal_events_symbol_occurred_idx" ON "radar_signal_events" USING btree ("symbol","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_signal_events_state_occurred_idx" ON "radar_signal_events" USING btree ("state","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radar_signal_outcome_events_key_unique" ON "radar_signal_outcome_events" USING btree ("outcome_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_signal_outcomes_signal_horizon_idx" ON "radar_signal_outcome_events" USING btree ("signal_id","horizon_days");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_signal_outcomes_pending_target_idx" ON "radar_signal_outcome_events" USING btree ("checkpoint_status","target_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radar_signal_price_observations_key_unique" ON "radar_signal_price_observations" USING btree ("observation_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_signal_price_symbol_observed_idx" ON "radar_signal_price_observations" USING btree ("symbol","observed_at");