# LADDER_CHECK 2026-10-24_0300PT

pack: 2026-10-24_0300PT
status: FROZEN

| well_id | mark | visual_node_hit | company_pattern_hit | issuer_event | catalyst_public_at | status_if_hit | catalyst_force | preference | not_a_buy |
|---------|------|-----------------|----------------------|--------------|--------------------|---------------|----------------|------------|-----------|
| WELL-AMKR-ADV-PKG | NONE | false | false | false | — | — | none | maintain | true |
| WELL-INP-NPO | NONE | false | false | false | — | — | none | maintain | true |
| WELL-VICR-VPD | NONE | false | false | false | — | — | none | maintain | true |
| WELL-POWER-GRID | HIT | true | true（TLN仅为运行旁支） | false | 2026-10-23（具体时刻UNKNOWN） | reality-confirmed / issuer economics UNKNOWN | medium | high-watch | true |
| WELL-ALIS-DEMAND | NONE | false | false | false | — | — | none | maintain | true |
| WELL-AMCI-OBS | NONE | false | false | false | — | — | none | research-only | true |
| WELL-POWER-PATH-COMP | NONE | false | false | false | — | — | none | maintain | true |
| WELL-POWER-COST-INT | NONE | false | false | false | — | — | none | maintain | true |

## 判定
- 仅WELL-POWER-GRID取得现实节点HIT。
- 公司盈利映射、监管批准及实际运行均未闭环，不升级为正式投资信号。
- 其余井均NONE。

not_a_buy: true for all
票池无动作。