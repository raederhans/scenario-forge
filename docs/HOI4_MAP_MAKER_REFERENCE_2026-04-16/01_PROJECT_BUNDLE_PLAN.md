# 计划 01：Project Bundle 打包项目文件

## 目标

把当前只保存状态 JSON 的 project file，升级成可携带工作资源的 bundle 项目格式，先解决 `Reference Image` 这类资源恢复不完整的问题。

## 参考价值

外部工具在 README 和 Workshop 里都明确提供了打包项目文件能力：

- GitHub README 提到 `.hoi4proj` zip 格式项目文件
- Steam 页面强调它是完整工作流工具，不靠手工补文件

对我们最有价值的点有两个：

1. 用户迁移项目时拿走的是“完整工作现场”
2. 项目恢复时不再依赖用户重新手动补资源

## 当前项目现状

### current shipped

- `js/core/file_manager.js` 负责 project save/load
- 当前 project file 主要是 JSON 状态
- `Reference Image` 只保存 opacity / scale / offset
- 图片文件本体不进项目包
- `index.html` 的 Guide 文案已经明确写出“图片需要重新上传”

### 当前问题

1. project restore 不是完整恢复
2. reference 对位流程容易丢
3. 未来如果加入更多 project-local 资源，现有格式会越来越脆

## target migration

新增 `Scenario Forge Project Bundle`，首版只解决“状态 + 引用资源”的完整打包。

首版 bundle 应包含：

- `project.json`
- `assets/reference/` 下的本地引用图
- `manifest.json`

首版明确只覆盖：

- 当前 project 状态
- reference image
- 后续可扩展的资源清单机制

首版先不做：

- 任意大体积二进制素材库
- 自动收纳外部 transport 原始包
- 导出产物回收进 bundle

## 数据与接口

### 文件结构

```text
scenario_forge_project.sfproj
└── zip
    ├── manifest.json
    ├── project.json
    └── assets/
        └── reference/
            └── primary-reference.png
```

### manifest.json

```json
{
  "format": "scenario_forge_bundle",
  "version": 1,
  "createdAt": "ISO-8601",
  "projectFile": "project.json",
  "assets": {
    "referenceImage": "assets/reference/primary-reference.png"
  }
}
```

### 运行时接口变化

- `saveProjectFile()` 增加保存 bundle 的路径
- `loadProjectFile()` 增加 bundle 解包识别
- `referenceImageState` 除了对位参数，还要能关联 bundle 内资源引用

## 实现方式

### 阶段 1：格式收口

- 在 `file_manager` 增加 bundle manifest 读写
- 保留现有纯 JSON project file 兼容读取
- 新格式默认后缀建议用 `.sfproj`

### 阶段 2：reference image 收纳

- 保存时把当前 reference image blob 写入 bundle
- 加载时优先从 bundle 还原 object URL
- 保持现有 opacity / scale / offset 逻辑不变

### 阶段 3：兼容与迁移

- 老 `map_project.json` 继续可读
- 新 bundle 导出时显式标明版本
- UI 文案从“图片需要重新上传”改为“bundle 会一起保存图片”

## 为什么这样转移最合适

因为我们已经有成熟的 project state 保存链，真正缺的是“资源一起带走”。  
所以最短路径是扩展容器格式，不重写整个项目系统。

## 风险

1. 资源写入后文件体积会变大
2. 浏览器端 zip 打包要注意内存峰值
3. 历史 project file 兼容链要保持单向稳定

## 验收

- 保存 `.sfproj` 后，删除当前浏览器中的 reference object URL，再加载 bundle，图片仍能恢复
- 老 `map_project.json` 仍能正常读取
- Guide / Project 区文案同步更新
- 至少补 3 类测试：
  - bundle save/load roundtrip
  - legacy json compatibility
  - reference image asset restore
