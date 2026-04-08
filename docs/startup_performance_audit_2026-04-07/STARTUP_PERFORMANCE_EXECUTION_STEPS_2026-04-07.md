# Startup Performance Execution Steps 2026-04-07

## Progress log

- [x] Stage 0 reviewed: verify timeout repair does not change the default-product startup diagnosis; it remains a test-only bypass through `default_scenario`.
- [x] Stage 1 completed:
  - `tools/dev_server.py` now defaults static assets to `revalidate-static` unless explicitly forced to `nostore`
  - root HTML and `/__dev/*` remain `no-store`
  - large JSON / TopoJSON requests no longer do on-the-fly gzip; the server serves existing `.gz` sidecars only
- [x] Stage 1 validation completed:
  - `python -m py_compile tools/dev_server.py`
  - temporary local server on port `8030`
  - `/` headers confirmed `no-store`
  - `startup.bundle.en.json` headers confirmed `no-cache, must-revalidate`
  - `startup.bundle.en.json` with `Accept-Encoding: gzip` now serves the existing sidecar
  - timing check: `startup.bundle.en.json` gzip request dropped to about `0.014s`; `runtime_topology.bootstrap.topo.json` with gzip accepted but without sidecar now falls back to uncompressed at about `0.091s`
- [x] Stage 2 completed:
  - `js/main.js` no longer starts full localization hydration and full scenario hydration 180ms after ready
  - post-ready hydration is now split into two idle-scheduled tasks:
    - full localization hydration later
    - full scenario hydration even later
- [x] Stage 2 validation completed:
  - `node --check js/main.js`
  - temporary local server on port `8030`
  - headless request probe over 12s after `domcontentloaded`
  - no early requests for `/data/locales.json` or `/data/scenarios/tno_1962/runtime_topology.topo.json` were observed during that window, confirming full hydrate is no longer kicked immediately after ready
- [x] Stage 3 completed:
  - `js/core/map_renderer.js` now allows readonly unlock to skip the eager startup hit-canvas build
  - `js/main.js` now unlocks with `buildInteractionInfrastructureAfterStartup({ chunked: true, buildHitCanvas: false })`
  - hit-canvas work is left to the existing deferred/lazy path instead of blocking startup completion
- [x] Stage 3 validation completed:
  - `node --check js/main.js`
  - `node --check js/core/map_renderer.js`
  - temporary local server on port `8030`
  - independent headless reruns after the patch confirmed:
    - no console errors during startup
    - `bootOverlay` ends hidden
    - `startupReadonly` ends `false`
    - `interactionInfrastructureReady` ends `true`
    - `#zoomInBtn` remains clickable after startup completes
  - measured default `/` startup after the patch:
    - run A `total`: `74924.4ms`, `first-visible`: `7703.8ms`
    - run B `total`: `73620.5ms`, `first-visible`: `7669.0ms`
    - average `total`: `74272.5ms`
  - compared with the original baseline before these optimizations:
    - `total`: `77625.9ms -> 74272.5ms` (**-3353.4ms, about -4.3%**)
    - `first-visible`: roughly flat within run variance for this phase
  - interpretation:
    - this stage improves tail latency after first paint more than the first visible frame itself
    - hit-canvas work is no longer in the readonly unlock blocking path
- [~] Stage 4 reviewed: tightening `js/core/data_loader.js` startup cache was investigated, but it was not promoted yet because the current default path is startup-bundle-first and the attempted persistent-bundle cache did not show a reliable repeat-start improvement. This stage remains deferred until the startup bundle path itself is simplified.

- [x] Stage 5 completed:
  - `js/core/scenario_resources.js` no longer prewarms optional layers on cache hit
  - `js/core/scenario_post_apply_effects.js` no longer auto-syncs optional layer visibility during boot-blocking startup applies
  - optional layers are left to on-demand/visibility paths instead of being silently fetched during startup
