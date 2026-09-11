# 整合所有权

主代理是唯一Git整合、测试、server、build及CI观察owner；其他任务均已停止写入。

原工作树分支codex/tno-mediterranean-sea-closure，保存提交b19427ae。等值线保存提交2f521034。整合在C:/Users/raede/Desktop/dev/mapcreator-contours，分支codex/cartography-integration-20260910，基线origin/main=24169584。

日志根.runtime/tmp/cartography-integration-20260910。命令按顺序执行：目标Node/Python；check_scenario_contracts.py --strict；validate_tno_water_geometries.py；build_data_catalog.py；build_test_import_graph.mjs；build_pages_dist.py。每个命令退出0且输出通过才算成功，不用后续命令覆盖失败。浏览器localhost8008独立进程，运行时不并行CPU重活；检查后停止。

必需远端检查：PR Verify Required、perf-gate、transport-contract-required、三个strict-scenario-contract-review。不得更新冻结基线或修改allowlist掩盖失败。
