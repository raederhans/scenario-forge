# TNO startup bundle family 审计记录 2026-04-13

## 目标
- 审核 startup bundle family 的真实消费链、重复边界和下一步瘦身优先级
- 范围：`startup.bundle.en/zh(.gz)`、`locales.startup.json`、`geo_aliases.startup.json`、`geo_locale_patch*.json`
- 本轮不改运行时与产物，只做静态审计

## 关键事实

### 1. 默认启动路径谁在读
- `js/main.js`
  - 默认启动会通过 `getStartupScenarioSupportUrl(...)` 读取：
    - `locales.startup.json`
    - `geo_aliases.startup.json`
- `js/workers/startup_boot.worker.js`
  - 会直接读取 `startup.bundle.en/zh.json`
  - 并主动尝试对应的 `.json.gz`
- `js/core/startup_worker_client.js`
  - worker 路径是真正的默认 startup 入口，不是摆设

### 2. scenario apply / scenario bundle 路径谁在读
- `js/core/scenario_resources.js`
  - 会读取：
    - `startup_topology_url`
    - `detail_chunk_manifest_url`
    - `runtime_meta_url`
    - `mesh_pack_url`
    - `audit_url`
    - `geo_locale_patch_url(_en/_zh)`
- `js/core/scenario_manager.js`
  - scenario apply 会把：
    - `bundle.waterRegionsPayload`
    - `bundle.geoLocalePatchPayload`
    - `bundle.runtimeTopologyPayload`
    - `bundle.runtimePoliticalMeta`
    这些一起纳入 active scenario state

### 3. 当前文件大小
- `startup.bundle.en.json`：10.11 MB
- `startup.bundle.zh.json`：10.12 MB
- `startup.bundle.en.json.gz`：2.28 MB
- `startup.bundle.zh.json.gz`：2.31 MB
- `locales.startup.json`：3.54 MB
- `geo_aliases.startup.json`：2.32 MB
- `geo_locale_patch.json`：1.36 MB
- `geo_locale_patch.en.json`：0.51 MB
- `geo_locale_patch.zh.json`：0.52 MB

### 4. startup.bundle.en.json 内部体积分解
- `base.topology_primary`：4.63 MB
- `scenario.runtime_political_meta`：1.38 MB
- `base.geo_aliases`：1.24 MB
- `base.locales`：0.65 MB
- `scenario.geo_locale_patch`：0.51 MB
- `scenario.cores`：0.40 MB
- `scenario.owners`：0.37 MB
- `scenario.controllers`：0.37 MB
- `scenario.apply_seed`：0.37 MB
- `scenario.countries`：0.18 MB
- `scenario.runtime_topology_bootstrap`：接近 0 MB

### 5. startup.bundle 当前携带的数据规模
- `owners/controllers/cores`：各 12798 条
- `countries`：194 条
- `scenario.geo_locale_patch.geo`：11344 条
- `base.locales.geo`：11893 条
- `base.geo_aliases.alias_to_stable_key`：27750 条
- `runtime_political_meta.featureIds`：13195 条

## 审计结论

### 结论 1：startup family 的最大体积头不是 gzip，而是 payload 内容本身
- `.json.gz` 已经把 10MB 压到 2.3MB 左右，说明传输压缩已经有效
- 真正的大头是 bundle 里塞了太多启动时未必必须同时存在的内容

### 结论 2：最可疑的重复边界是这 3 组
1. `base.topology_primary` vs 已有 runtime / chunk 启动壳
2. `base.locales + base.geo_aliases` vs `scenario.geo_locale_patch`
3. `owners/controllers/cores + runtime_political_meta + apply_seed` 之间的重复角色

### 结论 3：当前最不该先动的是 `.json.gz`
- `.json.gz` 是 worker 真会用的 sidecar
- 现在它不是问题根源，反而是有效压缩手段
- 如果先删 `.gz`，只会让 startup 退化

### 结论 4：下一步最安全的瘦身边界，不是 startup bundle 整体重做，而是先做“角色拆账”
应先明确：
- 哪些字段是 startup first paint 必须
- 哪些是 startup 后可延后 hydrate
- 哪些与 `geo locale patch` / `startup locales` / `geo aliases` 重复

## 推荐的下一步实现顺序

### 第一优先：startup bundle 内部角色拆账
先做专项设计，不直接删文件：
- 锁清 `base.topology_primary` 在 startup bundle 里的最小必要子集
- 锁清 `base.locales / base.geo_aliases / scenario.geo_locale_patch` 的职责边界
- 锁清 `owners/controllers/cores/apply_seed/runtime_political_meta` 中哪些必须首屏带上

### 第二优先：geo locale family
- 因为它和 startup bundle 是强耦合边界
- 它不是独立小文件，而是 startup 重建链的一部分

### 第三优先：detail chunks family
- 风险更高，应该在 startup family 边界弄清之后再动

## 当前建议
- 下一轮如果真的要落手实现，推荐目标不是“删一个文件”，而是：
  **先做 startup bundle family 的 consumer matrix + 最小启动字段矩阵，然后再做第一刀瘦身。**
- 这一步如果做对，后面再处理 `geo locale` 和 `detail chunks` 会稳很多。