- [x] Stage 5 validation completed:
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/scenario_post_apply_effects.js`
  - temporary local server on port `8033`
  - an 80s default-startup request probe observed `0` automatic requests for:
    - `special_regions.geojson`
    - `relief_overlays.geojson`
    - `city_overrides.json`
  - the removed eager paths were previously encoded directly in:
    - `prewarmScenarioOptionalLayersOnCacheHit(...)`
    - full-bundle eager optional-layer loading inside `loadScenarioBundle(...)`
    - startup-time visibility sync in `runPostScenarioApplyEffects(...)`
  - measured background transfer reduction on the removed eager path:
    - `special_regions.geojson` ≈ `0.00MB`
    - `relief_overlays.geojson` ≈ `0.78MB`
    - `city_overrides.json` ≈ `0.10MB`
    - total ≈ `0.88MB` less automatic startup transfer

- [x] Stage 6 completed:
  - `tools/build_startup_bundle.py` now emits startup bundle v2 with `startup_bootstrap_strategy = "chunked-coarse-first"`
  - `scenario.runtime_topology_bootstrap` is removed from the startup bundle payload
  - `js/workers/startup_boot.worker.js` now accepts startup bundles without embedded runtime topology
  - `js/core/scenario_resources.js` now preserves chunked-runtime startup metadata even when the startup bundle carries no runtime topology payload
  - `js/main.js` now treats `chunked-coarse-first` startup bundles as valid coarse-first startup instead of waiting for readonly detail unlock
- [x] Stage 6 validation completed:
  - `python -m py_compile tools/build_startup_bundle.py`
  - `node --check js/workers/startup_boot.worker.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/scenario_post_apply_effects.js`
  - `node --check js/core/scenario_manager.js`
  - `node --check js/main.js`
  - rebuilt `tno_1962` startup bundles and recorded report at `.runtime/reports/generated/tno_1962.startup_bundle_report.phase6.json`
  - startup bundle size change (`en`): `43.85MB -> 8.72MB` (**-35.13MB, about -80.1%**)
  - startup bundle gzip size change (`en`): `11.30MB -> 1.92MB` (**-9.38MB, about -83.0%**)
  - 15s interaction check on default startup passed:
    - `activeScenarioId = tno_1962`
    - `startupReadonly = false`
    - `bootOverlayHidden = true`
    - `interactionInfrastructureReady = true`
    - `#zoomInBtn` clickable
  - default startup probe showed chunked coarse-first handoff is active:
    - requested `detail_chunks.manifest.json`
    - requested `runtime_meta.json`
    - requested `mesh_pack.json`
    - requested `chunks/political.coarse.r0c0.json`
    - loaded chunk ids: `political.coarse.r0c0`, `water.coarse.r0c0`, `relief.coarse.r0c0`
  - measured default `/` startup after the phase-6 bundle cutover:
    - `total`: `11441.0ms`
    - `first-visible`: `5547.7ms`
  - compared with the original baseline before these optimizations:
    - `total`: `77625.9ms -> 11441.0ms` (**-66184.9ms, about -85.3%**)
    - `first-visible`: `7535.3ms -> 5547.7ms` (**-1987.6ms, about -26.4%**)
  - interpretation:
    - this is the first phase that materially changes both startup payload size and user-visible startup time
    - default startup now reaches a coarse-but-interactive scenario state first, then continues with chunked/runtime refinement later


## 结论和实施原则

这一轮性能提升不要碰 UI 结构回退，也不要动前面已经完成的数据正确性和安全收口。  
执行顺序固定为：

1. **先修 dev server 的缓存和压缩**
2. **再修启动链里的非必要前台工作**
3. **最后再收 startup bundle 和 full hydrate**

判断标准也固定：

- 优先让 **刷新成本** 先降下来
- 再让 **first-visible 到真正可交互** 的长尾缩短
- 最后才追求 **冷启动总时长** 的进一步下降

## 当前进度（2026-04-07）

### 已完成

- [x] 核对 verify timeout 修复对性能诊断的影响，确认它只是测试旁路，不是产品启动修复
- [x] 落地第 1 阶段的 server 侧改动：
  - `tools/dev_server.py`
  - 默认静态资源缓存从“全部 no-store”收敛为：
    - `/`、HTML、`/__dev/` 继续 `no-store`
    - 其他静态资源默认 `revalidate-static`
  - 大 JSON / TopoJSON 不再现场 `gzip.compress()`
  - 只有存在同名 `.gz` sidecar 时才回 `Content-Encoding: gzip`
- [x] 保持 `start_dev.bat` 不动

### 已验证

