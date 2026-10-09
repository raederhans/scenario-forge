# 共享政治层 ID 栅格：第 7–11 步实施结果

2026-10-09。已实现稳定世界投影坐标、Worker 投影路径复用、版本化资产与预生成工具、保守 CPU 拾取、持久缓存优先加载，并完成本机应用验证。**继续通过 `political_id_raster=1` 试用，默认关闭。** 栅格缓存现在可以跨文档重用，并能从预生成文件加载；整体编辑或首屏更快尚未得到证明，画质仍未达到暂定门槛。

仍在原隔离 worktree 与 `codex/political-id-raster-prototype` 分支工作。没有改动三个基础剧本、canonical paint/project 格式、生产数据、依赖或发布配置。阶段 7–11 交接时尚未提交；后续已获得审核、优化、合并和推送授权，交付依据本分支 PR 的最终回执。

## 已完成的五步

| 步骤 | 实现与证据 |
|---|---|
| 7：实际应用对照及误差归因 | 1936 原生／ID 两条路径实际点击暖改色、拖刷新增地块、缩放、同一组 40 地块批量填色；另有三个像素归因样本。原生暖改色确实进入 partial repaint，ID 暖改色不再构建／上传 tile。 |
| 8：显示与构建减负 | EqualEarth 固定 scale 256／translate 0，D3 每 LOD 保持 0.05 物理像素精度；四分之一倍频 tile 坐标与 viewport fit 分离。Worker 路径缓存按 geometry namespace／version／projection／density 区分，1024 条及 16 MiB 估算上限。gutter 0/2/4 已实现和测量，默认 0；最终 RGBA 显式使用 low 平滑。 |
| 9：预生成资产 | 实际几何 SHA-256、绘制顺序、投影、描边、LOD 与版本共同决定身份；资产存稳定 feature ID 字典，读取时重映射运行时代码。三剧本都生成两档 LOD、各 32 tiles，工具能下载、校验并 materialize 显式 manifest。 |
| 10：CPU 拾取 | 3×3 同一直接 ID、当前完整帧、唯一 strict spatial candidate，并经原有 geoContains／rank 校验后才返回命中。真实应用 30 个候选点中记录 26 次 interior 查询，实际点击 `KAZ-3206`、改色、撤销／重做通过；边缘、孔洞、接缝、重叠、粗采样、过期帧及 brush/river 留给原路径。 |
| 11：资产优先及重访 | 48 MiB CPU LRU 外增加 64 MiB IndexedDB LRU，encoded 内存副本默认 0。先持久缓存，再显式 manifest，再 Worker。真实 IDB 重开、ID 重映射、淘汰、缩小预算和清理通过；超时、取消、quota 和不合法资产均有回退。 |

第 11 步接在现有 bootstrap／按需 vector chunks 机制上，保留首屏可交互与 readonly 门控。当前不是“完全不读矢量的首屏”：几何身份验证仍需已加载的对应矢量，不能把减少 Worker 烘焙当成减少矢量读取、解码或整个启动时间。

## 测量结论

实际应用 A/B 的暖改色局部 CPU 指标中位数：原生 `politicalPartialRepaint` 约 **1.0 ms**，ID commit 约 **1.1 ms**。两个指标覆盖的子阶段不同，均不是整帧或输入延迟；这批证据没有显示替换已有局部重绘的整体优势。拖刷与 40 地块批量操作两侧都完成，ID 对首次前景顺序改变仍需局部重建。自动化操作历时与整段 RAF 间隔只保留作诊断，不当作 FPS／INP。

独立 720×480 fixture 的四个 Worker/GPU 检查（1936、1939、TNO，另有 1939 DPR 2）暖 draw 中位数为 0.25–0.4 ms，完整 native fill 为 0.7–1.5 ms；这仍是局部完整重绘对照。所有暖颜色操作、缩放返回和 context loss 恢复均没有新增几何构建；dispose 后 CPU 数组为 0。完整 1936 世界视图初次 Worker 路径缓存命中只有 29 次／12145 次路径构建，说明这项复用在不同场景的收益差异很大，不能用 fixture 结果外推。

