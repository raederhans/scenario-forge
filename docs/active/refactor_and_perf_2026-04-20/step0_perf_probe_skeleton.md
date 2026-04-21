# Step 0 perf_probe.js 代码骨架 + 精确打点位置

> 这份文档是 Step 0 的落地参考。执行 agent 应按本文件的骨架和位置精确实现，**不要自行设计新的 API**。

---

## 1. 设计原则

- **零生产开销**：打点在关闭时是单次 boolean 检查，不做任何 map 操作
- **降级安全**：`globalThis.performance` 不可用时（Node / 老浏览器）降级为 no-op
- **可查询**：暴露一个 `snapshot()` 返回所有 mark/measure 数据，供 baseline 脚本抓取
- **不污染 global**：所有状态封装在模块内

---

## 2. `js/core/perf_probe.js` 代码骨架

```js
// Perf instrumentation for refactor_and_perf_2026-04-20 baseline
// No-op when disabled or when performance API unavailable.

const ENABLED_KEY = "mc_perf_enabled";
const perf = globalThis.performance;
const hasPerf = typeof perf?.mark === "function" && typeof perf?.measure === "function";

let enabled = hasPerf && readEnabledFlag();

function readEnabledFlag() {
  try {
    // Opt-in via ?perf=1 or localStorage. Default off in production.
    if (typeof location !== "undefined" && /[?&]perf=1\b/.test(location.search)) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "1") return true;
  } catch {}
  return false;
}

// --- counters for cumulative measures (e.g. render()) ---
const cumulative = new Map(); // name -> { count, totalMs }

export function perfEnable() {
  if (!hasPerf) return;
  enabled = true;
  try { localStorage?.setItem(ENABLED_KEY, "1"); } catch {}
}

export function perfDisable() {
  enabled = false;
  try { localStorage?.removeItem(ENABLED_KEY); } catch {}
}

export function perfIsEnabled() {
  return enabled;
}

export function mark(name) {
  if (!enabled) return;
  try { perf.mark(name); } catch {}
}

// Measures from a prior mark to NOW and clears the start mark.
export function measureFrom(name, startMark) {
  if (!enabled) return 0;
  try {
    perf.measure(name, startMark);
    const entries = perf.getEntriesByName(name, "measure");
    const dur = entries[entries.length - 1]?.duration ?? 0;
    perf.clearMarks(startMark);
    perf.clearMeasures(name);
    return dur;
  } catch {
    return 0;
  }
}

// Wrap a sync function with start/end marks; also accumulates if cumulative=true.
export function measured(name, fn, { cumulative: isCum = false } = {}) {
  if (!enabled) return fn;
  return function probed(...args) {
    const start = `${name}:start`;
    mark(start);
    try {
      return fn.apply(this, args);
    } finally {
      const dur = measureFrom(name, start);
      if (isCum) {
        const prev = cumulative.get(name) ?? { count: 0, totalMs: 0 };
        prev.count += 1;
        prev.totalMs += dur;
        cumulative.set(name, prev);
      }
    }
  };
}

// Pair helper for manual start/end in tight spots.
export function startSpan(name) {
  if (!enabled) return NOOP_SPAN;
  const startMark = `${name}:start`;
  mark(startMark);
  return {
    end() {
      const dur = measureFrom(name, startMark);
      return dur;
    },
  };
}

const NOOP_SPAN = { end: () => 0 };

// Dump everything the baseline script needs.
export function snapshot() {
  if (!enabled) return { enabled: false };
  const marks = perf.getEntriesByType?.("mark") ?? [];
  const measures = perf.getEntriesByType?.("measure") ?? [];
  const cumArr = [];
  for (const [name, v] of cumulative.entries()) {
    cumArr.push({ name, count: v.count, totalMs: v.totalMs, avgMs: v.totalMs / v.count });
  }
  return {
    enabled: true,
    marks: marks.map(m => ({ name: m.name, startTime: m.startTime })),
    measures: measures.map(m => ({ name: m.name, startTime: m.startTime, duration: m.duration })),
    cumulative: cumArr,
  };
}

// Expose on globalThis for baseline script (only when enabled).
if (enabled && typeof globalThis !== "undefined") {
  globalThis.__mc_perf__ = { snapshot, enable: perfEnable, disable: perfDisable };
}
```

**关键点**：

1. 默认 off；通过 `?perf=1` URL 参数或 `localStorage` 开启——**不影响普通用户体验**
2. `measured()` 和 `startSpan()` 两种 API，前者装饰函数，后者手动边界
3. `snapshot()` 暴露在 `globalThis.__mc_perf__`，供 Playwright 脚本 `page.evaluate(() => window.__mc_perf__.snapshot())` 抓取

---

## 3. 精确打点位置

> 执行时先 `import { mark, startSpan, measured } from "./perf_probe.js"`；相对路径按实际调整。

### 3.1 `js/main.js`

- 文件开头入口函数（通常是 `bootstrap()` 或顶层 async IIFE）**第一行**加 `mark("boot:start")`
- 所有 bootstrap 结束、UI 就绪的那一行（搜 `bootPhase = "ready"` 的赋值前）加 `mark("boot:ready")`

### 3.2 `js/bootstrap/startup_data_pipeline.js`

- 搜 topology 加载完成的位置（函数名可能含 `loadTopology` / `applyTopology`）加 `mark("boot:topology-loaded")`

### 3.3 `js/core/scenario_manager.js`

