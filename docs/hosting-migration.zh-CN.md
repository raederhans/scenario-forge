# 托管迁移手册（准备稿）

本文是迁移方案和操作清单，**当前不切换**：线上仍是 GitHub Pages。写下来是为了在需要时（产物再逼近 1 GiB、需要 brotli 或长缓存）能按步骤直接执行。数字来自 2026-11-07 的体积与加载测量。

## 1. 现状与约束

| 项 | GitHub Pages 现状 |
|---|---|
| 压缩 | 只有 gzip（请求 `br`/`zstd` 也只给 gzip），压缩级别低于 gzip-6 |
| 缓存头 | 所有文件 `Cache-Control: max-age=600`，不可配置 |
| ETag | `"<mtime>-<size>"`（gzip 时加 `W/`），mtime 是**部署时刻**：Pages 部署时会重设所有文件的 mtime，产物里的 mtime 不生效（2026-11-07 实测：构建时按内容写入 mtime 后，线上两个不同文件的 ETag mtime 仍都等于部署时间）。因此每次部署后所有文件的 ETag 都会变，回访用户全量重下，在 Pages 上无法解决 |
| 产物上限 | 1 GiB（`tools/build_pages_dist.py` 的 `MAX_PAGES_DIST_BYTES`，告警线 950 MiB） |
| 产物规模 | 约 11,300 个文件；最大单文件 `europe_topology.na_v2.json` 87.8 MiB |
| Service Worker | 无 |

迁移想解决的三件事：

1. **传输体积**：brotli-11 比 Pages 的 gzip 再少约 26%（TNO 冷启动 73 → 约 54 MB）。
2. **回访缓存**：每次部署后所有 ETag 都变，回访等于冷启动（TNO 约 73 MB）；不部署时 600 s 后每个文件也要一次条件请求（TNO 约 130 个往返）。内容哈希文件名配合 `immutable` 可以做到回访 0 往返，这只能在迁移后（或用 Service Worker）实现。
3. **产物上限**：大件（GHSL 人口层 161.8 MB 等）移出站点产物后不再受 1 GiB 限制。

## 2. 候选方案

### A. Cloudflare Pages 整站托管

- 优点：自动 brotli；`_headers` 文件可按路径设置缓存头；免费额度够用；自带预览部署。
- 硬限制：**单文件 25 MiB**；文件数免费版 20,000（付费版在新文档里是 100,000）。现有产物有 5 个文件超过 25 MiB：

  | 文件 | 大小 |
  |---|---:|
  | `app/data/europe_topology.na_v2.json` | 87.8 MiB |
  | `app/data/scenarios/tno_1962/water_regions.geojson` | 33.1 MiB |
  | `app/data/europe_topology.runtime_political_v1.json` | 32.8 MiB |
  | `app/data/scenarios/modern_world/runtime_topology.topo.json` | 31.5 MiB |
  | `app/data/scenarios/blank_base/runtime_topology.topo.json` | 30.1 MiB |

  这些文件必须先放到 R2（方案 B），或在发布时只发 `.gz`、量化后压到 25 MiB 以下。坐标精度和停载 na_v2 的工作完成后再复核这张表。
- 适合：想一次性拿到 brotli 和可控缓存头，并且愿意把大件放到对象存储。

### B. 应用壳留在原处，大数据放 Cloudflare R2（推荐的第一步）

- 做法：站点（HTML/JS/CSS、小数据）继续由 GitHub Pages 或 Cloudflare Pages 提供；`data/` 下的大文件上传到 R2 桶，绑定自定义域名（经 Cloudflare CDN 缓存，可设缓存规则和 brotli）。运行时用**数据基址**（第 4 节）把 `data/...` 指向该域名。
- 价格：标准存储 $0.015/GB·月，出口流量免费；每月免费 10 GB 存储、100 万次 A 类操作、1000 万次 B 类（读取）操作。全部数据约 1 GB，基本落在免费额度内。
- 必须配置 **CORS**：允许站点源的 `GET`/`HEAD`，暴露 `ETag`、`Content-Length`、`Content-Encoding`。Worker 里的 `fetch` 用的是 `credentials: "same-origin"`，跨源请求不带 Cookie，不需要 `Allow-Credentials`。
- 适合：先解决 1 GiB 限制和大件的长缓存，改动面最小。

