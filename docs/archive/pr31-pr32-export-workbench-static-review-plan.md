# PR31/32 Export Workbench 静态梳理计划

- [x] 读取 lessons learned 与任务约束
- [x] 获取 repo `raederhans/scenario-forge` 的 PR #31 / #32 metadata、标题、描述
- [x] 获取 commit `ca477e98bc5ecf20866d8fb7d161008134694ba1` 之后两组改动的本地 diff
- [x] 梳理 motivation、核心文件、状态流、导出流程变化
- [x] 汇总能力、风险、明显冲突点、潜在回归面

## 进度记录
- 2026-04-15: 建档，开始收集 PR 信息与本地 diff。
- 2026-04-15: 已获取 PR #31 / #32 metadata、merge/base/head 关系，并在本地只读 clone 中查看 diff。
- 2026-04-15: 已核对 `state.js`、`interaction_funnel.js`、`toolbar.js`、`map_renderer.js`、`file_manager.js`、`index.html` 的导出链路改动与疑点。
