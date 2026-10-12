# Context

## Current truth

- 主目录 `C:/Users/raede/Desktop/dev/mapcreator`，分支 `codex/architecture-simplification-20261010`，基线 `abf6a1a66`。
- 上轮 20 个 import 修改及审查文档为本对话所有；尚未提交。
- 栅格对话“研究并推进三格交互整合”在独立 `political-raster-integration` 工作区执行试用入口、资产分发与缩放画质。本轮只读核对其范围，没有向该对话发送任务。
- 事件、chunk、缓存、启动合并和分段测量已完成本地实施；Root 负责工具、文档与整合，保留已有 WIP。
- 用户最新选择“先修独立模块，栅格收尾后统一验收”；没有授权向栅格对话发送消息。完整 builder/checker 暂不重跑。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-10-10 | 用户授权全部三个目标，并提示另一个对话推进栅格 | 保留 renderer 旧事件入口兼容，不改栅格实现；本轮三个目标分别验收 |
| 2026-10-10 | state writer 工具有旧 hook 实现路径特判 | 由 root 精确迁移来源识别，增加必要反例，不扩展 writer 权限或冻结预算 |

## Live process ownership

严格只读重建 session 71443 已 exit 1：7 个 action binding 的别名诊断阻止生成候选，stdout `.runtime/tmp/architecture-simplification/phase4-policy/rebuild-from-head.json` 为空，stderr 同目录 `rebuild-from-head.stderr.log`。未写回策略。默认使用工作区 policy 的首次调用被 `no exact accepted Git checkpoint` 拒绝，随后使用官方 `--previous-policy-revision HEAD` 参数读取真实 Git 历史，未用工作区自证。

第二轮 `node tools/build_state_writer_policy.mjs --phase P4.4 --previous-policy-revision HEAD`（session 83143 / PID 27628）于 21:20:53 开始、22:03:01 +08 以 exit 1 结束。stdout `rebuild-after-proofs.json` 为空，stderr `.runtime/tmp/architecture-simplification/phase4-policy/rebuild-after-proofs.stderr.log` 保留；未写 policy。7 个 action binding 和测试预算已过，后续失败为 894 条 legacy-semantic-authority-added 与 1 条 retirement-regressed，共 457 个唯一 section/signature。没有仍在运行的全仓检查。

435 个带指纹签名均在 HEAD 存在同一表达式，只证明表达式存在；22 个不带指纹的 binding/membership 不按该方式判定。严格 accepted checkpoint 为 96014184a5c761f4c4d9c7c1a4d9f38d413fd51e；不能用当前 HEAD 表达式存在或当前扫描结果补写冻结准入。诊断结构化结果为 rebuild-after-proofs-violations.json，AST 映射为 governance-sites.json。

本轮补充：7 个 action 使用已有 exact diagnostic receipt 机制，锁定完整源码、依赖、binding 与精确 sites；六个 WGI/population action 的返回值增加根 borrowed mask，调用方后续写入/escape 继续被识别。没有改这三个 action 产品文件。完整 action delegation edges 88 项通过，包括新增 3 项与原 river receipt 回归。生命周期测试文件 41 个自然同类 scalar assertion 改为本地比较、只把 boolean 交断言；40 项通过，官方局部 discovery alias 95→54 / total 97→56，其他 findings 除位置完全相同；冻结预算未变。

已清理两个冗余 strategic 跨文件证明及其 manifest 测试改动。原有 historical-caller 退役记录精确匹配 HEAD 的旧调用 proof，builder 在跨文件迁移前优先采用它，checker 亦按旧调用方退役核验。它不表示战略控件功能被删除；保留既有证明及 showUrban 迁移。

继续执行阶段仍由 root 独占长检查与运行时进程。第四批首次诊断命令：`node tools/check_state_writer_policy.mjs --phase P4.4 --json-out .runtime/tmp/architecture-simplification/phase4-policy/initial-report.json`，日志 `.runtime/tmp/architecture-simplification/phase4-policy/initial.log`。该预扫描在约 16 分钟后仍未生成报告，root 核对 PID 47700 的完整命令后停止它，session 64449 已以 -1 退出；未完成，不作为 gate 证据。停止后才恢复 3 个文件的 4 处兼容 import。

