# 交接上下文

- 2026-09-07：从用户指定 Edge 标签页读取原计划全文。仓库 origin 为 raederhans/scenario-forge。
- 主工作区起始 HEAD：09df7b84fef838522bce5111af8054f68c2762f9；原有未归属修改为 .codex/config.toml，必须保留。
- 原计划历史 Nightly 基于 e8263b7c：P4 策略 45 分钟超时且存在断言失败；heavy 第 9 项 tests.test_global_transport_builder_contracts 失败，后 6 项未运行。当前是否修复待实际复核。
- 原计划提及 10+3 个保留绑定登记缺口；当前 HEAD 更晚，需重新盘点，不可直接照抄数量。
- Live owner：A 独占本批浏览器、dev server、构建；B 独占完整策略 producer/check。具体命令、cwd、端口、缓存、日志、停止条件由 owner 在启动前记录至各自 .runtime/reports/generated/ 下交接文档。禁止重复安装或复制运行同一测试。
- 当前子代理 m1_local_routes 只读定位，不执行测试和写入。

## 子代理交接（静态确认，未执行）

- UI：`npm run -s verify:edit -- --changed-file js/ui/sidebar/scenario_inspector_controller.js`，预期 `tests/scenario_inspector_controller_behavior.test.mjs`。
- Renderer：`npm run -s verify:edit -- --changed-file js/core/renderer/border_mesh_owner.js`，预期 `tests/border_mesh_owner_behavior.test.mjs`。
- Action：`npm run -s verify:edit -- --changed-file js/core/state/actions/appearance_actions.js`，预期 `tests/appearance_actions_behavior.test.mjs`。
- 三类直接 sourceRefs 均已登记在 tools/verification/catalog/records/local_feedback.mjs；仍需 A 实测选择与运行。
- Transport 单项：`python -m unittest tests.test_global_transport_builder_contracts -q`；canonical record 在 tools/verification/catalog/records/ui_workbench.mjs，heavy/main-thread，资源锁 .runtime-output 和 heavy-geo。只能由 A 串行执行。
- run_adaptive_tests.mjs 已记录命令 durationMs；A 另外测 npm 总 wall time，区分 selector、命令耗时与 deferred 项。历史后 6 项仍需 A 从原 Nightly 命令清单核对，不能拿当前路由集合冒充历史顺序。
- 对话 A 创建请求：client-new-thread:a0dc80a6-271b-437f-93ad-506aa5eab698。
- 对话 B 创建请求：client-new-thread:1c8f9551-de92-462f-b914-d8011b6af3e9。

## A 启动回报

- 正式对话 ID：01a07c54-0149-7013-a7cb-43fdedd22379；worktree 39fa，HEAD 09df7b84，初始干净。
- A 报告 localhost:8007 server 已启动，Golden Demo 正执行；主协调不轮询或复制该进程。
- A 报告 transport 单项 63 测试中 2 失败：showRail/showRoad 仍断言旧 map_renderer.js，实际 owner 已迁移；已交接在测试文件范围内修复并聚焦复验，尚未获得修复后结果。
- 三类 verify:edit 命令已通过 send_message_to_thread 发送给 A。

### A 后续进度（执行 owner 回报）

- Golden Demo localhost PASS，57.3s，覆盖 TNO PNG 与样本切换；尚不代表完整编辑/保存回载链通过。
- 已按 git show e8263b7c:tools/verification/catalog/policies.mjs 核对历史后6项顺序。landing_map_asset_contracts PASS 159.4s，local_canonicalization PASS 1.18s，其余串行中。
- Transport 修复两项 owner 断言后，暴露同测试下一项陈旧直接赋值断言；已按 commitUiVisibilityState 调整，尚待复验。
- 既有 project_save_load_roundtrip.spec.js 补充点击、单次撤销、保存回载、跨剧本断言，等待重型检查结束后执行；三类 verify:edit 也待实际结果。

### A 最新实测回报

- Transport 修复后 63/63 PASS，包含 actual owner 委托与 normalizeTransportOverviewLayerVisibility→commitUiVisibilityState 字段和值约束；尚待主协调审查最终 diff。
- 历史后6顺序与结果：landing 10 PASS / 159.44s；local canonicalization 5 PASS / 1.18s；pages heavy 4 PASS / 0.60s；political gap 4 PASS / 2.70s；polar pytest 11 PASS / 5.08s（pytest 内耗时）；transport country 40 PASS / 1.58s。
- 最初误用 unittest 跑 polar 得0例，已排除有效验证；原/当前 catalog 都用 pytest，未发现该处路由缺陷。
- verify:edit controller/renderer/action 总耗时分别2.186/2.087/2.132s，行为测试9/10/6 PASS。execution deferred=0；tier deferred分别27/4/5，不能声称重型层也通过。
- M0 fresh 已通过选择、填色、单次undo/redo、下载JSON断言；保存后Project面板隐藏dock，测试按焦点离开表单后的Ctrl+Z继续验证回载。完整回载、跨剧本及模式覆盖最终结果仍待返回。

### M0 保存回载丢色故障（A 实际复现）

