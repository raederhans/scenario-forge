# Plan

## 2026-09-23 continuation

The user requests implementation with CI and subagents toward a 2026 release: complete remaining continental European countries and CN/JP/US migration, preserve India's accepted district source/granularity, and assess CA/MX only when inexpensive. The earlier exploration-only/no-PR scope below records the original phase; this continuation includes branch commits, a reviewable PR and CI. Production publication remains a separate final action after concrete data, compatibility and performance evidence is available.

Execution order: (1) inventory canonical versus staged country coverage and current CI failures; (2) complete fail-closed historical county bundle assembly and the missing scenario CI lanes; (3) build feasible candidates and check strict contracts, domain preservation, ID migration and resource cost; (4) validate actual staged browser behavior and performance; (5) submit the verified increment to CI, record country-specific unresolved source/domain decisions. Do not replace uncertain historical ownership, mask inherited geometry failures, enlarge repaint/cache limits, or label local candidates as released data.

## Goal

在不破坏 TNO 1962 现有 ID、归属、编辑、撤销、存档与导出契约的前提下，推进三条有关但可独立验收的工作线：修复东欧内部可证明的数据缝隙；为中国、日本、印度、美国建立并落地可复用的精度提升路径；完成性能方案的低风险和中风险阶段，并对高风险阶段给出证据化 go/no-go 建议。

## Scope

- 东欧：俄罗斯、乌克兰及相邻内部边界的缝隙分类、可重复审计、候选修复和目标验证。
- 大国精度：中国、日本、印度、美国的来源映射、ID lineage、候选构建、拓扑/覆盖门槛和受控接入。
- 性能：低风险预算与诊断强化；中风险 LOD/分块/视口消费优化；高风险架构改造仅评估，不实施。
- 所有一次性产物写入 `.runtime/`，源数据变更遵守 `data/AGENTS.md`。

## Sources of truth

- `data/scenarios/tno_1962/detail_chunks.manifest.json`
- `data/scenarios/tno_1962/context_lod.manifest.json`
- `data/scenarios/tno_1962/build_snapshot.json`
- `tools/scenario_chunk_assets.py`
- `tools/political_detail_partition.py`
- `tools/build_political_display_lods.py`
- `js/core/scenario/` 与 `js/core/renderer/`
- `docs/active/europe-precision-20260920/`、`docs/active/russia-precision-20260920/`

## Stages

- [x] Stage 1: 建立真实基线、分类东欧缝隙并锁定三条线的验收样本。
- [x] Stage 2: 完成东欧候选判定与日本精度试点。东欧因缺少水体/历史归属和唯一 recipient 证据而明确停止自动修补；日本完成共享契约、ID、归属、混合 LOD 与浏览器装载验证。
- [ ] Stage 3: 中国、美国、印度已推进到 fail-closed 候选门槛，但分别阻塞于真实重叠、470 条 lineage 和受治理来源缺失，未进行 canonical 接入。
- [x] Stage 4: 实施性能低风险阶段（请求优先级、预算诊断和有界调度）。
- [x] Stage 5: 实施性能中风险阶段（声明式 LOD family 的按需预热和可回退消费路径）。
- [x] Stage 6: 评估高风险阶段，结论为当前 no-go；已给出进入条件、单变量实验顺序和回滚设计，未实施高风险改造。
- [x] Stage 7: 汇总目标测试、数据治理检查、运行时/浏览器证据和剩余风险。

## Acceptance criteria

- 东欧每个修复都有可复现的几何分类，且不会用扩大容差或掩盖 coverage failure 的方式通过。
- 四大国候选保留稳定 feature ID、owner/controller/core/manual override 与 split-child 语义，并通过覆盖、拓扑、共享边和来源追踪检查。
- 精度数据仅在其声明的加载/LOD 条件下增加运行成本；场景切换、缓存淘汰、取消和超大任务不会突破明确预算。
- 低风险和中风险性能阶段有目标行为测试及真实数据成本对照；高风险阶段无代码落地。
- 相关数据目录变更后，数据目录生成、健康检查和 catalog contract 全部通过，或明确记录真实阻塞。

## Non-goals

- 不自行发布、部署、推送或创建 PR。
- 不把视觉发丝线未经分类就等同于源数据空洞。
- 不在本轮实施高风险的全局 canonical 格式迁移、全世界重分片或渲染器重写。

## Risks and constraints

- 印度和俄罗斯源几何体量大，必须先通过预算和分块门槛再进入正式数据。
- 共享边修复可能改变相邻 feature，必须以成对边界和覆盖并集验证。
- 当前工作树从 `382ce56744d3942a9097e1352c312a23bab0dbf9` 创建；主工作区未跟踪 `.playwright-mcp/` 不属于本任务。
- 性能高风险阶段必须由证据和用户后续授权共同触发。

## Authorized continuation

2026-09-22 用户进一步授权：美国原约 900 区域配额仅是旧性能限制，可取消，以完整县级基础数据和现有分级加载优化推进。印度现有颗粒度与视觉质量足够，不升级 ADM3、不更换几何底座。先完成美国新源候选、modern_world 暂存适配与性能验证，显式管理旧 ID 迁移及剧本特殊边界；不要求新底座沿用旧聚合 ID。既有发布边界和高风险渲染器重写限制保持。

关联任务读取前轮验收后继续实施，不变更上述原始计划。优先解决真实可逆缺口：显式受治理来源读取、冻结歧义地块的局部精度升级、精确导出消费、离线解码内存，以及稳定 ID 验收遗漏。完整国家覆盖和缺少唯一 recipient 的东欧陆地修复仍单独保留未完成状态。最终将通过的部分候选组合为同基线暂存场景，保留生产发布与高风险架构门槛。
