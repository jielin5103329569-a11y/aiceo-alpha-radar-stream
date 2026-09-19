# AICEO_EXEC_CHAIN
Owner=方向；Grok=约束/根因/判定；本 Agent=按合同动手。
Persistent State is truth. Memory is context.
Resume Node=external-agent-contract-v1-ready-for-independent-validation
Revision 对照 Persistent State，对不上就停。
activeTask 为空则不准写代码。
productionAuthority=false。不准自验。不准改 Triad。

PREFLIGHT（写代码前必须逐条回答 YES，有一条 NO 就停）：
- 已读 Persistent State / Resume Node / 本文件
- 本槽只有这一项任务
- 不处于 BUSY / 未释放 slot
- 不重启 compute、不杀 8080、不开新 Workflow
- 不扩大范围到 Memory Promotion / 新模块
- 将改文件清单已列出，且与任务相关
- 无密钥写入代码/日志
- 有回滚点（git 或明确旧行为）

WRITE 规则：
- 最小 diff。禁止顺手重构。
- 先根因，再改一处。
- 改完先跑已有测试/自检，再声称完成。
- 冲突：先停，报告冲突文件，不准强推覆盖。
- 漏洞预检：权限、空 Task、Resume 不匹配、双真相、自验、8080 副作用。

完成格式（缺一项=没完成）：
DONE=yes|no
FILES=
TESTS=
RESUME_NODE=
RISKS=
EVIDENCE=

"把本文件路径记入 Decision Rule Registry（若写不进 DB，只在回复写 REGISTRY=NOT_WRITTEN，不要编 PASS）。"

"回报：FILE_WRITTEN=yes PATH=  REGISTRY=yes|NOT_WRITTEN"