- fresh 第3次：选择、填色、history+1、undo/redo、下载JSON均通过；导出 visualOverrides={DE40D:'#e31ac4'}。
- Ctrl+Z产生状态差异后由 file input 导入，importStartCount/importApplyCount 都从1变2；完成后 runtime visualOverrides={}。A 报告37.6s，M0因此尚未通过。
- 证据在 A worktree 39fa：.runtime/reports/generated/m0-m1-fresh-3.log；trace和edited JSON在 .runtime/tests/playwright/m0-fresh-3/。
- 已要求 A 优先定位 interaction_funnel/FileManager/scenario import 恢复链，核实完成信号、应用顺序及覆盖/重置；仅做必要非policy小修并保留真实回归断言。涉及canonical state action或策略所有权时先协调。不扩大timeout或放宽断言；不重跑无关已绿检查。

### A 丢色根因与候选修复回报

- Trace 显示迁移器 droppedEntries=12866。getScenarioImportValidFeatureIds 提前返回 partial runtimeFeatureIds；TNO正式owners含DE40D，scenario_apply_pipeline将完整resolvedOwners放入scenarioBaselineOwnersByFeatureId。
- A 仅修改 js/core/interaction_funnel/import_apply_orchestration.js，合并可信baseline owner keys与runtime IDs，不用incoming项目任意ID扩充合法集合，无canonical action/policy变更。fresh浏览器复验进行中。
- 已要求核实baseline属于当前目标scenario、切换后无残留；覆盖未进入runtime的合法DE40D保留，以及可信集合外伪造ID仍丢弃。A另用一个只读子代理核对来源，不运行并行测试。

- 来源子代理后续确认：TNO bootstrap runtimeFeatureIds 仅51个RU_ARCTIC_FB_*；完整topology与startup meta均12916 IDs，含DE40D。checked-in owners为12865、缺上述51个，apply pipeline对resolvedOwners执行backfill。需区分源owners数量与backfill后的runtime baseline数量，union应去重而非简单相加。结果已转交A，不重复静态分析。

### A 保存回载通过，PNG内容发现独立故障

- 修复后fresh完整数据链PASS / 44.8s；modern_world切换后导入回TNO、baselineOwnsId=true、伪造M0_FORGED_FEATURE丢弃均PASS（A回报）。
- PNG文件格式有效，但填色RGB像素=0、政治层全白；加入现有waitForRenderIdle后仍复现，M0整体未通过。
- 证据在A工作区：.runtime/reports/generated/m0-m1-fresh-render-ready.log 与 .runtime/tests/playwright/m0-fresh-render-ready/edited-map.png。
- A继续单次fast HOI4对照区分共享export/TNO chunk问题；已要求先排除视口、目标区域像素和抗锯齿假阴性，再追踪export实际canvas/pass/数据/时序。不增加任意等待，不进入M2优化，跨共享契约先协调。

### PNG诊断更正：像素断言假阴性，并非已证实漏层

- A进一步核对：screen pink=2、political pass pink=4，fresh/fast PNG均有6个近目标色像素。最近RGB分别(232,55,205)/(232,56,205)，目标为#e31ac4；全球视图目标仅约2px，2x导出插值改变RGB。
- 撤回此前“政治层全白/独立导出故障”的诊断；现有证据不支持export产品bug。保留旧日志及更正，不将最初精确RGB=0当漏层证明。
- A将以正常鼠标滚轮放大目标，保证足够内部像素后继续原精确RGB断言；不改export/renderer、不放宽阈值。最终导出验收仍待本次复验返回。

### A 最终交付与协调核对

- fresh TNO完整链PASS / 75.365s，PNG精确目标色478像素；fast HOI4 1936完整链PASS / 76.031s，477像素。Golden Demo此前PASS / 57.335s。覆盖选择、填色、单次undo/redo、JSON保存回载、modern_world清空残留、反向导入目标baseline、伪造ID丢弃及PNG内容。
- 候选仅3文件：js/core/interaction_funnel/import_apply_orchestration.js；tests/e2e/project_save_load_roundtrip.spec.js；tests/test_global_transport_builder_contracts.py。无提交/推送，主工作区尚未整合。
- 主协调已直接读取3文件diff与完整 .runtime/reports/generated/m0-m1-baseline-results.md，确认报告区分原始误判、真实修复、局部通过与未验证范围。所有执行结果由A所有，未重复跑测试。
- 最终日志在A工作区 .runtime/reports/generated/m0-m1-fresh-zoomed.log、m0-m1-fast-zoomed.log；JSON/PNG在 .runtime/tests/playwright/m0-fresh-zoomed、m0-fast-zoomed 各测试子目录。
- A报告server已停止，8007无监听，git diff --check PASS，最终仅3候选文件改动。已通知保持worktree/证据，不再重复验证或清理。
- 未验证：完整fresh×fast×TNO×HOI4矩阵、warmcache、Nightly1–8、全构建/发布、P4策略。三类verify:edit均单次测量，不代表统计稳定性。

## 策略工作面只读历史审计回报

