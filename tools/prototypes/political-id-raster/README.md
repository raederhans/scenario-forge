# 政治填色 ID 栅格原型

原型已接入主应用的可选显示路径，并支持稳定坐标、多级瓦片、持久化与预生成资产、保守点选和本地 pilot 采集。1936、1939、TNO 共用原有剧本、矢量、编辑与项目存档机制；栅格只是可丢弃的派生缓存。**默认关闭**：当前 DPR 1 的最终重采样画质仍未通过暂定标准，也未证明整体交互或首屏更快。

## 运行入口

从仓库根目录启动：

```powershell
python tools/dev_server.py --port 8008 /app/
```

主应用地址为 `http://127.0.0.1:8008/app/?political_id_raster=1`，通过原有选择器加载剧本。移除参数并重新加载即可恢复默认路径。无需构建或新增依赖。

既有启动只读及 `firstVisible` 门保持有效；栅格不会提前接管启动渲染。瓦片未齐、资源超预算或功能不可用时沿用原有渲染。WebGL2、Worker、OffscreenCanvas 是这条路径的前提；brush、河流分区与原生导出继续走原有路径。

历史固定视图对照页保留在 `http://127.0.0.1:8008/tools/prototypes/political-id-raster/`，也可通过 `python -m http.server 8008 --bind 127.0.0.1` 单独提供。选择剧本和像素倍率，加载后点击地块、改色或撤销，可切换 Canvas、ID 栅格与并排对照。改色复用 `applyFeaturePaintState` 和 `getMapDataBoundary`；原始剧本文件及 owner baseline 保持只读。此对照页的点选仍使用缓存矢量路径，须与主应用的栅格候选流程区分。TNO gzip 数据依赖 DecompressionStream。

“运行三剧本验证”覆盖真实局部政治层，以及 1× / 2× 的孔洞、细条、岛屿和重叠样本。`window.politicalIdPrototype` 可读取结果、重跑或调用 `diagnose()`。`runtime_checks.js` 导出 `runRuntimeChecks(scenarioId, { dpr })`，使用实际 Worker / WebGL2 检查瓦片、暖改色、平移与缩放返回、context loss 和释放。主应用的只读诊断接口为 `js/core/map_renderer.js` 导出的 `getPoliticalIdRasterDiagnostics()`。

## 坐标、覆盖与资源契约

运行时使用固定 EqualEarth 投影，`scale=256`、`translate=[0, 0]`；视口变换映射到此坐标空间。LOD 每四分之一倍频变化一次，独立生成 512 px 瓦片，D3 precision 按 LOD 换算，使物理栅格精度保持 0.05 px。

- source 保留稳定地块 code、几何与 palette 版本、旧新 bounds 和 frame identity。修改几何须替换 geometry 对象或推进 coverage key；不得原地改坐标后复用版本。
- tile 使用完整 D3 projection stream。实心内部保存整数 code，抗锯齿边缘保存全部 source-over 贡献；span 偏移与贡献者 ID 各有独立语义。
- GPU 使用 R32UI code / contributor、R32F coverage、RGBA8 palette。ID 不插值，先着色为 RGBA，再缩放最终输出。改色更新 palette；context loss 后可复用 CPU 瓦片重建 GPU。
- owner 只提交当前完整视图，异步结果须通过场景与几何 epoch 检查。Worker 串行处理瓦片，脏瓦片包含全部相交地块；局部几何或绘制顺序变化只失效相关瓦片，旧 bounds 不明时清空缓存。场景或投影命名空间替换会释放对应资源。

当前资源上限：Worker 投影路径缓存最多 1024 条、按 16 MiB 估算；CPU tile LRU 48 MiB；GPU 纹理与输出表面按 80 MiB 准入；视图最多 12 Mi 像素；IndexedDB payload LRU 64 MiB。encoded 内存缓存默认 0，已解码 tile 由 CPU LRU 管理。诊断将 pending 编码字节纳入临时资源统计。

这些数字是 typed arrays、纹理、画布表面及路径缓存的明确占用或估算，不代表实测峰值 VRAM。JS Map、vector 数据、浏览器合成与驱动开销没有完整测量，构建期间的 JS 临时占用也不能视为已知。

## 持久化与预生成 pilot

