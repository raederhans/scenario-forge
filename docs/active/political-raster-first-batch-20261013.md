# 栅格性能第一批：消除重复覆盖扫描与调色板快照

本批按“先改、观察效果”的最新授权执行，只改两个派生缓存热路径，不改变默认渲染模式、分辨率、规范要素、命中权威、保存格式或权限。未推送、合并或部署。

## 基线与范围

- 固定基线：`4e18f8ff359444da274fb7d3419a51746723bf16`；独立分支 `codex/raster-perf-first-batch-20261013`。
- 2026-10-13 只读核实：draft #229 头部 `42cecafc9c548daf5d261c90f975b8f76b120213` 是该基线祖先；draft #230 头部与基线相同；GitHub main 为 `b09a2e8e40895789924adee4305750fc642458d6`。集成候选有两份未提交治理脚本修改，本副本仅复制已提交 Git 对象，未触碰候选或原始 Desktop 工作区。
- 旧 runtime `195f49919d274b21294ebf349794bcae16cff747` 是基线祖先。旧 `4f04c503...` 和旧 Windows 功能检查不作为本批性能证据。
- 当前公共索引只有 `blank_base`、`modern_world`、`hoi4_1936`、`hoi4_1939`、`tno_1962`；ID 栅格准入限定后三个。DO 未出现在索引，不能推定其代码 ID。HGO 在 `apps/hgo`，不是主编辑器的相同渲染路径。

## 实际改动

1. `political_id_raster_runtime_owner.js`：原先每次成功栅格提交都 `snapshot.entries.filter(...).map(...)` 扫全场景。现在仅保留一个 ID 列表，按场景 epoch/namespace、几何/映射 revision、密度和完整瓦片矩形失效。同网格平移和颜色变化复用结果；仍返回新的 Set，调用方不能污染缓存。诊断新增 `renderedCoverageScans` / `renderedCoverageCacheHits`。收益是减少暖提交的全要素遍历；风险是失效遗漏，因此覆盖场景更换、要素替换、跨网格导航与消费者修改返回 Set 的回归。
2. `political_id_raster_display_cache.js`：原先每个暖复用帧仍 `palette.slice()`。现在 revision 和长度未变时复用缓存自有快照；新 revision、重置、画布重新分配、复制失败仍重新快照。诊断新增 `presentationCache.paletteSnapshotCopies`。收益是少做整表分配/复制；真实改色和撤销仍需复制，不声称消除它们。

当前 `vector`/`auto` 仍走原生兼容路径；`raster` 的完整覆盖成功后跳过原生背景/细节生产，缺覆盖或资源不足仍回退；`hybrid` 仍有原生背景及精确收尾。本批不修改这些准入和回退。冷加载、首次前景排序变更和跨 LOD 建瓦片成本仍存在。

## 必要验证与最小观察

- 两个直接测试文件：42 项通过（包含显式 GC 检查，零跳过）。现有 runtime 路由其他文件：108 项中 107 通过，一项 sandbox symlink EPERM；只重跑该项，在本机权限环境通过。合计 150 个不同 runtime 用例通过，不把重跑叠加计数。该批定向计划要求的 pass inventory 7 项及 755 路由 schema 检查也通过。语法检查和 `git diff --check` 通过。
- Pages builder 在独立 `.runtime/tmp/pages-raster-perf-final` 成功，983.70 MiB；两个改动模块与源码在 LF 归一后相等。这是产物目录大小，不是访问下载量。一次 sandbox 启动中止留下部分临时产物；builder 按既有规则拒绝覆盖，最终使用新的目录。没有修改 builder 或治理配置。
- 本地真实 Chromium 145.0.7632.6，1280×900、DPR 1；同一浏览器依次 baseline/changed，分别用新 context（冷 IndexedDB，两个模块都经相同 route，HTTP 缓存关闭），其余代码和数据相同。基线两个模块来自固定 SHA 的 Git 对象。每组先完成 1939 单点填色的像素正确性及撤销/重做，再做同一要素 `CA_FED_48025` 的三次暖改色，最后实际 UI 缩放 130%/100%。两组均无捕获应用错误。中键拖动未改变 transform，因此**平移冒烟未验证**。
- baseline 三次 `lastTiming.totalMs`：8.3/9.1/7.5 ms，中位数 8.3，样本上尾 9.1；changed：8.1/6.0/6.0 ms，中位数 6.0，上尾 8.1。n=3 的 nearest-rank P95 等于最大值，不是稳定尾延迟。本机 CPU 为 Ultra 9 285HX，物理 GPU 为 RTX 5090 Laptop，但实际浏览器 renderer 是 ANGLE Vulkan **SwiftShader 软件图形**。并行开发和本批构建同时存在。这些数值只保留为 CPU 阶段观察，不宣称显著加速、硬件 GPU 收益、FPS 或 INP。
- changed 的三次暖改色：`renderedCoverageScans` 始终 4，命中 2→3→4，`builds` 始终 13；基线同样没有暖几何新增构建。完整 changed 生命周期 10 次栅格提交只扫描 6 次。单元场景连续 5 个未变色暖帧仅复制一次调色板快照，而旧代码每帧复制。真实暖改色仍每次复制，符合预期。
- 冒烟日志、完整 JSON、短脚本分别在 `.runtime/reports/generated/raster-smoke.log`、`raster-first-batch-smoke.json`、`.runtime/tmp/raster-first-batch-smoke.mjs`。这些是任务本地证据，未入产品发布。

## 复现与观察

在本独立副本运行：

```powershell
node --expose-gc --test tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_display_cache_behavior.test.mjs
$env:MAPCREATOR_DEV_PORT='8015'; $env:MAPCREATOR_OPEN_BROWSER='0'
python -u -B tools/dev_server.py
# 另一个终端：复用已有辅助函数的短 smoke，默认120秒上限
node .runtime/tmp/raster-first-batch-smoke.mjs http://127.0.0.1:8015/app/
# 可选必要产物构建：目录必须为空或不存在
python -B tools/build_pages_dist.py --output-root .runtime/tmp/pages-raster-observation-new
```

观察入口：`http://127.0.0.1:8015/app/?default_scenario=hoi4_1939&political_render_mode=raster`。使用普通 Edge/Chrome 保持自己的图形设置，在同一视窗重复改同一块颜色、撤销/重做并小幅拖动。对照 `political_render_mode=vector` 可退出实验。自动准入保持关闭，不保存默认切换。

诊断可只读检查：

```js
const renderer = await import('./js/core/map_renderer.js');
renderer.getPoliticalIdRasterDiagnostics();
```

验收：同网格和暖改色的 coverage hits 增长、scans 不增长；几何/场景/LOD 变化仍重新扫描；未变色复用帧 snapshot copies 不增长；颜色和撤销保持正确，失败仍走矢量。先以实际使用观察是否改善体感；本批预期是小范围减少 CPU/分配浪费，不解决首屏和冷栅格准备。

下一批优先级：① 实际观察仍慢时，沿已有 `lastTiming.rasterMs/captureMs/finishMs` 找 WebGL→Canvas 同步及共享提交成本；此次两组 capture 约 2.8–3.6 ms，仍是软件图形/负载下观察。② 首次前景编辑触发全 source 发布和瓦片失效，后续需保留 painter order 再缩小重算。③ 跨 LOD/冷缓存瓦片准备和资产生成。暂不扩大分辨率降级、默认栅格或全图预建范围。

`pr:plan` 已运行，属于计划而非测试通过。完整治理、硬件 GPU 性能、全剧本、保存加载端到端和发布验收未运行；它们不作为本批小改动的已验证结论。
