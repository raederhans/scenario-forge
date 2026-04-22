## 任务
- 只做静态分析，不改代码，不跑测试。
- 核查两个 review 问题：1) chunk_runtime/lifecycle_runtime import path；2) scenario_rollback snapshot/restore 在 compat layer 下的最稳最小修法。
- 输出精确到文件/行附近的建议修改点，以及受影响测试。
