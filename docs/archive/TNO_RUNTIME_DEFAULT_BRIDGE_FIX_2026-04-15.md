# TNO runtime default bridge fix 2026-04-15

## Goal
- 保留 RU / FR / IN / KR / RS / VN 的 runtime default bridge
- 让 active scenario 主地图颜色桥尊重 `expose_as_runtime_default`

## Plan
- [x] 查清 crosswalk、palette map、scenario color bridge 的根因
- [x] 修 `data/palette-maps/tno.manual.json`，为每个受影响 ISO2 保留一个 exposed canonical tag
- [x] 更新生成产物与定向测试
- [x] 修 `js/core/scenario_manager.js`，让 scenario fixed owner colors 走 palette runtime default bridge
- [x] 跑定向验证
- [x] 收尾复核并归档

## Progress
- 已确认 `build_iso2_to_mapped_tag()` 只认 exposed mapping，当前 `tno.map.json` 原先会让 RU / FR / IN / KR / RS / VN 断桥。
- 已把 `FFR / FRI / KOR / SER / SVR / VIN` 收回为 exposed runtime default bridge，并同步更新 `tno.map.json`。
- 已新增 palette import 校验，防止同类断桥再次写入生成产物。
- 已新增纯逻辑 runtime bridge helper，让 `defaultCountryPalette` 和 active scenario 共用同一份 canonical bridge 语义。
- 已完成定向验证：`python -m unittest tests.test_import_country_palette`、`node --test tests/palette_runtime_bridge.node.test.mjs`。
