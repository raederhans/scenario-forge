# 架构精简审查与实施（2026-10-10）

本轮结论：继续精简的主要收益在于缩小依赖和状态权限、理顺异步事务。第一批已迁移 20 个模块的辅助 import；三个授权目标已完成：事件实现独立入口、chunk 提交判断去重、启动缓存并行读取及实测。后续专项已修复原有 13 条 ledger schema 错误，464 条台账的 schema 校验为 0 错误，相关调用链和历史连续性检查通过。缓存实测未显示明显提速；完整状态策略 gate 尚未通过，另有当前源码证明与历史验证工作待收口，见第三批结果。

基线为 `abf6a1a6670096459138fcc84cb12fa4ca485f5b`；工作分支为 `codex/architecture-simplification-20261010`。本记录对应本地源码与验证，不代表 PR、CI 或部署结果。

## 审查基线

对 `js/` 内 JavaScript 使用 Acorn 解析 import、re-export 和字面量动态 import；统计不包括 `apps/hgo`、工具、测试、vendor、dist。

| 指标 | 本轮修改前 |
| --- | ---: |
| JavaScript 文件 | 531 |
| 源码行数，包含空行、注释和生成资产 | 181,767 |
| 指向 `state.js` 的 import 语句 | 61 |
| 直接导入 `state.js` 的模块，按文件去重 | 59 |
| 其中实际导入 `state` 单例的模块 | 41 |
| `state` 初始化后的可枚举顶层字段 | 483 |
| `map_renderer.js` 行数 / 直接模块引用 | 15,968 / 186 |
| `scenario/chunk_runtime.js` 行数 | 3,551 |

静态图和加入字面量动态 import 的图均未发现多模块强连通分量。这个结论不覆盖变量驱动的动态加载：`deferred_ui_bootstrap.js` 和 `data_service.js` 仍有运行时解析入口，也不代表事件回调没有运行时耦合。没有把未被 `js/main.js` 字面量图访问的模块判为死代码；延迟 UI、worker 和资产注册表都需要另行核实。

行数也不能直接当作重构优先级。`city_lights_modern_asset.js` 的 8,128 行包含生成的亮度网格数据；renderer 的部分长组装段已经将绘制职责交给既有 owner。已检查的 `render()`、`drawCanvas()` 和政治层 orchestration 路径，没有发现足以支持继续拆层的重复实现。

## 第一批：辅助模块直接依赖其领域实现

`state.js` 同时承担单例初始化和兼容导出。20 个模块通过它导入的 63 个命名绑定，实际来自以下现有实现：

- `js/core/state_defaults.js` 和 `js/core/state_catalog.js`；
- `js/core/intensity_field.js`；
- `js/core/state/intensity_field_state.js`、`appearance_preset_state.js`、`ui_state.js`。

本轮将上述 import 改到实际提供者，并合并 `file_manager.js` 重复指向 `ui_state.js` 的 import。18 个模块完全移除对该入口的直接依赖；`scenario_resources.js` 与 `scenario_rollback.js` 仍保留业务需要的单例 import，只迁移单独的辅助函数 import。涉及项目文件处理、两个 renderer 策略/遮罩模块、场景资源与回滚，以及 appearance、transport、诊断 UI 的辅助模块。没有新增模块、第三方依赖或状态存储；原有公开 re-export 保持可用。

| 依赖指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 指向 `state.js` 的 import 语句 | 61 | 41 |
| 直接导入 `state.js` 的模块，按文件去重 | 59 | 41 |
| 强度遮罩的静态 JS 依赖闭包 | 76 | 3 |
| 渲染 pass 签名策略的静态 JS 依赖闭包 | 84 | 35 |
| 参考图 owner 的静态 JS 依赖闭包 | 77 | 27 |
| Transport workbench state owner 的静态 JS 依赖闭包 | 80 | 11 |

闭包包含模块自身，仅计本地静态 JavaScript 引用；四个示例修改后都不再包含 `state.js`。这里证明的是隔离导入时的依赖范围缩小，不是整页下载、启动耗时、堆内存或帧率提升。应用入口仍然需要初始化全局状态。

验证依据：逐个核对迁移绑定与旧 facade 导出的对象/函数严格相等；对 20 个源码文件比较排除 import 后的 AST，确认其他语句不变。该批修改没有压缩函数体或改变绘制、编辑、撤销重做、保存格式、场景数据与异步控制逻辑。

