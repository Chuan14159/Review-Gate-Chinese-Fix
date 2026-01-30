const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Cross-platform temp directory helper
function getTempPath(filename) {
    // Use /tmp/ for macOS and Linux, system temp for Windows
    if (process.platform === 'win32') {
        return path.join(os.tmpdir(), filename);
    } else {
        return path.join('/tmp', filename);
    }
}

let chatPanel = null;
let reviewGateWatcher = null;
let outputChannel = null;
let mcpStatus = false;
let statusCheckInterval = null;
let currentTriggerData = null;
let currentRecording = null;
let currentMcpIntegration = false;  // Track current MCP integration state globally
let workspaceHash = null;  // Unique hash for this workspace
let workspacePath = null;  // Current workspace path

// Calculate workspace hash for multi-window isolation
function calculateWorkspaceHash(wsPath) {
    if (!wsPath) return null;
    // Normalize path for consistent hashing across platforms
    const normalizedPath = wsPath.replace(/\\/g, '/').toLowerCase();
    return crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);
}

// Create workspace registration file
function createWorkspaceRegistration() {
    if (!workspaceHash || !workspacePath) return;
    
    const registrationFile = getTempPath(`review_gate_ws_${workspaceHash}.json`);
    const registrationData = {
        workspace: workspacePath,
        hash: workspaceHash,
        pid: process.pid,
        timestamp: new Date().toISOString(),
        active: true
    };
    
    try {
        fs.writeFileSync(registrationFile, JSON.stringify(registrationData, null, 2), { encoding: 'utf8' });
        console.log(`📂 Workspace registered: ${workspacePath} (hash: ${workspaceHash})`);
    } catch (error) {
        console.log(`⚠️ Could not create workspace registration: ${error.message}`);
    }
}

// Remove workspace registration file
function removeWorkspaceRegistration() {
    if (!workspaceHash) return;
    
    const registrationFile = getTempPath(`review_gate_ws_${workspaceHash}.json`);
    try {
        if (fs.existsSync(registrationFile)) {
            fs.unlinkSync(registrationFile);
            console.log(`🧹 Workspace registration removed: ${workspaceHash}`);
        }
    } catch (error) {
        console.log(`⚠️ Could not remove workspace registration: ${error.message}`);
    }
}

function activate(context) {
    console.log('Review Gate V2 extension is now active in Cursor for MCP integration!');
    
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Review Gate V2 ゲート');
    context.subscriptions.push(outputChannel);
    
    // Initialize workspace information for multi-window isolation
    workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
    workspaceHash = calculateWorkspaceHash(workspacePath);
    
    console.log(`📂 Workspace Path: ${workspacePath}`);
    console.log(`🔑 Workspace Hash: ${workspaceHash}`);
    
    // Create workspace registration file
    createWorkspaceRegistration();
    
    // Silent activation - only log to console, not output channel
    console.log('Review Gate V2 extension activated for Cursor MCP integration by Lakshman Turlapati');

    // Register command to open Review Gate manually
    let disposable = vscode.commands.registerCommand('reviewGate.openChat', () => {
        openReviewGatePopup(context, {
            message: "Welcome to Review Gate V2! Please provide your review or feedback.",
            title: "Review Gate"
        });
    });

    context.subscriptions.push(disposable);

    // Start MCP status monitoring immediately
    startMcpStatusMonitoring(context);

    // Start Review Gate integration immediately
    startReviewGateIntegration(context);
    
    // Show activation notification with workspace info
    const hashInfo = workspaceHash ? ` [${workspaceHash}]` : '';
    vscode.window.showInformationMessage(`Review Gate V2 已激活${hashInfo}！使用 Ctrl+Alt+G 打开或等待MCP工具调用。`);
}

function logMessage(message) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    if (outputChannel) {
        outputChannel.appendLine(logMsg);
        // Don't auto-show output channel to avoid stealing focus
    }
}

