# 精度扩容四方向：实现与验证记录

日期：2026-09-20。代码基线：PR #139 的 `850202d80c84b067291a7ed335b4eaae7f46fdaf`；真实运行时数据来自 main `2e241f4a0c662c78115ad6196491a6ecd4a08704` 的成功 deploy-dist（run 35508587987，artifact 10603858877）。基础 JS 和 vendor D3 已按 Git blob SHA 核对。没有改 main、原 PR、data 源资产、dist、部署配置或用户存档。

## 交付状态

这是四方向的首轮可执行实现，不是全世界 LOD 上线或整个渲染器迁移完成。代码包含默认启用的有界加载、增量存储物化优化、worker 紧凑几何消费，以及仅对显式声明的 LOD family 生效的选择与合并。LOD 数据只在 `.runtime` 生成候选，未写入源数据或发布清单。

| 方向 | 已实现 | 尚未完成的较大范围 |
| --- | --- | --- |
| 显示精度分级 | 全分片 world/regional/detail 候选构建；共享内部边简化，固定外边界；误差/拓扑失败回退；同 family 的缩放滞回和合并优先级 | 全场景约束验收、动态屏幕误差、精确编辑/导出需求驱动加载及候选正式发布 |
| 成本驱动加载 | 实际 chunk loader 接入并发数和在途估算字节双限制、优先级、旧选择降级、场景取消、超大任务单独执行与诊断 | 全球重新分片、视口级消费引用计数取消、统一解码 worker 调度；复用原有成本分片，不另建分片器 |
| 增量传播 | winner 表只更新触及的 ID；旧快照按不可变源索引保留；Map/兼容数组按需物化；全覆盖计数不再强制创建数组 | 下游可变 metadata 检查和部分全量扫描仍存在，未宣称所有操作成为 O(delta) |
| 紧凑几何 | worker 直接消费 Float64/Uint32，避免逐点重建嵌套数组；独立 feature buffer 可单独回收；真实 D3 投影流不变 | 主线程权威数据仍为 GeoJSON；startup codec 和持久化格式不变；不是全应用零拷贝 |

## 实现边界

### LOD

`tools/build_political_display_lods.py` 读取现有分片并输出独立候选目录。仅简化共享内部边界，不简化分片外边界。显式 protected IDs、无效几何、日期变更线跨度以及原生 coverage_invalid_edges 涉及的对象保留原始几何；剩余子覆盖必须通过严格 coverage 检查。比较原/新 union、组件数、孔洞数和 Hausdorff 偏差；GEOS 输入容差必要时缩小，实际误差上限不放宽。

初始整块回退版本在六块试跑中没有产出 regional。检查后改为保留异常对象，只简化其余有效子覆盖，获得下述四块收益。未修复或隐瞒既有不合法覆盖。world 的 0.02、regional 的 0.005 是经纬度误差上限，不是像素误差保证。候选元数据重算 hash、原始字节、点数、部件数、feature bounds 和原有路径成本公式；不继承旧 LOD 诊断。

同一 family 必须具有相同 ID 成员，整块选择一种等级；重叠缩放区间保留已有等级，避免反复切换。全局 coarse 始终保留。用户的全精度 detail、归属与存档数据不变。不得直接把候选清单当作 canonical release。

### 调度、增量与紧凑表示

默认两个并发任务、32 MiB 在途估算预算，未知任务按 8 MiB 计费。采用 decoded/cache/source hints 的最大有效值，不把 gzip 压缩比当成解码内存缩减。一个超大任务允许单独执行；可见批次高于预热，旧选择任务降级。沿用现有请求去重、generation 检查与场景 AbortController；即使底层忽略 abort，也在实际结束前保留容量，避免取消导致并发失控。指标可通过 loader 的 `getLoadSchedulerStats()` 或注入回调取得，不代表真实 heap 测量。

增量 store 的旧快照不引用可变 winner 表，也不串联保留历史快照。normalized snapshot 的 lookup 随包装后的索引更新。颜色、metadata 检查和源几何引用语义保留。

紧凑 buffer 按 feature 独立拥有，不用小 subarray 长期挂住整个上传批次。缓存使用紧凑表示权重。D3 继续负责球面投影、日期变更线、裁剪、重采样和孔洞；只替换源坐标遍历。普通 GeoJSON、小更新、失效和 eviction acknowledgement 路径保留。

## 实际验证

- 新增 Node 目标套件：27/27 通过。包含真实 chunk loader/state actions、请求去重和场景切换、100 次增量替换/驱逐/重排、snapshot 包装、LOD 选择、实际 vendor D3 指令对照、紧凑缓存淘汰和新增路由局部检查。
- 既有 kernel/缓存压力套件：23/23 通过，与新增套件合计 50 项 Node 用例。先前仅模拟 GeoJSON 的传输测试替身缺少 projection.stream，复跑时 1 项失败；该用例改用真实 vendor D3 投影并保留全部断言后通过。既有 kernel 测试文件本身未改。
- Python/Shapely LOD 目标：7/7 通过。含共享边、孔洞、固定邻接、无效子覆盖隔离、日期变更线、ID、候选 hash/bounds 和源字节不变。
- Chromium 144.0.7559.96 的离线内核检查：原生 Path2D/OffscreenCanvas 的 plain/packed RGBA 三次对照均 0 通道差异；孔洞 alpha=0、内部 alpha=255，源数据未改、淘汰 ID 正确。此前测试夹具的一块日期变更线多边形绕向表示地球补集，导致 plain/packed 同样填满孔洞；修正夹具绕向，保留像素/孔洞断言，没有改源数据或放宽比较。
- 真实 TNO coarse 12,022 个 feature，以及 GER part.0 的 105 个 feature，逐要素 `d3.geoStream` 与紧凑流指令全部相等。
- JS 语法与 whitespace 检查通过。

