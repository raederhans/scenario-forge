# QA-050 — 剧本模式 UI 组件职责分离、布局拥挤与主权操作逻辑审计

**Date:** 2026-03-04
**Scope:** 剧本模式下 sidebar 组件职责重叠、布局空间利用、主权操作 UX 流、legacy 预设残留
**Prerequisite:** QA-049 已修复 F-1（颜色修改）、F-3（导航位置保持）等交互性缺陷。本报告聚焦**结构层**问题
**Method:** 静态代码审计 + 布局走读：sidebar.js, scenario_manager.js, toolbar.js, index.html
**Deliverable Type:** 只读型审计文档，不修改代码

---

## Executive Summary

QA-049 修复后，剧本模式下的交互路径基本通畅。但 sidebar 的**组件职责边界**和**空间分配**问题仍然显著：

1. **Inspector 面板在剧本模式下承担了过多职责** — 颜色修改、国家元数据、主权设置、层级组、区域预设全部塞入同一个滚动区域，导致面板高度膨胀。
2. **"Territories & Presets" 面板在剧本模式下被完全隐藏** — 原本用于预设和层级浏览的独立区域（`#presetTree`、`#selectedCountryActionsSection`）被整体移除，其功能全部压入 Inspector inline actions。
3. **可释放国家的 Core Territory 预设在 Inspector 中不可见** — 点击可释放国家时自动应用了 Core Territory 预设，但 Inspector 中没有显示它、也无法手动重新触发。
4. **主权操作（Active Sovereign / Paint Mode）的信息散落在两个分离的 UI 区域**（toolbar 和 sidebar），缺乏剧本模式下的语义引导。
5. **Legacy 区域预设在剧本模式下的消费/过滤逻辑正确但表现不透明** — 用户看到 "No regional presets" 时无法理解为什么。

核心建议：**将剧本模式下的操作从 Inspector 迁移到 "Territories & Presets" 面板**（或新建 "Scenario Actions" 面板），让 Inspector 回归轻量化的"查看+颜色"角色。

---

## Layout Analysis: 剧本模式 vs 非剧本模式的 Sidebar 结构对比

### 非剧本模式（正常）

```
┌─────────────────────────────┐
│ Search Bar                   │
├─────────────────────────────┤
│ Country Inspector Detail     │  ← 国家名/meta/色板/Set Active
│   (compact, ~120px)          │
├─────────────────────────────┤
│ Country List                 │  ← 洲分组手风琴，可滚动
│   (scrollable)               │
├─────────────────────────────┤
│ ▸ Territories & Presets      │  ← 可折叠 <details>
│   └─ Hierarchy Groups        │     renderPresetTree() → renderParentCountryActions()
│   └─ Regional Presets        │
├─────────────────────────────┤
│ ▸ Project & Legend           │
├─────────────────────────────┤
│ ▸ Diagnostics                │
└─────────────────────────────┘
```

**职责分离清晰：** Inspector 负责"看"，Territories & Presets 负责"操作"。

### 剧本模式（当前）

```
┌─────────────────────────────┐
│ Search Bar                   │
├─────────────────────────────┤
│ Country Inspector Detail     │  ← 国家名/meta/色板/Set Active/Back to Parent
│   ┌─────────────────────┐   │
│   │ countryInspectorInli│   │  ← 剧本模式下动态注入：
│   │ neActions            │   │
│   │ ┌─ Hierarchy Groups ─┤   │     母国 → renderParentCountryActions()
│   │ │  action buttons    │   │       = Hierarchy Groups + Regional Presets
│   │ ├─ Regional Presets ─┤   │     可释放 → renderScenarioReleasableCountryDetailExtras()
│   │ │  preset rows       │   │       = 只有 Notes
│   │ │  (Apply/Edit/Copy) │   │
│   │ └───────────────────┘   │
│   (tall, ~300-500px)         │
├─────────────────────────────┤
│ Country List                 │  ← 洲分组 + 可释放子国嵌套
│   (scrollable)               │
├─────────────────────────────┤
│ ▸ Territories & Presets      │  ← ★ HIDDEN (aria-hidden=true)
│   └─ presetTree 返回空        │     renderPresetTree() → return early
├─────────────────────────────┤
│ ▸ Project & Legend           │
├─────────────────────────────┤
│ ▸ Diagnostics                │
│   └─ Scenario Audit          │
└─────────────────────────────┘
```