- 审计消息来源 ID：01a07c54-b8a8-71f2-9ebe-4da7f557f5d6；worktree 26cb，HEAD 09df7b84，初始干净。工具确认该 ID 是只读子代理，不能当作 B 主执行对话 ID；向其 send_message_to_thread 被工具拒绝（子代理不能接收 app-server 直接输入）。B 主对话正式 ID 仍待确认。
- B 报告冻结 baseline 仍为 P4.0 / 68a62e540104025e1b3e976f77589f8b3eff2f36；derivedAlias transition chain 止于 a2adc4b627b0f0b6ad88c5ed04d68eae3f1ad15c。
- B 报告 a2 至当前 policy 的登记变化为 bindings 569→571、ledger 410→411。旧 policy-report PASS 对应更早 dirty 工作区，不能作为当前 clean acceptance。
- a2 是待按正式规则核实的 previous-policy 候选；提交中的 PASS 文字不能单独构成接受依据。给 B 的后续交接要求：继续核对权威规则和链完整性，完成当前候选 producer/checker，分清登记、检查与全链验收，不刷新冻结基准。补充消息发送未成功，以上要求暂存本文件。
- 审计补充：去掉行号/source fingerprint 的语义差异为两个新增 domain-action target bindings：intensity_field_actions.js#appendIntensityFieldPointState 与 scenario_activation_actions.js#commitScenarioOptionalLayerPayloadState；无语义移除。此为静态登记比较，未证明运行时绑定完整性或 checker PASS。

### 第二轮只读策略审计交接

- 审计方将近期 context 记录盘点为 Round1/2 九处，加 city_paint_style_model、chunk_payload_loader、optional_layer_runtime 共十二处；unit_counter_display_model 为独立旧债。此分类与原计划10+3不同，须由正式执行者核对名单，不能仅按数量判断收口。
- physical_intensity_interaction_owner：getter 返回 live channel，存在 enabled/points/revision 原地写与 appendIntensityFieldPointState 委托；正式登记应覆盖共享 alias sites 和 action effect。审计指出已有 pointer/real factory 行为覆盖，不建议为此重构 runtime。
- political_path_cache_owner：getRenderPassCacheState 返回共享 cache，含 Map/signature/transform、调度句柄及取消副作用；需保留 alias/effect 权威分类，不能误称 runtimeState 直接写入。已有 identity、失配、timer cancellation、slice recheck 行为测试。
- chunk_payload_loader：payload/promise cache、promise identity 删除、AbortController 取消需进入 reconciliation；load state 仍走 canonical actions，不转成 facade direct writer。
- optional_layer_runtime：facade applyToActiveScenario 及 epoch/requestId/currentness、await 后 bundle identity 双 fence；内部 payload/promise/cache 权威应归 scenario_resources/动作，不给 optional runtime 新增 allowlist。
- unit_counter_display_model：runtimeState 只读，milsymbolSvgUriCache 是 per-owner 私有 Map，不能当共享 state alias mutation；单独核对旧 binding debt。
- 以上均为子代理静态审计结论。已有 behavior/contract 只作定位线索，当前完整 registration、previous-policy 权威连续性和候选完整检查仍待正式 producer/checker 证明。

### 策略候选保留机制补充（只读审计，需正式执行者验证）

- discoverCandidatePaths 已合并 PRODUCTION_JS_ROOT 全量文件，不能将缺少policy路径归因为新文件漏扫描。
- 审计指出 pure-reader contract 对命中的factory参数主动跳过writer候选，属于既有设计。political/unit/optional等已登记reader不应仅因policy无路径就转writer。
- physical_intensity_interaction_owner 与 chunk_payload_loader 不在上述pure-reader表；新参数候选可能因没有 canonical mutation finding 或历史 identity 在 candidate retention 阶段被丢弃。故0 unknown/stale不能单独证明getter alias/action edge/effect已完整覆盖。
- 建议正式执行者先验证现有 facade/action/owner contract 是否完整承接这两处证据，再决定是否补精确factory/state-target/effect contract。此为候选修复方向，不是已确认的producer缺陷；不要改路径发现或扩大allowlist，也不要批量将reader改writer。

### 完整manifest fixture前序输入审计（候选问题，未执行验证）

- 来源只读子代理指出：生产 check_state_writer_policy.mjs 已将实际previousPolicy、loadedPolicy与对应identity传入历史worker，recomputeDerivedAliasTaintBaseline也使用previousPolicy作为existingBaseline；不应把fixture问题泛化为生产checker缺陷。
- tests/state_writer_policy_manifest_behavior.test.mjs 的 prepareSharedCurrentPhasePolicyInputs 无request启动worker，buildCurrentHistoricalProofInputs 使用当前policy充当previous/current；readCheckerPreviousPolicy又按HEAD/HEAD^1自动选择，可能造成自证或identity不一致。正式执行方需验证具体失败与契约要求。
- 候选最小修复：fixture/runner显式接收经核实的previousPolicyRevision，读取同一trusted previous policy供worker/checker及identity；当前policy只作为候选。不要根据dirty/HEAD自动赋予信任，也不要直接将a2候选升级为已接受事实。
- 保留缓存完全相同identity的复用约束，包含sourceSha/candidatePaths/phase/checkpoint/previousPolicy/policy；身份不同必须拒绝复用。不要放宽equality guard，也不为fixture随意改worker默认语义。

