# CONTOUR_REVIEW_FIXES_2026-04-09

## Plan
- [x] 修复 first idle 被抢跑 exact 的回归，恢复 transformed-frame fast path。
- [x] 把 contour pack 从默认 post-ready physical warmup 中拆出，延后加载。
- [x] 更新针对性回归检查并执行最小验证。
- [x] 复核、必要时补 lessons learned，并归档本文件。

## Progress
- 2026-04-09 22:55 已建档，开始执行 review fix。
- 已改 `js/core/map_renderer.js`：删除 `drawCanvas()` 里抢跑 exact 的分支，恢复 first idle 先走 transformed-frame，再由 `scheduleExactAfterSettleRefresh()` 在 quiet window 后决定是否强制 exact。
- 已改 `js/main.js`：把 `PHYSICAL_CONTEXT_LAYER_SET` 收口为 `physical + physical_semantics`，新增 `PHYSICAL_CONTOUR_LAYER_SET`，并把 contour warmup 拆成单独的 `post-ready-contour-warmup` 任务，延后到默认 post-ready 之后再加载。
- 已改 `js/core/interaction_funnel.js` 与 `js/ui/toolbar.js`：项目导入和 toolbar 打开 physical 时仍然会一次性请求 `physical-set + physical-contours-set`，避免只修默认启动却破坏交互入口。
- 已改 `tests/e2e/physical_layer_regression.spec.js`：新增源码断言，锁定 first idle fast path 已恢复、quiet-window exact 仍在、post-ready contour warmup 已延后、toolbar/import 入口仍会加载完整 physical set。
- 已验证：
  - `node --check js/core/map_renderer.js`
  - `node --check js/main.js`
  - `node --check js/core/interaction_funnel.js`
  - `node --check js/ui/toolbar.js`
  - `node --check tests/e2e/physical_layer_regression.spec.js`
  - `node node_modules/@playwright/test/cli.js test tests/e2e/physical_layer_regression.spec.js --reporter=list --workers=1 --retries=0`
- 复核结论：这次最稳的修法不是回退 contour 数据，也不是改 startup loader，而是把 exact 时机恢复正确、把 contour 的大包留在 post-ready 第二拍加载，同时补齐 physical 交互入口的显式 contour 请求。