资产 identity 包含稳定场景、实际 geometry SHA-256、绘制顺序、投影、stroke 与 gutter，排除 session code 和颜色。二进制资产保存稳定 feature ID 字典；加载时重映射 direct code 与边缘贡献者，保留 span 偏移和数量。版本、身份、尺寸、索引与权重须通过验证。

tile 先尝试持久缓存及显式注册的 manifest，再交给 Worker 构建。manifest 是可选入口：URL 参数 `political_id_assets` 优先，否则读取剧本 manifest 的 `political_id_raster_manifest_url`。未注册时没有预生成资产请求，也不会试探缺省 URL 或 404。请求须同源且大小受限；格式、存储、超时与取消失败均保留回退路径。持久化不能成为可用渲染的前提。

主应用导出 `async capturePoliticalIdRasterAssets()`，只返回当前 CPU LRU 内已验证 tile 的 `{ identity, buffer }`。下载 helper 接收 renderer 模块对象，不绑定应用路径：

```js
// 相对当前页面取得与主应用相同的 renderer 模块实例。
const renderer = await import(new URL('js/core/map_renderer.js', document.baseURI));
const { downloadPoliticalIdRasterAssetPilot } = await import(
  '/tools/prototypes/political-id-raster/asset_pilot.js'
);
const low = await renderer.capturePoliticalIdRasterAssets();
```

先等待当前 LOD 的瓦片构建完成，再 capture。手动切换到另一档 LOD，等待完成后合并采集，避免第一档被 LRU 淘汰：

```js
const high = await renderer.capturePoliticalIdRasterAssets();
await downloadPoliticalIdRasterAssetPilot({
  renderer: { capturePoliticalIdRasterAssets: async () => [...low, ...high] },
  scenarioId: 'hoi4_1939', // 使用当前剧本的实际 ID。
});
```

同 identity、同字节的 tile 自动去重，冲突明确报错。单档采集可直接传 `renderer`。默认下载名为 `political-id-pilot.bundle`；最多 128 tiles、128 MiB 总大小，下载后及时回收 object URL。bundle 格式为 little-endian uint32 JSON 长度、UTF-8 metadata、binary tile bytes；tile offset 相对 binary section，metadata 上限 1 MiB。

在仓库根目录物化下载文件：

```powershell
node tools/prototypes/political-id-raster/materialize_assets.mjs `
  --input <下载的bundle文件> `
  --output .runtime/reports/generated/political-id-pilot/<scenario>
```

CLI 验证 offset、总长度及每个资产 payload，用 identity SHA-256 生成 `.pidr` 文件名，输出 `manifest.json` 与 `pilot-metadata.json`。只接受本仓库 `.runtime` 子目录，拒绝符号链接和内容冲突，不删除已有目录。把该目录的 manifest URL 显式传给 `political_id_assets` 才会加载这些资产。pilot 不写入 `data/`，也不代表已发布或部署。

`storage_checks.js` 的 `runPoliticalIdRasterStorageChecks()` 供单一浏览器 owner 检查真实 IndexedDB。它使用随机专属数据库并报告清理结果；真实重开、重映射、预算裁剪已经通过，quota / blocked 回退证据来自注入 backend，不能表述为真实浏览器耗尽额度或升级阻塞。

## 保守点选

主应用仅对 3×3 邻域稳定的 direct ID 提供快捷候选；还须由原有严格空间查询得到唯一候选，并通过 `geoContains`，才可快捷返回。边缘、孔洞、重叠、过期 frame、brush 和 river 等情况回到原有路径。显示缓存不改变 canonical 编辑、撤销重做或导出所有权。

纯 query 模块的 `density` 表示坐标密度；owner 使用 `samplesPerPixel=1/plan.scale` 判断实际采样质量，避免把固定世界坐标中的低密度误判为屏幕上的低分辨率。实测已有 26 次 raster interior query 通过；真实应用点击 `KAZ-3206`、改色、撤销和重做保持正确，孔洞等边界由 Node 行为测试覆盖。

## 原型阶段证据与限制（2026-10-09）

gutter 2 / 4 与 Canvas 高平滑没有有效改善边缘质量，默认仍为 gutter 0、显式低平滑。主要损失来自最终 RGBA 重采样；固定坐标映射使 100% 视图也可能处于 fractional scale。当前 DPR 1 尚未通过平均最大通道误差 ≤0.75/255、大误差像素比例 ≤0.2% 的 gate，因此默认关闭不变。固定视图近似通过不能代替多级运行时画质证据。