### B 主对话正式运行状态与路由交接

- 正式ID为01a07c54-625d-7ed2-ab79-0e7d476b470d，26cb worktree/09df7b84。B报告可信previous已核实为a2adc4b6，HEAD^ policy blob相同；正式producer单独运行约22分钟、带CPU profile、尚无失败输出。运行由B唯一管理。
- B报告原Nightly manifest六项窄断言已修复并5+1通过，仅改 tests/state_writer_policy_manifest_behavior.test.mjs；完整策略证明仍未交付。
- P4 route gate实测FAIL：changed115/p4owned44/unmatched0/route-gaps24，类型missing-direct-state-ownership-route。报告在26cb .runtime/reports/generated/p4-state-actions/P4.4/adaptive-selection.json。
- 主协调分派executor m1_route_gaps于26cb独占必要catalog/records登记，先分类真实覆盖缺失/漏登记/gate误分类，禁止改policy、manifest测试、生产owner或allowlist，不运行重型检查；最窄验证须先确认资源与输出隔离。B已通过对话消息获知，避免重叠。
- producer开始后路由变更不得冒充producer已验证输入；最终需准确记录候选输入边界与交叉影响。

- m1_route_gaps静态分类：24项均已有真实行为路由（local11、renderer-lifecycles4、renderer-editing2、renderer-splits6、visible-frame-diagnostics1），缺state-ownership域精确P4.4 phase sourceRef。将仅补state_ownership.mjs既有p4:p4-4-exact-phase的24路径，不改reader/writer分类、gate、allowlist或UI-actions子套件。最窄gate用独立输出，最终gap与普通verify:edit影响待返回。
- 主协调已读B manifest测试diff，要求逐项解释P4.3预期hash替换、governance entries15→14、operation replacement筛选范围收窄的历史依据与负向覆盖。未将窄测试绿色自动视为保持冻结基准和完整证明的证据。

### B producer成功与fixture解释（B回报，完整检查待完成）

- 正式producer exit0，1,405,029ms（23m25s）；候选213 writers / 573 bindings / 411 ledger。相对a2全部8个冻结baseline sections、baseline源、derived diagnosticDelta/transitionSemanticDelta严格相同；derived paths/transitionCheckpoints发生变化，checkpoint路径25→30。
- B解释governance 15断言在a2引入时四caller正式contract已是14，当前仍14；本轮未删除contract，真实缺边及移除cache action负例通过。
- operation原18项expected均为strategic/transport；新增19th是renderer/P4.3 cachedDetailAdmBorders，有对应P4.3与治理证明，因此保留原P4.4模块范围18项逐项检查。
- 四个hash对应dprLastStageSwitchAt/dprStage/firstVisibleFramePainted/projectedBoundsDiagnostics的迁移contractIdentity；变化为replacement身份，retiredIdentity/sites未变。B报告ledger逐字段对冻结retired sites比较通过；主协调最终需对照其证据。
- CPU profile 892684 samples：cloneAliasRecords 23.2%、GC10%、mergeAliasRecords8.3%；是采样占比，不是wall时间节约。解析/Git读取非主要热点。
- 已要求B保留成功候选，核对571→573新增binding；若做优化仅限有证据的单个alias不可变复制热点，验证分支merge/kill/isolation与同输入输出等价，不做跨输入缓存。checker/full gate尚未通过，不因优化推迟必要验收或扩大重构。

### 路由子代理阶段交付与13项局部入口续修

- state_ownership.mjs新增24行exact phase路径。P4 route gate PASS：116 changed/45 owned/0 gaps，unmatched0；20/20路由行为测试、455 route schema、diff check通过。
- 24项edit选择前后命令完全相同，只增加P4 tier deferred，没有重型执行。报告26cb/.runtime/reports/generated/m1-route-gap-repair/。
- 发现原有13项组合behavior覆盖却无edit eligible入口：lifecycles4、editing2、splits6、visible-frame-diagnostics1；另11项正常。未将此误报为24项局部入口全通过。
- 已续派m1_route_gaps在local_feedback.mjs复用可独立安全执行的真实叶行为测试补准确路由，并对唯一命令去重验证/计时；不得把heavy package改标签伪装便宜、不得改B文件或执行重型检查。确实不能独立覆盖的保留缺口。B已收到消息。

- 局部入口最终：local_feedback.mjs +13精确source/test元组；13唯一node命令串行各1次，72/72 PASS，158–172ms/命令，总约2.11s（非npm完整反馈时间）。13路径各仅选对应行为测试，P4 tier deferred；未知路径仍no-eligible fail closed；468 schema与diff检查通过。两catalog累计+37行，原3代表的精确纯选择对照补充中。
- B优化只改cloneAliasRecords为new Map(aliasRecords)，报告72 scanner正负例通过，第二次同输入producer比对中，完整JSON等价前不写policy。manifest改为显式a2前序，worker/checker/builder身份隔离；checker新增可选explicit revision参数，2个新ref负例通过。完整checker/full仍待完成。
- 主协调已派只读reviewer m1_proof_diff_review审查B共享引用不可变性和前序/cache身份；禁止其运行测试或修改文件。此审查不替代实际等价/完整gate。

