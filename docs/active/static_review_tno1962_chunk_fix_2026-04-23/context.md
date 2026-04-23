# context
2026-04-23 静态 review 结论：当前 scope 内未发现 blocking correctness 缺陷。
证据：
- `js/main.js` ready 路径已统一调用 `flushPendingScenarioChunkRefreshAfterReady("ready-state")`。
- `js/core/scenario/chunk_runtime.js` 已把 flushPending promotion 改成可直接提交，并补了 `shellStatus` 的 `loading -> ready` 转移。
- `js/core/scenario_apply_pipeline.js` 在 chunk runtime 启动且尚无缓存 chunk 时，初始 `shellStatus` 改为 `loading`。
- `tools/patch_tno_1962_bundle.py` 已阻止 `ATLISL_*` 被 assignment override 重写 `cntr_code`，并把 water stage 字段带回 runtime topology state。
- 产物检查：`runtime_topology` / `political.coarse.r0c0` / `political.detail.country.atl` 中 `ATLISL_*` 均为 `cntr_code=ATL` 且 `interactive=true`；`political.detail.country.ita|ibr|tur` 中已无 `ATLISL_*`。
剩余风险：
- 本轮改动的新增验证以静态 contract / checked-in 产物 spot check 为主，缺少真实 ready -> first promotion 行为验证。
- 本轮 scope 不含 chunk registry / manifest 索引文件，无法在本轮静态 review 中确认 ATLISL 新分桶与 registry 选择路径完全同步。
