# LADDER_CHECK copy 2026-09-24_00h_B PT
Copied from pack body. not_a_buy: yes
B-section none forced. No NAMED ≠ HIT.

- well_id: WELL-AMKR-ADV-PKG
  mark: NONE
- well_id: WELL-INP-NPO
  mark: NONE
  status_if_hit: HOLD
- well_id: WELL-VICR-VPD
  mark: LATE
  ticker: VICR
  catalyst_public_at: 2026-09-16
  status_if_hit: late-vs-reprice
  note: regression baseline only; no reopen
- well_id: WELL-POWER-GRID
  mark: HIT
  ticker: none
  catalyst_public_at: 2026-09-21
  status_if_hit: reality-confirmed
  url: https://gov.texas.gov/uploads/files/press/TCEQ_Data_Center.pdf
  note: parent visual. TCEQ permit halt until ERCOT audit. No clean US shell this stamp.
- well_id: WELL-ALIS-DEMAND
  mark: NONE
- well_id: WELL-AMCI-OBS
  mark: NONE
- well_id: WELL-POWER-PATH-COMP
  mark: NONE
- well_id: WELL-POWER-COST-INT
  mark: HIT
  ticker: none
  catalyst_public_at: 2026-09-21
  status_if_hit: reality-confirmed
  url: https://www.gov.ca.gov/2026/09/21/governor-newsom-signs-most-comprehensive-data-center-laws-in-the-nation-providing-communities-more-control-on-water-electricity-and-land-use/
  note: parent visual. CA seven laws signed; large-load pays grid-upgrade. Tariff/$ per MW UNKNOWN. No clean US shell this stamp.

ACCEPT: parent HIT only. No VICR-class pre-px1 push on a shelled well. not_a_buy.
