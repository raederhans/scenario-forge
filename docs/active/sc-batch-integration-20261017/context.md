# 恢复与交接

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