**问题：** Inspector 从 ~120px 膨胀到 ~300-500px（取决于 hierarchy groups 和 presets 数量），挤压了 Country List 的可用空间。同时 "Territories & Presets" 面板浪费了原本属于它的 UI 空间。

---

## Findings

### F-1 [High] Inspector 面板在剧本模式下职责过载，布局膨胀

**Symptom**
选中母国（如 Germany）后，Inspector 面板同时显示：国家名、meta 行、色板、Set Active、**以及** Hierarchy Groups（多个按钮）+ Regional Presets（多行含 Apply/Edit/Copy 按钮）。Inspector 高度可达 400-500px，严重挤压下方 Country List 的可用滚动区域。

**Root Cause**
[sidebar.js:2107-2120](js/ui/sidebar.js#L2107-L2120) `renderScenarioInspectorInlineActions()` 将完整的 `renderParentCountryActions()` 输出注入到 `countryInspectorInlineActions` 容器中。而 [sidebar.js:858-873](js/ui/sidebar.js#L858-L873) `updateScenarioInspectorLayout()` 将 `selectedCountryActionsSection`（即 "Territories & Presets" 面板）在剧本模式下完全隐藏：

```js
// sidebar.js:870-871
selectedCountryActionsSection.classList.toggle("hidden", isScenarioMode);
selectedCountryActionsSection.setAttribute("aria-hidden", String(isScenarioMode));
```

同时 [sidebar.js:2127-2128](js/ui/sidebar.js#L2127-L2128) `renderPresetTree()` 在剧本模式下直接 return：

```js
if (state.activeScenarioId) {
  return;
}
```

**结果：** Inspector 被迫承担两个面板的工作量，而 "Territories & Presets" 面板整体空置。

**Suggested Decomposition**
不要隐藏 "Territories & Presets"，而是在剧本模式下用它来承载剧本操作：

```
Inspector Detail:  国家名/meta/色板/Set Active/Back to Parent  （保持轻量）
Territories & Presets → rename "Scenario Actions":
  ├─ Hierarchy Groups  （从 inline actions 迁出）
  ├─ Regional Presets  （从 inline actions 迁出）
  ├─ Core Territory    （可释放国家时显示）
  └─ Releasable Countries  （母国时显示子国列表）
```

---

### F-2 [High] 可释放国家选中后 Inspector 无 Core Territory 操作入口

**Symptom**
选中可释放国家（如 Bavaria/BAY）后，Inspector 的 `countryInspectorInlineActions` 只显示 "Notes"（如果有的话），没有 Core Territory 预设的显示或操作入口。

**Root Cause**
[sidebar.js:2114-2115](js/ui/sidebar.js#L2114-L2115) 对可释放国家调用 `renderScenarioReleasableCountryDetailExtras()`，该函数 [sidebar.js:2097-2105](js/ui/sidebar.js#L2097-L2105) **只渲染 Notes**：

```js
const renderScenarioReleasableCountryDetailExtras = (container, countryState) => {
  if (countryState.notes) {
    const notesSection = appendActionSection(container, t("Notes", "ui"));
    // ...
  }
};
```

点击可释放国家时，`applyScenarioReleasableSelection()` [sidebar.js:1428-1466](js/ui/sidebar.js#L1428-L1466) 确实会**自动应用** Core Territory 预设。但这是一次性的隐式行为——用户之后无法从 UI 重新查看或重新应用这个预设。

**Impact**
- 用户点击 Bavaria → 地图上自动填色 → 但 Inspector 里看不到"填了什么"
- 如果用户随后手动修改了一些区域，没有 "重新应用 Core Territory" 的入口
- 与母国的 Inspector 体验不对称：母国有完整的 Hierarchy Groups + Regional Presets，可释放国家几乎为空

**Suggested Fix**
在可释放国家的操作区域中显示 Core Territory 预设：

```js
const renderScenarioReleasableCountryActions = (container, countryState) => {
  // Core Territory section
  const coreSection = appendActionSection(container, t("Core Territory", "ui"));
  const presetRef = getPrimaryReleasablePresetRef(countryState);
  if (presetRef) {
    renderPresetEntryRows(
      coreSection,
      presetRef.presetLookupCode,
      [{ preset: presetRef.preset, presetIndex: presetRef.presetIndex }],
      t("No core territory defined", "ui")
    );
  } else {
    coreSection.appendChild(createEmptyNote(t("No core territory defined", "ui")));
  }
  // Notes section
  if (countryState.notes) { ... }
};
```

---

### F-3 [High] 主权操作信息散落在 Toolbar 和 Sidebar 之间，剧本模式下缺语义引导

**Symptom**
用户在剧本模式下需要理解和操作的"主权系统"信息分散在两个 UI 区域：
- **Toolbar（左侧）：** Paint Mode 下拉（Visual / Sovereignty）、Active Sovereign 文字标签、Recalculate Borders 按钮
- **Sidebar（右侧）：** Set Active 按钮（在 Inspector 中）、国家列表中的 "Active" badge

**问题链：**
1. 用户在 sidebar 的 Inspector 中点击 "Set Active" → 设置 `activeSovereignCode`
2. 但当前 Paint Mode 是否为 "Sovereignty" 要看 toolbar
3. Toolbar 的 "Active Sovereign" 标签 [toolbar.js:512-520](js/ui/toolbar.js#L512-L520) 更新了，但 sidebar 中没有对应的指示
4. 在 Paint Mode = "Visual" 时，"Set Active" 按钮的语义不明确——它改变的状态只在切换到 Sovereignty 模式后才有效果
5. 在 Paint Mode = "Sovereignty" 时，点击预设/hierarchy group 的效果是"将区域所有权赋予 active sovereign"，但这在 UI 上没有任何提示

**Root Cause**
Toolbar 持有 `paintModeSelect` + `activeSovereignLabel` [index.html:61-67](index.html#L61-L67)。
Sidebar 持有 `countryInspectorSetActive` [index.html](index.html) + country list 中的 "Active" badge [sidebar.js:1548-1553](js/ui/sidebar.js#L1548-L1553)。

两者通过 `state.activeSovereignCode` 和 `state.paintMode` 间接关联，但没有 UI 层面的视觉/文案联动。

**Impact**
- 初次使用剧本模式的用户不理解 "Set Active" 是什么意思
- Paint Mode 切换不影响 sidebar 的 UI，sidebar 也不反映 Paint Mode
- 在 Sovereignty 模式下点击预设按钮，效果从 "填色" 变成 "改主权"，但按钮外观和文案完全相同

**Suggested Fix**

方案一（轻量——sidebar 内增加主权状态摘要）：
在 Inspector 面板中（或其上方）增加一行主权状态指示器：

```
Current mode: Sovereignty · Active: Germany (GER)
```

当 Paint Mode = Visual 时隐藏。这样用户在 sidebar 中就能看到完整上下文。

方案二（中等——将主权操作集中到 sidebar）：
将 Paint Mode / Active Sovereign 移入 sidebar 的一个新折叠面板 "Sovereignty"（或将其嵌入 "Scenario Actions" 面板），让 toolbar 只保留绘制工具。这样所有与"哪个国家"相关的操作都在右侧。

方案三（增强——剧本模式下自动建议 Paint Mode）：
应用剧本时自动将 Paint Mode 设为 Sovereignty 并显示提示。大多数 HOI4 剧本用户的核心需求是操作国家主权，Visual 模式在剧本下用途有限。

---

### F-4 [Medium] Legacy 区域预设在剧本模式下的消费逻辑不透明

**Symptom**
母国 Inspector（如 Germany）在剧本模式下显示 "Regional Presets"，但如果所有 legacy 预设（Bavaria、Saxony 等）都被可释放国家消费，则显示 "No regional presets"。用户看不出这些预设去了哪里。

**Root Cause**
[sidebar.js:2052-2063](js/ui/sidebar.js#L2052-L2063) `getFilteredRegionalPresets()` 过滤逻辑正确——它从 `scenarioReleasableIndex.consumedPresetNamesByParentLookup` 中读取已被消费的预设名称，并将其排除。但排除后如果列表为空，[sidebar.js:2088-2090](js/ui/sidebar.js#L2088-L2090) 只显示通用空消息：

```js
presetSection.appendChild(createEmptyNote(t("No regional presets", "ui")));
```

没有区分 "本国确实没有预设" 与 "有预设但全被可释放国家消费了"。

这也是 QA-049 F-9 的延续，但此处从更宏观的角度看：**如果这些预设已被消费，为什么 "Regional Presets" 区块还要显示？**

**Impact**
- 对不熟悉系统内部的用户，"No regional presets" 是误导性信息
- 既然预设已被重新包装为可释放国家的 Core Territory，显示一个空白区块只增加噪音

**Suggested Fix**

方案一（简洁——隐藏空的 Regional Presets）：
当所有预设都被消费后，**完全不显示** "Regional Presets" 区块，而不是显示空消息。

方案二（信息丰富——显示消费摘要）：
当存在被消费的预设时，显示一行说明：

```
3 presets assigned to releasable countries (Bavaria, Saxony, Schleswig)
```

方案三（最佳——将消费关系可视化）：
在母国的 "Releasable Countries" 区块中，为每个子国标注它消费了哪个 legacy 预设：

```
Bavaria (BAY) · uses preset "Bavaria"
Saxony (SAX) · uses preset "Saxony"
```

这样信息链完整，用户能追踪预设去了哪里。

---

### F-5 [Medium] "Releasable Countries" 子国列表应从 Inspector inline 提升为独立操作区

**Symptom**
当前 "Releasable Countries" 子国列表有两个显示位置：
1. **Country List** 中：母国行的展开/折叠子列表 → 用于导航
2. **Inspector inline actions** 中：没有显示（当前代码只渲染 Hierarchy Groups + Regional Presets）

QA-049 F-7 指出 Inspector 中的 "Releasable Countries" 区块不标识选中状态。但审查当前代码后发现：**当前版本的 `renderScenarioParentCountryActions()` [sidebar.js:2093-2095](js/ui/sidebar.js#L2093-L2095) 实际上只是 `renderParentCountryActions()` 的直接调用，不包含 Releasable Countries 子国列表。**

也就是说，母国 Inspector 中目前**没有**显示可释放子国导航。子国导航只在 Country List 的展开中存在。

**Impact**
- 如果用户在 Inspector 中查看母国，想要快速跳到某个可释放子国，必须回到 Country List 找到母国行并展开
- Country List 可能已经滚动到其他位置，需要重新定位

**Suggested Fix**
在（建议提取出的）"Scenario Actions" 面板中，为母国添加 "Releasable Countries" 导航区：

```
Scenario Actions:
  ├─ Releasable Countries  ← 子国按钮列表，标识当前选中
  ├─ Hierarchy Groups
  └─ Regional Presets（过滤后）
```

这样 Inspector 保持轻量，操作集中在 Scenario Actions 面板。

---

### F-6 [Medium] 剧本模式下预设按钮的行为语义随 Paint Mode 变化但 UI 无区分

**Symptom**
在 Inspector 或 Territories & Presets 中点击一个预设按钮（如 "Bavaria"）：
- **Paint Mode = Visual** → 将该区域的颜色覆盖为当前选中颜色
- **Paint Mode = Sovereignty** → 将该区域的主权所有者设为 `activeSovereignCode`

两种模式下按钮外观、文案完全相同。

**Root Cause**
`applyPreset()` [sidebar.js:552-622](js/ui/sidebar.js#L552-L622) 和 `applyHierarchyGroup()` [sidebar.js:487-538](js/ui/sidebar.js#L487-L538) 都在函数内部检查 `state.paintMode` 来决定行为。但调用方（UI 按钮）不传递也不显示当前模式。

**Impact**
- 用户在 Sovereignty 模式下点击预设，期望"给这块区域填色"，实际发生的是"把这块区域的主权给了 active sovereign"
- 反之亦然——用户想改主权，但处于 Visual 模式
- 这在非剧本模式下也存在，但剧本模式下影响更大，因为主权操作在剧本中更频繁

**Suggested Fix**

方案一（轻量——文案提示）：
在 Sovereignty 模式下，为预设/hierarchy 按钮添加后缀或图标：

```
Bavaria [→ GER]       ← 表示"将所有权赋予 GER"
Saxony [→ GER]
```

方案二（增强——双操作按钮）：
每个预设行提供两个按钮：
- "Fill" → 始终执行 visual 填色
- "Assign" → 始终执行主权赋予

这样操作明确，不依赖全局 Paint Mode。

---

### F-7 [Medium] `applyScenarioReleasableSelection()` 的自动填色行为是隐式的

**Symptom**
在 Country List 中点击可释放国家行（如 Bavaria），不仅选中了它，还**自动应用了** Core Territory 预设填色。这是由 `applyScenarioReleasableSelection()` [sidebar.js:1428-1466](js/ui/sidebar.js#L1428-L1466) 实现的。

但用户可能只是想查看 Bavaria 的信息，而非立即填色。

**Root Cause**
[sidebar.js:1517-1524](js/ui/sidebar.js#L1517-L1524) 中 tree click handler：

```js
main.addEventListener("click", () => {
  if (countryState.releasable && state.activeScenarioId) {
    applyScenarioReleasableSelection(countryState, {
      render: true,
      source: "tree-click",
    });
    return;
  }
  selectInspectorCountry(countryState.code);
});
```

母国点击 → 仅选中。
可释放国点击 → 选中 **+ 自动填色**。

行为不对称。

**Impact**
- 用户浏览可释放国家列表时，每次点击都会触发地图变化
- 如果处于 Sovereignty 模式，点击可释放国还会自动设 `activeSovereignCode` 并赋予主权
- 无法"只看不动"地查看可释放国家信息
- 如果用户需要 undo，每次意外的自动填色都需要一次 undo 操作

**Suggested Fix**

方案一（修改 tree click 行为）：
可释放国家的 tree click 改为仅 `selectInspectorCountry()`，与母国行为一致。将自动填色操作移到 Scenario Actions 面板中的明确按钮："Apply Core Territory"。

方案二（增加确认）：
保留自动填色但增加视觉反馈——按钮颜色或 toast 提示"Applied Core Territory for Bavaria"。

推荐方案一，原因是"点击列表行 = 导航"是通用 UI 惯例，不应附带副作用。

---

### F-8 [Low] Inspector 中 "Ordering Hint" 和 inline actions 的显隐逻辑冗余

**Symptom**
`updateScenarioInspectorLayout()` [sidebar.js:858-873](js/ui/sidebar.js#L858-L873) 控制三个元素：
1. `countryInspectorOrderingHint` — 剧本模式隐藏
2. `countryInspectorInlineActions` — 非剧本模式隐藏并清空
3. `selectedCountryActionsSection` — 剧本模式隐藏

这些显隐逻辑分散在 `updateScenarioInspectorLayout()` 和 `renderCountryInspectorDetail()` 中，且每次 `renderList()` 都会调用 `updateScenarioInspectorLayout()`，存在重复设置。

**Impact**
维护成本：修改 Inspector 布局时需要检查多处显隐逻辑是否一致。

**Suggested Fix**
统一到一个 `resolveInspectorLayoutMode()` 函数中，返回 layout descriptor 而非分散设置。

---

## Component Decomposition Proposal

### 核心思路：让 Inspector 回归"查看"，让 Actions Panel 承担"操作"

```
┌─────────────────────────────────────────────┐
│ Current (Scenario Mode)                      │
│                                              │
│ Inspector = 查看 + 颜色 + 主权 + 预设 + 层级  │
│ Territories & Presets = HIDDEN               │
│ Toolbar = Paint Mode + Active Sovereign      │
└─────────────────────────────────────────────┘

                    ↓ 重构为 ↓

┌─────────────────────────────────────────────┐
│ Proposed (Scenario Mode)                     │
│                                              │
│ Inspector = 查看 + 颜色 （轻量，~120px）      │
│   ├─ 国家名/meta/色板                        │
│   ├─ Set Active / Back to Parent             │
│   └─ 主权状态摘要行（Paint Mode + Active）    │
│                                              │
│ Scenario Actions = 操作（原 Territories slot）│
│   ├─ Releasable Countries （母国时显示）      │
│   ├─ Core Territory       （可释放时显示）    │
│   ├─ Hierarchy Groups                        │
│   ├─ Regional Presets     （过滤后，或隐藏）  │
│   └─ Notes                                   │
│                                              │
│ Toolbar = Paint Mode + Active Sovereign      │
│   （保持不变，或考虑将 Active 移入 sidebar）   │
└─────────────────────────────────────────────┘
```

### 实现路径

#### Step 1: 恢复 Territories & Presets 面板在剧本模式下的可见性

```diff
// sidebar.js updateScenarioInspectorLayout()
- selectedCountryActionsSection.classList.toggle("hidden", isScenarioMode);
- selectedCountryActionsSection.setAttribute("aria-hidden", String(isScenarioMode));
+ // 不隐藏，而是改标题和内容
```

#### Step 2: 修改 `renderPresetTree()` 在剧本模式下渲染 Scenario Actions

```diff
// sidebar.js renderPresetTree()
  if (state.activeScenarioId) {
-   return;
+   renderScenarioActionsPanel(presetTree, countryState);
+   return;
  }
```

新增 `renderScenarioActionsPanel(container, countryState)`：
- 母国 → Releasable Countries 导航 + Hierarchy Groups + Regional Presets（过滤后）
- 可释放国 → Core Territory 预设行 + Notes + "Back to Parent" 链接

#### Step 3: 从 Inspector inline actions 移除重复内容

```diff
// sidebar.js renderScenarioInspectorInlineActions()
- if (countryState.releasable) {
-   renderScenarioReleasableCountryDetailExtras(container, countryState);
- } else {
-   renderScenarioParentCountryActions(container, countryState);
- }
+ // Inspector inline actions 只保留简要指示器（如主权状态行）
+ // 详细操作由 Scenario Actions 面板承担
```

#### Step 4: 可释放国家 tree click 改为纯导航

```diff
// sidebar.js renderCountrySelectRow click handler
  if (countryState.releasable && state.activeScenarioId) {
-   applyScenarioReleasableSelection(countryState, { ... });
-   return;
+   selectInspectorCountry(countryState.code);
+   return;
  }
```

自动填色改为由 Scenario Actions 面板中的 "Apply Core Territory" 按钮触发。

#### Step 5: 可选——在 Inspector 中添加主权状态摘要行

在色板下方增加一行：

```html
<div class="inspector-sovereignty-hint">
  Mode: Sovereignty · Active: Germany (GER)
</div>
```

当 `paintMode !== "sovereignty"` 时隐藏。

---

## Priority Summary

| ID | Severity | 标题 | 修复复杂度 |
|---|---|---|---|
| F-1 | High | Inspector 剧本模式下职责过载/布局膨胀 | 中（需拆分渲染路径）|
| F-2 | High | 可释放国家 Inspector 无 Core Territory 操作入口 | 低（增加渲染调用）|
| F-3 | High | 主权操作信息散落、缺语义引导 | 中（新增 UI 元素）|
| F-4 | Medium | Legacy 预设消费逻辑不透明 | 低（改文案或隐藏空区块）|
| F-5 | Medium | Releasable Countries 子国列表应独立为操作区 | 中（拆分渲染）|
| F-6 | Medium | 预设按钮语义随 Paint Mode 变化但 UI 无区分 | 低（加文案/图标）|
| F-7 | Medium | 可释放 tree click 自动填色是隐式副作用 | 低（改 click handler）|
| F-8 | Low | Inspector 显隐逻辑冗余分散 | 低（统一函数）|

---

## Recommended Implementation Order

1. **F-1 + F-2 + F-5 一起做**：这三个的核心改动是同一件事——将剧本操作从 Inspector inline 迁移到 Territories & Presets 面板，并在面板中为可释放国家增加 Core Territory 入口。
2. **F-7**：将可释放国家 tree click 改为纯导航，配合 Step 1 中的 "Apply" 按钮。
3. **F-4**：调整 Regional Presets 空态表现。
4. **F-3 + F-6**：增加主权状态指示器和预设按钮语义区分。
5. **F-8**：代码层面的重构，可与任何上述步骤合并。

---

## 附录：QA-049 Finding 状态追踪

| QA-049 ID | 状态 | 备注 |
|---|---|---|
| F-1 | 已修复 | 颜色修改现在写入正确的颜色源 |
| F-2 | 已缓解 | Set Active 可释放国家时已增加 toast 提示 |
| F-3 | 已修复 | Reset baseline 保留导航位置 |
| F-4 | 已改善 | 搜索结果现在按父子分组并展开 |
| F-5 | 低优先级 | 诊断 warning 已存在于 `resolvePresetFeatureIds()` |
| F-6 | 未处理 | 本报告 F-1 提出了更根本的解决方向 |
| F-7 | 未处理 | 本报告 F-5 提出了更完整的替代方案 |
| F-8 | 维持 | 设计决策，当前可接受 |
| F-9 | 未处理 | 本报告 F-4 延续此问题 |
| F-10 | 已修复 | `applyScenarioBundle()` 增加了冲突检测 warning |