function logUserInput(inputText, eventType = 'MESSAGE', triggerId = null, attachments = []) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${eventType}: ${inputText}`;
    console.log(`REVIEW GATE USER INPUT: ${inputText}`);
    
    if (outputChannel) {
        outputChannel.appendLine(logMsg);
    }
    
    // Write to file for external monitoring
    try {
        const logFile = getTempPath('review_gate_user_inputs.log');
        fs.appendFileSync(logFile, `${logMsg}\n`, { encoding: 'utf8' });
        
        // Write response file for MCP server integration if we have a trigger ID
        if (triggerId && eventType === 'MCP_RESPONSE') {
            // Get workspace hash from current trigger data or global
            const responseHash = currentTriggerData?._workspaceHash || workspaceHash;
            
            // Build response file patterns with workspace hash
            const responsePatterns = [];
            
            // Primary: workspace-specific response file
            if (responseHash) {
                responsePatterns.push(getTempPath(`review_gate_response_${responseHash}_${triggerId}.json`));
            }
            
            // Fallback patterns for compatibility
            responsePatterns.push(getTempPath(`review_gate_response_${triggerId}.json`));
            responsePatterns.push(getTempPath('review_gate_response.json'));
            responsePatterns.push(getTempPath(`mcp_response_${triggerId}.json`));
            responsePatterns.push(getTempPath('mcp_response.json'));
            
            const responseData = {
                timestamp: timestamp,
                trigger_id: triggerId,
                workspace_hash: responseHash,  // Include hash for MCP server to match
                workspace_path: workspacePath,  // Include path for reference
                user_input: inputText,
                response: inputText,  // Also provide as 'response' field
                message: inputText,   // Also provide as 'message' field
                attachments: attachments,  // Include image attachments
                event_type: eventType,
                source: 'review_gate_extension'
            };
            
            const responseJson = JSON.stringify(responseData, null, 2);
            
            // Write to all response file patterns with UTF-8 encoding for proper Chinese/Unicode support
            responsePatterns.forEach(responseFile => {
                try {
                    fs.writeFileSync(responseFile, responseJson, { encoding: 'utf8' });
                    logMessage(`MCP response written: ${responseFile}`);
                } catch (writeError) {
                    logMessage(`Failed to write response file ${responseFile}: ${writeError.message}`);
                }
            });
            
            console.log(`📤 Response files written with hash: ${responseHash}`);
        }
        
    } catch (error) {
        logMessage(`Could not write to Review Gate log file: ${error.message}`);
    }
}

function startMcpStatusMonitoring(context) {
    // Silent start - no logging to avoid focus stealing
    
    // Check MCP status every 2 seconds
    statusCheckInterval = setInterval(() => {
        checkMcpStatus();
    }, 2000);
    
    // Initial check
    checkMcpStatus();
    
    // Clean up on extension deactivation
    context.subscriptions.push({
        dispose: () => {
            if (statusCheckInterval) {
                clearInterval(statusCheckInterval);
            }
        }
    });
}

function checkMcpStatus() {
    try {
        // Check if MCP server log exists and is recent
        const mcpLogPath = getTempPath('review_gate_v2.log');
        if (fs.existsSync(mcpLogPath)) {
            const stats = fs.statSync(mcpLogPath);
            const now = Date.now();
            const fileAge = now - stats.mtime.getTime();
            
            // Consider MCP active if log file was modified within last 30 seconds
            const wasActive = mcpStatus;
            mcpStatus = fileAge < 30000;
            
            if (wasActive !== mcpStatus) {
                // Silent status change - only update UI
                updateChatPanelStatus();
            }
        } else {
            if (mcpStatus) {
                mcpStatus = false;
                updateChatPanelStatus();
            }
        }
    } catch (error) {
        if (mcpStatus) {
            mcpStatus = false;
            updateChatPanelStatus();
        }
    }
}

function updateChatPanelStatus() {
    if (chatPanel) {
        chatPanel.webview.postMessage({
            command: 'updateMcpStatus',
            active: mcpStatus
        });
    }
}

function startReviewGateIntegration(context) {
    // Silent integration start
    
    // Trigger file paths to monitor
    // 1. Workspace-specific trigger file (only if we have a workspace hash)
    // 2. Generic trigger file (fallback for calls without workspace_path)
    const triggerFiles = [];
    
    if (workspaceHash) {
        // Primary: workspace-specific trigger file
        triggerFiles.push({
            path: getTempPath(`review_gate_trigger_${workspaceHash}.json`),
            type: 'workspace',
            hash: workspaceHash
        });
    }
    
    // Fallback: generic trigger file (for backward compatibility)
    triggerFiles.push({
        path: getTempPath('review_gate_trigger.json'),
        type: 'generic',
        hash: null
    });
    
    console.log(`🔍 Monitoring trigger files:`);
    triggerFiles.forEach(f => console.log(`   - ${f.path} (${f.type})`));
    
    // Check for existing trigger files first
    triggerFiles.forEach(f => checkTriggerFile(context, f.path, f.hash));
    
    // Use a more robust polling approach instead of fs.watchFile
    // fs.watchFile can miss rapid file creation/deletion cycles
    const pollInterval = setInterval(() => {
        // Check all monitored trigger files
        triggerFiles.forEach(f => checkTriggerFile(context, f.path, f.hash));
    }, 250); // Check every 250ms for better performance
    
    // Store the interval for cleanup
    reviewGateWatcher = pollInterval;
    
    // Add to context subscriptions for proper cleanup
    context.subscriptions.push({
        dispose: () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        }
    });
    
    // Immediate check on startup
    setTimeout(() => {
        triggerFiles.forEach(f => checkTriggerFile(context, f.path, f.hash));
    }, 100);
    
    // Show notification that we're ready
    const hashInfo = workspaceHash ? ` [${workspaceHash}]` : '';
    vscode.window.showInformationMessage(`Review Gate V2 MCP集成已就绪${hashInfo}！正在监听Cursor Agent工具调用...`);
}

function checkTriggerFile(context, filePath, expectedHash = null) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const triggerData = JSON.parse(data);
            
            // Check if this is for Cursor and Review Gate
            if (triggerData.editor && triggerData.editor !== 'cursor') {
                return;
            }
            
            if (triggerData.system && triggerData.system !== 'review-gate-v2') {
                return;
            }
            
            // For workspace-specific trigger files, we already know it's for us
            // For generic trigger files, use lock mechanism
            const triggerId = triggerData.data?.trigger_id || triggerData.timestamp;
            const triggerWorkspaceHash = triggerData.workspace_hash || null;
            
            // If this is a workspace-specific file (expectedHash is set), process directly
            if (expectedHash) {
                console.log(`🎯 Workspace-specific trigger detected: ${expectedHash}`);
                processTrigger(context, filePath, triggerData, triggerId, triggerWorkspaceHash);
                return;
            }
            
            // For generic trigger file, use lock mechanism
            const lockFilePath = path.join(os.tmpdir(), `review_gate_lock_${triggerId}.json`);
            
            // Multi-window support: Focus-based + Lock mechanism
            const isWindowFocused = vscode.window.state.focused;
            
            if (!isWindowFocused) {
                // Window not focused - wait briefly to let focused window handle it
                if (fs.existsSync(lockFilePath)) {
                    console.log(`Another window already handling trigger: ${triggerId}`);
                    return;
                }
                
                // Small delay for non-focused windows to give focused window priority
                setTimeout(() => {
                    checkTriggerFileWithLock(context, filePath, triggerData, triggerId, lockFilePath, triggerWorkspaceHash);
                }, 100);
                return;
            }
            
            // Focused window - try to acquire lock immediately
            checkTriggerFileWithLock(context, filePath, triggerData, triggerId, lockFilePath, triggerWorkspaceHash);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') { // Don't log file not found errors
            console.log(`Error reading trigger file: ${error.message}`);
        }
    }
}

function checkTriggerFileWithLock(context, filePath, triggerData, triggerId, lockFilePath, triggerWorkspaceHash) {
    try {
        // Check if trigger file still exists (another window may have processed it)
        if (!fs.existsSync(filePath)) {
            console.log(`Trigger file already processed by another window`);
            return;
        }
        
        // Check if lock already exists
        if (fs.existsSync(lockFilePath)) {
            console.log(`Lock already acquired for trigger: ${triggerId}`);
            return;
        }
        
        // Multi-window support: Check workspace_path matching for generic trigger files
        const triggerWorkspacePath = triggerData.workspace_path || triggerData.data?.workspace_path;
        if (triggerWorkspacePath && workspacePath) {
            // Normalize paths for comparison
            const normalizedTriggerPath = triggerWorkspacePath.replace(/\\/g, '/').toLowerCase();
            const normalizedCurrentPath = workspacePath.replace(/\\/g, '/').toLowerCase();
            
            if (normalizedTriggerPath !== normalizedCurrentPath) {
                // This window's workspace doesn't match - skip
                console.log(`Workspace mismatch - trigger: ${triggerWorkspacePath}, current: ${workspacePath}`);
                return;
            }
            console.log(`Workspace matched: ${workspacePath}`);
        }
        // If no workspace_path in trigger, use lock mechanism (first-responder)
        
        // Try to acquire lock (atomic operation)
        const lockData = {
            acquired_by: workspacePath || 'unknown',
            workspace_hash: workspaceHash,
            timestamp: new Date().toISOString(),
            trigger_id: triggerId
        };
        
        try {
            // Use exclusive flag to ensure atomic lock acquisition
            fs.writeFileSync(lockFilePath, JSON.stringify(lockData), { flag: 'wx' });
            console.log(`Lock acquired for trigger: ${triggerId}`);
        } catch (lockError) {
            if (lockError.code === 'EEXIST') {
                // Another window acquired the lock first
                console.log(`Lock race lost for trigger: ${triggerId}`);
                return;
            }
            throw lockError;
        }
        
        // Successfully acquired lock - process the trigger
        processTrigger(context, filePath, triggerData, triggerId, triggerWorkspaceHash);
        
        // Clean up lock file after a delay (let other windows see it briefly)
        setTimeout(() => {
            try {
                fs.unlinkSync(lockFilePath);
            } catch (e) { /* ignore */ }
        }, 2000);
        
    } catch (error) {
        console.log(`Error processing trigger with lock: ${error.message}`);
    }
}

// Process trigger after lock acquired or for workspace-specific trigger
function processTrigger(context, filePath, triggerData, triggerId, triggerWorkspaceHash) {
    console.log(`✅ Processing trigger: ${triggerData.data?.tool || 'unknown'} (hash: ${triggerWorkspaceHash || 'generic'})`);
    
    // Store current trigger data for response handling
    currentTriggerData = triggerData.data;
    currentTriggerData._workspaceHash = triggerWorkspaceHash || workspaceHash;  // Store hash for response file naming
    
    handleReviewGateToolCall(context, triggerData.data);
    
    // Clean up trigger file immediately
    try {
        fs.unlinkSync(filePath);
        console.log(`🧹 Trigger file cleaned up: ${filePath}`);
    } catch (cleanupError) {
        console.log(`Could not clean trigger file: ${cleanupError.message}`);
    }
}

function handleReviewGateToolCall(context, toolData) {
    // Silent tool call processing
    
    let popupOptions = {};
    
    switch (toolData.tool) {
        case 'review_gate':
            // UNIFIED: New unified tool that handles all modes
            const mode = toolData.mode || 'chat';
            let modeTitle = `Review Gate V2 - ${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`;
            if (toolData.unified_tool) {
                modeTitle = `Review Gate V2 ゲート - Unified (${mode})`;
            }
            
            popupOptions = {
                message: toolData.message || "Please provide your input:",
                title: toolData.title || modeTitle,
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true,
                specialHandling: `unified_${mode}`
            };
            break;
            
        case 'review_gate_chat':
            popupOptions = {
                message: toolData.message || "Please provide your review or feedback:",
                title: toolData.title || "Review Gate V2 - ゲート",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true
            };
            break;
            
        case 'quick_review':
            popupOptions = {
                message: toolData.prompt || "Quick feedback needed:",
                title: toolData.title || "Review Gate V2 ゲート - Quick Review",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true,
                specialHandling: 'quick_review'
            };
            break;
            
        case 'ingest_text':
            popupOptions = {
                message: `Cursor Agent received text input and needs your feedback:\n\n**Text Content:** ${toolData.text_content}\n**Source:** ${toolData.source}\n**Context:** ${toolData.context || 'None'}\n**Processing Mode:** ${toolData.processing_mode}\n\nPlease review and provide your feedback:`,
                title: toolData.title || "Review Gate V2 ゲート - Text Input",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true
            };
            break;
            
        case 'shutdown_mcp':
            popupOptions = {
                message: `Cursor Agent is requesting to shutdown the MCP server:\n\n**Reason:** ${toolData.reason}\n**Immediate:** ${toolData.immediate ? 'Yes' : 'No'}\n**Cleanup:** ${toolData.cleanup ? 'Yes' : 'No'}\n\nType 'CONFIRM' to proceed with shutdown, or provide alternative instructions:`,
                title: toolData.title || "Review Gate V2 ゲート - Shutdown Confirmation",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true,
                specialHandling: 'shutdown_mcp'
            };
            break;
            
        case 'file_review':
            popupOptions = {
                message: toolData.instruction || "Cursor Agent needs you to select files:",
                title: toolData.title || "Review Gate V2 ゲート - File Review",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true
            };
            break;
            
        default:
            popupOptions = {
                message: toolData.message || toolData.prompt || toolData.instruction || "Cursor Agent needs your input. Please provide your response:",
                title: toolData.title || "Review Gate V2 ゲート - General Input",
                autoFocus: true,
                toolData: toolData,
                mcpIntegration: true
            };
    }
    
    // Add trigger ID to popup options
    popupOptions.triggerId = toolData.trigger_id;
    console.log(`🔍 DEBUG: Setting popup triggerId to: ${toolData.trigger_id}`);
    
    // Force consistent title regardless of tool call
    popupOptions.title = "Review Gate";
    
    // Immediately open Review Gate popup when tools are triggered by Cursor Agent
    openReviewGatePopup(context, popupOptions);
    
    // FIXED: Send acknowledgement to MCP server that popup was activated
    sendExtensionAcknowledgement(toolData.trigger_id, toolData.tool);
    
    // Show appropriate notification
    const toolDisplayName = toolData.tool.replace('_', ' ').toUpperCase();
    vscode.window.showInformationMessage(`Cursor Agent 触发了 "${toolDisplayName}" - Review Gate 弹窗已打开，等待您的输入！`);
}

function sendExtensionAcknowledgement(triggerId, toolType) {
    try {
        const timestamp = new Date().toISOString();
        const ackData = {
            acknowledged: true,
            timestamp: timestamp,
            trigger_id: triggerId,
            tool_type: toolType,
            extension: 'review-gate-v2',
            popup_activated: true
        };
        
        const ackFile = getTempPath(`review_gate_ack_${triggerId}.json`);
        fs.writeFileSync(ackFile, JSON.stringify(ackData, null, 2), { encoding: 'utf8' });
        
        // Silent acknowledgement 
        
    } catch (error) {
        console.log(`Could not send extension acknowledgement: ${error.message}`);
    }
}

function openReviewGatePopup(context, options = {}) {
    const {
        message = "Welcome to Review Gate V2! Please provide your review or feedback.",
        title = "Review Gate",
        autoFocus = false,
        toolData = null,
        mcpIntegration = false,
        triggerId = null,
        specialHandling = null
    } = options;
    
    // Store trigger ID and MCP state in global variables for use in message handlers
    console.log(`🔍 DEBUG: openReviewGatePopup triggerId: ${triggerId}, mcpIntegration: ${mcpIntegration}`);
    console.log(`🔍 DEBUG: openReviewGatePopup toolData:`, toolData);
    
    // Update global MCP integration state
    currentMcpIntegration = mcpIntegration;
    
    if (triggerId) {
        currentTriggerData = { ...toolData, trigger_id: triggerId };
        console.log(`🔍 DEBUG: Set currentTriggerData:`, currentTriggerData);
    } else {
        console.log(`🔍 DEBUG: No triggerId provided, currentTriggerData not updated`);
    }

    // Silent popup opening

    if (chatPanel) {
        chatPanel.reveal(vscode.ViewColumn.One);
        // Always use consistent title
        chatPanel.title = "Review Gate";
        
        // Set MCP status to active when revealing panel for new input
        if (mcpIntegration) {
            setTimeout(() => {
                chatPanel.webview.postMessage({
                    command: 'updateMcpStatus',
                    active: true
                });
            }, 100);
        }
        
        // Send new message to existing panel (for MCP messages)
        if (message && mcpIntegration) {
            setTimeout(() => {
                chatPanel.webview.postMessage({
                    command: 'addMessage',
                    text: message,
                    type: 'system',
                    plain: false,
                    toolData: toolData,
                    mcpIntegration: mcpIntegration,
                    triggerId: triggerId
                });
            }, 150);
        }
        
        // Auto-focus if requested
        if (autoFocus) {
            setTimeout(() => {
                chatPanel.webview.postMessage({
                    command: 'focus'
                });
            }, 200);
        }
        
        return;
    }

    // Create webview panel
    chatPanel = vscode.window.createWebviewPanel(
        'reviewGateChat',
        title,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Set the HTML content
    chatPanel.webview.html = getReviewGateHTML(title, mcpIntegration);

    // Handle messages from webview
    chatPanel.webview.onDidReceiveMessage(
        webviewMessage => {
            // Get trigger ID from current trigger data or passed options
            const currentTriggerId = (currentTriggerData && currentTriggerData.trigger_id) || triggerId;
            console.log(`🔍 DEBUG: Speech command - currentTriggerData:`, currentTriggerData);
            console.log(`🔍 DEBUG: Speech command - triggerId:`, triggerId);
            console.log(`🔍 DEBUG: Speech command - currentTriggerId:`, currentTriggerId);
            
            switch (webviewMessage.command) {
                case 'send':
                    
                    // Log the user input and write response file for MCP integration
                    // Use global currentMcpIntegration instead of closure value
                    const eventType = currentMcpIntegration ? 'MCP_RESPONSE' : 'REVIEW_SUBMITTED';
                    console.log(`🔍 DEBUG: send command - currentMcpIntegration: ${currentMcpIntegration}, eventType: ${eventType}`);
                    logUserInput(webviewMessage.text, eventType, currentTriggerId, webviewMessage.attachments || []);
                    
                    handleReviewMessage(webviewMessage.text, webviewMessage.attachments, currentTriggerId, currentMcpIntegration, specialHandling);
                    break;
                case 'attach':
                    logUserInput('User clicked attachment button', 'ATTACHMENT_CLICK', currentTriggerId);
                    handleFileAttachment(currentTriggerId);
                    break;
                case 'uploadImage':
                    logUserInput('User clicked image upload button', 'IMAGE_UPLOAD_CLICK', currentTriggerId);
                    handleImageUpload(currentTriggerId);
                    break;
                case 'logPastedImage':
                    logUserInput(`Image pasted from clipboard: ${webviewMessage.fileName} (${webviewMessage.size} bytes, ${webviewMessage.mimeType})`, 'IMAGE_PASTED', currentTriggerId);
                    break;
                case 'logDragDropImage':
                    logUserInput(`Image dropped from drag and drop: ${webviewMessage.fileName} (${webviewMessage.size} bytes, ${webviewMessage.mimeType})`, 'IMAGE_DROPPED', currentTriggerId);
                    break;
                case 'logImageRemoved':
                    logUserInput(`Image removed: ${webviewMessage.imageId}`, 'IMAGE_REMOVED', currentTriggerId);
                    break;
                case 'startRecording':
                    logUserInput('User started speech recording (legacy)', 'SPEECH_START', currentTriggerId);
                    startNodeRecording(currentTriggerId);
                    break;
                case 'stopRecording':
                    logUserInput('User stopped speech recording (legacy)', 'SPEECH_STOP', currentTriggerId);
                    stopNodeRecording(currentTriggerId);
                    break;
                case 'processAudio':
                    // New Web Audio API path - receive base64 audio from webview
                    logUserInput('Processing Web Audio recording', 'SPEECH_WEBAUDIO', currentTriggerId);
                    handleWebAudioRecording(webviewMessage.audioData, webviewMessage.mimeType, currentTriggerId);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(webviewMessage.message);
                    break;
                case 'ready':
                    // Send initial MCP status
                    // For MCP integrations, show as active when waiting for input
                    chatPanel.webview.postMessage({
                        command: 'updateMcpStatus',
                        active: mcpIntegration ? true : mcpStatus
                    });
                    // Display message in chat window (including MCP messages)
                    if (message && !message.includes("I have completed")) {
                        chatPanel.webview.postMessage({
                            command: 'addMessage',
                            text: message,
                            type: 'system',
                            plain: false,  // Use bubble style for better visibility
                            toolData: toolData,
                            mcpIntegration: mcpIntegration,
                            triggerId: triggerId,
                            specialHandling: specialHandling
                        });
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    // Clean up when panel is closed
    chatPanel.onDidDispose(
        () => {
            chatPanel = null;
            currentTriggerData = null;
        },
        null,
        context.subscriptions
    );

    // Auto-focus if requested
    if (autoFocus) {
        setTimeout(() => {
            chatPanel.webview.postMessage({
                command: 'focus'
            });
        }, 200);
    }
}

function getReviewGateHTML(title = "Review Gate", mcpIntegration = false) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .review-container {
            height: 100vh;
            display: flex;
            flex-direction: column;
            max-width: 600px;
            margin: 0 auto;
            width: 100%;
            animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .review-header {
            flex-shrink: 0;
            padding: 16px 20px 12px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--vscode-editor-background);
        }
        
        .review-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-charts-orange);
            animation: pulse 2s infinite;
            transition: background-color 0.3s ease;
            margin-right: 4px;
        }
        
        .status-indicator.active {
            background: var(--vscode-charts-green);
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .message {
            display: flex;
            gap: 8px;
            animation: messageSlide 0.3s ease-out;
        }
        
        @keyframes messageSlide {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message-bubble {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
            white-space: pre-wrap;
        }
        
        .message.system .message-bubble {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-bottom-left-radius: 6px;
        }
        
        .message.user .message-bubble {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 6px;
        }
        
        .message.system.plain {
            justify-content: center;
            margin: 8px 0;
        }
        
        .message.system.plain .message-content {
            background: none;
            padding: 8px 16px;
            border-radius: 0;
            font-size: 13px;
            opacity: 0.8;
            font-style: italic;
            text-align: center;
            border: none;
            color: var(--vscode-foreground);
        }
        
        /* Speech error message styling */
        .message.system.plain .message-content[data-speech-error] {
            background: rgba(255, 107, 53, 0.1);
            border: 1px solid rgba(255, 107, 53, 0.3);
            color: var(--vscode-errorForeground);
            font-weight: 500;
            opacity: 1;
            padding: 12px 16px;
            border-radius: 8px;
        }
        
        .message-time {
            font-size: 11px;
            opacity: 0.6;
            margin-top: 4px;
        }
        
        .input-container {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 16px 20px 20px 20px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
        }
        
        .input-container.disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        
        .input-wrapper {
            flex: 1;
            display: flex;
            align-items: center;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 20px;
            padding: 8px 12px;
            transition: all 0.2s ease;
            position: relative;
        }
        
        /* 语音功能已禁用 - Cursor webview不支持麦克风权限 */
        .mic-icon {
            display: none !important;
        }
        
        @keyframes spin {
            0% { transform: translateY(-50%) rotate(0deg); }
            100% { transform: translateY(-50%) rotate(360deg); }
        }
        
        .input-wrapper:focus-within {
            border-color: transparent;
            box-shadow: 0 0 0 2px rgba(255, 165, 0, 0.4), 0 0 8px rgba(255, 165, 0, 0.2);
        }
        
        .message-input {
            flex: 1;
            background: transparent;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            color: var(--vscode-input-foreground);
            resize: none;
            min-height: 20px;
            max-height: 120px;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.4;
            padding-left: 12px; /* 语音功能已禁用 */
        }
        
        .message-input:focus {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }
        
        .message-input:focus-visible {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }
        
        .message-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .message-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .message-input.paste-highlight {
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.4) !important;
            transition: box-shadow 0.2s ease;
        }
        
        .attach-button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 14px;
            padding: 4px;
            border-radius: 50%;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        
        .attach-button:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.1);
        }
        
        .attach-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .send-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            font-size: 14px;
        }
        
        .send-button:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.05);
        }
        
        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .typing-indicator {
            display: none;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            font-size: 12px;
            opacity: 0.7;
        }
        
        .typing-dots {
            display: flex;
            gap: 2px;
        }
        
        .typing-dot {
            width: 4px;
            height: 4px;
            background: var(--vscode-foreground);
            border-radius: 50%;
            animation: typingDot 1.4s infinite ease-in-out;
        }
        
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes typingDot {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
        
        .mcp-status {
            font-size: 11px;
            opacity: 0.6;
            margin-left: 4px;
        }
        
        /* Drag and drop styling */
        body.drag-over {
            background: rgba(0, 123, 255, 0.05);
        }
        
        body.drag-over::before {
            content: 'Drop images here to attach them';
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 16px 24px 16px 48px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            font-family: var(--vscode-font-family);
        }
        
        body.drag-over::after {
            content: '\\f093';
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) translate(-120px, 0);
            color: var(--vscode-badge-foreground);
            font-size: 16px;
            z-index: 1001;
            pointer-events: none;
            font-family: 'Font Awesome 6 Free';
            font-weight: 900;
        }
        
        /* Image preview styling */
        .image-preview {
            position: relative;
        }
        
        .image-container {
            position: relative;
        }
        
        .image-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .image-filename {
            font-size: 12px;
            font-weight: 500;
            opacity: 0.9;
            flex: 1;
            margin-right: 8px;
            word-break: break-all;
        }
        
        .remove-image-btn {
            background: rgba(255, 59, 48, 0.1);
            border: 1px solid rgba(255, 59, 48, 0.3);
            color: #ff3b30;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }
        
        .remove-image-btn:hover {
            background: rgba(255, 59, 48, 0.2);
            border-color: rgba(255, 59, 48, 0.5);
            transform: scale(1.1);
        }
        
        .remove-image-btn:active {
            transform: scale(0.95);
        }
    </style>
</head>
<body>
    <div class="review-container">
        <div class="review-header">
            <div class="review-title">${title}</div>
            <div class="status-indicator" id="statusIndicator"></div>
            <div class="mcp-status" id="mcpStatus">检查MCP状态...</div>
        </div>
        
        <div class="messages-container" id="messages">
            <!-- Messages will be added here -->
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            <span>处理中</span>
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
        
        <div class="input-container" id="inputContainer">
            <div class="input-wrapper">
                <i id="micIcon" class="fas fa-microphone mic-icon active" title="点击说话"></i>
                <textarea id="messageInput" class="message-input" placeholder="${mcpIntegration ? 'Cursor Agent 正在等待您的回复...' : '输入您的反馈...'}" rows="1"></textarea>
                <button id="attachButton" class="attach-button" title="上传图片">
                    <i class="fas fa-image"></i>
                </button>
            </div>
            <button id="sendButton" class="send-button" title="${mcpIntegration ? '发送至Agent' : '发送'}">
                <i class="fas fa-arrow-up"></i>
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const messagesContainer = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const attachButton = document.getElementById('attachButton');
        const micIcon = document.getElementById('micIcon');
        const typingIndicator = document.getElementById('typingIndicator');
        const statusIndicator = document.getElementById('statusIndicator');
        const mcpStatus = document.getElementById('mcpStatus');
        const inputContainer = document.getElementById('inputContainer');
        
        let messageCount = 0;
        let mcpActive = true; // Default to true for better UX
        let mcpIntegration = ${mcpIntegration};
        let attachedImages = []; // Store uploaded images
        let isRecording = false;
        let mediaRecorder = null;
        
        function updateMcpStatus(active) {
            mcpActive = active;
            
            if (active) {
                statusIndicator.classList.add('active');
                mcpStatus.textContent = 'MCP 已激活';
                inputContainer.classList.remove('disabled');
                messageInput.disabled = false;
                sendButton.disabled = false;
                attachButton.disabled = false;
                messageInput.placeholder = mcpIntegration ? 'Cursor Agent 正在等待您的回复...' : '输入您的反馈...';
            } else {
                statusIndicator.classList.remove('active');
                mcpStatus.textContent = '等待会话';
                inputContainer.classList.add('disabled');
                messageInput.disabled = true;
                sendButton.disabled = true;
                attachButton.disabled = true;
                messageInput.placeholder = '等待Agent发起会话...';
            }
        }
        
        function addMessage(text, type = 'user', toolData = null, plain = false, isError = false) {
            messageCount++;
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}\${plain ? ' plain' : ''}\`;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = plain ? 'message-content' : 'message-bubble';
            contentDiv.textContent = text;
            
            // Add special styling for speech errors
            if (isError && plain) {
                contentDiv.setAttribute('data-speech-error', 'true');
            }
            
            messageDiv.appendChild(contentDiv);
            
            // Only add timestamp for non-plain messages
            if (!plain) {
                const timeDiv = document.createElement('div');
                timeDiv.className = 'message-time';
                timeDiv.textContent = new Date().toLocaleTimeString();
                messageDiv.appendChild(timeDiv);
            }
            
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function addSpeechError(errorMessage) {
            // Add prominent error message with special styling
            addMessage('语音识别错误: ' + errorMessage, 'system', null, true, true);
            
            // Add helpful troubleshooting tips based on error type
            let tip = '';
            if (errorMessage.includes('permission') || errorMessage.includes('Permission')) {
                tip = '请在系统设置中授予麦克风权限';
            } else if (errorMessage.includes('busy') || errorMessage.includes('device')) {
                tip = '请关闭其他录音应用后重试';
            } else if (errorMessage.includes('SoX') || errorMessage.includes('sox')) {
                tip = 'SoX音频工具可能需要安装或更新';
            } else if (errorMessage.includes('timeout')) {
                tip = '请说得更清晰或检查麦克风连接';
            } else if (errorMessage.includes('Whisper') || errorMessage.includes('transcription')) {
                tip = '语音转文字服务可能不可用';
            } else {
                tip = '请检查麦克风权限后重试';
            }
            
            if (tip) {
                setTimeout(() => {
                    addMessage(tip, 'system', null, true);
                }, 500);
            }
        }
        
        function showTyping() {
            typingIndicator.style.display = 'flex';
        }
        
        function hideTyping() {
            typingIndicator.style.display = 'none';
        }
        
        function simulateResponse(userMessage) {
            // Don't simulate response - the backend handles acknowledgments now
            // This avoids duplicate messages
            hideTyping();
        }
        
        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text && attachedImages.length === 0) return;
            
            // Create message with text and images
            let displayMessage = text;
            if (attachedImages.length > 0) {
                displayMessage += (text ? '\\n\\n' : '') + \`[已附加 \${attachedImages.length} 张图片]\`;
            }
            
            addMessage(displayMessage, 'user');
            
            // Send to extension with images
            vscode.postMessage({
                command: 'send',
                text: text,
                attachments: attachedImages,
                timestamp: new Date().toISOString(),
                mcpIntegration: mcpIntegration
            });
            
            messageInput.value = '';
            attachedImages = []; // Clear attached images
            adjustTextareaHeight();
            
            // Ensure mic icon is visible after sending message
            toggleMicIcon();
            
            simulateResponse(displayMessage);
        }
        
        function adjustTextareaHeight() {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        }
        
        function handleImageUploaded(imageData) {
            // Add image to attachments with unique ID
            const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            imageData.id = imageId;
            attachedImages.push(imageData);
            
            // Show image preview in messages with remove button
            const imagePreview = document.createElement('div');
            imagePreview.className = 'message system image-preview';
            imagePreview.setAttribute('data-image-id', imageId);
            imagePreview.innerHTML = \`
                <div class="message-bubble image-container">
                    <div class="image-header">
                        <span class="image-filename">\${imageData.fileName}</span>
                        <button class="remove-image-btn" onclick="removeImage('\${imageId}')" title="Remove image">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <img src="\${imageData.dataUrl}" style="max-width: 200px; max-height: 200px; border-radius: 8px; margin-top: 8px;" alt="Uploaded image">
                    <div style="margin-top: 8px; font-size: 12px; opacity: 0.7;">图片已准备好发送 (\${(imageData.size / 1024).toFixed(1)} KB)</div>
                </div>
                <div class="message-time">\${new Date().toLocaleTimeString()}</div>
            \`;
            messagesContainer.appendChild(imagePreview);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            updateImageCounter();
        }
        
        // Remove image function
        function removeImage(imageId) {
            // Remove from attachments array
            attachedImages = attachedImages.filter(img => img.id !== imageId);
            
            // Remove from DOM
            const imagePreview = document.querySelector(\`[data-image-id="\${imageId}"]\`);
            if (imagePreview) {
                imagePreview.remove();
            }
            
            updateImageCounter();
            
            // Log removal
            console.log(\`🗑️ Image removed: \${imageId}\`);
            vscode.postMessage({
                command: 'logImageRemoved',
                imageId: imageId
            });
        }
        
        // Update image counter in input placeholder
        function updateImageCounter() {
            const count = attachedImages.length;
            const baseText = mcpIntegration ? 'Cursor Agent 正在等待您的回复' : '输入您的反馈';
            
            if (count > 0) {
                messageInput.placeholder = \`\${baseText}... 已附加 \${count} 张图片\`;
            } else {
                messageInput.placeholder = \`\${baseText}...\`;
            }
        }
        
        // Handle paste events for images with debounce to prevent duplicates
        let lastPasteTime = 0;
        function handlePaste(e) {
            const now = Date.now();
            // Prevent duplicate pastes within 500ms
            if (now - lastPasteTime < 500) {
                return;
            }
            
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;
            
            const items = clipboardData.items;
            if (!items) return;
            
            // Look for image items in clipboard
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                if (item.type.indexOf('image') !== -1) {
                    e.preventDefault(); // Prevent default paste behavior for images
                    lastPasteTime = now; // Update last paste time
                    
                    const file = item.getAsFile();
                    if (file) {
                        processPastedImage(file);
                    }
                    break;
                }
            }
        }
        
        // Process pasted image file
        function processPastedImage(file) {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const dataUrl = e.target.result;
                const base64Data = dataUrl.split(',')[1];
                
                // Generate a filename with timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const extension = file.type.split('/')[1] || 'png';
                const fileName = \`pasted-image-\${timestamp}.\${extension}\`;
                
                const imageData = {
                    fileName: fileName,
                    filePath: 'clipboard', // Indicate this came from clipboard
                    mimeType: file.type,
                    base64Data: base64Data,
                    dataUrl: dataUrl,
                    size: file.size,
                    source: 'paste' // Mark as pasted image
                };
                
                console.log(\`📋 Image pasted: \${fileName} (\${file.size} bytes)\`);
                
                // Log the pasted image for MCP integration
                vscode.postMessage({
                    command: 'logPastedImage',
                    fileName: fileName,
                    size: file.size,
                    mimeType: file.type
                });
                
                // Add to attachments and show preview
                handleImageUploaded(imageData);
            };
            
            reader.onerror = function() {
                console.error('Error reading pasted image');
                addMessage('处理粘贴图片时出错', 'system', null, true);
            };
            
            reader.readAsDataURL(file);
        }
        
        // Drag and drop handlers
        let dragCounter = 0;
        
        function handleDragEnter(e) {
            e.preventDefault();
            dragCounter++;
            if (hasImageFiles(e.dataTransfer)) {
                document.body.classList.add('drag-over');
                messageInput.classList.add('paste-highlight');
            }
        }
        
        function handleDragLeave(e) {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                document.body.classList.remove('drag-over');
                messageInput.classList.remove('paste-highlight');
                dragCounter = 0;
            }
        }
        
        function handleDragOver(e) {
            e.preventDefault();
            if (hasImageFiles(e.dataTransfer)) {
                e.dataTransfer.dropEffect = 'copy';
            }
        }
        
        function handleDrop(e) {
            e.preventDefault();
            dragCounter = 0;
            document.body.classList.remove('drag-over');
            messageInput.classList.remove('paste-highlight');
            
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                // Process files with a small delay to prevent conflicts with paste events
                setTimeout(() => {
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        if (file.type.startsWith('image/')) {
                            // Log drag and drop action
                            vscode.postMessage({
                                command: 'logDragDropImage',
                                fileName: file.name,
                                size: file.size,
                                mimeType: file.type
                            });
                            processPastedImage(file);
                        }
                    }
                }, 50);
            }
        }
        
        function hasImageFiles(dataTransfer) {
            if (dataTransfer.types) {
                for (let i = 0; i < dataTransfer.types.length; i++) {
                    if (dataTransfer.types[i] === 'Files') {
                        return true; // We'll check for images on drop
                    }
                }
            }
            return false;
        }
        
        // Hide/show mic icon based on input
        function toggleMicIcon() {
            // Don't toggle if we're currently recording or processing
            if (isRecording || micIcon.classList.contains('processing')) {
                return;
            }
            
            if (messageInput.value.trim().length > 0) {
                micIcon.style.opacity = '0';
                micIcon.style.pointerEvents = 'none';
            } else {
                // Always ensure mic is visible and clickable when input is empty
                micIcon.style.opacity = '0.7';
                micIcon.style.pointerEvents = 'auto';
                // Ensure proper mic icon state
                if (!micIcon.classList.contains('fa-microphone')) {
                    micIcon.className = 'fas fa-microphone mic-icon active';
                }
            }
        }
        
        // 语音功能已禁用 - Cursor webview不支持麦克风权限
        // Speech recording functions - DISABLED
        function startRecording() {
            console.log('⚠️ 语音功能已禁用');
        }
        
        function stopRecording() {
            console.log('⚠️ 语音功能已禁用');
        }
        
        function resetMicIcon() {
            // No-op: 语音功能已禁用
        }
        
        // Event listeners
        messageInput.addEventListener('input', () => {
            adjustTextareaHeight();
            toggleMicIcon();
        });
        
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Add paste event listener for images
        messageInput.addEventListener('paste', handlePaste);
        document.addEventListener('paste', handlePaste);
        
        // Add drag and drop support for images
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('drop', handleDrop);
        document.addEventListener('dragenter', handleDragEnter);
        document.addEventListener('dragleave', handleDragLeave);
        
        sendButton.addEventListener('click', () => {
            sendMessage();
        });
        
        attachButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'uploadImage' });
        });
        
        // 语音功能已禁用 - 无点击事件
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'addMessage':
                    addMessage(message.text, message.type || 'system', message.toolData, message.plain || false);
                    break;
                case 'newMessage':
                    addMessage(message.text, message.type || 'system', message.toolData, message.plain || false);
                    if (message.mcpIntegration) {
                        mcpIntegration = true;
                        messageInput.placeholder = 'Cursor Agent 正在等待您的回复...';
                    }
                    break;
                case 'focus':
                    messageInput.focus();
                    break;
                case 'updateMcpStatus':
                    updateMcpStatus(message.active);
                    break;
                case 'imageUploaded':
                    handleImageUploaded(message.imageData);
                    break;
                case 'recordingStarted':
                    console.log('✅ Recording confirmation received from backend');
                    break;
                case 'speechTranscribed':
                    // Handle speech-to-text result
                    console.log('📝 Speech transcription received:', message);
                    if (message.transcription && message.transcription.trim()) {
                        messageInput.value = message.transcription.trim();
                        adjustTextareaHeight();
                        messageInput.focus();
                        console.log('✅ Text injected into input:', message.transcription.trim());
                        // Reset mic icon after successful transcription
                        resetMicIcon();
                    } else if (message.error) {
                        console.error('语音识别错误:', message.error);
                        
                        // Show prominent error message in chat
                        addSpeechError(message.error);
                        
                        // Also show in placeholder briefly
                        const originalPlaceholder = messageInput.placeholder;
                        messageInput.placeholder = '语音识别失败，请重试';
                        setTimeout(() => {
                            messageInput.placeholder = originalPlaceholder;
                            resetMicIcon();
                        }, 3000);
                    } else {
                        console.log('未检测到语音');
                        
                        // Show helpful message in chat
                        addMessage('未检测到语音，请说清楚后重试', 'system', null, true);
                        
                        const originalPlaceholder = messageInput.placeholder;
                        messageInput.placeholder = '未检测到语音，请重试';
                        setTimeout(() => {
                            messageInput.placeholder = originalPlaceholder;
                            resetMicIcon();
                        }, 3000);
                    }
                    break;
            }
        });
        
        // Initialize speech availability - now using SoX directly
        function initializeSpeech() {
            // Always available since we're using SoX directly
            micIcon.style.opacity = '0.7';
            micIcon.style.pointerEvents = 'auto';
            micIcon.title = '点击说话';
            micIcon.classList.add('active');
            console.log('Speech recording available via SoX direct recording');
            
            // Ensure mic icon visibility on initialization
            if (messageInput.value.trim().length === 0) {
                micIcon.style.opacity = '0.7';
                micIcon.style.pointerEvents = 'auto';
            }
        }
        
        // Make removeImage globally accessible for onclick handlers
        window.removeImage = removeImage;
        
        // Initialize
        vscode.postMessage({ command: 'ready' });
        initializeSpeech();
        
        // Focus input immediately
        setTimeout(() => {
            messageInput.focus();
        }, 100);
    </script>
</body>
</html>`;
}