## 2026-09-08 恢复与串行整合

- 新协调任务01a07eb6-27fa-7db3-b323-3191687218fe指定本对话为M0/M1唯一整合者，允许本地分支/提交，禁止push/发布/丢弃未归属修改；M2/M3由新协调任务负责。
- 已恢复reviewer正式结果（子代理ID01a07c80-e078-7fe3-ad09-f5fbe70d2c5b）：B三个文件静态PASS，无共享tracked value原地修改、无current自证、显式无效ref fail closed；不替代运行结果。
- A39fa已创建分支codex/development-recovery-m0-m1-20260908；首提交0a01245882a0a2a91930eecc3be085c56cdec064，仅A三文件，提交后干净。此为稳定M0候选，不是M0/M1最终基线。主目录main仍09df，配置修改未碰。
- B26cb仍独占重型验证，已请求先保存等价producer结果，再确认A import源码对策略身份影响；可能将A补丁纳入26cb最终验证后，再将B候选整合至39fa。禁止其他任务cherry-pick或复制重型检查。

- 主协调静态确认A import文件有policy module-state binding，derived历史记录包含runtimeFeatureIds/index/topology unsupported-call-mutation及alias-escape。A改变调用结构，不能假设policy不受影响；必须在合并源码下验证当前scan/delta，再完成正式checker/full。已提醒B在未含A前暂不启动最终full，等待其现有进程结束确认后再由主协调应用A patch。

- B确认昨夜optimized producer中断、候选0字节；恢复Start-Process session退出-1，当前无producer/checker/full进程。原始producer候选/profile保留。不能称优化等价已完成。
- 主协调已将0a012458三文件patch应用到26cb（先apply --check），diff --check PASS，共8改动文件，HEAD仍09df，policy未写。B已收到可以启动通知；所有live验证仍由B唯一拥有。
- 协调同意同一合并源码下完整全仓scan输出（findings/bindings/diagnostics）优化前后精确等价，再一次正式producer/checker/full；报告必须称scan等价，不声称两次完整producer JSON等价。对照实现需隔离加载，不得并行改当前tool源文件导致身份漂移。
- 另一协调01a07eb2-066a-7cc0-8d87-8745887b2586已归档，通知工具拒绝；未恢复该任务。新协调01a07eb6已获最新状态并继续M2/M3只读等待。

- B已确认恢复任务真实启动：2026-09-08 01:58:51Z，wrapper PID22336，统一session20267，child PID由其resume-20260908-result.json记录。主协调不读取/轮询该进程，B唯一拥有。
- 最终顺序已协定为同源完整scan等价→正式producer→candidate-ready暂停。B不会自动写policy/checker/full；候选审查后主协调冻结文件、整合至39fa并提交，再确认26cb与该commit文件一致后对齐HEAD/index，由B在clean提交上唯一执行checker/full。显式a2前序不随新父commit漂移。

- B静态确认最终提交后仍保留frozen source68a、显式previous a2；HEAD仅记录被验证commit/tree，不把09df或A父提交替代前序。manifest实际worker/checker/build均固定a2。
- A import文件的完整discovery+inventory优化前后比较已于01:58:51.698Z通过（第1/430项）；全仓其余项仍运行，不能把单文件通过当全仓等价。

- 最终clean checker确定使用既有--require-clean，与--previous-policy-revision a2adc4b627b0f0b6ad88c5ed04d68eae3f1ad15c同时传入，输出.runtime/tmp/m1-policy/policy-report-final.json。须等主协调提交并对齐26cb后才启动；漂移须失败而非仅记录。

- 2026-09-08全仓scan等价PASS：430/430实际candidate paths，完整bindings/findings/diagnostics/actionDelegations逐文件deep-equal，892570ms（14m53），包含A import。证据B .runtime/tmp/m1-policy/scan-equivalence-20260908-result.json、scan-original-20260908.json、scan-optimized-20260908.json。此为完整扫描等价，不是两次完整producer等价。
- B正式producer于02:13:43.699Z启动，PID27508，显式a2/P4.4，完成后仍停candidate-ready，不写policy/checker/full。主协调不重复运行。

### 合并源码诊断差异与detached输入补修

- B同strict对照旧源/A源发现诊断仍7项但新增两项alias-escape（validFeatureIds传migration、getFeatureId(geometry)），不能以计数相同判断无新增。主协调读取helper确认本身只读；采取显式局部引用隔离，不扩大baseline/allowlist。
- 39fa补修：validIds空Set后加入String baseline keys；getFeatureId接收structuredClone({id,properties})，不克隆坐标，保留shared helper的ID优先级。A重新独占39fa browser/server复验原fresh/fast两条；禁止其修改源码/测试或提交。
- B于02:17:20.883Z安全停止旧A producer PID27508，elapsed217184ms，退出码4294967295，wrapper22336退出1/session20267结束，原中止candidate/stderr保留不复用。
- B确认无live进程后，主协调复制补修import文件至26cb，diff check PASS。B先验证本文件新诊断不新增及original/optimized完整局部等价，再新producer。旧430扫描结果归旧A身份，其余429未变文件可保留等价证据，无需重复全仓扫描。

