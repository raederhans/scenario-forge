# Mapcreator 架构审核报告（2026-04-20）

## Context（为什么要做这次审核）

用户在最近多次 commit 和 PR 中完成了一轮"大文件拆分"工作——`renderer/` 子模块、`bootstrap/` 启动链、`toolbar/` `sidebar/` 控制器都被从单体文件中剥离出来。拆分之后，用户希望从**更高的维度**重新审视：架构是否真正合理，构建/运行/维护链路是否最优，未来是否有扩展空间。

**结论先行**：近期的拆分解决了"单文件太长看不过来"的症状，但没有触及**深层架构债**。如果不处理这些根问题，未来每加一个 scenario 类型、每引入一个新渲染层、每接入一套新数据源，都会在 state.js 和 map_renderer.js 上留下新伤口。

---

## 一、代码架构层面的核心问题

### 1.1 state.js 是真正的"上帝对象"（最严重）

- 单个对象字面量 **356 个顶级属性**，覆盖 10+ 个完全不相关的领域（启动阶段、拓扑、场景、渲染缓存、UI、水文、交通、dev 工具、函数指针…）
- **25 个 core 模块** + **11 个 UI 模块**直接 `import { state }` 并就地改写属性
- 还在通过 `state.updateHistoryUIFn`、`state.recomputeDynamicBordersNowFn` 这种"状态里塞函数指针"的方式做回调链（[history_manager.js:24-45](js/core/history_manager.js)），一次修改可能触发二次修改，调试时无法预测影响范围
- **拆出的 `state_defaults.js` (1807 行) 和 `state_catalog.js` 是症状治理**——只是把"初始值"搬家了，运行时的读写仍然是全局可写

> 🔴 **这是所有其他问题的放大器**。只要 state 仍然是全局可写对象，renderer/manager/UI 都无法单独测试、无法独立替换。

### 1.2 map_renderer.js 依然是 22,847 行的门面（严重）

- 虽然拆出了 `renderer/` 下 10 个子模块（border_draw_owner、political_collection_owner 等），但 **map_renderer 仍然持有全局的 canvas/context/cache，子模块通过回调反向修改它** —— 这是"所有者模式"而非真正的"职责分离"
- 末尾导出 50+ 函数，**公共 API、内部工具、dev-only 工具混在一个 export 里**（`render`, `getSafeCanvasColor`, `addFeatureToDevSelection` 平级），外部调用方无法判断稳定性
- Canvas 层与 SVG 层**没有清晰的分界线**：`mapCanvas` / `hitCanvas` / `mapSvg` 都在同一个模块里被命令式地创建、更新、销毁

### 1.3 UI ↔ Core 双向循环依赖（中等严重）

- `core/map_renderer.js` → `ui/toast.js`、`ui/i18n.js`（向上依赖 UI）
- `ui/sidebar.js` → 13 个 core 模块；`ui/toolbar.js` → 10 个 core 模块（向下依赖 Core）
- 形成一个**无法独立部署任何一层**的耦合图。未来如果想把编辑器嵌到别的宿主里、或者给 pages 做只读版本，整个依赖图都要拆

### 1.4 scenario_manager / scenario_resources 职责重叠（中等）

两个模块都 1300+ 行，都引用 20+ 相同依赖，都在相同的 state 属性上操作。边界从命名上看是"生命周期 vs 资源加载"，但代码里没有这条线。任何一个涉及 scenario 的 bug 都要同时读两个文件。

### 1.5 缺少"纯函数层"导致无法单元测试（未来瓶颈）

所有渲染、颜色计算、场景变换都是命令式代码，直接读写 state 和 DOM，没有可脱离浏览器运行的纯函数入口。结果就是 **tests/ 下 80+ 个测试基本都是 contract 测试和 E2E**，几乎没有单元测试。这会随着项目长大变成不可维护的主要原因。

---

## 二、构建/运行/维护链路的问题

### 2.1 工具链只支持 Windows

- `build_data.bat` / `run_server.bat` / `start_dev.bat` 三个 .bat 是唯一入口；没有 Makefile、没有 shell 脚本、没有 `npm scripts` 对应
- Linux/Mac 协作者无法本地启动；CI 在 Ubuntu 跑的是 Python 脚本，与本地路径实际上是两条链

### 2.2 tools/ 与 map_builder/ 的职责边界模糊

