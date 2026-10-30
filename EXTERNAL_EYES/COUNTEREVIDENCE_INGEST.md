# 每日反证包资料入库

生效：2026-10-30，Owner 直接指定 GPT/Bro 接收每日反证包并负责资料入库。
授权原话及限定范围：MEMORY_V1/OWNER_COLLAB.md 的“每日反证包资料入库专项授权（Owner 2026-10-30）”。
productionAuthority=false。

## 触发与加载
Owner 在对话中转交每日股市情报与反证资料包时执行。“反振包”“反阵包”按本上下文视作“反证包”。
先读 BOOT + INDEX task_maps.DEFAULT + PERSIST_GATE，再读本文件与 OWNER_COLLAB 专项授权。
本流程是补充资料归档，优先于泛称“入库／存包”的 Frozen PACK 路由；不得误调用完整 PACK 的三文件流程。
由收到资料触发；没有输入不生成资料，不另建定时任务，不要求 Owner 每天重复授权或再转交 Grok。

## 日常写入范围
仓库：jielin5103329569-a11y/aiceo-alpha-radar-stream，分支 main。
仅限 EXTERNAL_EYES/SUPPLEMENTS/COUNTEREVIDENCE/。
- 每日原文：<YYYY-MM-DD>/RAW.md。
- 当次复核：<YYYY-MM-DD>/REVIEW.md。
- 目录索引：INDEX.md。
日期按原包声明的 PT 日期，不把补录日期冒充采集日期；保留原窗口和来源。

## 保存与复核
原文恢复编码、保留正文；源为编码恢复稿时明确标注，不能声称取得未收到的原始 API 数据。
原文与 GPT 复核附记分开。已验证、采集方陈述、观点/传闻、UNKNOWN、未覆盖分别标注。
核对影响结论的关键原件；无法读取的来源保留缺口，不因无法读取而编造已核实。
核查强度依内容决定，不在只有交接/保存请求时无理由重跑全市场扫描或完整雷达。
PARTIAL 可以作为资料保存，不自动改成 PASS 或事实认证。
同日按窗口、帖子 ID、事件和正文去重；完全重复只回现有路径与提交证据。
历史 RAW/REVIEW 不覆盖；有新增或更正则新建带明确后缀的追加文件并更新索引，保留与原记录的关联。
资料已收到可先留存未核部分，未完成核查须明确列入 REVIEW。

## 盈利模型与周进展隔离
本流程仅保存资料，不能自动改动：
- MEMORY_V1/PROFIT_MODEL_PLAN.md；
- MEMORY_V1/PROFIT_MODEL_PROGRESS.md；
- S2 研究验证计数、成功率、阶段判定；
- 井/票池、评分、可买名单或交易权限。

“归档完成”不等于“研究验证通过”“模型进步”或“盈利能力已证明”。
后续研究可读取本资料中的线索和经核实事实；是否成为模型证据仍按原程序，不能由存包动作直接推进。
不得把缺少新披露自动等同于反证成立；不足的期限、评价条件和来源要单列。
本流程不修改其他模型/治理文件，不写 ROOT 或其他公司仓库，不碰代码、8080、live-5。
没有新增后台定时采集或交易任务。

## 完成回执
写入后回读 main 的正文；满足 PERSIST_GATE 后才报“已入库”。
给 Owner 短回执：原包日期 + 文件路径 + commit SHA + PARTIAL/UNKNOWN。
归档写入自行核对只证明文件保存，不替代研究独立验收；不设置项目 verification=VERIFIED 或 closure=CLOSED。
失败如实报未入库及原因，保留已准备的材料，不虚报成功。

索引入口：EXTERNAL_EYES/SUPPLEMENTS/COUNTEREVIDENCE/INDEX.md。