## 第二批：三个授权目标的结果

### 事件实现入口

新增 `js/core/state/runtime_hooks.js`，承接原 `state/index.js` 的实现与唯一注册表，只依赖 `config.js` 和 `bus.js`。旧 `index.js` 保留领域 re-export，并转发同一组 hook 函数。32 个直接 import 调用方转到新入口；`scenario_ui_sync.js` 的 catalog 函数改从实际提供者读取。旧入口、新入口及 `state.js` 的导出身份、注册/释放、通知、必需命令和返回值语义保持一致。

新入口的静态依赖闭包为 **3 个 JS、0 个 JSON**；原入口迁移前为 **52 个 JS、4 个 JSON**。旧兼容入口仍保留领域依赖，没有声称整个应用已不再加载这些模块。另一个对话正在独立工作区推进栅格，本分支 `map_renderer.js` 继续使用可用的旧事件入口，没有修改它或栅格实现、资产、地理数据。

工具层同时识别新实现和旧兼容路径；新路径进入旧路径的全部 15 个验证目录记录。第二批的 `state_writer_policy.json` 改动只迁移对应 writer 的 11 项 bindings 及其源码位置：授权面、fingerprint、成员权限、其他 writer、历史 baseline 和预算均保持一致。局部 snapshot 为 0 violations。当时完整 schema 在迁移前后均存在相同的 13 条 `caller-action-ledger-entry-invalid`，涉及 renderer、scenario rollback 和 appearance 的历史记录；后续专项修复见第三批。

### Chunk 提交边界

`applyPendingScenarioChunkPromotion` 中 5 处重复的发布判断收敛为局部 `isPromotionCurrent()`，5 处重复的执行身份判断收敛为 `ownsPromotionRun()`。每次调用仍读取当时的状态与 controller run ID；没有缓存判断结果。回滚判断保持独立，保留原有对象身份、generation、场景和捕获时 request ID 条件。所有 await、状态写入顺序、catch 与 finally 的职责保持原样。

| 阶段 | 状态和副作用 | 继续执行的条件 |
| --- | --- | --- |
| 开始 | 确认 pending 身份，捕获 infra/root/continuation 快照与原渲染锁 | 发布判断检查当前场景、请求、selection、pending 与 run 身份 |
| Infra | 持有渲染锁，应用 merged layer/localization payload，然后让出一帧 | 重新检查发布身份；过期时分别判断能否回滚、能否更新自己的状态 |
| Visual | 应用 political payload，仍持锁让出一帧 | 再次检查发布身份；回滚必须仍拥有快照对应的状态 |
| 发布 | optional visible refresh 后再检查；恢复原锁，按原参数安排 render；render 后再次检查 | 发布判断和执行所有权均有效才继续 metrics/ready/pending 清理 |
| 异常/收尾 | 按原条件恢复快照、重新抛出异常；finally 恢复渲染锁 | 回滚权限与 finally 的执行所有权分别判断 |

回归测试直接执行生产代码中的局部判断与提交片段，使用真实纯查询和 continuation snapshot。覆盖新 selection、更新的排队场景、pending 替换、generation 变化、controller run 替换、三个让帧点的 loadState 替换及 legacy run 0。已过期的发布仍可能允许本执行回滚或释放自己的锁；这些语义没有合并成一个条件。额外将两个新 helper 展开，对整个 chunk 文件的非 import AST 与 HEAD 深度比较，结果一致。

借用回调与 factory 的源码身份契约同步了 18 个指纹值，覆盖 chunk、scenario resources、state 和 data loader 的当前源码。移除指纹值后，契约文本逐字不变；所有能力、方法、callback 名单和拒绝规则保留。

### 启动缓存与性能证据

`loadStartupBootArtifacts()` 在生成两个独立 key 后立即发起两次只读缓存请求，每条链保留自己的命中/缺失/错误处理，再共同等待后进入 worker 或网络回退。没有增加请求数量、重试或第三方依赖。受控完成顺序测试覆盖并发启动、反向完成、单路失败、miss、不读禁用缓存、scenario-scoped 本地化及 warm-cache worker 解码和失败回退。

