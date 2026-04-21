# Refactor + Perf 整合计划（2026-04-20）

> **如果你是被派来执行这个计划的 agent —— 按下面顺序读文件，不要跳过。**

## 读取顺序（强制）

1. **`context.md`** — 现状快照 + 红线清单。**必读**。不读就开工 = 踩坑
2. **`plan.md`** — 战略框架（两轨 + 原则 + 目标）
3. **`task.md`** — 可勾选的执行 checklist
4. **`step0_perf_probe_skeleton.md`** — Step 0 专用代码骨架

## 本目录文件清单

| 文件 | 作用 | 谁应该读 |
|---|---|---|
| `README.md` | 本文件（入口导航） | 所有人 |
| `context.md` | 2026-04-20 现状、已完成、红线、用户意图 | 执行 agent **必读** |
| `plan.md` | 战略计划（两轨、原则、Step 总览） | 执行 agent、reviewer |
| `task.md` | Step 0-8 的可勾选执行 checklist | 执行 agent |
| `step0_perf_probe_skeleton.md` | Step 0 的 `perf_probe.js` 代码骨架 + 精确打点位置 | 执行 Step 0 的 agent |

## 核心约束一句话

这个计划两轨并行——**轨 A** 按 `docs/active/further_split/plan.md` 既有 3-phase 路线继续推（scenario → state/runtime_hooks → renderer API），**轨 B** 独立建立 perf baseline 并做低风险性能修复。两轨都**不**扩大范围、**不**动红线。

## 起点

看完 `context.md` + `plan.md` + `task.md` 之后，从 `task.md` 的 **前置（P0 hotfix 清理）** 开始，然后 Step 0。

## 遇到以下情况停下来问用户

1. 实际执行某 Step 涉及文件 > 10 个
2. 发现红线列表里某项不得不碰
3. baseline 对比显示变差而非变好
4. 发现某个 `@internal` API 被外部依赖
5. `context.md §6 用户意图` 与当前决策发生冲突

不要自作主张继续。
