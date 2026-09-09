# 交接上下文

## 当前收口结果（以下较早记录仅保留过程）

N1–N4 本地阶段已按实施/停止条件完成。最终 canonical build session60545 exit0，922.02MiB，日志 .runtime/tmp/editing-response-v1/pages-final-build.log。dist 仅 scheduler、scenario_refresh_runtime、spatial_index_runtime_owner 三个镜像及 pages-dist-manifest.json 修改；三个镜像与源码按 LF 归一后完全相同，git diff --check通过。N4最终测试session73740 exit0；8843无监听，无本批遗留服务器。保留用户 .codex/config.toml 和旧 M0/M1 记录；未提交、未推送、未发布。

N3 子代理最终交接：自然后台 undo/redo native-visible=167.3/252.5ms，TNO stable=192.9/320.4ms，HOI4 stable=191.1/251.9ms；所有对应 political partial applied=true。受控 redo 的 history=1166.4ms、UI hooks=45.3ms、flush=1116.1ms，实际热点是 fine 政治全绘恢复；不移除 UI hook、不绕过 missing-full-reference-transform，不引入候选缓存。故原计划四对 A/B 的候选前提不成立，按停止条件结项。3 个受控归因、1 个自然后台、2 个 stable 检查通过；另一个 selection busy-overlap 失败保留为诊断，不计通过。原始路径及时间戳见 .runtime/tmp/editing-response-v1/n3-attribution.json，重放脚本同目录 n3-attribution.cjs，修改前决定 n3-prechange-decision.md。

N4 实现：scenario_refresh_runtime 局部 epoch 与 execution 身份保护旧句柄、reset 复用和 async 续体；失败清 pending 并保留 failure metric，cancel/finally 只释放自己拥有的 recovery marker。空间 builder 增加可选 isCurrent，首次及分片 yield 后失效即退出，防止内部提交过期索引。独立静态审阅指出 loadState 替换时的 marker 残留，回归断言复现后已修复，并证明下一次 promotion 能完成。没有更改 quiet、优先级、重试预算。

最终 N4 verify:edit：473 routes，infra 7/7，1 command、deferred 0；前一步 spatial route 7/7，既有 scenario_refresh_plans_behavior 17/17。浏览器最终 .runtime/tmp/editing-response-v1/n4-final.log：1 test 内三个窗口全部通过，2.0m、exit 0，错误列表为空；冷/热索引12413、HOI4索引11891；pending tasks、infra pending、recovery均排空，ready=true，真实填色/撤销/重做通过。证据 .runtime/tests/playwright/n4-final/dev-scenario_deferred_infr-234a9-ario-switch-editing-windows/deferred-infra-windows.json；重放 node .runtime/tmp/editing-response-v1/summarize-n4.cjs，输出 n4-summary.json。

N4 分类边界：冷/热从交互入口至排空为14.66/16.91s，包含测试操作和等待；scheduler observed pending→start约1.08–13.28s，阻塞原因为active-task、interaction-recovery-task、hit-canvas-build-scheduled、idle-time-remaining。异步callback历时不能当作同步CPU。观察到长任务最大冷2.726s/热2.740s/切换9.485s，未采调用栈，不声称已解决所有输入性能或把它归给scheduler。历史 pending timeout 未在三窗口重现；新增确定性失效/失败序列是真实局部缺陷证据，但不冒充历史故障根因。warm表示同浏览器再次导航，并非已证明缓存命中。

## 历史执行记录

最终 N4 运行契约：owner=/root，cwd=C:/Users/raede/Desktop/dev/mapcreator；MAPCREATOR_DEV_PORT=8843；node node_modules/@playwright/test/cli.js test tests/e2e/dev/scenario_deferred_infra_lifecycle.dev.spec.js --workers=1 --retries=0 --output=.runtime/tests/playwright/n4-final；日志 .runtime/tmp/editing-response-v1/n4-final.log。Playwright 独占管理服务器与浏览器，180秒测试预算，完成/失败后退出；子代理只读已落盘产物。首轮三窗口通过，后发现 loadState 替换后的 recovery marker 清理边界已由新增断言复现并修复，因此用最终源码重新执行一次三窗口。之后串行 canonical build：npm run python -- tools/build_pages_dist.py，输出已核对为仓库 dist/，日志 .runtime/tmp/editing-response-v1/pages-final-build.log；以 exit 0、三个生产源码镜像一致、范围检查为成功条件。

2026-09-08：来源 https://chatgpt.com/c/6a9ec54f-31f0-83ec-953a-efa96be491b0 。最新用户补充要求强调架构、测试、性能的快速具体执行；回复先给 N1–N4 细化方案，后附 S1/P2/U2 较早方案。本批采用最新补充对应的 N1–N4 范围。

起始 git log：fb28b187，PR #126 合并。起始未归属 WIP：.codex/config.toml 修改，以及 docs/active/development-recovery-m0-m1-20260907/ 未跟踪目录。全部保留。

