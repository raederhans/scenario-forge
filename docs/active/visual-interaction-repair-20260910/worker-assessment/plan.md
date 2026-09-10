# 第三层性能评估：持久 Worker 与绘制分工

2026-09-10。第一、二层实现和验证完成后，基于最终代码重新采样。本文件是评估与后续实现边界；本轮没有开启或改写 Worker。

结论：值得进入第三层，但应接管剩余的几何构建、命中图和精确绘制，并验证画布合成收益。现有 Worker 开关不能覆盖主要瓶颈。主线程保留输入、编辑事务、撤销重做和最终画面接收。

## 第一、二层的最终实测

localhost 普通 balanced 模式，等高线关闭，Chromium 1280×720，设备 DPR 2；相同脚本与动作节奏，未使用响应改写或诊断渲染模式。balanced 保留自身的画布 DPR 上限。前后各为本机单次样本，不是干净提交的性能基线或发布准入证明。

| 项目 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 四次连续拖动的输入序列完成时间 | 11,916 ms | 3,355 ms |
| 该动作及恢复期间的最大 RAF 回调间隔 | 1,954.5 ms | 304.9 ms |
| 该观察窗口内长任务累计时间 | 11,350 ms | 603 ms |
| 填色后的最长主线程任务 | 1,455 ms | 89 ms |
| 填色对应局部重绘 | 被拒绝，reference-transform-mismatch | 成功，约 2 ms |
| 单次纯平移后的政治数据 promotion | 1 次 | 0 次 |
| 单次纯平移后的命中图绘制 | 2 次 | 1 次 |
| 静止填色后的命中图绘制 | 1 次 | 0 次 |

输入序列包含脚本刻意设置的移动节奏与动作间隔，不代表单帧或单次拖动延迟。每次动作后的稳定等待至少 1.2 秒，因此报告中的 elapsed 不能当作响应时间。RAF 间隔、Long Tasks 和 CPU 采样是不同指标，不应互相代替；CPU inclusive 样本存在父子调用重叠，不可相加。例如 withValidatedCache 的累计时间包含全部回调绘制，不能再解释成缓存校验本身的开销。

最终报告与原始采样：

- `.runtime/browser/interaction-perf-20260910/tno_1962-dpr2-steady.json`：前一轮研究基线。
- `.runtime/browser/interaction-perf-implementation-20260910/tno_1962-dpr2-steady.json` 及同名前缀 `.cpuprofile`：最终热缓存连续操作。
- `.runtime/browser/interaction-perf-implementation-20260910/tno_1962-dpr1.json` 及同名前缀 `.cpuprofile`：最终首次细节缩放与 DPR 1 操作。
- `*-visual.json`：TNO DPR 2、现代地图 DPR 1、HOI4 DPR 1 的实际颜色、命中、连续操作及撤销重做检查。

一次最终采样在产生交互数据前超过 20 秒启动稳定等待，保留为 `tno_1962-dpr2-startup-settle-failed.json`。未扩大超时；补充状态诊断后的 DPR 2 重跑和 DPR 1 完整流程均成功。首次失败未取得充分运行状态，原因尚不能确定；不能将其算作交互性能样本，也不能声称已修复该偶发现象。

## 剩余瓶颈与优先级

| 工作 | 最终证据 | 第三层判断 |
| --- | --- | --- |
| 首次细节几何与边界网格 | TNO DPR 1 首次缩放最长任务 1,306 ms；CPU 采样中 source border meshes 累计约 731 ms，TopoJSON mesh 约 639 ms，存在调用重叠 | 高优先级：将纯拓扑处理和投影移到持久 Worker |
| 命中图 | DPR 2 每次平移仍有一次约 97～135 ms 的绘制；四次连续操作的 drawHitCanvas CPU 累计约 446 ms | 高优先级：与几何缓存共用版本，异步生成可用的命中结果 |
| 画布合成与复制 | 热缓存短平移的最长任务约 320 ms；连续操作 drawImage CPU 累计约 446 ms，transformed-frame 合成约 489 ms，后者包含前者 | 必须纳入原型：Worker 精确合成并回传完成帧，测量最终提交是否仍受像素复制制约 |
| 热缓存政治绘制 | 短平移的精确 political pass 约 107～109 ms；连续动作最终恢复约 74 ms | 与 Worker 投影、路径缓存、精确绘制合并处理 |
| 填色 | 局部政治重绘约 2 ms，整体后续任务仍约 78～89 ms，包含其他图层和 UI 刷新 | 保留主线程立即反馈；不应先把编辑事务整体异步化 |

