# TNO startup support sampling harness 2026-04-13

## 目标
- 增加多样本采集器，自动跑默认启动的几组关键交互
- 为 startup support key-usage 提供更多真实样本
- 仍然不修改正式 support 文件

## 实施清单
- [x] 建立留档
- [x] 梳理可复用的启动交互选择器
- [x] 实现采集脚本并生成额外样本
- [x] 重跑 whitelist generator 并复核
- [x] 归档

## 进度记录
- 2026-04-13：新增 `tools/capture_startup_support_sample.js`，支持样本参数：
  - `--language`
  - `--sample-label`
  - `--mode` (`default` / `alias-probe` / `city-probe` / `tooltip-probe` / `inspector-probe` / `full`)
- 2026-04-13：新增 `startup_support_audit_label` 查询参数，支持多样本 key-usage 报告并存。
- 2026-04-13：真实采样已完成：
  - `en` 默认 startup
  - `zh` 默认 startup
  - `en-alias-probe`
  - `en-tooltip-probe`
  - `en-inspector-probe`
- 2026-04-13：已基于 5 份样本重跑 generator，并顺序重跑 shadow candidate materialization。

## 本轮验证
- `node --check tools/capture_startup_support_sample.js`
- 真实启动采样（Playwright headless + 本地 dev server）
- `python tools/generate_startup_support_whitelist.py ...`
- `python tools/materialize_startup_support_candidate.py ...`

## 结果摘要
- 多样本合并后 whitelist 候选：
  - `candidate_locale_key_count = 342`
  - `candidate_alias_key_count = 222`
- shadow candidate build 结果：
  - locales：`44170 -> 342` keys，`3.71 MB -> 127 KB`
  - aliases：`48351 -> 222` keys，`2.44 MB -> 9.5 KB`
- 当前 recommendation 仍保持：`ready_for_direct_prune = false`

## 结论
- 现在所有**离线准备工作都做完了**：
  - runtime key-usage capture
  - 多样本保存
  - whitelist generator
  - shadow candidate build
- 但还不能直接改正式 support files，因为当前样本虽然已经比之前强很多，仍然主要覆盖默认启动和少量关键交互，还没达到“正式裁剪白名单”的稳态。