### C. 保持 GitHub Pages，只把人口层外置

- GHSL 人口层（`data/thematic_layers/population/ghsl_population_2020_v1/`，161.8 MB，676 个瓦片，按需加载）是最大的单一可外置件。
- 外置到 R2 即可；**不建议用 GitHub Release 资产**：下载会重定向到另一个域名，且不保证返回 CORS 头，浏览器 `fetch` 读不到内容（上线前须实测，未实测前按不可用处理）。
- 收益：产物 −162 MB；传输不变（按需加载）。

## 3. 推荐路线

1. 先做方案 C（只外置人口层），验证数据基址、CORS、缓存头这条链路。
2. 链路稳定后把 na_v2、剧本分片等大件也放到 R2（方案 B），站点产物降到几百 MB。
3. 需要 brotli 和长缓存时，再把应用壳迁到 Cloudflare Pages（方案 A），同时启用内容哈希文件名。
4. Service Worker 最后考虑（第 7 节）。

## 4. 数据基址

运行时数据 URL 都写成仓库相对路径（`data/...`，例如 manifest 里的 `startup_bundle_url_en`、分片 `url`、人口层 `overview_url`）。`js/core/data_base_url.js` 让它们在**发请求的那一刻**经同一个基址解析：

- 默认基址为空 → 与迁移前完全相同（返回同一个 URL 字符串，fetch 参数不变）。
- 配置方式：页面 `<head>` 里加 `<meta name="scenario-forge-data-base" content="https://data.example.org/scenario-forge/v1/">`。只接受 `http://`/`https://` 绝对地址，没有尾斜杠时自动补上。
- 解析规则：`data/xxx` 或 `./data/xxx` → `<基址>data/xxx`；绝对 URL、协议相对、根相对、`blob:`、非 `data/` 的相对路径原样透传。外部桶里保持与产物 `app/` 下相同的目录结构，manifest 内的相对 URL 无需改写。
- Worker：启动 Worker 收到的是主线程已解析好的绝对 URL；模块本身不访问 `document`，在 Worker 中可显式传入基址调用 `resolveDataUrl(url, base)`。
- 图片：旗帜、单位图标在 URL 被改写为外部地址时自动设置 `crossOrigin = "anonymous"`，否则进 canvas 会污染画布（导出失败）。

已在本地用"页面源 + 带 CORS 的独立数据源"实测：tno_1962、hoi4_1936、blank_base 都能启动到可编辑，数据请求全部走数据源。

已知限制（切换前要处理）：

| 项 | 现状 | 切换时的做法 |
|---|---|---|
| 政区 ID 栅格（`*.pidr.gz` 及其 manifest） | `political_id_raster_assets.js` 刻意只接受同源 URL（`mode: 'same-origin'` 并校验响应 URL） | 先随应用壳留在同源；要外置时放宽同源校验，改为依赖 manifest 中已有的 sha256 校验 |
| `index.html` 的 `<link rel="preload" href="data/scenarios/index.json">` | 写死相对路径 | 构建注入基址 meta 时一并改写 preload 地址 |
| JSON 模块导入（`data/CATALOG.json`、`data/runtime_asset_registry.json`、专题层清单等 9 个） | 由 `import … with { type: "json" }` 加载，Pages 构建时被 esbuild 打进代码包 | 属于代码，随应用壳发布，不外置 |
| 开发端点、落地页、`apps/hgo` | 未接入 | 不随数据外置 |

## 5. brotli

