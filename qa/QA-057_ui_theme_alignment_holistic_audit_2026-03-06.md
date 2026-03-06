# QA-057 — 全项目 UI 审计（主题一致性与主权优先改版复核）

**日期**: 2026-03-06  
**范围**: 基于最新 sovereignty-first UI 改动，复核既有 UI 修改建议是否仍有效，并更新已过时项  
**基线版本**: `main` 分支最新主权相关提交 `9e4730e` / `911f13e`  
**审计方式**: 代码静态审计（`index.html` + `css/style.css` + `js/ui/toolbar.js` + `js/ui/sidebar.js`）+ 本地浏览器实检（Playwright MCP, `http://127.0.0.1:8003/`）+ 最新 Web Interface Guidelines spot-check

---

## 0) 审计结论（Executive Summary）

最新这轮“主权优先”改版已经显著改变了 UI 重心，因此 **QA-057 原版中的一部分建议已经过时**。当前界面不再是单纯的“左栏堆控件 + 右栏看结果”，而是已经形成了更明确的三段式结构：

- **左栏**：Palette / Scenario / Appearance  
- **中部地图 + Dock**：即时填色、主权模式切换、快速动作  
- **右栏**：Country Inspector / Territories & Presets / Diagnostics

这意味着，旧版审计中最重的一条建议 “立即重构成 Start / Paint / Refine / Export 四段式 IA” 已经不再是当前第一优先级。现在更准确的判断是：

1. **主权工作流已经落地，但入口仍然分散**：`Political Editing`、`Active Owner`、`Territories & Presets`、顶部 scenario context 已经建立起主权语义；问题不再是“缺少主权流程”，而是“流程存在，但还不够顺滑”。  
2. **主题气质仍偏 SaaS 控制台**：主权语义更强了，但视觉外壳仍以白卡片 + 冷蓝强调 + 全大写标签为主，地图工作台氛围仍弱。  
3. **浮层冲突比旧报告写得更具体**：本次实检确认顶部 scenario guide 按钮会被 zoom 控件实际遮挡，属于真实交互 bug，不再只是抽象的“注意力竞争”。  
4. **若继续优化，优先级应从“大重排”调整为“精修主流程与可读性”**：先修布局冲突、文案可读性、色板列表表达、移动端高度挤压，再考虑主题皮肤和模式分层。

---

## 0.1) 既有建议有效性复核

### 已过时或需降级的建议

1. **“Scenario 与 Editing Rules 关系不清晰”**  
   这条已基本过时。当前主权相关动作已转移到 dock 与右侧 inspector：`Political Editing`、`Use as Active Owner`、`Territories & Presets`、顶部 `Scenario / Mode / Active` context 都在强化路径。

2. **“Browse All Colors 展开后缺少关闭态文案”**  
   已过时。当前按钮会在展开后切换为 `Hide Color Library`。

3. **“需要立即重构成 Start / Paint / Refine / Export 四大区块”**  
   需降级。当前结构已经部分实现类似分工，只是尚未通过默认折叠、摘要文案和视觉分组把这件事讲清楚；不需要把它作为 P0 级大改。

### 仍然有效的建议

1. **主题仍偏 SaaS，而非地图创作台**  
2. **全大写 section label 过多，阅读感偏参数面板**  
3. **dock、top bar、zoom、toast 的视觉竞争仍然存在**  
4. **需要拆分系统强调色与地图语义色**

### 新出现或旧文档未充分捕捉的问题

1. **Scenario guide 按钮与 zoom controls 实际重叠，导致点击失败**  
2. **Palette Library 条目文案可读性差，如 `GermanyDE`、`BritainGB`**  
3. **移动端顶部浮层 + 底部 dock 共同压缩地图可视高度**  
4. **Google Fonts 外链在受限环境下被拦截，暴露出字体依赖脆弱性**

---

## 1) 浏览器证据（按证据优先级）

### 1.1 Console

- `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector @ https://fonts.googleapis.com/css2?family=Inter...`

说明：

- 这不是业务逻辑错误，页面与数据加载均成功。  
- 但它说明当前 UI 仍依赖外部字体请求；在受限环境、隐私插件或企业网络中，字体表现会退回系统 fallback，影响视觉稳定性。

### 1.2 Network

成功加载：

