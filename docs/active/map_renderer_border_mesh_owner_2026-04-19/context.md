# context
- 2026-04-19：继续 map renderer 拆分。
- `border_mesh_owner.js` 现在已继续接管 dynamic/opening owner border transaction。
- `map_renderer.js` 保留 `recomputeDynamicBordersNow()`、`scheduleDynamicBorderRecompute()`、`drawBordersPass()`、`drawHierarchicalBorders()` 和 render/timer facade。
- 已更新 `tests/test_map_renderer_border_mesh_owner_boundary_contract.py`。
- 已完成最小验证：`node --check` 通过，23 条 targeted unittest 通过，LSP diagnostics 为 0。
- 子代理静态复核结论：当前最稳的边界是 owner 负责 mesh materialize/cache，donor 继续保留 timer/render facade；下一刀适合 `border_draw_owner`。