- detached候选窄scan仍新增alias诊断，scannerEquivalent=true但noNewFindings=false，未启动producer；主协调不继续扩大clone，要求B以内存候选验证保留旧fallback/map读取、仅在合法集合补baseline的更小方案。当前源码未最终定稿。
- A复验setup曾未启动server，fresh仅page.goto ERR_CONNECTION_REFUSED，不计产品结果。后续server已确认39fa/PID24288/8007/HTTP200，但fresh重试和fast均按主协调暂缓，等待最终A源；A仍唯一server owner，不修改源码。合同.runtime/reports/generated/m0-detached-handoff.md。

- 最终采用更小fallback+baseline union：保留原runtime数组→index→topology优先级，各支返回的Set补可信baselineIds，最后仅baseline也可返回。无需clone或无条件合并所有runtime源。内存probe strict7项既有诊断、精确新增0，证据import-union-probe.json。
- 主协调已复制最终候选到39fa/26cb，仅补原if braces与说明注释，保留旧读取表达式。diff check PASS。B实际源码窄scan后直接启动新名producer；A恢复原fresh/fast浏览器复验。此前clone候选废弃，不作为最终实现或完整证明。

- B最终实际源码窄检查PASS：original/optimized完整输出相等；相对09df同strict诊断新增0/移除0。证据import-final-check.json、final-import-source.js。新名producer已启动，输出candidate-final-20260908.json、producer-final-20260908-result.json，仍停candidate-ready后交主协调，不提前checker/full。

- 最终fallback版本A复验PASS：fresh75.579s/PNG478精确像素，fast72.975s/477；原完整断言不变，server69164已停/8007无监听。主协调直接读取m0-final-priority-results.md和diff，未重复测试。
- 主协调将最终A实现提交为14d7b8ede9210c2a3d0fe615b484c18214d3763f，39fa/codex/development-recovery-m0-m1-20260908干净，未push。26cb生产输入未变；B候选将以该提交为整合父提交。此仍非完整M1最终基线。

### 最终合并候选4867c93f，clean gate待执行

- B最终producer exit0 / 1020281ms（17m00），schema0；8冻结sections和baseline metadata与a2一致，213writers/573bindings/411ledger。所有producer进程结束后交接6文件。
- combined derived相对B-only增加import strict path190→191及两条既有诊断（line39/40，fp af701885/351ba49f），same-strict旧源码也存在且a2/09df旧import源码相同；不是新增A逃逸，import grants operations/keys仍空。主协调已读combined-candidate-review和combined-derived-delta。
- 六文件整合至39fa后提交4867c93fb302b91e72082ae72401da131e594d47；分支codex/development-recovery-m0-m1-20260908，提交后干净，未push。
- 26cb全树git diff该commit为0、index无暂存变更、无untracked后，主协调用reset --mixed只对齐HEAD/index，不改工作树内容；最终status空、HEAD同4867c93f。B已获启动clean checker→full通知。
- 当前只是最终验收候选。新协调01a07eb6获知commit但M2/M3仍等待gate。main仍09df，原配置WIP保留。

- B clean checker于02:53:44.767Z PASS，581309ms（9m41）。policy-report-final.json：verdict pass、violations[]、unknown0/stale0、verificationSha4867c93f、workspaceClean=true；sourceBase68a、显式previous a2保持。
- 官方full于02:53:44.770Z自动启动，runnerPID20000；B回报前253项通过但整体尚未结束。代码继续冻结，不能用checker或部分TAP代替full。

### 4867c93f完整测试终态FAIL

- 475 tests / 474 pass / 1 fail / 0 skip / 0 cancel，1616234ms（26m56），未超45min；所有full/manifest/wrapper进程已结束，session75291退出1。完整失败工件保留。
- 唯一失败test351：P4.3 renderer action calls stay within frozen runtime-state escape budget，manifest约5992，expected27/actual16。其他历史worker/checker/builder/负例通过；clean checker仍PASS但完整M1未通过。
- B只读核对成员差异，主协调要求11项减少的实际迁移/权威依据及剩余16的冻结约束，禁止机械改数字或从实际扫描自生期望。新协调已获失败状态，M2/M3继续等待。

### 冻结预算语义修正97566d29与最小复验

- B确认优化前inventory同fingerprint已有16（不是优化漏报），a2 policy22、09df policy18，硬编码27未随既有收敛更新。测试语义是不得超过frozen budget，主协调保留27上限改assert.ok(length<=27)，后续3个修复函数零逃逸和唯一ensure sink断言保持。
- 本地提交97566d291995d496a5226b7ab69806f5cc56fbd5，父4867c93f，仅manifest一行测试期望。26cb确认干净后ff对齐同commit，39fa/26cb干净。
- 最小充分复验选择官方runner仅唯一失败完整测试，涵盖后续断言。不重复未受影响producer/scan等价/checker/完整full。B需确认manifest非candidate path。
- 最终证据将明确组合来源：4867 clean checker PASS及完整474/475，97566一行测试修复后的聚焦结果；绝不宣称97566全量或checker同SHA重新通过。新协调已知该选择，复验尚待返回。

