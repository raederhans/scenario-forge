# TNO 栅格场景实施与验证记录

## 当前续轮结果（2026-10-19，v111，尚未达到全部性能与质量目标）

仍在原独立工作区和分支，保留所有既有改动，无提交、推送或发布。世界地形已从重采样世界纹理改为完整原生viewport路径和最多三份精确相机缓存；原80MiB共享准入不变。未保留会改变像素的分块、flush或路径合并实验。

本轮继续把country sets和普通政治collection构造放入可取消私有准备，在阶段之间真正让出host任务；修复完整compose后取消、同revision重试丢失metadata delta；稳定原生投影bounds缓存、复用完整河流Path2D；等价轮廓版本保留原PATCH顺序并等待Worker确认后复用唯一完整图。资源、就绪、取消和像素门槛未放宽。

Chrome155 / NVIDIA RTX5090 Laptop ANGLE D3D11 / 1280×900 / DPR2，三独立会话，每次三轮130→250→100；无trace或截图混入计时，保留所有27次样本：

|250%样本|数量|完整就绪范围|最大rAF间隔范围|≥50ms主线程任务|
|---|---:|---:|---:|---:|
|各会话首次|3|4144.7–4650.5ms|266.7–291.6ms|0|
|各会话后两轮|6|3444.8–3792.2ms|91.6–91.7ms|0|

250%的九次均未出现≥50ms任务，重复导航的帧间隔稳定；首次尖峰仍未解决。不能与历史v58单次4686.7ms/208.3ms混算提速比例。第三会话首次130出现157/206ms任务、491.6ms rAF与5888.8ms就绪；其余26次没有≥50ms任务。总体流畅度验收不通过。报告为`.runtime/browser/tno-raster-scene/spike-v111-{1,2,3}`。

当前冻结代码的实际浏览器检查全部通过：smoke完成填色、重复填色历史、41点单事务笔刷、undo/redo、平移缩放、vector/raster、保存→HOI4→TNO导入及颜色恢复；zoom-retained完成三档held-worker下编辑/undo/redo、释放准备及最终采用；lifecycle完成默认与0.5DPR导出、状态恢复、context loss可见回退及GPU重建。三份报告errors为空。真实GPU60项检查通过，无GPU错误。

当前目标Node组合177/177通过；架构检查修正旧bounds转发签名后通过；Pages source graph、diff检查通过；pr:plan仅为只读计划。既有tno-spike产物镜像更新13份源码并重新生成manifest/大小准入，1,031,837,402bytes；镜像inventory9/9通过。这是已有产物增量更新，不冒充重新构建全部资产或CI。

地形零容差最终完整复验仍不通过：`physical-exact-v111-final`完成两页全部三档与重复捕获，同页130/250/100为1/0/1个像素差异，跨页physical130为1个；130最大RGBA差9/9/6/1，100仅alpha差1。完整合成场景、raw GPU、未裁切场景、其他cached层（包含新河流缓存）、source packets与重复捕获均通过，两页errors为空。前一次v111同页130有2像素、250/100零，该次native因CRLF marker中止；诊断脚本已修复，没有删除旧失败。v112路径合并把250填充1218→305，但三档同页80304/147904/47045像素差异，已拒绝。历史native-native也曾有1像素差异，不作为放宽门槛的理由。

v110 trace将首次250两次大帧间隔定位到物理Canvas完整栅格批：主线程提交仅数毫秒，GPU进程Skia路径任务273.5/227.85ms。这里是进程壁钟，不是GPU硬件执行时间。政治promotion无条件失效physicalBase可能导致第二份候选，但trace未记录完整前后key，不能宣布已证明严格同源重复。后续应沿完整原生批的成本与精确失效契约推进，不能忽略外部dirty或降低像素标准。

所有本次Playwright浏览器已关闭；root核对PID1208命令与8008监听归属后停止自有开发服务。工作区和改动继续保留。

## 上一轮结果（2026-10-19，已完成本地构建与闭环验证，流畅度目标仍未全部达到）

同一独立工作区和分支继续实施，全部既有 WIP 保留，没有提交、推送或部署。政治筛选/source 发布已移出绘图任务；政治瓦片及非政治 Canvas 纹理均有独立私有准备和最终原子采用。旧场景可交互。完整就绪和主线程长任务已有明显收益，但帧间隔尚未全面达标，不能称为稳定流畅或全部性能问题完成。

主要结构变化：

- 政治 collection、验证、ID 映射、LIS、palette 和 dirty 集合在可取消任务中私有构建；scene/projection/layout/DPR/geometry/color/order 身份变化会丢弃候选，发布不消耗取消候选的 ID/revision。code-to-ID Map 的最终同步构造仍存在，实测约 0.5–1.2ms，不称为严格 O(1)。
- 政治 GPU 候选按 tile 独立任务上传；非政治层最多三份私有预上传，优先 labels/borders/physicalBase，每份上传前真实让出任务。旧纹理、overview、私有候选和政治 pending 都进入原有80/160MiB预算；不足时只减少预传数量，其余原同步上传。取消/context loss/dispose释放候选，最终匹配版本才采用。新增waiting状态不再误中止exact刷新。
- exact 与 deferred producers 在同一个 political invalidation plan 后预启动；retained TNO 边框 Worker 可先私有计算，实际 commit 和 native fallback仍经过原settled与身份门槛。国家标签四个按需worker独立续队列，并用严格alpha上界跳过确定无输出的fit，文字算法与透明度边界不变。
- 地形保留32MiB世界Canvas栅格，按原生完整pass顺序绘制后复用；普通视图采样到viewport纹理。取消中的任务保留job/资源槽直到真正退出。全世界纹理不直接装入场景GPU；有限fill/空间tile分批因像素差异已撤回。
- direct backing扩展最终为每边5%，native/export仍15%，labels/borders真正paint margin仍96px；非政治驻留纹理由116.47MB降至92.41MB。padding模式切换会按layout/signature强制正确重画。undo的后续render在当前边界结束后的单一microtask调度，避免请求被吞。

严格同门槛的普通缩放单次样本：v49为本轮中间基线，v58为最终结构整理后的代码。两者均等待真实atlas、精细边框/轮廓、secondary、当前国家标签fit/paint；v58另外明确等待新引入的私有纹理采用。Chrome155 / NVIDIA RTX5090 Laptop ANGLE D3D11 / 1280×900 / DPR2；无预先trace或heap插桩。