- `tools/` 下 80+ 个 Python 脚本，有构建、审计、补丁、发布、dev 服务器混杂
- `map_builder/` 是"服务层 + contracts"，但 `tools/publish_scenario_*.py` 与 `map_builder/scenario_publish_service.py` 有明显重叠
- 新增 `tools/app_entry_resolver.py` 是正确方向（抽共享逻辑），但同类重构没有铺开

### 2.3 没有依赖锁文件

- `requirements.txt` 13 行，全部**无版本 pin**
- 没有 `requirements.lock` / `poetry.lock`
- CI 用 Python 3.12，`.bat` 用任意 Python 3.x，本地和 CI 可能拉到不同的小版本

### 2.4 git 里有不该在的东西

- `historic geographic overhaul/` 目录 **1.2 GB**（HOI4 mod 源文件备份），即便加了 .gitignore 也已经在历史里
- 根目录一个 `8432` 文件内容只是 `83272`（可能是某次调试的端口号残留）
- `.omx/metrics.json`、`.omx/state/update-check.json` 出现在 git status（工具副产物，应该 ignore）

### 2.5 文档链路新手无法 30 分钟上手

- **无 CLAUDE.md**（项目高层架构图、数据流、术语表）
- **无 CONTRIBUTING.md**（commit 规范、分支策略、测试要求）
- `AGENTS.md` 是给 AI 看的
- `lessons learned.md` 125 KB 全中文，对维护者价值极高但对新手不友好
- commit message **中英混用**（"完成 renderer 拆分" vs "refactor map_renderer owner pass-through"）

### 2.6 CI 有存量红灯

- 5 个 `test_ui_rework_*_contract.py` 仍检查拆分前的文件路径
- GitHub Actions 版本未 pin（`actions/checkout@v4` 而非 `@v4.1.1`）
- 长任务无 `timeout-minutes` 兜底
- `docs/active/startup_and_pages_chain_stabilization_2026-04-20/task.md` 已列出这些，但未完成

---

## 三、面向未来的改进建议（按 ROI 排序）

### Tier 1 — 如果只做一件事（高 ROI，解锁一切）

**🎯 拆分 state.js 为领域切片 + 引入单向数据流**

具体做法：

1. 把 `state.js` 按领域拆成 5–6 个 slice（`bootState`、`topologyState`、`scenarioState`、`renderState`、`uiState`、`devState`）
2. 每个 slice 导出 `getXxx()` 读访问器和 `setXxx(patch)` 写访问器
3. **禁止跨 slice 直接写**（可以先用 ESLint 规则，后续引入 Proxy 拦截兜底）
4. 把 `state.updateHistoryUIFn` 这类函数指针改为 **pub-sub 事件总线**（`bus.emit('history:changed')`，UI 层订阅）

**为什么这是 Tier 1**：做完这一步，map_renderer 就可以变成"接收 renderState 切片 → 输出像素"的纯渲染器；sidebar/toolbar 就不再需要 13–26 个直接 import；纯函数层和单元测试自然就落地了。

**风险**：需要触碰 25+ 模块，要分批做，每一批都要过 E2E 回归。

### Tier 2 — 架构分层

1. **破除 UI ↔ Core 循环**：把 `toast.js` / `i18n.js` 移到 `shared/`，map_renderer 不再直接调 UI，改用事件总线
2. **明确 map_renderer 的公共 API**：新建 `map_renderer/public.js` 只 re-export 稳定 API，其他导出都标 `@internal`
3. **scenario_manager vs scenario_resources 收敛**：要么合并，要么在两个文件顶部写明职责边界的 JSDoc
4. **提取纯函数层**：`core/logic/color_computations.js`、`core/logic/scenario_transforms.js` 等，不依赖 state、可在 Node 下跑 unit test

### Tier 3 — 构建与维护链路

1. **补 Makefile 或 `scripts/` 下的跨平台 Node/Python 入口**，让 .bat 变成薄壳（保留给 Windows 用户）
2. **生成 `requirements.lock`**（pip-tools 或 uv），CI 改用 lock 安装
3. **补 `CLAUDE.md`、`CONTRIBUTING.md`、`.env.example`、`docs/DEVELOPMENT.md`**（30 分钟上手路径）
4. **清理 git 历史里的 1.2 GB 垃圾**（BFG 或 `git filter-repo`，需要全团队配合 re-clone；如果目前是单人开发更容易做）
5. **pin GitHub Actions 版本**，所有 job 加 `timeout-minutes`
6. **确立 commit message 语言策略**（建议全英文 + husky commit-msg hook 校验）