- B实际discoverCandidatePaths430不含manifest，97566 diff仅一行测试且clean，官方focused已绑定97566启动，首尾核对HEAD/status。无producer/checker/full重复。
- 精确历史成员记录escape-budget-history.json：12d/a2/4867 AST定位0遗漏；27→16是12旧site退出、1legend site进入，净减11。27→22：旧runtime context本体/闭包3退出，hover1迁owner，renderLegend2替换为legend owner1。22→16：visible-frame recorder1、renderPassSignature2、reset diagnostics1、projected diagnostics recorder1、DPR stage1迁owner/action/pure-reader契约。剩余16=旧15+legend1。09df policy18行号过期不能当实际扫描；优化前inventory实际16是独立扫描证据。

## 最终本地收口与M2/M3交接

- 97566d291995d496a5226b7ab69806f5cc56fbd5官方focused PASS1/1、fail/skip/cancel0，588850ms（9m49），03:35:16.247Z结束。原预算<=27、三修复函数零逃逸、ensure sink=1均执行。wrapper首尾HEAD/status通过，无残留policy进程。主协调已直接读取focused-final-20260908-result.json并核对26cb clean/HEAD。
- 精确命令：node tools/run_p4_state_writer_policy_tests.mjs --test-name-pattern="^P4[.]3 renderer action calls stay within the frozen runtime-state escape budget$" tests/state_writer_policy_manifest_behavior.test.mjs。
- 组合证据：4867c93f cleanchecker PASS9m41 + officialfull474/475（26m56，唯一旧等号断言失败）；97566仅该断言一行修复后focused1/1PASS。生产源码/配置/policy与4867完全相同，manifest不在430候选路径。没有97566同SHA full/checker重跑，不是canonicalfull全绿、P4准入、CI或release。
- 主协调将本地main从09df ff到97566d29；原.codex/config.toml前后字节完全相同。main仅保留原config修改和本任务未跟踪docs记录。无push/发布。39fa整合分支与26cb均同97566且clean。
- 最终代码9文件；本地提交序列0a012458→14d7b8ed→4867c93f→97566d29。M0两指定browser组合最终通过；M1局部路由、非策略历史故障及策略恢复以组合证据收口。未运行全模式矩阵、warm cache、完整Nightly/发布。
- 保留39fa和26cb及.runtime证据供后续任务消费；不清理其他worktree。M2/M3由01a07eb6协调，本任务不实施该范围。

## M2/M3 integration handoff - 2026-09-08
- Coordinator: task 01a07eb6-27fa-7db3-b323-3191687218fe. M0/M1 baseline 97566d29 retained.
- M2 owner 01a07eb8-c7a9-7e42-bf8c-77ce03c57e81, worktree 590c, source f5d9b5aa; M3 owner 01a07eb8-c78d-71d0-8d35-2b7c956eec25, worktree 57ef, source 2a3c8ab4. Both retained for evidence, no cleanup/push.
- Files do not overlap. Clean 39fa integration branch codex/development-recovery-m2-m3-20260908 contains M3 replay 4e47f4fc then M2 replay 2453300b. Integration target checks: M3 Node 9/9; M2 Node 17/17. Main remains 97566d29 pending artifact acceptance; .codex/config.toml preserved.
- M2 observed A/B/A/B TNO overlay CPU median 427.6 -> 212.0ms; 12 redraw ->12 reuse. This is water selection overlay CPU only. Actual highlight/clear/hide/fill-undo/zoom/scenario return passed. Existing Python politicalPassCurrent location assertion fails on baseline; not fixed by M2. Evidence 590c/.runtime/reports/generated/m2/{comparison,correctness}.json.
- M2 released all browser/server resources. M3 now sole owner of build/browser on fixed 2453300b; must record exact commands/logs/runtime paths before starting. Plan: one fast edit flow; dependency artifacts with expected source SHA/tree; clean artifact build/admission; legacy dist reference build; shadow equality; localhost release gate; Git archive HEAD:dist rollback smoke. Stops on failure, no duplicate runs, no tracked dist deletion/deploy.
- All M3 generated outputs/logs under .runtime, proposed ports 8008 and 4173 verified free by owner before use. Coordinator only reads completed evidence. M3 must report exit codes, source identity and teardown before final integration.

### M3 shadow status repair and final acceptance source
- Actual 2453300b fast flow passed; dependency outputs complete; artifact and legacy builds succeeded. Shadow identity parsing failed because strip() removed the first porcelain status column space. No successful shadow receipt was claimed.
- Minimal repair 6475d523 (tools/pages_artifact_shadow.py and target tests) keeps leading status spaces with rstrip CR/LF. Integrated by fast-forward into 39fa; project Python target tests 10/10 passed. Bare python was unavailable; successful command used npm run python -- -m unittest tests.test_pages_artifact_shadow -q.
- M3 remains sole runtime owner, now rebuilding source-bound artifacts on clean 6475d523 before shadow/artifact/rollback smoke. Prior 245 fast and M2 performance evidence retained as earlier-source evidence; runtime source unchanged by this tool-only repair.
- 57ef prior build trees and dist differences are retained intentionally. No tracked dist deletion, deployment, or worktree cleanup authorized/performed.

