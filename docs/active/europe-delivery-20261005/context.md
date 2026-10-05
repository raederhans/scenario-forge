# 交接上下文

- 唯一 Git integration owner：当前主代理。分支 `codex/europe-land-gaps`；工作区 `C:/Users/raede/.codex/worktrees/europe-land-gaps/mapcreator`。
- 主工作区 `C:/Users/raede/Desktop/dev/mapcreator` 含大量其他任务 WIP，保持只读，不 stash/reset/checkout。
- 初始 HEAD：`f47b36f413ec4787042cbe12420122ed2135d180`；本次 fetch 的 main：`a1be99c6d`。
- 本分支此前为未提交的完整区域修复及资产优化，runtime 103,264,414 B，coarse 50,776,489 B，具体证据在 `.runtime/reports/generated/asset-size-20261005/`。
- 主线在相同生成文件中还包含南亚、加拿大及水域更新。子代理只读比对三方数据与代码；主代理负责候选合成、所有 Git mutation、构建和测试。
- 运行材料：`.runtime/tmp/europe-integration-20261005/`；日志/报告：`.runtime/reports/generated/europe-integration-20261005/`。
- 长进程约定：主代理单 owner，所有 builder/Pages/checks 在本工作区串行使用各自命名 output/log；退出 0 且相应断言通过为成功条件，非零先分析再有限修复，不重复同假设失败。子代理不得启动相同构建或端口。
- Worktree 保留原因：后续整合验证仍依赖本地修复候选、数据基线与恢复材料；不在交付中丢弃这些 ignored 证据。
