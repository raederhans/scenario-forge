# TNO startup support whitelist generator 2026-04-13

## 目标
- 基于 runtime key-usage 报告生成 startup support 的候选白名单
- 只写到 `.runtime/reports/generated/`，不修改正式 support 文件
- 给下一刀 `locales.startup.json / geo_aliases.startup.json` 瘦身提供离线依据

## 实施清单
- [x] 建立留档
- [x] 梳理输入报告结构和复用 helper
- [x] 实现白名单生成器与摘要报告
- [x] 补测试与样例运行
- [x] 复核后归档

## 进度记录
- 2026-04-13：新增 `tools/generate_startup_support_whitelist.py`，读取一个或多个 runtime key-usage 报告，输出候选 locale/alias 白名单与覆盖摘要。
- 2026-04-13：`tests/test_startup_bootstrap_assets.py` 已新增 generator 单测，锁住候选 locale key / alias key / unresolved miss keys。
- 2026-04-13：已基于真实启动样本生成 `.runtime/reports/generated/scenarios/tno_1962_startup_support_whitelist_candidate.json`。

## 本轮验证
- `python -m py_compile tools/generate_startup_support_whitelist.py tests/test_startup_bootstrap_assets.py`
- `python -m unittest tests.test_startup_bootstrap_assets -q`
- `python tools/generate_startup_support_whitelist.py --scenario-id tno_1962 --usage-report .runtime/reports/generated/scenarios/tno_1962_startup_support_key_usage.json --startup-locales data/scenarios/tno_1962/locales.startup.json --startup-geo-aliases data/scenarios/tno_1962/geo_aliases.startup.json --support-audit-report .runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json --output-path .runtime/reports/generated/scenarios/tno_1962_startup_support_whitelist_candidate.json`

## 结果摘要
- 当前只基于 1 次真实 startup 样本：
  - `query_key_count = 606`
  - `candidate_locale_key_count = 22`
  - `candidate_alias_key_count = 0`
  - `miss_key_count = 584`
- 现阶段结论明确：
  - 这份白名单只是候选，**不能直接拿来裁 support 文件**
  - 还需要更多样本（至少 zh / 几个关键 UI 交互）才能进入真正裁剪

## 结论
- 这步已经把“怎么从真实运行时命中生成候选白名单”这条链补齐了。
- 下一步不该继续猜，而应该：
  1. 再采几次 startup support key-usage 样本
  2. 合并样本后重跑 whitelist generator
  3. 达到稳定覆盖后，再改 `build_startup_support_assets()`
