# QA-097：基础数据链路审计与整改建议

**日期**：2026-03-30  
**范围**：全基础链路，包括下载、爬取、API、机器翻译、手工补丁、场景派生、关键运行时依赖  
**结论一句话**：项目的数据基础不是“不能用”，但上游数据治理明显弱于下游产物治理；当前最大的漏洞不是某一份数据坏了，而是“很多原始源可变、不可追溯、不可复现，且质量校验偏浅”。  

---

## 1. 这次审计看了什么

本次审计同时对照了仓库现状和公开标准，不只看代码，也看上游数据发布方式。

### 本地审计对象

- `map_builder/config.py`：基础数据源注册表
- `map_builder/io/fetch.py`：下载、缓存、镜像回退、基础校验
- `map_builder/cities.py`：GeoNames + Natural Earth 城市合并链路
- `tools/translate_manager.py`：机器翻译入口
- `map_builder/contracts.py`：下游产物契约分类
- `data/manifest.json`：已发布产物清单
- `data/global_bathymetry.provenance.json`：现有 provenance 正面样本
- `tools/patch_tno_1962_bundle.py`：场景水域 provenance 正面样本

### 对照标准和官方来源

- W3C Data on the Web Best Practices  
  https://www.w3.org/TR/dwbp/
- W3C Spatial Data on the Web Best Practices  
  https://www.w3.org/TR/sdw-bp/
- W3C DCAT 3  
  https://www.w3.org/TR/vocab-dcat-3/
- W3C PROV Overview  
  https://www.w3.org/TR/prov-overview/
- RFC 7946 GeoJSON  
  https://www.rfc-editor.org/rfc/rfc7946
- Google Cloud Translation REST v2  
  https://cloud.google.com/translate/docs/reference/rest/v2/translate
- geoBoundaries API  
  https://www.geoboundaries.org/api.html
- GeoNames dump export  
  https://download.geonames.org/export/dump/
- NOAA ETOPO  
  https://www.ncei.noaa.gov/products/etopo-global-relief-model
- Natural Earth 1:10m cultural vectors  
  https://www.naturalearthdata.com/downloads/10m-cultural-vectors

---

## 2. 总结结论

### 结论

- 这个项目的**下游发布治理比上游源治理成熟得多**。
- 你现在最需要补的不是更多数据，而是**原始源的版本锚点、来源记录、checksum、语义校验和变更边界**。
- 如果现在直接替换一批现有数据，短期很可能会把 `topology`、`locale`、`city linkage`、`scenario contracts` 一起带坏。

### 为什么这么判断

- `data/manifest.json` 已经给下游产物写了 `sha256`、时间戳、对象类型和计数，这说明**发布侧可审计性不错**。
- `map_builder/contracts.py` 已经把数据分成 `source/manual/derived/publish/runtime-cache`，这说明**你已经有治理骨架**。
- `tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962` 当前能通过，说明**场景下游契约目前健康**。
- 但上游原始数据层面，`data/` 顶层 79 个文件里，按 `provenance.json / VERSION.txt / README.html` 这种明确 sidecar 算，只有 3 个。
- `map_builder/config.py` 里存在大量 `raw/main`、`@main`、`@master`、`api/records` 这类会漂移的入口。
- `map_builder/io/fetch.py` 的缓存逻辑是“本地有文件就直接信任”，没有 freshness、etag、checksum 再验证。

---

## 3. 关键发现

### F-01：大量上游源地址是可变入口，复现性有结构性漏洞

**等级**：高  

`map_builder/config.py` 里有大量如下入口：

- `github.com/.../raw/main/...`
- `cdn.jsdelivr.net/gh/...@main/...`
- `cdn.jsdelivr.net/gh/...@master/...`
- `zenodo.org/api/records/.../files/...`

本地证据：

- `map_builder/config.py:35` 使用 `france-geojson@master`
- `map_builder/config.py:39` 使用 `PolandGeoJson@main`
- `map_builder/config.py:42/48/.../512` 多处使用 geoBoundaries 的 `raw/main` 和 `@main`

