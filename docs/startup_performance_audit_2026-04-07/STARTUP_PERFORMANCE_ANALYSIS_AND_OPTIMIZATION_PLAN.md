# Startup Performance Analysis and Optimization Plan

## 执行进度
- [x] 读取已有启动链与 UI 留档
- [x] 检查最近多轮 commit 对启动链的影响
- [x] 静态审查 `start_dev.bat` / `tools/dev_server.py` / `js/main.js` / `js/core/data_loader.js` / `js/core/scenario_resources.js` / `js/core/scenario_manager.js`
- [x] 实测当前默认启动路径的关键耗时
- [x] 汇总兼容现有 UI / 数据 / 安全修复的优化方案

## 结论和修复方向
当前启动慢的主因不是单纯 UI，而是下面 5 件事叠在一起：

1. **超大 startup 资源进入首屏关键路径**
2. **dev server 默认对静态资源返回 `no-store`**
3. **dev server 对大 JSON / TopoJSON 请求时现做 gzip**
4. **readonly 启动后还要继续做 detail promotion 和 interaction infrastructure**
5. **ready 后马上又触发 full hydration**

本轮优化方向不回退 UI，也不回退前面的数据修复和安全收口。最短路径是：

1. **先修传输与缓存**
2. **再缩短首屏关键路径**
3. **最后把 ready 后的 full hydration 真正后置或改成按需**


详细执行拆分见：

- docs/startup_performance_audit_2026-04-07/STARTUP_PERFORMANCE_EXECUTION_STEPS_2026-04-07.md
---

## 一、审计范围

本次分析基于以下留档和代码路径：

- `docs/workflow_audit_2026-04-03/AUDIT_BUILD_AND_STARTUP.md`
- `docs/UI_AUDIT_2026-04-05.md`
- `docs/UI_REWORK_DISCUSSION_2026-04-05.md`
- `docs/UI_REWORK_EXECUTION_PLAN_01_FOUNDATION_AND_CONTRACTS_2026-04-05.md`
- `docs/UI_REWORK_EXECUTION_PLAN_02_MAINLINE_SHELL_AND_SIDEBAR_2026-04-05.md`
- `docs/UI_REWORK_EXECUTION_PLAN_03_SUPPORT_SURFACES_TRANSPORT_AND_HARDENING_2026-04-05.md`
- `start_dev.bat`
- `tools/dev_server.py`
- `index.html`
- `js/main.js`
- `js/core/data_loader.js`
- `js/core/scenario_resources.js`
- `js/core/scenario_manager.js`
- `js/core/map_renderer.js`
- `js/core/startup_cache.js`
- `js/core/startup_worker_client.js`
- `js/workers/startup_boot.worker.js`
- `data/scenarios/tno_1962/manifest.json`

重点 commit：

- `f0f5762` 完整修复
- `6b766f5` fix 1939 scenario
- `76fa87b` 加载 OMX，完善 UI 计划
- `4b0fbdd` 大改 UI
- `d48206a` 修改一下启动方式

---

## 二、当前启动链

### 1. 本地启动入口

- `start_dev.bat`
  - 默认模式：直接 `run_server.bat`
  - `fast`：`startup_interaction=readonly&startup_worker=1&startup_cache=1`
  - `fresh`：`startup_interaction=full&startup_worker=0&startup_cache=0`
  - `full`：先 `build_data.bat` 再 `run_server.bat`
- 关键位置：`start_dev.bat:5-36`

### 2. 服务端

- `run_server.bat` 只负责启动 `tools/dev_server.py`
- dev server 默认端口范围：`8000-8030`
- dev server 负责：
  - 返回页面和静态资产
  - 设置缓存头
  - 在请求时对 `.json/.geojson/.topo.json` 做 gzip 压缩
- 关键位置：`tools/dev_server.py:2256-2332`

### 3. 页面入口

- `index.html` 只保留 3 个脚本入口：
  - `vendor/d3.v7.min.js`
  - `vendor/topojson-client.min.js`
  - `js/main.js`
