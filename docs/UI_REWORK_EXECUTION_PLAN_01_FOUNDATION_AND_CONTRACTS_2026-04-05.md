# UI Rework Execution Plan 01: Foundation & Contracts

## 文档目的
- 这份文件只做一件事：把 [UI_REWORK_DISCUSSION_2026-04-05.md](/C:/Users/raede/Desktop/dev/mapcreator/docs/UI_REWORK_DISCUSSION_2026-04-05.md) 里的抽象共识压成所有后续执行都必须服从的共享契约。
- 它不是视觉批注，也不是实现记录。
- 后续任何代码改动，只要和这里冲突，一律以这里为准；如果这里也不够清楚，先补这里，再写代码。

## 适用范围
- 主地图工作区
- 左 rail
- 顶部 `scenario context bar`
- 右上 utility 区
- 右栏 `Project scope` / `Inspector scope`
- `bottom dock`
- `Guide / Reference / Export / Diagnostics`
- 与这些表面直接相关的 URL 状态、焦点行为、弹层边界、无障碍约束

## 不包含
- `Transport workbench` 内部具体 UI 改造
- 搜索壳、列表虚拟化、颜色拾取器内部 widget 细化
- 视觉 token 微调数值

## 一、执行总前提
- 第一原则始终是 `地图优先`。
- 右栏是唯一主工作栏。
- 左 rail 只做安静入口脊柱，不再做第二工作栏。
- 顶条只做轻状态条。
- `bottom dock` 只做当前任务短工具带。
- 不允许用新增角色、补更多浮层、补更多标签来掩盖结构混乱。
- 完成感来自更清楚的层级、入口秩序、状态秩序和留白节奏，不来自更多“设计动作”。

## 二、术语与角色合同

### 1. Scope
- `scope` 是右栏里的阅读和编辑焦距，不是平级 app 页面。
- 默认只承认 3 类：
  - 当前对象
  - 当前图层
  - 当前项目
- 空选择状态默认落到 `项目 scope`。
- `scope` 切换规则固定为：
  - 系统可以自动推荐默认落点
  - 用户手动切换后必须被尊重
  - 手动锁定持续到离开当前任务

### 2. 控件职责
- `shell utility`
  - 只处理环境、视口、面板显隐、极少数全局入口
  - 默认不能推进当前任务
- `major navigation`
  - 只切大层级阅读面或工作面
  - 不能伪装成动作按钮
- `mode toggle`
  - 只切同一任务里的模式、工具或视图状态
  - 不能兼任对象入口或危险动作
- `task action`
  - 直接推进当前任务
  - 一屏默认只允许一个真正的 `primary action`
- `object entry`
  - 进入对象、预设、区域详情
  - 默认不再带一整排行内动作
- `danger action`
  - 清除、重置、删除、覆盖撤销类动作
  - 默认只留在明确文字面板或详情区

### 3. 边缘入口角色
- `environment status`
  - 只表达当前状态，不承担主交互
- `viewport control`
  - 只处理观察范围、缩放、面板空间
- `workspace entry`
  - 进入另一套同级工作面
  - 数量极少
- `support tool`
  - 进入帮助、参考、导出这类支持能力
  - 完整内容不得回壳层主舞台
- `task action`
  - 默认无资格常驻边缘壳层

## 三、标题与文字合同

### 1. 五级文字矩阵
- `主标题`
  - 只给 app 名和极少数顶层壳标题
- `主锚点`
  - 只给当前主区域，例如 `Project & Legend`
- `章节标题`
  - 只给正式区域和次级正式区域
- `标签锚点`
  - 壳层锚点、组内标签、字段标签
- `正文读数`
  - 正文说明、空状态说明、数值 / 坐标 / 百分比 / ID

### 2. 标题语义矩阵
- `Project`、`Inspector`
  - 只算壳层锚点
- `Project & Legend`
  - 主锚点标题
- `Country Inspector`、`Territories & Presets`、`Water Regions`、`Special Regions`
  - 正式区域标题
- `Frontline`
  - 次级区域标题
- `Utilities`
  - 支持入口头
- `Diagnostics`
  - 附录头
- `Visibility / Interaction / Water Overrides / Special Region Overrides`
  - 结构标签
- `Export Format` 一类字段名
  - 元信息标签
- `Select a water region to inspect`
  - 空状态说明标题，不再进入标题系统

