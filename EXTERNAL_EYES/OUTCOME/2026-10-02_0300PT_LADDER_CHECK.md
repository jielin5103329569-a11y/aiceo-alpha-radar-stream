# LADDER_CHECK — 2026-10-02 03:00 PT
pack: EXTERNAL_EYES/PACKS/2026-10-02_0300PT.md
source: pack LADDER_CHECK verbatim marks
not_a_buy: yes
pool_change: none

- well_id: WELL-AMKR-ADV-PKG
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 1
  preference: 观察
  not_a_buy: yes

- well_id: WELL-INP-NPO
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none; no new verified export-permit or 6-inch-yield break found in this scan
  catalyst_public_at: UNKNOWN
  status_if_hit: HOLD
  catalyst_force: 1
  preference: 观察
  not_a_buy: yes

- well_id: WELL-VICR-VPD
  mark: LATE
  visual_node_hit: yes
  company_pattern_hit: yes
  issuer_event: Vicor raised Q3 sequential revenue-growth guidance from >20% to >30% on 2026-09-30 because royalties from the previously announced non-exclusive VPD license were higher than previously expected.
  catalyst_public_at: 2026-09-30 13:00 PT
  status_if_hit: late-vs-reprice
  catalyst_force: 8
  preference: 主盯
  not_a_buy: yes
  note: 旧链兑现。禁止重包成 10/02 新发现。

- well_id: WELL-POWER-GRID
  mark: HIT
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: Enerflex disclosed a binding approximately 450MW behind-the-meter natural-gas power-generation equipment award for a North American data-center developer, with deliveries scheduled for 2027-2028.
  catalyst_public_at: 2026-10-01 03:00 PT
  status_if_hit: reality-confirmed
  catalyst_force: 8
  preference: 主盯
  not_a_buy: yes
  note: EFXT NAMED / LATE_VS_8K / NO CLEAN U.S. EXPRESSION。不是 must-pass 壳。

- well_id: WELL-ALIS-DEMAND
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 1
  preference: 观察
  not_a_buy: yes

- well_id: WELL-AMCI-OBS
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 1
  preference: 低
  not_a_buy: yes

- well_id: WELL-POWER-PATH-COMP
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none; Enerflex behind-the-meter generation compresses Time-to-Power but does not establish the required hyperscaler 800VDC deployment / deleted-BOM / rent-owner evidence
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 4
  preference: 主盯
  not_a_buy: yes

- well_id: WELL-POWER-COST-INT
  mark: NONE
  visual_node_hit: no
  company_pattern_hit: no
  issuer_event: none; the 450MW behind-the-meter award shows architecture reaction to grid constraints but does not establish a binding cost-allocation regime
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 4
  preference: 主盯
  not_a_buy: yes