### Tier 4 — 性能与产物

1. **引入打包器**（Vite 最轻）：解锁 tree-shaking、source map、code splitting；首屏仅加载关键路径
2. **`js/core/city_lights_*.js` (1 MB+ 生成产物)** 确认是否该在 git 里，不该就搬到 `data/` 并加 .gitignore
3. **`data/europe_topology*.json` 多版本命名**：明确哪个是"runtime 生产版"，其他归档到 `data/archive/`

---

## 四、关键文件清单（重构时会被触碰的）

| 文件 | 行数 | 变更类型 |
|---|---|---|
| [js/core/state.js](js/core/state.js) | 814 | 拆分为 slice |
| [js/core/state_defaults.js](js/core/state_defaults.js) | 1807 | 跟随 slice 重组 |
| [js/core/map_renderer.js](js/core/map_renderer.js) | 22847 | 外部接口收敛，内部分层 |
| [js/ui/sidebar.js](js/ui/sidebar.js) | 5463 | 继续向 `ui/sidebar/` 下沉 |
| [js/ui/toolbar.js](js/ui/toolbar.js) | 3384 | 继续向 `ui/toolbar/` 下沉 |
| [js/core/scenario_manager.js](js/core/scenario_manager.js) | 1394 | 与 resources 划清界 |
| [js/core/scenario_resources.js](js/core/scenario_resources.js) | 1338 | 同上 |
| [js/core/history_manager.js:24-45](js/core/history_manager.js) | — | 函数指针改事件总线 |
| `CLAUDE.md`、`CONTRIBUTING.md`、`docs/DEVELOPMENT.md` | — | 新建 |
| `requirements.lock`、`.python-version`、`.env.example` | — | 新建 |
| `Makefile` 或 `scripts/dev.sh` | — | 新建（跨平台） |

---

## 五、state.js 拆分方案（Tier 1 详细展开）

### 5.1 现状定量

精读 `js/core/state.js` (814 行) + `state_defaults.js` + `state_catalog.js` + `runtime_hooks.js` 后，356 个属性自然落在 **22 个细粒度领域**。直接切 22 个 slice 太碎（会复刻上帝对象问题），也不能再切回 5–6 个（仍是门面）。折中方案：**8 个 slice + 1 个 config 模块 + 1 个事件总线**，细领域作为 slice 内部的子对象存在。

### 5.2 目标 slice 结构

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

### 5.3 每个 slice 的归属原则与关键属性

