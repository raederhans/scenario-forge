# 恢复与交接

当前阶段：统一 [PR #244](https://github.com/raederhans/scenario-forge/pull/244) 已建立。第二轮 head `fec2e664179a8426f529fae9707310dcd6f79281` 的 Raster 原五阶段、Perf、Quick Fill、Scenario、Transport 均成功。pr-verify 的两个剩余失败已独立审查：footprint 契约仍要求旧 PR 触发器；1939/TNO smoke 被 Chromium 原生 ReadPixels 性能诊断截断。前者现在约束仅 manual/schedule、禁止 PR/push，原报告和无部署断言保留。

`052c2a79` 托管 smoke 四项 4/4 通过（2.2分钟），随后串行受影响 browser 命令复用 8810，Python server 启动失败；服务器明确不复用 socket，且既有 golden 步骤也因 TIME_WAIT 使用不同端口。runner 现给每条 browser 命令独立递增端口，同时设置服务端与应用 origin 端口，并开启 webserver 启动日志；回归通过 1/1，未增加重试/超时。fast 首次继续走到旧结构契约：新 raster spec 与 catalog 同步使用 canonical run-spec，保留 spec 唯一性严格契约；旧显式 selector/adaptive artifact 行为全部保留，只把工作流绑定断言改为当前分流 runner 的先选择后执行与 fail-closed 契约。两项目标结构测试 2/2 通过。该 head Raster/QuickFill/Scenario/Transport 已成功，Perf 当时仍运行，后续以最后 head 为准。

最终取证审核另确认：本 PR 串行执行多个 Playwright 命令，后续命令会清空共享 outputDir。因此每份诊断另外存入独立 `.runtime/reports/generated/native-gpu-readback-diagnostics/`，smoke/demo 均上传它。定向单元回归删除模拟用例输出后仍必须读到完整归档，避免成功日志之外的原始 JSON 证据丢失；这项只修正取证持久化，不改变已通过的浏览器行为。

后者通过固定 Chromium 145.0.7632.6 / ANGLE `4c0ae3917d4feab6ae1c99d7b750a69cdf3cc96c` 源码和本地实际 GPU 合成实验确认：该固定文本由 Vulkan 同步读回路径发出，不代表 GL 错误或已经测量的性能回归；同步读回仍有成本，独立性能门禁不变。仅当 warning、零 JS 参数、同源同 document 路径且 line/column 均为 0、文本完全匹配时单独记录。应用 console.warn 同文仍有参数并失败，其他 warning/error、context lost、网络和像素断言均保留；全局 console allowlist 未变，生产栅格未关闭。原始完整诊断写入 Playwright 输出并上传 JSON。证据和实验局限见 ignored `final-integration/gpu-investigation.zh-CN.md`。

本轮最小重验：footprint 单项 1/1、诊断分类及实际文件保存 2/2、工作流取证契约 1/1；真实 Chromium 1939、TNO、sample-guide golden PNG 三项 3/3（workers=1/retries=0，总 2 分钟），1939/TNO 后续网络断言均执行且为 0，golden PNG 后续样例切换/脏状态弹窗断言也执行。诊断落盘调整后额外单跑 1939 1/1 确认实际文件；没有重复未变的五视口布局或全套 GPU 检查。提交后仍需等最终 head 的不部署 CI 终态，不合并、不部署。

2026-10-17：整合副本为 `C:/Users/raede/Documents/Codex/2026-10-17/task-9/scenario-forge-final`，独立工作区和 Git index，detached HEAD 为已核实 main。Git 对象经 clone 只读借用 task/scenario-forge-raster 对象库；不清理来源副本。用户主目录 `C:/Users/raede/Desktop/dev/mapcreator` 未写入。

来源补丁按顺序应用：

- task-5/scenario-forge-integrated/.runtime/reports/generated/scenario-forge-all-integrated.patch，SHA256 `17be2cc26fa9ea3fe44a8a14d04f8f2ae45ab16cabb5c5806d5b4223a3f30351`。
- task-8/scenario-forge-rollback/.runtime/reports/generated/scenario-rollback-river-paint.incremental.patch，SHA256 `f8d373b07323df5ae9de1d99436ec9766005cb0d70154b3ae9d2dbbf3e42ea17`。
- task-6/scenario-forge/.runtime/reports/generated/dynamic-import-recovery.incremental.patch，SHA256 `afd6718e23d900f8272b12828dc4e3796681fe23a1ffc1d13a6dd1e479da1ad0`。

各来源均在 `C:/Users/raede/Documents/Codex/2026-10-17/` 下。三份补丁正向检查和应用通过。回滚增量无路径交集；动态增量与主补丁交集为 deploy.yml、pr_plan.mjs，顺序应用无冲突。组合独立审查 PASS WITH NOTES：没有阻止整合的缺陷；模块恢复只改 verifier，不改生产加载器，历史根因仍未知。新的 browser lane 已登记，失败证据与恢复成功证据均保留，计时包含失败尝试和等待。

检查 owner：本任务 /root，工作目录为本整合副本。短 Node/Python 单元检查不共享 live server。浏览器 fixture 命令为 `node node_modules/@playwright/test/cli.js test tests/e2e/raster_startup_recovery.spec.js --workers=1 --retries=0 --grep "recovers one evidenced|persistent module|evaluation error|syntax error"`；用 `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:1` 关闭默认应用服务器，每项 fixture 自选临时 localhost 端口。浏览器缓存只读复用已安装的 AppData/Local/ms-playwright。日志 `.runtime/reports/generated/final-integration/`，浏览器产物 `.runtime/tests/playwright/`。进程退出即成功/失败终态；只由 owner 轮询或停止。

下一步：运行上述必要定向检查并保存精确结果；等待用户/父任务交付 sample-guide 补丁路径，再审查整合。未收到前禁止最终 PR；不得合并或部署。

组合检查：rollback 12/12、CI selection/lanes 16/16、workflow evidence 2/2 通过。组合 52 个产品/CI 文件与相应来源逐文件 LF 归一字节完全一致，记录为 `.runtime/reports/generated/final-integration/source-byte-audit.json`。PR 规划覆盖 56 路径（含四个留档文件），planned、0 unmatched、0 route gaps。

浏览器首轮默认缓存指向沙箱 AppData，找不到 Chromium；第二轮明确指定 `PLAYWRIGHT_BROWSERS_PATH=C:/Users/raede/AppData/Local/ms-playwright` 后 Chromium 可启动，但四项均在 localhost 导航阶段被 `net::ERR_NETWORK_ACCESS_DENIED` 阻止，未触达被测模块。保留两轮日志与 trace，不计为产品失败。基于这一新环境证据，仅将同一组定向检查提升到可访问 localhost 的执行环境，输出隔离到 `.runtime/tests/playwright/final-integration-elevated/`、日志 `startup-recovery-elevated.log`；同时选择无浏览器的原恢复谓词检查，不放宽任何断言。

提升执行后的定向浏览器检查 5/5 通过，9.5 秒、workers=1、retries=0；全部检查合计 35/35。真实模块 503 一次恢复、持续 503 两次后失败、语法/执行错误单次失败、同源/阶段/HTTP 证据/Retry-After 谓词均符合预期。五份 startup trace 均有非空 `.network`。精确摘要为 `.runtime/reports/generated/final-integration/verification-summary.json`，独立审查说明为同目录 `final-integration-status.zh-CN.md`。

当前现场：无运行中的本任务服务器或测试；HEAD 仍 detached main，尚无分支、提交、推送、PR、远端 CI、合并或部署。sample-guide 补丁缺失是最终 PR 的唯一待办前置条件，不是执行权限拒绝。下次收到路径后先读报告和 patch、核实基线及路径交集，再应用并做必要验证；最终推送前重新核对远端 main。需要提交时先应用 write-lore-commits 技能。不得将旧公网数据资源 503 描述为动态模块故障的已证根因。

继续阶段（覆盖上一段现场）：父任务交付第三项 patch 并授权继续最终 PR。sample-guide patch SHA256 `f7ce351fa06ba7dcfaf8678301d0d0ea62fe9e7696e956fbfd2125ff3c3ea59d`，仅 `tests/e2e/sample_guide_deeplink.spec.js`，无现有路径交集；已审核并应用，产品/CI/测试并集 53 路径（加留档共 57）。来源成功 trace 独立检查确认真实高级设置点击和移动端抽屉导航、10 次原阈值布局测量 148–180.53125px、重叠均零，无实际 browser API 或终态错误。expect.poll 内部 pending 尝试不算用例失败。证据 `sample-guide-independent-review.json`。

来源 golden 失败 trace 的两条 console warning，location 为 app document line 0，无 JS 堆栈，文本为 Chromium 原生 GL Driver Message / GPU stall due to ReadPixels；PNG 签名/下载断言在 console 断言之前均通过。当前源码显式 `readPixelsForValidation` 只被 prototype oracle 调用，不能据此归咎生产回滚/测试改动，也不能证明全部为无害环境噪声；WebGL 到 Canvas2D 的合成可涉及驱动内部读回。PR 如实保留未通过项，未改 console 门禁，后续以 hosted CI 终态验证。原始提取证据 `sample-guide-source-gpu-evidence.json`。

最终推送前 ls-remote 再次确认 main 仍为 `5fbbfdcff`，拟用远端分支不存在。本副本已创建 `codex/sc-batch-review-20261017`。下一步按已读取的 write-lore-commits 准备明确范围的提交，单一 PR，跟踪不部署 CI；不合并、不部署。

首轮提交 `54ac5ce09041f24cc5119f96da21cc4b45a18af2` 已推送并创建 [PR #244](https://github.com/raederhans/scenario-forge/pull/244)。HGO、五个场景合同和 Transport 成功。首轮 CI 确认四个本批组合遗漏：smoke 在测试前被 59/60 spec 数量/漏登记拦住；fast 的北美新测试缺 heavy grouping；Quick Fill 的 checked-in import graph 陈旧；TNO raster release native-reference 在新默认启用策略下 `requested=true`。日志为 ignored final-integration 目录的 `pr-smoke-first.log`、`pr-fast-first.log`、`quick-fill-first.log`、`raster-release-first.log`。不归咎 GPU 告警；不重跑原失败 head。

修复：把新增 spec 精确登记为 browser regression，manifest count 改为实际60并同步 all/regression 清单，固定四个 smoke spec不变；北美测试登记 geo_stack；重建原 import graph；native oracle 会话显式 `political_id_raster=0`，原 requested=false、无下载、像素和恢复断言不变。新增真实 Chromium fixture 回归检查实际导航参数，避免把自动栅格帧作为原生参考。53 个来源文件中的 verifier 和 recovery spec 因此有明确本地修正，其余仍与来源相符。

新增本地 browser fixture owner 仍为 /root，工作目录同上；命令 `node node_modules/@playwright/test/cli.js test tests/e2e/raster_startup_recovery.spec.js --workers=1 --retries=0 --grep "native reference startup" --output .runtime/tests/playwright/native-reference-startup`；使用原显式浏览器缓存与 dummy base URL，fixture 自选 localhost 端口，日志 `.runtime/reports/generated/final-integration/native-reference-startup.log`。退出码为终态，没有其他本地测试/服务器共享端口。后续跟踪 PR 的新 head，不合并、不部署。

CI 定向修复本地验收：新增真实 browser fixture 1/1 通过（2.1秒），生成清单路由回归1/1通过，总本地行为检查37；E2E 精确60项/固定4项smoke列举、103项heavy分类、409项发现命令覆盖、75项spec导入图、timeout guardrails、syntax/diff-check通过。最终规划还发现生成all/regression清单缺路由，已把test-lists目录交给原精确层级完整性检查，保留fail-closed契约。未重复完整像素场景。最终64路径规划planned、0 unmatched、0 route gaps；首轮失败日志均保留在ignored目录。
