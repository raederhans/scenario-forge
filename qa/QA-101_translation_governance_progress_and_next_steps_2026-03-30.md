# QA-101 翻译链路治理进展与后续事项

**日期**：2026-03-30  
**范围**：翻译链路治理第一阶段落地，包括显式 baseline、手工词典外置、来源审计、英文回退审阅队列、构建接线  
**边界**：不替换正式付费机器翻译 provider，不扩大机器翻译范围，不修改 scenario 结构，不覆盖人工场景命名

---

## 1. 本轮已完成内容

- 在 `data/i18n/` 下建立了显式翻译真值输入：
  - `data/i18n/locales_baseline.json`
  - `data/i18n/manual_ui.json`
  - `data/i18n/manual_geo_overrides.json`
  - `data/i18n/europe_geo_seeds.json`
- `tools/translate_manager.py` 现在默认读取显式 baseline，不再隐式依赖 `git show HEAD:data/locales.json`。
- `tools/translate_manager.py` 新增了运行期来源分类审计和英文回退审阅队列输出：
  - `.runtime/reports/generated/translation_source_audit.json`
  - `.runtime/reports/generated/translation_review_queue.json`
- 现有联网翻译入口被明确隔离为实验性 provider：`experimental_google_web`。
- `init_map_data.py` 已接入 baseline、audit、review queue 参数，默认构建仍然离线。
- `sync_i18n.bat` 已接入新的 baseline、audit、review queue 路径，单独同步入口与主构建行为保持一致。
- `tests/test_translate_manager.py` 已补充来源审计和 review queue 的最小单测。

---

## 2. 本轮核查结果

### 2.1 忠实度

- 离线运行 `translate_manager` 后，`data/locales.json` 的 SHA-256 仍为：
  - `ac848b3e3c649cfe2735bd2fe46588494e9f334c7eba24738f3d7124f0affdc7`
- 结论：
  - 显式 baseline 与手工词典外置没有造成 `locales.json` 内容漂移。

### 2.2 运行期报告

- `translation_source_audit.json` 已生成，来源分类覆盖与输出词条总数一致。
- 当前来源分布摘要：
  - UI：`manual_ui=348`，`existing_reuse=473`，`english_fallback=92`
  - GEO：`existing_reuse=39600`，`geo_seed=96`，`manual_geo_override=282`，`english_fallback=32663`
- `translation_review_queue.json` 已生成，当前待人工审阅条目数：
  - `89`

### 2.3 检查项

- `python -m py_compile tools/translate_manager.py init_map_data.py tests/test_translate_manager.py`
  - 通过
- `python -m unittest tests.test_translate_manager`
  - 通过
- `python tools/translate_manager.py --baseline-locales data/i18n/locales_baseline.json --audit-report .runtime/reports/generated/translation_source_audit.json --review-queue .runtime/reports/generated/translation_review_queue.json --network-mode off`
  - 通过
- `python tools/i18n_audit.py`
  - 通过
- `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962`
  - 通过

---

## 3. 这轮明确没做的事

- 没有把实验性机器翻译替换成正式付费 provider。
- 没有扩大机器翻译默认覆盖范围。
- 没有修改 `js/core/scenario_manager.js`、`js/core/scenario_resources.js` 或其它 scenario 结构拆分相关文件。
- 没有改动 `data/locales.json` 的现有词条结果。
- 没有把 review queue 直接回写进手工词典。

---

## 4. 当前剩余事项

### R-01：处理 89 条英文回退审阅队列

这是当前最稳、收益最高的下一步。

- 先人工审阅 `translation_review_queue.json`
- 把高价值 UI 词条补进 `data/i18n/manual_ui.json`
- 把高价值地名词条补进 `data/i18n/manual_geo_overrides.json` 或 `data/i18n/europe_geo_seeds.json`
- 每做完一批，重新跑离线 `translate_manager` 和 `tools/i18n_audit.py`

### R-02：清理历史遗留但仍被 baseline 复用的低质量翻译

当前 audit 说明很多词条来自 `existing_reuse`，这保证了忠实度，但不代表这些旧词条全部质量合格。

- 后续应单独审计 `existing_reuse` 里高频、明显不自然或历史遗留的中文译名
- 这一步应按小批次推进，不应一次性重写 baseline

### R-03：如果未来要接正式机器翻译 provider，再单独做第二阶段

当前策略仍符合“先两阶段推进、尽量零成本”。

- 如果未来需要正式 provider，应单独设计：
  - provider 接口
  - 凭据注入
  - 配额与成本约束
  - 与 review queue 的衔接
- 在这一步发生之前，不建议继续扩大 `experimental_google_web` 的职责

---

## 5. 结论

翻译链路第一阶段治理已经落地，而且结果是稳定的。

- 真值输入已经显式化
- 运行期证据链已经补上
- 英文回退已经被收敛成可审阅队列
- 默认构建仍然离线
- `locales.json` 没有发生漂移

接下来最合理的推进方向，不是继续自动翻译，而是把 review queue 里的高价值词条逐步转成手工真值。
