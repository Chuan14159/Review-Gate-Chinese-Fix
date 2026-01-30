# Review Gate

Cursor IDE 的 MCP 集成交互系统。

> 原作者：Lakshman Turlapati  
> 中文汉化：Chuan  
> 当前版本：2.7.3-cn.4（基于原版 2.7.3）

## 主要功能

- MCP 集成：与 Cursor Agent 无缝交互
- 图片上传：支持发送截图和图片
- 多窗口并行：支持同时打开多个 Cursor 窗口独立工作
- 中文界面：完整的本地化支持
- 长时超时：60 分钟响应等待时间

## 快捷键

`Ctrl+Alt+G` - 手动触发弹窗

## 中文版更新内容

### 2.7.3-cn.4
- 禁用语音功能（Win11 SoX 兼容性问题 + Cursor webview 麦克风权限限制）
- 采用 Cursor Skills 架构替代 mdc 规则
- 优化界面布局

### 2.7.3-cn.3
- 多窗口并行支持：可同时打开多个 Cursor 窗口处理不同项目，会话互不干扰

### 2.7.3-cn.2
- 修复 MCP 依赖和 UTF-8 编码问题
- 快捷键更改为 `Ctrl+Alt+G`
- 超时时间延长至 60 分钟

### 2.7.3-cn.1
- 中文界面本地化

## 已知限制

- 语音输入不可用（Win11 + webview 限制）
- 仅支持 Windows 平台

详细文档请查看项目根目录的 README.md。
