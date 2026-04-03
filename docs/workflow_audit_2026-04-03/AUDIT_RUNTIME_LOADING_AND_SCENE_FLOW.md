# 运行时加载、数据传输与场景流转专题审计

## 结论和修复方案

当前运行时链路已经具备 startup bundle、worker、chunked runtime 这些现代化部件，但它们还没有形成一个干净的数据生命周期。现在最该做的是把“启动期静态包”和“运行时动态状态”彻底分离。

建议直接按下面的目标模型收口：

1. startup bundle 只携带首帧必需 registry/meta/最小 payload。
2. viewport 驱动的 chunk promotion 只写 runtime state，不回写 bundle cache。
3. worker 只返回最小可传输对象；大 topology / decoded collection 尽量减少跨线程复制。
4. preload 只保留一条 happy path，不再让旧 preload 和 startup bundle 抢同一批资源。

## 当前真实链路

### shell 预加载

`index.html` 当前同时做了这些事：

- preload `data/europe_topology.json`
- preload `data/locales.startup.json`
- preload `data/geo_aliases.startup.json`
- preload `data/scenarios/index.json`
- preload `data/scenarios/tno_1962/manifest.json`
- modulepreload `js/main.js`
- 动态 preload `data/scenarios/${scenarioId}/startup.bundle.${language}.json(.gz)`

这已经不是单一 happy path，而是旧链和新链叠在一起。

## 已确认问题

### 1. startup shell 里存在重复 preload 和默认场景硬编码

证据：

- `index.html:16-20`
- `index.html:39-49`

问题：

- startup bundle 本来已经准备接管首屏数据
- 但页面仍然 preload 旧的 `europe_topology.json`、`locales.startup.json`、`geo_aliases.startup.json`
- 还硬编码 preload 了 `data/scenarios/tno_1962/manifest.json`

这会造成：

- 带宽竞争
- 首屏请求图谱复杂
- shell 对默认场景产生写死依赖

建议：

- 只保留 `modulepreload js/main.js`
- 再加一个按默认场景生成的 startup bundle preload
- 其余数据改由 startup bundle 命中后决定是否继续取

### 2. startup bundle 体积过大，已经不像“首帧包”

证据：

- `startup.bundle.en.json`: 45,984,688 bytes
- `startup.bundle.en.json.gz`: 11,850,349 bytes
- `startup.bundle.zh.json`: 45,994,637 bytes
- `runtime_topology.bootstrap.topo.json`: 36,838,791 bytes
- `runtime_topology.topo.json`: 37,208,603 bytes
- `data/locales.startup.json`: 3,699,009 bytes
- `data/geo_aliases.startup.json`: 2,435,083 bytes

问题：

- 这个量级已经不是“启动优化”
- 更像把大量运行时包提前打进 startup phase

建议：

- startup bundle 只保留：
  - 默认场景 manifest
  - owner/controller/country 最小首帧数据
  - startup runtime topology shell
  - UI 必需 locale key
- 其余按 layer / chunk / locale patch 延后

### 3. startup worker 与主线程之间重复搬运大对象

证据：

- `js/core/startup_worker_client.js:137` 使用 `worker.postMessage(...)`
- `js/core/startup_worker_client.js:150-163` 直接回传 `topologyPrimary`、`locales`、`geoAliases`、`decodedCollections`
- MDN 官方说明 worker message 数据默认是 copied rather than shared

问题：

- topology、locale、alias、decoded collections 都是大对象
- worker 解完再回传，主线程还要再持有一份
- 这会放大 structured clone 成本和内存峰值

建议：

- worker 只返回启动所需最小结构
- 大 payload 优先在 worker 内完成裁剪
- 能在主线程本地解的不要先在 worker 解一遍再回传
- 后续如果继续保留 worker-heavy 方案，优先考虑 transferable-friendly 数据结构

### 4. startup partial-cache 命中策略不对

证据：