| 缩放 | v49完整就绪 | v58完整就绪 | v49→v58最长主线程任务 | v49→v58最大rAF间隔 | v58首反馈 |
|---|---:|---:|---:|---:|---:|
|130%|6447.1ms|2524.2ms|188→0ms|175.0→158.4ms|105.1ms|
|250%|7085.0ms|4686.7ms|61→64ms|258.2→208.3ms|2.6ms|
|100%|12473.6ms|3317.6ms|181→0ms|216.6→166.5ms|8.0ms|

0表示未记录到≥50ms任务。就绪缩短约61%/34%/73%；最大rAF间隔降低约9%/19%/23%，250%仍有208ms尖峰且其最长主线程任务没有改善。不是P95、FPS、INP或显示器实际呈现延迟。早期v37/v48漏等atlas或标签，不用于完整就绪提速百分比。v56在加入非政治预上传之前为2668.4/5438.8/3558.3ms、long0/75/0、rAF158.3/283.4/158.2。v57为2747.3/4936.1/3544.6ms、long0/58/0、rAF200.0/241.7/183.3；其中130%的帧间隔退化保留，不把单次v58改善写成稳定分布结论。

实际行为证据：最终v58普通三档和三档held-worker的paint/undo/redo/release/最终发布全部通过；smoke6完成填色、41点单history笔刷、undo/redo、平移缩放、vector/raster、保存→HOI4→导入TNO和颜色像素恢复；lifecycle3完成默认/0.5DPR导出、编辑状态恢复、context loss可见回退和重建。smoke6/lifecycle3在最终职责整理前运行，后续只把同样的preflight、切片排队和布局纯计算移入既有owner，整理后的真实行为由v58及目标测试覆盖。以上console/network errors均为空。真实NVIDIA GPU60项像素检查通过，私有准备期间旧像素保持，原子采用与同步路径RGBA一致，取消和部分预算准入覆盖。

物理世界栅格与原生viewport路径的严格RGBA对比不通过：130/250/100分别186/449/147个像素不同，最大通道差均为1/255（每张2481792像素）。没有调宽零容差，也不称为byte-exact；收紧标签就绪后先前130%的大差异已消失。报告在physical-world-compare-complete-dpr2。

诊断v55仅用于定位：250%主线程约89ms任务包含54ms标签绘制与26ms纹理上传；GPU进程约244/226ms任务不等同于真实GPU执行时长。v58私有非政治上传主线程累计max约0.2ms；政治GPU准备累计max34.7ms包含启动阶段，不能声称每批均低于4ms。当前政治source准备最大slice约7.3ms、最终commit约0.6–1.4ms。物理Canvas诊断包含启动时101ms errorCheck及GPU等待，不作为缩放期间单任务耗时，也不宣称冷启动栅格批已消除。

最终检查：目标组合第二轮527/528通过，唯一失败仍是physical静态契约依赖整理前scheduler代码位置；已改为核对新的preflight政治失效、代次guard、辅助排队及最终发布连线，相关8/8复测通过。scheduler连续两次yield、旧promise拒绝与替代代次覆盖在55项目标测试中通过。架构边界通过，scheduler752≤760、cache721≤727，预算未增，Python原4组22/22通过。routes752、最终Pages source graph、diff检查通过；pr:plan无unmatched/route gaps，仅为规划。保留前阶段HEAD一致的action-import whitelist失败，不声称全套测试或CI通过。

最终artifact-only构建成功：`.runtime/reports/generated/tno-async`，983.94MiB。以该产物为root的orchestration inventory/source mirror检查9/9通过；未覆盖或发布tracked dist。root核对并停止自有Python48752，端口8008无监听，所有本次浏览器已关闭。无提交、推送、PR或部署。

失败样本保留：smoke1 undo后续render被吞、smoke2零padding导致pan重画、smoke3模式切换cached origin错误均已对应修复，smoke4/5/6通过。lifecycle1漏序列化readonly label readiness而误报fallback未完成，回归已补，lifecycle2/3通过，未放宽oracle。

## 本轮中间实现与失败记录（历史，以下 v51/v52 不是最终结果）

同一独立工作区保留全部既有修改。政治筛选、source 验证/映射/LIS/颜色准备已移出 draw，私有候选带取消和完整身份检查，完成后原子替换；提交时 code-to-ID Map 仍有小量同步构造，实测约 0.7–2.5ms，不称为严格 O(1)。

地形采用 32MiB 私有全世界栅格，完整几何按原生 Canvas 顺序一次绘制，经 GPU fence 确认消费后复用。足够密度下 100/130/250% 只采样到普通 viewport pass；更高缩放回到足够精度的 viewport 候选，不把低精度版本当最终结果。全世界表面不直接安装进场景 GPU，80/160MiB 限额不变。取消任务保留资源和 job 槽直到真正退出，防止新旧候选并存超预算。

有限 fill 批与空间 tile 分批均出现抗锯齿像素差异，已撤回；生产使用整个原生 pass 的一次提交。同步 `getError` 移至 fence 已完成后，防止把尚未完成的 Canvas raster 变成主线程等待。全量 intensity grid JSON 序列化已移除。

完整就绪新增真实 atlas 数据到达和当前 country-label fit/paint 两项门槛。早期 v37/v48 没覆盖标签尾部，不能与更严格结果直接计算端到端提速。v49 暴露 6.45/7.09/12.47s 的真实完整就绪时间，已保留。标签准备已改为独立补充 worker 队列，当前视图完成才触发一次发布；政治瓦片也在 preflight 提前启动，准备期间旧场景继续可交互。

截至 v51，普通及三档真实 held-worker 编辑闭环全部通过，但 130/250% 仍需 6.07/8.56s，政治批提交出现 160/235ms 主线程耗时。当前继续实现 GPU 私有分片上传和 worker 不变几何索引复用，尚未宣称长任务目标完成。

保留的中间实验和失败：v38 同步 GPU query 产生 569/306/597ms 长任务；v41 全世界直接 GPU 纹理因真实场景预算拒绝，已改私有 Canvas + viewport 纹理；v44 后到的 physical atlas 使 100% 出现 614ms，随后收紧就绪 oracle；v45 保留 199ms 异常；v47 held130 的实际 epoch/纹理保持不变但诊断错报 published，现已按最后一次成功呈现记录 retained；v48 完整行为通过但漏等标签，不能作为最终性能证明。v50 是带 trace 的 100% 诊断，4.20s/54ms，不计普通样本。