- `GET / => 200`
- `GET /css/style.css => 200`
- `GET /js/main.js => 200`
- `GET /js/core/sovereignty_manager.js => 200`
- `GET /js/core/releasable_manager.js => 200`
- `GET /data/europe_topology.runtime_political_v1.json => 200`
- `GET /data/releasables/hoi4_vanilla.internal.phase1.catalog.json => 200`
- `GET /data/scenarios/index.json => 200`

失败项：

- `GET https://fonts.googleapis.com/css2?family=Inter... => FAILED`

结论：

- 原版 QA-057 中的 `404 localhost:8000` 证据已经失效，不能继续作为本报告依据。  
- 当前本地实检显示，业务页面与主权相关数据均可正常加载，浏览器证据需要以本次 200/FAILED 结果为准。

### 1.3 Screenshot 产物

- `.mcp-artifacts/qa057-desktop.png`
- `.mcp-artifacts/qa057-mobile.png`

### 1.4 复现步骤

1. 在仓库根目录启动 `py -3 tools/dev_server.py`。  
2. 访问 `http://127.0.0.1:8003/`。  
3. 等待 scenario、palette、country list 数据加载完成。  
4. 打开 `Political Editing`、展开 `Color Library`、在右栏选择任一国家。  
5. 观察顶部 scenario context 与右上 zoom 的相对位置，以及 Palette Library 条目可读性。  

### 1.5 最小修复方向

- 为顶部 scenario context 与 zoom controls 建立固定避让规则。  
- 将关键 UI 字体改为本地托管或提供更稳健的 fallback。  
- 继续将浏览器巡检产物统一落盘到仓库 `.mcp-artifacts/`。

### 1.6 实测交互冲突

在 `1600 x 1000` 视口下，`scenarioGuideBtn` 与 `zoomControls` 存在实际几何重叠：

- guide button: `26 x 26`
- overlap area: `541.125 px²`

Playwright 实测点击失败，错误原因为：

- `zoomControls intercepts pointer events`

这意味着“浮层竞争”在当前版本中已经是**可复现 bug**，不是抽象审美问题。

---

## 2) 主题契合度审计（地图工作台 + 主权编辑视角）

## 2.1 正向项（当前做得好的）

- **主权语义显著增强**：顶部 `Scenario / Mode / Active` context、dock 中的 `Political Editing`、右侧 `Use as Active Owner` 与 `Territories & Presets` 已经把“主权编辑”明确前置。  
- **地图仍然是视觉主舞台**：`#mapContainer` 的深色框体与发光边框对中央地图有很强聚焦作用。  
- **左右职责比旧版更清晰**：左侧负责资源与样式，中部负责即时操作，右侧负责国家与场景动作，比旧版“全塞左侧”更成熟。  
- **移动端已具备抽屉化基础**：左右栏在中小屏会切换为 drawer，而非强行三栏并排。

## 2.2 关键问题 A：主权核心已经成立，但外层视觉仍然像“白色后台”

### 现象

- 中央地图是深色 Atlas 风格，但左右栏仍是典型浅灰底 + 白卡片 + 冷蓝强调。  
- `section-header` / `section-header-block` 仍大量使用 `uppercase + 0.75rem + letter-spacing`，形成明显“参数面板气质”。  
- 顶部与底部组件虽然功能正确，但风格仍偏“工具浮层堆叠”，未完全形成地图工作台的整体气场。

### 这条建议为什么仍有效

主权相关交互已经建立，但**视觉主题没有同步升级**。现在的落差不是“功能不到位”，而是“功能已经像地图编辑器，外壳还像管理台”。

### 更新后的修改方向

1. **保留当前布局，不推翻，只强化地图工作台主题 token**  
   建议新增：
   - `--theme-panel-paper`
   - `--theme-panel-tint`
   - `--theme-map-accent`
   - `--theme-sovereign-active`
   - `--theme-sovereign-target`

2. **降低左右栏的纯白感**  
   改为轻微暖灰、纸感或 atlas tint，让左右栏不再和中央地图完全割裂。

3. **把“主权态”做成视觉一级语义**  
   例如 `Active Owner`、`Political Ownership`、场景关键动作使用独立语义色，而不是继续共用通用蓝色。

4. **保留高层级标签强调，但缩小全大写覆盖范围**  
   一级组可保留 uppercase；二级说明与辅助标题应改为 sentence case。

---

## 3) 信息层级与任务流审计

