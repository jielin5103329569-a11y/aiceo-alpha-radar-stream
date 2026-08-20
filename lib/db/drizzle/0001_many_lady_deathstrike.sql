CREATE TABLE "alert_delivery_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_record_id" uuid,
	"user_id" text NOT NULL,
	"push_subscription_id" uuid,
	"channel" varchar(30) NOT NULL,
	"outcome" varchar(40) NOT NULL,
	"provider_status_code" integer,
	"error_detail" text,
	"latency_ms" integer,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"trigger_reason" varchar(60) NOT NULL,
	"detection_state" varchar(40) NOT NULL,
	"confirmation_status" varchar(40) NOT NULL,
	"alpha_score" text NOT NULL,
	"alpha_velocity_30s" text,
	"confidence" integer NOT NULL,
	"trigger_price" text,
	"pre_breakout_state" varchar(40) NOT NULL,
	"satisfied_evidence" jsonb NOT NULL,
	"missing_evidence" jsonb NOT NULL,
	"transition_at" timestamp with time zone NOT NULL,
	"gate_snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_user_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"alert_record_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"channel_preferences" jsonb DEFAULT '{"webPush":true,"inApp":true,"minimumSeverity":"watch","quietHoursStart":null,"quietHoursEnd":null,"timezone":null}'::jsonb NOT NULL,
	"global_opt_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_label" varchar(120),
	"subscription_payload" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"snoozed" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"opted_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_delivery_audit" ADD CONSTRAINT "alert_delivery_audit_alert_record_id_alert_records_id_fk" FOREIGN KEY ("alert_record_id") REFERENCES "public"."alert_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_user_receipts" ADD CONSTRAINT "alert_user_receipts_alert_record_id_alert_records_id_fk" FOREIGN KEY ("alert_record_id") REFERENCES "public"."alert_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_delivery_audit_record_id_idx" ON "alert_delivery_audit" USING btree ("alert_record_id");--> statement-breakpoint
CREATE INDEX "alert_delivery_audit_user_id_idx" ON "alert_delivery_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_delivery_audit_attempted_idx" ON "alert_delivery_audit" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "alert_delivery_audit_outcome_idx" ON "alert_delivery_audit" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "alert_delivery_audit_record_user_idx" ON "alert_delivery_audit" USING btree ("alert_record_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_records_event_key_unique" ON "alert_records" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "alert_records_symbol_generated_idx" ON "alert_records" USING btree ("symbol","generated_at");--> statement-breakpoint
CREATE INDEX "alert_records_severity_generated_idx" ON "alert_records" USING btree ("severity","generated_at");--> statement-breakpoint
CREATE INDEX "alert_records_symbol_severity_idx" ON "alert_records" USING btree ("symbol","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_user_receipts_user_alert_unique" ON "alert_user_receipts" USING btree ("user_id","alert_record_id");--> statement-breakpoint
CREATE INDEX "alert_user_receipts_user_id_idx" ON "alert_user_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_user_receipts_alert_record_id_idx" ON "alert_user_receipts" USING btree ("alert_record_id");--> statement-breakpoint
CREATE INDEX "alert_user_receipts_read_at_idx" ON "alert_user_receipts" USING btree ("read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_user_id_unique" ON "notification_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_active_idx" ON "push_subscriptions" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_active_idx" ON "push_subscriptions" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_alert_state_user_symbol_unique" ON "user_alert_state" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "user_alert_state_user_id_idx" ON "user_alert_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_alert_state_symbol_idx" ON "user_alert_state" USING btree ("symbol");