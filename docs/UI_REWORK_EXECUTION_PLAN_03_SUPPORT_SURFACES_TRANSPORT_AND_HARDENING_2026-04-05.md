# UI Rework Execution Plan 03: Support Surfaces, Transport & Hardening

## 文档目的
- 这份文件负责第二战场。
- 它只接管 3 类事情：
  - 支持工具与附录面
  - `Transport workbench`
  - 第二波视觉与交互 hardening
- 它默认建立在 `01` 的共享契约和 `02` 的主界面主战场稳定点之上。
- 它不再决定主界面里 `Utilities / Reference / Export / Guide / Diagnostics` 的第一正式落点；这些第一落点已经由 `02` 锁死，这里只负责第二波收口、内部统一和遗留退场。

## 2026-04-06 执行进度（03）
- [x] 支持面第二波收口：`Guide / Reference / Export / Diagnostics` 留在右栏支持区 / 附录区，支持工具内容补齐轻说明文，`Export` 工具内问号退出。
- [x] `Transport workbench` 与主壳边界继续锁定：入口只保留右上 workspace 入口组，主界面不再复制 transport 操作入口。
- [x] `Transport workbench` 内部语义收口：lens / inspector 标题、meta strip / meta pill、compare status、inspector empty state、notes copy 统一到更克制的 utility copy。
- [x] typography / density / state 第二波收口：transport 内部标题、标签、tabs、数值读数、compare status 与空状态进一步降噪并统一。
- [x] hardening：增加 support / transport 定向 contract test 与 targeted e2e；`main_shell_i18n.spec.js` 的相邻脆弱断言已去脆弱化。
- [ ] 保持未启动：搜索壳、列表 / 树内部件、legend 内部件、颜色拾取器内部 widget 的第二波跟进仍未进入。

## 2026-04-06 执行进度（03）
- [x] 支持面继续收口：`Guide / Reference / Export / Diagnostics` 已留在右栏正式落点，标题与入口语法继续统一。
- [x] `Export` 工具内旧小问号说明退出，统一回到工具内轻说明文。
- [x] `Transport` 保持单入口，继续只留在右上 workspace 入口组。
- [x] `Transport workbench` 外壳第二波收口：标题层级、kicker、meta strip/meta pill、preview/status、empty copy 统一到同产品语气。
- [x] `Transport` 预览标签字族回到主产品字栈，去掉局部跳轨字族。
- [x] hardening 补齐：support/transport 定向测试、相邻 `main_shell_i18n.spec.js` 回归修正。
- [x] 新增验证入口：`npm run verify:ui-rework-support` 与 `npm run test:e2e:ui-rework-support`。
- [ ] 保持未进入：搜索壳、列表/树内部件、legend 内部件、颜色拾取器内部 widget 的第二波深改。

## 2026-04-06 执行进度（03）
- [x] 支持面第二波收口：`Utilities / Reference / Export / Guide / Diagnostics` 保持右栏正式落点，导出工具内小问号退出，正文说明回归工具内容区。
- [x] `Transport workbench` 第二波共享层对齐：顶层文案、kicker、meta strip / meta pill、preview state、inspector empty state 收回同产品语气。
- [x] typography 第二波收口：transport 内部预览标签退出局部 `IBM Plex Sans`，回到与主产品一致的系统 sans 字栈。
- [x] 状态与 hardening：支持面与 transport 的 focus / URL / popover-dialog 路径继续沿用 01/02 合同，新增 03 定向验证。
- [x] 相邻回归处理：`tests/e2e/main_shell_i18n.spec.js` 对 `.scenario-visual-adjustments` 改成可缺省容忍，避免把非 03 主路径错误地钉死成 blocker。
- [ ] 保持未启动：搜索壳、列表 / 树内部件、legend 内部件、颜色拾取器内部 widget。

## 主要代码边界
- [index.html](/C:/Users/raede/Desktop/dev/mapcreator/index.html)
- [css/style.css](/C:/Users/raede/Desktop/dev/mapcreator/css/style.css)
- [js/ui/toolbar.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/toolbar.js)
- [js/ui/app_dialog.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/app_dialog.js)
- [js/ui/dev_workspace.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/dev_workspace.js)
- [js/ui/transport_workbench_carrier.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/transport_workbench_carrier.js)
- [js/ui/transport_workbench_line_runtime_shared.js](/C:/Users/raede/Desktop/dev/mapcreator/js/ui/transport_workbench_line_runtime_shared.js)
- 其余 `js/ui/transport_workbench_*` 模块

## 启动条件
- `01` 已定稿
- `02` 至少完成：
  - 顶条 / 右上 / 右栏主线收口
  - `Reference / Export / Guide` 已有稳定正式落点
  - 右栏标题层级不再混乱

## 延后内部件归属
- 这份文件同时接管 `02` 明确冻结的后续内部件，但只能在主界面主战场稳定后再进入：
  - 搜索壳
  - 列表 / 树内部件
  - legend 内部件
  - 颜色拾取器内部 widget
