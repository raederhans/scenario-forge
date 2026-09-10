# 近期地图改动整合

用户授权把其他任务近期改动与等值线优化全部合并、提交、推送。范围包括TNO多地区地名、地中海海面补缝、城区描边/缓存/缩放刷新、海深几何及陆地等高线P1–P4。保留历史提交及诊断产物，不提交.runtime或.playwright-mcp输出。

顺序：保存两侧功能提交；三方合并共享renderer/signature/tests；重建场景契约/catalog/import graph/dist；执行合并后的目标测试和localhost渲染检查；推送整合分支。main目标待用户明确；若授权则使用PR和全部必需检查，禁止绕过门禁。