- 页面还包含：
  - `bootOverlay`
  - `startupReadonlyBanner`
- 关键位置：`index.html:1999-2026`

### 4. 浏览器启动主链

`js/main.js` 的默认启动路径大致是：

1. 读 query 参数，决定 `startup_interaction`
2. 并发准备默认 scenario id
3. 通过 worker 拉 `startup.bundle.<lang>.json`
4. 用 startup bundle 里的 base 数据覆盖 `loadMapData()` 的 startup 路径
5. 初始化地图与基础渲染
6. 应用默认 scenario bootstrap bundle
7. 显示首屏
8. 如果是 readonly，则继续做：
   - detail promotion
   - interaction infrastructure
9. ready 后 180ms 再触发：
   - full localization hydration
   - full scenario bundle hydration

关键位置：

- `js/main.js:522-530`：默认 `startup_interaction=readonly`
- `js/main.js:849-860`：延迟加载 toolbar / sidebar / scenario controls / shortcuts
- `js/main.js:1640-1744`：拉 startup bundle + startup support 文件
- `js/main.js:1397-1479`：readonly 解锁链
- `js/main.js:1065-1075`：ready 后立即 full hydration

---

## 三、实测基线

### 1. 默认 `/` 启动实测

在当前本地环境下，默认 `/` 的 console boot metrics 为：

- `first-visible`：**7535.3ms**
- `first-visible-base`：**7535.3ms**
- `scenario-bundle`：**7539.4ms**
- `base-data`：**1690.3ms**
- `total`：**77625.9ms**

这说明现在不是“页面完全黑屏 1 分钟”，而是：

- **约 7.5 秒时页面已经可见**
- **但真正完成整个启动链仍要约 77.6 秒**

也就是用户会感到：

- 先能看到页面
- 然后还要继续等 readonly 解锁、detail promotion、interaction infra、ready 后补载

### 2. 大资源请求实测

dev server 当前在本地对大静态 JSON 的处理结果：

| 资源 | 体积 | 请求方式 | 耗时 |
|---|---:|---|---:|
| `startup.bundle.en.json` | 43.85 MB | 无 gzip | 0.039s |
| `startup.bundle.en.json` | 43.85 MB | `Accept-Encoding: gzip` | 6.13s |
| `runtime_topology.bootstrap.topo.json` | 35.13 MB | `Accept-Encoding: gzip` | 3.77s |

这里最关键的不是“网络慢”，而是 **服务端现压 gzip 的 CPU 成本太高**。

### 3. 当前响应头

当前首页和 startup 关键资源都返回：

- `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`

这意味着：

- 刷新几乎等同重新冷启动
- 浏览器无法稳定复用这些重资产

关键位置：`tools/dev_server.py:2262-2286`

---

## 四、关键资产体积

### 1. startup 首屏相关

| 文件 | 体积 |
|---|---:|
| `data/scenarios/tno_1962/startup.bundle.en.json` | 43.85 MB |
| `data/scenarios/tno_1962/startup.bundle.zh.json` | 43.86 MB |
| `data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json` | 35.13 MB |
| `data/scenarios/tno_1962/runtime_topology.topo.json` | 35.48 MB |
| `data/scenarios/tno_1962/detail_chunks.manifest.json` | 0.13 MB |
| `data/scenarios/tno_1962/context_lod.manifest.json` | 0.04 MB |

### 2. startup.bundle 内部拆分

`startup.bundle.en.json` 顶层拆分结果：

- `base`：**7.58 MB**
- `scenario`：**39.60 MB**

其中最大头是：

| 启动包内部字段 | 体积 |
|---|---:|
| `scenario.runtime_topology_bootstrap` | 37.25 MB |
| `base.topology_primary` | 5.62 MB |
| `base.geo_aliases` | 1.29 MB |
| `base.locales` | 0.68 MB |
| `scenario.geo_locale_patch` | 0.55 MB |
| `scenario.cores` | 0.43 MB |
| `scenario.apply_seed` | 0.40 MB |
| `scenario.owners` | 0.39 MB |
| `scenario.controllers` | 0.39 MB |