真实 Chromium/IndexedDB 使用本仓库 topology/localization 数据，序列化 payload 合计 35,922,164 bytes。基线 loader 从 HEAD 仅在测量页面的专用模块 URL 提供；工作区文件不做回退。两版共享同一预热数据库，交替执行 16 组，共 32 次读取，计时期间关闭 worker，以隔离缓存读取阶段。

| 缓存命中调用耗时 | 串行基线 | 并行实现 |
| --- | ---: | ---: |
| 中位数 | 256.1 ms | 255.5 ms |
| P95（各 16 个样本） | 327.0 ms | 384.3 ms |

中位数差约 0.6 ms（0.23%），尾部波动更大，**没有足够证据宣称性能提升**。真实请求 trace 证明两路 get 在第一路完成前均已发起；读取 payload 完全相同。额外一次启用真实 worker 的 warm-cache 调用确认仍解码成功。该实验没有测整页冷启动、渲染帧率或与栅格分支合并后的性能，不能据此推算这些指标。

### 第二批验证

- Chunk promotion/query/transaction ownership：3 个 Node 文件，34 cases 通过。
- Chunk cancellation/helpers、scenario atomicity/lifecycle、startup pipeline/hydration/overlay：7 个 Node 文件，132 cases 通过。
- Hook 兼容与生命周期：15 cases 通过；缓存受控 fixture：1 case 内的多种情形通过；scanner 新旧入口及权限分类：5 个定向 cases 通过。
- State action delegation/source boundary 测试通过；borrowed-effect 契约同步指纹后 77 cases 全部通过，包含篡改源码、伪造权限、额外 callback 和非法写入的拒绝用例。
- Python hook/state split 边界：21 项通过；chunk refresh：38 项通过；toolbar split：修正历史 import 路径断言后 54 项通过。
- 真实浏览器 `scenario_apply_concurrency.spec.js`：1 项通过，82.8 秒，覆盖同目标复用、不同目标最新请求接管、中间请求失效以及错误监测。
- 架构边界检查通过；Pages source graph 检查 545 个 JS，无未解析引用；验证路由 schema 的 736 条路由通过；测试 import graph 的 74 个 specs 通过；verification metadata/portfolio 两个目标测试文件通过。
- `npm run pr:plan` 已执行：本地 75 个变更路径（包含首批修改），无 unmatched path 或 route gap；`git diff --check` 通过。计划本身不代表选中的全部检查或 CI 已通过。

测量原始结果位于 `.runtime/reports/generated/architecture-simplification/startup-cache-benchmark.json`；浏览器计时位于同目录 `e2e-timing.ndjson`；授权迁移对照位于 `.runtime/reports/generated/runtime-hooks-policy-migration-summary.json`。本次浏览器 context 和 PID 47716 的端口 8009 服务已关闭，未操作另一个任务的端口 8008 服务。

本轮完成的是本地实现与范围内验证。尚未与栅格分支联合验证，未执行完整 dist 构建、全仓历史策略重建或 CI，未提交、推送、合并或部署。

## 第三批：修复 13 条状态策略错误

本次仅修改策略契约、台账生成/历史核对工具、policy JSON、回归测试和文档，没有新增产品源码改动，也没有触碰另一个对话的栅格工作区。

| 原错误 | 已验证的根因 | 修复 |
| --- | --- | --- |
| hover 2 条 | 河流编辑增加了 `riverCellId`，使中转函数和调用表达式源码改变；旧台账仍保留此前 successor 身份和调用契约 | 按现有 cross-file migration 机制同步精确调用指纹及台账。共用此调用的 `hoveredId` 同时修复，因此这里涉及 3 条记录 |
| rollback 10 条 | `restoreScenarioPresentationStateFromValidated` 改为调用 `normalizePaintMode` 后，carrier 契约已更新，而 P4.2a 台账在 P4.4 同阶段重建时保持冻结 | 增加一组有历史源码依据的 carrier 指纹迁移凭据；重建完整旧契约身份，核对当前契约及完整 successor descriptors，只更新身份字段 |
| `showUrban` 1 条 | 匿名回调的序号从 4 移至 6，已有迁移契约未落账 | 使用既有 builder adoption；保留序号 4 的退役 mutation 证据，绑定序号 6 的实际调用 |

