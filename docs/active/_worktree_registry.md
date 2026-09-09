# Worktree Registry

## 当前导航（2026-09-09）

这里只维护当前工作入口。分支、远端、进程和验收状态的历史快照统一见下方归档，不能把其中的“current”“clean”或“HEAD 相等”解释为今天的事实。

| 当前入口 | 用途与边界 |
| --- | --- |
| [编辑器改进与远端整合清理](editor-kernel-renewal-20260909/task.md) / [PR #127](https://github.com/raederhans/scenario-forge/pull/127) | 本轮导入事务、调度生命周期、城市身份及发布产物改进已完成本地验证。用户已授权远端合并推送和工作树清理；必需检查、合并与清理结果以该任务及下方回执为准。完整 P4 未准入。 |
| [恢复后续 R0 / T1 / U1 / P1](recovery-followup-20260908/task.md) | PR #123 已合并，但自动部署因 tracked dist 漂移失败。当前先闭合产物与夹具，再开展导入反馈和单热点性能改进；状态以任务记录为准。 |
| [M4 完成记录](development-recovery-m4-20260908/task.md) / [整合 PR #123](https://github.com/raederhans/scenario-forge/pull/123) | 本地实现与验收完成，功能提交 `1decb144` 已推送集成分支；远端检查和合并状态以 PR 为准。保留其他证据工作树和未归属 WIP。 |
| [快速治理任务](development-loop-simplification-20260905/task.md) / [交接与所有权](development-loop-simplification-20260905/context.md) | 维护已集成的 deeper stages 1–4 和新一轮 1–4 项的进度；新一轮并行任务尚未完成，不在这里提前验收。 |
| [P4 当前状态](state-action-ownership-p4-20260719/task.md#current-status) | 区分 P4.4 本地实现、正式 admission 与发布；这里不复制第二份阶段结论。 |
| [历史 registry 正文](../archive/worktree-registry-history-through-20260831.md) | 完整保留原登记、提交、验收、恢复与清理证据；下方保留原标题锚点并指向对应历史段落。 |

2026-09-06 收尾核对：功能整合提交 `a2adc4b627b0f0b6ad88c5ed04d68eae3f1ad15c`，包含此前治理、scenario 和 renderer 工作。本地 core74、官方策略生成与标准 checker（零违规）、Pages 构建和相关目标测试已通过；主分支接收以该分支 PR 的远端必需检查及合并回执为准，不代表正式 P4 B admission。个人 `.codex/config.toml` 修改保留在主工作区。

工作树清理覆盖证据以整合父提交 `348a952eecf08aa6d720b13721da927afd19efb8` 为基准：以下五个工作树的独立提交在 `git cherry` 中全部为 `-`，没有未覆盖 merge commit；`da5f` 为主分支祖先。删除前已确认工作区干净、无匹配运行进程，并保存旧运行记录。合并后的实际删除/保留回执保存于主工作区 `.runtime/tmp/optimization-closeout-20260906/cleanup-receipt.json`；原始 tip 与回收输出分别保存在 `worktrees-before.txt` 和 `worktree-artifact-recovery/`。

| 清理覆盖范围 | 可恢复 tip | 依据 |
| --- | --- | --- |
| `6e0c` | `5d6fd733bc8b14873328d3b887895bcc7b012bb1` | 两个独立提交已 patch-equivalent |
| `7a32` | `a45c6824538e7fe8d1529eae8cc9c0750e3f25ee` | 三个独立提交已 patch-equivalent |
| `8c4c` | `b5ed98f7ea2b913a25b67205a80707aa3cecfeab` | 四个独立提交已 patch-equivalent |
| `8c6f` | `9803aa1c0a51462edbaf4d4c520b1f63b7f295c8` | 两个独立提交已 patch-equivalent；旧锁对应进程不存在 |
| `da5f` | `4406c842747fc74ee5e3eb69ce0085a296c627f5` | origin/main 祖先，无独立提交 |
| `gate4-startup-graph-audit-20260901` | `a1f0885c6617622d260bc633c257b3f67b941686` | 一个独立提交已 patch-equivalent |

继续保留 `b52a`（`611c21400661085161e46c1daf0a9318f467b94b`，A-admitted-source）和 `d081`（`c41a17d2d9668243988929399108fb28e4707eac`）：仍有 `git cherry +` 的提交，未证明被整合结果完整覆盖。清理分支范围仅为本次 integration、已合并 baseline，以及已等价覆盖的 gate4；不扩大到这些保留工作树。

## 历史记录索引

以下原标题仅为兼容已有锚点。历史正文已移至一个归档文件；新增当前工作记录写入上面的任务入口，不再追加到旧阶段标题下。

## Runtime Architecture Reset v1 Stage B integration — 2026-08-31

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-001)

## Runtime Architecture Reset v1 Stage A integration — 2026-08-31

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-002)

## Remaining branches and protected-WIP closeout — 2026-08-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-003)

## Main convergence and completed-line cleanup — 2026-08-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-004)

## P4 authority and Nightly topology execution — 2026-08-28

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-005)

## M7-M12 controlled continuation — 2026-08-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-006)

## Worktree convergence snapshot — 2026-08-27

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-007)

## Landing home revamp integration snapshot — 2026-08-25

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-008)

## SC P3 serial execution snapshot — 2026-08-24

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-009)

## SC P0-P3 integration snapshot — 2026-08-24

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-010)

## Integration Owner

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-011)

## Recommended Order

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-012)

## Current Worktrees

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-013)

## P3.1 Visual-Effects Pass Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-014)

## P3.2 Context-Pass Orchestration Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-015)

## P3.3a Political-Pass Preflight Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-016)

## P3.3b Political-Pass Orchestrator Delivery Package 2026-07-14 / 2026-07-15 closeout

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-017)

