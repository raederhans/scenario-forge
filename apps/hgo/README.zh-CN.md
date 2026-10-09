# HGO 原生地图工坊

HGO 是与主编辑器并行的子项目。它直接使用模组的原始像素地图，独立加载、渲染、保存和测试；海域与陆地的州使用同一套编辑工具。国家标签是参考资料，不参与归属编辑。

## 本地打开

在仓库根目录运行：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/apps/hgo/`。随附数据足以运行，无需安装或下载原始模组。浏览器需要 WebGL 2，显卡需支持至少 5120×2560 的纹理；完整性校验与 gzip 解码需要 localhost 或 HTTPS。

主编辑器的剧本面板、指南与网站首页均有 HGO 入口。主编辑器打开原生 HGO JSON 时会转交给独立页面；双方通过限时、一次性项目交接传递文档，不导入彼此的渲染器或状态。

## 编辑

- 点击选州，Shift+点击多选；绘制工具直接为点击的州上色。海域同样可选、可上色。
- 搜索接受原生州名、州 ID 和参考实体标签；结果可定位到只有一个像素的州。
- 选中单州后可改地图标签，留空恢复原名；上色与标签支持撤销、重做。
- 拖动平移、滚轮缩放，可开关州边界、地名标签和原生城市。
- 保存下载 JSON；打开时先验证完整项目及数据修订号，失败不会覆盖当前文档。
- PNG 导出完整的 5120×2560 原生地图，保留已启用图层，不包含选中高亮。

快捷键：V 选择、B 绘制、H 平移、0 全图、+/- 缩放；Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 重做，Ctrl/⌘+S 保存，Ctrl/⌘+O 打开。

## 数据与边界

当前数据包含 11,894 个州、20,782 个省份定义、570 个参考实体和 884 个有效原生地点。其中 924 个州属于 WTR 海域；20,781 个省份实际出现在地图像素中。原始省份 0 没有像素，但仍保留独立的编码，不能与空白编码 0 混淆。

坐标为原生左上角像素，未经推测的经纬度转换。州锚点必须落在自己的真实像素内。城市来自原始胜利点与本地化资料；无法对应所在州的陈旧引用会省略，并在 provenance.json 中记录。国家首都州保留为源信息，不由此猜造首都城市。两个源文件缺失末尾括号采用字节指纹限定的解释修正，原始模组文件不被写入。

原生地图与名称来自 Historic Geographical Overhaul（`hgo_mod_2241701657`）。[来源账本](../../data/source_ledger.json)记录其出处与来源条款，[数据溯源文件](assets/default/provenance.json)记录精确输入与解释诊断；项目代码的许可不改变第三方数据的来源条款。

项目格式为 `scenario-forge-hgo` / schema 1，绑定精确数据修订号。旧 HGO 共底/预览项目使用另一套地图，不能作为新项目导入。当前不提供现代地理投影、归属编辑、省份几何编辑或旧项目转换。

## 单独检查和打包

```powershell
npm --prefix apps/hgo test
npm --prefix apps/hgo run check
python -m pip install -r apps/hgo/requirements.txt
python -B -m unittest discover -s apps/hgo/tests -p 'test_*.py'
python -B apps/hgo/tools/validate_dataset.py apps/hgo/assets/default
python -B apps/hgo/tools/build_app.py --output .runtime/dist/hgo
```

独立打包器只需 Python 标准库。NumPy、Pillow 只用于源数据生成、数据校验及其测试；浏览器运行时没有 npm、CDN 或字体网络依赖。完整 Pages 构建会把该包放在 `/hgo/`，主编辑器位于 `/app/`。

默认独立包位于 `.runtime/dist/hgo`，返回链接按仓库根目录提供服务时的路径生成。放到其他目录或单独托管时，用 `--main-url` 指定主编辑器地址。

PR 中的纯 HGO 修改只选择 HGO 独立检查；同时修改主应用或发布桥接时，保留对应主应用检查。PR gate 会等待被选中的 HGO job 完成，网站发布仍走统一 Pages 构建。GPU 与真实浏览器行为仍需独立运行时检验，静态边界检查不代表这一层已经通过。

数据重建命令、资产格式和 Python 接口见 [英文技术说明](README.md)。