### 后续结构改动与被撤回实验（尚待最终实测）

GPU 使用同一 GL 下的唯一私有 pending map，每 tile 一个宏任务上传，旧纹理及颜色在最终 commit 前保持不变。新旧纹理并集、overview 和非政治场景 excess 一起计入原 80/160MiB 限额。真实 NVIDIA/ANGLE 的 36 项像素检查通过，包括逐次上传时旧像素保持、取消和预算拒绝保持、最终原子提交与同步路径零差对照。

TNO direct display 去除旧 15% 每边的 transformed-pass backing 扩展，保留 country/city label 与边框真正绘制的 96px；native/export 不变。v52 非政治纹理从 116.47MB 降至 81.68MB，新旧 GPU 候选可在原上限内并存；130/250% 均无 capacity fallback，最长 GPU 私有任务 2.4ms。但 v52 在普通 100% 失败于 visible scene inactive：旧 overview 未随同尺寸平移更新，且 pending 候选被误走整场景合成。此轮仅属失败诊断，不是最终通过；130/250 的 5461.9/7340.7ms 也不能替代最终完整闭环。

国家标签 prepared geometry cache 的实际收益不符代价：v52 累计索引构建约34.8ms、fit约11506ms，却保留51.1MB。该新缓存已撤回。改为四个按需 worker，每国固定一个 worker、几何不复制，每 worker 最多2个任务、全局仍8个；source/projection替换和任一 worker 失败拆掉全池。保留原精确fit算法和既有候选四variant缓存；不是降低文本质量。

## 前一阶段：OOM 修复与完整就绪提速，帧尖峰仍未达标（2026-10-18）

仍在同一独立工作区和分支，保留全部既有 WIP，没有提交、推送或部署。最终源码 `recovery-v37-native-dpr2` 已通过正常 130/250/100% 和三档真实 held Worker 的 paint/undo/redo/release/完整发布。100% 恢复没有再超时；有限通过次数不代表所有历史冻结和内存风险均已消除。最终 smoke 与 lifecycle 也通过，详见下文。

本轮根因有实际转储证据：`recovery-v25-native-dpr2` 的地图 renderer 在 settlement watchdog 前退出，退出码 `0xe0000008`，私有内存采样峰值 7,416,541,184 bytes。实际 Crashpad 包含 `V8 javascript OOM (MarkCompactCollector: young object promotion failed)`。浏览器连接和 Page open 状态不能证明 renderer 仍活着；此前 spare renderer 的栈不能用于归因。没有增加应用超时或强制 GC。

已落地的结构修改：

- 轮廓 graph 改为紧凑 typed columns、整数边索引、精确哈希元组比较和稀疏多归属表，保留 Float64 坐标与现有拓扑/三缓冲传输契约。主线程边框直接流式读取二进制 arc ranges，普通 GeoJSON 仅在兼容调用时惰性展开。v28/v30 同条件 heap 诊断的 contour Worker 峰值约 1.722 → 0.463 GB，main 约 2.259 → 1.486 GB；这是有观测的诊断数据，不是端到端性能基线，也不等于整个 renderer 内存同比下降。
- v31 时间线证实不可变政治集合发布后的 topology bump 被当作原地修改，250%/100% 各重复发送 12,144 features。新增严格相邻 revision 的发布确认，未知原地 mutation 仍强制失效。最终 v37 的三档累计 sentFeatures 为 12,745/13,380/13,557；已处理过的同一 collection 且输入 flags 相同的尾随确认不再第二次全量扫描。
- 索引发布后的 workspace/list UI 合并到独立宏任务，几何/selection dirty 立即设置，直接选择编辑通知仍保持原行为。最终 smoke 的 CPU 栈确认 UI 在 publication 后独立执行，约17–20ms，workspace约6ms，不再嵌套在地图发布或 render 中。
- 尝试的两份/64MiB completed contour graph 缓存在 v36 完整闭环中命中为零，额外保留约30.44MB，已完整撤回；没有扩容量或增加近似内容哈希。

相同 Chrome155 / RTX5090 Laptop / 1280×900 / DPR2、严格完整就绪 gate 的单次正常缩放对照：v29 已包含紧凑轮廓，但尚无不可变 publication 修复；v37 为最终源码。两轮均无 trace/heap 插桩，均通过完整 held 编辑闭环。

| 缩放 | v29 完整就绪 | 最终 v37 完整就绪 | v37 首反馈 | v37 最大主线程 long task | v37 最大 rAF 间隔 |
|---|---:|---:|---:|---:|---:|
| 130% | 2187.3ms | 2468.6ms | 5.7ms | 未记录到≥50ms任务 | 408.4ms |
| 250% | 6218.3ms | 3722.9ms | 6.7ms | 50ms | 258.3ms |
| 100% | 5613.8ms | 4070.7ms | 171.0ms | 104ms | 425.0ms |

250%/100% 的这组单次样本缩短约40%/27%，130%没有收益。先前 v32 为2143.9/3284.8/3514.5ms，不能以较快旧样本替代最终结果。所有尖峰保留；这些不是P95、FPS、INP或显示器呈现延迟。v37 renderer 私有内存峰值仍约7.382GB，因此不声称整体进程内存或帧尖峰已稳定下降。

剩余明确瓶颈：最终 smoke CPU 诊断中，250%/100% 的政治 source 同步筛选+发布采样约39/43ms（100%仍嵌套在render中），尚未移到可取消的私有异步候选。原生 Canvas/GPU 栅格批仍能造成数百毫秒帧间隔；旧 v15 trace 只定位到主线程 Canvas raster handler，缺少具体 Canvas身份，不能归因给 political WebGL shader。最终 smoke 的采样片段不能直接冒充 v37 的50/104ms长任务边界。整体流畅度目标保持未完成。

最终验证：轮廓/边框/scoped integration组合101/101，UI scheduler+WGI 32/32，profiler/native breadcrumb 43/43通过（组合有重叠，不合计唯一测试数）；架构边界、750条路由与407个命令发现覆盖、Pages source graph通过，`pr:plan`无 unmatched/route gaps，仅为计划。保留此前与HEAD一致的 Python action-import whitelist失败，不宣称全套测试通过。

