# 计划 02：Project Health 与导出前检查

## 目标

把当前分散在 `Diagnostics`、`Export workbench`、手测脚本里的检查能力，收口成用户能直接理解的 `Project Health` 面板。

## 参考价值

外部工具把“full-map diagnostics + pre-export validation + auto-fix”放到了产品主链里。  
对我们最值得借的地方是：

1. 用户在导出前就知道风险
2. 问题按可操作方式显示
3. 工具像在引导完成，而不是只暴露底层状态

## 当前项目现状

### current shipped

- `index.html` 已有 `Diagnostics`
- `docs/EXPORT_QA_ACCEPTANCE_SCRIPT.md` 和 `docs/EXPORT_QA_MANUAL_CHECKLIST.md` 已定义了导出验收点
- `js/ui/sidebar.js` 已有诊断区壳
- `Export workbench` 已有约束与失败提示

### 当前问题

1. 检查结果散落在多个位置
2. 很多检查面向开发过程，用户难以理解
3. 缺少“现在能不能安全导出”的总判断

## target migration

新增 `Project Health`，定位为 Project tab 里的用户级健康面板。

首版聚焦 4 类问题：

1. 项目资源完整性
2. 场景一致性
3. 导出可行性
4. 用户动作提示

## 健康项设计

### A. Resource Health

- reference image 对位参数存在但源文件缺失
- project bundle 资源索引损坏
- 必需 project-local 资源未就绪

### B. Scenario Health

- saved scenario baseline 与当前资源不一致
- scenario import audit 缺失
- 必需 scenario support 数据未加载成功

### C. Export Health

- 当前导出配置超过 8K
- 当前导出任务繁忙
- 某些 text stack 配置不完整
- 某些预览源当前不可用

### D. UX Guidance

- 有未保存变更
- 当前操作面和导出目标冲突
- 关键工作面首次进入但尚未完成最小配置

## 实现方式

### 阶段 1：统一健康模型

新增统一 health model：

```js
{
  summary: "ready" | "warning" | "blocked",
  checks: [
    {
      id: "reference-image-missing",
      level: "warning",
      title: "...",
      message: "...",
      actionLabel: "...",
      actionTarget: "project.reference"
    }
  ]
}
```

### 阶段 2：把现有信号接进模型

信号来源：

- `file_manager`
- `interaction_funnel`
- `scenario import audit`
- export UI state
- dirty state

### 阶段 3：UI 落地

- Project tab 内新增 `Project Health`
- 顶部显示总状态
- 下方按 block / warning / ready 分组
- 每条问题给一个明确动作入口

### 阶段 4：与导出工作台联动

- Export workbench 顶部显示 health 摘要
- `blocked` 时直接阻断导出
- `warning` 时允许继续，但显示明确提示

## 为什么这样转移最合适

我们已经有大量检查信号，真正缺的是一个统一解释层。  
所以最短路径是“收口现有诊断”，而不是再发明一套新检测器。

## 自动修复策略

首版只做安全动作：

- 跳转到对应面板
- 恢复默认导出倍率
- 提示重新上传 reference image

首版不做高风险自动修复：

- 自动改 scenario baseline
- 自动覆盖项目状态
- 自动改复杂导出堆栈

## 风险

1. 开发态 diagnostics 和用户态 health 容易混层
2. 同一问题来源于多个模块时要避免重复提示
3. 阻断条件要收得稳，不能误拦正常导出

## 验收

- 项目有 reference image 参数但缺图时，Health 能给出 warning 和跳转动作
- 导出配置超限时，Health 显示 blocked
- export workbench 与 Project Health 的状态一致
- 至少补 3 类测试：
  - health model aggregation
  - export blocking consistency
  - resource-missing user guidance
