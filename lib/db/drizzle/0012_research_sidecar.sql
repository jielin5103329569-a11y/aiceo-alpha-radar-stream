CREATE TABLE "research_observation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"record_hash" text NOT NULL,
	"source_lane" text NOT NULL,
	"source" text NOT NULL,
	"research_only_label" text NOT NULL,
	"ticker" text,
	"ticker_identity" jsonb NOT NULL,
	"ticker_identity_state" text NOT NULL,
	"us_ticker_admission" text NOT NULL,
	"us_ticker_identity_evidence" text NOT NULL,
	"viewpoint" text NOT NULL,
	"thesis" text NOT NULL,
	"valuation_reversal_basis" text NOT NULL,
	"financials" text NOT NULL,
	"buybacks" text NOT NULL,
	"cash_balance_sheet" text NOT NULL,
	"catalysts" text NOT NULL,
	"risks" text NOT NULL,
	"outcomes" text NOT NULL,
	"industry_chain_tags" jsonb NOT NULL,
	"canonical_industry_chain_key" text NOT NULL,
	"observed_date" text NOT NULL,
	"confidence" text NOT NULL,
	"source_reference" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_resonance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resonance_key" text NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"record_hash" text NOT NULL,
	"left_observation_id" uuid NOT NULL,
	"right_observation_id" uuid NOT NULL,
	"source_lanes" jsonb NOT NULL,
	"resonance_basis" text NOT NULL,
	"admitted_us_ticker" text,
	"canonical_industry_chain_key" text,
	"derived_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_observation_events_event_key_unique" ON "research_observation_events" USING btree ("event_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_observation_events_record_hash_unique" ON "research_observation_events" USING btree ("record_hash");
--> statement-breakpoint
CREATE INDEX "research_observation_events_lane_observed_idx" ON "research_observation_events" USING btree ("source_lane","observed_date");
--> statement-breakpoint
CREATE INDEX "research_observation_events_ticker_idx" ON "research_observation_events" USING btree ("ticker","ticker_identity_state");
--> statement-breakpoint
CREATE INDEX "research_observation_events_chain_idx" ON "research_observation_events" USING btree ("canonical_industry_chain_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_resonance_key_unique" ON "research_resonance" USING btree ("resonance_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_resonance_hash_unique" ON "research_resonance" USING btree ("record_hash");
--> statement-breakpoint
CREATE INDEX "research_resonance_derived_at_idx" ON "research_resonance" USING btree ("derived_at");
--> statement-breakpoint
CREATE INDEX "research_resonance_basis_idx" ON "research_resonance" USING btree ("resonance_basis");
--> statement-breakpoint
-- Alex/Moonvest seed: research-only observations, not production market evidence.
-- Seed record_hash values are SHA-256 of the implementation's
-- canonicalResearchObservationEnvelope(normalized input).
INSERT INTO "research_observation_events" (
	"id", "event_key", "record_version", "record_hash", "source_lane", "source",
"research_only_label", "ticker", "ticker_identity", "ticker_identity_state", "us_ticker_admission",
	"us_ticker_identity_evidence", "viewpoint", "thesis", "valuation_reversal_basis",
	"financials", "buybacks", "cash_balance_sheet", "catalysts", "risks", "outcomes",
	"industry_chain_tags", "canonical_industry_chain_key", "observed_date", "confidence",
	"source_reference", "evidence"
) VALUES
(
	'8bb7c4b7-1f9f-4c18-9a64-1f0c0ab00001',
'research:b5db89d7e4b76d50445b97abf142f1f398a9154f3f5162e43b517151d1d8a953',
	1,
'8ceca65acd465a1bd799583b39605b53dceea2611ef20b6eacdd1063d1508868',
	'alex_moonvest',
	'Alex/Moonvest',
	'research_only_alex_moonvest_observation',
	'CHA',
'{"exchange":"unavailable","lifecycleStatus":"delisted","securityType":"adr","identitySourceReference":"https://www.cnbc.com/2021/01/06/nyse-will-delist-three-big-china-telecoms-reversing-decision-once-again.html","verificationAccessDate":"2026-09-13"}',
	'overseas_reference',
	'not_admitted',
	'Former US ADR is delisted; no current active US common-equity identity was admitted.',
	'Alex/Moonvest viewpoint unavailable beyond the user-provided observation.',
	'Unavailable: the source conversation does not provide a complete thesis.',
	'Unavailable: no defensible valuation or reversal basis was supplied.',
	'Unavailable: financial figures were not supplied.',
	'Unavailable: buyback evidence was not supplied.',
	'Unavailable: cash and balance-sheet evidence was not supplied.',
	'Unavailable: catalyst evidence was not supplied.',
	'Unavailable: risk evidence was not supplied.',
	'Unavailable: outcome evidence was not supplied.',
'["unavailable"]',
'unavailable',
'2026-09-13',
'unavailable',
'https://www.cnbc.com/2021/01/06/nyse-will-delist-three-big-china-telecoms-reversing-decision-once-again.html',
'{"listing_treatment":"overseas_reference","adr_status":"former US ADR delisted","source_provenance":"user_conversation","research_only":true,"identity_source":"https://www.cnbc.com/2021/01/06/nyse-will-delist-three-big-china-telecoms-reversing-decision-once-again.html","verification_access_date":"2026-09-13"}'
)
ON CONFLICT ("event_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "research_observation_events" (
	"id", "event_key", "record_version", "record_hash", "source_lane", "source",
"research_only_label", "ticker", "ticker_identity", "ticker_identity_state", "us_ticker_admission",
	"us_ticker_identity_evidence", "viewpoint", "thesis", "valuation_reversal_basis",
	"financials", "buybacks", "cash_balance_sheet", "catalysts", "risks", "outcomes",
	"industry_chain_tags", "canonical_industry_chain_key", "observed_date", "confidence",
	"source_reference", "evidence"
) VALUES
(
	'8bb7c4b7-1f9f-4c18-9a64-1f0c0ab00002',
'research:d89004f7c37dc0d27cdd02fd612cd2f1945858562f11902636becb01326227fd',
	1,
'ddfbc346b21c9a262b959002cf344f9c9156ed138651648b7d0631d0d96c97e2',
	'alex_moonvest',
	'Alex/Moonvest',
	'research_only_alex_moonvest_observation',
	'ODD',
'{"exchange":"NASDAQ","lifecycleStatus":"active","securityType":"class_a_ordinary_share","identitySourceReference":"https://www.nasdaq.com/market-activity/stocks/odd","verificationAccessDate":"2026-09-13"}',
	'us_watch',
	'admitted',
'Active NASDAQ class_a_ordinary_share identity verified from https://www.nasdaq.com/market-activity/stocks/odd.',
	'Alex/Moonvest viewpoint unavailable beyond the user-provided observation.',
	'Unavailable: the source conversation does not provide a complete thesis.',
	'Unavailable: no defensible valuation or reversal basis was supplied.',
	'Unavailable: financial figures were not supplied.',
	'Unavailable: buyback evidence was not supplied.',
	'Unavailable: cash and balance-sheet evidence was not supplied.',
	'Unavailable: catalyst evidence was not supplied.',
	'Unavailable: risk evidence was not supplied.',
	'Unavailable: outcome evidence was not supplied.',
'["unavailable"]',
'unavailable',
'2026-09-13',
'unavailable',
'https://www.nasdaq.com/market-activity/stocks/odd',
'{"listing_treatment":"us_watch","active":true,"source_provenance":"user_conversation","exchange":"NASDAQ","security_type":"Class A ordinary shares","identity_source":"https://www.nasdaq.com/market-activity/stocks/odd","verification_access_date":"2026-09-13","research_only":true}'
)
ON CONFLICT ("event_key") DO NOTHING;
--> statement-breakpoint
-- Resonance rows are derived only when independent observations arrive in both lanes.
-- No resonance is seeded from a single Alex/Moonvest lane.
CREATE OR REPLACE FUNCTION research_sidecar_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Research sidecar evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER research_observation_events_append_only
BEFORE UPDATE OR DELETE ON "research_observation_events"
FOR EACH ROW EXECUTE FUNCTION research_sidecar_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER research_resonance_append_only
BEFORE UPDATE OR DELETE ON "research_resonance"
FOR EACH ROW EXECUTE FUNCTION research_sidecar_reject_mutation();