这类入口的问题不是“今天一定坏”，而是：

- 你无法精确回答“这次构建到底用了哪一个版本”
- 同一个 URL 不同时间可能返回不同内容
- 镜像层还能再引入一次字节漂移
- 当上游 silently update 时，你本地缓存又会掩盖这个漂移，最后很难定位差异从哪里来

**最值得优先治理的数据集**

- geoBoundaries 的国家级补充行政边界
- France / Poland 这类社区仓库 GeoJSON
- 任何走 `current`、`main`、`master` 的地址

**建议**

- 优先把可变地址换成官方静态发布地址、归档版本地址、release URL 或 commit pin
- 至少为每个源记录 `immutable_ref + sha256`
- 不再把 `main/master` 分支 URL 当作可长期复现的基础源

---

### F-02：镜像回退策略提升了可用性，但削弱了来源清晰度

**等级**：高  

`map_builder/io/fetch.py:22-39` 会自动把 GitHub 类地址扩展成：

- `mirror.ghproxy.com`
- `raw.githubusercontent.com`
- `cdn.jsdelivr.net/gh/...`

这确实能提高下载成功率，但现在缺一件很关键的事：**没有记录最终命中了哪个地址**。

这会带来两个问题：

- 如果主源和镜像内容不同，你事后无法追责
- 如果镜像返回了陈旧内容，你看缓存文件名也不知道它来自哪里

**建议**

- 保留镜像回退，但必须记录 `resolved_source_url`
- 同时记录下载时间、HTTP 头、checksum
- 镜像只应该解决可用性，不应该成为 provenance 黑洞

---

### F-03：缓存把“已有文件”视为真相，缺少新鲜度和完整性再验证

**等级**：高  

`map_builder/io/fetch.py:100-102` 和 `map_builder/io/fetch.py:297-299` 的逻辑都很直接：

- 文件已存在就直接返回
- 二进制文件只做最小体积判断

这意味着：

- 本地文件一旦过时，不会主动提醒
- 内容一旦被外部手工替换，只要还能读，就会继续参与构建
- 你没有办法从构建记录里看出这是不是旧快照

这对“稳定开发”是方便的，但对“长期可维护和可审计”是弱的。

**建议**

- 给基础源增加 source ledger
- 至少记录 `fetched_at / source_url / sha256 / version_ref`
- 增加“强制重拉”和“只验证不重拉”两种模式

---

### F-04：当前源校验偏浅，只能拦住坏文件，拦不住坏语义

**等级**：高  

当前校验主要是：

- `_validate_json_bytes()`：只验证 JSON 能不能 parse
- `_validate_vector_archive_bytes()`：只验证压缩包能不能打开、GeoDataFrame 是否非空

本地证据：

- `map_builder/io/fetch.py:140-145`
- `map_builder/io/fetch.py:184-198`

这不够，因为对地理数据来说，“能读出来”远不等于“语义正确”。现在缺少的校验至少包括：

- CRS 是否符合预期
- 几何是否有效
- feature 数量是否低于安全阈值
- 关键字段是否齐全
- 主键或稳定 ID 是否还存在
- bbox / coverage 是否异常

RFC 7946 还明确要求 GeoJSON 使用 WGS84 经纬度。你当前下载层没有显式验证这件事。

**建议**

- 为高价值数据集增加专用 validator，而不是继续只靠通用 parse
- 城市点、行政区、多边形、水域、栅格分别定义最小语义约束

---

### F-05：原始源的 provenance 覆盖太薄，治理重心过度偏向下游产物

**等级**：高  

正面样本是有的：

- `data/manifest.json` 对发布产物写了 `sha256`
- `data/global_bathymetry.provenance.json` 记录了源数据、版本、路径、覆盖范围
- `tools/patch_tno_1962_bundle.py:332-349` 给 Marine Regions 明确写了 `source_url` 和 `license_url`

但这些正面样本没有被推广成统一制度。

本地证据：

