# Context

2026-04-28
- 已读取 AGENTS.md、lessons leanrned.md、docs/shared/agent-tiers.md、package.json。
- 计划要求的测试脚本已经存在。
- `.omx/context/ui-adaptive-layout-contract-20260428T214827Z.md` 是 Ralph context snapshot。
- 已实现 CSS layout token、utility class、scenarioContextBar CSS variable 桥接、bottom dock grid/container query、popover/palette token 化。
- 修复过程中发现 `rightPanelToggle` 在 1024px 视觉证据脚本里被右上 zoom controls 拦截，已把 tablet 右侧 panel toggle 下移，避免点击层级冲突。
- `dockExportBtn` 键盘路径在 export section 折叠时会把 Enter 留在 Reference 按钮上；e2e 现在显式打开 export section 后再走 export workbench 路径，贴合真实 DOM 结构。
- transport 中文文案已对齐 canonical locale：`比较基线`、`这个家族没有可用基线`。
- 视觉证据输出：`.runtime/browser/mcp-artifacts/ui-adaptive-layout-contract/`，无 network failure，console warning 为既有 startup/physical/scenario warning。

验证结果：
- `npm run verify:ui-contract-foundation` 通过，6 tests。
- `npm run verify:ui-rework-mainline` 通过，7 tests。
- `npm run verify:ui-rework-support` 通过，6 tests。
- `npm run verify:test:e2e-layers` 通过。
- `npm run test:e2e:ui-rework-mainline` 通过，2 tests。
- `npm run test:e2e:ui-rework-support` 通过，10 tests。
