# Real verified alert: multi-user acceptance

## Status

**Pending / unverified.** Run this only after the normal production monitor has
persisted a new `alert_records` row from real Databento market data. Do not
insert a fixture, replay a signal, or bypass the market-data gate to satisfy
this checklist.

## Preconditions

1. The protected symbol's feed is `streaming`, fresh, and has both required
   live streams receiving.
2. The candidate has passed every production alert gate, including an actual
   market event, event-triggered scan, valid score, eligible core components,
   fresh pre-breakout data, verified subscription, and a real state
   transition.
3. A new immutable `alert_records` row exists. Record its `id`, `event_key`,
   `transition_at`, and `gate_snapshot` before beginning account actions.
4. Use two independently signed-in Clerk users, A and B. Do not reveal either
   user's Clerk ID in test evidence.

## Acceptance checks

### Immutable production record and delivery audit

- Confirm the record's captured event identity and gate snapshot are present
  and unchanged after every receipt action.
- Query `alert_delivery_audit` by `alert_record_id`. Confirm every delivery
  outcome is truthful: delivered, skipped, or failed. A missing VAPID
  configuration must remain `skipped_no_vapid`, not delivered.
- Confirm no delivery audit or receipt failure blocked persistence of the real
  `alert_records` row.

### Account A

1. In A's browser, refresh Personal Alerts and locate the real record by its
   immutable ID/event key.
2. Verify the initial `readAt` and `acknowledgedAt` are null for A, then use
   **Mark read** and wait for the UI's refresh indicator to settle.
3. Confirm the API returns 204, A's next `GET /api/alerts` returns A's
   `readAt`, and the UI changes to the read/acknowledge state.
4. Acknowledge it. Confirm the API returns 204, A's API response contains both
   timestamps, and the UI displays the acknowledged state.

### Account B isolation

1. In a separate browser/session, refresh Personal Alerts for B.
2. The same global verified event may be listed, but B must see null receipt
   timestamps until B takes an action for B's own receipt.
3. Submit read/acknowledge requests containing A's identifier or an invented
   receipt identifier. The server must use B's authenticated Clerk identity,
   never alter A's receipt, and never disclose A's timestamps.
4. Re-fetch as A and B. Each response must contain only the caller's receipt
   state. Database receipts must remain one row per `(user_id, alert_record_id)`.

### Negative paths

- Unauthenticated list/settings/read/acknowledge requests return 401.
- Malformed alert IDs return 400.
- A valid UUID that is not an `alert_records` ID returns 404 and writes no
  receipt.
- If an action or refetch fails, Personal Alerts shows an account-action error
  instead of silently leaving the user unsure of the result.

## Completion evidence

Capture the record ID/event key privately in the test log, API status codes,
per-account response snapshots with Clerk IDs redacted, receipt row counts,
delivery-audit outcomes, and before/after UI screenshots. Leave this checklist
pending until all checks use one genuine production record.