function handleReviewMessage(text, attachments, triggerId, mcpIntegration, specialHandling) {
    // Handle special cases for different tool types
    if (specialHandling === 'shutdown_mcp') {
        if (text.toUpperCase().includes('CONFIRM') || text.toUpperCase() === 'YES') {
            logUserInput(`SHUTDOWN CONFIRMED: ${text}`, 'SHUTDOWN_CONFIRMED', triggerId);
            
            // Send confirmation response
            if (chatPanel) {
                setTimeout(() => {
                    chatPanel.webview.postMessage({
                        command: 'addMessage',
                        text: `已确认关闭: "${text}"\n\nMCP服务器关闭已获用户批准。\n\nCursor Agent将执行正常关闭。`,
                        type: 'system'
                    });
                    
                    // Set MCP status to inactive after shutdown confirmation
                    setTimeout(() => {
                        if (chatPanel) {
                            chatPanel.webview.postMessage({
                                command: 'updateMcpStatus',
                                active: false
                            });
                        }
                    }, 1000);
                }, 500);
            }
        } else {
            logUserInput(`SHUTDOWN ALTERNATIVE: ${text}`, 'SHUTDOWN_ALTERNATIVE', triggerId);
            
            // Send alternative instructions response
            if (chatPanel) {
                setTimeout(() => {
                    chatPanel.webview.postMessage({
                        command: 'addMessage',
                        text: `替代指令: "${text}"\n\n您的指令已发送至Cursor Agent。\n\nAgent将处理您的请求。`,
                        type: 'system'
                    });
                    
                    // Set MCP status to inactive after alternative instructions
                    setTimeout(() => {
                        if (chatPanel) {
                            chatPanel.webview.postMessage({
                                command: 'updateMcpStatus',
                                active: false
                            });
                        }
                    }, 1000);
                }, 500);
            }
        }
    } else if (specialHandling === 'ingest_text') {
        logUserInput(`TEXT FEEDBACK: ${text}`, 'TEXT_FEEDBACK', triggerId);
        
        // Send text feedback response
        if (chatPanel) {
            setTimeout(() => {
                chatPanel.webview.postMessage({
                    command: 'addMessage',
                    text: `文本已处理: "${text}"\n\n您的反馈已发送至Cursor Agent。\n\nAgent将继续处理。`,
                    type: 'system'
                });
                
                // Set MCP status to inactive after text feedback
                setTimeout(() => {
                    if (chatPanel) {
                        chatPanel.webview.postMessage({
                            command: 'updateMcpStatus',
                            active: false
                        });
                    }
                }, 1000);
            }, 500);
        }
    } else {
        // Standard handling for other tools
        // Log to output channel for persistence
        outputChannel.appendLine(`${mcpIntegration ? 'MCP回复' : '审查'} 已提交: ${text}`);
        
        // Send simple confirmation response back to webview (no random messages)
        if (chatPanel) {
            setTimeout(() => {
                chatPanel.webview.postMessage({
                    command: 'addMessage',
                    text: '已发送至Agent',
                    type: 'system',
                    plain: true  // Use plain styling for acknowledgments
                });
                
                // Set MCP status to inactive after sending response
                setTimeout(() => {
                    if (chatPanel) {
                        chatPanel.webview.postMessage({
                            command: 'updateMcpStatus',
                            active: false
                        });
                    }
                }, 1000);
                
            }, 500);
        }
    }
}

