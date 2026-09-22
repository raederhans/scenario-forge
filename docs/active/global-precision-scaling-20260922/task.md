# Task

## Current status

最新完整现代世界候选已推进到 national-v4：41处实质外国边界重叠已按保留邻国显示域处理，3,144县、20分片LOD与严格剧本契约通过；481个稳定旧县ID的项目迁移已接入，9个歧义/非法旧ID显式拒绝。非US10,804地块与印度718保持。六剧本历史域分区候选已运行，支持的侧车适配6/6通过，候选新归属已独立核对；这些历史候选尚不是完整可发布bundle。详细数据见 major-countries-results.md 和 context.md，下面旧阶段记录保留作过程证据。

## Continuation checklist

### Full US county continuation

- [x] 用户取消旧约 900 区域约束；印度保持现有颗粒度与源。
- [x] Census TIGER/Line 2025 + CB 2024 显示范围生成 50 州和 DC 的全部 3,144 个县及等同单位；共享边界简化，native 全国 coverage 通过。
- [x] 来源报告绑定显示文件 SHA256 和完整逐州 GEOID；拒绝缺县/源文件漂移；构建成功后才原子发布候选目录。
- [x] Modern World 暂存替换、归属/核心、城市/首都 host、邻接、coarse/detail 分块与原严格数据契约通过。
- [x] 独立数据审计：10,804 个非 US 区域逐 ID 几何/属性/归属保持，含印度 718 个；3,144 个美国 ID 与来源完全一致。
- [x] 真正的 bootstrap 壳层从上一暂存实现 47,874,123 B 降至 307,884 B；美国详细几何 20 块，gzip 总 10,031,108 B，最大单块 746,354 B。不能据此宣称浏览器 FPS 改善。
- [x] 全国浏览器实测 Chase County 着色、撤销、重做、再撤销；startup locales/aliases HTTP 200，无 404/500。
- [x] 按州/Quick Fill、sidebar、releasable 和 parent-border 五消费者使用场景内新县 ID；无覆盖时返回原 hierarchy，切换/清空/回滚恢复。28 项 Node 行为测试通过；真实 manifest 的 51 组/3,144 IDs 精确匹配来源；浏览器 State 下拉、双击 Chase County 按州填充和一次撤销通过。
- [x] 41处外国显示接缝与20个美国whole-shard混合LOD门禁通过；残余约1e-15deg2浮点面积保留报告。
- [x] 旧项目迁移显式绑定source/target baseline；覆盖稳定ID、成员集合与唯一空间anchor，拒绝歧义后不修改当前项目。
- [ ] 历史候选完整bundle、少量原域例外和更广泛目标设备/视觉验收仍未完成；不把候选分区等同发布。

全国候选：`.runtime/reports/generated/us-county-national-v2/modern_world/`；数据审计：`.runtime/reports/generated/us-county-national-audit.json`；严格契约：`.runtime/tmp/us-county-upgrade/national-contracts.json`。本轮 source 11 + stage 12 项目标测试通过。旧 Connecticut `US_CNTY_09120` 自交仅列为旧项目迁移未决项，不虚构修复面积或 nearest 归属。

性能边界：显示坐标减少 86.34%，bootstrap 原始字节减少 99.36%（相对本轮被替代的全几何暂存 bootstrap）；这些不等于 FPS 收益。全国视图 Nebraska 93 县双击填充的单次稳态帧为 607.4 ms，政治层 585.7 ms，编辑逻辑 29.3 ms。提高 dirty-count 预筛但保留空间/覆盖/cache 预算的试验未改善该实际用例（复测 754.4 ms），因此补丁与实验测试均撤回，原预算不变。后续必须先采集 partial fallback 的实际原因和背景缓存成本，不能仅改阈值或把尚未绘制完的旧帧当成优化结果。

- [x] 印度显式读取主 checkout 已有源，校验 ledger/provenance 摘要，不下载、不虚构许可状态。
- [x] 中印美生成 254/13/53 个稳定 ID 的局部候选；保留有歧义的原地块，不猜历史分割归属。
- [x] 验收器支持稳定目标 ID，并拒绝陆地覆盖损失、owner domain 漂移、目标 owner 缺失、重叠增加与 sidecar 漂移；19 个目标回归通过。
- [x] 消除 TopoJSON 最长弧段 padding；49 个解码/构建目标检查通过。
- [x] 同输入日本完整构建 peak working set 17.40 GB -> 2.39 GB（-86.25%）；所有生成 JSON 字节相同。
- [x] 生产 composite/single-layer/bake 入口等待 detail 提交；12 个新增行为测试及 63 个既有 LOD/chunk 检查通过。
- [x] 浏览器真实 PNG 生成通过（原生下载回执未取得）；早期预览路由未拦截 `/app/data/`，该次仅证明当前代码的导出，不能当作新数据验收。
- [x] 合并 JP/CN/IN/US 共 367 个精度目标，完成 staged chunk/owner/mixed-LOD 验收；208 chunks，42 组混合 LOD 全通过，gzip 总量 +898,324 B。
- [x] 修复显式目标仍使用整国精度标记的遗漏/膨胀问题；22 个区域/大国/显式 LOD 检查通过。
- [x] 修复布局交互与启动首帧断言的时序竞争；6 个支持模块行为检查和 5 个启动边界检查通过，原首帧失败断言保留。
- [x] 正确预览路由下，组合暂存 ready、首帧已绘制、错误为空；临时 family 从 regional 切至真实 staged detail，47 日本 IDs / 12,428 坐标，无待提交。页面和预览服务已关闭。

