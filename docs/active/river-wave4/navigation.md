# Wave 4 河流地点导航交付

基线 `b416e2571c1202a4de8ac68e3869dc07c14bb352`；分支 `codex/river-wave4-navigation`。
本交付提供完整的 302 父地点导航 UI，默认包的实际准入由 core/data 对话和主对话完成。

变更文件：`js/ui/river_paint_controls.js`、`js/ui/river_paint_locations.js`、`js/ui/river_paint_location_data.js`、`js/ui/river_cell_picker.js`、`js/ui/toolbar.js`（仅河流接线）、`index.html`（仅河流控件）、`css/editor-workspace.css`（河流控件及其 dock 浮层规则）、`tests/river_paint_ui_render.test.mjs`、本报告。

## 行为与范围

- 当前可选集合始终来自 `runtime.getActivePack().parents`。独立 UI 元数据只提供显示标签，不能增加父或替换存档 pack；原 6/12 父存档仍只有其原范围。
- 按名称或 ID 搜索，支持中英文河名、国家代码、大小写和组合音标折叠；`Wrocław` 也能用 `wroclaw` 搜索。多个词同时匹配，与河流筛选取交集。
- 河流列表只显示当前 pack 涉及的河流，不随搜索词删减，便于在无结果时改选河流。无匹配时显示说明，并禁用地点选择器和定位按钮。
- 选择地点立即调用现有 `focusRiverPaintParentById(id)` 并打开原分区预览选择器。地点选择器保留选中值，连续方向键可以进入下一个地点；`定位 / Go` 按钮可重复定位同一个地点。**旧的“定位后 value 变为空字符串”行为已撤销**，它会破坏原生选择器的连续方向键操作。
- 原 `riverCellSelect` 仍列出所选父的全部 cells，不按面积隐藏任何碎片；预览保留地块内位置和单独放大图，应用按钮仍交给原 `applyRiverPaintCellById`。
- 切换语言会更新全部标签并保留仍匹配的搜索/筛选/地点值。pack 对象改变、工具关闭、加载中、其他场景或 startup readonly 时会清除导航筛选和旧选项；picker 清除旧分区选项、预览并禁用应用按钮。搜索条件变化不撤销当前合法的 picker 选择，其标题显示当前地点。
- 关闭 picker 只关闭分区预览；关闭沿河工具会隐藏整个导航。两者均保留已填颜色。
- 未知但实际存在于旧自包含 pack 的父可按原 ID 定位；不给它推断河流或国家。

导航是一个宽度最多 320px 的 dock 上方浮层，搜索和河流筛选在第一行，地点选择和定位按钮在第二行，原 picker 接在下方。原生 input/select/button 保留 Tab、方向键及 Enter 行为；控件具有动态中英文 accessible name，结果数使用 polite live status。窄屏保持河流按钮可见，并仅在导航打开时解除 dock 对浮层的裁剪。

## 标签来源与准入边界

`js/ui/river_paint_location_data.js` 为独立显示数据模块，约 27KB，不写入接近预算上限的 pack。
302 个 ID 精确取自 `tools/river_partitions/selections/wave3-reviewed.json`，未加入联合暂缓的 5 父。
地点名称和国家代码取自 `modern_world/runtime_topology.topo.json` 的原始 `name` / `cntr_code`，保留原 12 地点 UI 的可信双语标签。
其它中文地名只取 `manual_geo_overrides.json` 和 `europe_geo_seeds.json` 中已有对应项，缺失时回退原名；不使用自动 `locales.json` 译名补齐，不编造翻译。
国家代码是源地理标签，不能解释成当前 scenario ownership。

父与河流关系逐一取自欧洲 `rivers[].selectedParents / existingApprovedParentIds`、中国 `reaches[].admitParentIds / retainedParentIds` 和东欧 `records` 中 `offline_candidate / existing_approved` 记录，再与唯一准入清单相交；不从国家代码推断关系。单独复用/定义 10 条具名河流的中文显示名，源键 `Huang` 对应 `Yellow River / 黄河`。

| 源河流键 | 当前 302 父中的数量 |
| --- | ---: |
| Danube | 16 |
| Dnieper | 14 |
| Don | 16 |
| Elbe | 18 |
| Huang | 103 |
| Oder | 10 |
| Rhine | 9 |
| Seine | 12 |
| Volga | 32 |
| Yangtze | 72 |

