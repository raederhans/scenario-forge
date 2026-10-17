# 处理状态

- [x] 独立副本、远端 main、三份补丁哈希及 AGENTS.md 核对。
- [x] 应用 46 文件整合补丁，未使用 REJECTED 补丁。
- [x] 独立审核并无冲突应用回滚与模块恢复增量。
- [x] 组合后的必要定向检查 35/35；PR 规划 planned、0 unmatched、0 route gaps；52 文件来源字节一致。
- [x] 收到并审核 sample-guide 文字层高度修复补丁；真实按钮/抽屉流程和来源成功 trace 验证通过。
- [ ] 最终提交、单一 PR、最终 head 的不部署 CI 到终态。

本文件记录提交前验收基线。当前功能分支为 `codex/sc-batch-review-20261017`；统一 PR 与最终 head 的不部署 CI 结果以 GitHub PR/Actions 回执及本地 `.runtime/reports/generated/final-integration/` 交付报告为准。不得合并或部署。

验证日志和精确命令见 `.runtime/reports/generated/final-integration/` 与 context.md。浏览器两轮沙箱环境失败保留；调整缓存路径并提升到可访问 localhost 的环境后，原定向检查 5/5 通过，未改断言。语法/执行错误不重试，持续 503 恰好两次启动；五份失败诊断 trace 均保留非空浏览器网络记录。未重跑此前已通过且内容未变化的全套验证。

sample-guide 单一文件增量通过 apply-check、syntax 和来源 LF 字节比较。独立读取来源成功 trace，确认高级设置真实点击、五视口两个入口的 10 次测量均非零高度且无重叠，保留作者 1/1 成功证据，未重复 111 秒用例。来源额外 golden PNG 用例下载和 PNG 断言已通过，但两条原生 WebGL ReadPixels 性能告警使严格 console 断言失败；该用例仍为未通过，没有过滤或放宽门禁。
