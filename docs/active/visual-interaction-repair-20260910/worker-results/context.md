# 第三层实现与实测

2026-09-10。本轮按用户授权实现持久 Worker；前两层记录及历史原始采样保持原样。

## 已实现

- 持久边界 Worker 保存场景拓扑及要素策略，计算按国家分组的省界、地方边界和 detail ADM。场景及几何源变更使旧结果失效；生命周期取消与恢复锁保留。
- 持久 D3 栅格 Worker 接管命中图和政治细节。按几何引用增量上传，复用投影 Path2D 和两张绘制表面；纯相机移动不重新上传几何。保留 D3 地理流的裁切、孔洞、跨经线和极区语义。
- 主线程保留场景状态、编辑事务、立即填色、撤销重做和最终显示。异步结果核对真实场景、投影、几何、相机、尺寸和颜色；等待时保留已有画面。
- 请求最多一个正在执行，加上每类表面的最新等待项。A→B→A 复用同一个接收者，避免重复消费者提前释放当前 bitmap；失败关闭后台栅格通道并使用原同步路径。
- 后台分批采用 8 ms 工作预算；支持时调用 scheduler.yield，避免每 64 个缓存要素重复计时器等待。[MDN 对 Worker 中 scheduler.yield 的说明](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)。

主要实现位于 `js/core/{border_mesh_worker_client,geometry_raster_worker_client}.js`、`js/core/renderer/{border_mesh_worker_runtime,border_mesh_worker_kernel,geometry_raster_runtime_owner,geometry_raster_worker_kernel}.js`、两个 `js/workers/` 入口，以及 map_renderer 的窄注入点、精确恢复调度和绘制编排。

## 普通模式对照（水域补充修复前）

localhost、TNO、balanced、等高线关闭、Chromium 1280×720。连续拖动设备 DPR 2，实际 backing DPR 由 balanced 决定。使用同一份源码的 `geometry_worker=0` 作关闭对照；开启为默认。关闭两轮、开启三轮，顺序 off1/on1/on2/off2/on3，独立浏览器且没有响应改写。不能把这些样本当成干净提交的性能基线或发布准入。

| 连续四次拖动与恢复 | 关闭 Worker，中位数（范围） | 开启 Worker，中位数（范围） |
| --- | ---: | ---: |
| 最大 RAF 回调间隔 | 526.2 ms（523.2–529.3） | 167.2 ms（164.9–170.6） |
| 长任务累计时间 | 1385 ms（1128–1642） | 249 ms（205–321） |
| 输入序列完成时间 | 3865 ms（3761–3969） | 3415 ms（3310–3587） |

RAF 间隔约下降 68%，长任务累计时间约下降 82%；输入序列约下降 12%，它包含脚本设定的动作节奏。指标包含停手恢复，不代表持续 60 FPS。每次动作另含至少 1.2 秒稳定观察，elapsed 不等于响应延迟。

DPR 1 首次细节缩放各一轮：最长主线程任务从 1533 ms 降到 865 ms；最大 RAF 间隔从 1534 ms 降到 877 ms；含稳定等待的 elapsed 从 6612 ms 到 5444 ms。该冷启动结论只有一组对照，不能据此承诺固定改善比例。首次大数据传输和主线程基础画面构建仍有明显停顿。

热缓存平移的后台命中图示例耗时 26–29 ms，主线程提交约 0.1 ms；政治细节后台约 203–206 ms。两者记录的几何上传及新 Path2D 构建均为零，说明相机变化复用了几何。后台耗时和主线程提交耗时不可互换。填色的最长任务样本波动较大，本轮不声明稳定提速。

## 最终完整水域版本对照

修复 required semantic layers 后重新运行普通 TNO：DPR 2 热态关闭/开启各两次，DPR 1 冷缩放关闭/开启各一次。下表优先于上文旧采样；未修改响应、图层默认值、性能阈值或基线。六次运行均完成，无 pageerror 或控制台 error。

