# task
本任务对指定 TNO 1962 数据产物做静态 review。
范围仅限：
- `data/scenarios/tno_1962/runtime_topology.topo.json`
- `data/scenarios/tno_1962/chunks/political.coarse.r0c0.json`
- `data/scenarios/tno_1962/chunks/political.detail.country.atl.json`
- `data/scenarios/tno_1962/chunks/political.detail.country.ita.json`
- `data/scenarios/tno_1962/chunks/political.detail.country.ibr.json`
- `data/scenarios/tno_1962/chunks/political.detail.country.tur.json`

目标：基于当前工作树和 `git diff`，只找 correctness / regression / missing verification 风险；不跑长测试，只做只读比对。
输出：必修问题、可接受风险、确认通过点，并明确区分已证实事实与推断。