`recovery-final-smoke-dpr2` 完成实际填色、41点单history笔刷、undo/redo、平移和三档缩放、vector/raster、保存→HOI4→导入TNO与目标颜色像素恢复。该轮带trace，只作行为与调用栈证据。`recovery-final-lifecycle-dpr2` 无预先trace，通过默认/0.5DPR导出、编辑状态恢复、context loss可见回退和重建；两者无console/network errors。最终构建产物与进程收尾见context.md。

诊断边界：v19误用了Chromium145/SwiftShader，排除对比；v20/v22通过，v23/v24/v25失败均保留；v26/v28/v30是heap诊断。v27过早读取Worker导致调试异常`0x80000003`，排除且已关闭。v29/v32/v37普通完整闭环与v30/v33诊断闭环均通过，不能把有观测样本混入性能基线。Pro网页已咨询并关闭，它是建议来源，根因以实际转储为准。所有失败和中间证据保留。

## 前一阶段结果：缓存抖动已修复，整页冻结尚未归因（历史）

同一独立工作区、同一分支继续实施，所有既有改动保留；没有提交、推送、PR 或部署。**最新 `recovery-v18-dpr2` 的 held 100% 释放后仍超时并失去页面响应，因此本次没有完成“100% 恢复超时全部修复”的验收。** 较早通过的 `recovery-v16-dpr2` 不能覆盖这次失败。

本次明确修复和实现：

- 修复一个可重现的 100% 恢复退化：GPU gutter 逐像素交替访问相邻 tile 的 lazy `codes`，反复触发 48 MiB CPU 缓存解压与压缩。改为每个邻居一次读取，已驻留 GPU tile 的重放不读取 CPU payload。相同 smoke 路径中，100% 的 `tileBindingMs` 从 **13703.9 ms**（`recovery-smoke-dpr2` 超时）降至 **110.4 ms**（v2）及 **99.9 ms**（v3）；三者 tileUploads=198、paletteUploads=35、residentTiles=30。v3 新统计包含准备计划，旧统计不含独立 preflight，不能把这个局部比值当作完整就绪改善幅度。
- GPU `setFrame` 共享一次私有上传计划，不再 preflight/上传各构造一遍 gutter；验证与预算拒绝发生在修改已发布资源前。修复“新 palette 增大、新 tiles 减少”时按旧工作集错误拒绝的问题。真实 GPU 20 项像素检查通过，包括超预算拒绝后旧画面逐字节保持；CPU cache/owner/GPU 目标测试 83/83 通过。
- 水域 Worker 以 source ID、完整结构及 Float64 字节精确复用常驻几何和投影路径。alias 的 namespace/ID/version 仍严格验证，unique geometry 与 alias 元数据均计入预算；淘汰不留下持久索引引用。实际 v16 正常三档缩放均为 **0 path build、0 bounds miss、0 geometry upload**，204 个相同内容的跨版本 alias 复用。此前诊断 v12 的 100% 曾重建 39,396 个路径并重复上传约 22.2 MB；诊断条件不同，不做端到端百分比比较。水域目标测试 26/26、真实像素 5/5 通过。
- 地形 land clip 按实际 mask、projection 和 geometry revision 失效，水域分块变化不再误丢无变化的遮罩；仍覆盖同引用原地修改。TNO direct scene 成功后退役旧 navigation producer，避免重复全场景后台生产。保留前面已完成的水域 scratch 局部清除、精确边框分片准备、城市私有分片发布、二进制轮廓传输和 secondary index 分片等改动。
- 保留场景可交互且有 Worker 时，边界网格准备与提交不再额外要求 900 ms quiet；仍经过交互/任务准入和完整身份验证，native fallback 保持原规则。相关 border/scene/physical 组合 93/93、Python 边界 45/45 通过。
- 修正完整就绪 oracle：现在等待后台 border mesh/contour、dirty borders 和边框路径准备全部结束。旧报告未覆盖这两个边界窗口，不再直接用旧 2–3 秒数字声称包含全部边界的完整就绪。

最新正常缩放（v18，Chrome 155 / ANGLE D3D11 / RTX 5090 Laptop / 1280×900 / DPR 2；每档单次，无启动前 profiler/trace）：

| 缩放 | 初次反馈 | 更严格的完整就绪 | 最大已完成主线程 long task | 最大 rAF 间隔 |
|---|---:|---:|---:|---:|
| 130% | 4.9 ms | 2104.7 ms | 未记录到 ≥50 ms 的 task | 333.4 ms |
| 250% | 3.3 ms | 5919.7 ms | 50 ms | 241.7 ms |
| 100% | 179.9 ms | 5742.1 ms | 115 ms | 366.7 ms |

这不是 P95、FPS、INP 或显示器呈现延迟。旧 quiet 策略的 v17 正常样本为 2166.3/6311.6/5955.1 ms，已包含后台边界 gate，但尚无随后新增的 dirty-borders gate；v17 在后续 held 250% 冻结，不能记作完整流程通过。新策略的有限单次收益尚不足以证明稳定大幅压缩就绪时间，100% 反馈与帧尖峰仍是缺口。

冻结证据与诊断限制：

- 历史 `readiness-v5`、本轮 v11 和最新 v18 均出现 held 100% 释放后 settlement 30 秒超时，snapshot 和 Debugger 请求无响应。v18 的 held paint/undo/redo/continuity 均通过，释放前 queued 为 `BUILD_WATER_BITMAP` 和 `SYNC_POLITICAL_ID_GEOMETRY`。最终完整切换未通过。
- v17 在 held 250% 的 discovery `waitForFunction` 停住。Node inspector 只读检查确认唯一待返回协议请求是 `Frame.waitForFunction`；其内部 10 秒 timeout 数分钟仍未返回。记录现场后只 reject 此 Node callback 以进入既有故障采集，没有修改页面状态；`external-watchdog.json` 记录了人工介入。
- 工具所有 condition wait、结果读取和 handle 释放现在都有独立 Node watchdog，原 10/30/60 秒限制不放宽。37/37 工具契约通过；v18 已证实 30 秒后自动进入失败处理。该修复保证失败可诊断，不代表应用冻结修复。
- v17/v18 故障后 CDP Debugger.enable/pause/detach 均超时；browser trace 能取回约 64 KB，但仅有 tracing service 元数据，没有 renderer/GPU 工作事件。它不证明线程空闲，也不证明 GPU 死锁。之前启动前 profiler 的通过运行具有诊断扰动，不作性能基线。没有获得冻结现场的有效 JS/native 栈，不能据此指定根因。

