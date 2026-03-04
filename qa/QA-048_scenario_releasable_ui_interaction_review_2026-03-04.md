# QA-048 — 剧本模式下母国-可释放国家 UI 交互与菜单组件审查

**Date:** 2026-03-04
**Scope:** HOI4 1936 剧本模式下的母国与可释放（附属）国家之间的 UI 交互逻辑、Inspector 菜单组件行为、状态同步一致性
**Method:** 静态代码审计：逐行走读 `sidebar.js`、`scenario_manager.js`、`releasable_manager.js`、`state.js`，模拟所有可达交互路径
**Prerequisite:** QA-045 已识别分组退化、预设失联、inspector 空态等基础问题。本报告聚焦其上层——交互流与状态一致性
**Deliverable Type:** 只读型审计文档，不修改代码

---

## Executive Summary

QA-045 已确认"剧本数据能载入、地图能切色"的最低可用性。本报告进一步审查剧本模式下**母国与可释放国家之间的交互循环**，包括：列表展开/折叠、Inspector 导航、颜色修改、主权切换、预设应用、搜索行为。

核心发现：当前交互系统的**正向路径**（初始剧本 → 点击母国 → 展开可释放列表 → 点击子国 → 查看核心领土 → 返回母国）基本完整。但在**状态边界与非线性路径**上存在显著问题，主要集中在以下三类：

1. **Inspector 颜色修改在剧本模式下被"吞掉"**——用户在色板上改了颜色，但视觉上不生效，因为剧本颜色源优先级始终更高。
2. **切换剧本 / 重置剧本时 UI 展开状态未正确清理**——旧剧本的可释放展开状态泄漏到新剧本或无剧本状态。
3. **搜索模式下可释放国家丢失父级上下文**——搜索到可释放国后点击，Inspector 正确显示，但列表中不呈现任何父子关系。

---

## Audit Inputs

- [sidebar.js](js/ui/sidebar.js) — 国家列表、Inspector 明细、Preset Tree、搜索
- [scenario_manager.js](js/core/scenario_manager.js) — 剧本应用/重置/清除、状态同步
- [releasable_manager.js](js/core/releasable_manager.js) — 可释放索引构建、预设叠加
- [state.js](js/core/state.js) — 全局状态定义
- [hoi4_vanilla.internal.phase1.catalog.json](data/releasables/hoi4_vanilla.internal.phase1.catalog.json) — 可释放目录数据

---

## Interaction Path Analysis

### Path 1: 正向路径（母国 → 可释放子国 → 返回母国）

```
用户应用剧本
  → renderList() 重建列表
  → 母国行显示 "Releasables N" badge + 展开按钮
  → 用户点击展开按钮
  → expandedInspectorReleaseParents.add(parentCode)
  → renderList() 重新渲染
  → 子国行出现，显示 "Releasable" badge + "Releasable from {母国}" meta
  → 用户点击子国行
  → selectInspectorCountry(childCode)
  → Inspector 切到子国明细
  → renderReleasableCountryActions() 渲染 "Parent Country" + "Core Territory" + "Notes"
  → 用户点击 "Back to Parent"
  → expandedInspectorReleaseParents.add(parentOwnerTag)
  → selectInspectorCountry(parentOwnerTag)
  → Inspector 回到母国明细
  → renderParentCountryActions() 渲染 "Hierarchy Groups" + "Releasable Countries" + "Regional Presets"
```

**结论：正向路径完整。**

### Path 2: 剧本 Inspector 颜色修改路径

```
用户选中 Germany (GER)
  → Inspector 色板显示 resolvedColor
  → getResolvedCountryColor() 优先级:
    1. state.sovereignBaseColors["GER"]   ← 剧本 apply 时写入
    2. state.countryBaseColors["GER"]     ← 剧本 apply 时写入（同值）
    3. state.countryPalette["GER"]        ← 用户修改写入此处
    4. fallback
  → 用户通过 countryInspectorColorInput 修改颜色
  → handler 写入: state.countryPalette[selectedCode] = newColor
  → applyCountryColor(selectedCode, newColor)
  → ★ 问题: 下次 getResolvedCountryColor() 仍返回 sovereignBaseColors["GER"]
  → 用户看到色板值变了，但列表色块和地图不反映新颜色
```