- 新 server 启动成功：`http://127.0.0.1:8001`
- `GET /`
  - `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
- `GET /data/scenarios/tno_1962/startup.bundle.en.json`
  - `Cache-Control: no-cache, must-revalidate`
- `GET /data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json`
  - `Cache-Control: no-cache, must-revalidate`
- `curl -I -H "Accept-Encoding: gzip" /data/scenarios/tno_1962/startup.bundle.en.json`
  - 返回 `Content-Encoding: gzip`
  - 返回预生成 sidecar 长度 `11850349`
- 本地请求耗时复测：
  - `startup.bundle.en.json`：约 `0.036641s`
  - `runtime_topology.bootstrap.topo.json`：约 `0.049861s`
- 浏览器侧本轮只确认了：
  - 新 server 能正常返回首页和 startup 关键资产
  - 完整启动链的体感改善需要等第 2 / 第 3 阶段再复测

### 本阶段未完成项

- [ ] 浏览器整条启动链仍然偏慢；这属于第 2 阶段和第 3 阶段处理范围
- [ ] `ready + 180ms` 的 full hydration 还没动
- [ ] readonly 解锁链和 interaction infrastructure 还没动
- [ ] startup bundle 内容还没瘦身

### 备注

- 当前 `.gz` sidecar 只覆盖 `startup.bundle.*.json`
- `runtime_topology.bootstrap.topo.json` 目前没有 sidecar，所以现在走“快速原始文件返回”，不再走现场 gzip
- 第 1 阶段的目标是先把“刷新和传输层放大器”拿掉，不是一次性解决整条启动链

## 当前进度

- [x] 第 0 阶段：确认 verify timeout 修复只影响 verify / smoke，不改写默认产品启动结论
- [x] 第 1 阶段：`tools/dev_server.py` 已完成第一轮止血
  - 默认缓存模式从“环境变量未设置时走 `nostore`”改成“默认走 `revalidate-static`，显式 `nostore` 只留给 fresh 场景”
  - `/`、HTML、非文件请求、`/__dev/` 继续 `no-store`
  - 大静态 JSON / TopoJSON 不再现场 `gzip.compress()`，优先直返现成 `.gz` sidecar
- [ ] 第 2 阶段：后移 `schedulePostReadyHydration()`
- [ ] 第 3 阶段：拆 `readonly` 解锁链
- [ ] 第 4 阶段：收 startup cache 与 optional layer 按需加载
- [ ] 第 5 阶段：startup bundle 真正瘦身

## 第 1 阶段验证结果

本轮实际改动文件：

- `tools/dev_server.py`

本轮明确未改：

- `start_dev.bat`
- `js/main.js`
- `js/core/data_loader.js`
- `js/core/scenario_resources.js`
- `js/core/map_renderer.js`

验证结论：

- 首页 `/` 仍然返回 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
- `js/main.js`、`startup.bundle.en.json`、`startup.bundle.en.json.gz`、`runtime_topology.bootstrap.topo.json` 已切到 `Cache-Control: no-cache, must-revalidate`
- `Accept-Encoding: gzip` 请求 `startup.bundle.en.json` 时，响应仍然带：
  - `Content-Encoding: gzip`
  - `Vary: Accept-Encoding`
  - `Content-Length: 11850349`
- 本地 patched dev server 下，关键资源请求耗时从“秒级 CPU 压缩等待”降到近乎纯磁盘读：
  - `startup.bundle.en.json`：约 `0.040806s`
  - `runtime_topology.bootstrap.topo.json`：约 `0.036601s`
- 首页请求 `http://127.0.0.1:8015/` 返回 `200`，说明这轮 server 侧改动没有把基本入口打坏

---

## 第 0 阶段：确认 verify timeout 修复是否改变基线

### 目标

确认新加的 `default_scenario` query override 只是测试旁路，不会误导后续性能修复。

### 相关文件

- `index.html`
- `js/main.js`
- `tests/e2e/scenario_apply_resilience.spec.js`
- `tests/e2e/support/playwright-app.js`
- `docs/VERIFY_SMOKE_SCENARIO_RESILIENCE_FIX_2026-04-07.md`
- `docs/archive/VERIFY_BOOT_TIMEOUT_REPAIR_2026-04-07.md`

### 实施步骤

1. 保留 `default_scenario` query override
2. 在性能文档里明确：
   - 它是 verify / smoke 的轻量旁路
   - 不是默认产品启动链的性能修复
3. 后续所有产品性能实测继续以默认 `/` 为基线
4. 需要轻量对照组时，再补充 `default_scenario=hoi4_1939` 的测试数据

### 验证

- 默认 `/` 启动路径不变
- `/?default_scenario=hoi4_1939` 仍能作为轻场景旁路使用
- 性能文档中不把 verify 修复误写成产品性能修复

---

