# 计划 05：Quick Init 批量初始化动作

## 目标

把“新项目 / 新 scenario 打开后的一堆重复设置”收口成几个安全的初始化动作，减少空白期和手工重复劳动。

## 参考价值

外部工具的 `Quick Init` 是“一键生成 states + strategic regions + default country”。  
我们项目不走同一条地图生成路线，但它背后的价值很适合迁过来：

- 给用户一个能立刻开始的基础工作状态
- 把重复动作变成显式初始化动作
- 降低第一次成功的门槛

## 当前项目现状

### current shipped

- 已有多 scenario baseline
- 已有 palette / overlay / project state
- 已有 guide、reference、export 这些工作面
- 已有很多 project-local 配置状态

### 当前问题

1. 新项目刚打开时偏空
2. 新 scenario 的常用配置靠手动点很多步
3. 缺少“我现在先帮你铺一个可用底”的动作

## target migration

新增 `Quick Init` 面板，首版只做低风险初始化。

## 首版初始化包

### A. Scenario editing starter

- 应用推荐视图
- 设定推荐 interaction granularity
- 打开必要 guide 提示

### B. Presentation starter

- 应用推荐 palette baseline
- 应用推荐 overlay preset
- 初始化 export preset

### C. Project starter

- 创建空 legend scaffold
- 创建默认 export profile
- 创建空 project notes / import audit scaffold

## 首版明确不做

- 自动生成地图几何
- 自动改 ownership 数据
- 自动生成国家目录
- 自动写入大体量 transport 数据

## 实现方式

### 阶段 1：定义 init recipe

每个 quick init 是一份 recipe：

```json
{
  "id": "scenario-editing-starter",
  "label": "Scenario Editing Starter",
  "effects": [
    "set default view",
    "set default split",
    "open guide section"
  ]
}
```

### 阶段 2：接入项目状态写链

- 复用现有 state normalization
- 每个 init recipe 走统一写链
- 每个 recipe 都能进入 undo/redo

### 阶段 3：UI 落地

- Start Workspace 中显示推荐 init
- Project tab 中保留二次执行入口
- 每个 recipe 显示会改哪些东西

## 为什么这样转移最合适

因为我们的核心资产已经存在，真正缺的是“怎么把这些资产铺成一个顺手的起点”。  
所以首版 Quick Init 应该初始化工作台，不应该越界去生成复杂业务数据。

## 风险

1. recipe 改动太多会让用户失去掌控感
2. recipe 与 scenario 特性不匹配时会产生反效果
3. 一次改多个状态必须纳入同一历史事务

## 验收

- 运行任一 Quick Init 后，相关设置一次性到位
- Quick Init 变更能被 undo/redo
- UI 会清楚显示 recipe 的影响范围
- 至少补 3 类测试：
  - recipe state application
  - transaction / history integration
  - scenario-aware preset selection
