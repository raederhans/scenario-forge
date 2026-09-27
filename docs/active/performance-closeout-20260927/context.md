# 整合上下文

- 主工作区：C:/Users/raede/Desktop/dev/mapcreator，main 28310add，含多项混合 WIP；没有 reset、stash、提交或清理。
- 整合工作树：C:/Users/raede/.codex/worktrees/performance-integration/mapcreator，codex/performance-closeout-20260927，基线 b4f9089c。
- 来源：主工作区 .runtime/reports/generated/performance-implementation-20260927 与 performance-phase2/3/4-20260927；仅提取报告对应 42 个源/测试文件的 HEAD→工作区补丁。
- 三方合并保留最新 marine 显隐/交互与 coverage cache，保留最新 UI 默认值。water overlay 测试同时保留远端 coverage 验证和性能工作计数。
- 主代理是唯一 Git、测试、浏览器和服务 owner。三个子代理只读审阅最终 startup/cache、water/hit、transport/export。
- 主代理运行 npm run verify:pr，cwd 为整合工作树，日志 .runtime/reports/generated/performance-closeout/verify-pr.log；成功条件 exit 0，失败后按首个有效失败定位，不扩大阈值。
- 目标 Node 246/246、相关 Python 边界 16/16 通过。扩展跑完整 toolbar Python 类时有 4 个旧字符串断言失败与 1 个旧位置查找错误，相关改动方法本身通过；需核对基线及实际 PR 路由。
- 完整 toolbar 类的相同五项失败已用 b4f9089c 原测试源码复现，属于现有未选入此次相关验证的旧契约。
- verify:pr 的前置结构/脚本/严格剧本检查通过，adaptive 在 chunk 契约停下：源码正则仍匹配旧参数。同步十处严格签名/传参断言后，chunk 契约 79/79 通过；没有弱化安全部件或 Atlantropa 链路断言。
- startup/cache 与 transport/export 子代理审查未发现阻断项。准备提交并创建草稿 PR，本地剩余检查和运行时验证仍须完成。