- Cloudflare 对 JSON/JS/CSS 等可压缩类型自动用 brotli 传输（按客户端 `Accept-Encoding` 协商）。
- 现在的剧本分片和启动包以 `.json.gz` 发布、在 Worker 里用 `DecompressionStream` 解压。它们对 CDN 来说是二进制，**不会再被 brotli 压缩**。要拿到 brotli 收益有两种做法：
  1. 发布明文 `.json`，由 CDN 协商压缩（浏览器自动解压，Worker 里不再需要解压步骤）；需要改分片 URL 合同。
  2. 预先生成 `.json.br` 并以 `Content-Encoding: br` 提供；R2 需要在上传时设置对象的 `Content-Encoding` 元数据。
- 研究实测：TNO `political.coarse` 分片 gzip 11.41 MB → br-11 7.97 MB；na_v2 23.03 → 15.46 MB。

## 6. 长缓存与内容哈希文件名

- 目标：数据文件名带内容哈希（例如 `political.coarse.r0c0.3f9a1c2e.json.gz`），对这些路径设 `Cache-Control: public, max-age=31536000, immutable`；入口文件（`index.html`、剧本 `index.json`、各 `manifest.json`）保持短缓存 + ETag。
- 实现位置：发布期（`tools/build_pages_dist.py` 的打包阶段）重命名并改写 manifest 中的 URL，仓库源数据不变。已有 `sha256` 字段的分片可直接复用哈希。
- 注意：被 strict 合同按字节 hash 的 JSON 和启动包内嵌的 manifest 子集也要同步改写，改写后重算自引用的 size/hash（见 `lessons learned.md` 的"Pages manifest 冲突用最终树重算"等条目）。
- 在 GitHub Pages 上做这一步收益有限（缓存头仍是 600 s），所以和方案 A 一起做。

## 7. Service Worker（可选，最后考虑）

做法：SW 对带内容哈希的数据 cache-first，对入口文件和 manifest network-first。

收益：不受 600 s 限制，二次访问 0 往返；离线可打开已访问过的剧本。如果继续留在 GitHub Pages，这是唯一能让部署后回访不再全量重下的办法（Pages 的 ETag 每次部署都会变，见第 1 节）。

风险（需要逐条有对策才上线）：

| 风险 | 说明 | 对策 |
|---|---|---|
| 更新卡住 | 旧 SW 控制页面，新版本要等所有标签页关闭才生效 | `skipWaiting` + 页面提示刷新；SW 本身短缓存 |
| 版本错配 | 新 HTML 配旧数据或反之，部署中途访问时尤其容易出现 | 只缓存内容哈希路径；入口文件不进 cache-first |
| 存储配额 | 单个剧本全量 50–70 MB，浏览器会按配额驱逐 | 按剧本分 cache、LRU 清理，失败时回落网络 |
| 与现有缓存叠加 | 已有 IndexedDB 启动缓存（`js/core/startup_cache.js`）和 HTTP 缓存 | 明确各层职责，避免同一份数据存三份 |
| 排障困难 | 用户报 bug 时可能是旧缓存 | 提供"清除缓存"入口和 kill switch（服务端放一个使 SW 自注销的版本） |

## 8. 切换步骤（以方案 B/C 为例）

1. 建 R2 桶、绑定自定义域名、配置 CORS 和缓存规则（哈希路径长缓存，其余短缓存）。
2. CI 发布作业里加上传步骤：把选定目录同步到桶中带版本前缀的位置（例如 `v<部署序号>/`），保留上一个版本以便回滚。
3. 构建时把这些目录从 Pages 产物中排除，并在产物里写入数据基址配置。
4. 发布前门禁：用 `SCENARIO_FORGE_PAGES_ARTIFACT_ROOT` 指向的本地产物 + 本地模拟的外部基址跑 release gate；发布后对线上 URL 跑冒烟。
5. 回滚：数据基址改回空（或上一版本前缀）并重新部署站点；桶里的旧版本不删除。

## 9. 验收清单

- 五个剧本冷启动成功，控制台无 CORS 错误；Worker 内的请求（启动包、分片）都指向基址。
- 人口层、交通层等按需数据可加载。
- 部署后回访：未变化的文件返回 304 或命中缓存。
- 基址为空时行为与迁移前逐字节一致（黄金流程通过）。