结论很直接：**启动包已经把一个几乎完整的 scenario bootstrap 直接塞进首屏路径了。**

### 3. ready 后还会继续拉的 full 资源

| 文件 | 体积 |
|---|---:|
| `data/locales.json` | 7.88 MB |
| `data/geo_aliases.json` | 9.66 MB |
| `data/world_cities.geojson` | 23.82 MB |
| `data/city_aliases.json` | 29.67 MB |
| `data/scenarios/tno_1962/runtime_topology.topo.json` | 35.48 MB |
| `data/scenarios/tno_1962/audit.json` | 2.45 MB |
| `data/scenarios/tno_1962/water_regions.geojson` | 2.22 MB |
| `data/scenarios/tno_1962/relief_overlays.geojson` | 0.78 MB |

---

## 五、最近改动带来的影响

### 0. 2026-04-07 verify timeout 修复对本诊断的影响

这次 verify 修复主要做了 3 件事：

- 允许通过 `default_scenario` query 覆盖默认启动场景
- 让 `scenario_apply_resilience.spec.js` 直接从 `hoi4_1939` 启动，而不是先吃默认 `tno_1962`
- 给 `waitForAppInteractive()` 补 boot state snapshot，方便超时诊断

关键位置：

- `index.html:19-28`
- `js/main.js:353-366`
- `tests/e2e/scenario_apply_resilience.spec.js`
- `tests/e2e/support/playwright-app.js`

这对当前性能诊断 **没有推翻性的影响**，原因是：

- 它解决的是 **CI / verify 用例超时**
- 它没有减小默认产品启动路径里的 `startup.bundle`、`runtime_topology.bootstrap`、`readonly 解锁链`、`post-ready full hydration`
- 它只是新增了一个 **测试和诊断可用的轻场景启动旁路**

因此，本文关于默认启动性能的结论保持不变；但后续执行方案里可以把 **`default_scenario` 旁路** 当成低风险验证手段，而不是当成真正的产品修复。

### 1. `start_dev.bat` 已经不再默认 full rebuild

这是正确改动，说明现在的主要慢点已经不是“每次都先 build_data”。

关键位置：`start_dev.bat:5-36`

### 2. startup localization 改成 scenario-scoped 路径

`js/main.js` 现在会显式把下面两个文件塞进 `loadMapData()`：

- `data/scenarios/<scenario>/locales.startup.json`
- `data/scenarios/<scenario>/geo_aliases.startup.json`

关键位置：`js/main.js:1736-1744`

这件事本身是为了让 startup 资源边界更清晰，但它也带来一个副作用：

- `js/core/data_loader.js` 会把这类 scenario-scoped startup 文件标成 `scenario-scoped`
- 并跳过原来的 localization persistent cache key

关键位置：`js/core/data_loader.js:692-709`、`1017-1041`

### 3. startup bundle 成了浏览器默认启动链的核心

`js/main.js:1640-1689` 现在先走 `loadStartupBundleViaWorker()`，再把结果转成：

- `startupBootArtifactsOverride`
- `createStartupScenarioBundleFromPayload(...)`

这让启动路径更统一，但也把 **43MB+ 的 startup bundle** 直接拉进了默认入口。

### 4. readonly 启动把“看到页面”和“可交互完成”分成两段

`js/main.js:1397-1479` 会在页面可见之后继续做：

- `ensureDetailTopologyReady(...)`
- `buildInteractionInfrastructureAfterStartup(...)`

这使得：

- `first-visible` 比较早
- `total` 很晚才结束

### 5. ready 后又立刻 full hydration

`js/main.js:1065-1075` 在 ready 后 180ms 就跑：

- `ensureFullLocalizationDataReady()`
- `ensureActiveScenarioBundleHydrated()`

这一步没有再给页面“喘口气”，而是立刻开始下一轮大资源加载。

---

## 六、根因排序

### 根因 1：dev server 默认 `no-store`

影响最大，因为它会把刷新稳定地放大成“重新冷启动”。

证据：