function handleFileAttachment(triggerId) {
    logUserInput('User requested file attachment for review', 'FILE_ATTACHMENT', triggerId);
    
    vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Select file(s) for review',
        filters: {
            'All files': ['*']
        }
    }).then(fileUris => {
        if (fileUris && fileUris.length > 0) {
            const filePaths = fileUris.map(uri => uri.fsPath);
            const fileNames = filePaths.map(fp => path.basename(fp));
            
            logUserInput(`Files selected for review: ${fileNames.join(', ')}`, 'FILE_SELECTED', triggerId);
            
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'addMessage',
                    text: `Files attached for review:\n${fileNames.map(name => '• ' + name).join('\n')}\n\nPaths:\n${filePaths.map(fp => '• ' + fp).join('\n')}`,
                    type: 'system'
                });
            }
        } else {
            logUserInput('No files selected for review', 'FILE_CANCELLED', triggerId);
        }
    });
}

function handleImageUpload(triggerId) {
    logUserInput('User requested image upload for review', 'IMAGE_UPLOAD', triggerId);
    
    vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Select image(s) to upload',
        filters: {
            'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
        }
    }).then(fileUris => {
        if (fileUris && fileUris.length > 0) {
            fileUris.forEach(fileUri => {
                const filePath = fileUri.fsPath;
                const fileName = path.basename(filePath);
                
                
                try {
                    // Read the image file
                    const imageBuffer = fs.readFileSync(filePath);
                    const base64Data = imageBuffer.toString('base64');
                    const mimeType = getMimeType(fileName);
                    const dataUrl = `data:${mimeType};base64,${base64Data}`;
                    
                    const imageData = {
                        fileName: fileName,
                        filePath: filePath,
                        mimeType: mimeType,
                        base64Data: base64Data,
                        dataUrl: dataUrl,
                        size: imageBuffer.length
                    };
                    
                    logUserInput(`Image uploaded: ${fileName}`, 'IMAGE_UPLOADED', triggerId);
                    
                    // Send image data to webview
                    if (chatPanel) {
                        chatPanel.webview.postMessage({
                            command: 'imageUploaded',
                            imageData: imageData
                        });
                    }
                    
                } catch (error) {
                    console.log(`Error processing image ${fileName}: ${error.message}`);
                    vscode.window.showErrorMessage(`处理图片失败: ${fileName}`);
                }
            });
        } else {
            logUserInput('No images selected for upload', 'IMAGE_CANCELLED', triggerId);
        }
    });
}

function getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

async function handleWebAudioRecording(base64Audio, mimeType, triggerId) {
    /**
     * Handle audio recorded via Web Audio API in the webview
     * Converts base64 to file and sends to MCP server for transcription
     */
    try {
        const timestamp = Date.now();
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        
        // Save as webm file (will be converted by Whisper)
        const audioFile = getTempPath(`review_gate_webaudio_${triggerId}_${timestamp}.webm`);
        fs.writeFileSync(audioFile, audioBuffer);
        
        console.log(`🎤 Web Audio saved: ${audioFile} (${audioBuffer.length} bytes)`);
        
        // Check minimum size
        if (audioBuffer.length < 1000) {
            console.log('⚠️ Audio too short, probably no speech');
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'speechTranscribed',
                    transcription: '',
                    error: '录音时间太短，请说得更长一些'
                });
            }
            try { fs.unlinkSync(audioFile); } catch (e) {}
            return;
        }
        
        // Send to MCP server for transcription (same as SoX path)
        handleSpeechToText(audioFile, triggerId, true);
        
    } catch (error) {
        console.log(`❌ Web Audio processing error: ${error.message}`);
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'speechTranscribed',
                transcription: '',
                error: `音频处理失败: ${error.message}`
            });
        }
    }
}

async function handleSpeechToText(audioData, triggerId, isFilePath = false) {
    try {
        let tempAudioPath;
        
        if (isFilePath) {
            // Audio data is already a file path
            tempAudioPath = audioData;
            console.log(`Using existing audio file for transcription: ${tempAudioPath}`);
        } else {
            // Convert base64 audio data to buffer (legacy webview approach)
            const base64Data = audioData.split(',')[1];
            const audioBuffer = Buffer.from(base64Data, 'base64');
            
            // Save audio to temp file
            tempAudioPath = getTempPath(`review_gate_audio_${triggerId}_${Date.now()}.wav`);
            fs.writeFileSync(tempAudioPath, audioBuffer);
            
            console.log(`Audio saved for transcription: ${tempAudioPath}`);
        }
        
        // Send to MCP server for transcription
        const transcriptionRequest = {
            timestamp: new Date().toISOString(),
            system: "review-gate-v2",
            editor: "cursor",
            data: {
                tool: "speech_to_text",
                audio_file: tempAudioPath,
                trigger_id: triggerId,
                format: "wav"
            },
            mcp_integration: true
        };
        
        const triggerFile = getTempPath(`review_gate_speech_trigger_${triggerId}.json`);
        fs.writeFileSync(triggerFile, JSON.stringify(transcriptionRequest, null, 2), { encoding: 'utf8' });
        
        console.log(`Speech-to-text request sent: ${triggerFile}`);
        
        // Poll for transcription result
        const maxWaitTime = 30000; // 30 seconds
        const pollInterval = 500; // 500ms
        let waitTime = 0;
        
        const pollForResult = setInterval(() => {
            const resultFile = getTempPath(`review_gate_speech_response_${triggerId}.json`);
            
            if (fs.existsSync(resultFile)) {
                try {
                    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
                    
                    if (result.transcription) {
                        // Send transcription back to webview
                        if (chatPanel) {
                            chatPanel.webview.postMessage({
                                command: 'speechTranscribed',
                                transcription: result.transcription
                            });
                        }
                        
                        console.log(`Speech transcribed: ${result.transcription}`);
                        logUserInput(`Speech transcribed: ${result.transcription}`, 'SPEECH_TRANSCRIBED', triggerId);
                    }
                    
                    // Cleanup - let MCP server handle audio file cleanup to avoid race conditions
                    try {
                        fs.unlinkSync(resultFile);
                        console.log('✅ Cleaned up speech response file');
                    } catch (e) {
                        console.log(`Could not clean up response file: ${e.message}`);
                    }
                    
                    try {
                        fs.unlinkSync(triggerFile);
                        console.log('✅ Cleaned up speech trigger file');
                    } catch (e) {
                        console.log(`Could not clean up trigger file: ${e.message}`);
                    }
                    
                    // Note: Audio file cleanup is handled by MCP server to avoid race conditions
                    
                } catch (error) {
                    console.log(`Error reading transcription result: ${error.message}`);
                }
                
                clearInterval(pollForResult);
            }
            
            waitTime += pollInterval;
            if (waitTime >= maxWaitTime) {
                console.log('Speech-to-text timeout');
                if (chatPanel) {
                    chatPanel.webview.postMessage({
                        command: 'speechTranscribed',
                        transcription: '' // Empty transcription on timeout
                    });
                }
                clearInterval(pollForResult);
                
                // Cleanup on timeout - only clean up trigger file
                try {
                    fs.unlinkSync(triggerFile);
                    console.log('✅ Cleaned up trigger file on timeout');
                } catch (e) {
                    console.log(`Could not clean up trigger file on timeout: ${e.message}`);
                }
                // Note: Audio file cleanup handled by MCP server or OS temp cleanup
            }
        }, pollInterval);
        
    } catch (error) {
        console.log(`Speech-to-text error: ${error.message}`);
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'speechTranscribed',
                transcription: '' // Empty transcription on error
            });
        }
    }
}

