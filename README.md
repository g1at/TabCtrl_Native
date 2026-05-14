# TabCtrl Native Messaging Bridge

This repository contains the optional native messaging bridge for TabCtrl.

- English documentation: [docs/README.en.md](docs/README.en.md)
- 中文文档: [docs/README.zh-CN.md](docs/README.zh-CN.md)
- Platform configs:
  - Windows: [config/windows/bridge.config.json](config/windows/bridge.config.json)
  - macOS: [config/macos/bridge.config.json](config/macos/bridge.config.json)
  - Linux: [config/linux/bridge.config.json](config/linux/bridge.config.json)

The host automatically loads the config for the current platform. For backward
compatibility, an old root-level `bridge.config.json` is still accepted if the
new platform config does not exist.