hover 源码变更来自 `2562e5064`，相关旧源码在其父提交；rollback 变更来自 `16f0eaf3c`，旧 helper 源码在 `8d72cb86d736cae872a2f78d2fc36117389aa67e`。后续 `9c1d46710` 与 `b5411546e` 更新了契约指纹，但没有完整同步旧台账。12 条旧 successor 身份均可仅替换对应 carrier 指纹、保留其余完整契约字段精确重算得到。

不是普遍忽略变化的 hash：只有登记的旧/新 carrier 对、同一 action/membership、完整旧契约身份和相同 relay descriptors 全部匹配，生成器才接受身份迁移；否则明确返回 `caller-action-successor-contract-refresh-unproven`。历史核对只归一化这一已证明的身份变化，仍比较退役字段、phase、调用链和早期源码坐标。schema、snapshot 的拒绝条件与权限规则没有放宽。

本次 policy 语义差异恰好为 14 条台账记录：10 条 rollback 仅改变 `successorProofContractIdentity`，3 条 hover 和 1 条 urban 采用既有迁移。464 条台账总数不变；所有 writer、grant、retired memberships、baselines、checkpoints、预算及其他 policy 字段均与本次修复前相同。

实际验证：

- `node --test --test-reporter=spec tests/state_writer_policy_soundness_behavior.test.mjs`：24 项通过。补充拒绝断言后单独重跑对应用例通过，覆盖未知旧/新身份、修改链路或 source fingerprint、空 successor、缺失 edge、撤销 terminal grant、改写退役历史及早期 observation。
- 通过官方 runner 定向执行 manifest 的 `same-phase policy rebuild` 和 `P4.4 successor proof contract exactly matches every live relay edge`：4 项通过，包含早期 phase 仍冻结的原有测试。
- 9 个相关源码文件的真实 action discovery、action module 源码契约、14 条 ledger observation，以及整个台账 history transition 均无对应 violation；完整 schema 为 0 错误。
- `npm run pr:plan -- --json` 只读计划覆盖当前累计 78 个改动路径，unmatched/route gap 均为 0；这不是 CI 或全部计划检查通过的证明。`git diff --check` 通过。

局部重建的差异与检查结果保存在 `.runtime/tmp/architecture-simplification/state-policy-ledger/repair-report.json`。该目录另保留修复前 policy 和候选，用于说明更新范围；没有以当前 policy 为自己生成历史 baseline 证明。

扩展 transition 诊断还发现 **5 项 capability source proof 失配**：`dev_workspace.js` 的入口证明 1 项、`interaction_funnel.js` 和 `scenario_rollback.js` 各 2 项。它们来自前两批 import 调整，已核对这三个文件的非 import AST 与 HEAD 相同；但现行证明绑定完整源码，仍应报错，本次没有豁免。直接调用该 transition API 时另返回 `derived-alias-taint-baseline-source-proof-missing`，原因是未向它提供重算的历史证明；未执行完整历史重建，不能据此断言 baseline 本身错误或 gate 通过。

## 第四批：当前源码证明收口

先前局部 transition 诊断的 5 项失配不是全部能力契约的失败面。对完整 capability contract 运行定向正反测试，又发现 history_manager、sidebar、toolbar、appearance_city_points_owner 中 18 项同类源码失配。7 个文件均只有本对话引入的 import 路径变化，HEAD 全文件 LF 指纹与现有精确证明逐一吻合。

最终恢复这 7 个文件中的 8 条旧 import，未修改 contract pin、capability identity、台账、writer grant、冻结 baseline 或预算。旧 facade 继续转发同一套 hook 注册表，因此功能行为不变。前批轻量 hook 入口保留，当前实际迁移调用方由 32 个减为 26 个；helper import 清理由 20 文件减为 18 文件。appearance_city_points_owner 的隔离导入收益本次暂缓，以避免为一次 helper import 迁移新增 capability 历史刷新机制。

实际验证：hook 兼容/生命周期 15 项通过；官方 runner 的完整 capability 正向验证覆盖 58 个精确退役契约，另 3 个拒绝测试全部通过。首次失败证据已保留。修复前全仓预扫描在约 16 分钟后仍未生成报告，已由进程所有者停止，不能作为完成的验证。

修复后官方完整 checker 已运行结束，**exit 2 / fail，共 3,978 条诊断**。报告为 `.runtime/tmp/architecture-simplification/phase4-policy/final-report.json`。本次没有修改其判定、重建冻结基线或提高诊断预算。诊断数量包括同一陈旧 binding 派生的多条 stale key/site，不等于 3,978 个独立功能缺陷。

