# further split baseline

结论：`further_split` 现在应当按当前代码基线继续推进，顺序写成 `scenario -> runtime_hooks/state ownership -> renderer API` 最稳。`state_catalog.js`、`runtime_hooks.js`、scenario owners、renderer owners 都已经落地，文档要围绕这些既成事实继续收口。

## 当前基线
- `scenario` 已经从单体文件拆出 owner。
  - `scenario_manager.js` 已导入 `./scenario/bundle_loader.js`
  - `scenario_resources.js` 已导入 `./scenario/chunk_runtime.js`、`./scenario/startup_hydration.js`、`./scenario/bundle_loader.js`
  - 证据：`js/core/scenario_manager.js:143`、`js/core/scenario_resources.js:81,84,116`
- `state` 已经完成两步 owner 收口。
  - `state_catalog.js` 负责 catalog / audit 默认 shape
  - `runtime_hooks.js` 负责显式 hook surface
  - `state.js` 继续保留 singleton facade
  - 证据：`js/core/state.js:23-31,108,649`、`js/core/state_catalog.js:1-27`、`js/core/runtime_hooks.js:1-76`
- `renderer` 已经完成两步 owner 落地。
  - `map_renderer.js` 已接入 `urban_city_policy.js`
  - `map_renderer.js` 已接入 `strategic_overlay_helpers.js`
  - 证据：`js/core/map_renderer.js:65-66`

## 已修正的过时内容
- “`state_catalog.js` 仍未存在” 这类表述已经失效。
- “`runtime_hooks.js` 仍未存在” 这类表述已经失效。
- “当前从 state 大爆炸切到 8 slices + Proxy + bus” 这类表述和当前 approved plan 不一致。
- “验证重点放在完整 Phase / 大型 E2E 基线” 这类写法过重，当前更适合围绕合同、静态门和定向 smoke 记账。

## 当前 approved plan
1. `scenario`
   - 继续把 scenario 生命周期、资源装配、恢复路径的 owner 边界写清。
   - 重点文件：`js/core/scenario_manager.js`、`js/core/scenario_resources.js`、`js/core/scenario/*.js`
2. `runtime_hooks/state ownership`
   - 继续让 `state.js` 保持稳定 facade。
   - 继续把默认 shape、factory、hook surface 明确放在 owner 文件。
   - 重点文件：`js/core/state.js`、`js/core/state_catalog.js`、`js/core/runtime_hooks.js`
3. `renderer API`
   - 继续让 `map_renderer.js` 保留稳定 facade 和 render orchestration。
   - 下一步更适合整理 donor 对外 API、owner 接线合同和最小 pass-through 面。
   - 参考口径：`docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md:5-9`

## 验证矩阵

### 结构合同
- `tests/test_state_split_boundary_contract.py`
- `tests/test_state_catalog_boundary_contract.py`
- `tests/test_runtime_hooks_boundary_contract.py`
- scenario / renderer 相关 boundary contract 按实际 owner 继续补齐

### 静态检查
- `node --check` 针对变更涉及的 owner / donor 文件
- `python -m unittest ...` 针对边界合同的定向检查
- 文档里只登记已经执行过的静态检查

### 定向 smoke
- startup wiring 相关 smoke
- scenario apply / recovery 相关 smoke
- renderer facade 相关 smoke
- 本轮 docs baseline 本身没有执行 smoke，只整理口径

### 日期和证据路径
- 每条验证都写执行日期，统一用绝对日期，例如 `2026-04-20`
- 每条验证都给证据路径、文件路径或命令路径
- 示例：`js/core/state.js:23-31,108,649`、`tests/test_runtime_hooks_boundary_contract.py`

## 本目录的留档用途
- `plan.md`：本批 docs baseline 的计划和完成标准
- `context.md`：当前代码事实、过时点和证据
- `task.md`：执行清单与交付状态
- 本文件：further split 总基线
- `STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`：state 相关 further split 基线