async function validateSoxSetup() {
    /**
     * Validate SoX installation and microphone access
     * Returns: {success: boolean, error: string}
     */
    return new Promise((resolve) => {
        try {
            // Test if sox command exists
            const testProcess = spawn('sox', ['--version'], { stdio: 'pipe' });
            
            let soxVersion = '';
            testProcess.stdout.on('data', (data) => {
                soxVersion += data.toString();
            });
            
            testProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve({ success: false, error: 'SoX command not found or failed' });
                    return;
                }
                
                console.log(`✅ SoX found: ${soxVersion.trim()}`);
                
                // Test microphone access with a very short recording
                const testFile = getTempPath(`review_gate_test_${Date.now()}.wav`);
                const micTestProcess = spawn('sox', ['-d', '-r', '16000', '-c', '1', testFile, 'trim', '0', '0.1'], { stdio: 'pipe' });
                
                let testError = '';
                micTestProcess.stderr.on('data', (data) => {
                    testError += data.toString();
                });
                
                micTestProcess.on('close', (testCode) => {
                    // Clean up test file
                    try {
                        if (fs.existsSync(testFile)) {
                            fs.unlinkSync(testFile);
                        }
                    } catch (e) {}
                    
                    if (testCode !== 0) {
                        let errorMsg = 'Microphone access failed';
                        if (testError.includes('Permission denied')) {
                            errorMsg = 'Microphone permission denied - please allow microphone access in system settings';
                        } else if (testError.includes('No such device')) {
                            errorMsg = 'No microphone device found';
                        } else if (testError.includes('Device or resource busy')) {
                            errorMsg = 'Microphone is busy - close other recording applications';
                        } else if (testError) {
                            errorMsg = `Microphone test failed: ${testError.substring(0, 100)}`;
                        }
                        resolve({ success: false, error: errorMsg });
                    } else {
                        console.log('✅ Microphone access test successful');
                        resolve({ success: true, error: null });
                    }
                });
                
                // Timeout for microphone test
                setTimeout(() => {
                    try {
                        micTestProcess.kill('SIGTERM');
                        resolve({ success: false, error: 'Microphone test timed out' });
                    } catch (e) {}
                }, 3000);
            });
            
            testProcess.on('error', (error) => {
                resolve({ success: false, error: `SoX not installed: ${error.message}` });
            });
            
            // Timeout for version check
            setTimeout(() => {
                try {
                    testProcess.kill('SIGTERM');
                    resolve({ success: false, error: 'SoX version check timed out' });
                } catch (e) {}
            }, 2000);
            
        } catch (error) {
            resolve({ success: false, error: `SoX validation error: ${error.message}` });
        }
    });
}

