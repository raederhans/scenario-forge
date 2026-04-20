# STATE_JS_SLICE_SPLIT_PLAN_2026-04-20

## 目标
- 把 `js/core/state.js` 从 356 属性的"上帝对象"拆成 8 个领域 slice + 1 个 config + 1 个事件总线
- 每一步可独立发布、独立回滚，不允许"大爆炸式"一次合入
- 明确每一步与其他步骤的**边界**（读写什么、依赖什么、会不会破坏已完成的步骤）
- 最终删除 `runtime_hooks.js` 的 60 个 `*Fn` 函数指针，改为 pub-sub 事件总线

## 背景与为什么要做
- 当前 `state.js` 一个对象字面量承载 10+ 个不相关领域：启动、拓扑、场景、渲染缓存、UI、水文、交通、dev 工具、函数指针…
- **25 个 core 模块** + **11 个 UI 模块**直接 `import { state }` 就地改写属性，任何修改都可能引发难以追踪的副作用
- 已经拆出的 `state_defaults.js` (1807 行)、`state_catalog.js`、`runtime_hooks.js` 只是搬了初始值，**运行时读写仍然是全局可写**
- 不解决这个问题，`map_renderer.js` 的分层、UI ↔ Core 解耦、单元测试的引入都没有落脚点

## 本次执行计划
- [ ] Phase 0 — 护栏（ESLint 规则 + dev Proxy 拦截 + E2E 基线）
- [ ] Phase 1 — 建立 slice 文件与 setter/getter
- [ ] Phase 2 — Proxy 门面上线（兼容旧访问路径）
- [ ] Phase 3.1 — 迁移 devSlice 消费者
- [ ] Phase 3.2 — history 函数指针改事件总线
- [ ] Phase 3.3 — 迁移 bootSlice 消费者
- [ ] Phase 3.4 — 迁移 colorSlice 消费者
- [ ] Phase 3.5 — 迁移 scenarioSlice 消费者
- [ ] Phase 3.6 — 迁移 contentSlice 消费者
- [ ] Phase 3.7 — 迁移 viewSlice + cacheSlice 消费者
- [ ] Phase 3.8 — 迁移 uiSlice 消费者
- [ ] Phase 4 — 拆除 Proxy 门面，删除 runtime_hooks.js
- [ ] 验收与并入主线

---

## 一、目标 slice 结构

```
js/core/state/
├── index.js                  # 聚合与门面（迁移期兼容层）
├── config.js                 # 不可变常量（非 state）
├── bus.js                    # 事件总线（替代 runtime_hooks）
└── slices/
    ├── bootSlice.js          # ~25 属性
    ├── contentSlice.js       # ~55 属性
    ├── scenarioSlice.js      # ~55 属性
    ├── colorSlice.js         # ~30 属性
    ├── viewSlice.js          # ~45 属性
    ├── cacheSlice.js         # ~50 属性
    ├── uiSlice.js            # ~60 属性
    └── devSlice.js           # ~25 属性
```

### 1.1 每个 slice 的归属原则与关键属性

