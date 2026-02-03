# Review Gate - 安装指南

## 概述

Review Gate 是一个 MCP（Model Context Protocol）服务器，用于在 Cursor 中显示交互式弹窗对话框。

## 系统要求

- Windows 10/11
- Cursor IDE（最新版本）
- Python 3.8 或更高版本
- pip（Python 包管理器）

## 快速安装（自动化）

### PowerShell

```powershell
# 克隆仓库
git clone https://github.com/Chuan14159/Review-Gate-Chinese-Fix.git
cd Review-Gate-Chinese-Fix

# 允许脚本执行
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 运行安装程序
.\install.ps1
```

### 命令提示符

```cmd
git clone https://github.com/Chuan14159/Review-Gate-Chinese-Fix.git
cd Review-Gate-Chinese-Fix
install.bat
```

## 手动安装

如果自动安装失败，请按照以下步骤操作：

### 步骤 1：创建安装目录

```cmd
mkdir %USERPROFILE%\cursor-extensions\review-gate-v2
cd %USERPROFILE%\cursor-extensions\review-gate-v2
```

### 步骤 2：复制所需文件

将以下文件从 Review-Gate 目录复制到安装目录：
- `review_gate_v2_mcp.py` - MCP 服务器
- `requirements_simple.txt` - Python 依赖

### 步骤 3：设置 Python 环境

```cmd
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
venv\Scripts\activate

# 安装依赖
pip install -r requirements_simple.txt
```

### 步骤 4：配置 MCP 服务器

编辑 `%USERPROFILE%\.cursor\mcp.json`：

```json
{
  "mcpServers": {
    "review-gate-v2": {
      "command": "C:\\Users\\YOUR_USERNAME\\cursor-extensions\\review-gate-v2\\venv\\Scripts\\python.exe",
      "args": ["C:\\Users\\YOUR_USERNAME\\cursor-extensions\\review-gate-v2\\review_gate_v2_mcp.py"],
      "env": {
        "PYTHONPATH": "C:\\Users\\YOUR_USERNAME\\cursor-extensions\\review-gate-v2",
        "PYTHONUNBUFFERED": "1",
        "REVIEW_GATE_MODE": "cursor_integration"
      }
    }
  }
}
```

### 步骤 5：安装 Cursor 扩展

1. 打开 Cursor IDE
2. 按 `Ctrl+Shift+P`
3. 输入 "Extensions: Install from VSIX"
4. 选择 `cursor-extension/review-gate-v2-2.7.3-cn.4.vsix`
5. 重启 Cursor

### 步骤 6：配置 Cursor Skills 规则

在项目根目录创建 `.cursor/skills/review-gate/SKILL.md`，内容参考本仓库中的示例文件。

## 验证安装

### 测试 1：扩展检查

1. 打开 Cursor
2. 打开扩展面板（Ctrl+Shift+X）
3. 确认 "Review Gate" 已安装并启用

### 测试 2：手动弹窗

1. 按 `Ctrl+Alt+G`
2. Review Gate 弹窗应该出现

### 测试 3：MCP 集成

1. 在 Cursor 中开始新对话
2. 输入："使用 review_gate_chat 工具获取我的反馈"
3. 弹窗应该自动出现

## 故障排除

### MCP 服务器未启动

检查日志文件：
```cmd
type %TEMP%\review_gate_v2.log
```

### 扩展不工作

1. 检查扩展是否启用
2. 按 F12 打开开发者工具查看错误
3. 完全重启 Cursor

### 弹窗不出现

验证 MCP 配置：
```cmd
type %USERPROFILE%\.cursor\mcp.json
```

检查触发文件：
```cmd
dir %TEMP%\review_gate_*
```

## 文件位置

安装后，文件位于以下位置：

```
%USERPROFILE%\cursor-extensions\review-gate-v2\
  - review_gate_v2_mcp.py
  - requirements_simple.txt
  - venv\

%USERPROFILE%\.cursor\
  - mcp.json

临时文件：%TEMP%\review_gate_*
日志文件：%TEMP%\review_gate_v2.log
```

## 卸载

### 自动卸载

```cmd
cd Review-Gate
uninstall.bat
```

### 手动卸载

1. 从 Cursor 卸载扩展
2. 删除安装目录：`rmdir /s %USERPROFILE%\cursor-extensions\review-gate-v2`
3. 编辑 mcp.json 删除 "review-gate-v2" 条目
4. 清理临时文件：`del %TEMP%\review_gate_*`

## 功能

安装后，Review Gate 提供：

- 文本输入捕获
- 图片上传功能
- 60 分钟超时
- MCP 状态监控
- 手动触发快捷键（Ctrl+Alt+G）
- 多窗口隔离支持
