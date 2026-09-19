# AICEO_EXEC_CHAIN
调用时机：每次收到写代码/改框架指令，先读本文件。读不到则停。

## 分工
Owner=方向。Grok=出令/判定。你=写代码、调仓、存仓、按格式回报。

## 调仓
动手前必须读取：
- Persistent State：Revision、Resume Node、activeTask、closure、verification、productionAuthority
- 本文件
对不上 Resume Node 或 activeTask=null 且任务不是「只写本文件」：停。

## 写代码
- 单槽。BUSY 停。
- 最小 diff。不准顺手重构。
- 不准自验当 PASS。不准动 8080。不准新 Repl/Workflow。
- 不准跳 Resume Node。不准 Promotion。不准把聊天当真相。

## 存仓
做完必须写回仓库（能写 DB 就写事件/状态；写不了就至少保证本文件与代码在仓库树里）：
- 改了哪些文件
- 结果：成功/失败/阻塞
- Evidence 指针
禁止把 Owner 原话未分类直接升成 Core Truth。
禁止自己把 verification 改为 VERIFIED、把 closure 改为 CLOSED。

## 回报
只准按行输出然后停：
DONE=yes|no
FILES=
TESTS=
RESUME_NODE=
EVIDENCE=
ERROR=
BUSY=yes|no