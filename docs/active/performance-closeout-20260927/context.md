# 整合上下文

- 主工作区：C:/Users/raede/Desktop/dev/mapcreator，main 28310add，含多项混合 WIP；没有 reset、stash、提交或清理。
- 整合工作树：C:/Users/raede/.codex/worktrees/performance-integration/mapcreator，codex/performance-closeout-20260927，基线 b4f9089c。
- 来源：主工作区 .runtime/reports/generated/performance-implementation-20260927 与 performance-phase2/3/4-20260927；仅提取报告对应 42 个源/测试文件的 HEAD→工作区补丁。
- 三方合并保留最新 marine 显隐/交互与 coverage cache，保留最新 UI 默认值。water overlay 测试同时保留远端 coverage 验证和性能工作计数。
- 主代理是唯一 Git、测试、浏览器和服务 owner。三个子代理只读审阅最终 startup/cache、water/hit、transport/export。
- 主代理运行 npm run verify:pr，cwd 为整合工作树，日志 .runtime/reports/generated/performance-closeout/verify-pr.log；失败后按首个有效失败定位，不扩大阈值。
- 目标 Node 246/246、相关 Python 边界 16/16 通过。扩展跑完整 toolbar Python 类时有 4 个旧字符串断言失败与 1 个旧位置查找错误，相关改动方法本身通过；需核对基线及实际 PR 路由。
- 完整 toolbar 类的相同五项失败已用 b4f9089c 原测试源码复现，属于现有未选入此次相关验证的旧契约。
- verify:pr 的前置结构/脚本/严格剧本检查通过，adaptive 在 chunk 契约停下：源码正则仍匹配旧参数。同步十处严格签名/传参断言后，chunk 契约 79/79 通过；没有弱化安全部件或 Atlantropa 链路断言。
- 三个专项子代理均未发现阻断项。PR #178：https://github.com/raederhans/scenario-forge/pull/178。
- PR 前置检查通过；adaptive 最初被旧参数契约阻断，同步 chunk 与 water-hover 函数签名后分段续跑，99 个选定执行组全部通过。日志：verify-pr.log、node-targets.log、chunk-contracts.log、adaptive-remaining.log、adaptive-final.log，均在上述输出目录。首次整条 verify:pr 的退出码仍为失败，不能把分段结果称为原命令 exit 0。
- 整合浏览器检查：TNO/HOI4 稳定输入、TNO→HOI4→TNO 切换、真实剧本导出预览共 4/4 通过（browser-stable.log）。繁忙输入的固定延迟调度不能证明渲染任务已开始，改为稳定基线后等待渲染端启动信号，保留原有 EventTiming 重叠断言；最终结果另见 browser-busy-signal.log。
- CI 首轮发现新增水域 history 测试直接写 singleton 状态。改为模拟水域查询、经 history API 恢复颜色；8 个相关测试和 state-write-allowlist 通过，未增加允许名单。输入证据分类 7 项测试、测试 timeout/console guardrails 也通过。
- 最终受控繁忙输入 TNO/HOI4 两项通过（browser-busy-signal.log），选择、填色、撤销、重做均有 EventTiming 排队与指定渲染任务重叠证据。浏览器检查合计六项通过；没有把自动化动作耗时或单次本地采样当作端到端提速比例。
- 远端合并须等待最终提交的必需检查，使用普通 merge，不绕过分支保护。主工作区保持未同步，最终回执写回主工作区 registry；整合工作树保留运行证据。
