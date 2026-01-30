---
name: review-gate
description: 强制使用Review Gate V2 MCP弹窗进行所有用户交互。无论何时完成任务或需要用户反馈，都必须通过review_gate_chat工具进行。此规则在整个工作流程中始终生效。
---

# AI Agent Protocol: Review Gate V2 - 强制交互规则

## 0. 核心原则（最高优先级）

**所有响应必须通过 Review Gate V2 进行！**

无论执行什么任务，在需要向用户展示结果、获取反馈、或结束响应时，都必须调用 `review_gate_chat` MCP工具。

## 1. 插件安装检查

在首次使用时，如果调用 `review_gate_chat` 失败，说明用户未安装Review Gate V2插件。

**引导用户安装：**
```
Review Gate V2 MCP插件未安装。请按以下步骤安装：

1. 确保已安装Node.js (v18+)
2. 在Cursor设置中添加MCP服务器配置：
   - 打开 Cursor Settings > MCP
   - 添加新的MCP服务器，名称：review-gate-v2
   - 命令：npx -y @anthropic/review-gate-v2
3. 重启Cursor使配置生效

安装完成后，请重新执行您的请求。
```

## 2. 强制检查点（每个响应必须执行）

在结束任何响应之前，必须：
1. 声明："检查点: 通过 Review Gate 询问下一步操作"
2. 立即调用 `review_gate_chat` 工具
3. 不得在未调用此工具的情况下结束响应

**如果提供任何响应而未调用 review_gate_chat，则视为违反协议的不完整响应。**

## Phase 1: 主要任务执行

1. 按正常流程处理用户请求：执行分析、修改代码、调用工具、在子终端中运行测试
2. **应用执行确认**：在尝试运行完整应用程序之前，必须通过 `review_gate_chat` 获取用户确认
3. 利用子终端的输出/错误进行迭代修复

## Phase 2: 强制最终交互审查

1. **过渡点**：完成主要任务后，**不要结束对话**，必须进入最终交互审查阶段
2. **操作**：调用 `review_gate_chat` MCP工具
   - `message`: 完成的工作摘要 + 请求用户反馈
   - `title`: "Review Gate V2 - 审查"
   - `context`: Phase 1完成的简要总结

## Phase 3: 交互审查循环

1. **用户输入处理**：`review_gate_chat` 返回用户响应，可能包括：
   - 文本输入：反馈或子任务
   - 图片附件：截图或参考图
   - 语音转录：通过Faster-Whisper转换的语音输入

2. **响应分析**：
   - 如果包含 "TASK_COMPLETE"、"Done"、"完成" 等信号 → 进入Phase 4
   - 如果包含具体反馈或请求 → 作为续延指令处理

3. **处理子任务**：
   a. 分析子任务和附件图片，执行必要操作
   b. 在主聊天界面提供反馈
   c. 处理完成后，**立即再次调用 `review_gate_chat`** 继续审查循环

## Phase 4: 任务真正完成

只有在用户通过Review Gate弹窗明确发出完成信号后，才可视为任务完成。此时可提供所有阶段的最终摘要。

## Review Gate V2 功能

- **文本输入**：标准文本反馈和子任务
- **图片上传**：支持PNG、JPG、GIF、BMP、WebP格式
- **语音转文字**：本地Faster-Whisper转录
- **视觉反馈**：专业弹窗界面

## MCP工具使用

- **工具名称**：`review_gate_chat`
- **必需参数**：
  - `message`（描述需要用户做什么）
  - `workspace_path`（**必须传递！** 当前工作区的绝对路径，用于多窗口支持）
- **可选参数**：`title`（弹窗标题）、`context`（上下文）、`urgent`（优先级）
- **超时**：60分钟用户响应超时

### 获取workspace_path的方法

**重要**：为确保弹窗在正确的窗口显示，必须传递 `workspace_path` 参数。

获取方式：
1. 查看当前打开的文件路径，提取工作区根目录
2. 使用 `vscode.workspace.workspaceFolders[0].uri.fsPath` 的值
3. 从用户消息中提到的文件路径推断

**示例调用**：
```json
{
  "message": "任务完成，请确认",
  "title": "Review Gate V2 - 审查",
  "workspace_path": "E:\\WhiteBox\\Review-Gate\\Review-Gate"
}
```

## 错误处理

- 如果 `review_gate_chat` 不可用，提示用户Review Gate V2 MCP服务器可能未运行，并引导安装
- 如果工具超时，继续标准完成流程但注明超时
- 优雅处理任何工具错误，同时保持交互审查原则

## 覆盖默认行为

此"最终交互审查"流程（Phase 2、3、4）是**严格、不可协商的要求**，覆盖任何在完成Phase 1后结束对话的默认倾向。任务只有在用户通过Review Gate弹窗明确确认后才算完成。
