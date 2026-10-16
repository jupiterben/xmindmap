# XMindmap for VS Code

复用仓库中的 Vue 3 + TypeScript 思维导图编辑器，通过 VS Code Custom Text Editor 编辑真实文件。普通编辑完全离线，不启动本地服务器。可选 AI 在配置后获取模型列表，只有发送消息才向模型发送节点和对话内容。

## 安装

在 VS Code 扩展视图菜单中选择 **Install from VSIX / 从 VSIX 安装**，选择本目录构建出的 `xmindmap-0.1.0.vsix`。

此包用于本地安装，`xmindmap-local` 是开发用 publisher 标识，尚未发布到 Marketplace。

## 使用

- 命令面板运行 `XMindmap: 新建思维导图`，选择路径后创建 `.xmindmap` 文件。
- 直接打开 `.xmindmap` 或 `.smm` 文件进入导图编辑器。
- 已有 JSON 导图：资源管理器右键选择 `XMindmap: 用导图编辑器打开`，或打开文件后运行同名命令。插件不接管普通 `.json` 文件。
- 在右侧主题面板调整布局、配色、连线曲线/折线/直线。
- 编辑产生 VS Code 未保存状态；使用工具栏保存、Ctrl/Cmd+S 或 VS Code 自动保存将修改写入文件。
- 文件菜单的“重新打开编辑器 / Reopen Editor With”可以切回文本编辑器。
- 导入和复制会弹出新文件保存对话框，不会替换当前文件。
- JSON、Markdown、PNG、SVG 导出通过系统保存对话框完成，取消不会写入。
- 页面右侧常驻 AI 对话，小屏位于画布下方；点击齿轮配置 Key 后自动获取模型，下拉框快捷切换模型。发送对话后自动追加原节点的子主题，支持按轮撤销和停止请求。

### AI 配置与隐私

导图 Webview 获得焦点且选中单个节点时，可用 Ctrl+Alt+A（Mac：Command+Option+A）聚焦 AI 输入框。AI 设置里可修改、禁用或恢复默认，配置保存到插件 `globalState`，不依赖密钥。输入框和弹窗内不触发，不自动发送对话；若组合键被 VS Code 或系统占用，请换一组。

AI 请求由扩展宿主发出；Key 存入 VS Code `SecretStorage`，不返回给 Webview，不写入导图文件。界面只显示密钥是否已配置，并提供“忘记密钥”。地址或模型配置不会来自导入的文档；变更地址必须重新配置相应密钥。

保存连接后自动获取 `/models`（15 秒超时）；失败时可手动填写模型，不删除 Key。发送范围为当前节点、已有直接子主题和本窗口对话，在发送前可查看并确认。每轮最多 10 个子主题、对话最多 10 轮，60 秒超时、不自动重试。切换节点或文件会取消旧请求、清空会话，防止跨节点应用回复。取消不保证服务商不计费，不发送工作区其他文件。

需要可信工作区、有效的模型服务和 Node.js 22+ 的扩展宿主。不满足运行时条件时会提示升级 VS Code，不影响离线编辑。完整配置和限制见根目录 README 的 AI 扩展章节。

## 文件与历史

`.xmindmap` 是 JSON 文件，兼容网页版本 JSON 导出格式；不是 XMind 的 ZIP 文件格式。

文件保存由 VS Code TextDocument / WorkspaceEdit 管理，支持 VS Code 撤销、重做、保存及自动恢复。画布工具栏撤销操作由上游节点引擎处理；VS Code 文档级撤销会重新加载画布，同时重置画布内部历史。主题与布局变化使用 VS Code 文档级历史。

同一文件仅支持一个导图编辑面板。外部编辑、文本编辑器或撤销导致的文件变化会同步到画布；若与尚未同步的画布编辑冲突，停止覆盖并显示错误，可先导出备份再重新打开。

不读取或写入网页版本 localStorage。安全校验与网页一致：文件最大 5 MB，节点数和深度有限制，富文本转换成纯文本，不加载远程图片和任意主题 CSS。上游未支持的扩展属性可能在后续编辑保存时被规范化，因此编辑第三方 SMM 前请保留备份。

## 构建

Windows 推荐安装 Node.js 22.12+ 后，双击仓库根目录的 `build-vscode.cmd` 一键编译打包。脚本会增量安装两处依赖（需要联网，不修改锁文件），然后通过现有 `package` / `vscode:prepublish` 流程构建宿主和 Webview，生成本目录下的 VSIX。任何步骤返回失败时立即停止，窗口保留输出。

在仓库根目录的终端中运行：

```powershell
.\build-vscode.cmd --no-pause
```

其他平台或手动构建时，在仓库根目录安装网页依赖，再安装本目录依赖：

```sh
npm ci
cd vscode-extension
npm ci
npm run package
```

构建结果：

```text
vscode-extension/
  dist/extension.cjs          # TypeScript 扩展宿主 bundle
  webview/                   # 共享编辑器的离线静态资源
  xmindmap-0.1.0.vsix         # 可安装的插件包
```

## 开发

用 VS Code 单独打开 `vscode-extension` 目录，按 F5 运行 `Run XMindmap Extension`。调试前自动构建宿主和 Webview。网页源码仍位于仓库根目录 `src/`，不复制维护第二套编辑器。

最低 VS Code 版本：1.96。开发构建使用 Node.js 22.12+。

## 验证

仓库根目录 `npm test`、`npm run test:e2e` 验证共享编辑器及模拟宿主消息协议。本目录先运行 `npm run build`，再运行 `npm test`，会在本机安装的 VS Code 中运行扩展宿主测试，覆盖实际 TextDocument 编辑、保存、原生撤销重做、版本冲突、命令注册以及真实 Webview 的脚本加载和保存快照。

测试使用独立临时配置目录，不修改用户设置。Windows 默认读取当前用户安装的 VS Code；其他位置可设置 `VSCODE_EXECUTABLE_PATH`。测试源码及依赖不打包进插件。

## 安全与许可

Webview 仅允许加载本插件资源，使用 CSP、nonce 和受限 `localResourceRoots`，不允许 Webview 直接发起远程网络请求。AI 请求经消息协议由宿主在确认的连接设置下执行；文件写入目标来自 VS Code 的当前文档或用户确认的保存对话框。

本插件使用上游 MIT 导图引擎，保留其许可，详见包内 `THIRD_PARTY_NOTICES.md`。依赖审计及完整迁移边界见仓库根目录 README。
