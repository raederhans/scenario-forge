// 面板订阅表：哪类变更刷新哪些面板。
// 调用方只声明"什么变了"（commitChange 的 domains），不再各自手写要通知的面板清单。
// 面板仍通过原有的通知钩子（state/config.js）接入，所以面板代码不用改。

export const PANEL_HOOKS_BY_CHANGE_DOMAIN = Object.freeze({
  // 历史栈长度变化：撤销/重做按钮。
  history: Object.freeze(["updateHistoryUIFn"]),
  // 项目脏标记：保存状态。
  dirty: Object.freeze(["updateProjectSaveStatusFn"]),
  // 最近使用的颜色。
  recentColors: Object.freeze(["updateRecentUI"]),
  // 当前工具、画笔模式、选中颜色。
  tool: Object.freeze(["updateToolUIFn", "updateSwatchUIFn", "updatePaintModeUIFn"]),
  // 工具栏里的外观输入框。
  appearance: Object.freeze(["updateToolbarInputsFn"]),
  // 当前主权（归属涂色模式的目标国家）。
  activeSovereign: Object.freeze(["updateActiveSovereignUIFn"]),
  // 检查器当前国家的详情。
  inspector: Object.freeze(["refreshCountryInspectorDetailFn"]),
  // 区域列表（归属或成员变化）。
  countryList: Object.freeze(["renderCountryListFn"]),
  waterRegionList: Object.freeze(["renderWaterRegionListFn"]),
  specialRegionList: Object.freeze(["renderSpecialRegionListFn"]),
  // 预设树（归属或可释放国家变化）。
  presetTree: Object.freeze(["renderPresetTreeFn"]),
  // 图例编辑器（图例配置或标签变化）。
  legend: Object.freeze(["updateLegendUI"]),
  // 战略标注面板。
  strategicOverlays: Object.freeze(["updateStrategicOverlayUIFn"]),
});

export const CHANGE_DOMAINS = Object.freeze(Object.keys(PANEL_HOOKS_BY_CHANGE_DOMAIN));