这些数字是准入父的导航分类，不是整条现实河道覆盖率。源面重叠、河线和湖泊中线偏差仍按 Wave 3 集成报告解释；UI 没有修改行政 ID、ownership、源几何、切分算法、预算或碎片。

## DOM 与接线契约

`createRiverPaintControls` 新增可选节点参数 `navigationPanel / searchInput / riverSelect / resultsNode / locationButton`；沿用 `locationSelect / focusParent / onLocation / onSync`。
`onLocation(id, { en, zh })` 传递含地点、河名、国家代码的标签；`onSync` 继续调用 picker.sync。

| DOM ID | 元素 / 合同 |
| --- | --- |
| riverPaintToggleBtn | button；原开关、pressed/busy 状态 |
| riverPaintNavigation | group；仅可编辑且 active pack 就绪时显示 |
| riverPaintSearchInput | search input；`input` 刷新搜索，`aria-controls` 指向地点 select |
| riverPaintRiverSelect | native select；`change` 刷新筛选；value 是上表源键，空值代表全部 |
| riverPaintLocationSelect | native select；value 是原 parentId；`change` 自动定位，选中值保留 |
| riverPaintLocationGoBtn | button；click/Enter 重复定位当前 parentId；无选择时 disabled |
| riverPaintLocationResults | polite atomic status；匹配数 / 当前 pack 父总数，或无结果提示 |
| riverCellPicker / riverCellSelect | 沿用现有 region 和分区 select；不删分区；失效后清空 options |
| riverCellPreview / riverCellApplyBtn / riverCellCloseBtn | 原预览、应用和关闭接线不变 |

切换存档但尚未刷新 DOM 时，定位事件仍会重新核对当前 pack 与选中父；过期事件不调用 focusParent / onLocation。分区应用继续由 picker 的 pack 身份检查和原编辑 owner 判断可编辑性。

## 实际验证与边界

`node --test tests/river_paint_ui_render.test.mjs`：15/15 通过。

- 精确核对元数据 ID 集合、三份区域清单的河流关联和原始国家代码；暂缓父缺席；10 河分类；Rhine 只涉及已准入的 CH/DE。
- 当前默认 12 父的名称/ID/中文/音标搜索、无匹配、跨河筛选、语言切换、选中值和定位按钮状态。
- 注入完整 302 父 **导航 fixture**：每父可按 ID 找到并定位两次，打开 picker，选择和应用一个极小 synthetic cell；共 604 次定位、302 次应用回调。该 fixture 使用合成几何，**不是**正式 905 cells 的几何或真实地图点击验收。
- 原 6/12 父切换、陈旧事件拒绝、其他场景、readonly、pending、关闭工具保留颜色，以及未知旧包 ID 回退。
- 原有真实 pilot 的 31 cells、wave2 的 43 cells，均经原编辑 owner 独立填色并生成有限放大预览。

Codex 内置浏览器以 Playwright API 在独占 `localhost:8010` 检查临时组件 fixture：真实 wave2 输入、实际 index dock 标记/CSS、搜索无结果、连续方向键到第二地点、Go 重复定位、切换中文、方向键选 cell、Enter 应用，以及 375×812 窄屏布局。最终组件页未记录 warning/error；本地静态资源返回 200/304。这不是完整 app 启动、Canvas 地图点击或正式 302/905 包验收。
临时服务和本任务创建的标签已关闭，viewport override 已恢复；截图在 `.runtime/browser/river-navigation/component-zh.png` 和 `component-mobile.png`。

还执行了本次五个 JS 模块的 `node --check` 和 `git diff --check`。

## 主对话整合依赖

1. 整合 core/data 的正式 302/905 pack 与 loader/manifest；UI 无需改选择清单或强制升级旧存档。
2. 在共享 `tools/verification/catalog/records/river_paint.mjs` 加入两个新 UI 模块、相关 CSS 和本报告的 sourceRefs，并按最终 import 图刷新共享测试依赖清单。本对话遵守所有权，未修改 registry/catalog/package 或其生成物。
3. E2E 沿用上述 ID；重复定位应点击 `riverPaintLocationGoBtn`，不要断言地点 select 在定位后为空。继续测默认新包的 302/905、独立填色/undo/redo、save/load、旧包范围和实际 contour；全地图与 dist/Pages 验证由主对话负责。

本分支未执行全量验证、Pages 构建、push、合并、发布、主目录操作或其它对话 cherry-pick。