1936 刷新后的初始视图：**16 次 IndexedDB 命中、0 次 Worker 构建**。它仍用了约 308 ms 的身份检查累计时间、2040 ms 的异步读取等待累计时间；这些等待与应用其他工作重叠，不是独立存储吞吐测试，不能宣布重访启动变快。

清空本任务隔离浏览器中的专属栅格缓存后，1939 的 100%／130% 两个 LOD：**32 次 manifest 命中、0 次 Worker 构建**。资产约 39.31 MB（未压缩）；1936 同为约 39.31 MB，TNO 约 39.52 MB。三组试验资产全部在 `.runtime/`，未进入 `data/` 或生产分发；部署前还需压缩、分发与实际网络预算评估。

资产加载后的 1939 再次改色，后三次提交的 geometry build／tile upload 增量均为 0。实际项目下载、重新导入（phase `complete`）、canonical 色值恢复及 2× 原生导出通过；重新导入命中 16 tiles、没有 Worker 构建。导出没有调用交互栅格 producer。

## 画质结论：继续默认关闭

归因样本固定 zoom 1.1，并用同一几何、顺序和 palette 比较：

| 样本 | 最终尺寸 1:1 ID 平均误差 | 分级 tile + RGBA 缩放平均误差 | 提高投影精度造成的像素差异均值 | 独立 tile 相对 monolithic 的差异均值 |
|---|---:|---:|---:|---:|
| 1939 DPR 1 | 0.503 | 0.842 | 0.0011 | 0.0020 |
| TNO DPR 1 | 0.538 | 1.016 | 0.00246 | 0.00143 |
| 1939 DPR 2 | 0.125 | 0.281 | 0.00024 | 0.00140 |

数值为逐像素最大通道差的均值，范围 0–255。gutter 2/4 对最终 native 误差没有稳定有效改善；Canvas high/low 平滑的逐通道差至多 1。描边补偿能改善部分误差，但不能解决整体缩放误差；为保留同级 tile 重用，未引入随连续缩放变化的描边缓存键。

新的稳定世界网格意味着 UI 的 100% 也可能发生分数重采样。最终 runtime DPR 1 样本平均误差约 0.85–1.02，仍高于 0.75；DPR 2 的 zoom 1.1 大误差像素约 0.210%，也略高于 0.2%。完整 1939 应用政治层在 130% 的均值约 **1.616**，大误差像素约 **1.136%**。没有通过修改验收门槛把这些结果标成画质通过。

## 验证与已知边界

- 167 项目标 Node 测试通过；8 项 Python renderer boundary 测试通过。包括保存永久不结束时的 deadline 回退、hash 期间取消后不再启动旧请求，以及 stable code／稀疏 edge contributor 重映射。
- 真实 IndexedDB 路径与清理通过；quota/blocked 是明确标注的注入 backend 测试，不冒充浏览器磁盘耗尽实验。
- architecture boundaries、74-spec test import graph、734 条 route schema、script portfolio 检查通过。PR plan 为规划结果，广泛 CI／部署检查未运行。
- 一个早期 A/B 测试在示例工程导入完成前编辑，触发 `Project import superseded by a document change`；其 `stage7-app-id-first.json` 作废。修正导入等待后重跑，当前预生成／编辑／导入验证的 console 没有相关 error/warning。
- 内存仍是数组、纹理、表面与路径输入估算，Worker 临时几何标为未知；没有低端设备、真实 heap／显存峰值、受控 EventTiming／busy overlap 或完整启动收益证明。

证据目录：`.runtime/reports/generated/political-id-raster/`。主要文件为 `stage7-app-native.json`、`stage7-app-id-revisit.json`、`stage8-quality.json`、`stage8-runtime-final.json`、三个 `stage9-pilot-*.json`、`stage10-picking.json`、`stage11-storage.json`、`stage11-prebuilt.json`、`stage11-app-final.json`、`stage11-node-final.log`、`stage11-pr-plan.txt`。构建工具与复现方法见 [README](../../../tools/prototypes/political-id-raster/README.md)。

本次专属浏览器会话与开发服务器已关闭，已确认对应进程退出、8008 端口释放；worktree 与证据保留。

## 交付前审核