已完成的真实行为：v16 三档 actual-held 的 paint/undo/redo/释放/完整发布通过；`recovery-smoke-v3-dpr2` 完整填色、41 点单 history 笔刷、导航、vector/raster、保存→HOI4→导入 TNO 及颜色像素恢复通过；`recovery-lifecycle-dpr2` 默认/0.5 DPR 导出、context loss 可见回退和恢复通过，均无 console/network errors。smoke/lifecycle 在最后的边界调度与更严格就绪 gate 之前运行，不能冒充最新完整恢复验收。最新 v18 正常三档通过，held 130/250% 通过，held 100% 失败。所有失败和中间证据保留。

架构边界、749 条验证路由和 Pages source graph 已通过；`pr:plan` 为只读计划，不代表 CI。最终构建与进程清理状态见 context.md。保留已有 Python action-import 白名单失败记录（对应文件与 HEAD 一致），不把它计作通过。不同目标测试组合有重叠，不能加总为唯一测试数。

## 本轮中途记录（历史，最终结果以上节为准）

仍在同一独立工作区和分支，保留此前及主工作区 WIP；没有提交、推送或发布。当前实现包括水域驻留二进制 Worker、政治 CPU 瓦片无损压缩、按字节预算保留政治投影路径、城市数据分片准备与原子发布、边框拓扑与填色轮廓的可转移 Float64 传输，以及独立分片准备边框 Path2D。最终源码的缩放、完整编辑闭环、导出/恢复和构建验收尚在进行。

诊断与已完成的改动：

- 原始 `readiness-v5-dpr2` 的 100% 释放后 30 秒 watchdog 仍未获得根因证据。旧源码另一次诊断在 held 250% 的 mouse.move 超时，页面评估也无响应；同源码其他完整诊断通过。不能把通过的重跑记为已证实修复原始冻结。Pro 网页模型已咨询，建议区分浏览器主线程与 GPU 进程阻塞；它不是故障根因证据。
- 本轮可复现的水域候选失效后 pending 不清理、过细 timer yield、LOD 切换丢弃驻留水域的问题已修复，失败报告保留。水域 Worker 保留准确孔洞、单要素透明度 union、湖岸线和纹理，只发布完整 ImageBitmap；取消、失败和原生回退有目标测试。
- 政治 CPU 缓存仍为 48 MiB，用 constant/RLE 无损压缩冷 codes，保留 tile 对象身份，实际读取时解码；路径缓存仍为 16 MiB，移除先于字节预算生效的 1024 项限制。`recovery-v5/v6` 中 CPU cache 无驱逐，100% 只新增 3 个瓦片，早期本轮 v3 为 31 个。
- 城市 collection 规范化、十万级 alias 和 base/scenario 字典在私有候选内分片完成，再只赋引用发布。promise 所有权、场景 request/epoch、字典引用和 city revision 变化会取消或重建；并发 full 字典升级不会被旧城市候选覆盖。
- `trace-recovery-current-v5/v6` 的诊断样本中，paint contour PATCH 单次最长同步传输由 7.9 ms 降至 0.3 ms；总计由 147 批 439.2 ms 变为 120 批 10.7 ms，批数不同，不能把总数比值当作同工作量端到端提速。
- v6 时间线定位到一次 242 ms 主线程任务主要是边框抽稀、投影和路径构建；GPU 进程另有 300–474 ms 任务。边框改为私有分片准备精确路径，原画序/样式/clip 保留，完整后才进入 pass 刷新。新增路径保留和候选各设预算，不能把估计字节等同于浏览器 native heap。
- 水域 scratch 改为仅清除上个要素的 device bounds（含 AA 与描边余量），避免数千次全表面 clear。软件 2D 试验因边缘像素偏差被撤回；没有放宽像素容差。新增多要素 oracle 使用原生 D3 Canvas 双精度流，避免 SVG 三位小数序列化误差被透明叠加放大；现有四个 SVG oracle 保持不变。零宽度湖岸线在原生与 Worker 路径都明确跳过。

`recovery-v6-dpr2` 在最后两项改动之前通过正常 130/250/100% 和三档真实 held Worker 编辑/撤销/重做。完整就绪为 2909.8/4442.7/2798.4 ms，最长任务 53/233/96 ms，最大 rAF 间隔 433.3/566.7/424.9 ms；与前一阶段 2620.2/4139.9/2677.5 ms 相比没有改善，不能作为本轮提速成功的依据。新边框准备与水域局部清理的最终实测待补。

## 前一阶段结果（历史记录）

TNO 默认采用栅格显示，可显式切换矢量。当前 full-readiness 续作已在 DPR 2 的 130/250/100% 正常缩放中，将完整就绪单次样本从此前 8–9 秒降至约 2.6/4.1/2.7 秒，分别缩短 70.4%/50.6%/68.9%。三档真实 held Worker 编辑、撤销、重做及释放后的精细完整发布、DPR 2 完整 smoke、导出和 context loss/recovery 均通过，当前源码的静态检查与 Pages 构建已收尾。**完整准备仍需数秒；v5 的一次 100% 释放后超时根因未明，不能宣称全项目性能问题已解决。**

工作区：`C:/Users/raede/.codex/worktrees/tno-raster-scene/mapcreator`。
分支：`codex/tno-raster-scene-20261018`，基线 `5fbbfdcff93ae36e24261b0e7f1ae58239fa4cc4`。
主工作区的未提交改动保留；本轮没有提交、推送、PR、合并或部署。

## Full-readiness 续作（已实现并完成本地验证，2026-10-18）

用户要求继续显著降低 DPR 2 的 8–9 秒完整准备时间及政治同步长任务。本轮落实：

- IDB 采用 readonly 单键读取；保存仅在完整场景发布后进入 idle，最多保留一个 8 MiB 候选，新 producer 取消旧保存。Worker 的资产 I/O 与 geometry 队列分离。
- 政治 collection、primarySpatial、colors、coverage 在 render lock 前完成私有分片准备，最终 O(1) 发布完整状态；混合 Atlantropa 变更纳入候选，同时改变 strategic values 时仍走原同步事务。
- city padding 策略每批只读取一次；full localization 在私有状态内按约 6 ms 时间预算分片复制/合并，完整 base+scenario 原子发布。单个几何操作或浏览器操作仍可超过预算。apply epoch、request、refs 或 revision 变化时取消并重新准备；真实 106,934 条数据与旧源码结果等价。

