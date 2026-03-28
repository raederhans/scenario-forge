# 主线 A 进度留档

日期：2026-03-28

## 本轮目标

按既定顺序推进主线 A：

1. 清理 `RU_ARCTIC_FB_*` 这批 runtime-only shell fragment 对 feature maps 的污染。
2. 收缩 `geo_locale` 审查面，只把真正未处理的剩余项留给 strict。
3. 在前两步稳定后，把 TNO strict contract 从审查层升级到现有 `verify` 闸门。

## 本轮实际落地

### 1. runtime shell fragment 与 feature maps 已彻底隔离

- `tools/patch_tno_1962_bundle.py` 现在会在 feature maps 重建入口最前面跳过 `is_runtime_shell_fragment_row(row)`。
- `RU_ARCTIC_FB_*` 这类 runtime-only shell fragment 不再写入：
  - `owners.by_feature.json`
  - `controllers.by_feature.json`
  - `cores.by_feature.json`
- TNO 专用显式 assignment override 现在也会防守这条规则；如果 override 误指向 runtime shell fragment，会直接抛错停止。
- `RU_ARCTIC_FB_096` 和 `RU_ARCTIC_FB_114` 已从 `TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES` 中移除。

### 2. geo_locale 现在有明确的四层优先级

- `tools/build_tno_1962_geo_locale_patch.py` 现在固定采用：
  - manual override
  - 自动安全复制
  - 已审例外
  - strict 剩余报错
- 新增 TNO 本地例外文件：
  - `data/scenarios/tno_1962/geo_locale_reviewed_exceptions.json`
- 当前例外文件承担两件事：
  - 记录已确认的 collision 例外
  - 排除不应进入 locale 决策面的 synthetic / runtime-only 前缀
- builder 产物 audit 现在会显式记录：
  - `reviewed_collision_exception_count`
  - `excluded_feature_count`
  - `reviewed_collision_reason_counts`
  - `excluded_feature_prefixes`

### 3. strict 检查器已经按新规则工作

- `tools/check_scenario_contracts.py` 的默认模式和 `--strict` 模式保持不变。
- 但 strict 现在会把未处理的 `geo_locale` collision 当作错误，而不是警告。
- 已进入 reviewed exceptions 的冲突不再继续阻塞 strict。
- repair track 输出已同步带上 reviewed exception 计数，便于后续收敛追踪。

### 4. A3 已正式收口

- `.github/workflows/deploy.yml` 中现有 `verify` 已升级为运行 TNO strict contract。
- 没有新增第二套 deploy gate；仍然是沿用现有 `verify` 路径，只是把 strict 并入。

### 5. 本地 smoke 重复运行的启动稳定性也已收口

- `tests/e2e/support/playwright-app.js` 现在把 Playwright 专用测试端口固定到 `8810`，不再和默认手工开发端口池 `8000-8010` 混用。
- Playwright 本地运行现在默认复用现有 test server；CI 仍然保持严格不复用。
- `tools/dev_server.py` 已支持固定端口启动，测试入口和 server 生命周期现在用同一个端口契约。
- 这样处理后，连续无间隔两轮 `npm run test:e2e:smoke` 都能稳定通过，不再出现上一轮残留 test server 抢占端口导致的假红。

## 受影响的关键文件

### 代码与工作流

- `tools/patch_tno_1962_bundle.py`
- `tools/build_tno_1962_geo_locale_patch.py`
- `tools/check_scenario_contracts.py`
- `tools/dev_server.py`
- `tests/e2e/support/playwright-app.js`
- `.github/workflows/deploy.yml`

### 测试

- `tests/test_tno_bundle_builder.py`
- `tests/test_tno_geo_locale_patch.py`
- `tests/test_scenario_contracts.py`
- `tests/e2e/main_shell_i18n.spec.js`
- `tests/e2e/scenario_apply_resilience.spec.js`

### TNO 场景数据

- `data/scenarios/tno_1962/owners.by_feature.json`
- `data/scenarios/tno_1962/controllers.by_feature.json`
- `data/scenarios/tno_1962/cores.by_feature.json`
- `data/scenarios/tno_1962/countries.json`
- `data/scenarios/tno_1962/manifest.json`
- `data/scenarios/tno_1962/audit.json`
- `data/scenarios/tno_1962/geo_locale_patch.json`
- `data/scenarios/tno_1962/geo_locale_patch.en.json`
- `data/scenarios/tno_1962/geo_locale_patch.zh.json`
- `data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json`
- `data/scenarios/tno_1962/runtime_topology.topo.json`
- `data/scenarios/tno_1962/runtime_meta.json`
- `data/scenarios/tno_1962/chunks/...`

## 当前结果

### strict contract

- `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.strict_contract_report.json`
- 当前结果：通过

### Python 全量测试

- `python -m unittest discover -s tests -q`
- 当前结果：连续两次通过
- 最近一次结果：`Ran 91 tests ... OK`

### smoke E2E

- `npm run test:e2e:smoke`
- 当前结果：连续两次通过
- 最近两次结果：`4 passed`

## 关键实现判断

### 为什么这次实现方式是低风险的

- 没有去改共享 HOI4 编译链，只在 TNO patch 层收口规则。
- 没有用降级或兜底忽略 strict，而是把数据面和审查面显式化。
- 没有大批手工修改 locale 数据，而是新增 reviewed exceptions 输入层。
- 没有增加新的发布流程分叉，只是在现有 `verify` 上升级闸门。

### 这轮解决了什么

- strict 不再被 `RU_ARCTIC_FB_*` 这类 runtime-only shell fragment 污染。
- `geo_locale` 不再让 synthetic / reviewed 项长期挤占人工审查面。
- TNO strict contract 已可稳定进入默认验证链。

## 还没做的事

- 没有扩到其他 scenario。
- 没有进入前端主线 B。
- 没有做 `data/` 物理目录重排。
- 没有动 Worker / OffscreenCanvas 策略本身，只修了测试环境和启动端口一致性。

## 下一步建议

主线 A 已达到当前计划的收口条件。下一步不要再继续在 TNO strict 上扩大战线，除非出现新的真实数据回归。

更稳的后续顺序是：

1. 先保持这套 gate 运行一个完整迭代，确认没有新增 strict 回归。
2. 再决定是否切换到主线 B，继续收前端高风险写入口。
3. 如果后续 strict 再红，优先判断是 reviewed exceptions 需要更新，还是有新的 runtime-only feature 混入 feature maps，而不是立刻扩大抽象层。