### 3. HTML 语义约束
- 标题层级必须有稳定的 heading hierarchy，不能只有视觉大小，没有语义层级。
- 空状态标题、支持入口头、附录头都不能和正式区域标题共用同一级 heading 语义。
- 组内标签、字段标签默认不使用 heading。

## 四、按钮、图标与交互合同

### 1. `icon-only` 封闭豁免名单
- 允许：
  - 高频工具选择
  - 视口控制
  - 极少数壳层 utility
  - 颜色拾取等极少数微控件
- 不允许：
  - 项目级动作
  - 支持工具入口
  - 危险动作
  - 设置入口
  - 语言切换
- 所有 `icon-only` 必须有可访问名称，不能只靠 tooltip。

### 2. Button vs Link
- 导航、跳转、可深链入口一律用 link 语义。
- 执行、切换、确认、提交一律用 button 语义。
- 不允许继续用 click 伪装导航。

### 3. Primary action
- 每个当前工作面默认只有一个真正的 `primary action`。
- 位置固定在当前任务内容块末尾。
- 支持工具内部如果有主动作，只在工具内容区内部生效，不和当前任务主动作争位。

### 4. 危险动作
- 危险动作默认不能进壳层、顶条、右上 utility、主工具带。
- 危险动作必须有明确确认或可撤销窗口，不能只靠“看起来更红”。

## 五、状态、URL 与焦点合同

### 1. 状态矩阵
- `元信息状态`
  - 只交代当前事实
- `正文说明`
  - 解释为什么、下一步是什么、为什么不可用
- `信息读数`
  - 只读数量和数值
- 错误、冲突、缺失、阻塞最多抬升到 `正文说明`，不自动升级成标题层。

### 2. URL 状态白名单
- 必须进入 URL：
  - 主级 `scope`
  - 主级 tab
  - 正式章节的展开状态
  - 主要筛选与查询
  - 主要分页 / 视图模式
- 可以只做本地记忆：
  - 临时 hover
  - 局部工具提示显隐
  - 极短期 transient UI
- 自动默认状态与手动锁定状态必须可区分，恢复后不能混成一个上下文。

### 3. 键盘与焦点
- panel toggle、scope 切换、mode toggle、popover 入口、dialog 关闭都必须可键盘操作。
- 打开 popover / dialog / overlay 后，焦点落点必须明确。
- 关闭后，焦点必须回到触发器或稳定的合理回退点。
- 只有真正 dialog 才允许焦点陷阱。
- 统一使用 `:focus-visible`，不得无替代去掉 outline。

## 六、弹层与状态场景合同

### 1. Popover / Dialog / Overlay 边界
- `popover`
  - 只做局部、贴身、短停留、可快速退出的微操作
- `dialog`
  - 承载长阅读、完整表单、危险确认、跨区域比较、项目级设置
- `overlay`
  - 只处理真正阻塞态或独立工作空间切换
- 同一屏同一时刻不允许多层同级 popover 叠加成长链。

### 2. 最小状态集合
- 每个正式区域至少明确定义：
  - `empty`
  - `loading`
  - `error`
  - `available`
- 空状态不打碎区域结构。
- 错误状态必须写出下一步，不允许只说“出错了”。

## 七、密度与冻结范围合同

### 1. 三档密度
- `松`
  - 地图主画布、顶条、左 rail、dock 外层
- `中`
  - 右栏主章节、右上 utility 组、支持区、附录区
- `紧`
  - 局部列表、局部工具组、局部微控件、专业工作区内核
- 默认先按区域身份定档，再谈局部例外。

### 2. 当前冻结范围
- `Transport workbench` 内部具体改造
- 搜索壳
- 列表虚拟化与内部树结构
- 颜色拾取器内部 widget
- 各类动态 stack 内部细化

## 八、对后续计划的约束
- `02_MAINLINE` 只能在这份契约内做主界面主战场改造，不得自创新角色。
- `03_SUPPORT` 只能接管支持面、transport 和第二波 hardening，不得改写这里的边界定义。
- 后续任何实现文档都不再重复解释这份文件里的母规则，只引用。

## 验收标准
- 实现者不需要再自己判断：
  - 这是标题还是标签
  - 该用 button 还是 link
  - 这个能不能 `icon-only`
  - 这个该是 popover 还是 dialog
  - 这个状态要不要进 URL
- 如果实现者仍需自己补这些判断，说明这份文件还不够完成。