两个独立的范围审核发现并修复了两项 P2：立即销毁时延迟 Worker 仍可创建／派发，以及合法编码但区域错误的可选资产会永久禁用 owner。新增生命周期取消与创建前检查；在接受资产前校验尺寸和原点，错误资产转交 Worker 重建并写回正确结果。保留 Worker 结果的严格校验。四个新增回归覆盖上述边界，审核者已复核关闭。

新增栅格测试路由按数据、构建和运行时拆分，接入原有 producer gating 测试；未改变快速入口预算或远端 required checks。全工作区 `verify:commit` 因范围超过本地 edit 预算而在规划阶段停止，不能报告为测试通过。对应三个模块的局部规划均无缺口。直接运行的 200 项栅格／renderer 目标测试、118 项验证元数据／portfolio 测试及 13 项 Python 边界测试通过，736 条 route schema、74-spec import graph、architecture boundaries 和 Pages source graph 通过。远端 CI 与默认关闭的运行时画质／性能结论分别记录。

审核输出保留为 `.runtime/reports/generated/political-id-raster/review-{targets,metadata,boundaries}.log`；此前完整应用浏览器证据仍适用，当前修复没有改变像素生成或 canonical 编辑格式。最终推送、检查与合并状态以 GitHub PR 回执为准，不用本地报告代替。