三剧本视觉检查中的首次缩放长任务分别约为 TNO 1,410 ms、HOI4 1,550 ms、现代地图 221 ms。它们说明冷启动成本仍随数据复杂度变化，不能拿热缓存结果推断首次缩放已流畅。

代码对应：`static_border_mesh_lifecycle.js` 的 8 ms 预算检查发生在国家处理之间；`border_mesh_source_selection.js` 的单次同步 `topojson.mesh()` 无法被该检查中断。`map_renderer.js:drawHitCanvas()` 仍逐个可见要素调用投影路径绘制。`cached_pass_compositor_owner.js` 与 `transformed_frame_compositor_owner.js` 仍在主线程合成多个画布。

## 为什么不能直接打开现有 Worker

现有 `js/core/political_raster_worker_client.js` 和 `js/workers/political_raster.worker.js` 是默认关闭的 v4 政治栅格通道，已有场景、数据、颜色、相机等过期结果检查，可以复用这些契约。

但 `political_partial_repaint_owner.js:buildPoliticalRasterWorkerPacket()` 先在主线程逐点投影、应用相机和 DPR，再创建完整的像素坐标数组。客户端每次发送这个 packet；Worker 每次创建新的 OffscreenCanvas，并仅绘制政治图层。它没有接管边界网格、命中图或完整合成，也没有复用原始几何。直接启用可能只是增加传输及分配，收益尚未验证。

现有 packet 是逐点投影。新通道必须匹配当前 D3 地理流的裁切、重采样、孔洞及跨经线语义，不能只证明颜色字段和要素数量相同。

OffscreenCanvas 支持在 Worker 中绘制并生成 ImageBitmap，这是架构可行性的依据，不能据此推导本项目的实际加速比例。[MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)。普通 Worker 消息会复制数据，支持的可转移对象可移交所有权，因此几何应按版本初始化并传递增量，不能每帧重复完整序列化。[MDN Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。

## 建议的实现边界

1. **持久几何服务。** 每次场景或真实几何版本变化初始化一次 Worker；Worker 保存拓扑、投影、简化结果及路径。相机只传 x/y/k、DPR、视口；填色只传改变的要素 ID 和颜色。优先移走首次边界网格构建及命中图。
2. **后台精确绘制和合成。** Worker 持有可复用的 OffscreenCanvas，生成完整的政治及基础画面。主线程在拖动中继续显示最后一个可用画面；新画面完成后才替换。单独测量最终 bitmap 接收、复制与显示成本；如果复制仍占主导，再比较减少中间画布和显示层拆分的方案。
3. **明确任务版本和替换规则。** 几何 generation 与相机/颜色 revision 分开；一个正在处理的请求加一个最新待处理请求，覆盖过时相机请求。过期结果即使已经完成也不能覆盖当前编辑。Worker 内部仍需可让出的批次，让取消与新版本消息有机会被处理。
4. **命中与显示同步。** 命中结果携带相同的几何/相机版本，旧结果不能用于当前精确拾取。等待期间保留现有空间索引点查询；非交互 Arctic shells 继续只参与显示。主线程维护 canonical state、编辑事务、历史和 DOM。

不在本阶段迁移 UI 框架，不先切换 WebGL，也不把所有渲染和编辑状态整体放进 Worker。是否进一步改变显示画布所有权，取决于精确合成原型的实测结果。

## 原型需要证明的结果

- 在同一设备和普通配置下分别比较冷缩放、热缓存连续拖动、停手恢复和连续填色；记录主线程任务、输入延迟、稳定画面时间、传输/合成成本及内存，至少多次完整重跑后再作收益判断。
- 纯拖动不发送整份几何；颜色变化不重建拓扑；只显示当前版本的 bitmap 和命中数据。恢复中拖动、跨剧本切换、DPR/视口变化、连续填色、撤销重做均不可被迟到结果覆盖。
- 保留三剧本的真实颜色、视口边缘选中、地理孔洞与 shell 语义；专项复查亚得里亚海、刚果湖、俄罗斯北极、索马里，以及项目导入/导出。前两层的目标测试继续通过。
- 收益必须来自实际主线程阻塞降低，且没有明显的总体恢复时间、峰值内存或视觉退化。这里没有预先承诺 60 FPS，也没有修改现有性能基线或阈值。

第一、二层验证记录见同目录 `context.md`。目标行为测试 132 + 47 项通过；启动资源 63 项通过；构建、dist 镜像和架构边界通过。相关 Python 边界组 55/56，通过 HEAD 对照确认剩余一项是已有的旧源码断言。Worker 原型尚未实现，以上收益属于待验证假设。