**重要未通过/未运行项：** localhost 导航被环境返回 ERR_BLOCKED_BY_ADMINISTRATOR；离线 blob-worker 尝试也返回 Worker task client crashed，未确定其根因，不能当作通过。离线成功只证明原生栅格内核，不证明标准 module-worker URL 加载和跨线程整合。新增标准 Playwright 用例保留这些严格断言，完整仓库应执行它及已有 worker/client、场景编辑/撤销、导入/PNG 导出、架构/路由/生成 import graph 和 canonical Pages build。完整 CI、全站运行及目标 Windows 设备 FPS/内存未在本次环境验收。

## 当前真实数据实验

暖机 3 次后测量 11 次的本地 Node v22.16.0 中位数；两种解码使用同一个已打包输入，不含网络、JSON parse、发送端打包或绘制。计时不设置硬性跨设备阈值。

| 测量 | 原路径 | 新路径 |
| --- | ---: | ---: |
| TNO coarse 接收端解码 | 427.76 ms | 73.91 ms |
| GER part.0 接收端解码 | 2.56 ms | 0.54 ms |
| 一次 promotion + eviction，均物化完整输出 | 11.90 ms | 6.79 ms |
| 同样的增量组合，新版且不请求兼容数组 | 不作等价全渲染比较 | 0.063 ms |

最后一行只展示不物化时的存储层成本，不能作为整个 promotion 的耗时。紧凑 coarse buffer 权重约 41.10 MB（十进制），不是浏览器实测内存。没有声称整体 FPS 提升或端到端相同比例提速。

六个 TNO 分片候选，regional 顶点数：

| 分片 | 原始 | 候选 |
| --- | ---: | ---: |
| ENG | 29,850 | 21,360 |
| FRA part.0 | 72,826 | 51,420 |
| GER part.0 | 23,472 | 18,696 |
| GER part.1 | 48,545 | 39,787 |
| KOM | 4,121 | 原样保留 |
| PFC | 42,324 | 原样保留 |

仅这六块对应的 world coarse 候选改造，使全局 coarse 点数从 1,885,672 到 1,850,822。不是全世界改造的结果，也不是统一简化百分比的承诺。

## 复现

```sh
node --test tests/precision_scaling*test.mjs tests/geometry_raster_worker_kernel_behavior.test.mjs
python -m unittest tests.test_political_display_lods -q
npx playwright test --config=playwright.config.cjs tests/e2e/dev/precision_scaling_packed.dev.spec.js --workers=1
python tools/build_political_display_lods.py --source-root . --scenario-id tno_1962 --output-root .runtime/reports/generated/precision-lod --chunk-id political.detail.country.ger.part.0 --chunk-id political.detail.country.ger.part.1 --chunk-id political.detail.country.fra.part.0 --chunk-id political.detail.country.eng --chunk-id political.detail.country.kom --chunk-id political.detail.country.pfc
```

浏览器命令依照仓库现有 dev lane 在本机运行；默认 CI 会忽略 dev 用例，不应误称其由普通 PR 快速检查覆盖。新增验证记录保持原有顺序，浏览器路由仍为 main-thread/heavy。完整生成元数据及导入图需要原仓库工具验收，没有放宽任何既有门槛。

## 合并前与后续

优先完成标准 module-worker 整合和完整仓库验证，查清离线 worker 失败是否纯环境问题；随后对候选 LOD 执行既有混合等级/邻接/归属/存档契约和实际编辑导出验收，再按正常数据治理流程发布。屏幕误差自适应、全球成本重新分片、所有下游 delta 消费与紧凑主线程表示仍属于后续任务，不以本次代码存在代替这些验收。

## 本机合并验收补充（2026-09-20）

在 Windows 完整仓库中，62 项 Node 内核、客户端与 precision-scaling 测试、7 项 Python LOD 测试通过。localhost Chromium 的原生缓存压力、classic/module worker 传输及 packed 几何集成共 3 项通过；packed 用例确认像素一致、孔洞、缓存复用、驱逐、源数据不变与零 fallback。此前标准 module-worker 未通过的验证缺口已由本次实际运行补齐，但未据此推断先前离线环境失败的根因。

587 条验证路由及架构边界检查通过。测试导入图检查发现已提交图过期，使用仓库生成器更新后复查通过。PR 的源码交付仍须包含规范 Pages 构建产物；上述证据不等于远端 CI 或部署成功。

补跑旧加载器测试发现调度器在 fetch 与状态完成之间增加异步间隙。将缓存发布与 generation 完成移入受调度的操作，队列取消单独完成状态清理；既有测试仅等待实际 admission 开始，保留原有完成时序断言。相关加载器、取消、缓存、几何存储与调度器共 36 项通过。TNO 样例的涂色、撤销/重做、存档重载、跨场景导入、缩放及 PNG 导出像素检查也通过。

最后一次时序修复后的 TNO 复跑完成存档、跨场景恢复与 PNG 像素采样（451 个目标色像素），但超过既有 110 秒总时限，Playwright 最终为超时失败；不能将其报告为最终整条用例通过。原始时限未调整，该耗时风险按用户本次性能放宽决定记录。分块刷新 Python 契约 38 项通过。

用户明确允许本次 PR #139、#140 的性能门槛适度放宽、优先合并。该决定不代表性能回归已解决，不改变几何正确性、数据发布条件或后续性能优化责任。