| Slice | 归属原则 | 代表属性（节选） | 下游主要消费者 |
|---|---|---|---|
| **bootSlice** | 启动生命周期 + 基础本地化加载 | `bootPhase`、`bootProgress`、`bootError`、`startupInteractionMode`、`startupReadonly*`、`interactionInfrastructure*`、`bootMetrics`、`startupBootCacheState`、`baseLocalizationData*`、`baseGeoLocales`、`geoAliasToStableKey`、`currentLanguage` | `bootstrap/`、main.js |
| **contentSlice** | 外部加载的原始数据与拓扑（非 scenario 作用域） | `topology`、`topologyPrimary`、`topologyDetail`、`runtimePoliticalTopology`、`detail*`、`landData*`、`rivers/airports/ports/roads/rail*Data`、`oceanData`、`globalBathymetry*`、`urbanData`、`worldCitiesData`、`baseCity*`、`physical*`、`contextLayer*`、`hierarchyData`、`countryGroups*`、`countryInteractionPoliciesByCode` | renderer、scenario_resources |
| **scenarioSlice** | scenario 作用域的全部状态 | `activeScenarioId`、`scenarioRegistry`、`scenarioBundleCacheById`、`activeScenarioChunks`、`runtimeChunkLoadState`、`scenarioCountriesByTag`、`scenarioBaseline*`、`scenarioController*`、`scenarioAutoShell*`、`scenarioData*`、`scenarioWater/LandMask/Bathymetry/District/Relief*`、`scenarioHydrationHealthGate`、scenario-`BeforeActivate` 回滚快照、releasable catalog、`scenarioAudit*` | scenario_manager、scenario_resources、renderer |
| **colorSlice** | 颜色结算 + 主权 + 调色盘 | `colors`、`countryBaseColors`、`sovereignBaseColors`、`featureOverrides`、`visualOverrides`、`waterRegionOverrides`、`specialRegionOverrides`、`sovereignty*`、`activeSovereignCode`、`ownerToFeatureIds`、全部 `palette*`、`fixedPaletteColorsByIso2`、`resolvedDefaultCountryPalette`、`colorMode`、`paintMode`、`selectedColor`、`currentPaletteTheme`、`recentColors`、`customPresets`、`presetsState`、`isEditingPreset`、`editingPreset*`、`legacyColorStateDirty` | color_manager、sovereignty_manager、palette_manager、sidebar |
| **viewSlice** | 视口 + 渲染运行时（非缓存） | `width`、`height`、`dpr*`、`zoomTransform`、`pendingZoomTransform`、`zoomGesture*`、`adaptiveSettleProfile`、`isInteracting`、`renderPhase`、`phaseEnteredAt`、`renderPhaseTimerId`、`pendingDayNightRefresh`、`colorRevision`、`topologyRevision`、`contextLayerRevision`、`cityLayerRevision`、`mapSemanticMode`、`dynamicBorders*`、`pendingDynamicBorderTimerId`、`renderPassCache`（整棵树）、`staged*`、`defer*`、`pendingExact*`、`exactAfterSettleHandle`、`hitCanvas*`、`zoomRenderScheduled`、`referenceImage*`、`debugCountryCoverage` | renderer、其子模块 |
| **cacheSlice** | 可被 nuke 重建的派生缓存 | `cachedBorders`、`cachedCountryBorders`、`cachedDynamic*`、`cachedFrontline*`、`cachedProvince*`、`cachedLocal*`、`cachedDetailAdmBorders`、`cachedDynamicBordersHash`、`cachedCoastlines*`、`cachedParentBordersByCountry`、`cachedGridLines`、`parentBorder*`、`parentGroupByFeatureId`、空间索引全家（`landIndex`、`spatial*`、`waterSpatial*`、`specialSpatial*`、`runtimeFeatureIndexById`、`runtimeFeatureIds`、`runtimeNeighborGraph`、`runtimeCanonicalCountryByFeatureId`、`runtimePoliticalMeta*`、`projectedBoundsById`、`sphericalFeatureDiagnosticsById`、`waterRegionsById`、`specialRegionsById`） | renderer/*_owner、interaction_funnel |
| **uiSlice** | 面板、可见性、编辑器草稿、样式 | `ui`（主面板标志）、`selectedInspector*`、`inspectorHighlight*`、`expandedInspector*`、`expandedPresetCountries`、`paletteLibrary*`、`onboardingDismissed`、`isDirty`、`dirtyRevision`、`show*/allow*` 图层开关、`currentTool`、`brushMode*`、`activeDockPopover`、`interactionGranularity`、`batchFillScope`、`hoveredId`、`hovered*RegionId`、`selected*RegionId`、`tooltipRaf*`、`manualSpecialZones`、`annotationView`、`operationalLines`、`operationGraphics`、`unitCounters`、各 `*Editor`、`strategicOverlayUi`、`transportWorkbenchUi`、`exportWorkbenchUi`、`*OverlayDirty` 标志组、`styleConfig` 整棵树、`historyPast/Future/Max`、`sidebarPerf` | sidebar、toolbar、dev_workspace、overlay editors |
| **devSlice** | 开发者编辑器状态 | `devHoverHit`、`devSelected*`、`devSelectionFeatureIds`、`devSelectionOrder`、`devSelectionModeEnabled`、`devSelectionLimit`、`devSelectionOverlayDirty`、`devSelectionSortMode`、`devClipboard*`、`devRuntimeMeta*`、`devScenarioEditor`、`devScenarioTagCreator`、`devScenarioCountryEditor`、`devScenarioTagInspector`、`devScenarioCapitalEditor`、`devLocaleEditor`、`devScenarioDistrictEditor` | dev_workspace/*、toolbar dev-only |

### 5.4 从 state 里搬走（非 state）的东西

| 目标 | 去向 | 理由 |
|---|---|---|
| `countryPalette`、`defaultCountryPalette`、`legacyDefaultCountryPalette`、`countryNames`、`countryPresets`、`PALETTE_THEMES` | `state/config.js`（不可变） | 这些是常量，不应出现在可变 state 里 |
| `TINY_AREA`、`MOUSE_THROTTLE_MS` | `state/config.js` | 常量 |
| `runtime_hooks.js` 里 **60 个 `*Fn` 函数指针** | `state/bus.js`（事件总线） | 见 5.6 |

### 5.5 迁移策略：五阶段门面替换法

直接改 36 个消费者是自杀式操作。分阶段做，**每一阶段单独可发布、可回退、可过 E2E**。

**Phase 0 — 护栏（半天）**

1. 引入 ESLint 规则 `no-direct-state-mutation`（或自写插件），白名单仅包含旧文件；后续新增的代码默认禁止 `state.X = ...`
2. 在 dev build 下包一层 Proxy，拦截写入，未声明的 key 走 `console.warn` + 计数
3. 建立基线指标：运行一遍完整 E2E，记录每个 slice 的访问热度（后面用于确认迁移覆盖）

**Phase 1 — 建立 slice 文件（1–2 天）**

为每个 slice 创建文件，**复制**相关默认值进去，导出 `createXxxSlice()` 工厂：

```js
// slices/bootSlice.js
export function createBootSlice() {
  return {
    bootPhase: "shell",
    bootMessage: "Starting workspace…",
    bootProgress: 0,
    // ...（所有 boot 属性）
  };
}
export function setBootPhase(state, phase, reason = "") {
  state.boot.bootPhase = phase;
  bus.emit("boot:phase-changed", { phase, reason });
}
// ... 其他 setter
```

**Phase 2 — 聚合门面（1 天，关键步骤）**

改写 `state.js` 的 `state` 导出为 **Proxy 门面**，保留旧的扁平访问语义：

```js
// state/index.js
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
const keyToSlice = buildKeyIndex(slices); // 编译期生成，一次性