## 第 1 阶段：先止血 —— 修 dev server 缓存和压缩

### 目标

让大静态 scenario 资源不再：

- 每次刷新都重新冷启动
- 每次请求都现场 `gzip.compress()`

这是收益最大、风险最低的一轮。

### 相关文件

- `tools/dev_server.py`
- `start_dev.bat`

### 改动方案

#### 1. 拆缓存策略

在 `tools/dev_server.py` 里把缓存策略拆成两类：

- **永远 no-store**
  - `/`
  - HTML
  - `/__dev/`
  - API 返回 JSON
- **允许 revalidate-static**
  - `data/scenarios/**`
  - `data/*.json`
  - `data/*.geojson`
  - `data/*.topo.json`
  - `vendor/*.js`
  - 其他不带副作用的静态文件

不要再让“所有静态资源默认 no-store”。

#### 2. 停止现场 gzip 大文件

当前 `_maybe_send_gzip_static()` 的问题不是“有没有 gzip”，而是“每次请求都现场压缩”。

改法：

- 优先判断是否存在预生成 sidecar：
  - `xxx.json.gz`
  - `xxx.topo.json.gz`
  - `xxx.geojson.gz`
- 如果 sidecar 存在：
  - 直接回传 sidecar
  - 不再读原始文件再 `gzip.compress()`
- 如果 sidecar 不存在：
  - 对小文件允许 fallback
  - 对超大文件直接禁用现场压缩，改为返回原始文件

#### 3. 调整启动模式默认缓存

`start_dev.bat` 默认分支现在只是 `run_server.bat`。  
建议：

- 默认分支就设置 `MAPCREATOR_DEV_CACHE_MODE=revalidate-static`
- `fresh` 继续保留 `nostore`
- `full` 继续先 build，再启动

这样：

- 日常刷新默认快
- 需要强制排查缓存问题时仍可用 `fresh`

### 验证

#### 手工验证

- 请求 `/` 时仍然 `no-store`
- 请求 `startup.bundle.en.json`、`runtime_topology.bootstrap.topo.json` 时不再 `no-store`
- 第二次刷新时浏览器不再完整重拉 startup 关键资产

#### 命令验证

- `curl -I` 看 `Cache-Control`
- 带 `Accept-Encoding: gzip` 请求时，确认不再出现超长 CPU 压缩等待

#### 成功标准

- `startup.bundle` 请求耗时明显下降
- `runtime_topology.bootstrap.topo.json` 请求耗时明显下降
- 刷新不再等同重新冷启动

---

## 第 2 阶段：缩短首屏关键路径

### 目标

把 “页面已可见” 到 “真正可交互” 之间的长尾缩短。

### 相关文件

- `js/main.js`
- `js/core/map_renderer.js`

### 改动方案

#### 1. 后移 `schedulePostReadyHydration()`

现在 `ready` 后 180ms 就跑：

- `ensureFullLocalizationDataReady()`
- `ensureActiveScenarioBundleHydrated()`

建议改成两步：

- 首先只记录“有待补载”
- 等到真正空闲时再执行

优先级建议：

1. `requestIdleCallback`
2. 用户首次打开重数据面板时触发
3. 如果浏览器不支持 idle，再 fallback 到更长延时

#### 2. 拆 `readonly` 解锁链

现在 `unlockStartupReadonlyWithDetail()` 把几件重事串在一起：

- detail promotion
- interaction infra
- ready 结束

建议拆成：

- **首屏必要**
  - 只保证基础地图操作和必要 scenario 状态
- **次级延后**
  - spatial index secondary
  - hit canvas after startup
  - 非关键索引预构建

#### 3. 调整 boot 指标含义

现在 console 里 `first-visible` 和 `total` 差距太大，但不够细。

建议多记录两个点：

- `boot-overlay-hidden`
- `readonly-unlocked`

这样能更清楚知道到底卡在哪一段。

### 验证

- 默认 `/` 下：
  - `first-visible`
  - `boot overlay` 消失
  - `readonly banner` 消失
  - `total`
  四个时间都要记录

#### 成功标准

- `boot overlay` 消失时间明显提前
- `readonly` 消失时间明显提前
- `first-visible -> total` 的长尾明显缩短

---

## 第 3 阶段：减少 ready 后的 full bundle 抢资源

### 目标

让 full hydrate 不再在页面刚 ready 时抢主资源。

### 相关文件

- `js/main.js`
- `js/core/scenario_resources.js`

### 改动方案

