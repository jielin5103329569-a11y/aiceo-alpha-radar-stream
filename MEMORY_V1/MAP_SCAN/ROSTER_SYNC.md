# MAP_SCAN ROSTER_SYNC
Purpose: External hourly judgment ↔ internal repo library. Not live-5. Not buy. Not 8080. Not WELLS.yaml mutation.
Updated: 2026-09-23 20:02 PT

## Roster
NRGV | HOLD | gate=hyperscaler/site/$/commissioning | last_print=2G 275MW 2026-09-23
COHR | HOLD | gate=permit/independent 6in yield/PhotonLink revenue | last_print=PhotonLink 2026-09-21
SEI | HOLD | gate=notes close 2026-10-01 | last_print=pricing 8-K 2026-09-22
FRMI | HOLD | gate=project finance close
NUAI | HOLD | gate=collateral/financing burden lift
HOST | HOLD | gate=float/financing transition
ULS | HOLD | gate=2nd UL2140 OEM or hyperscaler spec
ONEN | HOLD | gate=DEVELOPMENT	o CONTRACTED/FUNDED | last_print=BCA close 2026-09-23

## Sync rules
- Eyes new B/NAMED/CONTROLS US ticker → append same hour
- Internal WELLS.yaml listed US shell that already maps a watched node → keep on roster if present in Eyes maps; do not mint from well-only names
- Hourly job overwrites this file with latest judgment
- WELLS.yaml status fields stay Owner/internal; this file does not flip well STAGE to buy
