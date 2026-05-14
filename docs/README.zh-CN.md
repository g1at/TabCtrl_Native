# TabCtrl 本机消息桥接

这个目录包含 TabCtrl 可选的 native bridge。扩展通过 `native_bridge` 工具调用本机白名单 CLI，但默认不会启用；只有在 Settings -> Lab 打开后，模型才会看到并请求调用。

TabCtrl 仍优先使用浏览器工具完成读取、点击、输入和短文本编辑。native bridge 更适合飞书/Lark 这类结构化 API、批量处理、长文档写入、文件上传等场景。`run` 调用默认经过扩展侧审批；Settings -> Lab 的免审批命令只跳过确认弹窗，native host 本身仍只会执行当前平台配置允许的逻辑命令。

## 目录

```text
native/
|-- config/
|   |-- bridge.config.schema.json
|   |-- windows/bridge.config.json
|   |-- macos/bridge.config.json
|   `-- linux/bridge.config.json
|-- docs/
|   |-- README.en.md
|   `-- README.zh-CN.md
|-- com.tabctrl.bridge.json
|-- generate-manifest.cjs
|-- host.cjs
|-- install-windows.ps1
|-- install-macos.sh
|-- install-linux.sh
|-- uninstall-macos.sh
|-- uninstall-linux.sh
|-- tabctrl-bridge.cmd
`-- tabctrl-bridge.sh
```

## Windows 安装

在仓库根目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install-windows.ps1
```

注册 Edge：

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install-windows.ps1 -Chrome Edge
```

安装脚本默认注册 Chrome Web Store 版本的扩展 ID：`bniefocpdldneagigjlhbllgdjohmeie`。如果你正在调试 Load unpacked 开发版，可以手动传入开发版扩展 ID：

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install-windows.ps1 -ExtensionId <extension_id>
```

也可以从当前 `manifest.json` 的 `key` 推导开发版扩展 ID：

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install-windows.ps1 -UseManifestKey
```

Windows 脚本会生成 `native/com.tabctrl.bridge.installed.json`，并写入当前用户注册表：

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tabctrl.bridge
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.tabctrl.bridge
```

## macOS 安装

Chrome：

```bash
bash native/install-macos.sh --browser chrome
```

Chromium：

```bash
bash native/install-macos.sh --browser chromium
```

Edge：

```bash
bash native/install-macos.sh --browser edge
```