#### 1. 不再 ready 后立刻 full hydrate active scenario

`ensureActiveScenarioBundleHydrated()` 现在会触发 `bundleLevel: "full"`。  
建议改成：

- 首次进入需要 full 数据的面板时再触发
- 或 idle 后分段触发

#### 2. 取消 full bundle 默认 eager optional layers

当前 full bundle hydrate 后会根据默认可见性继续 eager load：

- water
- special
- relief
- cities

建议改成：

- 只有当前真正可见的层才加载
- 对默认显示但不在当前视口里不重要的层，改成懒加载

#### 3. 先保留现有数据结构，不动语义

这阶段只改“何时加载”，不改 payload 结构，不改 scenario apply 语义，不改 chunk 合并逻辑。

### 验证

- ready 后不再立刻请求 full runtime topology
- 打开相关面板或打开相关图层时，才补 full 数据
- Inspector / Project / Frontline / Utilities / Diagnostics 仍正常

#### 成功标准

- 默认首页 idle 时网络面板明显更安静
- 只有真正使用相关功能时才触发 full hydrate

---

## 第 4 阶段：收 startup bundle 内容

### 目标

把 startup bundle 从“接近完整场景 bootstrap 包”收回“启动包”。

### 相关文件

- `tools/build_startup_bundle.py`
- `data/scenarios/tno_1962/manifest.json`
- 相关 startup bundle 产物

### 改动方案

#### 1. 先做 bundle 内容审计

逐项检查 startup bundle 里的这些字段是否真的是首屏必需：

- `scenario.runtime_topology_bootstrap`
- `countries`
- `owners`
- `controllers`
- `cores`
- `geo_locale_patch`
- `apply_seed`

#### 2. 优先裁 `runtime_topology_bootstrap`

它是最大头。  
优先检查：

- 是否可以继续删非首屏对象
- 是否可以改成更轻的 bootstrap 版本
- 是否可以把一部分对象移到 deferred runtime load

#### 3. 让 startup localization 缓存重新稳定

保留 scenario-scoped 思路，但为这类 startup 文件单独做稳定 cache key，不要再直接跳过 persistent cache。

### 验证

- 重新生成 startup bundle 后，记录：
  - 原始大小
  - gzip 后大小
  - 冷启动时间
  - 第二次刷新时间

#### 成功标准

- startup bundle 大小明显下降
- 冷启动进一步下降
- 不影响默认 scenario 的正确应用

---

## 第 5 阶段：补验证和回归保护

### 目标

把这轮性能修复沉淀成不会轻易回退的约束。

### 相关文件

- `tests/e2e/support/playwright-app.js`
- 可能新增的 boot/perf contract 测试
- 现有 startup / scenario resilience 相关测试

### 改动方案

#### 1. 保留 verify 修复里的 boot snapshot 思路

这一部分已经有价值，不用回退。

#### 2. 新增轻量性能回归断言

不要写脆弱的“必须小于某毫秒”的硬阈值。  
改写成更稳的 contract：

- 默认 `/` 不应在 ready 后立刻补 full scenario hydrate
- 第二次刷新不应再次完整请求 startup bundle
- `boot overlay` 不应长时间保持可见

#### 3. 加文档内的基线表

每次大改 startup 链时，更新同一目录下的基线表，不再把性能判断只留在聊天记录里。

### 验证

- targeted e2e 串行执行
- 只跑和启动链、scenario resilience、boot 状态相关的测试
- 不并行跑长测试

---

## 推荐落地顺序

### 第一周可完成

1. 第 1 阶段：缓存头 + 预压缩 sidecar 优先
2. 第 2 阶段的一半：后移 post-ready hydration

### 第二周可完成

1. 第 2 阶段剩余：拆 readonly 解锁链
2. 第 3 阶段：full bundle 改按需

### 第三周再做

1. 第 4 阶段：startup bundle 真正瘦身
2. 第 5 阶段：补回归保护

---

## 风险控制

### 低风险

- 缓存头调整
- 优先返回 `.gz` sidecar
- 后移 post-ready hydration
- 保留 verify query override 作为测试旁路

### 中风险

- 拆 interaction infrastructure 的执行时机
- 取消 full bundle eager optional layers

### 高风险

- 调整 startup bundle 内容
- 修改 bootstrap topology 的裁剪边界

所以真正实施时，一定要按 **低风险 -> 中风险 -> 高风险** 的顺序推进，不要一口气把所有环节一起改掉。
