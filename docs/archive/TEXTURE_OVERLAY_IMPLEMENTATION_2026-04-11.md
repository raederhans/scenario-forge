# TEXTURE_OVERLAY_IMPLEMENTATION_2026-04-11

## Goal
- 修 Texture Overlay 的覆盖顺序和 UI/状态不一致问题。
- 让 Clean、Old Paper、Draft Grid、Graticule 四种模式都达到“可理解、可见、可保存”的最低可用标准。

## Plan
1. 修 Texture Overlay 面板：Clean 禁用 opacity；补 Draft Grid / Graticule 缺失参数接线。
2. 修渲染顺序：把 texture pass 放到 contextBase/contextScenario 之后，避免 Old Paper 被后续水域覆盖层盖掉。
3. 修可见性与标签：增强 Draft Grid / Graticule 默认可见性；把 Graticule 标签改成少量外框标签并提升可读性。
4. 补自动化：UI contract、渲染差异、状态回填。
5. 最后做 review、补 lessons learned、归档本文档。

## Progress
- [x] 读取 lessons learned 与相关 skill / agent 约束
- [x] 浏览器与代码联合复现问题，确认主因
- [x] 修改 Texture Overlay UI 与状态接线
- [x] 修改 render pass 顺序与纹理渲染
- [x] 补测试并执行验证（`tests/e2e/texture_overlay_regression.spec.js` 通过）
- [x] 复核、更新 lessons learned、归档

## Result
- Clean 模式下 opacity 现在会禁用，且 handler 也不会再写入 state。
- Old Paper 已从线网/标签逻辑中拆开，只保留纸张覆盖，不再把 Graticule 标签一起压进同一个 effects pass。
- Draft Grid / Graticule 面板已补齐关键参数：颜色、宽度、主次透明度，Graticule 还补了标签颜色和字号。
- Graticule 标签改成外框少量分布，并加了更稳的描边可读性。
- 状态归一化补上了 texture 专用颜色 normalizer，避免非法颜色把 UI 和 state 拉偏。

## Notes
- 本轮按“中等重做”执行，没有重构整个 Appearance 信息架构。
- roundtrip 这轮先落在“payload 回填 + UI 回填”覆盖，没有继续扩张到更重的 project import/export 全链路回归。
