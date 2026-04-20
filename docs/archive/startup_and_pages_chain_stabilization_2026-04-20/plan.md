# plan
- 目标：修复本地启动脚本失效、恢复 GitHub Pages 构筑链、收紧 dev/build 入口与本地写接口边界。
- 已确认根因：`start_dev.bat` mode 参数继续传进 `dev_server.py`；CI 红灯主要来自拆分后仍检查旧 owner 文件的 contract tests。
- 本轮范围：启动脚本参数与 launcher、共享 entry resolver、dev token 鉴权、publish/path 白名单、workflow 权限与 action pin、Python lock files、过时测试迁移。
- 验证：targeted unittest + 全量 unittest + strict contract + smoke e2e，长命令统一后台日志。