**结论：剧本模式下 Inspector 颜色修改无效——这是用户可感知的最重大交互缺陷。**

### Path 3: 切换剧本 (ScenarioA → ScenarioB)

```
当前 ScenarioA 激活
  → 用户展开了 GER 的可释放列表
  → expandedInspectorReleaseParents = Set { "GER" }
  → 用户在下拉框选择 ScenarioB 并点击 Apply
  → applyScenarioById(scenarioB)
    → applyScenarioBundle(bundle)
      → syncScenarioInspectorSelection(defaultCountryCode)
        → expandedInspectorContinents.clear()  ✓
        → expandedInspectorReleaseParents.clear()  ✓
      → syncCountryUi()
        → renderList()
        → renderPresetTree()
  → ★ 路径正常：expansion state 被清理
```

**结论：剧本 → 剧本切换路径正确（`syncScenarioInspectorSelection` 正确清理了展开状态）。**

### Path 4: 重置剧本到 baseline

```
用户在剧本模式下做了一些编辑
  → 点击 "Reset Changes To Baseline"
  → resetToScenarioBaseline()
    → syncScenarioInspectorSelection(activeSovereignCode)
      → expandedInspectorContinents.clear()  ✓
      → expandedInspectorReleaseParents.clear()  ✓
    → syncCountryUi({ renderNow: true })
  → ★ 问题: 用户刚展开到某个可释放国并做编辑，重置后展开状态被清空
  → 用户需要重新导航回之前的位置
```

**结论：功能正确但体验不佳——重置不应清空导航位置。**

### Path 5: 退出剧本模式

```
用户在剧本模式下点击 "Exit Scenario"
  → clearActiveScenario()
    → state.scenarioCountriesByTag = {}
    → state.scenarioReleasableIndex = { byTag: {}, childTagsByParent: {}, ... }
    → syncScenarioInspectorSelection("")
      → expandedInspectorContinents.clear()  ✓
      → expandedInspectorReleaseParents.clear()  ✓
    → rebuildPresetState()
    → syncCountryUi({ renderNow: true })
  → renderList() 重建列表
  → getDynamicCountryEntries() 走非剧本分支
  → ★ 列表回归现代国家模式 ✓
  → ★ 但: expandedInspectorReleaseParents 虽被清空，Set 实例仍存在
  → 非剧本模式下 getReleasableChildrenForParent() 返回 [] ✓（因 childTagsByParent 已空）
```

**结论：退出路径正确。**

### Path 6: 搜索模式下的可释放国家

```
用户在搜索框输入 "Bavaria"
  → renderList()
    → term 非空，走 renderCountrySearchResults()
    → countryStates 包含所有国家（含可释放）
    → Bavaria (BAY) 匹配搜索词
    → getCountrySearchRank() 返回非 null
    → renderCountrySelectRow(list, bavariaSt) ← 注意：无 childStates 参数
  → Bavaria 作为平坦行渲染，无母国上下文
  → 用户点击 Bavaria
    → selectInspectorCountry("BAY")
    → Inspector 正确切到 BAY 明细 ✓
    → renderReleasableCountryActions() 正确渲染 ✓
  → ★ 但: 列表中 Bavaria 没有 "Releasable from Germany" 的视觉锚定
  → ★ 搜索结果里母国和子国是平级的，无法从列表层看出父子关系
```

**结论：搜索结果中可释放国家丢失父级上下文。Inspector 明细仍正确显示"Releasable from"信息，但列表层无法辨识归属。**

---

## Findings

### F-1 [Critical] 剧本模式下 Inspector 颜色修改被剧本色覆盖，用户操作无效

**Symptom**
在剧本模式下通过 Inspector 色板修改某国颜色后，列表色块和地图上的颜色不发生变化。