- `tools/dev_server.py:2256-2286`
- 当前首页和 startup 关键资源的响应头全是 `no-store`

### 根因 2：dev server 对大 JSON / TopoJSON 现场 gzip

这会把本来应该是“磁盘读 + 发送”的流程，变成“磁盘读 + CPU 压缩 + 发送”。

证据：

- `tools/dev_server.py:2301-2332`
- 实测 `startup.bundle.en.json` gzip 请求约 6.13s
- 实测 `runtime_topology.bootstrap.topo.json` gzip 请求约 3.77s

### 根因 3：startup bundle 过大

当前 startup bundle 已经不是“轻量首屏包”，而是“接近完整场景 bootstrap 包”。

证据：

- `data/scenarios/tno_1962/startup.bundle.en.json` 43.85 MB
- 其中 `scenario.runtime_topology_bootstrap` 37.25 MB
- `js/workers/startup_boot.worker.js:320-399`

### 根因 4：readonly 解锁链过长

`boot overlay` 结束后，仍要继续做 detail promotion 和 interaction infra。

证据：

- `js/main.js:1397-1479`
- `js/core/map_renderer.js:7752-7789`

### 根因 5：ready 后立即 full hydration

页面刚 ready 就又开始 full localization 和 full scenario bundle hydrate，导致用户感知上“页面虽然出来了，但系统还在重活”。

证据：

- `js/main.js:1065-1075`
- `js/main.js:948-1063`
- `js/core/scenario_resources.js:2110-2475`

### 次级因素：UI 模块体积增加

UI 不是主因，但确实有次级拖累：

| 文件 | 体积 |
|---|---:|
| `index.html` | 139151 B |
| `css/style.css` | 165652 B |
| `js/main.js` | 72189 B |
| `js/ui/toolbar.js` | 410546 B |
| `js/ui/sidebar.js` | 384487 B |

`js/main.js:849-860` 会并发 import 它们。  
这会增加模块解析和初始化成本，但和前面的 35-45MB 级数据加载相比，不是 1 分钟问题的第一责任人。

---

## 七、兼容现有改动的优化方案

### 第一阶段：先止血

#### 1. 调整 dev server 缓存策略

目标：不要让每次刷新都重新冷启动。

建议：

- HTML 和 `/__dev/` 继续 `no-store`
- 体积大的 scenario 静态资源改成 `revalidate-static`
- 至少让以下资源可以稳定走浏览器缓存：
  - `startup.bundle.*.json(.gz)`
  - `runtime_topology.bootstrap.topo.json`
  - `runtime_topology.topo.json`
  - `detail_chunks.manifest.json`
  - `context_lod.manifest.json`

改动入口：

- `tools/dev_server.py:2256-2286`

#### 2. 停止对大静态 JSON 现场 gzip

目标：去掉服务端 CPU 压缩开销。

建议：

- 优先直接命中现成 `.gz` sidecar
- 只有不存在 sidecar 时，才允许 fallback
- 对超大文件直接禁用现场 gzip fallback

改动入口：

- `tools/dev_server.py:2301-2332`
- 现有 sidecar 已存在：`startup.bundle.en.json.gz`、`startup.bundle.zh.json.gz`

### 第二阶段：缩短首屏关键路径

#### 3. 不要让 ready 后 180ms 立刻 full hydrate

目标：让“页面已经可见”之后，先进入稳定可操作状态，再补 full 资源。

建议：

- `schedulePostReadyHydration()` 不要固定 180ms 就跑
- 改为：
  - 空闲时触发
  - 或首次进入相关面板时触发
  - 或用户首次切语言 / 打开 Inspector 深层数据时触发

改动入口：

- `js/main.js:1065-1075`

#### 4. 缩短 readonly 解锁链

目标：减少 `first-visible -> total` 之间的长尾。

建议：

- `detail promotion` 只做最必要部分
- `interaction infrastructure` 拆成：
  - 首屏必要
  - 次级可延后
- `buildHitCanvasAfterStartup()` 和 secondary spatial index 进一步后移

改动入口：

