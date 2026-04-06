# UI Rework Execution Plan 02: Mainline Shell & Sidebar

## 文档目的
- 这份文件负责主界面第一战场。
- 它只处理：主壳、顶条、右上 utility、左 rail、右栏主线、`bottom dock`。
- 所有规则默认继承 [UI_REWORK_EXECUTION_PLAN_01_FOUNDATION_AND_CONTRACTS_2026-04-05.md](/C:/Users/raede/Desktop/dev/mapcreator/docs/UI_REWORK_EXECUTION_PLAN_01_FOUNDATION_AND_CONTRACTS_2026-04-05.md)。

## 2026-04-06 执行进度（02）
- [x] 主壳第一波收口：`scenario context bar` 只保留轻状态与 `Guide` 轻入口；`Transport` 移到右上 workspace 入口组。
- [x] 右上 utility 第一波分组：视口控制 / 轻系统状态 / workspace 入口。
- [x] 右栏主线第一波结构迁移：`Project & Legend → Frontline → Utilities → Diagnostics`，`Inspector scope` 正式章节壳接入 01 语义类。
- [x] `Utilities` 第一正式落点锁定在右栏支持区，`Guide / Reference / Export` 已变成文字入口。
- [x] `bottom dock` 第一波收紧：移除 `Edit Config` 长停留配置入口和 `Clear Map` 危险动作。
- [x] URL / 焦点 / 弹层第一波对齐：右栏 `scope + section` 写回 URL，`Guide / Reference / Export` 支持面视图写回 URL，弹层关闭回到触发器。
- [x] 新增 02 定向验证：`tests/test_ui_rework_plan02_mainline_contract.py`、`tests/e2e/ui_rework_mainline_shell_sidebar.spec.js`。
- [ ] 保持未启动：03 的支持面深改、Transport 内部改造、第二波视觉收口、搜索壳/列表树/legend/颜色拾取器内部件。

## 主要代码边界
- [index.html](/C:/Users/raede/Desktop/dev/mapcreator/index.html)
- [css/style.css](/C:/Users/raede/Desktop/dev/mapcreator/css/style.css)
- [js/ui/sidebar.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js)
- [js/ui/toolbar.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/toolbar.js)
- [js/ui/i18n.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/i18n.js)

## 不包含
- `Transport workbench` 内部改造
- 搜索壳、列表虚拟化、颜色拾取器内部 widget
- 第二波视觉 polish

## 一、总执行顺序
1. 壳层收口
2. 右栏主线结构迁移
3. 按钮与入口语法落位
4. `bottom dock` 职责收紧
5. URL / 焦点 / 弹层行为对齐
6. 第一波 legacy bridge 收口

## 二、壳层收口

### Step 1: 顶条退回轻状态条
- 保留：
  - 场景名
  - 轻状态摘要
  - 固定 `Guide` 轻入口
- 移除：
  - `Transport` 工作区入口
  - 任何任务动作
  - 任何项目级支持工具入口
- `Guide` 点击后的正式落点改为右栏支持区，不再让壳层承接完整帮助系统。

### Step 2: 右上 utility 重组为 3 组以内
- 固定为：
  - 视口控制组
  - 轻系统状态组
  - 极少数 workspace 入口组
- `Language`
  - 并入轻系统状态
  - 保留文字状态
  - 不再做高声量独立按钮
- `Transport`
  - 从顶条迁到右上 workspace 入口组
  - 保持低频入口感

### Step 3: 贴边 panel toggles 独立
- 左右 panel toggle 继续贴边独立存在
- 不并入顶条
- 不并入右上 utility
- 不并入 `bottom dock`

### 完成定义
- 顶条不再承担任务入口或支持工具入口。
- 右上常驻组按功能组计数不超过 3。
- `Transport` 不再出现在顶条。
- `Guide` 仍可快速到达，但完整内容只在右栏支持区。

## 三、右栏主线结构迁移

### Step 4: 固定右栏主线顺序
- `Project scope`
  - `Project & Legend`
  - `Frontline`
  - `Utilities`
  - `Diagnostics`
- `Inspector scope`
  - `Country Inspector`
  - `Territories & Presets`
  - `Special Regions`
  - `Water Regions`

### Step 5: 执行第一波 class 迁移
- 先迁共享家族：
  - `sidebar-shell-anchor`
  - `sidebar-section-shell`
  - `sidebar-section-head`
  - `sidebar-anchor-title`
  - `sidebar-section-title`
  - `sidebar-support-head`
  - `sidebar-support-title`
  - `sidebar-appendix-head`
  - `sidebar-appendix-title`
  - `sidebar-group-label`
  - `sidebar-field-label`
  - `sidebar-help-copy`
  - `sidebar-empty-copy`
  - `sidebar-empty-state`
  - `sidebar-detail-group`