- 3,475 条位于本轮未修改的路径或全局检查；剩余 503 条只是路径分组余量，不能称为本轮新增。
- 历史 worker 请求依据 stored baseline 的 259 条路径，而当前严格扫描需要 459 条。用 HEAD-only、排除 untracked 的元数据重放仍需 454 条，说明 200 条缺口中 195 条已在提交历史；其余 5 条因本轮路径变化进入严格范围。保留请求身份与 stored proof 的精确核对，不能直接扩大 worker 请求后忽略旧证明差异。
- `clearClickHoveredIdState` 自 `2562e5064` 已清理 `hoveredRiverCellId`，但 HEAD policy 仍只登记 `hoveredId`。这是既有 action 授权记录遗漏，应保留当前功能并核实相应领域授权。
- 城市点 owner 的两项战略资源控件已迁到 `strategic_values_owner.js`，旧 caller 的委派记录未跟进；`scenario_tag_creator_controller.js` 已在 `b5411546e` 删除，policy 仍保留 active binding。应按真实迁移/退役历史修复元数据，不能恢复已删除功能来迎合旧记录。

因此第一步的**完整状态策略一致性尚未完成**。局部启动整理与测量可独立验证；后两项通过不解除此 gate。随后继续用真实 Git 历史补精确迁移与 action 证明，详情见第七批；不改变栅格实现或冻结预算。

## 第五批：城市本地化合并收口

`startup_data_pipeline.js` 原先重新组合城市 geo 与 alias patch；现在复用 `data_loader.js` 已有的 `mergeCityLocalizationData`。没有新增 state query、模块或依赖，也没有改变 receiver、promise、提交 action、场景同步及 UI 通知顺序。UI fallback 留在 owner，城市与 alias 数据在请求完成时读取，避免预先取快照后覆盖新场景。

收益是城市本地化合并规则只有一个实现入口，不是减少整个 owner 所有 state 字段的读取权限。未采纳整 state 的新 query 包装：它没有减少实际依赖，反而会新增共享引用及证明负担。

验证结果：

- `node --test tests/startup_data_pipeline_lifecycle_behavior.test.mjs tests/city_support_loading_behavior.test.mjs`：28 项通过。新增 5 项覆盖加载期间城市/别名/场景变化、共享请求、覆盖顺序、输入不变、无场景发布、缺失/非对象/数组字典的既有语义。
- 新增 5 项在保存的改前源码上亦通过，证明本次测试锁定原有行为。
- `python -B -m unittest discover -s tests -p test_main_startup_data_pipeline_boundary_contract.py`：5 项通过。
- 使用官方实际 strict 模式、previousWriter 和 exact-site signature 对比前后：均为 1 binding、53 findings、4 action edges；完整结果仅源码位置/偏移改变，调用指纹不变。前后局部 policy 诊断完全一致，没有新增权限、diagnostic 或缺失证明。
- 此文件 HEAD 的参数位置已为 98:9，policy 仍是 94:9；同一 unknown/stale binding pair 与 47 条 stale site 在 HEAD、改前和当前均相同。不能用忽略 locator 的辅助投影冒充正式通过。

## 第六批：真实启动阶段测量

使用独立的 localhost:8009 服务和隔离 Chromium context，真实 JSON 填充 IndexedDB 后，按主线程/worker 交替顺序测量 8 组；worker 首次创建另记。临时响应仪表只增加 decode 计时，不修改 worker 产品源码。完整缓存 payload 与原 JSON 相同；首尾样本八类解码集合的完整 JSON 各约 6,802 万字符，内容一致。没有页面异常、HTTP 失败或请求失败。

| 测量区间 | 中位数（ms） | 样本 P95（ms） |
| --- | ---: | ---: |
| warm cache loader 总耗时 | 200.4 | 230.5 |
| topology IDB get 请求区间 | 56.6 | 78.8 |
| localization IDB get 请求区间 | 5.5 | 155.3 |
| 主线程解码 action | 57.7 | 65.1 |
| worker 内实际解码 | 57.0 | 64.6 |
| worker 往返总耗时 | 1,016.3 | 1,200.5 |
| 主线程 postMessage 同步调用 | 459.1 | 514.5 |
| worker 结果 geometry packing | 61.6 | 69.9 |
| 主线程 geometry unpacking | 141.9 | 220.5 |

