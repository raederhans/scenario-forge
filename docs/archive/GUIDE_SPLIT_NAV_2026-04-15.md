# GUIDE_SPLIT_NAV_2026-04-15

## Problem and Goal
Guide 现在内容完整，但纵向长度过长，阅读压力偏大。目标是在不删信息的前提下，把 Guide 拆成内部可切换的分段结构，让用户先看重点，再按需切换到其他章节。

## Scope and Non-Goals
In scope:
- 给 Scenario Guide 增加内部导航分段
- 保留现有双语内容
- 降低初次打开时的滚动长度
- 保持现有 Guide 打开/关闭逻辑不变

Out of scope (V1):
- 改写业务逻辑
- 把 Guide 抽成独立页面
- 引入复杂分页状态持久化

## Core Decisions
1. **What:** 用顶部 tab 式导航切分 Guide。  
   **Why:** 比长滚动更易读，比真正分页状态更简单。  
   **Reversal condition:** 如果后续章节继续增长，再升级成带前进后退的 pager。
2. **What:** 默认先打开 Quick path。  
   **Why:** 用户最常看的就是最短操作链。  
   **Reversal condition:** 如果后续数据证明用户更常看工具说明，再调整默认页签。

## Failure Cases and Acceptance
- Guide 首屏滚动长度明显下降。
- 所有章节都能通过 tab 切换访问。
- 不出现字符溢出、隐藏内容无法进入、语言切换失效。

## Implementation Phases
Phase 1: 结构拆分  
Done when: Guide 内容被拆成多个 section panel，并且只有当前 panel 显示。  
Status: 完成。

Phase 2: 导航交互  
Done when: tab 按钮可切换 panel，默认打开 Quick path。  
Status: 完成。

Phase 3: 样式与复查  
Done when: 桌面视口下排布稳定，静态校验通过。  
Status: 完成。

## Progress Notes
- 2026-04-15：选定最短路径方案，不做复杂 pagination state，先做 Guide 内部分段导航。
- 2026-04-15：已完成 4 个 guide section tab、隐藏/显示切换逻辑、对应样式和 i18n 标签。
- 2026-04-15：已通过 `node --check` 和 `python -m unittest tests.test_ui_rework_plan03_support_transport_contract -q`。