用户级 manifest 会写入：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabctrl.bridge.json
~/Library/Application Support/Chromium/NativeMessagingHosts/com.tabctrl.bridge.json
~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.tabctrl.bridge.json
```

卸载：

```bash
bash native/uninstall-macos.sh --browser chrome
```

调试 Load unpacked 开发版时，可以传入 `--extension-id <id>`，或使用 `--use-manifest-id` 从本地 `manifest.json` 的 `key` 推导扩展 ID。

## Linux 安装

Chrome：

```bash
bash native/install-linux.sh --browser chrome
```

Chromium：

```bash
bash native/install-linux.sh --browser chromium
```

Edge：

```bash
bash native/install-linux.sh --browser edge
```

用户级 manifest 会写入：

```text
~/.config/google-chrome/NativeMessagingHosts/com.tabctrl.bridge.json
~/.config/chromium/NativeMessagingHosts/com.tabctrl.bridge.json
~/.config/microsoft-edge/NativeMessagingHosts/com.tabctrl.bridge.json
```

卸载：

```bash
bash native/uninstall-linux.sh --browser chrome
```

macOS/Linux 脚本会自动给 `native/tabctrl-bridge.sh` 加执行权限。系统需要能从终端运行 `node`。
调试 Load unpacked 开发版时，可以传入 `--extension-id <id>`，或使用 `--use-manifest-id` 从本地 `manifest.json` 的 `key` 推导扩展 ID。

## 配置命令白名单

编辑当前系统对应的配置文件：

- Windows：`native/config/windows/bridge.config.json`
- macOS：`native/config/macos/bridge.config.json`
- Linux：`native/config/linux/bridge.config.json`

host 会自动选择当前平台配置。为了兼容旧版本，如果平台配置不存在，也会继续尝试 `native/config/bridge.config.json` 和旧的根目录 `native/bridge.config.json`。

默认 Windows 配置列出飞书/Lark CLI 候选：

```json
{
  "$schema": "../bridge.config.schema.json",
  "commands": {
    "feishu": {
      "win32": ["%APPDATA%\\npm\\feishu.cmd", "feishu.cmd", "feishu", "lark-cli.cmd", "lark-cli"]
    }
  },
  "maxTimeoutMs": 120000,
  "maxOutputBytes": 1048576,
  "allowCwd": false
}
```

`commands` 的键是 TabCtrl 使用的逻辑命令名。每个平台文件可以只保留该系统相关候选；host 仍兼容旧的合并配置格式。host 会展开 `%APPDATA%`、`$HOME`、`${HOME}`、`~`，并自己扫描 `PATH`，不会通过 `which`、`where` 或 shell 来解析命令。

`config/bridge.config.schema.json` 提供编辑器提示和基础类型校验。它支持平台键 `win32`、`windows`、`darwin`、`macos`、`linux`、`unix`、`candidates` 和 `default`，也支持旧版 `allowedCommands`。schema 是编辑辅助，实际执行仍以 native host 的 allowlist、风险诊断和路径解析为准。

## 高级用户自定义命令

TabCtrl 不禁止极客用户扩展平台配置。你可以加入自己信任的专用 CLI，例如文档转换、内部工单、知识库、构建产物查询等工具：

```json
{
  "commands": {
    "pandoc": {
      "win32": ["pandoc.exe"],
      "darwin": ["/opt/homebrew/bin/pandoc", "pandoc"],
      "linux": ["/usr/bin/pandoc", "pandoc"]
    },
    "corp-ticket": {
      "win32": ["corp-ticket.exe"],
      "darwin": ["corp-ticket"],
      "linux": ["corp-ticket"]
    }
  }
}
```

这类命令仍然不是“任意 shell 字符串”。模型只能调用：

```json
{
  "action": "run",
  "command": "pandoc",
  "args": ["--version"]
}
```

host 会把 `args` 当作字符串数组传给白名单程序。除 Windows `.cmd/.bat` wrapper 的兼容路径外，host 不会自动套 `sh -c`、`bash -lc`、`cmd /c` 或 `powershell -Command`。

### 风险分级建议

- 推荐：只加入目的单一、参数语义明确、不会执行任意脚本的专用 CLI，例如 `feishu`、`lark-cli`、`pandoc`、公司内部只读查询工具。
- 谨慎：`git`、`curl`、`docker`、`kubectl`、`npm`、`pip`、`uv` 等工具能力很大，可能写文件、发网络请求、改集群或运行脚本。确实要用时，不建议加入免审批命令列表。
- 不建议：`cmd`、`powershell`、`bash`、`sh`、`python`、`node`、`ruby`、`perl` 等 shell 或通用解释器。把它们加入白名单后，模型可以通过参数间接执行任意代码；这等同于把 native bridge 扩展成高风险本机自动化入口。

平台配置控制“能不能执行某个本机程序”；Settings -> Lab 里的“免审批命令”只控制“是否跳过审批弹窗”。两者不要混淆。即使你把某个命令加入配置，也建议先保持每次审批，确认调用模式稳定后再考虑免审批。

## Windows `.cmd/.bat` 兼容与加固

Windows 上 npm 安装的 CLI 常常是 `.cmd` wrapper，因此 host 仍支持 `.cmd/.bat`。这类 wrapper 必须经过 `cmd.exe /c` 启动，host 会额外拒绝可能破坏命令行边界的参数字符：引号、百分号、感叹号、换行和 NUL。

这意味着：

- 简单参数、中文参数、带 `&` 的 URL 会被整体加引号传入。
- 大段 Markdown、JSON、data URI、复杂 URL 建议通过 `native_bridge.input` 或 CLI 文件参数传递。
- 如果某个 CLI 提供真正的 `.exe` 或固定脚本入口，优先把它放在候选列表前面。

飞书 `docx create/update` 已经支持长内容通过 `native_bridge.input` 自动写入临时 `.md` 文件并追加 `-f <file>`，这是推荐路径。

## 支持的 native_bridge 动作

### `ping`

检查 native host 是否安装并可连接。

```json
{ "action": "ping" }
```

### `which`

检查某个白名单逻辑命令能否解析到真实路径。

```json
{ "action": "which", "command": "feishu" }
```

### `diagnose`

检查当前平台配置是否能正常读取、当前平台候选命令是否存在，以及是否包含 shell、解释器、高能力工具或 `allowCwd` 这类高风险配置。该动作只读配置，不执行本地命令。

```json
{ "action": "diagnose" }
```

### `run`

执行白名单命令。参数必须是字符串数组；可以传入 `input` 作为 stdin 或长文档内容。

```json
{
  "action": "run",
  "command": "feishu",
  "args": ["--help"],
  "timeout_ms": 10000
}
```

`run` 返回 `exitCode`、`stdout`、`stderr`、运行耗时和是否截断。扩展侧会把飞书 CLI 的 `exitCode=2` 视为部分成功、`exitCode=3` 视为成功但有警告，两者都需要继续验证。

## 在 TabCtrl 中使用

1. 安装对应平台的 native host。
2. 确认当前平台配置中的 CLI 候选能在当前用户环境运行。
3. 在 TabCtrl Settings -> Lab 启用 native bridge。
4. 点击“检查桥接”。
5. 点击“检查配置”，确认当前平台候选、解析路径和风险提示。

启用后，模型不会自动绕过审批。只有写入 Settings -> Lab 免审批命令列表的逻辑命令会跳过确认；未配置命令、破坏性调用和高风险配置仍会被审批规则或 native host 拦住。