`readiness-v6-dpr2/tno-scene-zoom-retained-dpr2.json` 的 `passed=true`。同一 Chrome 155、RTX 5090 Laptop、DPR 2、1280×900 配置下，正常缩放结果如下；旧值来自上一阶段 `zoom-atomic-dpr2`：

| 正常缩放 | 旧完整就绪 | 当前完整就绪 | 当前初次反馈 | 当前最长任务 | 当前最大 rAF 间隔 |
|---|---:|---:|---:|---:|---:|
| 130% | 8848.7 ms | 2620.2 ms | 35.6 ms | 128 ms | 325 ms |
| 250% | 8383.7 ms | 4139.9 ms | 36.1 ms | 176 ms | 433.3 ms |
| 100% | 8608.3 ms | 2677.5 ms | 36.9 ms | 78 ms | 316.6 ms |

每档仅一个正常样本，不代表 P95、稳定 FPS、INP 或显示器呈现延迟。初次反馈与完整精细场景就绪分开计时。v6 三档均验证真实被暂停的 Worker 回复、paint/undo/redo、释放后的最终精细完整发布像素及 history。

v5 正常就绪为 2290.5/3555.6/2743.2 ms，但 held 100% 在释放后触发 30 秒 watchdog，诊断页面无响应；失败报告保留。同源码 v6 的完整同序列没有复现，根因尚未证实，不能记为已修复。额外 `retained-edit` 诊断虽通过，100% 为缓存命中、实际只 held 130/250%，不能用它关闭 v5 失败。早期 v1/v3 的候选自失效及作用域问题已修复并有回归；v2–v4 的中间性能/基线捕获失败报告保留，不计作最终通过。

已通过的目标验证：资产 4 suites / 135 项、collection/spatial 75 项、root integration 46 项、scope+candidate 19 项、hot-loop 55 项、label 69 项、hitcanvas 19 项、harness 21 项、localization 39/39 及相关 Python 6 项。套件存在重叠，不能加总为唯一测试数。另有既有 Python action imports 测试失败：`tests/test_scenario_chunk_state_actions_boundary_contract.py:130` 的 activation imports 白名单要求 1 项、源码实际 5 项；测试及对应源码均与 HEAD 一致，记录为现有测试缺口。

当前 DPR 2 full smoke 已通过：首次/重复填色、41 点笔刷单 history、undo/redo、平移及 130/250/100% 缩放、显式 vector/raster 切换、保存项目→HOI4→重新导入 TNO 及像素恢复。`readiness-lifecycle-dpr2` 通过默认/0.5 DPR 政治图层导出、编辑场景恢复、WebGL context loss 后可见回退及 GPU 恢复。这两轮及 v6 的 console/network errors 均为 0。

最终架构边界、748 条验证路由、Pages source graph、diff 检查通过；`pr:plan` 无未覆盖文件或路由缺口，但不代表测试/CI 已通过。当前源码 Pages artifact-only 构建通过，输出 `.runtime/reports/generated/tno-ready`，983.74 MiB。首次较长输出路径导致 transport 文件路径达到 263 字符，Windows CopyFile2 报 WinError 3；缩短输出路径后构建通过，没有修改构建源码。失败日志及部分产物保留。所有本轮浏览器已关闭，核对命令行和端口归属后停止 root-owned PID 44044 / session 66260，确认 port 8008 无监听。没有运行远端 CI 或发布。

当前证据：

- `.runtime/browser/tno-raster-scene/readiness-v6-dpr2/tno-scene-zoom-retained-dpr2.json`
- `.runtime/browser/tno-raster-scene/readiness-smoke-dpr2/tno-scene-smoke-dpr2.json`（`passed=true`）
- `.runtime/browser/tno-raster-scene/readiness-lifecycle-dpr2/tno-scene-lifecycle-dpr2.json`（`passed=true`）
- `.runtime/browser/tno-raster-scene/readiness-v5-dpr2/tno-scene-zoom-retained-dpr2.json`（包含未关闭的 watchdog 失败）
- `.runtime/reports/generated/tno-ready/pages-dist-manifest.json`（当前源码本地构建）
- `.runtime/tmp/tno-raster-scene/readiness-build-short-final.log`、`readiness-pr-plan-final.log`、`readiness-architecture-final.log`、`readiness-routes-final.log`、`readiness-source-graph-final.log`
- `.runtime/tmp/tno-raster-scene/readiness-*.log`（目标测试、诊断与中间失败记录）

## 缩放续作（已实现并完成本地验证，2026-10-18）

- 当前已发布政治纹理及其他图层与候选 CPU 数据、候选 pass canvases 分离。候选完整后才上传/发布，旧 GPU 场景在等待期间继续响应导航。过期候选、场景/投影/DPR/layout 失效分别处理；旧 GPU texture 不再强持 CPU tile 数组。
- 缩小超出当前精细帧覆盖时使用受预算约束的完整 overview，政治 ID 和其余图层必须成套覆盖。overview 只用于等待，最终就绪检查明确拒绝 overview/retained/staged 状态。
- 编辑期间更新已显示 ID 的 palette；额外前景补丁保留即时填色。撤销恢复当前显示来源进入时的颜色基线，清除补丁后露出旧标签/纹理。GPU canvas 与原生编辑覆盖层采用同一 CSS 尺寸。
- 水层新增独立候选栅格准备，分片处理 polygon 部件，完整后再复制到候选 pass；透明度和孔洞保留。临时表面单独计入共享资源估计，局部限额 32 MiB，政治/整个 GPU 场景 80/160 MiB 限额不变。
- 水域和特殊区域命中索引独立准备，按 geometry part 和网格 cell 分片，完成后一次替换；旧索引继续提供交互。来源过期会合并安排新候选，完成时刷新两张列表，避免交叠更新漏刷新。

本轮 `zoom-atomic-dpr1` 与 `zoom-atomic-dpr2` 均通过正常 130/250/100% 缩放，以及实际 Worker 结果暂停下的填色、撤销、重做、释放后完整精度切换。每档三轮等待期间 published epoch/publications 不变；100% 使用成套 overview。真实截图局部 RGB 比较覆盖抗锯齿小区域，undo 恢复 baseline、redo 恢复 paint，容差 3。暂停阶段明确证实仍有真实被拦截的 Worker 回复且从未提前释放；asset deadline 的取消窗口已单独处理。