## P3.0 Render-Pass Family Delivery Package 2026-07-13 (historical; superseded by the 2026-07-14 audit addendum)

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-018)

## P3.0 audit delivery addendum 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-019)

## Recent P2 audit delivery package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-020)

## P2 final integration decision 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-021)

## Williams Rerun08 Harness-Recovery Frozen Contract 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-022)

## Williams Rerun08 Terminal Invalid-Experiment Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-023)

## Williams Rerun07 Terminal Harness-Fault Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-024)

## P2 Final Recovery-Branch Verification Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-025)

## Williams Rerun06 Terminal Package and Rerun07 Final Governance 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-026)

## Williams Rerun05 Terminal Package and Role-v2 Repair 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-027)

## Williams Rerun04 Terminal Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-028)

## Williams Rerun03 Terminal and Telemetry-v3 Repair Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-029)

## P2.2a Williams Rerun02 Terminal Record 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-030)

## Williams Telemetry-v2 Repair Delivery Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-031)

## P2.2a Cached-Pass Compositor Delivery Package 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-032)

## P2.2a Williams Crossover Governance Delivery Package 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-033)

## P2.2a Williams Rerun01 and Analyzer TDD Follow-up 2026-07-11/12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-034)

## P2.2a Windows Job Object Containment TDD Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-035)

## P2.1 Legacy-Metric Acceptance Closeout 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-036)

## P2.1 Governed Render-Sample Reanalysis 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-037)

## P2 Upstream Integration 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-038)

## P2.1 Post-Acceptance Code-Review Fix 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-039)

## P2.1 Focused Repair Closeout 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-040)

## P2 Pre-baseline Repair 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-041)

## P2 Perf Readiness Cleanup Classification 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-042)

## P2 Contemporary A/B Admission Run 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-043)

## Audit Release Packaging Guardrails 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-044)

## Scenario Forge P1 Remaining Renderer Context 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-045)

## Scenario Forge P1.8 Pure Click-Selection Decision Owner 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-046)

## Scenario Forge P1.7 Click-Selection Transaction Preflight 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-047)

## Scenario Forge P1.6 Hit/Hover Runtime Context Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-048)

## Scenario Forge P1.5 Interaction Read Model Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-049)

## Scenario Forge P1.4 Viewport Mutation Chain Context Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-050)

## Scenario Forge P1.3 RendererRuntimeContext Projection + Viewport Read Model 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-051)

## Scenario Forge P1.2 RendererRuntimeContext Render Cache Read Model 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-052)

## Scenario Forge P1.1 RendererRuntimeContext First Receiver 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-053)

## Scenario Forge P1.0 Renderer Runtime Context Foundation 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-054)

## Local/Cloud Sync Cleanup 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-055)

## Scenario Forge P0.1 Core Verification 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-056)

## Scenario Forge P0.1.1 verify:core Post-acceptance Hardening 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-057)

## Scenario Forge P0.2 Verification Metadata Single Source 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-058)

## Comment Automation 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-059)

## Audit Follow-up 2026-07-07

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-060)

## Audit Follow-up 2026-07-05

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-061)

## Audit Integration Closeout 2026-07-04

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-062)

## Integrated Worktree Cleanup 2026-07-03

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-063)

### Recent Renderer Audit Dist Sync 2026-07-03

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-064)

## Branch Sync and Cleanup 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-065)

## Integrated Worktree Closeout 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-066)

## Ready Delivery Packages

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-067)

### Renderer Draw Canvas Orchestration Preflight P53 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-068)

### Renderer Click Selection Transaction Preflight P54 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-069)

### Recent Platform Audit Selector Fix 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-070)

### P7 And Phase 6E Worktree Cleanup 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-071)

### P7 v0.1 Public Demo Release Packaging 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-072)

### Renderer Integration Sweep After P47-P50 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-073)

### Renderer Render Pass Cache Host Preflight P50 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-074)

### Renderer Transaction Reset Owner P49 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-075)

### Renderer Map Hover Interaction Owner P48 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-076)

### Renderer Hit Canvas Scheduling Owner P47 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-077)

### Phase6E Public Demo QA Readiness 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-078)

### Audit Automation 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-079)

### Comment Annotation Automation 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-080)

### Phase6C Sample Switcher 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-081)

### Renderer Hit Canvas Scheduling Preflight 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-082)

### Phase6B Sample Guide Export 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-083)

### Renderer Render Phase Lifecycle Owner P43 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-084)

### Renderer Visible Frame Diagnostics Owner P42 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-085)

### Phase6A Public Sample Experience Polish 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-086)

### Renderer Render Request Boundary Owner P41 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-087)

### Renderer Render Lifecycle Preflight P40 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-088)

### Phase5B Sample Deep Links 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-089)

### Renderer Transaction Reset Hardening P39 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-090)

### Renderer setMapData Transaction Owner P38 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-091)

### Phase4B Output Gallery

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-092)

### Phase5A Sample Projects

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-093)

## Local/Remote Sync Closeout 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-094)

## Ready Delivery Packages

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-095)

### Renderer Startup Transaction Owner P36 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-096)

### Renderer Startup Transaction Preflight P35 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-097)

### Phase 4A Landing Product Story 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-098)

### Renderer Viewport Update Owner P34 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-099)

### Phase 3A Public Product Narrative 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-100)

### Audit Final CI Gate Closeout 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-101)

### Renderer Surface Runtime Bridge P33 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-102)

### Pages Release Gate Audit 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-103)

### Phase 2A Pages Payload Slimming

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-104)

## Recent Integrated Branches

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-105)

## Current Overlap Matrix

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-106)

## Recovery Records

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-107)

## Active Notes

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-108)

## Renderer frame orchestration P2 current admission note

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-109)
