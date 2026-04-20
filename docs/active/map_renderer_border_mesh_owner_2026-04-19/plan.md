# plan
- 目标：继续缩小 `js/core/map_renderer.js`，继续沿用 `border_mesh_owner.js`，把 dynamic/opening owner border transaction 下沉。
- 当前边界：draw pass、render invalidation、deferred heavy border mesh、static mesh rebuild 继续留在 donor。
- 本轮切口：`rebuildDynamicBorders()` 与 `refreshScenarioOpeningOwnerBorders()` 的核心交易下沉，donor 只保留 facade 和 `renderNow` 编排。
- 验证：`node --check` + targeted unittest + review 式静态复核。
