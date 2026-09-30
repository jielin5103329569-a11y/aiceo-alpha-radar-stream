# LADDER_CHECK 2026-09-30_0300PT

source_pack: EXTERNAL_EYES/PACKS/2026-09-30_0300PT.md
ladder_check_present: yes
not_a_buy: yes

新HIT（本包日期）: 无
既有HIT继续有效: WELL-VICR-VPD（catalyst_public_at=2026-09-17，禁止伪装成9/30新催化）

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
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: HOLD
  catalyst_force: 1
  preference: 主盯
  not_a_buy: yes

- well_id: WELL-VICR-VPD
  mark: HIT
  visual_node_hit: yes
  company_pattern_hit: yes
  issuer_event: Vicor官方VPD非独家许可允许leading AI OEM从第三方global suppliers采购受Vicor专利覆盖的VPD modules
  catalyst_public_at: 2026-09-17
  status_if_hit: catalyst-watch
  catalyst_force: 8
  preference: 主盯
  not_a_buy: yes

- well_id: WELL-POWER-GRID
  mark: NONE
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: reality-confirmed
  catalyst_force: 5
  preference: 主盯
  not_a_buy: yes

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
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 1
  preference: 主盯
  not_a_buy: yes

- well_id: WELL-POWER-COST-INT
  mark: NONE
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 4
  preference: 主盯
  not_a_buy: yes

说明：POWER-GRID visual_node_hit=yes 但 mark=NONE（无issuer event，无清洁美股表达）。POWER-COST-INT 同样 visual_node 确认、缺绑定资费/批准，不升级。
