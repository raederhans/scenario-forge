# 地图直接交互性能修复计划

目标：缩短缩放/拖动画面出现到真实可交互的时间，降低缩放后局部黑屏风险，稳定滚轮缩放过程中的锚点和耗时。

阶段：
- 修复 benchmark readiness gating，并新增 wheel/post-ready 诊断。
- 对 post-ready/deferred 重任务加交互让步和最小切片。
- 收紧 transformed frame 绘制安全点，避免先清 canvas 再发现缓存不可用。
- 保留视觉质量和 scenario correctness，避免靠关闭图层换速度。

验收：
- TNO balanced startup readonly 路径可跑 benchmark。
- wheel/drag 路径 blackFrameCount 保持 0。
- post-ready long task 大幅下降，滚轮锚点稳定后 drift 保持低位。
- 定向 e2e 和 benchmark 通过。