主代理写入 js/bootstrap/post_ready_scheduler.js、tests/post_ready_scheduler_behavior.test.mjs、本记录及最终共享登记/镜像。子代理 n2_input_evidence 写输入探针、单个 support helper 和 Node 测试；无浏览器或重型执行授权时段，先复用原始 JSON。所有子代理不提交、不改 dist。

N1 源码确认：完成回调仅按 taskKey 清除 active；旧 runWhenIdle 失效时调用 clearTask(key)，idle/timeout 回调在 epoch 判断前 delete(key)，均可能影响后来的同名任务。修复不自动取消旧业务副作用，也不能被称为已解决 pendingInfraPromotion 超时。

N1：新增 18 个时序反例在原实现全部失败、原有 6 个通过；修复后 24/24 通过。独立运行 main_post_ready_scheduler_boundary 与 main_bootstrap_wiring_boundary 15/15 通过。实现仅增加 scheduler 局部 execution 身份与 scheduledHandle 归属检查。

N2：共享 local_feedback 新增 local:input-evidence，helper 的 verify:edit 实际执行 1 个 Node 命令，6/6 通过、deferred 0；路由 schema 472 条通过。子代理仍在收尾既有样本分析。

最终镜像运行契约：owner=/root；cwd=C:/Users/raede/Desktop/dev/mapcreator；命令 npm run python -- tools/build_pages_dist.py；共享输出 dist/，日志 .runtime/tmp/editing-response-v1/pages-build.log；成功条件 canonical builder exit 0，源码镜像一致且 diff 仅相关镜像/manifest；失败保存日志并定位，不放宽 gate。运行期间子代理不使用浏览器或重型资源；非 owner 仅读日志快照。N1 生产源码已冻结，N2 仅测试支持文件，不进入 Pages。

N2 最终版本 7/7 Node：同一事件 processingStart-startTime 算 queue；唯一 pointerdown timestamp+targetId 关联，缺失或歧义留空；无采集/输入/像素观察修改，measurementVersion=3。主代理审读 helper、实际两处调用及 Node 夹具，登记 light route，同时保留 full 浏览器 route 对 helper 的依赖。

原始数据索引 C:/Users/raede/.codex/worktrees/5d0c/mapcreator/.runtime/tmp/p1/v2-raw-files.json 与 natural-raw-files.json：16 份旧记录、52 次离散操作匹配、32 次 controlled-busy 真实 overlap、自然后台 4 次。此次是旧数据重放，不是新版本浏览器性能采样。

N3 暂不实施：B busy redo 4 个样本 native visible=1868/1771.2/1517.4/2238.7ms，pointerdown queue=446.3/397.7/286.6/667.4ms，同 interactionId click handler=1418/1366.2/1226.3/1550.2ms，click end→visible=1.9/1.8/2.1/1.9ms。refreshColor=6.2/6.3/4.7/11.7ms；缺 snapshot、UI hooks、flush 的独立起止和调用次数，不能把其余时间自动归给 hooks。下一次仅针对同步 click 内分段采样，再固定预算选择一个热点。

818.5ms selection（v2-05-B-1）：native28783、capture28783.3、click28785.5→28824.2、后续longtask28825.6→29598.6、visible29601.5。主要在 click 后主线程；缺 longtask 调用栈，不能将嵌套 context/region 阶段相加。样本保留，未标记已修复。

N4 未触发：自然后台 4 样本 native visible69.9/69.4/102.9/92.6ms，full stable10146.3/9741.6/11978/12036.3ms；dispatch 6/5/5/4 pending keys，随后全部排空、promotion 序号推进。缺每任务等待/运行拆分和 stable 重置原因，不调整 quiet/retry。早期 pendingInfraPromotion 超时仍待复现，与 N1 不合并归因。本批无新增浏览器/性能运行。

收尾：canonical build exit 0，922.02 MiB；dist diff 仅 app/js/bootstrap/post_ready_scheduler.js 与 pages-dist-manifest.json，增长355字节对应同一源码。源码/镜像 LF 文本相同；git diff --check 通过。构建 session94719 已正常退出，无本批后台进程。最终 helper verify:edit 再验 7/7（因 queue/identity 边界改动而重跑），472 routes、1 command、deferred0。

继续执行：用户要求完成剩余任务。n2_input_evidence 接手 N3 唯一浏览器/服务器执行权，日志 .runtime/tmp/editing-response-v1/；主代理只读N4生产代码，避免影响N3固定源。N4候选待验证：scenario_refresh_runtime.js 的版本reset复用、旧deferred handle清理、异常pending终态。未将其与历史超时合并归因。

可重放分析：node .runtime/tmp/editing-response-v1/replay-input-evidence.cjs；输出 .runtime/tmp/editing-response-v1/input-evidence-replay.json，含16个原始完整路径及逐事件时间戳。依赖保留的5d0c原始证据工作树。子代理已完成交接；主代理审读其实现、测试与分析输出，不宣称重新进行浏览器性能采样。工作区修改未提交/推送；原始配置WIP与M0/M1记录保留。此记录保留作为下一次N3/N4触发判断依据。
