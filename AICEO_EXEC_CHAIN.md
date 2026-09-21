# AICEO_EXEC_CHAIN
调用时机：每次收到写代码/改框架指令，先读本文件与 docs/OWNER_COLLABORATION_CONTRACT.md。读不到则停。

详细治理：docs/OWNER_COLLABORATION_CONTRACT.md
Roadmap（非任务队列）：docs/ALPHA_MASTER_ROADMAP.md
Resume 协议：MEMORY_V1/BOOT.md + MEMORY_V1/STATE/aiceo.pointers.yaml

## 分工
Owner=方向。Grok=出令/技术裁决。Agent=按合同改仓。GPT=治理/独立验收/外部 Radar。

## Owner 粘贴
一次一个技术极限的大段。禁止拆成单文件/单脚本/单微步让 Owner 连贴。Grok 先在 GitHub 写完整段，再出一条 Agent 令。

## 存真相
凡与此项目有关的记忆只写仓库。禁止用聊天上下文当存档。禁止用 Grok 长记忆当存档。
- 任务 MEMORY_V1/LOG/TASKS.md
- 未完成 MEMORY_V1/OPEN_TASKS.md
- 想法 MEMORY_V1/LOG/IDEAS.md
- 建议 MEMORY_V1/LOG/ADVISORIES.md
- 原则/产品锁 MEMORY_V1 对应合同文件

## 调仓
动手前必须读取 Persistent State：Revision、Resume Node、activeTask、closure、verification、productionAuthority
对不上 Resume Node 或 activeTask=null 且任务不是「只写本文件/治理文档」：停。

## 写代码
- 单槽。BUSY 停。冷却 60–120s。
- 最小 diff。不准顺手重构。
- 不准自验当 PASS。不准新 Repl/Workflow。
- 不准跳 Resume Node。不准 Promotion。不准把聊天当真相。

## 存仓
改了哪些文件 / 结果 / Evidence 指针。禁止自把verification=VERIFIED、closure=CLOSED。

## 回报
DONE=yes|no
FILES=
TESTS=
RESUME_NODE=
EVIDENCE=
ERROR=
BUSY=yes|no
