# QA-095 — HOI4 1936/1939 规则元数据对齐与风控修复（2026-03-10）

## 目标
落实审计报告中仍然存在的可执行问题，优先消除排序隐患并统一规则版本，同时恢复 1939 的区域检查开关（先启用检查、暂不强制阻断）。

## 变更范围

### 1) 1936 priority 碰撞消除
文件：`data/scenario-rules/hoi4_1936.manual.json`

- `japanese_korea`: `109 -> 110`
- `italy_absorbs_san_marino_1936`: `220 -> 234`

说明：
- 初始审计建议中的 `220 -> 221` 会与现有 `dutch_east_indies` 发生新的碰撞。
- 本次改为 `234`，并确认文件内已无重复 priority。

### 2) 1939 规则版本升级到 v2
文件：
- `data/scenario-rules/hoi4_1939.manual.json`
- `data/scenario-rules/hoi4_1939.controller.manual.json`

变更：
- 两文件 `version: 1 -> 2`

### 3) 1939 region checks 恢复为启用状态（灰度）
文件：`data/scenario-rules/hoi4_1939.manual.json`

变更：
- `state_delta_coverage.enable_region_checks: false -> true`
- `state_delta_coverage.enforce_region_checks: false`（保持不变）

说明：
- 当前先启用检查逻辑并在审计输出中暴露覆盖与失败信息；
- 由于 1939 仍沿用编译器内置区域检查集合，未在本次提交中直接切到 `enforce=true`，避免在无专项区域规则补齐前导致构建硬阻断；
- 后续可在补齐 1939 特有 region checks 后再提升到强制模式。

## 执行校验
- `jq '.version' data/scenario-rules/hoi4_1936.manual.json data/scenario-rules/hoi4_1939.manual.json data/scenario-rules/hoi4_1939.controller.manual.json`
- `jq '.state_delta_coverage.enable_region_checks, .state_delta_coverage.enforce_region_checks' data/scenario-rules/hoi4_1939.manual.json`
- `jq -r '.rules[] | [.priority, .rule_id] | @tsv' data/scenario-rules/hoi4_1936.manual.json | sort -n | awk 'prev==$1{print $1"\t"prev_id"\t"$2}{prev=$1;prev_id=$2}'`

结果：
- 三份规则文件版本均为 `2`；
- 1939 region checks 开关已启用，enforce 保持灰度；
- 1936 规则 priority 无重复项。