修复后正式命令：`node tools/check_state_writer_policy.mjs --phase P4.4 --json-out .runtime/tmp/architecture-simplification/phase4-policy/final-report.json`，cwd 为本工作区；日志 `.runtime/tmp/architecture-simplification/phase4-policy/final.log`。官方命令的历史 worker、扫描与缓存由该次运行统一拥有；成功或失败退出即结束，不并行另一个 policy checker/builder，不扩大超时。子代理只能读完成后的输出，不能轮询或复制运行。开始后不修改被扫描源码，直到该轮退出。

正式 checker：session 3778，Node PID 57080，2026-10-10 20:25:31 +08 开始，现已 exit 2 结束，无遗留进程。最终报告共 3,978 条诊断；58 个 capability 契约与 3 个拒绝用例均通过，hook 兼容/生命周期 15 项通过。源码恢复范围最终为 dev_workspace、interaction_funnel、scenario_rollback、history_manager、sidebar、toolbar、appearance_city_points_owner，共 8 条 import；对应 7 文件已无本分支 diff。失败的首轮 capability focused runner 证据以 runId `40ab9a3f-86be-43a9-91de-cc5bae932e20` 核验，确认进程退出后保留至 `.runtime/tmp/architecture-simplification/phase4-policy/capability-preflight-failed/`，再运行同一官方 runner，不删除或跳过失败用例。

全仓失败不是 capability 修复失败：3,475 条位于本轮未改路径或全局检查，503 条为路径分组余量，不能称本轮新增。stored 历史路径 259，HEAD-only/no-untracked 需 454，当前需 459；其中 195 条缺口已在 HEAD。本轮额外严格路径为 render_runtime_binding、intensity_field_mask_owner、scenario_recovery、state、runtime_hooks。保留严格检查，未扩请求/预算/授权或自造历史证据。第一步完整 gate 未完成；用户最新授权的整体一致性工作继续涵盖必要的历史元数据修复，产品功能和并行栅格范围不扩大。

第二步已实施：不新增接受整个 state 的城市输入 query。该方案会新增共享引用逃逸/API而没有减少 owner 的实际状态依赖。采用已有 `mergeCityLocalizationData` 收口完整本地化的城市 geo/alias 合并；UI fallback 留在 owner。实际前后官方 strict/previousWriter discovery 均 1 binding / 53 findings / 4 delegations，仅位置/偏移改变，指纹/语义不变，完整局部 policy 诊断相同。HEAD 参数98:9与policy94:9的陈旧 binding 及47条stale site在三版相同，不用稳定身份投影冒充官方PASS。startup/city 28项、Python boundary 5项通过；新增5项在改前源码也通过。

第三步已运行 `.runtime/tmp/architecture-simplification/startup-stage-profile.cjs`。真实缓存8组交替样本，原始数据及统计位于 `.runtime/reports/generated/architecture-simplification/startup-stage-{profile,summary}.json`。worker临时route仪表不修改产品文件，首尾八类集合完整JSON等价，无页面/请求错误。主要中位数：warm loader200.4ms、主线程decode57.7ms、worker decode57.0ms、worker往返1016.3ms、postMessage同步459.1ms、unpack141.9ms。没有整页计时或性能提升结论；当前worker调度和后续集合来源缓存保持原实现。

第三步独立服务 PID 60144，8009，环境 MAPCREATOR_RUNTIME_ROOT 指向 `.runtime/tmp/architecture-simplification/stage-profile-server`；测量 session 44033 已exit0，浏览器关闭。服务身份核对后停止，独立 active_server.json 已按PID/port核验后清除。无待清理浏览器或服务；第二轮 builder 亦已退出。

Root 是唯一服务、浏览器及长检查执行者。已有 `127.0.0.1:8008` 服务归其他任务；本轮未复用或停止它。本任务以下运行已结束，创建的 PID 47716 已核对身份后停止，独立服务发现记录已清除；浏览器 context 已关闭。

