# 计划 04：启动页与 Contextual Hint

## 目标

把当前零散的 onboarding、Guide、Project 工具入口，收口成一个真正能带用户开工的起始面。

## 参考价值

外部工具的 README 明确给出这三件事：

- Welcome Page
- Getting Started Guide
- Mode Hint Bar

这套组合很适合我们，因为我们已经有：

- `Scenario Guide`
- `mapOnboardingHint`
- Project / Utilities / Reference / Export

我们差的是一个统一入口，而不是完全没有基础。

## 当前项目现状

### current shipped

- `index.html` 有 `mapOnboardingHint`
- `index.html` 有完整 `Scenario Guide`
- `js/ui/toolbar.js` 已控制 onboarding hint 的显示和隐藏
- Guide、Reference、Export 都已留在 Project 区

### 当前问题

1. 首次进入时缺少“从哪里开始”的总入口
2. onboarding hint 太轻，只能解决一个局部动作
3. Guide 与具体工作面的衔接还不够强

## target migration

新增 `Start Workspace` 启动面，定位为首次进入或空项目时的总入口。

## 页面结构

### A. Start actions

- New project
- Open project
- Import HOI4 donor
- Open recent project

### B. Workflow cards

- Edit scenario ownership
- Add frontline / overlays
- Align reference image
- Export final image

### C. Learning lane

- Quick start
- What each workspace does
- Current scenario tips

## contextual hint 规则

### 触发维度

- 首次进入某工作面
- 当前 scenario mode
- 当前是否已有 reference image
- 当前是否已有 unsaved changes
- 当前是否处于 export 前状态

### 例子

- 第一次打开 Project tab 且无 reference image：提示先用 Guide 了解流程，再决定是否上传参考图
- 第一次打开 Export：提示先检查 Project Health
- 第一次进入 scenario editing：提示先确认 Active Owner

## 实现方式

### 阶段 1：状态模型

新增轻量 onboarding state：

```js
{
  firstRun: true,
  visitedSurfaces: {
    project: false,
    export: false,
    frontline: false
  },
  dismissedHints: {
    exportHealth: false
  }
}
```

### 阶段 2：启动面

- 空项目或首次运行时显示
- 和现有主界面并存
- 以 overlay / modal shell 方式接入，避免大改主布局

### 阶段 3：hint engine

- 用统一规则生成 contextual hint
- 替代只写死一条“Click a region to start painting”
- 各 hint 直接指向对应 Guide / panel / action

### 阶段 4：recent project

- 保存最近打开项目列表
- 支持最近 bundle / json project 快速恢复

## 为什么这样转移最合适

因为我们已经有 Guide、Project 工具和少量 hint。  
最短路径是做一个“统一起始层”和“规则化提示层”，而不是重做整套教学系统。

## 风险

1. 启动面太重会打断老用户
2. hint 过多会变成噪音
3. recent project 要注意本地文件权限与隐私感知

## 验收

- 首次打开时能看到明确的开工入口
- 从启动面能直接进入 Guide、Open Project、Reference、Export 主链
- contextual hint 会根据工作面变化，而不是固定一条文案
- 至少补 3 类测试：
  - onboarding state transitions
  - hint selection rules
  - recent project restore UI behavior