首次 worker 调用往返 1,092.9 ms，解码 81.0 ms；后续复用同一个 worker。8 个样本的 P95 是样本最大值，只作本机定位。IDB get 回调不覆盖全部对象物化成本；postMessage 同步调用不等于精确传输时间；worker 往返包含解码/打包/消息处理等阶段，不能将表内时间全部相加。未测整页冷启动、绘制、交互帧率或低性能设备。

证据支持优先研究减少缓存拓扑跨线程复制，而非继续微调解码函数。暂未切回主线程：这会改变调度和 startup collection 缓存来源，需要连同后续 context layer 复用、取消/错误、场景组合及主线程长任务一起验证。本轮不据分段计时宣称整页性能提升，也不新增 worker API、缓存或传输实现。

原始数据：`.runtime/reports/generated/architecture-simplification/startup-stage-profile.json`；统计摘要：同目录 `startup-stage-summary.json`。浏览器 context 已关闭；核对身份后停止本次服务 PID 60144 并清理其独立服务发现记录。

最终 `npm run pr:plan -- --json` 覆盖累计 73 路径，unmatched/route gap 为 0；`git diff --check` 通过。计划不代表所有建议测试或 CI 已执行。

## 第七批：严格策略重建前置修复

使用官方 `build_state_writer_policy.mjs --phase P4.4 --previous-policy-revision HEAD` 从真实 Git 策略重建候选，不刷新 baseline，不使用本轮未提交 policy 自证历史。首轮完整重建在 action binding 验证被拒绝，7 个函数共有 12 个保守别名诊断，未产出候选；失败日志保留在 `.runtime/tmp/architecture-simplification/phase4-policy/rebuild-from-head.stderr.log`。

WGI 与人口的 runtime setter 返回已发布状态对象，reset 透传同一对象，style setter 返回已发布的 style。原有行为测试要求保持引用身份；本轮保留产品源码，复用已有 exact action diagnostic receipt 机制，逐项锁定完整源码、依赖、binding、AST 表达式与精确诊断集合。六个动作同时补上根 borrowed-result 路径，调用方通过返回对象的写入、深层写入和泄漏继续被识别。等高线 action 的两处借用由 action 和修订记录器的完整源码共同证明；记录器仅写私有 WeakMap 元数据，不被错误登记成 pure reader。新增/替换 sites、source/import/依赖漂移、伪造 binding、alias/dynamic/ambiguous 增量仍会失败。

战略控件从 `appearance_city_points_owner.js` 到 `strategic_values_owner.js` 的历史另已核实：现有 historical-caller 退役证明覆盖旧调用方，生成器会优先采用它，不表示控件功能被删除。补充的两条跨文件契约及其独立测试改动经核对属于冗余，已撤去；保留原有证明与 showUrban 迁移。

冻结测试预算的超额也属于已有历史。本轮原改动测试不在该组 45 个登记测试内。对 `scenario_lifecycle_runtime_behavior.test.mjs` 中完整同类的 41 个标量断言，在本地做严格等价比较，只将布尔结果传给断言函数；深比较、容器身份、null、0 和 NaN 断言保持。官方局部 discovery 的 alias 95→54、total 97→56；binding 与其余 findings（除位置）完全相同。没有调整预算、白名单、扫描器命名识别或断言判定条件。

验证：完整 `state_action_delegation_edges_behavior.test.mjs` 88 项通过；生命周期测试 40 项通过。7 个 action 的原诊断仍保留于 findings，由精确证明处理，未从扫描结果删除。

第二轮官方只读重建于 22:03:01 +08 以 exit 1 结束，未写回 policy，stdout 为空。它通过上述 action binding 与测试预算关卡，随后被语义权限治理拒绝：894 条 `legacy-semantic-authority-added`、1 条 `legacy-semantic-retirement-regressed`，按 section/signature 去重为 457 项。435 个带表达式指纹的签名在 HEAD 均有对应表达式，但这只能证明表达式存在，不能据此证明 binding 或计数没有增长。22 个不带表达式指纹的 binding/membership 签名需按实际接收对象另行核对。

