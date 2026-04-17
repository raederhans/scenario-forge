# 计划 03：HOI4 Donor Import 导入链

## 目标

为 `Scenario Forge` 增加一个“从现有 HOI4 mod 提取可复用数据”的 donor import 链路，把对方工具的 `Import existing MOD maps` 转成适合我们项目的输入能力。

## 参考价值

外部工具支持导入已有 MOD 地图，这说明它把自己定义成创作中枢，而不是单点编辑器。  
这条能力对我们的价值更高，因为我们本身就是 scenario-first 工作台，很适合把外部 mod 当 donor/source。

## 当前项目现状

### current shipped

- 已有多 scenario baseline
- 已有 project save/load
- 已有大量 scenario-scoped 数据发布链
- `qa/HGO_reference_reports_2026-03-08/` 已经说明团队会做 donor/reference 式复用分析

### 当前问题

1. donor 数据导入更多靠手工离线流程
2. 缺少统一导入入口
3. 缺少“读进来什么、覆盖什么、发布成什么”的用户级契约

## target migration

首版 donor import 只做“只读提取 + 结构化映射 + 人工确认接入”。

首版范围：

- state histories
- countries / tags / colors
- localisation
- adjacency / strait

首版不做：

- 直接把 donor 变成完整 scenario
- 自动导入地形 / heightmap / province bitmap
- 自动覆盖当前 checked-in 正式产物

## 功能边界

### 用户入口

新增 `Project → Import → HOI4 Donor`

### 输入

- 一个 HOI4 mod 根目录

### 输出

- donor scan report
- import preview
- 用户确认后的 scenario-scoped partial

## 数据流

```text
选择 HOI4 mod 目录
→ 扫描 descriptor.mod / common / history / localisation / map
→ 生成 donor inventory
→ 映射到 Scenario Forge 可接的导入模型
→ 用户选择导入项
→ 写入 scenario import workspace
→ 再走现有 materialize / publish 链
```

## 数据接口

### donor inventory

```json
{
  "sourceRoot": "path",
  "modName": "string",
  "items": {
    "states": { "count": 0 },
    "countries": { "count": 0 },
    "localisation": { "count": 0 },
    "adjacencies": { "count": 0 }
  }
}
```

### import workspace

建议新建 scenario-scoped import partial：

- `scenario_mutations.import.partial.json`
- `country_catalog.import.partial.json`
- `localisation.import.partial.json`
- `adjacency.import.partial.json`

## 实现方式

### 阶段 1：扫描器

- 只读扫描 HOI4 mod 目录
- 识别关键目录和文件
- 输出 donor inventory 和错误报告

### 阶段 2：映射器

- 把 donor 数据映射成内部 import DTO
- 清晰区分：
  - 可直接接入
  - 需要人工确认
  - 当前不支持

### 阶段 3：预览器

- UI 显示 donor 内容摘要
- 按类型勾选导入
- 每项显示写入目标

### 阶段 4：接入现有构建链

- 导入结果先进入 import partial
- 再由现有 compose / materialize / publish 消化
- 不允许直接旁路写 checked-in 正式输出

## 为什么这样转移最合适

因为我们当前系统已经非常强调 canonical input 和 publish contract。  
所以 donor import 必须是“新输入源”，不能变成绕过契约的快捷写口。

## 风险

1. HOI4 mod 数据方言多，首版范围必须收紧
2. localisation 编码和命名差异大
3. 直接覆盖正式 scenario 产物会放大风险

## 验收

- 能扫描一个标准 HOI4 mod 根目录并产出 inventory
- 能把 states / countries / localisation / adjacency 映射到 import preview
- 导入写入的是 scenario-scoped import partial，而不是正式发布文件
- 至少补 4 类测试：
  - donor root detection
  - DTO mapping
  - unsupported file classification
  - import partial write contract