| Slice | 归属原则 | 代表属性（节选） | 下游主要消费者 |
|---|---|---|---|
| **bootSlice** | 启动生命周期 + 基础本地化加载 | `bootPhase`、`bootProgress`、`bootError`、`startupInteractionMode`、`startupReadonly*`、`interactionInfrastructure*`、`bootMetrics`、`startupBootCacheState`、`baseLocalizationData*`、`baseGeoLocales`、`geoAliasToStableKey`、`currentLanguage` | `bootstrap/`、`main.js` |
| **contentSlice** | 外部加载的原始数据与拓扑（非 scenario 作用域） | `topology`、`topologyPrimary`、`topologyDetail`、`runtimePoliticalTopology`、`detail*`、`landData*`、`rivers/airports/ports/roads/rail*Data`、`oceanData`、`globalBathymetry*`、`urbanData`、`worldCitiesData`、`baseCity*`、`physical*`、`contextLayer*`、`hierarchyData`、`countryGroups*` | renderer、scenario_resources |
| **scenarioSlice** | scenario 作用域的全部状态 | `activeScenarioId`、`scenarioRegistry`、`scenarioBundleCacheById`、`activeScenarioChunks`、`runtimeChunkLoadState`、`scenarioCountriesByTag`、`scenarioBaseline*`、`scenarioController*`、`scenarioAutoShell*`、`scenarioData*`、`scenarioWater/LandMask/Bathymetry/District/Relief*`、`scenarioHydrationHealthGate`、scenario-`BeforeActivate` 回滚快照、releasable catalog、`scenarioAudit*` | scenario_manager、scenario_resources、renderer |
| **colorSlice** | 颜色结算 + 主权 + 调色盘 | `colors`、`countryBaseColors`、`sovereignBaseColors`、`featureOverrides`、`visualOverrides`、`waterRegionOverrides`、`specialRegionOverrides`、`sovereignty*`、`activeSovereignCode`、`ownerToFeatureIds`、全部 `palette*`、`fixedPaletteColorsByIso2`、`resolvedDefaultCountryPalette`、`colorMode`、`paintMode`、`selectedColor`、`currentPaletteTheme`、`recentColors`、`customPresets`、`presetsState`、`isEditingPreset`、`editingPreset*`、`legacyColorStateDirty` | color_manager、sovereignty_manager、palette_manager、sidebar |
| **viewSlice** | 视口 + 渲染运行时（非缓存） | `width`、`height`、`dpr*`、`zoomTransform`、`pendingZoomTransform`、`zoomGesture*`、`adaptiveSettleProfile`、`isInteracting`、`renderPhase`、`renderPassCache`（整棵树）、`staged*`、`defer*`、`pendingExact*`、`hitCanvas*`、`zoomRenderScheduled`、`referenceImage*`、`mapSemanticMode`、`dynamicBorders*`、`colorRevision`、`topologyRevision`、`contextLayerRevision`、`cityLayerRevision` | renderer、其子模块 |
| **cacheSlice** | 可被 nuke 重建的派生缓存 | `cachedBorders`、`cachedCountryBorders`、`cachedDynamic*`、`cachedFrontline*`、`cachedProvince*`、`cachedLocal*`、`cachedDetailAdmBorders`、`cachedCoastlines*`、`cachedParentBordersByCountry`、`cachedGridLines`、`parentBorder*`、`parentGroupByFeatureId`、空间索引全家 | renderer/*_owner、interaction_funnel |
| **uiSlice** | 面板、可见性、编辑器草稿、样式 | `ui`（主面板标志）、`selectedInspector*`、`expandedInspector*`、`paletteLibrary*`、`show*/allow*` 图层开关、`currentTool`、`brushMode*`、`activeDockPopover`、`hoveredId`、`tooltipRaf*`、`manualSpecialZones`、`annotationView`、`operationalLines`、`unitCounters`、各 `*Editor`、`strategicOverlayUi`、`transportWorkbenchUi`、`exportWorkbenchUi`、`*OverlayDirty`、`styleConfig` 整棵树、`historyPast/Future/Max`、`sidebarPerf` | sidebar、toolbar、dev_workspace、overlay editors |
| **devSlice** | 开发者编辑器状态 | `devHoverHit`、`devSelected*`、`devSelectionFeatureIds`、`devSelectionOrder`、`devSelectionModeEnabled`、`devSelectionLimit`、`devClipboard*`、`devRuntimeMeta*`、`devScenarioEditor`、`devScenarioTagCreator`、`devScenarioCountryEditor`、`devScenarioTagInspector`、`devScenarioCapitalEditor`、`devLocaleEditor`、`devScenarioDistrictEditor` | dev_workspace/*、toolbar dev-only |

### 1.2 从 state 里搬走（非 state）的东西

| 目标 | 去向 | 理由 |
|---|---|---|
| `countryPalette`、`defaultCountryPalette`、`legacyDefaultCountryPalette`、`countryNames`、`countryPresets`、`PALETTE_THEMES` | `state/config.js`（不可变） | 这些是常量，不应出现在可变 state 里 |
| `TINY_AREA`、`MOUSE_THROTTLE_MS` | `state/config.js` | 常量 |
| `runtime_hooks.js` 里 **60 个 `*Fn` 函数指针** | `state/bus.js`（事件总线） | 见 §3 |

---

## 二、执行步骤（详细）

### Phase 0 — 护栏

**动作**

1. 新增 `tools/eslint-rules/no-direct-state-mutation.js`（或以 `eslint-plugin-local-rules` 接入），规则逻辑：
   - 匹配 `state.<key> = ...` 的赋值表达式
   - 匹配 `Object.assign(state, ...)`
   - 白名单读入自 `tools/eslint-rules/state-writer-allowlist.json`，初始为**当前所有直接写 state 的文件清单**（可用 grep 生成）
2. 在 `js/core/state.js` 里加一个 dev-only 的 Proxy 包装：
   ```js
   export const state = __DEV__
     ? new Proxy(rawState, {
         set(t, k, v) {
           if (!(k in t)) console.warn(`[state] unknown key: ${String(k)}`);
           t[k] = v;
           return true;
         },
       })
     : rawState;
   ```
3. 加 `tests/e2e/visual_baseline.spec.js`：进入 `tno_1962` 默认视图、翻 5 次页、截 10 张关键帧存到 `tests/e2e/__baselines__/state-split-phase0/`
4. 跑一遍完整 E2E 并在 CI artifact 里保存一份 `renderPassCache.counters` 的快照 JSON 作为性能基线

**输出**

- 新增 ESLint 规则 + allowlist 文件（允许旧文件继续写，新代码不得新增直接写）
- dev build 里未知 key 会打 warning
- `__baselines__/state-split-phase0/` 视觉基线 + 性能计数器基线 JSON

**边界**

- ✅ **不影响任何运行时行为**：Proxy 仅拦截 set 做警告，allowlist 允许全部现有写法
- ✅ **不依赖任何其他 Phase**
- ⚠️ **后续 Phase 3 的每个子 PR** 都会消费这些基线（视觉对比、性能对比），Phase 0 必须先落地

### Phase 1 — 建立 slice 文件

**动作**

1. 新建 `js/core/state/slices/*.js`，8 个文件，每个导出：
   ```js
   export function createBootSlice() { return { bootPhase: "shell", ... }; }
   export function setBootPhase(root, phase, reason = "") { ... }
   export function getBootPhase(root) { return root.boot.bootPhase; }
   ```
2. 新建 `js/core/state/config.js`：把 `countryPalette / countryNames / PALETTE_THEMES / TINY_AREA / MOUSE_THROTTLE_MS` 等常量集中导出，标为 `Object.freeze`
3. 新建 `js/core/state/bus.js`：30 行左右的 pub-sub（`on/off/emit`），带 try-catch 隔离订阅者异常

**输出**

- 8 个 slice 文件，只有工厂函数和 setter，**尚未接入 state**
- `config.js` + `bus.js` 就位

**边界**

- ✅ **完全不接入运行时**：新文件不被任何模块 import，所以 0 风险
- ✅ **不依赖 Phase 0**（护栏）：技术上独立；但实操上 Phase 0 先做能拦住新增违规写法
- ⚠️ 与 Phase 2 强耦合：Phase 2 的 Proxy 门面依赖这些工厂函数

### Phase 2 — Proxy 门面上线

**动作**

1. 改写 `js/core/state.js`（现在 814 行）：
   - 把内部的 `const state = { ... }` 替换为调用 Phase 1 的工厂函数组装：
     ```js
     const slices = {
       boot: createBootSlice(),
       content: createContentSlice(),
       scenario: createScenarioSlice(),
       color: createColorSlice(),
       view: createViewSlice(),
       cache: createCacheSlice(),
       ui: createUiSlice(),
       dev: createDevSlice(),
     };
     const keyToSlice = buildKeyIndex(slices); // 启动时一次性构建
     export const state = new Proxy({}, {
       get(_, key) {
         const slice = keyToSlice[key];
         return slice ? slices[slice][key] : undefined;
       },
       set(_, key, value) {
         const slice = keyToSlice[key];
         if (!slice) { if (__DEV__) console.warn(`[state] unknown key: ${String(key)}`); return false; }
         slices[slice][key] = value;
         return true;
       },
     });
     export { slices };
     ```
2. **保留** 所有现有 `export * from "./state_defaults.js"` 等 re-export，这些是工厂依赖的常量定义
3. `runtime_hooks.js` 里的 60 个 `*Fn` 暂时并入 uiSlice（或单独作为 `hooksSlice`），**不在这一 Phase 改为事件总线**——那是 Phase 3.2 的任务

**输出**

- `state` 变成 Proxy，但消费者一行代码不改就能继续工作
- 新增 `slices` 命名空间导出（供后续 Phase 3 使用）

**边界**

- 🔴 **全量回归测试必经**：这一步改动的是最底层的导出，所有消费者都会经过 Proxy 读写。任何一个 hot path 性能下降都要在这里兜住
- ⚠️ **性能敏感路径需特殊处理**：`render()` 循环里频繁读 `state.width / state.height / state.zoomTransform` 等，若 Proxy 带来 >5% 性能下降，需要对这些属性做"穿透"（定义同名局部变量，避免每帧走 Proxy）
- ⚠️ 依赖 Phase 1 的 slice 文件已就位
- ✅ 对后续 Phase 3 的每个子 PR 都是"透明兼容层"：未迁移的代码继续用 `state.X`，已迁移的代码用 `slices.X`

### Phase 3 — 按消费者分 8 个子 PR 迁移

所有 Phase 3.* 的**统一动作模式**（每个子 PR 都遵循）：

1. 识别目标模块集合（见下表）
2. 每个模块顶部：`import { state }` → `import { slices, setXxx, getXxx } from "./state/index.js"`
3. `state.bootPhase = x` → `setBootPhase(x)`（setter 可选择性发布事件）
4. `const x = state.bootPhase` → `const x = slices.boot.bootPhase`
5. 从 `state-writer-allowlist.json` 移除当前迁移完的文件（禁止回潮）
6. 跑定向测试 + E2E smoke + 对比 Phase 0 的视觉基线和性能基线
7. 通过后合入

**迁移顺序**（按爆炸半径从小到大）：

| 子 PR | 目标 slice | 触碰模块 | 风险 | 预期 diff |
|---|---|---|---|---|
| 3.1 | devSlice | `js/ui/dev_workspace/*`、少数 toolbar 文件 | 低（开发者模式才触发） | 小 |
| 3.2 | history → bus | `js/core/history_manager.js` + 所有订阅点 | 中（所有 undo/redo 路径） | 小 |
| 3.3 | bootSlice | `js/bootstrap/*`、`js/main.js` | 中（启动链） | 中 |
| 3.4 | colorSlice | `color_manager.js`、`sovereignty_manager.js`、`palette_manager.js` | 高（视觉回归） | 大 |
| 3.5 | scenarioSlice | `scenario_manager.js`、`scenario_resources.js` | 最高 | 最大 |
| 3.6 | contentSlice | `data_loader.js`、renderer 数据入口 | 中 | 中 |
| 3.7 | viewSlice + cacheSlice | `map_renderer.js` + `renderer/*` 子模块 | 高（性能回归） | 大 |
| 3.8 | uiSlice | `sidebar.js`、`toolbar.js`、各控制器 | 中（视觉） | 最大 |

**Phase 3.2（事件总线改造）特别说明**：

`runtime_hooks.js` 里的 60 个 `*Fn` 本质是 state 里塞的"函数指针式发布-订阅"。模式替换表：

| 现状 | 迁移后 |
|---|---|
| `state.updateHistoryUIFn = fn` | `bus.on("history:changed", fn)` |
| `state.updateHistoryUIFn?.()` | `bus.emit("history:changed")` |
| `state.recomputeDynamicBordersNowFn?.()` | `bus.emit("borders:recompute-now")` |
| `state.refreshColorStateFn?.()` | `bus.emit("color:refresh-now")` |

事件命名规范：`domain:verb-object`，全小写、连字符分隔。

### Phase 4 — 拆除门面

**动作**

1. 搜索 `import\s+\{\s*state\s*\}` 在 `js/` 下应返回 0 个结果（如果非零，说明 Phase 3 漏了）
2. 搜索 `state\.\w+\s*=` 在 `js/ui/`、`js/bootstrap/`、`js/workers/` 下应返回 0 个结果
3. 删除 `js/core/state.js` 里的 Proxy 门面，只保留各 slice 的 re-export（供向后兼容或 debug console）
4. 删除 `runtime_hooks.js`（Phase 3.2 + 后续 slice 迁移都做完后，60 个 `*Fn` 应该全部已改事件）
5. 删除 `tools/eslint-rules/state-writer-allowlist.json`（allowlist 应已为空，规则可升级为"全局禁止 state 直接写"）

**输出**

- Proxy 兼容层消失
- runtime_hooks.js 消失
- ESLint 规则变成硬性全局禁令

**边界**

- ⚠️ 依赖 Phase 3.1–3.8 全部完成，任何一个未完就不能拆门面
- ✅ 拆门面本身是纯删除，不引入新行为；但删除后**任何人无意中写 `state.X`** 会立即 ESLint 报错并运行时 undefined，所以文档里要明确"新代码应导入具体 slice"

---

## 三、步骤之间的边界矩阵（是否会互相影响）

这是最容易被忽略的表格。**✅ = 相互独立；🔗 = 强依赖；⚠️ = 弱依赖/需注意**。

|  | Phase 0 | Phase 1 | Phase 2 | Phase 3.1 | Phase 3.2 | Phase 3.3 | Phase 3.4 | Phase 3.5 | Phase 3.6 | Phase 3.7 | Phase 3.8 | Phase 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Phase 0 护栏 | — | ✅ | ⚠️ | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 |
| Phase 1 建 slice 文件 | ✅ | — | 🔗 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔗 |
| Phase 2 Proxy 门面 | ⚠️ | 🔗 | — | 🔗 | ⚠️ | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 |
| Phase 3.1 devSlice | 🔗 | ✅ | 🔗 | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔗 |
| Phase 3.2 history→bus | 🔗 | ✅ | ⚠️ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔗 |
| Phase 3.3 bootSlice | 🔗 | ✅ | 🔗 | ✅ | ✅ | — | ✅ | ✅ | ⚠️ | ✅ | ✅ | 🔗 |
| Phase 3.4 colorSlice | 🔗 | ✅ | 🔗 | ✅ | ✅ | ✅ | — | ⚠️ | ✅ | ✅ | ⚠️ | 🔗 |
| Phase 3.5 scenarioSlice | 🔗 | ✅ | 🔗 | ✅ | ✅ | ✅ | ⚠️ | — | ⚠️ | ✅ | ✅ | 🔗 |
| Phase 3.6 contentSlice | 🔗 | ✅ | 🔗 | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | — | ⚠️ | ✅ | 🔗 |
| Phase 3.7 view+cache | 🔗 | ✅ | 🔗 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | ⚠️ | 🔗 |
| Phase 3.8 uiSlice | 🔗 | ✅ | 🔗 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | — | 🔗 |
| Phase 4 拆门面 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | 🔗 | — |

### 3.1 关键边界说明（为什么这么标）

- **Phase 0 与 Phase 1 / Phase 2 独立**：Phase 0 仅装护栏（ESLint + warning proxy），不改任何 slice；Phase 1 只建新文件；两者改的不是同一处代码，完全可以并行起草 PR，但合并顺序必须 0 → 1 → 2
- **Phase 1 与 Phase 2 是强依赖**：Proxy 门面需要调用 `createXxxSlice()` 工厂，工厂必须先就位
- **Phase 3.1 到 Phase 3.8 之间大多互相 ✅**：因为它们迁移的是**不同消费者集合**，改的不是同一批文件。只要 Phase 2 的 Proxy 在，未迁移模块继续用 `state.X`，已迁移模块用 `slices.X`，互不干扰
- **Phase 3.3（boot）↔ Phase 3.6（content）⚠️**：启动链既读 bootSlice 又读 contentSlice（`state.topology`、`state.landData` 在 boot 流程中被填充）。迁移 boot 的 PR 里允许**临时**保留 content 相关属性走 Proxy，直到 Phase 3.6 完成
- **Phase 3.4（color）↔ Phase 3.5（scenario）⚠️**：scenario 激活时会修改 color 的 `sovereigntyByFeatureId`、`colors`、`featureOverrides`；scenario PR 里对这些属性的读写要继续走 Proxy（或临时用 `slices.color.*`），不在 scenario PR 里动 color 消费者
- **Phase 3.6（content）↔ Phase 3.7（view+cache）⚠️**：renderer 在创建空间索引时既读 contentSlice（`landData`）又写 cacheSlice（`spatialIndex`、`landIndex`）。迁移顺序上要先做 content（renderer 只读），再做 view+cache（renderer 写缓存）
- **Phase 3.2（history→bus）与 Phase 2（Proxy）⚠️**：事件总线本身与 Proxy 无关，但 `state.updateHistoryUIFn = fn` 这种写法仍然会走 Proxy 直到 Phase 3.2 完成把它改为 `bus.on(...)`
- **Phase 4 对所有前置都是 🔗**：拆门面要求前面全部完成，任何一个子 Phase 没做完都不能进 Phase 4

### 3.2 允许并行/不允许并行的组合

**允许同时开 PR**（互不阻塞）：
- Phase 3.1（dev）+ Phase 3.3（boot）+ Phase 3.2（history→bus）可并行起草，彼此改动文件集合不重叠
- Phase 3.8（ui）可与 Phase 3.5（scenario）之外的任何 slice 并行

**必须串行**（后者依赖前者的中间结果）：
- Phase 0 → Phase 2 → Phase 3.*（任何一个）→ Phase 4
- Phase 3.6（content）必须早于 Phase 3.7（view+cache）
- Phase 3.5（scenario）宜早于 Phase 3.4（color），因为 scenario 写的属性更多、变动更大，先定型再迁 color 能减少返工

---

## 四、每一 Phase 的回滚机制

| Phase | 失败信号 | 回滚动作 | 影响面 |
|---|---|---|---|
| Phase 0 | ESLint 误报阻塞主线开发 | 把规则降级为 `warn` 或暂时扩大 allowlist | 无运行时影响 |
| Phase 1 | 工厂函数默认值与旧 state_defaults 不一致 | `git revert` 本 PR | 无运行时影响（新文件未被 import） |
| Phase 2 | 启动失败 / 性能回归 >5% | `git revert` 本 PR，回到直接 `const state = {...}` | 全量回归 |
| Phase 3.x | E2E smoke 红 / 视觉基线差异 / 性能计数器差异 >5% | `git revert` 当前子 PR，仅该 slice 的消费者回到走 Proxy | 仅影响该 slice 对应领域 |
| Phase 4 | 任意模块运行时报 `state.X is undefined` | `git revert` 本 PR，Proxy 门面回来接管 | 全量 |

**回滚原则**：任何 Phase 的回滚都不应触发其他 Phase 的回滚。Phase 2 Proxy 的设计就是为了让 Phase 3.x 的回滚**粒度精确到一个 slice**——未迁移的消费者永远走 Proxy，回滚只是把"已迁移"改回"未迁移"。

---

## 五、验收标准（完成的定义）

- [ ] `js/core/state/slices/` 目录存在，8 个文件齐全，默认值与原 `state_defaults.js` 一致
- [ ] `js/core/state/bus.js` 存在，有单元测试覆盖 on/off/emit/异常隔离
- [ ] `runtime_hooks.js` 已删除
- [ ] 搜索 `import\s+\{\s*state\s*\}` 在 `js/` 下零匹配
- [ ] 搜索 `state\.\w+\s*=` 在 `js/ui/`、`js/bootstrap/`、`js/workers/` 零匹配
- [ ] Phase 0 建立的视觉基线 10 帧截图与最终版本 pixel-diff < 0.5%
- [ ] Phase 0 建立的 `renderPassCache.counters` 性能基线与最终版本差异 < 5%
- [ ] `history_manager` 的 undo/redo 往返 10 次后内存快照无泄漏
- [ ] 新增 3 篇文档：`docs/STATE_SLICES_GUIDE.md`（各 slice 职责 + 使用范例）、`docs/EVENT_BUS_GUIDE.md`（事件命名、订阅生命周期）、本文件结尾的"实际执行回填"小节
- [ ] `tools/eslint-rules/no-direct-state-mutation.js` 升级为全局硬禁

---

## 六、相关文件清单

**主要改动文件**

| 文件 | 行数（当前） | 预计变更 |
|---|---|---|
| [js/core/state.js](../../js/core/state.js) | 814 | 改写为 Proxy + slices re-export |
| [js/core/state_defaults.js](../../js/core/state_defaults.js) | 1807 | 默认值按 slice 分发 |
| [js/core/state_catalog.js](../../js/core/state_catalog.js) | 28 | 并入 scenarioSlice |
| [js/core/runtime_hooks.js](../../js/core/runtime_hooks.js) | 75 | 删除 |
| [js/core/history_manager.js](../../js/core/history_manager.js) | 350 | 改用事件总线 |

**新增文件**

- `js/core/state/index.js`
- `js/core/state/config.js`
- `js/core/state/bus.js`
- `js/core/state/slices/bootSlice.js`
- `js/core/state/slices/contentSlice.js`
- `js/core/state/slices/scenarioSlice.js`
- `js/core/state/slices/colorSlice.js`
- `js/core/state/slices/viewSlice.js`
- `js/core/state/slices/cacheSlice.js`
- `js/core/state/slices/uiSlice.js`
- `js/core/state/slices/devSlice.js`
- `tools/eslint-rules/no-direct-state-mutation.js`
- `tools/eslint-rules/state-writer-allowlist.json`
- `tests/e2e/visual_baseline.spec.js`
- `tests/test_state_bus_contract.py`（或对应 JS 单元测试）

---

## 七、实际执行回填

（随着 Phase 实际推进，在此填入每 Phase 的 PR 链接、实际结论、与原计划的偏差）

- [ ] Phase 0 — PR #__ — 结论：
- [ ] Phase 1 — PR #__ — 结论：
- [ ] Phase 2 — PR #__ — 结论：
- [ ] Phase 3.1 — PR #__ — 结论：
- [ ] Phase 3.2 — PR #__ — 结论：
- [ ] Phase 3.3 — PR #__ — 结论：
- [ ] Phase 3.4 — PR #__ — 结论：
- [ ] Phase 3.5 — PR #__ — 结论：
- [ ] Phase 3.6 — PR #__ — 结论：
- [ ] Phase 3.7 — PR #__ — 结论：
- [ ] Phase 3.8 — PR #__ — 结论：
- [ ] Phase 4 — PR #__ — 结论：
