# TNO startup support probe + miss analysis + split closure review 2026-04-13

## 目标
- 补一轮更有针对性的 startup support 探针
- 对剩余 miss 做分类，区分“该补进 startup support”与“本来不该由 startup 承担”
- 复盘 bundle/startup support 拆分进程，判断是否已接近收尾

## 实施清单
- [x] 读取 brainstorming skill，收口本轮分析范围
- [x] 增加针对性探针并采样
- [x] 汇总剩余 miss 分类与可行动项
- [x] 复盘 docs / code / 产物契约，判断拆分完成度
- [x] 更新留档并归档

## 进度记录
- 2026-04-13：开始接手“补探针 + miss 分析 + 拆分完成度复盘”这轮工作。
- 2026-04-13：新增 `tools/capture_startup_support_sample.js` 的 `water-family-probe` 模式，专门针对 `scenarioWaterRegionsData + waterRegionsData` 的 `id / label / name / parent_id / source_id` 做 startup support 查询采样。
- 2026-04-13：真实采样 `analysis-water-family-v2` 已完成，结果：
  - `queryKeyCount = 565`
  - `directLocaleKeyCount = 198`
  - `aliasKeyCount = 6`
  - `aliasTargetKeyCount = 6`
  - `missKeyCount = 361`
- 2026-04-13：对正式默认样本 `formal-post-slim-v2-final-en` 的 `250` 个 miss 已做分类：
  - `121` 个 `tno_*` 水域 slug
  - `107` 个水域显示名（Sea / Bay / Ocean / Gulf / Strait / Channel / Firth / Estuary）
  - `16` 个其他水域名称或 chokepoint 名称
  - `5` 个 `marine_*` 宏海域 slug
  - `1` 个 `congo_lake`
- 2026-04-13：这 `250` 个正式 miss 我已核对过，**0 个命中 full locales，0 个命中 full geo_aliases**。这说明剩余 miss 已经不再是“whitelist 漏收”，而是水域命名目前主要依赖 feature 原始属性与 fallback，不属于现有 startup support locale/alias 文件的直接覆盖范围。
- 2026-04-13：结合 docs / code / tests 复盘，当前判断是：startup bundle / startup support 拆分已经**基本完成**；剩下主要是：
  1. 明确把水域类 miss 定义为 startup support 范围外还是新增独立水域 locale 资产
  2. 清理 root 级 legacy `data/locales.startup.json`、`data/geo_aliases.startup.json`
  3. 把 `tests/e2e/review_regressions.spec.js` 里的旧 root 路径夹具切到 scenario-scoped

## 本轮验证
- `node --check tools/capture_startup_support_sample.js`
- `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label analysis-water-family-v2 --mode water-family-probe`
- 分类分析：
  - `formal-post-slim-v2-final-en` miss 分类脚本
  - `analysis-water-family-v2` miss 分类脚本
  - `full locales / full geo_aliases` 交叉核对脚本

## 结论
- 这轮“补探针 + miss 分析”后，主结论已经很清楚：**剩余 miss 几乎全是水域命名域的问题，不是 startup support whitelist 还没校正完。**
- 所以如果只问“拆分进程是不是差不多完成”，答案是：**是，差不多已经完成了。**
- 现在更像收尾决策题，不再是结构拆分题：要么明确这些水域 miss 不属于 startup support；要么单独为水域命名做一条 locale 资产链，而不是继续往现有 whitelist 里硬塞。

