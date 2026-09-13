# 法国政治地块精度与共享边 LOD

本次实现改造生成链路；尚未批量替换 `data/`、`dist/` 中的现用剧本资产。

## 生成顺序与边界

1. `tools/build_na_detail_topology.py` 的 detail processor chain 首先调用
   `apply_france_master_precision`。输入必须是剧本裁剪前的 global master。
   从现有法国源镜像按 `FR_ARR_*` ID 恢复几何，保留行顺序、属性和已有 ID 集合，
   不注入 source-only 行。缺 ID、重复 ID、CRS 不一致或非法源几何会报错。
2. master staging 和 `map_builder.geo.topology.build_topology` 的最终编码均保护法国
   覆盖。法国不经过逐面四位小数取整；全局量化后，以无量化共享 arcs 保存传入的法国
   几何，重新解码检查形状、覆盖和 D3 绕向。其他对象保持其解码坐标和属性。
   全局 transform 被解码移除，未引用 arcs 被清理，避免重复生成时累积旧 arcs。
3. 剧本仍执行其自身的历史筛选、裁剪和归属处理；禁止对剧本结果直接调用 master
   恢复入口，因为 ID 相同不能证明历史切割相同。
4. scenario coarse 以最终 runtime 政治几何为输入，使用与 detail 相同的 owner bucket
   分组。法国组内共享边整体简化，组外边界不简化，从而允许相邻 owner 处于不同 LOD。
   法国简化结果不再独立 simplify/round，并转换为 D3 的外环顺时针方向。
   未升级国家的简化规则保持原逻辑。

法国 coarse 输入覆盖无效、缺 owner、操作失败或输出覆盖/合并范围改变时，保留原始
法国几何，并将 `fr_shared_coverage_applied` 记为 false；这表示优化未应用，不表示
旧缺口已修复。精度编码入口遇到无效法国覆盖则拒绝输出，不能用 buffer 掩盖。
运行依赖 Shapely >= 2.1；现有三个 lock 文件已使用 2.1.2。

## 本地实测（2026-09-13）

使用 TNO 的实际 315 个法国 ID 和 BRG/FRA/GER/ITA 归属，源几何来自仓库法国
arrondissements 镜像。此处借用剧本 ID 作选择器，不作为覆盖历史裁剪的授权。
通过正式 staging、最终 topology 导出及政治分块函数生成隔离产物：

| 指标 | 结果 |
| --- | ---: |
| 高精度 detail 坐标 | 295,010 |
| 新 coarse 坐标 | 66,600 |
| 现用 TNO 法国 coarse 坐标 | 22,552 |
| 两次编码后法国形状与高精度输入相等 | 315 / 315 |
| 四个 owner 的混合 LOD 覆盖、union 检查 | 16 / 16 通过 |

新 coarse 比直接加载 raw 减少约 77.4% 坐标，但仍比现用法国 coarse 多 44,048 个。
如果其他国家不变，相当于现用全局 coarse 501,709 个坐标增加约 8.8%。这不是 FPS、
首载或内存回归比例。仅 ID+几何采用相同 JSON/gzip 口径，高精度约 1.705 MB，
coarse 约 0.409 MB；它们不是整个 App 的下载体积。

实际 vendor D3/topojson-client 对两级各 315 面检查球面面积及远点包含：无反向全球面。
原法国露底样点 `(2.107821078210783, 48.106045166951674)` 在两个 LOD 中均只命中
`FR_ARR_45002`。

本地证据在 `.runtime/reports/generated/france-shared-precision/`；复现脚本位于
`.runtime/tmp/france-upgrade/validate_pipeline.py` 和 `check_d3.cjs`，属于一次性产物。
回归测试为 `test_france_precision`、`test_france_topology_precision`、
`test_france_lod_contract`，以及现有 scenario chunk、urban/water topology 和 processor
chain 测试。当前选定组合共 41 项通过。

## 现用资产迁移仍需完成的验证

从确认未经剧本切割的 highres master 重建 detail，再重建 runtime 和相关剧本产物；
不能把本次隔离的 raw 恢复结果直接灌回现用 TNO。更新必须包含原有派生 mesh、邻接、
chunk manifest、gzip 和缓存身份。按剧本核对历史边界、合法孔洞与未升级邻国接边，
并测量相同设置下的浏览器首载、缩放拖动、点击/撤销和导出。

本次没有执行该批量资产迁移、dist 构建或发布，也没有以新的浏览器性能数据证明回归
幅度。德国及法德国界修复属于后续范围。无量化表示其他对象的数值坐标被保留，但整个
文件的编码形式和体积可能变化，最终整包体积应在资产迁移时实际测量。

## TNO 法国隔离试点（2026-09-13）

入口 `tools/pilot_tno_france_precision.py` 从未经剧本裁剪的 master 提取法国 320 面并恢复源精度，按 TNO 已有 315 ID 选择，再调用正式 `cut_political_features` 重放刚果湖和基础水体克隆裁剪。此次裁剪未与法国大陆相交。审计确认被亚特兰托帕替换的科西嘉五个 ID 保持排除；FRA/BRG/GER/ITA 归属保持。

候选位于 `.runtime/tmp/france-pilot/scenario-assets/`，未覆盖正式数据。六个非政治 runtime 对象的解码身份相同，包括 `scenario_atlantropa`、`scenario_water`、`scenario_coastline`、`land_mask` 和 `context_land_mask`；独立水体、亚特兰托帕及地形文件保持字节一致。法国以外政治几何由装配器验证原样保留。

实测法国 detail 坐标从 32,423 增至 295,010，coarse 为 66,600。仅 5 个分块内容变化：全局 coarse 与 BRG/FRA/GER/ITA detail；168 个政治 detail 和 16 个 context 分块复用。全部 189 个分块 hash/字节数/gzip 校验通过。统一 gzip 口径的全体分块体积从 28,139,734 增至 30,417,871 字节（约 +8.1%），不代表首屏流量或 FPS 变化。

四个 owner 的全部 16 种 mixed LOD 组合均通过法国 coverage 与 union 一致检查。vendor D3 的新 coarse/detail 315 面绕向检查通过，旧露底样点在新两级均仅命中 FR_ARR_45002。对比 SVG 是统一绕向后的几何绘图，不是 App 截图。

候选尚未通过国界接边验收：FR/非FR 邻接从 84 减为 75，9 对候选几何的距离为约 2.6–1,123 米；旧关系中也有 4 对为面积重叠，不能机械恢复旧邻接。距离本身不能证明中间没有第三地块覆盖。当前保持 `release_ready=false`，不生成发布认可，也不把未更新的 startup/bootstrap 当成有效试点入口。

证据：`.runtime/tmp/france-pilot/acceptance.json`、`d3-check.json`、`adjacency-check.json`、`cross-border-distances.json` 与 `france-comparison.svg`。本轮法国/装配/分块相关目标测试共 33 项通过。

海岸关系检查同样阻塞推广：虽然六个特殊运行时对象保持不变，高精度法国仍在新位置与 `scenario_water`、亚特兰托帕 land/water/shoal 发生交叠。`boundary-check.json` 按实际新交叠位置的差集统计，避免用总交叠面积下降掩盖新增位置；与 `land_mask` 的覆盖增加不被当成冲突。报告里的对象 ID 列表仅作区域候选索引，不作为每个 ID 已确认发生重叠的结论。

试点结论：内部精度和共享 LOD 改造有效，正式迁移仍需法国与邻国边界、TNO 海岸接口的几何协调。不能直接恢复旧邻接，也不能单靠保持特殊图层文件不变判定兼容。尚未进行浏览器首屏、FPS 或交互验收。
