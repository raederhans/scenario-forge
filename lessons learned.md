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

## 2026-04-03 - 前台测试会话不稳，后台日志更可靠

### 现象
- 同一套 `unittest`，前台直接跑时容易看起来像“Codex 又闪退了”。
- 改成后台日志模式后，测试能持续执行，并把完整堆栈和最终结果写出来。

### 根因
- 不稳定的不是测试逻辑本身，而是当前前台终端/对话会话对长输出、长时运行和异常展示的承载能力。
- 前台模式把“测试进程”和“当前会话”绑在一起，会话一旦中断，就会误以为测试进程也崩了。
- 后台模式把 Python 进程和当前会话拆开，`stdout`/`stderr` 重定向到文件，所以就算前台会话掉了，测试本身仍能跑完。

### 教训
- 小范围测试可以前台跑，完整 `pytest/unittest` 套件默认用后台日志模式。
- 长测试不要一边跑一边在前台强依赖流式输出，优先看落盘日志。
- 如果前台看起来“闪退”，先不要重复乱跑；先看后台日志里有没有真实异常。
- 后台日志模式更适合区分两类问题：
  - 是代码真的失败
  - 还是前台会话自己断了

### 下次先查什么
- 先确认后台 PID 是否还活着。
- 先看 `.runtime/tmp/*.out.log` 和 `.runtime/tmp/*.err.log` 是否持续更新。
- 先看测试是否真的退出，以及退出码和最后一段堆栈是什么。

## 2026-04-03 - 抽离重逻辑时，要按事务边界拆，不要按文件类型拆

### 现象
- `tools/dev_server.py` 里最重的不是 HTTP 层，而是“读取 context + 应用 mutations + 生成 mirrors + 拼 transaction”这一整笔政治物化事务。
- 如果只按“countries/owners/catalog/capital 各搬一段”去拆，很容易把一部分逻辑搬走，另一部分仍留在原文件里，结果变成两套半重叠实现。

### 根因
- 之前是按文件类型和产物类型思考，而不是按一次保存操作真正提交了哪些状态来思考。
- political save 的真正边界其实是：`context + mutations_payload -> transaction_payloads + materialized payloads`。

### 教训
- 遇到这种重逻辑模块时，先找“完整事务边界”，再决定新模块怎么切。
- 先把核心事务抽成独立 materializer，再让入口函数变薄，比到处搬零散 helper 更稳。
- 对 capital、catalog、manual overrides 这种镜像层，要默认把它们看成同一笔事务的一部分，不能拆漏。

### 下次先查什么
- 先确认某段逻辑的输入和输出是不是已经能描述成一笔完整 transaction。
- 先确认新模块抽走后，原入口是否真的只剩校验、锁、提交、响应整形。

## 2026-04-03 - Cleaning repo-local Claude worktrees

### Symptom
- Removing worktrees under `.claude/worktrees/` changed the main repo `git status` immediately.
- Cleaned worktrees showed up as deleted entries in the root repo instead of disappearing as pure local housekeeping.

### Root Cause
- These Claude worktrees live inside the repository path, not outside it.
- Git sees repo-local worktree directories as part of the working tree surface, so create/remove actions affect the root repo status view.

### Lesson
- If worktrees are meant to be disposable, prefer putting them outside the repo root.
- Before cleaning repo-local worktrees, check root `git status` first so the resulting `D` or `m` entries are not mistaken for unrelated code changes.

### Next Time Check First
- Whether the worktree paths are inside the tracked repo tree.
- Whether the user expects local cleanup only, or also wants the resulting repo status noise cleaned up afterward.
