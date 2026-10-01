# LADDER_CHECK — 2026-10-01 03:00 PT
pack: EXTERNAL_EYES/PACKS/2026-10-01_0300PT.md
source: pack LADDER_CHECK verbatim marks
not_a_buy: yes
pool_change: none

- well_id: WELL-AMKR-ADV-PKG
  mark: NONE
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 2
  preference: 观察
  not_a_buy: yes
  note: IMAPS 技术材料强化 warpage/thermal，不是新 customer prepay。禁止重造 HIT。

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
  issuer_event: Vicor官方2026-09-17确认向leading AI OEM授予VPD非独家许可
  catalyst_public_at: 2026-09-17
  status_if_hit: catalyst-watch
  catalyst_force: 8
  preference: 主盯
  not_a_buy: yes
  note: EXISTING_LADDER_HIT / NOT_NEW_SIGNAL。不重包成 10/01 新催化。

- well_id: WELL-POWER-GRID
  mark: HIT
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: PJM官方确认2026-07-22近4,000MW北弗吉尼亚数据中心负荷意外脱网后提出针对computational Large Loads的interconnection reliability requirement调整
  catalyst_public_at: 2026-09-10
  status_if_hit: reality-confirmed
  catalyst_force: 7
  preference: 主盯
  not_a_buy: yes
  note: NO CLEAN U.S. EXPRESSION。

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
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 4
  preference: 主盯
  not_a_buy: yes
  note: 800VDC 方向已有旧官方支撑；缺 production MW + BOM deletion + rent owner。

- well_id: WELL-POWER-COST-INT
  mark: NONE
  visual_node_hit: yes
  company_pattern_hit: no
  issuer_event: none
  catalyst_public_at: UNKNOWN
  status_if_hit: unchanged
  catalyst_force: 3
  preference: 主盯
  not_a_buy: yes
  note: 无新 binding cost-allocation regime。