| 项目 | 关闭 Worker | 开启 Worker |
| --- | ---: | ---: |
| 连续四次拖动，最大 RAF 间隔中位数（范围） | 382.7 ms（313.2–452.1） | 213.6 ms（200.0–227.2） |
| 连续四次拖动，长任务累计中位数（范围） | 1165 ms（884–1446） | 615 ms（533–697） |
| 连续四次拖动，输入序列中位数 | 3753.5 ms | 3662 ms |
| 连续四次拖动，含稳定等待的总耗时中位数 | 5669 ms | 5374.9 ms |
| 短平移，最大 RAF 间隔中位数 | 439.1 ms | 211.6 ms |
| 首次细节缩放，最长主线程任务（单次） | 1912 ms | 1731 ms |
| 首次细节缩放，含稳定等待的总耗时（单次） | 7650.4 ms | 7239.3 ms |
| 热态填色，最长主线程任务中位数（范围） | 123 ms（102–144） | 169.5 ms（141–198） |

连续拖动最大 RAF 间隔约降低 44%，长任务累计约降低 47%；总耗时只降低约 5%，输入序列约降低 2%。这属于减少集中阻塞，不能表述为所有操作响应时间减半。首次缩放仍有约 1.7 秒长任务：采样中的场景集合/空间索引重建、基础图层绘制及首次消息复制仍在主线程。上文 865 ms 是水域补充修复前的历史结果，不能代表最终版本。

热态填色这两组样本并未改善，开启样本甚至更慢；198 ms 那次 CPU 采样记录约 75.6 ms 垃圾回收，另一次开启 141 ms 与关闭第二次 144 ms 接近。两轮不足以归因成稳定的 Worker 退化或证明无退化；此处保留全部结果。DPR 1 填色最长任务关闭 86 ms、开启 104 ms。局部编辑仍在主线程，其余图层、图例与 UI 刷新未迁入 Worker。

补充采集独立浏览器所拥有的 Windows 进程内存快照，不触及用户浏览器：热态动作结束后的 working set 关闭约 1400/1407 MiB，开启约 1613/1555 MiB，增加约 148–212 MiB。动作开始前增加约 100–122 MiB；样本未强制 GC，不能视作同时峰值、长期无泄漏或精确内存开销证明。常驻几何缓存的内存成本需要保留在后续取舍中。

证据：`final-comparison.json`、`final-{off,on,off2,on2}-tno_1962-dpr2-steady.json`、`final-cold-{off,on}-tno_1962-dpr1.json` 及同前缀 CPU profiles。

## 合成原型决策

冻结真实 TNO 图层副本，按原顺序、DPR、相机与 overscan 偏移比较五种模式，每种五次，共 25 个逐像素一致样本。当前主线程合成 API 同步耗时中位数约 7 ms；Worker 已缓存图层时总延迟约 8.1 ms；全部图层变化时主线程捕获/提交中位数约 11 ms，总延迟约 31 ms。因此没有将独立 Worker 合成接入默认产品链路。此原型只量 API 阻塞和往返延迟，GPU 工作可能延后，不是完整拖动显示管线基准，也没有证明峰值内存不增加。

## 验证与已知限制

当前完成：170 项 Worker 与渲染相关目标 Node 测试通过，架构边界检查通过，TNO DPR 2 实际填色/拖动/边缘命中/撤销重做及无空白帧检查通过。现代地图 DPR 1 和 HOI4 DPR 1 的相同视觉流程也通过。现代地图另有两条启动本地化资源 HTTP 404，见下。

最终补充检查：54 项 chunk payload/promotion、导出状态动作及 dist 镜像契约测试通过；架构边界和 git diff --check 通过。原有非本轮修改的旧 Python border-owner 源码断言已在前两层记录，本次没有用放宽规则来消除它。异步客户端、bitmap 生命周期、跨场景提交及调度的有界静态审查未发现需要修复的实质问题；这不替代浏览器证据。当前 active 栅格请求不会因新场景而立即抢占，最多会完成一份过期工作，随后身份校验丢弃它。