真实主应用单地块改色的局部 CPU 指标，中位数为原生 partial repaint 1.0 ms、ID commit 1.1 ms。这不是 GPU 完成时间、整体 FPS、端到端编辑延迟或首屏耗时，不能据此宣称更快。

缓存复用已得到独立证据：1936 刷新后 16 次 IDB 命中、0 次构建；清空自有缓存后的 1939 双 LOD 由 32 次 manifest 命中完成、0 次构建，资产未压缩约 39.3 MB。三剧本已各生成 32 tiles 的 pilot。预生成覆盖消除了这些请求的 mask 构建，仍不消除矢量读取与解码成本。

新阶段目标测试包括：

```powershell
node --test tests/political_id_raster_coordinates_behavior.test.mjs tests/political_id_raster_identity_behavior.test.mjs tests/political_id_raster_assets_behavior.test.mjs tests/political_id_raster_pilot_behavior.test.mjs tests/political_id_raster_pick_behavior.test.mjs tests/political_id_raster_runtime_owner_behavior.test.mjs
```

固定视图、阶段运行时及整合证据见 [阶段结果](../../../docs/active/political-id-raster-prototype/results.md)。所有一次性输出放在 `.runtime/`。本地检查与报告不代表 CI 或部署已通过，数据库及浏览器页面的清理以各次报告为准。


## 正式应用试用整合（2026-10-10）

当前试用入口位于 **图层 → 边界 → 渲染试验 → 栅格加速（试用）**。默认关闭，浏览器记住选择；URL `political_id_raster=1/0` 优先于已保存偏好。状态显示准备、栅格显示、精确显示或兼容回退。导航停止后，分数缩放视口通过既有原生政治绘制路径恢复精确画质；新视口、颜色、历史操作与场景变更都会使旧细化计划失效。

三个正式剧本的 `political_id_raster/manifest.json` 及 `.pidr.gz` 已登记在场景和启动包、runtime registry 中。资产包含稳定 ID 与覆盖度，不保存颜色；gzip 大小、解压大小、SHA-256、场景、投影和几何 identity 均校验。只有选择试用才读取。磁盘缓存是可选加速，发布瓦片不会等待后台写盘；最多一个待写缓冲，慢磁盘读取让出给发布资源。缺失视口或资产错误仍回退已有 Worker/原生路径。

从实际应用生产者再生成资产（先按项目方式启动 localhost server，单一 owner 串行运行）：

```powershell
node tools/build_political_id_raster_assets.mjs --base-url http://127.0.0.1:8008/app/
```

固定配方为 1280×900、DPR 1/2、100%/130%，使用减少动画设置且等待目标缩放及完整覆盖。生成文件只写三个场景的 `political_id_raster/` 和启动配置；会清理该生成目录中不再引用的哈希瓦片。它是有限世界视图/LOD 覆盖，不是任意屏幕与缩放的全覆盖。更新后按 `data/AGENTS.md` 生成 catalog 并构建 Pages。

生成器最后通过 `refresh_political_id_raster_snapshot.py` 刷新对应 build snapshot 与 manifest/audit 的完整性指针，保留原有语义审计结果。修改启动语言包后也必须同步这组指针，并运行该场景的 `check_scenario_contracts.py --strict`，不能仅靠 Pages 文件存在性检查。

在最终 Pages 产物上验收（预先运行该产物的 localhost 静态服务器）：

```powershell
node tools/verify_political_id_raster_integration.mjs --base-url http://127.0.0.1:8009/app/ --output .runtime/browser/raster-integration/pages
```

检查真实控件、空缓存资产命中、精确静止像素、实际填色和历史操作。OFF 参考禁用其他几何 bitmap 生产者，确保比较对象是原生 Canvas；ON 生产者本身已排除它们。像素观测耗时不等于显示器呈现延迟，不用于声称整体加速。首屏矢量加载、导出与 canonical 数据格式保持既有路径。

本轮结果见 [整合验收](../../../docs/active/political-id-raster-prototype/integration-results.zh-CN.md)。是否发布以独立 GitHub 回执为准。

用户授权线上验收后，可用同一验证器传入 `--base-url https://raederhans.github.io/scenario-forge/app/ --published true`。该开关只允许此正式应用入口；资产生成仍只允许 localhost。浏览器使用临时独立存储，试用及填色不会修改其他用户的数据。
