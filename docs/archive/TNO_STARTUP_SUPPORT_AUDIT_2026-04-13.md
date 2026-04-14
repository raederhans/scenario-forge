# TNO startup support 审计记录 2026-04-13

## 目标
- 审计 `locales.startup.json` 与 `geo_aliases.startup.json` 的真实启动职责
- 不直接瘦身，只先确认真实消费者、规模和安全切口

## 实施清单
- [x] 为 startup support family 增加 standalone audit 脚本
- [x] 为 support builder 增加 machine-readable 审计报告
- [x] 补测试，锁住报告字段与读取路径
- [x] 生成真实 `tno_1962` startup support audit 报告

## 进度记录
- 2026-04-13：`tools/build_startup_bootstrap_assets.py` 新增：
  - `collect_startup_required_geo_keys()`
  - `build_startup_support_assets_report()`
  - `build_startup_support_assets(..., report_path=...)`
- 2026-04-13：新增 `tools/audit_startup_support_family.py`，可直接对现成场景目录做只读审计。
- 2026-04-13：`tests/test_startup_bootstrap_assets.py` 新增 support audit 覆盖，锁住 report 结构与文件读取路径。
- 2026-04-13：已生成 `.runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json`。

## 本轮验证
- `python -m py_compile tools/build_startup_bootstrap_assets.py tools/audit_startup_support_family.py tests/test_startup_bootstrap_assets.py`
- `python -m unittest tests.test_startup_bootstrap_assets -q`
- `python tools/audit_startup_support_family.py --scenario-dir data/scenarios/tno_1962 --base-topology data/europe_topology.json --full-locales data/locales.json --full-geo-aliases data/geo_aliases.json --full-runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --report-path .runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json`

## 审计结果摘要
- `locales.startup.json`
  - before: `72641` geo keys / `6.28 MB`
  - checked-in after: `44170` geo keys / `3.71 MB`
- `geo_aliases.startup.json`
  - before: `48351` aliases / `2.44 MB`
  - checked-in after: `48351` aliases / `2.44 MB`
- `geo_locale_patch.json`
  - `11344` geo keys / `1.43 MB`
- 当前基于 `base topology + runtime bootstrap + geo patch` 直接推导的 `combined required keys` 只有 `16195`。

## 结论
- 这轮最重要的发现不是“马上能继续瘦”，而是：
  **当前 `build_startup_support_assets()` 里的 key 选择规则明显不足以安全重建 checked-in 的 startup support files。**
- 证据很直接：
  - checked-in `locales.startup.json` 仍有 `44170` 个 geo keys
  - 但当前规则算出的 required key 合集只有 `16195`
  - 如果直接按现有规则重建，会把 startup support 收得过狠
- 所以下一刀不能直接开始裁 `locales.startup.json / geo_aliases.startup.json`；必须先补一份更真实的“startup 运行时实际命中 key 集”证据链，再决定如何瘦。

## 下一步建议
- 下一波不要先改 startup support builder 行为。
- 先做一个更细的 **startup support key-usage 审计**：
  - 按 `ui / geo / alias` 分别统计
  - 再结合 startup 首屏真实可见对象和 lookup 入口，确认哪些 key 真是启动必须
- 在拿到这份 key-usage 证据前，不要直接提交 support file 瘦身。
