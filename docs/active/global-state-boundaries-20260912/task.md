# Task

## Current status

用户追加授权：将本轮架构与点位改动一起完成合并推送。整合提交3fd7478已推送，交付与远端必需检查、合并回执统一见[PR #135](https://github.com/raederhans/scenario-forge/pull/135)。最终城市组合49/49通过；EOF格式清理后6个reader来源证明通过、dist重建成功。地块对话仅交付法德隔离试点，明确未修改生产代码/data/dist且未达到完整数据修复发布标准；本次保留其.runtime候选和证据，不将其替换为生产数据。点位正式改动已包含在整合提交中。

本次continuation已完成：原计划的Palette能力边界、真实UI owner生命周期、等高线可见集职责和全局策略均已闭合。最终builder和真实checker均exit0，215 writers、610 bindings，violations/unknown/stale均0；allowlist通过。数据升级试点目录和服务未操作，未提交、推送或发布。下列旧轮验证保留为历史证据，最新结果以本节和最新验证条目为准。

- [x] 真实 scenario controls owner 的 hook 生命周期和目标测试（含旧owner释放、DOM/document解绑、异步存活检查、缺失必需handler不会先清场景）。
- [x] 等高线可见集职责迁移和缓存/失效行为测试（含collection/viewport/topology身份、partial refresh保留、topology reset释放及LOD并发）。
- [x] Palette operation 输入收窄与其他上色入口语义比较（operation仅4个状态能力；保持独立的inspector/reset/brush事务语义）。
- [x] 新增能力的路由、共享边界和完整策略检查。
- [x] 与数据试点隔离的最终整合验证及状态更新。

上轮结束状态（历史）：全局策略验收为 PARTIAL；当时57个reader/45个owner源码检查通过，定向队列36条权限签名差异。本轮已完成正式生成/验收，旧36条不再是当前未闭合队列；冻结基线保持不变。

## Checklist

- [x] 恢复上轮结果、现有 WIP 和验收范围。
- [x] 分离 static-border 借用身份与执行进度，验证陈旧执行/worker 行为。
- [x] 核对并同步有限 reader/owner 契约，包括全局整合预检发现的 Palette 装配边界。
- [x] 修复 app singleton 写入与相关 fixture/worker 边界，不放宽识别规则。
- [x] 生成并校验 state writer policy，保留冻结历史基线。
- [x] 集成 Palette/owner 定向回归、路由和 dist，完成结果记录。

## Validation evidence

本轮新增证据（2026-09-12 continuation，最新结果优先）：

- 最终正式builder64458 exit0写入215 writers；checker38799 exit0，P4.4 verdict=pass、violations=[]、610 bindings、unknown/stale均0，unregisteredConcreteKeyAuthorities=[]。caller ledger460 entries/623 proofs/809 observedEdges、missingProofs0；default state488 keys及预期一致、无collision。报告`.runtime/reports/generated/architecture-closeout-policy-check.json`。
- 八组冻结baseline与可信HEAD逐项一致；历史sourceBaseSha保持不变。最终allowlist PASS（118 policy-projected/69 observed）；标准仓库配置下git diff --check PASS。data/、map_builder/、tools/perf最终无diff或untracked。曾临时关闭autocrlf进行diff检查导致CRLF被误报为空白问题，已恢复仓库配置核对，无需改动源文件换行。

- 最近稳定窄共享组合243/243通过（17.77s），含最新storage60、effect/source负例、action successor、scanner soundness及runner reachability；全部source gate通过。曾发现的Palette重复字段authority已改为委托既有canonical模块，Palette行为15/15和边界5/5通过，随后正式生成/checker均通过。此前canonical runner6575由owner终止，不计PASS；最终验收使用真实builder/checker和共享负例，未重跑重复全仓历史扫描的长manifest。

- 最新生产冻结后整合：Palette authority调整后dist build959.65MiB、47个变更JS与dist/app镜像一致；Pages启动壳64/64（134.935s）通过。日志architecture-closeout-authority-dist-build.log、architecture-closeout-authority-pages-tests.log。此前physical浏览器1/1（26.0s case/30.7s总计）覆盖未再改变的物理图层行为。全部本轮验证进程已结束。

- 最新增量：chunk ID查询提取与标量边界27/27；city只冻结公开方法表后31/31；border+city公开借用路径独立负例28/28；normalizeScenarioId精确注入proof20/20，后续city与chunk注入proof另有目标通过证据；最新架构边界PASS，新测试路由schema534项PASS。完整policy仍未通过；最新生产源已完成上条最终dist与Pages验证。

- Palette三文件+country source border目标组合30/30通过；覆盖实时索引替换、能力缺失fail-fast、真实history及边界源码负例，source遍历顺序/缓存no-op/异常部分提交。
- root整合hook+physical六文件39/39通过；hook agent另Python runtime boundary6/6通过。
- contour agent相关physical draw/transaction reset/scenario plans43项通过。
- city lights31/31通过；显式迭代保持稀疏数组/初始长度/原引用及投影次数。
- projected bounds owner+cache actions41/41通过；方法表冻结后owner+新边界34/34通过。三项review绕过已补负例，边界最终17/17，architecture PASS。
- chunk promotion query+frame17/17、cancellation8/8、Python chunk refresh38/38通过；merge冻结输入/复用输出测试8/8通过，其策略仍需借用返回跟踪。
- capture compat+LOD+水签名24/24通过；LOD记录保存弱引用身份标记，保留旧callback捕获和null/undefined区别；viewport/resize相关33/33通过。
- 本轮 physical_layer_regression 浏览器1/1通过（case21.0s，总计25.3s，exit0）；独立8010端口/输出目录，测试服务已退出，外部法德试点服务和产物未操作。
- borrowed effect契约模块8/8通过；merge返回3个路径保留borrowed标记，coverage仅返回标量/字符串样本；调用侧scanner与完整策略整合进行中。
- projected producer最终收口：void ensureCache不返回Map，sync action保持单feature比较/set/delete，rebuild保留无条件set；owner+action42/42，更新后边界17/17、architecture PASS。selector schema最终533 routes通过。
- 最终共享目标suite122/122通过，覆盖effect/callback注入来源、返回借用路径、owner方法alias/default、Map action输入及ensure真实委托。coverage三处fresh discovery无诊断，chunk merge与合法re-publish目标通过；完整policy仍待生成/checker，局部零诊断不代替全仓验收。
- 首轮完整builder在sync action的Map.get读取诊断处exit1。精确修复后action binding无unsupported，保留set/delete两条collection-mutate；共享最终123/123通过，待稳定builder/checker。
- 本轮dist build exit0，959.65 MiB；当前工作区44个变更JS与dist镜像一致（规范化换行，包含保留的其他任务改动）；Pages启动壳64/64通过（121.780s），最终import graph60 specs及diff check通过。
- 稳定完整builder通过action binding后在caller-action ledger报6项迁移记录缺口；scheduler/Palette两项及coastline四项已只读核实新旧调用位置，正在补精确crossfile契约。无新生产改动，最终policy仍未验收。
- 六项ledger窄验已闭合：可信HEAD旧记录+7个相关源码的fresh bindings/actionedges生成6项通过，逐项删除successor edge的6个负例全部拒绝，history transition无问题；保留scheduler原4site及Palette原1site历史聚合。共享最终124/124，通过后重新完整生成/checker。
- script portfolio与selector schema通过（532 routes），60个E2E spec import graph已重建且检查通过。完整策略和最终dist验证尚待后续源码整合，不能复用下方旧轮结果宣称完成。

| Command or check | Result |
| --- | --- |
| 上轮证据 | 见既有 Palette 结果报告；不冒充本轮结果 |
| static_border_mesh_lifecycle_behavior | 27/27；冻结借用对象、5类引用替换的陈旧执行检查 |
| renderer_cache_actions + border_mesh_worker_runtime behavior | 20/20；缓存容器身份、空国家缓存、重复提交和陈旧拒绝 |
| 修改的五个 Node fixture 行为测试 | 35/35；保留 orchestration 集成与纯查询边界覆盖 |
| state_write_allowlist_behavior | 8/8；action delegation 与真实直接写的正反例 |
| check_state_write_allowlist | PASS；无新增 allowlist 路径或扫描规则例外 |
| renderer_cache_actions Python boundary | 1/1；action 保持无 import，写入域不扩展 |
| Architecture boundary / test import graph | PASS；已按本次 E2E fixture imports 重建图 |
| state_action_delegation_edges_behavior | 55/55；上轮两处 source contract 漂移已解决 |
| Script portfolio / selector schema | 上次 PASS；524 routes，后续新增内容 action 路由需更新检查 |
| Pages dist build / source mirrors | 上次 PASS；12 个涉及源码与 dist 副本一致，后续生产修改完成后需重建 |
| test_pages_dist_startup_shell | 64/64；完整目标模块通过 |
| Shared labels focused Playwright | DPR 1，1/1 PASS；labels-only 复用 contextMarkers，浏览器启动服务已清理 |
| Compat hook API + scanner soundness | 46/46；保持 target callback 语义/registry，伪导入、遮蔽、重赋值、derived target 不能获得委托权限 |
| 最终 Palette operation / panel 三个目标文件 | 24/24；固定 owner 方法、反馈顺序、异常传播与 plain target receiver |
| Sample project controllers | 20/20；state 独立参数且仍实时读取 deeplink |
| Runtime hook Python boundary | 6/6；修正既有 history uiHooks 源码断言 |
| Geometry raster / border owner | 20/20；新增2个hit身份回归修前失败、修后通过，旧结果不能发布或清掉新pending |
| Static border / worker 最终字段清理 | 30/30；移除不存在字段，保留真实mode/overlay身份维度 |
| Startup / contour publication | 37/37；显式 action 发布、启动兼容 hook、等高线请求策略 |
| Boot overlay / physical compat consumers | 12/12；保留既有启动与外观行为 |
| Scenario diagnostics copies | 13/13；三组数组浅复制、holes和双向不串写 |
| Pages final startup shell | 64/64，144.356s；证明该次 dist，不覆盖其后源码修改 |
| Renderer cache/container boundaries | 57/57；海岸线四容器身份、等值国家颜色重建与增量更新；两owner冻结返回表后20/20 |
| Border remaining writes | 30/30；9处直接赋值迁移到6个静态字段action，异常时保留原部分提交顺序 |
| Exact scheduler snapshot | 13/13；签名回调持有的相机副本不能写回全局transform |
| Shared labels final integration | DPR1 1/1 PASS，18.6s case、1.6m含启动；三标签/显隐/cache/viewport/export，服务已清理 |
| 最终 reader / owner / shared delegation | 57 reader source+discovery零问题；45 owner source inspect零问题；shared suite56/56；真实action edges保留及some回调写入/逃逸阴性 |
| 最终直接写入检查 | PASS；118 policy-projected / 69 observed，无新增allowlist |
| 最终路由 / graph / architecture / diff | PASS；526 routes，60个E2E spec依赖图；保持既有架构预算 |
| 最终 dist | build PASS，959.63 MiB；当前36个变更JS文件与dist一致（规范化换行），其中包含保留的外部城市改动 |
| Transport label identity | 15/15；三个身份字段保持undefined/null/空串/数值与字符串区别 |
| Imported transform snapshot | 22/22；复用既有纯数值clone，保留默认值和调度行为 |
| City lights private stats | 29/29；只修3处私有统计别名，冻结feature输入不变，另3条回调策略诊断保留 |
| Cache / border Python boundaries | cache8/8、border3/3；同步composition源码断言 |
| 最终 Pages启动壳 | 64/64，135.558s；对应最终dist-closeout-final构建 |

## Open risks and remaining work

本轮原计划剩余项已闭合。既有冻结权限内仍有75个production legacy-direct文件和729个legacy memberships；本次并非全仓去除legacy状态访问。完整本地策略通过不等于发布或远端CI通过。

旧轮36签名的历史证据：`.runtime/reports/generated/global-state-map-effective-remaining.json`（28）、`global-state-remaining-scope-preflight.json`（文件实际13项，扣除当时随后修复的city私有stats3、clone1、transport1，非map8）。这是旧轮定向scope合并，当前continuation正在完成这些边界，不能作为当前全仓最终snapshot或运行时缺陷数。

旧轮非map诊断对应city lights、scenario coverage、chunk promotion/merge及border topology。本轮已分别完成显式迭代、effect借用契约、query提取与source选择边界；map的owner方法、validation callback、contour请求、来源迭代和投影缓存也已逐项处理。最终是否无未解决项仍以完整builder/checker为准，禁止整factory pure、透传helper、提高预算或自证历史。

同目录任务“调查城市点位图层”已完成第二轮城市显示/名称修改。保留这些外部改动，不计作本轮实现。共享标签fixture因新碰撞规则调整为分开点位，保留三类标签及缓存断言后最终浏览器检查通过；旧失败记录保留在日志中。