| 正常缩放 | DPR | 初次画面反馈 | 完整就绪 | 最长主线程任务 |
|---|---:|---:|---:|---:|
| 130% | 1 | 48.6 ms | 3021.6 ms | 151 ms |
| 250% | 1 | 46.4 ms | 6289.1 ms | 277 ms |
| 100% | 1 | 43.7 ms | 3259.6 ms | 150 ms |
| 130% | 2 | 11.3 ms | 8848.7 ms | 158 ms |
| 250% | 2 | 53.0 ms | 8383.7 ms | 229 ms |
| 100% | 2 | 51.4 ms | 8608.3 ms | 150 ms |

同机器、同配置的本轮水层切片前 `v6` 最长任务分别为 673/210/671 ms；130/100% 与水层同步绘制约 660 ms 对应。只完成水层切片的 `zoom-final-dpr1` 为 109/212/405 ms，其中 100% 的同步 secondary index 约 325 ms。最新 100% 最长任务降到 150 ms；DPR 2 中 41,304 个水域部件的 index 准备耗时 114.1 ms、分 212 次 yield、最长切片 3.8 ms。250% 的政治 chunk/derived-state 同步更新仍是剩余阻塞源。

以上每档每倍率仅一次正常样本，不是 P95、显示器呈现时间、INP 或稳定 FPS 证明。完整就绪明确等待精细场景及 secondary index，拒绝 overview/retained/staged；不能把快速画面反馈当成完整准备变快。当前 DPR 2 完整准备仍要 8–9 秒，正常最大 rAF 间隔约 358–383 ms。旧报告的 readiness 未包含新增 secondary gate，不能直接计算端到端提速比例。截图与故障注入阶段不参与正常计时。早期 v2 listener 注册过晚、v3 时钟混用、DPR 2 取消窗口误判的原始失败报告均保留，未计作通过。

当前验证：214 项受影响 Node 测试、6 项取消/交叠刷新回归、更新后的 18 项测量脚本测试、20 项相关 Python 模块边界、TNO 水域 topology 契约、架构边界、744 条验证路由及 source graph 通过；`pr:plan` 无未覆盖文件或路由缺口。缩放实测后仅追加取消后重排的 liveness 修复，其专门回归通过。

`zoom-lifecycle-complete` 已通过真实首次填色、政治图层默认/0.5 DPR 导出、导出后 cache/DPR/view/颜色恢复，以及 WebGL context loss 后可见回退与 GPU 恢复；console/network errors 为 0。此前 `zoom-lifecycle-final` 的初次填色零变化失败保留：harness 曾把点击事务尚在等待 leaf detail 时的旧 ready 状态当成输入完成。修复后必须等待本次输入新增恰好一个历史步骤再等待渲染，未改变点击位置或额外缩放；重跑通过。

`zoom-smoke-final` 已通过首次/重复填色、单笔 41 点笔刷及撤销重做、平移、130/250/100% 缩放、显式矢量/栅格切换、保存项目、切至 HOI4、重新导入 TNO 和实际颜色像素恢复；console/network errors 为 0。此前 `zoom-smoke-complete` 在切到 HOI4 后失败于 harness 错把 TNO 专用 direct GPU 场景断言应用到其他场景。已将该断言限定到 TNO；其他场景仍须通过原有 raster/native 完成门槛，未改变产品模式策略。

最终产品源码 Pages artifact-only 构建通过，983.70 MiB，输出 `.runtime/reports/generated/tno-raster-scene/pages-dist-zoom-atomic/`。本地验证不代表远端 CI、PR 合并或部署。所有本轮浏览器 context 均已关闭；本任务 localhost 服务在交付时关闭。

本轮证据：

- `.runtime/browser/tno-raster-scene/zoom-atomic-dpr1/tno-scene-zoom-retained-dpr1.json`
- `.runtime/browser/tno-raster-scene/zoom-atomic-dpr2/tno-scene-zoom-retained-dpr2.json`
- `.runtime/browser/tno-raster-scene/zoom-lifecycle-complete/tno-scene-lifecycle-dpr1.json`
- `.runtime/browser/tno-raster-scene/zoom-smoke-final/tno-scene-smoke-dpr1.json`
- `.runtime/browser/tno-raster-scene/gpu-pixels-zoom.json`（当前 GPU 代码的 10 项像素验证）
- `.runtime/tmp/tno-raster-scene/zoom-targeted-complete.log`、`zoom-harness-complete.log`、`zoom-python-final.log` / `zoom-python-final-repair.log`、`zoom-water-topology.log`、`zoom-build-complete.log`、`zoom-pr-plan-complete.log`。Python 首轮两个过期源码断言已更新并通过目标重跑，失败日志保留。

## 已落地的结构变化

- 政治 ID 纹理和其他显示图层在可见 WebGL 场景中直接合成，TNO 新路径不再把政治 GPU 输出复制回 2D 主画布。
- 各图层按自身 revision 上传纹理；默认 TNO 的边框、国家、城市、海洋标签具有真实的 96 CSS px 绘制缓冲，范围内平移可复用。启用交通类别或物理区域名称时，标签层保守采用零余量并继续补绘。
- 几何首次通过可转移的二进制数组发送给 Worker，后续构建引用驻留 ID/version；Worker 直接读取二进制坐标，不重新展开为嵌套数组。
- 连续笔刷在几何稳定时更新调色板，松开后统一提交准确的前景覆盖顺序。撤销重做、项目保存和高精度导出仍使用原有规范数据。
- 显式资源上限：几何 48 MiB、路径 16 MiB、政治纹理 80 MiB、整个场景纹理 160 MiB（包含政治纹理）。这些是可统计资源池，不能当成浏览器总内存或驱动显存的上限。

## 第一阶段实测收益与未达标项（保留基线）

最终完整对照：同一页面按 raster / vector / vector / raster 顺序，Chrome 155，NVIDIA RTX 5090 Laptop / ANGLE D3D11，1280×900，DPR 1。每种模式 12 次重复改色、2 次相同的 41 点笔刷、2 组相同缩放和平移，保留所有样本。截图、像素读取和报告写入不在计时区间内；浏览器进程日志开启。终点是输入后观测到编辑/渲染状态落定，**不是显示器呈现时间、INP 或 FPS**。