## Checklist

- [x] 建立东欧缝隙分类器和回归样本；对缺少唯一归属证据的真实空洞停止自动修补。
- [x] 建立四大国精度来源/ID/成本矩阵，并完成日本端到端暂存试点；其余国家按真实 blocker fail closed。
- [x] 完成性能低风险阶段及目标验证。
- [x] 完成性能中风险阶段及真实数据成本验证。
- [x] 形成高风险阶段 no-go 决策包，不实施高风险改造。
- [x] 完成共享契约、浏览器/运行时与差异范围验收；因 canonical `data/` 未修改，不需要 catalog 再生成。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` | baseline `382ce56744d3942a9097e1352c312a23bab0dbf9` |
| managed worktree creation | `precision-expansion-20260922`, registration succeeded |
| `node --test` precision scaling + geometry raster kernel | 50/50 passed |
| `python -m unittest tests.test_political_display_lods tests.test_tno_russia_precision tests.test_tno_russia_interface_noding -q` | 17/17 passed |
| `python -m unittest tests.test_data_catalog_contract -q` | passed |
| `python -X utf8 -m pytest tests/test_tno_east_europe_gaps.py tests/test_tno_major_country_precision.py -q` | 19 passed |
| performance focused Node suites | 111 passed in agent-owned full run; independent review reran 17 focused tests and passed |
| final root rerun: five focused performance suites | 33 passed |
| final root rerun: regional precision + political display LOD + catalog contract | 29 passed |
| JP full staged scenario build | exit 0; 208 chunks; gzip chunk bytes +354,023; peak working set about 17.4 GB |
| `tools/validate_tno_precision_expansion.py` on JP stage | `invariants_pass_visual_review_required`; 47 targets, 4 mixed-LOD checks, 0 failures |
| JP staged browser smoke | JAP detail chunk HTTP 200; 47/47 target IDs loaded; console 0 errors/0 warnings; no failed request |
| precision tool independent review | final PASS after stable-ID membership and output-boundary fixes |
| performance diff independent review | PASS WITH NOTES; no blocker, production exact-consumer gate retained |
| `git diff --check` | passed; only existing Git LF-to-CRLF working-copy warnings |

## Open risks and remaining work

- 东欧几何空洞已与仅渲染发丝线分开；但水体/历史归属和唯一 recipient 未证明，不能安全自动填补。
- 中国部分 owner domain 仍有真实 overlap；印度来源已恢复为显式读取并验证，但 ledger 的 upgrade/license review 未完成；美国历史 split/zone ID 仍缺权威 lineage。局部候选不等于全量国家已完成。
- PNG/bake 已接入 detail readiness 并有真实 family promotion 探针；生产 LOD manifest、完整 bake-pack、逐区域点击/撤销与目标设备 FPS/heap/settle 验收仍待完成。
- 四国组合状态为 `invariants_pass_visual_review_required`；部分目标与未升级邻区的所有视觉接缝、历史边界尚未完整验收，不宣称全世界无缝或可直接发布。旧 combined-v2 因 BRM 混合 LOD 失败已拒绝；有效结果是 combined-v3。
- 日本同输入构建峰值已从约 17.4 GB 降至约 2.39 GB；未宣称浏览器 FPS 或 heap 改善。改动仍未合并主线、推送或发布。

## Integration validation (2026-09-22)

本轮用户授权提交、合并和 GitHub Pages 更新。交付分为候选处理工具、运行时与 Pages 镜像、验收留档三个提交边界；正式 data 未变。后续 GitHub 合并/部署以 PR 和 Actions 回执为准，不能把以下本地检查理解为线上发布证据。

- 定向 Python unittest 82 项通过；补充 pytest 同时收集函数式测试，108 项和 14 个 subtests 通过。
- 定向 Node 121 项通过；只读审查未发现阻断项，其补充 59 项检查通过。
- 渲染重复 summary 收敛后，32 项行为与 4 项边界通过；详细导出新增调用者的 38 项分块边界通过。
- 为新工具和运行时行为补充 13 条精确测试路由，路由 schema 与 3 项路由行为检查通过；既有 11 条精度/延迟路由的排序及浏览器归属保持。
- 最终 canonical Pages 构建完成，产物 548.91 MiB；64 项 Pages 发布契约通过。候选几何和历史分区补丁仍只存在于 .runtime。
- 合并检查中的新代码问题已修复，未放宽架构规模、提交边界、性能或数据校验。

保留 precision-expansion-20260922 工作树用于尚未完成的历史边界与完整 bundle 适配。主工作区既有 .playwright-mcp/ 不属于本次改动。

最终本地 PR 分阶段检查通过：前置架构/契约等门禁通过，修正元数据后的 adaptive 阶段 125/125 执行命令通过；88 个 main-thread 命令按策略延期，未声称已在本地执行。远端 PR 必需检查与 Pages 部署仍需按对应提交读取回执。
