# Context

- 2026-04-19: 用户要求只做静态分析，不跑测试。
- 目标: 为 Wave 4 下一刀 `js/core/runtime_hooks.js` 提供最小安全拆分建议。
- 关注文件: `js/core/state.js`、`js/core/runtime_hooks.js`、`js/ui/toolbar.js`、`js/ui/sidebar.js`、`js/ui/dev_workspace.js`、`js/main.js`、`tests/test_state_split_boundary_contract.py`。
- 结论方向: `runtime_hooks.js` 继续只承担跨模块可空函数 slot；`state.js` 继续保留单例活状态、缓存、句柄和持久 UI state。
- 重点风险: 误把 `state.ui.*` 这类持久 UI 状态当成 hook 下沉；漏掉 `main.js` 晚绑定 hook 的 wiring 与空值保护；打断 toolbar <-> dev_workspace、toolbar <-> sidebar 的互调链。
