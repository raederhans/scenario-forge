# 当前状态

第三轮本地实现、目标验证和两组串行对照已完成。分支 `codex/performance-round-20261002`，所有改动尚未提交、推送或发布。

TNO 100%→200% 缩放后，后台完整背景收尾从 3.10–3.23 秒降至 1.04–1.14 秒，新建路径从 11788–11908 降至 840；复用旧完整缓存的 11139 条路径，不回填 LRU。数据代次仍约束异步任务和完整发布，单条几何路径在投影签名及 geometry 引用相同的条件下复用。

exact 排序修复消除了约 20 ms 的重复 snapshot 扫描；完整精确刷新仍约一秒，尚无稳定加速。下一项结构性证据应定位 political Worker 内部分项，不能凭主线程等待直接改 Worker 算法。

115 项不同 Node、14 项 Python、architecture boundary、test import graph、diff 检查通过。静态审查未发现实质问题。两组候选浏览器无 error/warn，重复样本地图截图对照一致；首候选压缩截图有小幅差异，来源未定，不宣称全画面像素等价。

详细数字、测量边界和残余问题见 `.runtime/reports/generated/performance-round3/results.md`。本轮服务器和浏览器页面已关闭。