| Owner | Command and cwd | Port / outputs | Stop condition |
| --- | --- | --- | --- |
| root | Python `-u tools/dev_server.py --port 8009`，cwd 为本工作区 | `127.0.0.1:8009`；日志与服务记录 `.runtime/tmp/architecture-simplification/`，运行目录单独指定 | 后续两项浏览器工作结束后，只停止本次创建且核对身份的 PID |
| root | `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_apply_concurrency.spec.js --workers=1 --retries=0 --output=.runtime/tests/playwright/architecture-simplification` | `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:8009`；单例 Chromium context；沿用该目标测试 300 秒上限 | 一个定向测试完成或达到原超时；不扩大超时、不并行另一浏览器检查 |
| root | `.runtime/tmp/architecture-simplification/` 下启动缓存 benchmark 脚本 | 同端口，隔离临时 Chromium context；`.runtime/reports/generated/architecture-simplification/` | 真实 IndexedDB 填充、预热后交替测量串行基线和当前实现；完成固定样本后关闭 browser |

这些为定向运行时测试，不执行全量页面巡检。测试之外不创建用户可见标签，不触碰其他任务的浏览器或缓存。

## Handoff

保留事件 API 兼容；chunk 必须区分发布时的 currentness、回滚权限和 finally 解锁权限。不要把这三种判断统一成过严或过松的一个 predicate。`.runtime/` 存放一次性测试与测量输出。

## Next step

第一阶段三个目标和后续 13 条 schema 错误修复均完成，见报告第二/三批；第三批 policy 的14条ledger修复仍保留。最新三步的整体状态为：源码证明局部修复完成/全仓gate失败、城市合并收口完成、分段测量完成。最终计划累计73路径，无unmatched/route gap；全部改动未提交，未推送部署。

本批已独立处理 content_state 三处 baseCityLocalizationReady 写入：新增 canonical action，现场 strict findings 179→176，21 bindings 不变，新增三条调用边，其他 findings/旧 edges 除位置相同。行为 39 项通过；快照 content-state-before/after.json 和 content-boundary-check.json 在同一 phase4-policy 目录。quick-fill 工厂改为实时 query/label 注入，2 个 query 使用精确 pure-reader 证明；行为 9 项、契约 3 项通过，workspace 不再保留 legacy writer。没有放宽预算、基线或通用检查。

导出预览产品源码不变。getExportPreviewSourceKey 私有 reader 的精确证明使 scoped 4 bindings / 50 findings → 3 / 31；只移除该 helper 自身19条，其余三个inventory与before完全相同（controller30、sample1、ensure0）。controller中展开到helper的19条继续保留，不应声称整个export controller已收口。完整模块pin绑定三个常量，任何controller源修改需复核；self dependency改用实际传入source，修复读盘旧源码掩盖常量漂移的问题，外部依赖原规则保持。证据 .runtime/tmp/export_preview_{before,after,comparison}.json。

最终本批：content整合后的action-delegation89项；自模块修复后的既有reader定向22项、新契约两个文件8项；Python state/startup19项、workspace9项均通过。路由组合117pass/1fail，失败仅新增quick-fill路由精确期望，同步后该目标1pass；保留失败日志不重跑无影响项。最终delivery-plan-independent.json覆盖83路径、0 unmatched/route gap；106child-safe/89main-thread是计划，不是PASS。所有本任务测试进程结束；无运行中的builder、浏览器或服务。

22:25 +08 只读 wait_threads：栅格对话仍 inProgress，正在核对编辑后缩放的精确画面完成时间回退；cursor 6ee661a5-61fb-4cfb-b181-7cbbcb4e5548:5。未发送任何消息，未获得最终栅格版本或合并证据。

用户要求栅格收尾后统一验收。之后优先处理 spatial index Map 原位写入、color assign/remove/riverPaint 的 canonical action 迁移，以及 GPU canvas 资源和 viewport 监听的精确证明；保留对象身份、删除语义和动态路径检查。chunk runtime 的通用 runtimeState 指纹 allowed 28→29 尚未完成 binding 计数归因；不能靠 HEAD 有同指纹表达式认定它无增量。startup_data_pipeline 的 HEAD/current 完整 scoped binding、53 findings、semantic authority 已证实相同。性能下一候选仍为减少缓存拓扑跨线程复制，需连同集合复用和主线程响应性验证。