### M2/M3 first tranche accepted locally
- Main fast-forwarded to 6475d523a0461e9a326c6df810c4a60e8f845fba after final M3 acceptance; original .codex/config.toml bytes preserved. No push/deploy.
- Current artifact: 9559 files, 958295374 bytes; clean admission, legacy equality, localhost release gate PASS. One local shadow receipt, retirementEligible=false.
- Direct Git archive of HEAD:dist FAIL: ignored app/data absent and runtime requests404. Fixed-source rebuild rollback from97566d29 using its own builder/admission PASS, build73.2s and localhost smoke39.3s. Do not describe archive as deployable or claim raw geodata regeneration.
- Final M3 report: C:/Users/raede/.codex/worktrees/m3-shadow-status-fix-20260908/mapcreator/.runtime/reports/generated/m3/final-results.md. Prior and current build worktrees intentionally retained with legacy generated dist differences for evidence; all owned servers stopped.
- First tranche complete, not all M2/M3 goals: remaining M2 includes chunk/index chain and measured input-to-display latency; M3 checkout-size/time reduction, raw/derived/runtime asset separation and production retirement are not implemented. No unrelated worktree cleanup.

## Remaining milestone continuation runtime handoff
- User resumed remaining M2/M3 after first tranche. Same two task IDs, no duplicate tasks. Heartbeat reactivated for completion of all local acceptance items.
- M2 source6475d523, branchcodex/m2-runtime-input-recovery; proposed measured duplicate primary-index construction before full restore, pending runtime evidence. Sole browser/performance owner. No public harness change without scope allocation.
- M3 currently only design/light local tests. Parent clarified sparse working-tree byte savings must not be described as Git object/download savings; existing checkout profiles do not already implement editor sparse checkout.
- Parent expanded historical plan with original remaining milestone criteria, leaving earlier M0/M1 scope intact. No production retirement required for local original M3 criterion; retain explicit fixed-source rebuild/provenance limitations.

### Remaining M2 integrated; M3 actual sparse acceptance running
- M2 source73765a89 replayed asf1639a0c after M3 profilee047c35a; local history/dev input routes added00d3465b. Thirty touched runtime target tests and history verify:edit4/4+471 route schema pass.
- M2 repairs: skip preliminary indexes before mandatory full restore; feature-only undo/redo uses union-of-snapshot IDs; successful-current apply releases and resumes matching pending chunks; color fast-idle preserves canceled settle wakeup. Final strictTNO+actualhitABA passed, plus zoom convergence. Prior ready-only ABA claim corrected: baseline can return empty TNO while ready=true.
- Final candidate source00d3465bbf91543279b8da2a0e67421db7aa7321/tree257fd53a. 39fa frozen for M3 artifact build.
- Parent created new detached --no-checkout sparse worktree m3-editor-sparse-20260908/mapcreator. Native noncone materialization13.979s, initialclean. Profile: selected11316/logical1254756150B; excluded4750/1300955129B. Actual selected file bytes1257873680, excludedPresent0. This is file materialization, not NTFS allocation/Git history/download saving.
- M3 task now sole runtime owner; sparse npm/fast browser/owner test, full-source Pages artifact build/admission/local smoke. Exact execution contract sparse/.runtime/m3-final/execution-plan.md. Parent check/timing records39fa/.runtime/editor-checkout/final-m2-m3/. Old evidence untouched.

### Remaining M2/M3 local acceptance complete
- Main fast-forwarded to00d3465bbf91543279b8da2a0e67421db7aa7321; original .codex/config.toml bytes preserved; no push/deploy. Parent reviewed runtime/profile diffs and completed local route wiring.
- M2 local criteria met: attributed fetch/decode/derived/index/draw/ready stages, removed measured duplicate preliminary indexes, incremental feature-only history refresh, repaired two lost wakeups, real Berlin-hit ABA and final strict idle/zoom convergence. Browser-observed input endpoint is RAF+SVG/canvas evidence, not physical display. TNO stable undo178.8/180.7 are observations without paired stable baseline; no general startup or TNO undo speedup claim. Prior two-sample infra improvements are diagnostic only.
- M3 actual sparse acceptance PASS:11316 selected files, actual1,257,873,680B, zero excludedPresent;1,300,955,129 logical bytes/50.9% avoided vsfull. Sparse fast editing/PNG/JSON/ABA PASS; 884 observed responses no network/page/console issues;22owner tests PASS. Native disable restored all16066tracked files in7.988s withclean status. Sparse acceptance worktree intentionally nowfull; evidence retained.
- Final complete00d3465b Pages build/admission/local smoke PASS (build48.963s,9559files/958299063B; smoke31.7s). No tracked dist writes. Raw ledger20/25local caches missing: traceable provenance/rebuild commands retained, but no raw-data regeneration claim. Old directdist archive rollbackFAIL and97566fixed-source rebuildrollbackPASS remain original-source evidence.
- Final report39fa/.runtime/reports/generated/m3-final/results.md; M2 report590c/.runtime/reports/generated/m2-continuation/README.md. Servers stopped and runtime ownership released. No cleanup of existing evidence worktrees or unrelated WIP.