[PR #217](https://github.com/raederhans/scenario-forge/pull/217) 首轮浏览器 smoke、Pages 构建检查、性能门禁、transport、剧本契约和 Quick Fill 通过。快速契约检查发现 renderer 改动对应的当前源码指纹未同步；复核状态权限不变后，仅刷新两个契约文件中的 25 项当前指纹。历史权限证据、冻结基线和检测规则均未调整。85 项相关契约测试通过，含恢复旧写权限、错误借用边界等反向用例；输出为 `review-source-proofs.log`。补充提交仍须通过其自身的 required CI。

## 第 1–6 步历史结果

以下为上一批结果，其阶段范围与计时不代表上述最新版本。

2026-10-09。后三步已完成：主应用可选接入、多级瓦片与局部失效、实际浏览器验证。**保留默认关闭，使用 `political_id_raster=1` 启用。** 暖改色减少了政治填色调用开销，但非整数缩放和完整 TNO 视图的边缘误差超过暂定画质门槛，尚不足以默认替换现有路径。

本次仍在 `C:/Users/raede/.codex/worktrees/political-id-raster-prototype/mapcreator`、分支 `codex/political-id-raster-prototype`、基线 `98425dcc23ba6954e997df979788d4f06856cb76` 上工作。没有新增依赖、改动 `data/`、提交、推送或部署。

## 第四步：完整政治层接入

- `map_renderer.js` 接入独立的 `political_id_raster_runtime_owner.js`，在首屏可交互后的 1936、1939、TNO 中按开关选择。原有政治背景及后续图层顺序保留；导出和内联河流分区继续使用既有绘制路径。
- ID 栅格与旧政治 bitmap／geometry worker 生产者互斥，命中检测 worker 继续可用。完整视口瓦片就绪才提交，否则由原有 Canvas 路径绘制。
- 场景、投影、覆盖和几何版本控制异步接受；在途几何任务可使用最新 palette，旧场景／旧几何结果不能提交。场景替换释放旧资源。
- canonical paint boundary、点选、撤销／重做、项目存档和导出模型保持原有机制；没有栅格化编辑数据或拆分基础剧本。

## 第五步：导航、失效与资源限制

投影空间采用 512 px 瓦片、四分之一倍频分辨率层级，覆盖视口及边缘余量。ID 先解析成 RGBA，最终 RGBA 允许重采样；分类 ID 本身不插值。中间层级描边约为 0.63–0.75 CSS px，属于已测量的画质折衷。

Worker 逐瓦片构建，主线程只维护最新视图需求。新增／移除／重排／几何替换用旧新 bounds 局部失效，重建时包含全部相交贡献；已有地块的旧 bounds 未知时执行完整失效。顺序比较使用公共 ID 的最长递增子序列，避免单次插入让整个尾部失效。无关 GPU 瓦片继续保留。

CPU 瓦片 LRU 上限为 48 MiB；单视图最多 12 Mi 像素；GPU 纹理与输出表面按 80 MiB 估算准入。预算不足时回退。页面资源账本分别登记 CPU、GPU、输出和临时 mask，构建期 JS 临时内存记为未知。四组运行时检查 dispose 后均为 CPU 瓦片 0、GPU owner 已释放；这不等于浏览器进程全部内存归零。

## 第六步：本机性能与质量结论

最终运行时报告使用实际 Worker / WebGL2、720×480 CSS px 真实局部样本。原生 Canvas 在计时前初始化且 `willReadFrequently: false`；双方缓存 Path2D。10 组暖改色交替 AB / BA，ID 侧计入一次 `owner.draw` 的脏 ID 处理、palette 上传、GPU 调用和最终 2D blit，排除像素验证读回。

| 样本 | 原生完整政治填色中位数 | ID 栅格中位数 | 首次完整栅格可用 |
|---|---:|---:|---:|
| 1936，DPR 1 | 1.35 ms | 0.30 ms | 169 ms |
| 1939，DPR 1 | 1.25 ms | 0.20 ms | 153 ms |
| TNO，DPR 1 | 0.70 ms | 0.10 ms | 135 ms |
| 1939，DPR 2 | 1.30 ms | 0.30 ms | 279 ms |

这些是局部绘制调用时间，**不能换算成整页 FPS、GPU 完成时间或输入延迟，也未证明快于生产已有局部重绘**。首次栅格时间不含样本读取／拓扑解码。四组暖改色的几何构建和瓦片上传增量均为 0；同层平移 32 px 后返回、缩放到 1.1 再返回 1.0 均复用原层几何。首次进入另一缩放层仍需生成该层瓦片。

早期 `stage6-runtime.json` 对照使用了面向读回的原生 Canvas，影响基线；保留为诊断历史，性能结论以 `stage6-runtime-final.json` 为准。最终实现还移除了暖改色时复制完整 source 列表、重新解析全部颜色的开销。

| 画质样本 | 平均最大通道误差（/255） | 误差 >32/255 的像素 |
|---|---:|---:|
| 基准比例，三个剧本 DPR 1 | 0.503–0.527 | 0.095%–0.107% |
| 基准比例，1939 DPR 2 | 0.127 | 0.0146% |
| 缩放 1.1，三个剧本 DPR 1 | 0.873–1.032 | 0.232%–0.268% |
| 缩放 1.1，1939 DPR 2 | 0.302 | 0.166% |
| 完整 TNO 政治视图，缩放约 5.28 | 1.688 | 1.075% |

前三步的暂定门槛为平均误差 ≤0.75/255、大误差像素 ≤0.2%，另有实心内部误差要求。新运行时的部分视图已超过前两项，因此未通过默认开启判定。独立瓦片边缘和 RGBA 重采样需继续改善；没有把此前固定区域后拆瓦片的逐字节接缝证明套用到新的世界网格实现。

## 实际应用行为与验证

- 显式加载 1936、1939、TNO 后均提交完整 ID 栅格政治帧。页面实际场景 ID 记录在报告中；一次 URL 的 1939 sample 名无效，实际仍为 TNO，未把它冒充为 1939 验证。
- TNO 真实 UI 点选、改色、撤销／重做通过；下载项目 JSON 后再次导入，完成回执和 canonical override 恢复正确。2× 原生导出保留编辑颜色，导出期间不新增 ID 栅格任务。
- 最新完整 TNO 复核中，首次新增 override 改变前景顺序，只重建／上传 1 个相关瓦片；随后同一地块连续 3 次改色，构建／瓦片上传增量均为 0，提交 3 帧。该视图 CPU 数组约 18.04 MiB、GPU 纹理约 18.09 MiB，另有 16 MiB 输出表面。
- 实际 1936 页面模拟 WebGL2 不可用时，栅格未启动几何构建，矢量改色仍成功。四组局部运行时检查触发真实 WebGL context loss，恢复后不重建几何，只重新上传保留的 CPU 瓦片。
- 最新目标 Node 组合 **135/135 通过**，覆盖 source、tile、cache、worker、runtime owner、原有 geometry owner、political orchestrator、partial repaint、资源预算与入口契约；两个 Python boundary 模块 **8/8 通过**。
- architecture boundary、测试 import graph、734 条验证路由 schema、script portfolio 检查通过；`git diff --check` 通过。最终 `npm run pr:plan` 覆盖 30 个工作区文件，无 unmatched 文件及 route gap；它仅提供检查计划，不是 CI 通过证明。预计的完整 smoke／Pages／性能 CI 尚未运行。

最终证据位于 `.runtime/reports/generated/political-id-raster/`：`stage6-runtime-final.json`、`stage6-app.json`、`stage6-app-final.json`、`stage6-app-fallback.json`、`stage6-node-final.log`、`stage6-python-final.log` 和 `stage6-pr-plan.txt`。UI 导出的验证项目为 `stage6-edited.project.json`。截图位于 `.runtime/browser/political-id-raster/stage6-*.png`。

当前完成了可运行、可切换、可回退的建设及本机验证。低端设备、实际 heap／驱动显存峰值、完整应用端到端延迟仍未测；预生成资产和栅格拾取继续留待后续范围。

## 前三步历史记录

下文保留上一批固定视图实验的结果；其中“尚未接入”等表述描述当时的范围，当前状态以以上第四至第六步为准。

2026-10-09。已完成隔离基线、几何／颜色适配层和真实浏览器局部原型。1936、1939、TNO 继续沿用原有剧本与矢量数据机制；原型只生成可丢弃的显示缓存，生产渲染器尚未接入。

工作区：`C:/Users/raede/.codex/worktrees/political-id-raster-prototype/mapcreator`；分支 `codex/political-id-raster-prototype`；基线 `98425dcc23ba6954e997df979788d4f06856cb76`。本批改动未提交、未推送、未部署。

## 已建成

1. 固定基线与对照：相同地块、D3 投影、绘制顺序、0.75 CSS px 描边、色彩状态和最终 2D 输出。1936/1939 取中欧局部，TNO 取地中海／亚得里亚局部。
2. 派生适配层：稳定地块 code；几何、颜色、mapping 独立版本；新增／删除／重排／投影变化的旧新 bounds；完整 frame identity。已有场景归属作为只读 reference，颜色继续由现有 paint boundary 解析。
3. 可切换原型：整数 ID + 稀疏边缘覆盖权重 + GPU 颜色表；点击、改色、撤销和 Canvas 回退。点选目前仍使用矢量路径。通过同一局部 region 生成再拆瓦片，消除了独立 Canvas 裁切引入的接缝差异。

源码入口和运行方法见 [原型 README](../../../tools/prototypes/political-id-raster/README.md)。核心文件为 `political_id_raster_source.js`、`political_id_raster_tile.js`、`political_id_raster_gpu.js`，位于 `js/core/renderer/`。没有新增运行依赖或改动 `data/`。

## 本机测量

Chrome / WebGL2 / ANGLE D3D11，NVIDIA GeForce RTX 5090 Laptop GPU。每例 4 组预热、24 组 AB/BA 配对；两侧均缓存 Path2D，栅格侧包含 palette 更新与 2D blit。表中是 JavaScript 绘制调用耗时，**不是 GPU 完成时间、输入延迟或整应用 FPS**。

| 样本 | 地块 | 输出像素 | Canvas 中位数 | ID 栅格中位数 | 首次 ID 生成 | GPU 创建与上传 |
|---|---:|---:|---:|---:|---:|---:|
| 1939，1× | 1,129 | 720×480 | 1.20 ms | 0.40 ms | 82.3 ms | 11.0 ms |
| 1936，1× | 1,129 | 720×480 | 1.20 ms | 0.40 ms | 94.2 ms | 7.8 ms |
| TNO，1× | 533 | 720×480 | 0.70 ms | 0.30 ms | 53.6 ms | 6.0 ms |
| 1939，2× | 1,129 | 1440×960 | 1.30 ms | 0.40 ms | 202.9 ms | 16.9 ms |

这一局部完整政治重绘对照中，调用耗时下降约 57%–69%，改色期间瓦片上传数为 **0**。两侧下一次 requestAnimationFrame 的中位间隔仍约 8.1–8.3 ms。仅 16 个简单合成多边形时，Canvas 约 0.1 ms、ID 栅格约 0.2 ms，说明栅格方案也有固定开销。

“首次”指每次新建派生渲染缓存；本地资源加载可能命中浏览器缓存，不是清空网络缓存后的冷启动试验。完整拓扑仍被读取／解码，TNO 这一环节约 1.69 秒，栅格缓存没有解决它。生产现有局部重绘、整世界导航、完整图层和低端 GPU 尚未参与本轮对照。

## 画质与编辑正确性

最初的严格逐像素标准未通过，失败 JSON 已保留。诊断显示硬件 Canvas 与用于生成 mask 的 CPU Canvas 抗锯齿不同；每瓦片独立裁切还造成额外差异。后者已通过统一区域生成解决，前者按用户明确允许的小幅损失独立评估。

- 原有严格标准仍报告未通过，没有改写成“逐像素一致”。
- 六个样本通过暂定近似画质标准：平均逐像素最大通道误差 ≤0.75/255，通道误差 >32/255 的像素比例 ≤0.2%，远离边缘的 5×5 同 ID 实心区域误差 ≤1/255。
- 三个 1× 真实样本平均误差约 0.50–0.53/255，大误差像素约 0.095%–0.107%；1939 2× 分别约 0.128/255 和 0.0155%。少量边缘像素仍可能有较大单点差异；近似标准是本轮工程标准，尚不是正式产品的最终视觉验收。
- GPU 与 CPU ID/coverage 参考着色误差 ≤1/255；合成 1×/2× 的整区域与拆瓦片参考结果逐字节一致。
- 孔洞保持透明；0.6 CSS px 细条与小岛保持可见；12 重贡献不会被截断为固定的 4 层。
- 改色／撤销恢复 palette，几何版本不变；旧颜色帧和旧视图被拒绝；owner baseline 保持冻结且身份不变。
- 真实点击选择 `DE119`、应用颜色、撤销和显示模式切换通过。模拟 WebGL2 不可用时仍能用 Canvas 改色／撤销；真实 context loss 事件后的回退和 GPU 重建也通过。

TNO 使用政治集合及 land/shoal/relief 附加地块；没有把独立海水层、河流分割、纹理、边界、标注和启动 chunk 合成当作已覆盖。画质牺牲不涉及地块身份、编辑状态或项目存档格式。

## 内存与后续接入边界

1936/1939 1× 的 ID/coverage CPU 数组约 2.64 MiB、GPU 纹理约 2.67 MiB；TNO 分别约 2.04 和 2.07 MiB。1939 2× 为 7.58 和 7.68 MiB，另有约 5.27 MiB 的单张输出画布。对照页还保留两张显示画布和原始矢量路径。

这些是显式数组、纹理和表面估算，未测 JS Map、Path2D、向量数据、浏览器合成缓冲或驱动峰值。构建时完整 region 与拆分数组会短暂并存。当前适合证明局部显示缓存；后续接入前仍需限定缓存预算、设计导航与重建策略，并与现有 partial repaint 公平比较。

## 验证与证据

- 新适配层／覆盖内核：`node --test tests/political_id_raster_source_behavior.test.mjs tests/political_id_raster_tile_behavior.test.mjs`，33/33 通过。
- 相关 renderer inventory、political orchestration、verification metadata：74/74 通过。
- 验证路由 schema 检查通过（734 条）；script portfolio 检查通过。新增原型目录已登记到对应 Node 行为检查，浏览器验证仍是独立证据。
- `npm run pr:plan` 返回 planned，无 unmatched 文件及 route gap；它只提供计划。建议的广泛 CI／发布检查未运行，本轮不作 PR-ready 或部署声明。
- 浏览器六样本、额外窄地块／岛屿检查和无 WebGL2 回退均通过近似画质及行为要求；本轮页面检查没有 console warning/error，资源请求成功。

运行证据位于 `.runtime/reports/generated/political-id-raster/`：`first-run.json`（严格失败）、`validated-run.json`（六样本性能与画质）、`geometry-check.json`、`fallback-check.json`。浏览器截图位于 `.runtime/browser/political-id-raster/1939-comparison.png` 与 `synthetic-comparison.png`。

结论：在保留共同剧本、矢量和编辑数据的前提下，局部 ID 栅格显示缓存已跑通，也显示出减少重复重绘 CPU 开销的价值。第四步的生产政治层接线、栅格拾取、多级导航和预生成数据尚未实施。