export const state = new Proxy({}, {
  get(_, key) {
    const slice = keyToSlice[key];
    if (!slice) return undefined;
    return slices[slice][key];
  },
  set(_, key, value) {
    const slice = keyToSlice[key];
    if (!slice) {
      if (__DEV__) console.warn(`[state] unknown key: ${String(key)}`);
      return false;
    }
    slices[slice][key] = value;
    return true;
  },
});

export { slices }; // 供已迁移的模块直接用
```

**关键收益**：现存的 25+ 模块**一行代码不改**依然工作（`state.bootPhase` 被 Proxy 路由到 `slices.boot.bootPhase`）。同时内部结构已分层。

**Phase 3 — 按消费者迁移（分多个 PR，每 PR 一个域，2–4 周）**

迁移顺序按"读写最集中 + 爆炸半径最小"排序：

| 顺序 | 迁移目标 | 触碰模块 | 估算 diff | 风险 |
|---|---|---|---|---|
| 1 | **devSlice** | `dev_workspace/*`、少数 toolbar | 小 | 低（开发者模式才用） |
| 2 | **historySlice → bus** | `history_manager.js`、触发点 | 小 | 中（所有 undo/redo 路径） |
| 3 | **bootSlice** | `bootstrap/*`、`main.js` | 中 | 中（启动链） |
| 4 | **colorSlice** | `color_manager.js`、`sovereignty_manager.js`、`palette_manager.js` | 大 | 高（视觉回归） |
| 5 | **scenarioSlice** | `scenario_manager.js`、`scenario_resources.js` | 最大 | 最高 |
| 6 | **contentSlice** | `data_loader.js`、renderer 数据入口 | 中 | 中 |
| 7 | **viewSlice + cacheSlice** | `map_renderer.js` + `renderer/*` | 大 | 高（性能回归） |
| 8 | **uiSlice** | `sidebar.js`、`toolbar.js`、各控制器 | 最大 | 中（视觉） |

每个 PR 的单元动作：

1. 在目标模块顶部用 `import { slices, setBootPhase, ... } from "./state/index.js"` 替代 `import { state }`
2. 把 `state.bootPhase = x` 改成 `setBootPhase(x)`
3. 把 `const x = state.bootPhase` 改成 `const x = slices.boot.bootPhase`（或加 `getBootPhase()`）
4. 从该文件的 ESLint 白名单中移除自己（禁止回潮）
5. 跑定向测试 + E2E smoke

**Phase 4 — 拆除门面（1 天）**

当所有消费者都迁移完毕，`state` Proxy 只剩自己使用，此时：

1. 搜索 `import { state }` 从 js/ 应返回 0 个结果
2. 删除 `state.js` 的 Proxy 门面，仅保留各 slice 的 re-export
3. 删除 ESLint 白名单

### 5.6 函数指针 → 事件总线（并行进行）

`runtime_hooks.js` 里的 60 个 `*Fn` 是最隐蔽的耦合。它们的调用模式几乎都是：

```js
// 某处
state.updateHistoryUIFn = () => { /* UI 更新 */ };
// 另一处
if (typeof state.updateHistoryUIFn === "function") {
  state.updateHistoryUIFn();
}
```

这是用 state 做发布-订阅，但没有类型安全、没有订阅/取消、无法调试。**直接替换为一个轻量 bus**（30 行代码即可，不需要第三方库）：

```js
// state/bus.js
const listeners = new Map();
export const bus = {
  on(event, fn) {
    const set = listeners.get(event) ?? new Set();
    set.add(fn); listeners.set(event, set);
    return () => set.delete(fn);
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) { try { fn(payload); } catch (e) { console.error(e); } }
  },
};
```

**迁移规则**：

| 现状 | 迁移后 |
|---|---|
| `state.updateHistoryUIFn = fn` | `bus.on("history:changed", fn)` |
| `state.updateHistoryUIFn?.()` | `bus.emit("history:changed")` |
| `state.recomputeDynamicBordersNowFn?.()` | `bus.emit("borders:recompute-now")` |
| `state.refreshColorStateFn?.()` | `bus.emit("color:refresh-now")` |

**收益**：

1. history_manager 不再知道谁在听它（解耦）
2. 可以 `console.log(bus._listeners)` 在运行时审计
3. 测试可以 `bus.emit("color:refresh-now")` 单独触发任一路径
4. 最终删除 `runtime_hooks.js`（60 个指针全部废弃）

### 5.7 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| Proxy 性能开销（heated loop） | 热路径（render tick, mousemove）**直接用 `slices.view.*`**，不走 Proxy；Proxy 只服务于未迁移模块 |
| 属性归类错误（某属性实际跨 slice 使用） | Phase 0 跑全量 E2E 时记录 key 热度，交叉引用决定归属；如确有跨 slice，以**读方**为主归属 |
| Worker 里也访问 state 快照 | `startup_boot.worker.js` 接收的是**序列化过的子集**，只要 postMessage 的形状不变，slice 重组不影响 worker |
| history_manager 深拷快照依赖 state 扁平结构 | 在 Phase 2 的 Proxy 里提供 `toSnapshot()` 返回扁平化视图；迁移到 Phase 4 后改用各 slice 自己的 `snapshot()` 聚合 |
| 大 PR 合并冲突 | 每个迁移 PR 控制在 < 500 行 diff，依序合并，主分支 rebase 前各自先合 |
| E2E 看不出的视觉回归 | 在 `tests/e2e/` 里加 Playwright 截图对比基线（当前 smoke 不做视觉对比） |

### 5.8 可衡量的完成标准

- [ ] `js/core/state/slices/` 目录存在，8 个文件齐全
- [ ] `runtime_hooks.js` 删除，`bus.js` 承接所有事件
- [ ] 搜索 `state\.\w+\s*=` 在 `js/core/` 外（即 ui/、bootstrap/）零匹配
- [ ] 搜索 `import \{ state \}` 零匹配（只允许 `import { slices }` 或领域 setter）
- [ ] E2E smoke 全绿，关键视觉截图与 Phase 0 基线一致
- [ ] `history_manager` 的 undo/redo 往返 10 次无状态泄漏（Phase 0 基线对比）
- [ ] `renderPassCache` 计数器在交互 1 分钟后各项数值差异 < 5%（性能回归闸）

---

## 六、落地与验证

**用户已确认方向采纳 Tier 1（state.js 拆分）。** 本文件即为 Tier 1 的蓝图，执行时按如下规则：

1. **不在本文件写代码**。本文件是"蓝图"，真正动手时每个 Phase 起一个独立 PR，对应一个短任务清单（TodoWrite 跟踪）。
2. **Phase 0 必须先做**。没有护栏就动手搬 356 个属性等于拆炸弹。
3. **每个 Phase 3 子 PR 必须通过**：
   - 定向单元测试（针对迁移模块）
   - E2E smoke（`npm run test:e2e:smoke`）
   - 视觉基线对比（Phase 0 建立）
   - 性能计数器差异 < 5%
4. **任何 Phase 出现回归**：立即回滚当前 PR，不允许用 hotfix 叠加；回滚后在本文件追加 "踩坑记录" 小节。
5. **Tier 2–4（UI/Core 解耦、跨平台构建、打包器、清仓）** 暂不启动；等 Tier 1 Phase 4 完工后再评估优先级。

**起点**：确认本计划后，第一步是开 Phase 0 护栏 PR（ESLint 规则 + dev-only Proxy 拦截 + E2E 基线截图脚本）。
