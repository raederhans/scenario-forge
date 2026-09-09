# 执行结果：部分验收通过

已落实最新 V0–V3 计划的当前改进切片；严格视觉验收仍有 1 个未解决差异，不能标记全部完成。

- [x] V0：river rank 0、city opacity 0 保留真实零值；目标 Node 与真实 Canvas owner 浏览器用例通过。
- [x] V1：建立普通模式的有限启动、代表性视口、独立场景往返差分；记录源码/资产身份、实际视口、DPR、复用和精确重绘、首个不同 pass 及失败图。
- [x] V2 已定位修复：数值 geoPath→Path2D 取代 SVG 舍入；geometry 引用身份统一校验；修复异步 infra 恢复后缺重绘、chunk 最终 flush 时仍持锁、启动 full-infra 颜色重建后缺重绘这三个调度缺口。
- [x] V3 当前范围：25 个来源明确的历史城市 stable key 迁移；城市/机场/港口共享避让与 DPR sprite。真实 DPR 1、1.25、2 的缓存复用、显隐、resize、导出裁剪对照通过。
- [ ] V1/V2 剩余：TNO 欧洲 300% 稳定视口的政治 pass 和最终画面各 1 个像素不同，最大通道差 1。无阈值放宽、无未审查 golden，严格检查保持失败。
- [x] 整合检查、结果记录、自建服务器停止；代码尚未提交或推送。

## 最终源码浏览器结果

命令：node node_modules/@playwright/test/cli.js test tests/e2e/dev/normal_visual_paths.dev.spec.js --workers=1 --retries=0

最终日志：.runtime/browser/visual-correctness/v1-final-source.log。总计 3 passed / 1 failed（6.9m）。四个用例 pageErrors 均为 0；所有已比较对的 identityStable、cacheReused、referenceRedrawn 均为 true。

| 用例 | 结果 | 覆盖 |
| --- | --- | --- |
| tno_1962 | FAIL | startup 0；Europe region 1 pixel |
| hoi4_1936 | PASS | startup、English Channel 均 0 |
| modern_world | PASS | startup、dateline 均 0 |
| tno_1962-switch | PASS | startup、TNO→Modern→TNO 返回后政治对照均 0，B 有实际数据 |

对应报告位于 .runtime/browser/visual-correctness/v1/<case>/report.json。场景往返证明返回 A 的普通缓存与精确重绘相等，并非独立初始 A 与返回 A 的直接像素等价。检查覆盖 settled 帧，不包含交互降级质量或原始地理语义真实性。

Modern 记录两个可选启动本地化资源 404，走已有空默认 fallback；未把它记为全部资源完整。其他最终用例无网络失败。

## 其他实际验证

- V0：owner-semantics.log/json，真实 opacity/rank 零值与 DPR sprite。
- V3：shared-labels/report.json、shared-labels/dpr-1.25/report.json、shared-labels/dpr-2/report.json。实际 DPR 2 经测试调用生产 presentation owner 应用 full 提示，未改变产品 DPR 上限。
- 相关 renderer、名称与标签 Node 行为测试、城市和政治 Python 边界检查通过。
- 异步 infra：scenario_refresh_plans_behavior + scenario_deferred_infra_lifecycle_behavior 24/24。
- 提交锁：新增 scenario_chunk_promotion_render_lock_behavior 4/4；现有 quick/cancellation 66/66。
- 最后启动修复：startup_interaction_lifecycle_behavior 4/4，由主代理实际执行。
- git diff --check 通过。以上为本地目标验证，未运行 CI 或发布门禁。

## 未解决差异及范围

独立四候选路径重放、显式 CTM/style、drawImage/clip 观测及单纯 willReadFrequently 策略都未解释 TNO 最后一个像素。逐步读回会改变结果，具体栅格/合成机制仍未定位。没有保留无收益的临时 Path2D miss 构建和完整 transform 签名试验。

诊断 JSON 留在 .runtime/browser/visual-correctness/political-pixel-diagnostic*.json；临时测试源码已归档为 political_pixel_diagnostic.source.js（原测试路径下的源代码存档），不加入常规测试集。

名称仅迁移 25 个明确键；全量新优先级可能影响约 31719 个 TNO 语言级结果，未审查名称仍沿用旧行为。道路/铁路标签不属于本次城市/机场/港口共享布局切片。

主代理独占服务器、浏览器与 renderer 主壳；子代理负责隔离模块和目标回归。更完整的证据及交接见 context.md。

## 提交与合并

用户于本轮验证结果说明后明确授权提交、推送和合并。当前集成分支为 codex/visual-correctness-v0-v3-20260909，基于与 origin/main 一致的 8ed56525。PR 将保留单像素检查失败和部分验收状态，并按仓库要求同步 canonical Pages dist。main 合并须通过六项远端必需检查；合并会触发既有 Pages 工作流。

PR #129 首轮 CI 集成修复：TNO 资产快照未包含新增名称，已通过现有 snapshot/audit 构建函数同步三处身份字段，第二次生成字节不变，strict scenario 检查通过。旧 Python 结构断言要求 flush 后恢复锁，已对齐为 currentness 检查后先恢复锁、再按 renderNow 条件 flush；38 项契约检查通过。未改变运行时源码或视觉阈值。

PR 综合验证续修：更新重型 chunk 契约的旧 SVG/path-only 缓存断言，以及 marker pass 纯委托断言，保留数值流构建、geometry identity、candidate reset→labels invalidation→owner delegate 的明确约束。完整 chunk 契约79/79、pipeline边界5/5通过；按PR变更选择的81组本地可执行命令已全部通过（先77组，再修正失败项并续跑剩余4组），route gap为0。59组主线程命令按原选择器规则deferred，不作为本地通过声明。