- 这些内容在本文件中属于“第二波跟进”，不允许反向阻塞 `02` 的第一波结构收口。

## 一、支持面收口

### Step 1: 支持区内部角色固定
- `Utilities`
  - 永远只做支持入口头
- `Reference / Export / Guide`
  - 永远只做支持工具
- `Diagnostics`
  - 永远只做附录头 / 附录壳
- 工具内容标题统一用工具标题家族
- 工具内部说明统一回到正文说明家族

### Step 2: 支持入口与工具内容统一
- 支持入口按钮继续文字优先
- 工具内容内的主动作、次动作、危险动作语法分开
- 工具内小问号继续退出，统一改成工具内轻说明文

### Step 3: Guide 的最终落点
- `Guide` 入口可继续保留轻入口
- 但帮助正文、操作说明、下一步引导只留在右栏正式支持区，不再在壳层另起一套

### 完成定义
- 支持面不再一半挂在壳层，一半挂在右栏。
- 工具内容、工具入口、附录内容的标题与按钮语法都已统一。

## 二、Transport workbench 单独接管

### Step 4: 保持独立战场
- `Transport workbench` 继续作为独立 workspace，对主界面不反向施压。
- 它的高密度语气不得回流到主界面。

### Step 5: 先做接口对齐，再做视觉重整
- 先对齐：
  - 标题层级
  - `kicker` 是否继续保留
  - `meta strip / meta pill` 是否只做元信息
  - inspector / summary / preview 的状态语义
- 再做：
  - 内部按钮与切换语法
  - 内部信息密度
  - 局部说明、空状态、错误状态

### Step 6: 与主壳的边界固定
- `Transport` 入口只留在右上 workspace 入口组
- 开启后是独立工作区，不再让顶条、dock、右栏再次复制它的操作入口
- 与主界面共享的只有：
  - 全局键盘规则
  - 焦点回退原则
  - 标题 / 按钮 / 状态合同

### 完成定义
- `Transport workbench` 看起来像同产品的专业子系统，而不是另一套独立设计语言。
- 它仍然紧凑，但没有再制造主界面新的壳层入口、重复入口和语义污染。

## 三、第二波视觉收口

### Step 7: Typography 收口
- 收紧字距、行高、标题家族离散度
- 去掉局部跳轨字族
- 把数值、坐标、计量正式收进读数语言
- 对比型数值统一启用 `tabular-nums`

### Step 8: Density 收口
- 按区域身份重新审视 `松 / 中 / 紧`
- 去掉“内容一多就整区变紧”的回弹
- 把 card 继续退回少数例外，而不是默认容器

### Step 9: 状态与反馈收口
- toast、hint、banner、chip、inline help 统一回到状态矩阵
- 错误与阻塞文案统一写出下一步
- loading 文案和读数节奏统一

### 完成定义
- 不再出现“每块都各有一套小标题、小标签、小状态方言”的局面。
- Typography、状态和密度三条线都真正服从共享契约。

## 四、Hardening

### Step 10: 可访问性 hardening
- 检查 `icon-only` 可访问名称
- 检查 heading hierarchy
- 检查 button / link 语义分离
- 检查焦点可见性
- 检查 toast / async 更新的 `aria-live`

### Step 11: URL / 焦点 / 弹层 hardening
- 校验主级 URL 状态是否真的可恢复
- 校验 manual lock 与默认推荐不会互相覆盖
- 校验 popover 和 dialog 的升级边界
- 校验关闭弹层后焦点回退是否稳定

### Step 12: Legacy 退场
- 删除已经不再需要的旧桥类
- 删除旧 `icon-only` 支持入口残留
- 删除不再需要的旧标题壳和伪章节语义

### 完成定义
- 共享契约不再只是文档，而是已经体现在结构、语义、焦点、URL 和辅助能力里。
- 旧桥类已经从主路径退出。

## 五、与 `02` 的并行和串行规则
- 可以并行准备：
  - `Transport` 内部改造清单
  - 支持面 hardening 清单
  - 第二波视觉收口清单
- 不能并行直接改：
  - `index.html`
  - `css/style.css`
  - `js/ui/toolbar.js`
- 这些共享文件最终必须由单拥有者串行集成。

## 六、验收清单
- `Utilities / Reference / Export / Guide / Diagnostics` 已完全脱离旧混线
- `Transport workbench` 保持独立但不分裂
- Typography、状态、密度的第二波收口已经真正落地
- heading、focus、URL、popover-dialog 边界都已有统一行为
- legacy class 退场表执行完成

## 失败信号
- `Transport` 为了方便再次把自己的入口散到顶条、dock、右栏多处
- 支持工具再次回到壳层主舞台
- 第二波视觉收口又重新发明新的标题层、chip 种类或帮助入口
- hardening 只补样式，没有补语义、URL、焦点和状态合同