- `js/main.js:1397-1479`
- `js/core/map_renderer.js:7752-7789`

### 第三阶段：结构优化

#### 5. 重新审查 startup bundle 内容

目标：把 startup bundle 收回“启动包”，不要继续逼近 full scenario bundle。

优先检查：

- `scenario.runtime_topology_bootstrap` 是否还能继续裁剪
- `apply_seed` 是否还能去重
- 是否必须在 startup 包里同时放 owners / controllers / cores 全量

改动入口：

- `tools/build_startup_bundle.py:260-354`

#### 6. 让 scenario-scoped startup localization 回到稳定缓存路径

目标：保留现在的 scenario 边界，但不要把 persistent cache 命中率打掉。

建议：

- 为 scenario-scoped startup locales / aliases 单独定义稳定 cache key
- 不再因为路径变化直接放弃 localization persistent cache

改动入口：

- `js/core/data_loader.js:1017-1181`
- `js/core/startup_cache.js`

#### 7. 避免 full bundle 默认 eager load optional layers

当前 full bundle hydrate 会根据默认可见性继续 eager load：

- water
- special
- relief
- cities

关键位置：

- `js/core/scenario_resources.js:1395-1412`
- `js/core/scenario_resources.js:2449-2475`

建议：

- 把 eager load 改成真正“用户可见时再拉”
- 或只保留一层非常轻的 preload，不做完整 payload 解析

---

## 八、推荐执行顺序

### 第一轮

1. 改 dev server 缓存头
2. 去掉大静态文件现场 gzip
3. 复测默认 `/` 和刷新

预期收益：

- 立刻降低刷新成本
- 第二次进入不再像首次冷启动

### 第二轮

1. 后移 `schedulePostReadyHydration()`
2. 后移部分 interaction infrastructure
3. 复测 `first-visible`、readonly 消失时间、`total`

预期收益：

- 明显缩短“页面已经出来，但还在忙”的体感

### 第三轮

1. 收 startup bundle 内容
2. 恢复 scenario-scoped startup localization 的缓存命中
3. 收 full bundle eager optional layer 策略

预期收益：

- 冷启动和刷新都进一步下降
- 启动链更稳定、更可预测

---

## 九、验证标准

后续每轮优化都只看下面这些指标：

### 启动指标

- `first-visible`
- `boot overlay` 消失时间
- `startup readonly banner` 消失时间
- `total`

### 网络指标

- 第二次刷新时是否重新请求：
  - `startup.bundle.*`
  - `runtime_topology.bootstrap.topo.json`
  - `runtime_topology.topo.json`

### 行为指标

- 默认 scenario 仍能正常应用
- Inspector / Project / Frontline / Utilities / Diagnostics 正常
- Transport 入口和 support surface 不回退
- 语言切换、scenario apply、ownership/controller/core 相关行为不回退
- 之前的数据/安全修复不回退

---

## 十、与旧留档的关系

下面这些旧结论今天仍然成立：

- `docs/workflow_audit_2026-04-03/AUDIT_BUILD_AND_STARTUP.md`
  - 默认 dev 启动不该等同全量 rebuild
  - startup 资产链应收口
  - startup / build / publish 边界要清楚

- `docs/UI_AUDIT_2026-04-05.md`
  - boot overlay 会打断“直接进入工作区”的心理预期
  - readonly banner / boot overlay / context bar 的反馈层分散

但新的核心变化是：

- 现在最主要的问题已经从“构建入口混乱”变成了 **浏览器首屏路径过重 + 服务端缓存/传输策略放大代价**

---

## 附录：关键文件

- `start_dev.bat`
- `tools/dev_server.py`
- `index.html`
- `js/main.js`
- `js/core/data_loader.js`
- `js/core/scenario_resources.js`
- `js/core/scenario_manager.js`
- `js/core/map_renderer.js`
- `js/core/startup_cache.js`
- `js/core/startup_worker_client.js`
- `js/workers/startup_boot.worker.js`
- `tools/build_startup_bundle.py`
- `data/scenarios/tno_1962/manifest.json`
