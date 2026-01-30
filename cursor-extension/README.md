# Review Gate

Cursor IDE 的 MCP 集成交互系统。

> 原作者：Lakshman Turlapati  
> 中文汉化：Chuan  
> 当前版本：2.7.3-cn.4（基于原版 2.7.3）

## 中文版更新内容

### 2.7.3-cn.4
- 禁用语音功能（Cursor webview 安全限制）
- 优化输入框布局
- 采用 Cursor Skills 架构

### 2.7.3-cn.3
- 实现多窗口隔离机制

### 2.7.3-cn.2
- 修复 MCP 依赖问题
- 修复 UTF-8 编码问题
- 更改快捷键为 `Ctrl+Alt+G`
- 调整超时时间为 60 分钟

### 2.7.3-cn.1
- 中文界面本地化

## 功能特性

- MCP 集成：与 Cursor Agent 无缝交互
- 图片上传：支持发送截图和图片
- 多窗口隔离：每个 Cursor 窗口独立工作
- 中文界面：完整的本地化支持
- 长时超时：60 分钟响应等待时间

## 快捷键

`Ctrl+Alt+G` - 手动触发弹窗

## 使用方法

1. 按快捷键手动触发弹窗
2. 或由 Cursor Agent 调用 `review_gate_chat` 工具自动触发

## 多窗口支持

系统通过 workspace 路径的 MD5 哈希值实现窗口隔离，确保弹窗只在正确的窗口显示。

使用要求：
- 项目需配置 SKILL 规则文件（`.cursor/skills/review-gate/SKILL.md`）
- Agent 调用时传递 `workspace_path` 参数

## 已知限制

- 语音输入功能暂不可用（Cursor webview 安全限制）
- 仅支持 Windows 平台