历史来源进一步确认：`--previous-policy-revision HEAD` 读取已提交 policy 后，解析到的 accepted checkpoint 是 `96014184a5c761f4c4d9c7c1a4d9f38d413fd51e`，不是当前 HEAD。已登记严格路径不能用当前扫描结果补进冻结基线或过渡准入。必须通过实际调用边、精确源码证明或 canonical action 迁移解决，不能仅将既有表达式登记为 legacy 权限。原始失败日志、诊断及源码映射保留于 `.runtime/tmp/architecture-simplification/phase4-policy/`。

## 第八批：先修独立模块，栅格收尾后统一验收

用户明确选择先完成独立模块，renderer／栅格部分等待另一对话收尾。本批不再启动完整 builder/checker，不修改栅格工作区，也不向另一对话发送协调任务。

- 启动内容：`baseCityLocalizationReady` 的三处直接赋值迁入 `content_load_actions.js` 的一个 canonical action，仍在原位置写入原布尔值。启动、城市资源与 bootstrap 共 39 项行为测试通过。官方 strict 定向 discovery 的 21 个 bindings 不变，findings 从 179 到 176；恰好移除三处该字段直接赋值，新增三条 action 调用边，其余 findings 与既有调用边除位置字段完全一致。action 自身的赋值权限保持可见，未给调用方新增 legacy grant。
- Quick fill：DOM 工厂改为接收实时 `getModel` / `getSelectLabel` 回调，不再持有整个 state。只为两个现有只读 query 登记精确 source/dependency/site 证明，未把 DOM 工厂登记为 pure reader。9 项行为测试、3 项严格契约测试通过；workspace 目标扫描 findings 为 0，`shouldRetainScannedWriterCandidate=false`，已退役 writer 不会因此重新登记。新增状态写入、Map 写入、live reference 返回与依赖漂移的反例均拒绝。
- 导出预览：产品源码不变，精确证明 `getExportPreviewSourceKey` 只返回字符串或 null。定向扫描从 4 bindings / 50 findings 到 3 / 31，只移除该函数自身的 19 条，其余三个 inventory 的 findings/action edges 与改前完全相同。controller 仍有 30 条（包括本地调用展开到该 reader 的 19 条），sample reader 仍有 1 条，未通过修改遍历或过滤规则抹去。常量依赖用当前模块完整源码 pin 绑定，因此后续 controller 修改需要复核此证明。

登记导出证明前复现并修复了检查器的实际漏检：自模块 dependency 原先再次读取磁盘，导致传入的修改版源码中常量变化可能借用磁盘旧源码通过。现在自模块直接核对传入 source，外部依赖仍用 readSource，LF 归一化保持。常量漂移、source/helper 漂移、写入、未知调用、live return 均有拒绝用例；未放宽现有检查。

本批最终验证：启动/城市/bootstrap 39 项、quick-fill/hierarchy 9 项、workspace controller 9 项、Python state/startup 边界 19 项通过；content action 整合后完整 action-delegation 文件 89 项通过。随后 checker 自模块修复完成，受影响的既有 reader/export 契约 22 项和两个新增契约文件 8 项再次通过。路由 metadata/portfolio 组合初跑 117 项通过、1 项因新增 quick-fill 路由的精确期望未同步失败；同步该期望后，仅重跑受影响目标，1 项通过，其余 117 项未重复运行。失败日志仍保留。

最终 `npm run pr:plan -- --json` 覆盖累计 83 个工作区路径，unmatched/route gap 为 0；所列 106 个 child-safe 和 89 个主线程命令是计划，不是已执行结果。`git diff --check` 通过。22:25 的只读状态确认栅格对话仍在排查编辑后缩放耗时回退；尚无最终整合版本。

完整 gate 仍未通过；这批局部证据不能替代栅格最终版本上的统一验收。

## 下一阶段执行方向

1. **先完成独立模块，再处理栅格交叉项。** 空间索引四个 Map 的原位更新需要精确 action 边界；色彩写入需同时覆盖 assign/remove 与 riverPaint，必须结合 sidebar 和 renderer 调用方。GPU canvas 的 width/height 是资源状态，viewport 还涉及事件监听生命周期；应分别提供精确资源/调用证明，不能全局排除同名字段。等待栅格最终 diff 确定后再处理这些共享边界。
2. **统一收口严格策略和行为验证。** 采用真实 accepted checkpoint、冻结基线与原预算生成候选，核对退役记录、动态写入和调用方借用，再运行完整 checker 及对应交互回归。完整 checker 实际归零才算完成第一步。城市合并和 readiness action 已有局部证据；后续启动整理继续保持实时读取、共享 promise、取消和提交归属。
3. **性能优先验证缓存拓扑的跨线程复制方案。** 用相同真实缓存对照“当前 worker 往返”与候选数据传递路径，覆盖首次/重复加载、缓存 miss/错误、输出等价、后续集合复用及主线程长任务。保留现有 worker 默认行为，直到全路径收益和行为等价性均有证据；暂不更换框架或引入第三方模块。