| 操作 | 矢量 | 栅格 | 本次差异 |
|---|---:|---:|---:|
| 重复改色，中位数 | 482.90 ms | 251.35 ms | 约降低 48% |
| 重复改色，样本 P95 | 575.10 ms | 530.10 ms | 约降低 8%，未达到降低 50% 的目标 |
| 41 点笔刷，两次均值 | 6447.35 ms | 4156.40 ms | 约降低 36% |
| 平移，两次均值 | 3045.80 ms | 1458.35 ms | 约降低 52% |

栅格两次平移的 rAF 间隔 P95 为 33.3 / 33.4 ms，但期间仍有 891–909 ms 的长任务，不能据此宣称稳定流畅或 30 FPS。缩放处理完成需要 2.72–6.38 s；第二组 130% 缩放栅格为 3.05 s，矢量为 0.27 s，退化明确。最终四组全部完成，页面 console/network errors 为 0。

驻留的直接证据：早一轮返回已有视图后的平移没有新增几何哈希、坐标上传或瓦片构建，常驻几何约 42.79 MB。它消除了重复传输，但未消除所有主线程工作。最终各组结束时浏览器报告的 JS heap 约 1.1–2.4 GiB，不能把资源池上限解释为总体低内存。

第一阶段结束时 runtime 会在开始 draw 或几何版本失效时撤销 direct frame，准备未完成时走原生回退；上面的缩放续作已替换该行为。此处保留当时的基线与验收边界，不代表最终源码仍采用旧策略。

## 第一阶段已运行验证（历史证据）

- 最终受影响 Node 测试：569/569；另有传输、资产、坐标和 source 兼容测试 68/68。
- 真实 GPU 像素：10/10，覆盖上下方向、透明混合、边缘和瓦片接缝。
- DPR 1 编辑 smoke、保存后切换场景再加载、默认/低 DPR 导出和真实 WebGL context loss 后恢复均通过。
- 最终 DPR 2 smoke：填色、41 点笔刷、单笔历史、撤销重做、平移、100/130/250% 缩放、显式矢量/栅格切换通过；截图在目标处检出正确颜色。
- 最终四组性能对照通过。前两轮失败/中断记录保留，没有计作通过；其输入停滞未被证明是应用崩溃。有界等待、原始错误保留和增量证据已补齐，最终运行未复现。
- 架构边界、相关 Python 模块边界、743 条验证目录结构、Pages source graph、locale JSON 和 diff 格式检查通过。静态审查发现的标签 deferred-fit 边缘缺陷已修复并复核关闭。
- `npm run pr:plan` 已运行且路由覆盖完整；它只是计划，不能当成 CI 通过。未运行全库测试或远端 CI。
- 最终源代码的 artifact-only Pages 完整构建通过（983.65 MiB），输出位于 `.runtime/reports/generated/tno-raster-scene/pages-dist-final/`。本轮浏览器和 localhost 服务已关闭。

## 证据位置

- 最终性能：`.runtime/browser/tno-raster-scene/benchmark-v3/tno-scene-benchmark-dpr1.json`
- 最终 DPR 2：`.runtime/browser/tno-raster-scene/smoke-core-dpr2-final/tno-scene-smoke-core-dpr2.json`
- 保存/加载：`.runtime/browser/tno-raster-scene/roundtrip-dpr1/tno-scene-roundtrip-dpr1.json`
- 导出/上下文恢复：`.runtime/browser/tno-raster-scene/lifecycle-dpr1/tno-scene-lifecycle-dpr1.json`
- GPU 像素：`.runtime/browser/tno-raster-scene/gpu-pixels.json`
- 检查日志：`.runtime/tmp/tno-raster-scene/`

## 完成范围

- [x] 独立工作区与主工作区 WIP 隔离。
- [x] GPU 直接场景、独立图层刷新、二进制驻留和 TNO 默认策略。
- [x] 编辑、历史、保存加载、导出、场景/模式切换、上下文恢复闭环。
- [x] 完整配对性能证据和明确的退化记录。
- [x] 最终 Pages artifact-only 构建收尾。
- [x] 已发布场景与候选版本分离、成套 overview、完成后整体切换。
- [x] 水层及 secondary index 分片准备，取消后恢复与旧场景编辑正确性。
- [x] DPR 1/2 正常缩放和等待准备时的真实编辑/撤销/重做；最终完整编辑、保存加载及上下文恢复。
- [x] DPR 2 完整就绪时间缩短 50.6%–70.4%，政治派生状态及完整本地化私有分片准备；最新 DPR 2 编辑、保存加载、导出和恢复闭环通过。
- [ ] 查明 v5 单次 held 100% 释放后的 watchdog 根因；同源码完整 v6 未复现。
- [ ] 缩放性能达到可推广到全项目默认的标准。


## 2026-10-19 合并交付

用户明确授权完成合并推送。本次整合整个独立工作树的 TNO GPU 场景、异步私有准备、独立图层和二进制驻留改造。提交前实际运行：受影响 Node 测试 1848/1848、Python 边界测试 52/52、script portfolio、test import graph、756 条路由 schema 全部通过。Python 旧同步调用字符串断言已更新为 prepared source 身份校验、回退和先于视觉发布的顺序契约。

`pr:plan` 完成；`verify:commit` 在规划阶段因多项架构文件仅注册 PR/nightly/release 路由而退出，未执行测试，不能记作通过。已直接执行上述受影响测试，并依赖最终 PR 的 required checks 完成远端门禁。

剩余限制不因交付改变：DPR 2 首次 250% 最大帧间隔 266.7–291.6ms，重复 250% 约 91.6–91.7ms；三会话 27 次缩放全部就绪，但一次首次 130% 出现 157/206ms 长任务。严格世界地形像素比较 130/250/100 为 1/0/1 像素差异，仍为 FAIL；未放宽阈值。编辑、保存加载、保留场景编辑及上下文恢复闭环通过，完整数值与证据见 context.md。远端检查、合并和自动 Pages 发布分别以 GitHub 回执为准。

PR #245 首次 CI 的缓存回归仍假定 TNO 默认关闭栅格，原生参考阶段在 requested=false 断言失败。对照启动改为明确选择矢量，保留全部像素、缓存、恢复断言及原超时。最终 CI 回执见 https://github.com/raederhans/scenario-forge/pull/245 。
