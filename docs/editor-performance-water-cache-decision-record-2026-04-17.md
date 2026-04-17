# Editor Water Cache 决策记录（2026-04-17）

## 目标
基于 `ops/browser-mcp/editor-performance-benchmark.py` 的 `CONTEXT_PROBE_CASES`（包含 `water_off`）输出可直接决策的报表字段，统一判断水体缓存策略。

## 固定产物路径
- 主 benchmark 报告：`.runtime/output/perf/editor-performance-benchmark.json`
- 水体缓存决策摘要：`.runtime/reports/generated/editor-performance-water-cache-summary.json`

## 关键字段
- `waterCacheSummaryByScenario.<scenarioId>.waterCacheDelta`
  - `drawCanvasDelta`：`water_off - baseline`
  - `framesDelta`：`water_off - baseline`
  - `contextScenarioDurationDeltaMs`：`water_off - baseline`
  - 每个指标含 `p50`、`p90`、`stddev`、`min`、`max`、`mean`、`samples`
- `waterCacheSummaryByScenario.<scenarioId>.waterCacheRecommendation`
  - `isLowWaterCoverageScenario`
  - `recommendDisableWaterCacheLowCoverage`
  - `negativeBenefitMetrics`

## 判定依据（保留 / 降级 / 取消）
1. 保留（retain）
   - `drawCanvasDelta.p50 >= 0` 且 `framesDelta.p50 >= 0`，并且 `contextScenarioDurationDeltaMs.p90 >= 0`。
2. 降级（degrade）
   - 任一核心指标出现 `p50 < 0`，或 `stddev` 明显偏高导致波动风险。
   - 执行策略：仅在高水体覆盖场景启用，低水体覆盖场景关闭。
3. 取消（cancel）
   - `recommendDisableWaterCacheLowCoverage = true`，并且负收益指标在样本内持续为负。

## 低水体覆盖场景自动建议
当 `drawCanvasDelta`、`framesDelta`、`contextScenarioDurationDeltaMs` 中至少 2 项在有效样本窗口内持续为负（当前规则：样本最大值 `< 0`，最少 3 个样本）时：
- `recommendDisableWaterCacheLowCoverage=true`

## 执行建议
每次性能回归前运行 benchmark，直接读取 `.runtime/reports/generated/editor-performance-water-cache-summary.json` 的 `waterCacheRecommendation`，按上述三档策略执行发布决策。