**Root Cause**
[sidebar.js:1754-1762](js/ui/sidebar.js#L1754-L1762) 中颜色修改写入 `state.countryPalette[code]`。但 [sidebar.js:973-982](js/ui/sidebar.js#L973-L982) 中 `getResolvedCountryColor()` 的优先级链为：

```
sovereignBaseColors[code]  >  countryBaseColors[code]  >  countryPalette[code]  >  fallback
```

而 [scenario_manager.js:435-436](js/core/scenario_manager.js#L435-L436) 在剧本应用时将剧本颜色同时写入了 `sovereignBaseColors` 和 `countryBaseColors`，这两层始终比 `countryPalette` 优先。

**Impact**
用户在剧本模式下的所有颜色修改都被"吞掉"。这是**最直接的功能性缺陷**——用户操作了但没有效果。

**Suggested Fix**
颜色修改应当同时写入 `sovereignBaseColors` 和 `countryBaseColors`，或者将 Inspector 颜色修改的写入目标从 `countryPalette` 提升到 `sovereignBaseColors`。更好的做法是统一颜色源逻辑：

```js
// sidebar.js countryInspectorColorInput change handler
if (state.activeScenarioId) {
  state.sovereignBaseColors[selectedCode] = value;
  state.countryBaseColors[selectedCode] = value;
} else {
  state.countryPalette[selectedCode] = value;
}
```

---

### F-2 [High] "Set Active" 对可释放国家缺少语义校验

**Symptom**
用户可以在 Inspector 中将可释放国家（如 Bavaria/BAY）设为 `activeSovereignCode`，之后在主权绘制模式下所有点击都会把区域所有权设为 BAY。

**Root Cause**
[sidebar.js:1737-1748](js/ui/sidebar.js#L1737-L1748) 中 "Set Active" 按钮的 handler 不区分母国与可释放国。任何在 `latestCountryStatesByCode` 中存在的国家都可以被设为 active sovereign。

**Impact**
- 可释放国家作为 active sovereign 在地图上的视觉表达是有意义的（HOI4 支持释放国家），所以这不是一个"错误"
- 但缺少确认或提示：用户可能不理解将 BAY 设为 active 后，主权绘制将以 BAY 而非 GER 为单位进行
- 对于不熟悉 HOI4 释放国概念的用户，这是一个认知断层

**Suggested Fix**
考虑在将可释放国家设为 Active 时增加提示，或在 Inspector 中标注其效果。不需要阻止该操作。

---

### F-3 [High] 重置剧本到 baseline 时不必要地清空了导航位置

**Symptom**
用户展开 Germany → Bavaria → 编辑 → 重置到 baseline → Inspector 和列表全部回到初始位置，用户需要重新导航。

**Root Cause**
[scenario_manager.js:494](js/core/scenario_manager.js#L494) 调用 `syncScenarioInspectorSelection(activeSovereignCode)`，该函数 [scenario_manager.js:128-139](js/core/scenario_manager.js#L128-L139) 无条件清空 `expandedInspectorContinents` 和 `expandedInspectorReleaseParents`。

Reset baseline 的语义是"恢复数据到初始状态"，不是"恢复 UI 导航到初始状态"。数据重置和导航重置不应耦合。

**Impact**
用户做了一次编辑后想重置看效果，但每次重置都要重新找到之前的国家/可释放国。重复多次后体验显著恶化。

**Suggested Fix**
`resetToScenarioBaseline()` 应保留当前的 `selectedInspectorCountryCode` 和展开状态。只重置数据和颜色，不动导航状态：

```js
// 不调用 syncScenarioInspectorSelection()
// 只重置数据
state.sovereigntyByFeatureId = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
state.sovereigntyInitialized = false;
ensureSovereigntyState({ force: true });
// ... 颜色重置等 ...
syncCountryUi({ renderNow: true }); // 重新渲染但保留导航
```

---

### F-4 [Medium] 搜索模式下可释放国家与母国呈现为平级，丢失父子关系

**Symptom**
搜索 "Bavaria" 或 "Schleswig" 后，结果列表中它们与 Germany、France 等母国同级排列，没有缩进、没有父国标注、没有 toggle。

**Root Cause**
[sidebar.js:1626-1628](js/ui/sidebar.js#L1626-L1628) 中 `renderCountrySearchResults()` 对每个匹配项调用：
```js
renderCountrySelectRow(list, countryState);
```
不传 `childStates` 参数，因此所有结果都是平坦渲染。

同时，搜索结果中如果母国也匹配，母国行也不会展示其可释放子国。

**Impact**
- 搜索到可释放国后无法从列表层看出"它属于谁"
- 好在 Inspector 明细中 `Releasable from {母国}` 信息仍然正确，部分缓解了问题
- 但这使搜索在剧本模式下的辅助价值降低

**Suggested Fix**
方案一（轻量）：在搜索结果中为可释放国家的 meta 行加入父国标注。当前 [sidebar.js:1438-1445](js/ui/sidebar.js#L1438-L1445) 已经在 meta 中显示 "Releasable from {母国}"，这一点在搜索模式下仍然有效。实际上 **meta 确实会显示 "Releasable from" 信息**——此 finding 的问题主要是视觉层级而非信息缺失。

方案二（增强）：搜索匹配到可释放国时，自动将其母国也加入结果并展示为 group。

---

### F-5 [Medium] 可释放国家在 Preset Tree 中的 "Core Territory" 查找键可能不一致

**Symptom**
Inspector 中选中可释放国家（如 Bavaria/BAY）后，Preset Tree 显示 "Core Territory" 区块，但其内容可能为空或不完整。

**Root Cause**
[sidebar.js:1937-1942](js/ui/sidebar.js#L1937-L1942) 中 `renderReleasableCountryActions()` 查找预设：

```js
const coreSection = appendActionSection(container, t("Core Territory", "ui"));
renderPresetEntryRows(
  coreSection,
  countryState.presetLookupCode || countryState.code,
  buildPresetEntries(countryState.presetLookupCode || countryState.code),
  t("No regional presets", "ui")
);
```

对可释放国家，`presetLookupCode` 的解析路径 [sidebar.js:904-906](js/ui/sidebar.js#L904-L906) 是：

```js
const lookupIso2 = resolveScenarioLookupCode(entry);
const presetLookupCode = resolveScenarioLookupCode(entry);
```

`resolveScenarioLookupCode()` [sidebar.js:252-288](js/ui/sidebar.js#L252-L288) 会按优先级查找：
1. `scenarioMeta.preset_lookup_code` → 对可释放国如 BAY，此字段为 "BAY"
2. fallback 链...

而 `rebuildPresetState()` [releasable_manager.js:272-282](js/releasable_manager.js#L272-L282) 在剧本模式下使用 `scenarioOverlays`，其中键为可释放 tag（如 "BAY"），值为 "Core Territory" preset。

**实际效果：** 如果 `scenarioOverlays["BAY"]` 存在且包含正确的 feature IDs，则 Core Territory 能正常显示。但这依赖于 `resolvePresetFeatureIds()` 在构建叠加层时成功解析了 BAY 的 `preset_source`。

对 BAY（catalog 中 `preset_source.type = "legacy_preset_name", name = "Bavaria"`），解析逻辑 [releasable_manager.js:61-68](js/core/releasable_manager.js#L61-L68) 需要在 `state.countryPresets["DE"]` 中找到名为 "Bavaria" 的预设。这**应该能工作**，因为 `countryPresets.DE[0].name === "Bavaria"`。

**但：** 如果 catalog 中的 `release_lookup_iso2` 或预设名称与 `countryPresets` 中的键/名称不完全匹配（大小写、空格等），就会静默失败返回空 IDs，导致 "Core Territory" 预设不出现。

**Impact**
当前数据集下可能正常工作，但这是一个脆弱的间接链条（catalog → preset_source → legacy_preset_name → countryPresets lookup），任何一环不匹配都会静默降级。

**Suggested Fix**
增加运行时诊断：当 `resolvePresetFeatureIds()` 返回空 IDs 时记录 warning，包含 tag、lookup code 和 preset name，便于定位问题。

---

### F-6 [Medium] `countryBaseColors` 与 `sovereignBaseColors` 始终同值写入，冗余且易混淆

**Symptom**
剧本应用/重置时，`sovereignBaseColors` 和 `countryBaseColors` 总是被赋予相同的值。

**Root Cause**
[scenario_manager.js:435-436](js/core/scenario_manager.js#L435-L436):
```js
state.sovereignBaseColors = { ...scenarioColorMap };
state.countryBaseColors = { ...scenarioColorMap };
```

[scenario_manager.js:488-489](js/core/scenario_manager.js#L488-L489):
```js
state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
state.countryBaseColors = { ...state.sovereignBaseColors };
```

[scenario_manager.js:547-548](js/core/scenario_manager.js#L547-L548):
```js
state.sovereignBaseColors = { ...(defaults || ...) };
state.countryBaseColors = { ...state.sovereignBaseColors };
```

**Impact**
两个 map 始终相同，但 `getResolvedCountryColor()` 按顺序查询它们。这意味着：
- 如果用户修改了 `sovereignBaseColors[code]`（目前没有直接入口），`countryBaseColors[code]` 仍保留旧值
- 如果用户修改了 `countryBaseColors[code]`（目前没有直接入口），`sovereignBaseColors[code]` 会遮蔽它

这种"两个 map 同值但分开维护"的模式在颜色修改逻辑上制造了认知负担，也是 F-1 问题的根源之一。

**Suggested Fix**
明确两者的语义边界：
- `sovereignBaseColors`: 剧本/系统级颜色，只在剧本 apply/reset 时写入
- `countryBaseColors`: 用户级颜色修改的接收层

或者在剧本模式下合并为单一颜色源。

---

### F-7 [Medium] 母国 Inspector 的 "Releasable Countries" 区块不标识当前选中状态

**Symptom**
在母国（如 Germany）的 Inspector 明细中，"Releasable Countries" 区块列出所有可释放子国（Bavaria、Saxony、Schleswig...），但不会高亮当前在列表中选中的子国。

**Root Cause**
[sidebar.js:1895-1909](js/ui/sidebar.js#L1895-L1909) 中为每个子国创建一个导航按钮：

```js
releasableChildren.forEach((childState) => {
  const button = createInspectorActionButton(
    `${childState.displayName} (${childState.code})`,
    () => selectInspectorCountry(childState.code)
  );
  releasableSection.appendChild(button);
});
```

所有按钮样式相同，无选中态标识。

**Impact**
当母国有多个可释放国家时（如 Germany 有 3 个），用户无法从 Inspector 的 Releasable Countries 区块看出"我刚才看的是哪个"。虽然这些按钮的功能是导航（不是标记选中），但视觉反馈的缺失仍然影响使用流畅度。

**Suggested Fix**
为与当前 `selectedInspectorCountryCode` 匹配的子国按钮增加 `is-selected` class。

---

### F-8 [Low] 可释放子国列表排序依赖 `catalogOrder`，缺省时退化为无序

**Symptom**
展开母国的可释放子国列表时，子国排序由 `catalogOrder` 决定。

**Root Cause**
[sidebar.js:963-970](js/ui/sidebar.js#L963-L970) 排序逻辑：
```js
.sort((a, b) => {
  const catalogOrderDelta = Number(a?.catalogOrder ?? Number.MAX_SAFE_INTEGER)
    - Number(b?.catalogOrder ?? Number.MAX_SAFE_INTEGER);
  if (catalogOrderDelta !== 0) return catalogOrderDelta;
  const featureDelta = Number(b?.featureCount || 0) - Number(a?.featureCount || 0);
  if (featureDelta !== 0) return featureDelta;
  return String(a?.displayName || "").localeCompare(String(b?.displayName || ""));
});
```

当前 catalog 中 `catalogOrder` 是隐式的（由 `forEach` 的 `index` 参数决定），不是 catalog JSON 中的显式字段。如果 catalog JSON 的 `entries` 数组顺序被打乱，排序就会变化。

**Impact**
当前数据集下排序合理（catalog 按有意义的顺序编写），但这是一个隐式契约。

**Suggested Fix**
在 catalog 中增加显式 `sort_order` 字段，或在文档中注明 `entries` 数组顺序即排序顺序。

---

### F-9 [Low] Preset Tree 中 "Regional Presets" 的空态消息不区分"无预设"与"预设被可释放消费"

**Symptom**
母国（如 Germany）在剧本模式下，如果 Bavaria preset 被 BAY 可释放消费，Regional Presets 区块可能显示 "No regional presets"，但实际上是有预设只是被过滤了。

**Root Cause**
[sidebar.js:1868-1879](js/ui/sidebar.js#L1868-L1879) 中 `getFilteredRegionalPresets()` 过滤掉被消费的预设后，如果剩余为空，[sidebar.js:1911-1917](js/ui/sidebar.js#L1911-L1917) 显示 `t("No regional presets", "ui")`。

这个消息没有区分：
- 该国本来就没有预设
- 该国有预设但全被可释放国家消费了

**Impact**
用户可能疑惑：Germany 明明有 Bavaria、Saxony 等预设，为什么进了剧本模式就都消失了？

**Suggested Fix**
当存在被消费的预设时，显示 "N presets used by releasable countries" 而非 "No regional presets"。

---

### F-10 [Low] `scenarioCountriesByTag` 合并时可释放国可覆盖同 tag 的基础国

**Symptom**
如果基础国家 map 和可释放国家 map 中出现相同 tag，可释放国的数据会覆盖基础国。

**Root Cause**
[scenario_manager.js:407-410](js/core/scenario_manager.js#L407-L410):
```js
const countryMap = {
  ...baseCountryMap,
  ...releasableCountries,
};
```

JavaScript spread 语义：后者覆盖前者。

**Impact**
当前 HOI4 1936 catalog 中的可释放 tag（BAY、SAX、SHL、WAL、SCO、NIR）与基础国家 tag 不冲突，因此实际未触发此问题。但如果未来 catalog 中引入与基础国同 tag 的可释放条目（理论上不应发生，但无运行时保护），会静默覆盖基础国数据。

**Suggested Fix**
在合并时增加冲突检测：

```js
Object.keys(releasableCountries).forEach((tag) => {
  if (baseCountryMap[tag]) {
    console.warn(`Releasable tag "${tag}" conflicts with base country tag.`);
  }
});
```

---

## Interaction Matrix: 母国 vs 可释放国 UI 能力对比

| 交互 | 母国 | 可释放国 | 一致性 |
|---|---|---|---|
| 在列表中可见 | 是（按洲分组） | 是（嵌套在母国下） | 一致 |
| 搜索可见 | 是 | 是（但无父级上下文） | 部分 |
| Inspector 明细 | 完整 | 完整（含 "Releasable from"） | 一致 |
| 修改颜色 | 剧本模式下无效 (F-1) | 剧本模式下无效 (F-1) | 一致（但都有问题）|
| Set Active | 可用 | 可用（无额外提示 F-2） | 部分 |
| Hierarchy Groups | 显示（如有） | 总是为空（设计如此） | 预期内 |
| Regional Presets | 显示（过滤已消费的） | N/A | 预期内 |
| Core Territory | N/A | 显示（从 scenarioOverlays 查找）| 预期内 |
| Releasable Countries 区块 | 显示子国列表 | N/A | 预期内 |
| "Back to Parent" 按钮 | N/A | 显示并可导航 | 预期内 |
| 展开/折叠子国列表 | 有 toggle 按钮 | N/A | 预期内 |
| 导航后展开状态保持 | 手动控制 | 自动展开父级 | 一致 |
| Reset Baseline 后位置保持 | 不保持 (F-3) | 不保持 (F-3) | 一致（但都有问题）|

---

## Priority Summary

| ID | Severity | 标题 | 修复复杂度 |
|---|---|---|---|
| F-1 | Critical | 剧本模式下颜色修改被吞掉 | 低（改写入目标）|
| F-2 | High | Set Active 对可释放国家缺语义提示 | 低（加提示）|
| F-3 | High | Reset Baseline 不必要清空导航位置 | 低（去掉 sync 调用）|
| F-4 | Medium | 搜索结果中可释放国丢失父级上下文 | 中 |
| F-5 | Medium | Core Territory 预设查找链脆弱 | 低（加 warning）|
| F-6 | Medium | sovereignBaseColors/countryBaseColors 冗余 | 中（需重构颜色源）|
| F-7 | Medium | Releasable Countries 区块不标识选中态 | 低 |
| F-8 | Low | 子国排序依赖隐式 catalog 顺序 | 低 |
| F-9 | Low | 预设空态消息不区分无/被消费 | 低 |
| F-10 | Low | tag 合并缺冲突检测 | 低 |

---

## Recommended Fix Order

1. **F-1** — 最高优先级，直接阻断剧本模式下的颜色编辑能力
2. **F-3** — 快速修复，显著改善重置后的导航体验
3. **F-6** — 与 F-1 一起做，理清颜色源的语义边界
4. **F-7** — 低成本高价值，增加一个 class toggle
5. **F-9** — 低成本改善，改一条消息文案
6. 其余按需处理