- `applyScenarioBundle` 入口加 `const scenarioSpan = startSpan("scenario:apply")`
- `applyScenarioBundle` 出口（return 前）加 `scenarioSpan.end()` + `mark("boot:scenario-applied")`（仅首次 apply 时标，后续 apply 只记 span）

### 3.4 `js/core/map_renderer.js` 打点清单

在文件顶部加 import：
```js
import { mark, startSpan, measured } from "./perf_probe.js";
```

然后：

| 函数 | 打点方式 | 打点名 |
|---|---|---|
| `render()` | 用 `measured("render", renderImpl, { cumulative: true })` 包装导出 | `render`（累加） |
| `refreshMapDataForScenarioApply()` | 入口 `startSpan`，出口 `end()` | `refresh:scenario-apply` |
| `refreshMapDataForScenarioChunkPromotion()` | 同上 | `refresh:scenario-chunk` |
| `refreshColorState()` | 同上 | `refresh:color` |
| `rebuildPoliticalLandCollections()` | 同上 | `rebuild:political-collections` |
| `rebuildStaticMeshes()` | 同上 | `rebuild:static-meshes` |
| `rebuildRuntimeDerivedState()` | 同上 | `rebuild:runtime-derived` |
| `invalidateBorderCache()` | 同上 | `invalidate:border-cache` |

**注意**：这些函数有些是内部的，有些被多处调用——在**函数定义处**打点，不要在调用处打点（避免遗漏调用路径）。

---

## 4. baseline 抓取脚本骨架

建议放在 `tools/perf/run_baseline.py` 或 `.mjs`。以下是 Node + Playwright 的骨架（如果项目已有 Python Playwright，优先复用）：

```mjs
// tools/perf/run_baseline.mjs
import { chromium } from "playwright";

const SCENARIOS = [
  { id: "EMPTY_SCENARIO_ID", label: "empty" },
  { id: "MEDIUM_SCENARIO_ID", label: "medium" },
  { id: "LARGEST_SCENARIO_ID", label: "largest" }, // ← 用户指定
];
const RUNS_PER_SCENARIO = 5;
const BASE_URL = "http://localhost:8000";

async function measureOne(page, scenarioId) {
  await page.goto(`${BASE_URL}/?perf=1&scenario=${encodeURIComponent(scenarioId)}`);
  await page.waitForFunction(() => window.state?.bootPhase === "ready", { timeout: 60_000 });
  // small settle
  await page.waitForTimeout(500);
  return await page.evaluate(() => window.__mc_perf__?.snapshot() ?? null);
}

function median(nums) {
  const sorted = nums.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const browser = await chromium.launch();
  const results = {};
  for (const s of SCENARIOS) {
    const runs = [];
    for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
      const page = await browser.newPage();
      runs.push(await measureOne(page, s.id));
      await page.close();
    }
    results[s.label] = aggregate(runs);
  }
  await browser.close();
  writeMarkdown(results);
}

function aggregate(runs) {
  // For each measure/cumulative name, take median across runs
  // ... detailed aggregation
  return runs; // placeholder
}

function writeMarkdown(results) {
  // Write to docs/perf/baseline_2026-04-20.md
  // Table per scenario: measure name | median duration | runs count
}

main().catch(e => { console.error(e); process.exit(1); });
```

---

## 5. baseline 输出格式

`docs/perf/baseline_2026-04-20.md` 必须包含：

```markdown
# Perf baseline 2026-04-20

## Environment
- OS / CPU / RAM / Node version / Browser engine version
- git HEAD: <sha>
- mapcreator revision: <date>

## Scenario: empty (<scenario_id>)
- Runs: 5
- boot:start → boot:topology-loaded: <median> ms
- boot:topology-loaded → boot:scenario-applied: <median> ms
- boot:scenario-applied → boot:ready: <median> ms
- **Total startup**: <median> ms
- scenario:apply median: <median> ms / sd: <sd>
- refresh:scenario-apply median: <median> ms
- refresh:color median: <median> ms
- rebuild:political-collections median: <median> ms
- rebuild:static-meshes median: <median> ms
- rebuild:runtime-derived median: <median> ms
- invalidate:border-cache median: <median> ms
- render count per apply: <count>
- render cumulative ms per apply: <totalMs>

## Scenario: medium (<scenario_id>)
（同上）

## Scenario: largest (<scenario_id>)
（同上）

## Notes
- 用户指定的"最大场景"：<scenario_id> （如果用户未指定，此节空）
- 异常值说明（如果某一 run 偏差 > 30% 直接丢弃）
```

---

## 6. 验收 checklist

完成 Step 0 时对照：

- [ ] `js/core/perf_probe.js` 存在，关闭时调用开销为单次 boolean 检查
- [ ] URL `?perf=1` 或 localStorage 能开启
- [ ] `globalThis.__mc_perf__.snapshot()` 返回完整数据
- [ ] `tools/perf/run_baseline.*` 可一键跑完三档
- [ ] `docs/perf/baseline_2026-04-20.md` 按 §5 格式产出
- [ ] 在 Chrome DevTools Performance 面板能看到 `mark` 和 `measure` entries
- [ ] 关闭 `?perf=1` 后页面运行零区别（性能 & 行为）
- [ ] `grep "window.__mc_perf__" js/` 只在 perf_probe.js 里出现
- [ ] PR 说明里附上 baseline 文档链接
