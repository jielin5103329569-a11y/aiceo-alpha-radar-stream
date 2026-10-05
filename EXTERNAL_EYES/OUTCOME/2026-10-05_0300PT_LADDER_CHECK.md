# LADDER_CHECK — 2026-10-05 03:00 PT
pack: EXTERNAL_EYES/PACKS/2026-10-05_0300PT.md
frozen: yes
new_hit_miss: yes
hit_well: WELL-POWER-GRID
pool_change: none
not_a_buy: yes

判定：仅 WELL-POWER-GRID = HIT。禁止把 9/30 FERC、10/01 MEC、此前 EFXT / APLD / NRGV / LS Electric 重造成今日 HIT。

- WELL-AMKR-ADV-PKG: NONE / no issuer event / unchanged / force 1 / 观察 / not_a_buy
- WELL-INP-NPO: NONE / no permit or six-inch yield break / HOLD / force 2 / 主盯 / not_a_buy
- WELL-VICR-VPD: NONE / no new issuer fundamental event / late-vs-reprice / force 1 / 主盯 / not_a_buy
- WELL-POWER-GRID: HIT / visual_node_hit yes / company_pattern_hit no / Wärtsilä 282MW U.S. data-center onsite order, 15×50SG, seventh U.S. data-center order, cumulative sold >3GW / catalyst_public_at 2026-10-05 02:00 PT / reality-confirmed / force 8 / 主盯 / not_a_buy
- WELL-ALIS-DEMAND: NONE / unchanged / force 1 / 观察 / not_a_buy
- WELL-AMCI-OBS: NONE / unchanged / force 1 / 低 / not_a_buy
- WELL-POWER-PATH-COMP: NONE / no 800VDC deployment + deleted BOM + persistent rent owner / unchanged / force 5 / 主盯 / not_a_buy
- WELL-POWER-COST-INT: NONE / prior FERC/PJM predates pack, no architecture reaction + hard contract / unchanged / force 5 / 主盯 / not_a_buy

CONTROLS
- ticker: none / same_chain yes / state_at_t0 NO_CLEAN_US / reason_at_t0 NO_CLEAN_US
- Wärtsilä: reality owner / Nasdaq Helsinki / 不 NAMED / 不入池
- MEC: 10/01 早于本包 / 不重造 / 不入池
- EFXT / APLD / NRGV: 前包已处理 / 不重造
- LS Electric: 历史 switchgear 对照 / 非美国上市 clean shell / 不重造

NAMED: 无
EARLY/SAME_DAY: 无（无点名，无时分可标）
THEN_KNOWN: 仅包链原文；本包未给美国上市点名
acceptance: t_push before t_px1 / 无美股壳，无买点