## 3.1 关键问题 B：不再是“左栏太长”，而是“主流程跨三处切换”

### 现象

当前主权流程大致是：

1. 左栏选 scenario / palette / appearance  
2. 中部 dock 切换 `Political Editing`
3. 右栏选择国家并 `Use as Active Owner`
4. 右栏 `Territories & Presets` 做主权动作

相比旧版，这条路径已经更合理；但新问题在于，**路径存在，却没有被 UI 明确讲出来**。

### 与旧报告相比的更新判断

- 旧判断 “需要立即把所有东西改成 Start / Paint / Refine / Export” 过重。  
- 当前更准确的建议是：**保留现有三段结构，只补充流程提示、默认状态与摘要信息**。

### 更新后的修改方案

1. **为三段结构补一句角色定义**
   - 左栏：Setup & Style
   - Dock：Paint & Ownership
   - 右栏：Inspect & Actions

2. **给主权模式补一个 3 步提示**
   - `1) Pick a country`
   - `2) Use as Active Owner`
   - `3) Apply Territories / Presets`

3. **默认收起低频项，而不是大重构**
   - 左侧 `Color Library` 可默认闭合
   - 右侧 `Project & Legend`、`Diagnostics` 默认保持闭合
   - `Political Editing` 展开时，应更清楚地强调与右侧 inspector 的联动

4. **用摘要替代结构重排**
   例如：
   - `Scenario: HOI4 1939 / Ownership`
   - `Active Owner: Germany`
   - `Territories: 4 actions available`

---

## 4) 色彩体系审计

## 4.1 关键问题 C：系统蓝色仍然承担过多语义

### 现象

- 当前蓝色同时承担按钮主动作、focus、激活态与部分徽标态。  
- 右侧 active badge、顶部 scenario context、小图标徽点都仍围绕同一套蓝色展开。  
- 当地图上使用高饱和 palette 或进入主权编辑时，UI 蓝色会与地图着色争抢主角。

### 更新后的修改方案

1. **拆分三类强调色**
   - `UI action`: 普通交互、hover、focus
   - `Sovereignty state`: active owner、selected target、ownership mode
   - `Map content`: 国家填色与地图实体本身

2. **把顶部 context 与右侧 active owner 绑定到同一语义色**
   这样用户能直接感知“当前是主权工作流，而不是普通填色工作流”。

3. **为 warning / conflict / locked 状态加入非纯色编码**
   使用描边、图标、条纹或 badge 形状，而不是只靠颜色。

---

## 5) 字体与排版审计

## 5.1 关键问题 D：旧问题仍在，但新的可读性问题已经从标签转移到列表内容

### 现象

- `Inter + uppercase section labels` 的“后台参数感”仍然存在。  
- Palette Library 实测出现 `GermanyDE`、`BritainGB`、`AmericaUS` 这样的连续文案，不够人类可读。  
- 右栏国家组与动作卡片在信息多时也会快速变密。

### 更新后的修改方案

1. **继续减少 uppercase 覆盖面**
   - 应用级主标题保留
   - 一级组标题可保留
   - 二级 label 与辅助说明改 sentence case

2. **修正 Palette Library 的文本表达**
   建议改为：
   - 标题：`Germany`
   - 副标题：`DE · HOI4 Vanilla`
   或
   - 标题：`Germany`
   - 副标题：`ISO-2: DE`

3. **把高频数据字段做成稳定的排版模式**
   - badge
   - secondary line
   - fixed-width short code

4. **处理字体依赖脆弱性**
   若继续使用 Inter，建议自托管或补足更强系统 fallback，而不是只依赖 Google Fonts。

---

## 6) 组件位置与交互流畅性审计

## 6.1 关键问题 E：浮层冲突依然成立，而且已经具象化为点击拦截

### 现象

- 顶部 scenario context 与右上 zoom controls 在桌面端发生重叠。  
- `scenarioGuideBtn` 被 `zoomControls` 拦截点击。  
- 移动端截图显示顶部 context + zoom 与底部 dock 一起压缩了地图主体高度。

### 更新后的修改方案

1. **先修真实遮挡 bug**
   - scenario context bar 与 zoom 之间建立最小安全间距  
   - 让 guide 按钮永远不进入 zoom hit area