- `data/manifest.json:1-60` 明显偏重 publish outputs
- `data/global_bathymetry.provenance.json:54-64` 已经是很好的原始源记录范式
- `tools/patch_tno_1962_bundle.py:338-349` 已经在场景链路里做了来源和许可绑定
- 顶层原始数据文件大多数没有任何 sidecar

**这说明什么**

- 你的团队已经知道 provenance 应该怎么做
- 问题不是不会做，而是没有把它推广成基础数据层的默认规则

**建议**

- 把 `global_bathymetry.provenance.json` 的做法推广成通用 sidecar 规范
- 把 `data/manifest.json` 的完整性思路前移到 raw source 层

---

### F-06：机器翻译链路使用的不是官方文档里的正式 API 入口

**等级**：高  

本地证据：

- `tools/translate_manager.py:927-943`
- `tools/translate_manager.py:1095-1123`

当前调用的是：

- `https://translate.googleapis.com/translate_a/single?...`
- 参数里带 `client=gtx`

而 Google Cloud 官方 REST 文档写的是：

- `translation.googleapis.com/language/translate/v2`
- 并要求 OAuth scope / Authorization

这意味着当前机器翻译链路存在几类风险：

- 文档不对齐，长期维护不可控
- 响应结构变化时，当前解析逻辑可能直接失效
- 法务和配额边界不清晰
- 以后要追溯“某条中文名是怎么来的”会很困难

**建议**

- 最稳的方案是切到官方 Cloud Translation API
- 如果暂时不切，至少把当前生成的翻译结果视作“已冻结派生产物”，给出生成时间、引擎说明和人工修订边界
- 不要继续把这个入口当成稳定基础设施

---

### F-07：城市链路本身不差，但它对上游漂移很敏感

**等级**：中高  

`map_builder/cities.py` 的思路其实是合理的：

- GeoNames + Natural Earth 双源合并
- 用 stable key 统一 city identity
- 再附着 political / urban 数据
- 最后生成 `world_cities.geojson` 和 `city_aliases.json`

本地证据：

- `map_builder/cities.py:344-366` 加载 GeoNames
- `map_builder/cities.py:369-420` 标准化 GeoNames
- `map_builder/cities.py:537-579` 合并 GeoNames 与 Natural Earth
- `map_builder/cities.py:1038-1039`、`1499-1527` 已经给产物写了 `version/generated_at`

但它对上游变化是敏感的：

- GeoNames 城市人口、别名、feature code 变化，会影响保留阈值和 capital 分类
- Natural Earth populated places 变化，会影响 merge 结果和 stable linkage
- urban / political 几何变化，会影响 nearest / within 附着结果

**建议**

- 不要轻易替换城市源
- 先补“源版本锚点 + 差异报告”
- 任何城市源调整都要带着 `world_cities.geojson`、`city_aliases.json`、capital hints 一起看 diff

---

### F-08：下游契约是当前最大的安全垫，不应该被上游替换工作绕过

**等级**：正面发现  

本地证据：

- `map_builder/contracts.py:13-17` 已经区分 `source/manual/derived/publish/runtime-cache`
- `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962` 当前返回 `OK`

这意味着最稳妥的整改顺序不是“先换源”，而是：

1. 先把上游治理补齐  
2. 再逐个替换高风险源  
3. 每次替换都跑下游契约和关键产物 diff  

这套顺序能最大限度避免把问题从 raw 层传导到 scenario/runtime 层。

---

## 4. 哪些数据集最值得优先优化

