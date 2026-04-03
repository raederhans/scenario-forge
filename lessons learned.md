# Lessons Learned

用于记录每次排查中真正值得复用的重大错误、触发症状和后续做法。

## 2026-04-03 - TNO 1962 bundle rebuild

### 现象
- 前台运行看起来像“闪退”或“刚开始就崩”。
- rebuild 耗时很长，中间几乎没有进度输出。
- rebuild 后会生成新的 detail chunk 文件，容易在提交时漏掉。

### 根因
- `tools/patch_tno_1962_bundle.py` 里的 `TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES` 含有已经失效的 Adriatica feature id，builder 在前置校验阶段直接抛异常退出。
- `west_med` 的 `state_owner_overrides` 错用了不存在的 `ALG` tag，正确映射应为 `8454 -> ALC`、`8465 -> IAL`。
- 前台环境对长命令和异常展示很差，容易把“Python 提前退出”误判成“构建进程崩溃”。

### 教训
- 看到“闪退”时，先假设是前置校验异常，不要先假设是随机崩溃。
- 长时间构建优先放到后台跑，并把 `stdout`、`stderr`、退出码、锁文件分开落盘。
- 完整 rebuild 前，先做最小验证：
  - `py_compile`
  - 关键配置和 override 的静态检查
  - 路径输入是否可解析
- 共享 checkpoint 目录时，必须只允许一个 builder 持有跨进程目录锁。
- rebuild 产物要按“整体”审查，不要只看代码文件。
- 如果 `detail_chunks.manifest.json` 引用了新 chunk，比如 `political.detail.country.eng.json`，提交时必须把该文件一起纳入版本控制，否则运行时会缺块或 404。

### 下次先查什么
- 先看后台 `stderr` 是否是前置校验报错。
- 先看 `.build.lock` 是否正常创建和释放。
- 先看新生成的 chunk 文件是否都被 manifest 引用、并已纳入提交范围。
- 先确认“构建链跑通”与“地图视觉错误修复”是不是同一个问题，避免混在一起排查。