- 再迁 `Project scope`：
  - `Project & Legend`
  - `Frontline`
  - `Utilities`
  - `Diagnostics`
- 再迁 `Inspector scope` 的正式章节外层与标题层。

### Step 6: 明确不在第一波深入的部分
- 搜索壳不改
- 列表和树内部结构不改
- legend 列表内部结构不改
- 颜色拾取器内部结构不改
- 只先做章节壳、标题、说明、按钮入口语义迁移

### 完成定义
- 右栏主线不再依赖旧的万能 `section-header` 家族去硬撑所有角色。
- `Utilities` 已经从“伪章节”变成支持入口区。
- `Diagnostics` 已经明确是附录区，不再借正式章节壳抢层级。
- 空状态标题、结构标签、字段标签不再混成一锅。

## 四、按钮与入口语法落位

### Step 7: 支持入口改成文字入口
- `Reference / Export`
  - 从 `icon-only` 退出
  - 改为支持入口按钮家族
  - 留在右栏支持区
- 工具内容标题统一进 `sidebar-tool-title`
- 工具内主动作独立为 `sidebar-tool-action-primary`

### Step 8: 任务动作归位
- `Use as Active Owner`
  - 归为 `sidebar-action-primary`
- `Reset Country Colors`
  - 归为 `sidebar-action-secondary is-section-tail`
- `Clear Water Override / Clear Special Region Override`
  - 归为 `sidebar-action-secondary is-danger`

### Step 9: 列表回到对象入口职责
- 行点击默认导向右栏详情
- 列表行不再长期暴露整排行内动作
- `Edit` 不再成为进入详情的必要入口

### 完成定义
- 右栏主线里的项目级入口、支持入口、任务动作、危险动作已经各归各位。
- 支持入口不再伪装成工具按钮。
- 危险动作不再和普通次级动作混用旧语法。

## 五、Bottom Dock 收紧

### Step 10: 重新定义 dock 外层
- dock 外层保持弱存在
- 空闲态只保留轻唤醒和极少数通用高频动作
- 不再让整条 dock 长期像第二工作台

### Step 11: 重新定义 dock 内层
- 当前任务组内部允许 `紧`
- 只保留：
  - 高频工具选择
  - 当前任务模式切换
  - 当前任务微动作
  - 极少数通用高频动作，例如撤回 / 重做
- 移除：
  - 支持工具入口
  - 导出
  - 长停留配置
  - 危险动作

### 完成定义
- `bottom dock` 只剩“当前任务短工具带”职责。
- `Reference / Export` 已退出 dock 主入口体系。
- dock 实现 `外松内紧`，而不是整条都紧。

## 六、URL、焦点与弹层行为对齐

### Step 12: 主级 URL 同步
- 先同步：
  - 主 `scope`
  - 主级章节展开状态
  - 主要支持区打开状态
- 不在第一波同步：
  - hover
  - 极短期 transient 提示

### Step 13: 焦点回退
- 所有 popover / dialog 触发器记录焦点来源
- 关闭后回到触发器
- panel toggle 的键盘路径固定

### Step 14: 弹层边界
- `Reference / Export` 如果仍保留轻 popover 形态，只允许短停留工具内容
- 任何开始长阅读、完整表单、危险确认的内容，直接升级为 dialog 或回到右栏内联区

### 完成定义
- 主级阅读状态可以恢复。
- 键盘可以完整走通主壳和右栏主线。
- popover 不再偷偷变成第二工作区。

## 七、兼容桥与退场

### Step 15: 新旧双类短期并挂
- 只给第一波迁移的共享家族保留短期桥
- 旧 `section-header` 与旧 `inspector-section-summary-copy` 从右栏主线退场

### Step 16: 退场名单
- 旧右栏主线万能标题类
- 旧 `Utilities` 章节语义
- 右栏主线里的 `icon-only` 项目级入口

### 完成定义
- 新类已经成为主线语义来源。
- 旧类只剩短期兼容桥，不再承担新角色。

## 八、验收清单
- 顶条只剩轻状态 + 固定帮助入口
- 右上只剩视口、轻系统状态、极少数 workspace 入口
- 左 rail 仍是安静入口脊柱
- 右栏主线顺序稳定
- `Utilities` 已降回支持入口区
- `Diagnostics` 已降回附录区
- `Reference / Export` 已退出 `icon-only`
- 危险动作已退出壳层和主工具带
- `bottom dock` 已只剩短工具带职责
- URL / 焦点 / 弹层边界已按共享契约对齐

## 失败信号
- 实现中再次出现“先把它放右上再说”
- `Utilities` 再被写成章节
- `Reference / Export` 因为空间紧又退回 `icon-only`
- 为了省事把危险动作塞回 dock 或顶条
- 为了视觉统一把支持区、附录区重新抬回正式章节语法
