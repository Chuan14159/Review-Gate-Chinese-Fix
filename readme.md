[![3OtOp7R.th.png](https://iili.io/3OtOp7R.th.png)](https://freeimage.host/i/3OtOp7R)

# Review Gate

Cursor IDE 的 MCP 集成交互控制系统。

> 原作者：[Lakshman Turlapati](https://github.com/LakshmanTurlapati/Review-Gate)  
> 中文汉化：Chuan  
> 当前版本：2.7.3-cn.4（基于原版 2.7.3）

[![Version](https://img.shields.io/badge/version-2.7.3--cn.4-blue.svg)](https://github.com/LakshmanTurlapati/Review-Gate)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)]()
[![MCP](https://img.shields.io/badge/MCP-Tool-orange.svg)](https://modelcontextprotocol.io/)

![Review Gate 界面](assets/snippet.png)

## 项目简介

Review Gate 解决了 Cursor AI 经常过早结束任务的问题。通过引入交互式检查点，让用户在单次请求的生命周期内完成更复杂的任务，充分利用每次请求的工具调用配额。

## 中文版更新内容

### 2.7.3-cn.4

**语音功能已禁用**
- 原因：Windows 11 系统对 SoX 音频工具的兼容性问题，以及 Cursor webview 的麦克风权限安全限制
- 影响：语音输入按钮已隐藏，用户需通过文字或图片进行交互

**采用 Cursor Skills 架构**
- 替代旧版 mdc 规则文件，使用 `.cursor/skills/review-gate/SKILL.md` 进行配置
- 优势：项目级别规则管理，自动传递工作区路径参数

**界面优化**
- 调整输入框布局，移除不可用的语音相关控件

### 2.7.3-cn.3

**多窗口并行支持**
- 支持同时打开多个 Cursor 窗口，每个窗口独立运行 Review Gate
- 解决了之前多窗口场景下弹窗错位、会话串扰的问题
- 技术实现：基于工作区路径的 MD5 哈希值生成独立的触发和响应文件

**使用场景**
- 可在多个项目之间并行工作，每个窗口的 Agent 会话互不干扰
- 适合同时处理多个独立任务的工作流

### 2.7.3-cn.2

**稳定性修复**
- 修复 MCP 服务器启动时的 Python 依赖问题（pydantic、python-dotenv）
- 修复中文字符在响应文件中的 UTF-8 编码问题
- 修复 Agent 发送的消息无法在聊天窗口正确显示的问题
- 修复 MCP 配置合并时覆盖其他服务器配置的问题

**功能调整**
- 快捷键更改为 `Ctrl+Alt+G`（避免与 Cursor 内置快捷键冲突）
- 响应超时时间从 5 分钟延长至 60 分钟，适合处理复杂任务

### 2.7.3-cn.1

**中文本地化**
- 界面文字全面汉化：按钮、提示、状态指示、错误消息
- 安装脚本输出信息汉化

## 功能特性

| 功能 | 说明 |
|------|------|
| MCP 集成 | 与 Cursor Agent 无缝交互 |
| 图片上传 | 支持截图和多格式图片 |
| 多窗口隔离 | 每个 Cursor 窗口独立工作 |
| 中文界面 | 完整的本地化支持 |
| 长时超时 | 60 分钟响应等待时间 |

## 架构设计

```mermaid
graph TD
    A[用户提出任务] --> B[Cursor Agent 处理]
    B --> C[Review Gate 规则激活]
    C --> D[弹窗界面出现]
    D --> E[用户输入]
    E --> E1[文字命令]
    E --> E2[图片上传]
    E1 --> F[Agent 继续执行]
    E2 --> F
    F --> G{任务完成?}
    G -->|否| D
    G -->|是| H[请求结束]
```

## 安装说明

### 一键安装

```powershell
git clone https://github.com/LakshmanTurlapati/Review-Gate.git
cd Review-Gate
./install.ps1
```

安装脚本自动处理：
- 依赖项安装（Python 包）
- MCP 服务器配置
- Cursor 扩展安装
- 配置文件合并（不覆盖现有配置）

### 手动安装

1. 下载 `cursor-extension/review-gate-v2-2.7.3-cn.4.vsix`
2. 打开 Cursor → 按 `Ctrl+Shift+X`
3. 点击 `...` 菜单 → "从 VSIX 安装..."
4. 选择下载的文件并重启 Cursor

### 配置 Cursor Skills 规则

Review Gate 使用 Cursor Skills 架构进行规则配置。

**设置方法**：
1. 在项目根目录创建 `.cursor/skills/review-gate/SKILL.md`
2. 复制 `.cursor/skills/review-gate/SKILL.md` 的内容

**SKILL 架构优势**：
- 项目级别的规则隔离
- 自动传递 `workspace_path` 参数
- 支持多窗口独立工作

## 使用方法

### 快捷键

`Ctrl+Alt+G` - 手动触发 Review Gate 弹窗

### 基本流程

1. 给 Cursor 分配任务
2. Agent 处理后调用 `review_gate_chat` 工具
3. 弹窗出现，输入后续指令或上传图片
4. Agent 继续执行
5. 重复步骤 3-4 直到任务完成
6. 输入 `TASK_COMPLETE` 结束会话

## 多窗口支持

支持同时打开多个 Cursor 窗口并行处理不同项目，每个窗口的 Review Gate 会话完全独立，不会相互干扰。

**典型使用场景**：
- 窗口 A 处理前端项目，窗口 B 处理后端项目
- 同时进行多个独立任务的开发工作
- 在不同项目间快速切换而不中断 Agent 会话

**技术实现**：
```
窗口1 (E:\ProjectA)              窗口2 (E:\ProjectB)
hash = abc12345                  hash = def67890
    │                                │
    ▼                                ▼
trigger_abc12345.json            trigger_def67890.json
response_abc12345_xxx.json       response_def67890_xxx.json
```

**使用要求**：
- 每个项目需配置 SKILL 规则文件（`.cursor/skills/review-gate/SKILL.md`）
- Agent 调用时需传递 `workspace_path` 参数（SKILL 规则会自动处理）

## 故障排除

```powershell
# 检查 MCP 服务器日志
type %TEMP%\review_gate_v2.log

# 验证 MCP 配置
type %USERPROFILE%\.cursor\mcp.json

# 手动触发弹窗
# 在 Cursor 中按 Ctrl+Alt+G
```

## 已知限制

**语音输入功能不可用**
- Windows 11 系统中 SoX 音频工具存在兼容性问题，无法正确检测默认录音设备
- Cursor 的 webview 组件受 Electron 安全策略限制，无法获取麦克风权限
- 当前版本已禁用语音相关功能，用户需通过文字或图片进行交互

**平台支持**
- 仅支持 Windows 平台，其他平台（macOS、Linux）未经测试

## 致谢

感谢原作者 [Lakshman Turlapati](https://www.audienclature.com) 创建了 Review Gate 项目。