2. **把顶部层分级**
   - Level 1: zoom
   - Level 2: scenario context
   - Level 3: toast / transient hints  
   并为不同层设置明确避让规则，而不是仅靠 `z-index`

3. **移动端优先压缩顶部，而不是压缩地图**
   - 默认折叠 scenario context
   - zoom controls 减小宽度
   - dock 在未交互时默认进入更紧凑态

4. **让 onboarding hint 更早退场**
   当前它在地图中部仍有存在感。主权与普通填色模式都建立后，应尽快转为轻量帮助入口。

---

## 7) 发现的细节问题（更新版）

1. **文案 typo 仍然存在**：`Click counties to paint.` 应为 `Click countries to paint.`  
2. **旧建议“Browse All Colors 缺少关闭态”已失效**：现已切换为 `Hide Color Library`。  
3. **Palette Library 条目可读性差**：当前条目显示成 `GermanyDE`、`BritainGB` 等拼接式标签。  
4. **Scenario guide 按钮不可点**：被 `zoomControls` 实际拦截。  
5. **移动端地图高度被上下浮层共同挤压**：虽然结构可用，但“地图优先”不够。  
6. **外部字体依赖脆弱**：受限环境下会直接回退，影响视觉一致性。  
7. **基于最新 Web Interface Guidelines 的补充问题**：
   - `css/style.css` 中仍存在多处 `transition: all`
   - 页面缺少 skip link
   - 表单输入普遍缺少 `name` / `autocomplete`

---

## 8) 优先级改造清单（更新版 Roadmap）

## P0（立即，1~3 天）

- 修正 `counties -> countries`
- 修复 scenario guide 与 zoom controls 的遮挡冲突
- 修正 Palette Library 文案结构（国家名 / ISO / source tag 分层显示）
- 移动端压缩顶部浮层高度，优先还给地图更多空间

## P1（短期，1~2 周）

- 拆分系统交互色与主权语义色
- 降低全大写标签密度，统一 sentence case 规则
- 给现有三段式结构补“角色说明 + 主权流程提示”
- 自托管字体或增强 fallback；顺带清理 `transition: all`

## P2（中期，2~4 周）

- `Map-first` 模式
- `Basic / Advanced` 双模式
- 主题皮肤（Atlas / Blueprint / Paper）
- 主权状态的色盲友好编码

---

## 9) 可执行实现草案（技术层）

## 9.1 Overlay 避让建议

```css
:root {
  --overlay-top-gap: 14px;
  --overlay-safe-right: 24px;
  --scenario-context-max-width: 52vw;
}

.scenario-context-bar {
  max-width: var(--scenario-context-max-width);
}

.zoom-controls {
  right: var(--overlay-safe-right);
}
```

再配合运行时检测：

- 如果 `scenarioContextBar.right >= zoomControls.left - 8`
- 则自动折叠 context，或把 guide 按钮移动到左侧

## 9.2 Palette Library 文案重构建议

- Title：人类可读国家名  
- Subtitle：`ISO-2 · Source Tag · Mapping status`  
- Tooltip：保留完整技术信息（country file、mapped/unmapped reason）

## 9.3 现阶段 IA 建议

不做大重排，只明确三段职责：

- 左栏：Setup / Palette / Appearance  
- Dock：Paint / Ownership / Quick Actions  
- 右栏：Inspect / Territories / Diagnostics

---

## 10) 验收标准（更新版）

1. **主权流程清晰度**：首次接触用户能在 10 秒内找到 `Pick Country -> Active Owner -> Territories` 路径。  
2. **地图优先度**：桌面与移动端都不出现顶部控件遮挡关键按钮。  
3. **可读性**：Palette Library 中的国家名、ISO 与来源能一眼分辨。  
4. **视觉一致性**：在字体外链失败时，页面仍保持稳定排版与层级。  
5. **交互稳定性**：dock / zoom / toast / scenario context 不再相互拦截点击。

---

## 11) 结语

这份 UI 在“主权优先”改版之后，已经不适合继续沿用旧版 QA-057 的核心结论。当前最重要的不是继续推动一次大规模 IA 推翻，而是承认一个新的现实：**主权工作流已经建立，下一步应转向修主流程细节、交互冲突与视觉语义统一。**

换句话说，现阶段的目标不是“把它从普通地图工具变成主权编辑器”，而是“把已经成型的主权编辑器打磨得更顺手、更可读、更像它自己”。
