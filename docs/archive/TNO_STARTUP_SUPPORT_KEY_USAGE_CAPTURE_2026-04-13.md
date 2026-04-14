# TNO startup support runtime key-usage capture 2026-04-13

## 目标
- 在不改变默认功能的前提下，为 startup support 增加可开关的 runtime key-usage 采集
- 采集 locale key / alias / stable key 命中，输出到 `.runtime/reports/generated/`
- 不修改正式 bundle/schema，不默认开启

## 实施清单
- [x] 建立留档
- [x] 梳理 i18n 命中入口和 dev_server 可复用写口
- [x] 实现前端采集与服务端落盘
- [x] 补测试
- [x] 复核并归档

## 进度记录
- 2026-04-13：`js/ui/i18n.js` 新增 startup support key-usage capture，集中在 `resolveGeoLocaleEntry()` 里采集：
  - `queryKeys`
  - `directLocaleKeys`
  - `aliasKeys`
  - `aliasTargetKeys`
  - `missKeys`
- 2026-04-13：`js/ui/i18n.js` 新增 `consumeStartupSupportKeyUsageAuditReport()`，以一次性快照方式导出采集结果。
- 2026-04-13：`js/main.js` 新增 `startup_support_audit=1` 查询参数开关；默认启动 ready 后会异步 POST 到 `/__dev/startup-support/key-usage-report`。
- 2026-04-13：`tools/dev_server.py` 新增 `save_startup_support_key_usage_report()` 与 POST 路由 `/__dev/startup-support/key-usage-report`，报告写到 `.runtime/reports/generated/scenarios/{scenario}_startup_support_key_usage.json`。
- 2026-04-13：`tests/test_dev_server.py`、`tests/test_startup_shell.py` 已补相应护栏。

## 本轮验证
- `python -m py_compile tools/dev_server.py tests/test_dev_server.py tests/test_startup_shell.py`
- `node --check js/ui/i18n.js && node --check js/main.js`
- `python -m unittest tests.test_dev_server tests.test_startup_shell tests.test_startup_bootstrap_assets -q`

## 结果摘要
- runtime key-usage capture 默认关闭，不影响正常启动。
- 开启方式：`?startup_support_audit=1`
- 采集落点集中在 `i18n` 真实 lookup 入口，比静态 topology 推导更接近真实依赖。
- 当前未自动生成真实命中样例；要拿样例报告，需要在本地跑一次带 `startup_support_audit=1` 的真实启动。

## 结论
- 这轮已经把“如何拿到真实 startup support 命中白名单”这条路打通了。
- 下一步最自然的动作不是继续猜测哪些 key 可以裁，而是：
  1. 用 `?startup_support_audit=1` 启动一次真实 TNO
  2. 读取 `.runtime/reports/generated/scenarios/tno_1962_startup_support_key_usage.json`
  3. 基于真实命中结果制定 support file 第一刀裁剪白名单
