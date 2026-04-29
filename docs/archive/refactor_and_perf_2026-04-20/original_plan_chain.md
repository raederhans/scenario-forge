# 原计划链重建

## 真源固定

当前任务目录里的原计划链，以这两份归档文档为唯一真源：

1. `docs/archive/further_split/original/file_split.md`
2. `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`

本目录里的执行文档只做当前波次的落地编排，不改写上面两份真源的原意。

## 原计划链主轴

### 1. 架构根因判断

`file_split.md` 给出的核心判断已经固定：

- `state.js` 仍是跨启动、场景、渲染、UI、dev 的全局可写聚合点。
- `map_renderer.js` 仍是超大门面，拆分主要停留在 owner pass-through。
- UI 与 core 依赖仍然紧，未来扩展和测试都会持续受阻。
- 这条链的第一优先级是 `state.js` 领域切片化，加上可替换的事件总线。

### 2. 状态拆分蓝图

`STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md` 把上面的判断落成了分阶段计划：

1. `Phase 0`：护栏，建立 lint / Proxy / baseline。
2. `Phase 1`：建 8 个 state slice、`config.js`、`bus.js`。
3. `Phase 2`：上 Proxy 门面，兼容旧读写路径。
4. `Phase 3.1` 到 `Phase 3.8`：按消费者域迁移到各 slice。
5. `Phase 4`：拆门面，删除 `runtime_hooks.js`。

这份蓝图的真正目标一直是两件事：

- 让状态读写边界清晰，可分批迁移。
- 让后续 renderer、scenario、UI 的稳定化和性能治理有可靠落点。

## 当前 active 任务与原计划链的关系

`refactor_and_perf_2026-04-20` 这一轮已经完成了一部分前置收口工作：

- `map_renderer/public.js` facade 已落地，app/UI importer 已迁移到公开 surface。
- perf baseline 和 PR gate 已有首版产物。
- strategic overlay triage 已完成，当前已知故障集中在入口控件可见性 / 可用状态与 counter 交互链。

所以当前 active 任务的角色已经清楚：

- 它承接原计划链里的“稳定化与验证”责任。
- 它为未来继续推进 state slice 主线保留真源与上下文。
- 它当前优先解决的执行主线是：`strategic overlay` 稳定化 + `perf gate` 收口。

## 当前波次的执行边界

### 本轮直接推进

1. `strategic overlay` 稳定化
   - 修入口控件可见性与 enabled 状态。
   - 修 counter 交互与持久化链。
   - 用定向回归证据确认编辑链恢复。
2. `perf gate` 收口
   - 保持 `docs/perf/baseline_2026-04-20.json` 与 CI gate 输入一致。
   - 让 `blank_base + tno_1962` 继续承担 PR gate。
   - 把 `hoi4_1939` 保持在 manual 或 nightly lane。

### 本轮保留到下一阶段

1. `state.js` 全量 Phase 0-4 执行
2. `runtime_hooks.js` 到事件总线的完整替换
3. 更大范围的 scenario / renderer / UI 深层架构迁移

## 当前文档读取顺序

1. 先读本文件，确认原计划链真源和当前任务位置。
2. 再读 `context.md`，看当前事实与阶段状态。
3. 再读 `plan.md`，看修复执行顺序。
4. 最后读 `task.md`，看当前 checklist。
