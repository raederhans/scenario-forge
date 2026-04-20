# REFACTOR_ARCHITECTURE_SPLIT_2026-04-17

> Canonical archive document: `docs/archive/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md`.

## map_renderer 拆分准则（2026-04-20）
- `js/core/map_renderer.js` 保留编排逻辑与稳定 API。
- 业务实现与算法细节保留在 owner 模块。
- 纯转发入口采用模块级常量绑定或集中 facade，减少重复样板函数。
- 兼容 facade 留在主文件，并通过边界测试保护。