- `js/core/data_loader.js:1055-1079` 先各自读 topology/localization cache
- `js/core/data_loader.js:1086` 只有 `!topologyPrimary && workerEnabled` 才走 worker

问题：

- 如果 topology cache hit 了，但 locales 或 geoAliases miss
- 当前逻辑不会走 worker partial 补齐
- 而是直接落回主线程 `loadLocalizationData(...)`

结果：

- partial cache 价值被削弱
- worker 和主线程路径分裂

建议：

- worker 条件改成“只要三者任一未命中就允许补齐”
- topology / locales / geoAliases 分别带 need flag 即可

### 5. chunk payload load 没有 promise 级去重

证据：

- `js/core/scenario_resources.js:1186-1214`
- 这里只做了：
  - 如果 `bundle.chunkPayloadCacheById[chunkId]` 已存在则直接返回
  - 否则写 `loadState.inFlightByChunkId[chunkId] = true`
- 但没有把 in-flight promise 本身缓存并复用

问题：

- 并发 refresh 命中同一 chunk 时，多个请求仍可能同时发起
- `inFlight=true` 只是状态标记，不是请求复用

建议：

- 增加 `bundle.chunkPayloadPromisesById[chunkId]`
- 同 chunk 正在加载时直接 await 同一个 promise

### 6. runtime chunk state 被写回 bundle

证据：

- `js/core/scenario_resources.js:1072-1091`
- `applyScenarioPoliticalChunkPayload(...)` 在写 `state.scenarioPoliticalChunkData` 的同时，也写：
  - `bundle.chunkMergedLayerPayloads.political = normalizedPayload`

问题：

- bundle 本应表示场景缓存态
- viewport 驱动的临时合成结果却被写回 bundle

后果：

- 下次 hydrate / refresh 很容易拿到旧 viewport 结果
- bundle cache 和 runtime state 边界被破坏

建议：

- bundle 只保留 immutable-ish source data
- 合成结果只写到 `state.activeScenarioChunkState`
- 如果确实要缓存，也要单独做 runtime cache，不要污染 scenario bundle

### 7. `preloadScenarioCoarseChunks()` 已存在，但未接主路径

证据：

- `js/core/scenario_resources.js:1126` 定义了 `preloadScenarioCoarseChunks(...)`
- 主 apply 路径仍主要走 `refreshActiveScenarioChunks(...)`

问题：

- 这条 coarse prewarm 路径已经能提前装一批 chunk
- 但没有真正并入 scenario apply 的主生命周期
- 属于“已经写了，但没有形成收益”的半成品优化

建议：

- 让 applyScenario 首次进入 full bundle 后，先跑 coarse chunk prewarm
- 然后再按 viewport 精细刷新

## 模块复杂度问题

证据：

- `js/main.js`: 1923 行
- `js/core/data_loader.js`: 1479 行
- `js/core/scenario_resources.js`: 2548 行

当前三个文件同时在承担：

- shell boot
- scenario apply
- runtime topology
- chunk lifecycle
- optional layer loading
- cache hit / miss
- worker coordination

建议按职责拆成：

- `startup_boot_pipeline.js`
- `scenario_bundle_cache.js`
- `scenario_chunk_runtime.js`
- `scenario_optional_layers.js`

## 证据定位

- `index.html:16`
- `index.html:20`
- `index.html:39`
- `js/core/startup_worker_client.js:137`
- `js/core/data_loader.js:1055`
- `js/core/data_loader.js:1086`
- `js/core/scenario_resources.js:1072`
- `js/core/scenario_resources.js:1126`
- `js/core/scenario_resources.js:1186`
- `js/core/scenario_resources.js:1258`

## 建议优先顺序

1. 去掉重复 preload 和默认场景硬编码 manifest preload
2. 把 startup bundle 缩到真正首帧粒度
3. 用 promise 去重修 chunk load
4. 把 viewport 合成结果从 bundle 中移走
5. 把 coarse prewarm 接入主 apply 链
6. 再拆 runtime loader 模块边界
