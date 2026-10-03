# 当前状态

## 2026-10-03 审核与交付

用户已授权审核、合并和推送三轮改动。整合最新主线 `14234669` 时，启动 Worker/client 采用 PR #202 已落地的整消息 `geo-f64-v2` 传输；本轮单独启动 topology transport 被该更完整实现覆盖，不重复保留。快速 topology 解包仍用于现有边界 Worker 的模块 codec。取消、真实 buffer detach、原始对象不变、错误后下一任务恢复测试适配主线格式并通过。

审核未发现剩余阻断问题。整合前 145 项目标 Node 通过；整合后启动相关 24 项通过（修正两个旧格式/跨 realm fixture 断言后受影响 6 项通过），15 项 Python 边界、架构及导入图通过。历史浏览器性能数字仍对应整合前数据版本，不能冒充海域更新后的重新基准。审核结论 PASS WITH NOTES：无已确认阻断缺陷，整合后性能数字未经重新基准。已提交并推送，远端检查及合并状态以 [PR #203](https://github.com/raederhans/scenario-forge/pull/203) 回执为准。

隔离工作树继续保留原始 CPU、浏览器及构建证据；主目录和其他工作树 WIP 不变。

CI Quick Fill 的状态写入检查发现 styled-select 和既有 UI i18n 测试直接修改应用单例。两者改用现有 `setCurrentLanguage` / `applyBaseLocalizationSnapshot` 初始化及恢复，保留行为断言；不修改写入白名单、policy 或扫描器。相关 6 项测试、状态写入检查与导入图已通过。

整合后不再需要 classic/module 共用 topology codec，因此移除该新增全局包装，保留既有 ESM codec 的定长数组解包优化；避免留下无使用者的传输阈值和兼容分支。

## 原始实施阶段记录

第三轮本地实现、目标验证和两组串行对照已完成。分支 `codex/performance-round-20261002`，所有改动尚未提交、推送或发布。

TNO 100%→200% 缩放后，后台完整背景收尾从 3.10–3.23 秒降至 1.04–1.14 秒，新建路径从 11788–11908 降至 840；复用旧完整缓存的 11139 条路径，不回填 LRU。数据代次仍约束异步任务和完整发布，单条几何路径在投影签名及 geometry 引用相同的条件下复用。

exact 排序修复消除了约 20 ms 的重复 snapshot 扫描；完整精确刷新仍约一秒，尚无稳定加速。下一项结构性证据应定位 political Worker 内部分项，不能凭主线程等待直接改 Worker 算法。

115 项不同 Node、14 项 Python、architecture boundary、test import graph、diff 检查通过。静态审查未发现实质问题。两组候选浏览器无 error/warn，重复样本地图截图对照一致；首候选压缩截图有小幅差异，来源未定，不宣称全画面像素等价。

详细数字、测量边界和残余问题见 `.runtime/reports/generated/performance-round3/results.md`。本轮服务器和浏览器页面已关闭。
