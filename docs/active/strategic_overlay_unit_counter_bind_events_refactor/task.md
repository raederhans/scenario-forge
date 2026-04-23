# strategic_overlay unit counter bindEvents 下沉

## Goal
- 把 `js/ui/sidebar/strategic_overlay_controller.js` 里的 unit counter `bindEvents` 大块进一步下沉到 helper。
- 主文件保留 facade、依赖注入和 wiring。
- 保持行为不变，少量必要注释，boundary contract 跟随真实边界。

## Scope
- `js/ui/sidebar/strategic_overlay_controller.js`
- `js/ui/sidebar/strategic_overlay/*.js`
- `tests/test_strategic_overlay_sidebar_boundary_contract.py`

## Constraints
- 共享仓库，只改分配文件。
- 最多新增一个 helper 文件。
- 不跑 live test。
- 优先复用已有 `unit_counter_*` helper。