标准 `py -3 tools/build_pages_dist.py` 构建成功，产物 921.00 MiB，包含两个新 Worker 与依赖。一次尝试显式传入 tracked dist 被构建器参数规则拒绝，未写产物；随后按既有无参数标准命令完成，不修改构建器的路径保护。

最终 `py -3 -m unittest tests.test_pages_dist_startup_shell tests.test_scenario_chunk_refresh_contracts -q` 共 101 项通过（131.4 秒）。本轮两组目标 Node 检查共 170 + 54 项通过；这些是本地所选范围的验证，不是全仓库测试、CI 或发布准入。所有独立浏览器和构建/测试进程已结束；用户预览服务器 PID 25500、端口 8000 保持运行，最后 localhost HEAD 返回 200。

实际 TNO → HOI4 → TNO 交叠切换检查通过，两次切换入口均确认后台队列 pending=1，三个场景分别实际填入品红、绿色和青色。设备/画布 DPR 1.25，窗口调整后检查物理尺寸，再恢复原缩放、平移往返，原要素仍可命中且为青色；页面及控制台错误为零。政治细节颜色与基础、边界、效果图层合成分别检查，最终像素与现有合成器期望逐像素一致。窗口调整会按既有行为 fit world，检查精确小区域前恢复缩放，不将缩小后的拾取容差误判为颜色丢失。

亚得里亚海的陆地与海盆、俄罗斯北极的非交互 shell、索马里的省份内部采样均保留正确场景归属和显示。刚果湖检查定位并修复了 HEAD 已存在的加载问题：zoom-end 将必需 water/relief detail 降到 optional，而本条加载链仅消费 required，随后空 payload 清除水域。Worker 开关两组均复现。现沿用场景已有 required semantic layers 声明，阻止它们被降级；普通可选 detail 不变。新增真实 controller 回归及同文件其余 5 项合计 6/6 通过，覆盖实际加载、state 提交和纯平移不重复政治 promotion。实际修后平移至刚果湖可命中 congo_lake，像素为 [45,71,105,255]，不再露出地形色。最终完整水域版本的独立对照已列于上文，不能用水域缺口修复前采样替代它。

本轮发现并保留两类探针证据：

1. 旧的 async waitForFunction 谓词返回 Promise，可能提前结束轮询；本轮探针先 await evaluate 导入 state，再用同步谓词。当前稳定条件同时观察后台队列。原先未就绪时开始的失败不能解释成已确认的产品重复刷新。
2. DPR 1.25、德国 [11,51]、k1.741 的拾取容差选中相邻小区域 DEG0A，中心不在该几何内，而上方像素已正确变色。Worker 开关两组均如此；不是新的异步填色丢失。内部点验收必须用几何和实际命中证明位置，而不能假设任意地理坐标对应的单像素等于选中区域颜色。此次未改变既有边缘拾取策略。

原始证据在 `.runtime/browser/interaction-worker-20260910/`：`on-*-tno_1962-dpr2-steady.json`、`off-*-tno_1962-dpr2-steady.json`、`cold-*-tno_1962-dpr1.json` 及 CPU profiles、`comparison.json`、`composition-probe.json`、`scenario-boundary-dpr125.json` 和关闭对照。构建与测试日志在 `.runtime/tests/interaction-worker-*.log`。保留中间失败用于诊断，不将其列为通过。

现代地图资源核查：`data/scenarios/modern_world/locales.startup.json` 和 `geo_aliases.startup.json` 在当前文件系统和 HEAD 均缺失。未改动的 startup_data_pipeline 已按 scene ID 拼接这些 URL；data_loader 对该请求失败返回空本地化/别名对象，该 catch 不自动重试全局完整文件。全局 `data/locales.json` 与 `data/geo_aliases.json` 存在且 HEAD 追踪。此项已有缺口没有通过 allowlist 隐藏，也没有计为无控制台错误的通过；本轮只验证现代地图颜色与交互，不宣称其全部地名资源完备。