栅格实现继续由另一对话负责；其工作完成后，再按最终两边 diff 安排联合验证。当前没有提交、推送、合并或部署。

## 审查时的候选（1–3 已完成，4 保留为后续候选）

| 顺序 | 具体工作与源码证据 | 实施边界与验收 |
| --- | --- | --- |
| 1 | 整理事件接口的依赖。`js/core/state/index.js:9` 起将 bus/config 与 defaults/catalog/boot/content/color/UI 一起 re-export；33 个直接 import 调用方大多只需要 hooks/events。 | 先清点所有导出消费者，包括测试、动态导入和调试入口，再决定如何缩小事件入口。保留必需命令、可选通知、注册/释放及返回值语义；避免新增平行事件系统或纯转发层。用 runtime-hook 与生命周期测试验收。 |
| 2 | 为 chunk runtime 建立明确的事务边界。`chunk_runtime.js:584` 的 continuation 判断、`:1397` 的 promotion 提交、`:2481` 的 active refresh 共同协调请求身份、加载代际、选择版本、绘制锁和回滚。 | 先列明每个阶段读写什么、在哪些 await 之后重新校验身份，再消除已证明重复的判断或状态。旧请求不得覆盖新场景，异常须恢复原状态，详细导出仍须等待正确几何；使用现有 promotion、atomicity、lifecycle 测试及聚焦浏览器并发切换检查。尚未断言这些 guard 冗余。 |
| 3 | 验证启动缓存读取的并行收益。基线 `data_loader.js:1382` 和 `:1397` 顺序读取 topology 与 localization；key 在读取前已独立生成，`startup_cache.js:424` 为各次读取创建 readonly transaction。 | 第二批已完成受控 fixture、真实缓存测量和 warm-cache worker 验证；保留独立错误和失败恢复。实测未显示明显提速。 |
| 4 | 按领域逐步收窄全局状态输入。`state.js:69` 仍组装 483 个可枚举字段，41 个模块直接导入单例。 | 每批选择一个领域，优先已有只读查询和 action；保留状态对象身份、历史事务及 import/export 契约。用实际减少的全局读写能力和依赖边作为指标，避免为每个属性新增包装函数。 |

另有一处低优先级重复：`data_loader.js:1307` 与 `state/boot_state.js:16` 分别定义 startup cache 默认 shape，前者还支持 `enabled` 参数。可在后续启动域整理时合并，但不能仅为删几行默认值而扩大 loader 的状态依赖。

现有证据足以支持上述渐进路线，尚不足以支持整体更换状态或渲染框架。引入第三方模块前，应先找到明确替换对象，并验证 bundle/worker 兼容性、许可、维护成本和实际性能；“更新的架构”本身不作为验收指标。

## 首批验证与边界

- 21 个目标 Node 测试文件通过，覆盖 appearance、transport、遮罩、渲染签名、诊断、项目往返、场景缓存/可选层/原子性/生命周期；随后 2 个状态借用/动作源码边界测试文件通过。
- Python `test_state_split_boundary_contract`、`test_scenario_renderer_bridge_boundary_contract` 共 19 项通过。
- `npm run verify:architecture-boundaries` 通过。
- `npm run verify:pages-source-graph` 通过；544 个部署候选 JavaScript 文件的源码引用检查无未解析引用。该口径还包含 `js/` 之外的部署入口，与上面的 531 文件统计不同。
- `git diff --check` 通过。`npm run pr:plan` 已执行；最终工作区计划覆盖 20 个源码文件及本记录，无 unmatched path 或 route gap。计划只描述预期检查，未将 deferred 项算作通过。

首批只做 import 身份、非 import AST 和相关测试验证；第二批追加的浏览器、性能及工具链验证见上文。需要进入发布流程时，仍应按最终提交范围完成 required checks。
