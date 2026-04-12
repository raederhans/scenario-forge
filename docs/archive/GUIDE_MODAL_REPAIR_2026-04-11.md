# GUIDE_MODAL_REPAIR_2026-04-11

## 目标
- 把 Guide 从 sidebar popover 改成真正的全屏 modal。
- 修复“背景变暗但内容不可见、ESC 后仍像卡死、其他壳层不收起”的问题。

## 执行计划
- [x] 复现并定位：确认 drawer scrim 盖住 guide，ESC 关闭后 drawer/scrim 残留。
- [x] 结构改造：补充 guide backdrop / close button / modal 语义。
- [x] 样式改造：Guide 居中显示，guide 打开时其他壳层隐藏或禁用。
- [x] 逻辑改造：两个入口共用同一 modal，支持 ESC / close / backdrop 退出，修复 URL restore。
- [x] 测试：更新 contract + e2e，覆盖打开、关闭、ESC、URL restore、无遮挡残留。
- [x] 收尾：review、必要经验记录、归档。

## 进度记录
- 2026-04-11：已通过浏览器和 Playwright 脚本确认 `right-drawer-open` 的 body scrim 覆盖了 guide 内容，guide 实际矩形落在视口外下方，ESC 仅隐藏节点但不清理 drawer class。
- 2026-04-11：已把 Guide 抽离出右侧 Utilities 容器，改成顶层 backdrop + modal 结构，避免再被 sidebar 层级和隐藏状态连带吞掉。
- 2026-04-11：已补齐 close button、ESC、backdrop click、Tab focus trap、URL `view=guide` restore，并让 Guide 打开时不再依赖 `right-drawer-open`。
- 2026-04-11：已验证 `python -m unittest tests.test_ui_rework_plan03_support_transport_contract tests.test_ui_rework_plan02_mainline_contract` 通过；已验证 `ui_rework_mainline_shell_sidebar.spec.js` 与 `ui_rework_support_transport_hardening.spec.js` 共 8 个 e2e 用例通过。
