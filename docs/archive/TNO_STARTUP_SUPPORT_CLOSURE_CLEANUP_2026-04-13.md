# TNO startup support closure cleanup 2026-04-13

## 目标
- 清理 root 级 legacy startup support 路径依赖
- 把 e2e 旧 root 路径夹具切到 scenario-scoped
- 以最小改动收尾，不扩大 startup support 责任范围

## 实施清单
- [x] 扫描 legacy root startup support 引用
- [x] 修改 e2e 夹具与相关静态引用
- [x] 删除或停止依赖 root 级 legacy startup support 文件
- [x] 跑最小验证
- [x] 留档归档

## 进度记录
- 2026-04-13：开始做 startup support 收尾清理。
- 2026-04-13：`tests/e2e/review_regressions.spec.js` 已把 startup cache regression 夹具从 root 路径切到 scenario-scoped：
  - `data/scenarios/tno_1962/locales.startup.json`
  - `data/scenarios/tno_1962/geo_aliases.startup.json`
- 2026-04-13：已删除 root 级 legacy startup support 文件：
  - `data/locales.startup.json`
  - `data/geo_aliases.startup.json`
- 2026-04-13：静态复核后，`tests/js/tools/index.html/dist` 下已无运行时或测试代码继续依赖 root startup support 路径；剩余命中只在 `tests/test_startup_shell.py` 的负向断言里。

## 本轮验证
- `python -m unittest tests.test_startup_shell -q`
- `rg -n "data/locales\.startup\.json|data/geo_aliases\.startup\.json" tests js tools index.html dist -S`

## 结论
- 这轮收尾已经把两处最明显的遗留兼容尾巴清掉了：root legacy 文件和 e2e 旧夹具路径。
- 现在这条 startup bundle / startup support 拆分线，结构上可以视为基本收官；后续如果还有工作，主要只剩水域命名域是否单独建 locale 资产链这个产品/数据决策。

