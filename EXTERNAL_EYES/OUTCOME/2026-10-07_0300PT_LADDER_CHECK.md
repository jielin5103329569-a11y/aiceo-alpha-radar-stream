# LADDER_CHECK 2026-10-07_0300PT
pack_integrity: FULL
not_a_buy: yes
productionAuthority: false

- well_id: WELL-AMKR-ADV-PKG
  mark: NONE
  issuer_event: none
  status_if_hit: unchanged
  not_a_buy: yes
- well_id: WELL-INP-NPO
  mark: NONE
  issuer_event: none; no new permit or six-inch yield break
  status_if_hit: HOLD
  not_a_buy: yes
- well_id: WELL-VICR-VPD
  mark: NONE
  issuer_event: none
  status_if_hit: late-vs-reprice
  not_a_buy: yes
- well_id: WELL-POWER-GRID
  mark: HIT
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: Google and Constellation 890MW nuclear uprate in PJM plus 2,700MW 15-year supply. Amazon 190MW is prior, not restamped.
  catalyst_public_at: 2026-10-06 03:30 PT
  status_if_hit: reality-confirmed
  not_a_buy: yes
- well_id: WELL-ALIS-DEMAND
  mark: NONE
  issuer_event: none
  not_a_buy: yes
- well_id: WELL-AMCI-OBS
  mark: NONE
  issuer_event: none
  not_a_buy: yes
- well_id: WELL-POWER-PATH-COMP
  mark: NONE
  issuer_event: none; uprate is another time-to-power path, not a persistent equipment node
  not_a_buy: yes
- well_id: WELL-POWER-COST-INT
  mark: NONE
  issuer_event: private funding example, no new binding PJM/FERC regime
  not_a_buy: yes

NAMED: none
CEG: control only, not shell, not pool
stage_change: none
pool_change: none
