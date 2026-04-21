# Step 0 perf_probe 骨架

这轮 Step 0 继续沿用仓库里已经存在的指标系统，只补统一快照层。

## 现有真源

- `state.bootMetrics`
- `state.renderPerfMetrics`
- `state.scenarioPerfMetrics`
- `ops/browser-mcp/editor-performance-benchmark.py`

## 本轮新增最小面

1. `js/core/perf_probe.js`
   - 默认关闭
   - 提供 `enable()` / `disable()` / `isEnabled()`
   - 提供 `recordRenderSample(durationMs, details)`
   - 提供 `snapshot()`
2. `globalThis.__bootMetrics`
   - 从启动链同步暴露现有 `state.bootMetrics`
3. `globalThis.__mc_perf__`
   - 暴露 `{ enable, disable, snapshot }`

## `snapshot()` 需要返回的内容

```js
{
  enabled: true,
  bootMetrics: { ... },
  renderPerfMetrics: { ... },
  scenarioPerfMetrics: { ... },
  renderSamples: {
    count,
    totalMs,
    minMs,
    maxMs,
    medianMs,
    samples,
  },
}
```

## 最小补点建议

- `render()`：记录 render sample 分布
- 启动链：同步 `globalThis.__bootMetrics`
- 其余 boot / scenario / refresh 指标优先复用现有 metrics，不重复发明新 schema

## baseline 脚本要求

- 入口：`tools/perf/run_baseline.mjs`
- 场景固定：`blank_base`、`tno_1962`、`hoi4_1939`
- 每场景 `1` 次 warm-up + `5` 次 measured run
- 每次 measured run 使用全新 browser context
- URL 参数使用 `default_scenario`
- baseline 输出：
  - `docs/perf/baseline_2026-04-20.json`
  - `docs/perf/baseline_2026-04-20.md`
  - raw run 放到 `.runtime/output/perf/`

## gate 真源

- CI 读取 `docs/perf/baseline_2026-04-20.json`
- Markdown 只给人看，机器对比不依赖 Markdown
