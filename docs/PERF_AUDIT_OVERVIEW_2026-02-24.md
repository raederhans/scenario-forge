# 前 UI 历史整理索引

## 1. 整理范围

这次整理覆盖前 UI 阶段的历史文档，范围固定为：

- `qa_reports/001-028`
- `qa/PERF_PLAN_A_PROGRESS_2026-02-25.md`
- `qa/QA-029` 到 `qa/QA-033`

较新的 UI shell / polish / texture / boundary gap 文档不在本索引正文范围内。

## 2. Canonical Summary

前 UI 阶段的已落地能力，统一收敛到这两份主文档：

- [前 UI 已实现功能总账 A：数据构建、加载链路、区域扩展与输入资产](/mnt/c/Users/raede/Desktop/dev/mapcreator/docs/PERF_DATA_LOADING_PIPELINE_2026-02-24.md)
- [前 UI 已实现功能总账 B：渲染稳定化、边界修复、交互工具与编辑功能](/mnt/c/Users/raede/Desktop/dev/mapcreator/docs/PERF_RENDER_INTERACTION_2026-02-24.md)

## 3. Raw Archive

历史原始文档已归档到：

- [qa/archive/pre_ui_plans](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans)
- [qa/archive/pre_ui_execution](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution)

这些归档文件保留原编号与过程上下文，但不再作为默认阅读入口。

## 4. 截图与生成报表

前 UI 阶段的历史截图、Playwright 证据图、临时日志与自动生成报表已经从主文档区移出。需要重新生成时，统一走：

- `reports/generated/`
- `.mcp-artifacts/`（运行期临时证据）

## 5. 不在本轮整理范围内

以下内容保留在原位置，不并入这次 canonical summary：

- `qa/QA-034_*` 及之后的专题执行文档
- `qa/QA-038_*` 及之后的 UI 结构与 polish 文档
- `QA-044` 相关晚期专题正文
