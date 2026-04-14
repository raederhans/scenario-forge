# TNO startup support 全面审计 2026-04-13

## 目标
- 一次审清 `locales.startup.json` / `geo_aliases.startup.json` / `geo_locale_patch*` 的启动职责边界
- 产出可直接进入实现的下一刀切口，不直接修改正式 support 产物

## 审计范围
- 默认 startup 读取链
- startup override / worker / cache 路径
- scenario apply 后对 support / patch 的继续依赖
- startup support 文件的 key/alias 分布
- 静态 required key 规则与 checked-in 真实产物的差距

## 实施清单
- [x] 建立留档
- [x] 并行梳理代码消费链与数据分布
- [x] 形成安全切口与风险结论

## 进度记录
- 2026-04-13：已确认默认 startup 直接读取 `locales.startup.json` / `geo_aliases.startup.json` 的真实入口在 `js/main.js -> js/core/data_loader.js`。
- 2026-04-13：已确认 `geo_locale_patch` 不属于默认 startup 主路径，只在 `scenario_resources.js` / `scenario_manager.js` / `ui/i18n.js` 的 scenario apply 与 language switch 路径继续使用。
- 2026-04-13：已补 `tools/audit_startup_support_family.py` 与 `build_startup_support_assets_report()`，并生成真实报告 `.runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json`。
- 2026-04-13：已确认 `map_renderer.js` 的城市/标签路径会直接用 `getPreferredGeoLabel / getStrictGeoLabel`，而这些最终都会落到 `state.locales.geo + state.geoAliasToStableKey` 的 lookup 上。

## 审计结果摘要
- `locales.startup.json`
  - checked-in: `44170` geo keys / `3.71 MB`
  - 其中：
    - `id::` key 约 `22193`
    - plain-name key 约 `11037`
    - mixed-with-digits key 约 `10939`
- `geo_aliases.startup.json`
  - checked-in: `48351` aliases / `2.44 MB`
  - alias target 基本全部指向 `id::...`
- `geo_locale_patch.json`
  - `11344` geo keys / `1.43 MB`
- 当前静态规则推导的 required key 合集只有 `16195`，远低于 checked-in startup locales 的 `44170`。
- startup locales 与 patch 的 key 集重合极小，说明 patch 不能替代 startup locale key 集。

## 结论
- 这轮已经足够确定：**当前静态 required-key 规则不够真实，不能直接拿来裁 `locales.startup.json / geo_aliases.startup.json`。**
- 真正缺的是一份“startup 期间真实 lookup 命中的 key/alias 集”，而不是再多一层 topology 静态推导。
- 所以下一刀不该直接改 startup support builder，而该先做 **runtime key-usage capture / offline replay 审计**：
  - 记录默认 startup 实际请求和命中的 geo locale key
  - 记录 alias lookup 命中的 alias/stable key
  - 再据此生成安全白名单

## 下一步建议
- 下一轮直接做：`startup support runtime key-usage audit`
- 在拿到真实 key-usage 证据前，不提交任何 support file 瘦身。