| 数据集/链路 | 当前问题 | 为什么值得优先改 | 直接改数据的风险 |
|---|---|---|---|
| geoBoundaries 补充行政边界 | 大量 `raw/main` / `@main` | 使用广、覆盖面大、影响行政区和场景边界 | geometry/feature drift 会直接影响 topology、owner/controller/core 映射 |
| France / Poland 社区 GeoJSON | 社区仓库分支地址可变，单点维护风险 | 可维护性和稳定性都偏弱 | 替换后可能引起区划 ID 和名称变化 |
| GeoNames `cities15000.zip` | 活数据源，当前无版本锚点和 checksum | 直接影响 `world_cities.geojson`、`city_aliases.json` 和 capital 行为 | 城市筛选、别名、capital 分类会漂移 |
| 机器翻译链路 | 非官方文档入口 | 容易断、难审计、难复现 | locale 内容变化可能影响搜索、别名和显示名称 |
| 大体量官方栅格和地表数据（ETOPO / PROBAV） | 源本身较正规，但本地 provenance 不统一 | 数据体积大，重建代价高，更需要强 provenance | 替换后可能影响水域、地形、渲染性能和体积 |

---

## 5. 如果现在修改现有数据，会有什么风险

### 行政区与几何风险

- feature 数量变化
- geometry 简化程度变化
- bbox 和 coverage 变化
- stable id 或派生 hash 变化
- 结果是 `topology`、`hierarchy`、`scenario ownership` 一起抖动

### 城市和别名风险

- 城市点合并结果变化
- capital 判定变化
- `city_aliases.json` 中 alias 到 stable key 的映射变化
- 结果是搜索、标签、capital hint、scenario override 都可能偏移

### 场景数据风险

- TNO 这类场景大量依赖既有 runtime political features 和 source feature ids
- 如果上游边界换了，`owners/controllers/cores` 这类映射很容易失配
- 当前严格校验能过，不代表源替换后还能过

### 可维护性风险

- 没有统一 source ledger 时，换完源以后很难讲清“为什么变了”
- 以后别人接手会把一次源替换误认为一次正常重建

### 法务与引用风险

- 没有 sidecar 时，后续很难判断引用义务和再分发边界
- 机器翻译链路尤其容易留下解释不清的空白

---

## 6. 最短路径整改路线

### 第一阶段：先补治理，不改数据内容

- 为所有关键 raw source 建立 `source ledger`
- 为重点源补 `provenance sidecar`
- 下载时记录 `resolved_source_url`
- 为高价值数据加 `sha256`
- 给下载层补“语义校验钩子”

这一阶段完成后，你至少能回答：

- 这份数据从哪里来
- 用的是哪个版本
- 是什么时候拉下来的
- 下游谁在消费它

### 第二阶段：只替换最不稳的源

- 先处理 `raw/main`、`@main`、`@master` 类地址
- 优先换成官方静态发布地址、release 地址、归档版本或 commit pin
- 这一阶段不要同时重做城市、行政区、翻译三条链路

### 第三阶段：再处理机器翻译和城市源

- 机器翻译切官方 API，或者明确冻结为离线派生产物
- 城市源替换必须带 diff 报告
- 每次变更都要看 `world_cities`、`city_aliases`、`locales`、scenario contract 一起过不过

---

## 7. 建议新增但尚未落地的最小治理结构

### `source ledger`

建议最少包含这些字段：

- `source_id`
- `local_path`
- `origin_kind`
- `upstream_url`
- `resolved_source_url`
- `immutable_ref`
- `fetched_at`
- `sha256`
- `license`
- `citation`
- `crs_or_encoding`
- `validator`
- `consumers`
- `rebuild_command`

### `provenance sidecar`

建议最少包含这些字段：

- `name`
- `version`
- `source`
- `license`
- `citation`
- `downloaded_at`
- `checksum`
- `notes`

---

## 8. 最终判断

### 现在的状态

- 你的数据基础**能支撑当前项目继续开发**
- 但它的主要稳定性是靠**本地缓存和下游契约**撑住的
- 不是靠“原始源可复现、可追溯、可验证”撑住的

### 这意味着什么

- 短期内你还能继续做功能
- 但只要开始大规模替换行政区、城市、翻译或地表数据，风险会快速放大
- 如果不先补治理，再好的新数据也会把维护成本抬高

### 最核心的一句话

你这个项目当前的问题，不是“数据量不够”，也不是“某个单点源坏了”，而是**基础数据层缺少统一的版本化 provenance 纪律**。  
先补这个，再动内容，才是最稳的最短路径。