async function startNodeRecording(triggerId) {
    try {
        if (currentRecording) {
            console.log('Recording already in progress');
            // Send feedback to webview
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'speechTranscribed',
                    transcription: '',
                    error: 'Recording already in progress'
                });
            }
            return;
        }
        
        // Validate SoX setup before recording
        console.log('🔍 Validating SoX and microphone setup...');
        const validation = await validateSoxSetup();
        if (!validation.success) {
            console.log(`❌ SoX validation failed: ${validation.error}`);
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'speechTranscribed',
                    transcription: '',
                    error: validation.error
                });
            }
            return;
        }
        console.log('✅ SoX validation successful - proceeding with recording');
        
        const timestamp = Date.now();
        const audioFile = getTempPath(`review_gate_audio_${triggerId}_${timestamp}.wav`);
        
        console.log(`🎤 Starting SoX recording: ${audioFile}`);
        
        // Use sox directly to record audio
        // sox -d -r 16000 -c 1 output.wav (let SoX auto-detect bit depth)
        const soxArgs = [
            '-d',           // Use default input device (microphone)
            '-r', '16000',  // Sample rate 16kHz
            '-c', '1',      // Mono (1 channel)
            audioFile       // Output file
        ];
        
        console.log(`🎤 Starting sox with args:`, soxArgs);
        
        // Spawn sox process
        currentRecording = spawn('sox', soxArgs);
        
        // Store metadata
        currentRecording.audioFile = audioFile;
        currentRecording.triggerId = triggerId;
        currentRecording.startTime = Date.now();
        
        // Handle sox process events
        currentRecording.on('error', (error) => {
            console.log(`❌ SoX process error: ${error.message}`);
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'speechTranscribed',
                    transcription: '',
                    error: `Recording failed: ${error.message}`
                });
            }
            currentRecording = null;
        });
        
        currentRecording.stderr.on('data', (data) => {
            console.log(`SoX stderr: ${data}`);
        });
        
        console.log(`✅ SoX recording started: PID ${currentRecording.pid}, file: ${audioFile}`);
        
        // Send confirmation to webview that recording has started
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'recordingStarted',
                audioFile: audioFile
            });
        }
        
    } catch (error) {
        console.log(`❌ Failed to start SoX recording: ${error.message}`);
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'speechTranscribed',
                transcription: '',
                error: `Recording failed: ${error.message}`
            });
        }
        currentRecording = null;
    }
}

