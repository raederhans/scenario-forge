# HELP_AND_GUIDE_MANUAL_EXPANSION_2026-04-15

## Problem and Goal
当前项目里的 Project 指导区与多个 help panel 文案偏短，部分内容已经落后于真实交互，用户很难仅靠面板文字学会完整操作。本任务要把 Project 区下方的指导内容扩写成一份中英双语、分章节、可直接照着操作的说明手册，同时审查各 tab 的帮助面板，让文案与当前实现保持一致。

## Scope and Non-Goals
In scope:
- 审核 Project tab、Utilities、Scenario Guide、Reference、Export、Frontline 的实际操作链
- 审核 Transport workbench 的 guide 与 section help
- 把 Guide 扩写成中英双语章节式说明手册
- 更新过时、不明确、过短的 UI 帮助文案
- 用 worktree 隔离本轮修改

Out of scope (V1):
- 改动功能逻辑或新增工作流能力
- 重做 UI 布局或视觉风格
- 改 README
- 扩展到与本轮帮助系统无关的模块

## Core Decisions
1. **What:** 先做真实操作链审计，再写手册与帮助文案。  
   **Why:** 帮助文本必须服务当前实现。  
   **Reversal condition:** 如果浏览器与代码行为出现大面积不一致，需要先补验证再动文案。
2. **What:** Guide 承担长文说明，卡片/弹层承担短文提示。  
   **Why:** 长文适合系统学习，短文适合即时操作。  
   **Reversal condition:** 如果后续需要单一事实源，再把长文抽成共享数据源。
3. **What:** 逐块拆分审计：Project/Utilities、Transport help、浏览器实测。  
   **Why:** 方便多代理并行，也便于最后统一收口。  
   **Reversal condition:** 如果帮助文案最终收口到单一 schema，再改成单点维护。

## Failure Cases and Acceptance
- 可见帮助文本与真实按钮/交互存在错配数量为 0。
- Guide 已覆盖 Project Management、Frontline、Reference、Export、场景编辑主链、成功检查。
- 中英双语章节一一对应，缺漏章节数量为 0。
- 更新后的帮助文案都能在代码里定位到唯一来源。

## Implementation Phases
Phase 1: 范围摸底与分块审计  
Done when: 已列出全部目标帮助面板与对应代码位置，并拿到子代理审计结果。  
Status: 完成。

Phase 2: Guide 扩写  
Done when: Guide modal 变成双语章节式手册，包含 quick path、准备项、Project 工具说明、成功检查。  
Status: 完成。

Phase 3: UI help 文案修订  
Done when: Project/Utilities/Guide/Reference/Export/Frontline/Transport 的帮助文本完成收口。  
Status: 完成。

Phase 4: review 与归档  
Done when: 已完成静态校验、最终复核、更新 lessons learned，并归档计划文档。  
Status: 完成。

## Progress Notes
- 2026-04-15：创建 worktree `..\mapcreator-docs-help-audit`，避免主仓脏改动和本轮文案修改互相干扰。
- 2026-04-15：并行审计了 Project 区帮助系统、Transport workbench 帮助系统和浏览器侧实际 UI 结构，确认 Project/Utilities/Guide/Reference/Export/Frontline 与 Transport 文案均存在阶段漂移。
- 2026-04-15：完成 Guide bilingual manual、Project 区短文案、Transport workbench 帮助文案、相关 contract/e2e 断言同步更新，并通过静态校验与 support contract unittest。
