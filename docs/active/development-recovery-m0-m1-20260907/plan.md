# 开发恢复 M0–M1

来源：https://chatgpt.com/c/6a9ec54f-31f0-83ec-953a-efa96be491b0 （2026-09-07 已读取全文）。原审查基于 ee49ab6b；当前 main 为后续提交 09df7b84fef838522bce5111af8054f68c2762f9。

## 范围与验收

- M0：固定实际提交、环境、数据、启动方式；复用 Golden Demo / 现有浏览器检查，验证启动、剧本、选择、填色、撤销/重做、保存、重新载入、导出，检查状态与输出。区分 fast 与 fresh；保留 TNO/HOI4 重型样本的验证状态，不能拿历史 CI 数据冒充本机结果。
- M1 基线反馈：逐项复核历史 Nightly 故障，区分仍复现、后续已修复、未验证。实际测量 UI/controller、renderer owner、state action 三种 verify:edit 路由、行为检查和耗时，明确 deferred 项。
- M1 策略：确定可信策略基准与历史链，使用正式 producer 对齐保留绑定、别名、委托写入，完成对应完整检查；记录阶段耗时，仅在证据支持时减少重复计算。
- 不刷新冻结基线或放宽 allowlist；不把 HEAD 自动当可信基准。保存损坏或撤销错误优先修复。
- 本批不实施 M2 热点性能优化、M3 数据/发布迁移或 M4 架构拆分；不发布、不重写历史、不丢弃现有改动。

## 分工

1. 隔离对话 A：M0 真实编辑基线与 M1 局部反馈、非策略历史故障。
2. 隔离对话 B：M1 状态策略正式登记、证明及验证成本。
3. 当前对话子代理：只读定位局部路由与历史失败入口，给 A 提供交接。

A 与 B 各自拥有 worktree，禁止直接写主工作区。共享文件冲突和候选整合由当前协调对话裁决；完成分派不代表 M0/M1 已验收。

## Authorized continuation: remaining M2/M3 - 2026-09-08
User explicitly requested completion after the first tranche. Baseline6475d523. Earlier M0/M1 plan above remains historical.

M2 acceptance:
- Attribute chunk load/decode/derived/index/draw/interaction recovery costs using current fixed source, TNO and HOI4; do not sum overlapping timings.
- Fix evidence-backed redundant work with preserved generation/cancellation/hit readiness; reject speculative restructuring.
- Measure real input-to-visible feedback for selection/fill/zoom/undo using existing harnesses, explicitly distinguish absent data from zero.
- Verify rapid scenario return, repeated zoom, immediate undo and failure/cancellation paths with actual state/output assertions.
- Combine prior repeatable water-selection improvement with new chain/input evidence; final completion requires these acceptance items, not just a new small patch.

M3 acceptance:
- Provide a concrete opt-in lightweight development checkout or runtime-asset selection path using existing tools, with measured file/byte reduction and actual editor behavior.
- Define raw inputs, derived data, runtime assets and small test inputs through existing manifests/build inputs; normal UI edits must not require full geographic rebuilding.
- Keep full fixed-source data/build path intact and traceable. Prior Pages/current-artifact/rollback evidence may be reused only for unchanged inputs; Pages packaging is not raw-geodata regeneration.
- No production deployment, history rewrite, raw-data move/deletion, or tracked-dist retirement in this local phase. These are not required to prove the original M3 local developer-path acceptance.

Ownership: M2 task01a07eb8-c7a9-7e42-bf8c-77ce03c57e81 owns runtime chain/input and direct tests; M3 task01a07eb8-c78d-71d0-8d35-2b7c956eec25 owns light checkout/asset tooling and direct tests/docs. Parent owns shared catalog/package decisions and serial integration. M2 is sole heavy runtime/browser owner until explicit handoff; M3 can read/design and run isolated light tests. Existing dirty legacy outputs are retained.