function stopNodeRecording(triggerId) {
    try {
        if (!currentRecording) {
            console.log('No recording in progress');
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'speechTranscribed',
                    transcription: '',
                    error: 'No recording in progress'
                });
            }
            return;
        }
        
        const audioFile = currentRecording.audioFile;
        const recordingPid = currentRecording.pid;
        console.log(`🛑 Stopping SoX recording: PID ${recordingPid}, file: ${audioFile}`);
        
        // Stop the sox process by sending SIGTERM
        currentRecording.kill('SIGTERM');
        
        // Wait for process to exit and file to be finalized
        currentRecording.on('exit', (code, signal) => {
            console.log(`📝 SoX process exited with code: ${code}, signal: ${signal}`);
            
            // Give a moment for file system to sync
            setTimeout(() => {
                console.log(`📝 Checking for audio file: ${audioFile}`);
                
                if (fs.existsSync(audioFile)) {
                    const stats = fs.statSync(audioFile);
                    console.log(`✅ Audio file created: ${audioFile} (${stats.size} bytes)`);
                    
                    // Check minimum file size (more generous for SoX)
                    if (stats.size > 500) {
                        console.log(`🎤 Audio file ready for transcription: ${audioFile} (${stats.size} bytes)`);
                        // Send to MCP server for transcription
                        handleSpeechToText(audioFile, triggerId, true);
                    } else {
                        console.log('⚠️ Audio file too small, probably no speech detected');
                        if (chatPanel) {
                            chatPanel.webview.postMessage({
                                command: 'speechTranscribed',
                                transcription: '',
                                error: 'No speech detected - try speaking louder or closer to microphone'
                            });
                        }
                        // Clean up small file
                        try {
                            fs.unlinkSync(audioFile);
                        } catch (e) {
                            console.log(`Could not clean up small file: ${e.message}`);
                        }
                    }
                } else {
                    console.log('❌ Audio file was not created');
                    if (chatPanel) {
                        chatPanel.webview.postMessage({
                            command: 'speechTranscribed',
                            transcription: '',
                            error: 'Recording failed - no audio file created'
                        });
                    }
                }
                
                currentRecording = null;
            }, 1000); // Wait 1 second for file system sync
        });
        
        // Set a timeout in case the process doesn't exit gracefully
        setTimeout(() => {
            if (currentRecording && currentRecording.pid) {
                console.log(`⚠️ Force killing SoX process: ${currentRecording.pid}`);
                try {
                    currentRecording.kill('SIGKILL');
                } catch (e) {
                    console.log(`Could not force kill: ${e.message}`);
                }
                currentRecording = null;
            }
        }, 3000);
        
    } catch (error) {
        console.log(`❌ Failed to stop SoX recording: ${error.message}`);
        currentRecording = null;
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'speechTranscribed',
                transcription: '',
                error: `Stop recording failed: ${error.message}`
            });
        }
    }
}

function deactivate() {
    // Silent deactivation
    console.log(`🛑 Review Gate V2 deactivating (hash: ${workspaceHash})`);
    
    // Remove workspace registration
    removeWorkspaceRegistration();
    
    if (reviewGateWatcher) {
        clearInterval(reviewGateWatcher);
    }
    
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    
    if (outputChannel) {
        outputChannel.dispose();
    }
}

module.exports = {
    activate,
    deactivate
}; 