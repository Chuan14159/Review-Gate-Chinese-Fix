# Review Gate V2 - Windows PowerShell Installation Script
# Author: Lakshman Turlapati
# This script installs Review Gate V2 globally for Cursor IDE on Windows

# Enable strict error handling
$ErrorActionPreference = "Stop"

# Fix encoding for emoji and Chinese characters display
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# Enhanced color logging functions (ASCII symbols for Windows compatibility)
function Write-Error-Log { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Success-Log { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info-Log { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Yellow }
function Write-Progress-Log { param([string]$Message) Write-Host "[...] $Message" -ForegroundColor Cyan }
function Write-Warning-Log { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Step-Log { param([string]$Message) Write-Host "      $Message" -ForegroundColor White }
function Write-Header-Log { param([string]$Message) Write-Host "$Message" -ForegroundColor Cyan }

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Header-Log "Review Gate V2 - Windows Installation"
Write-Header-Log "========================================="
Write-Host ""

# Check if running on Windows
if ($PSVersionTable.Platform -and $PSVersionTable.Platform -ne "Win32NT") {
    Write-Error-Log "This script is designed for Windows only"
    exit 1
}

# Check for admin privileges for package manager installation
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Warning-Log "Administrator privileges recommended for package installations"
    Write-Info-Log "Some features may require manual installation"
}

# Check if Scoop is installed, if not install it
Write-Progress-Log "Checking for Scoop package manager..."
if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Progress-Log "Installing Scoop..."
    try {
        Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Invoke-Expression (New-Object System.Net.WebClient).DownloadString('https://get.scoop.sh')
        Write-Success-Log "Scoop installed successfully"
    } catch {
        Write-Error-Log "Failed to install Scoop automatically"
        Write-Info-Log "Please install Scoop manually from https://scoop.sh"
        Write-Info-Log "Then run this script again"
        exit 1
    }
} else {
    Write-Success-Log "Scoop already installed"
}

# Install FFmpeg for speech-to-text (replaces SoX for better Win11 compatibility)
Write-Progress-Log "Installing FFmpeg for speech-to-text..."
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    try {
        scoop install ffmpeg
        Write-Success-Log "FFmpeg installed successfully"
    } catch {
        Write-Warning-Log "Failed to install FFmpeg via Scoop"
        Write-Info-Log "Please install FFmpeg manually from https://ffmpeg.org/download.html"
    }
} else {
    Write-Success-Log "FFmpeg already installed"
}

# Validate FFmpeg installation and microphone access
Write-Progress-Log "Validating FFmpeg and microphone setup..."
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    try {
        $ffmpegVersion = & ffmpeg -version 2>$null | Select-Object -First 1
        Write-Success-Log "FFmpeg found: $ffmpegVersion"
        
        # List available audio devices
        Write-Progress-Log "Checking available audio devices..."
        $deviceList = & ffmpeg -list_devices true -f dshow -i dummy 2>&1 | Out-String
        if ($deviceList -match "audio") {
            Write-Success-Log "Audio devices detected"
            Write-Info-Log "Available audio devices:"
            $deviceList -split "`n" | Where-Object { $_ -match '\[dshow' -and $_ -match 'audio' } | ForEach-Object {
                Write-Step-Log "   $_"
            }
        } else {
            Write-Warning-Log "No audio devices found - speech features may not work"
            Write-Info-Log "Common fixes:"
            Write-Step-Log "   - Check Windows Settings > Privacy > Microphone"
            Write-Step-Log "   - Make sure microphone is connected and enabled"
        }
    } catch {
        Write-Warning-Log "FFmpeg validation error: $($_.Exception.Message)"
    }
} else {
    Write-Error-Log "FFmpeg installation failed or not found"
    Write-Info-Log "Speech-to-text features will be disabled"
    Write-Info-Log "Try installing manually: scoop install ffmpeg"
}

# Install dedicated Python 3.12 for Review Gate (avoids conflicts with system Python)
Write-Progress-Log "Setting up dedicated Python 3.12 environment..."

$ReviewGatePythonDir = Join-Path $env:USERPROFILE "cursor-extensions\review-gate-python"
$ReviewGatePython = Join-Path $ReviewGatePythonDir "python.exe"

# Check if we already have a dedicated Python 3.12 installed
$needPythonInstall = $true
if (Test-Path $ReviewGatePython) {
    try {
        $existingVersion = & $ReviewGatePython --version 2>&1
        if ($existingVersion -match "Python 3\.12") {
            Write-Success-Log "Dedicated Python 3.12 already installed"
            $needPythonInstall = $false
        } else {
            Write-Info-Log "Existing Python version: $existingVersion - will reinstall 3.12"
        }
    } catch {
        Write-Info-Log "Existing Python installation invalid - will reinstall"
    }
}

if ($needPythonInstall) {
    Write-Progress-Log "Installing Python 3.12 (dedicated for Review Gate)..."
    Write-Info-Log "This ensures compatibility with SenseVoice speech recognition"
    
    # Create directory
    New-Item -Path $ReviewGatePythonDir -ItemType Directory -Force | Out-Null
    
    # Download Python 3.12 embeddable package (lightweight, no admin required)
    $pythonZipUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip"
    $pythonZipFile = Join-Path $env:TEMP "python-3.12.8-embed-amd64.zip"
    $pipGetUrl = "https://bootstrap.pypa.io/get-pip.py"
    $getPipFile = Join-Path $env:TEMP "get-pip.py"
    
    try {
        Write-Progress-Log "Downloading Python 3.12..."
        Invoke-WebRequest -Uri $pythonZipUrl -OutFile $pythonZipFile -UseBasicParsing
        
        Write-Progress-Log "Extracting Python 3.12..."
        Expand-Archive -Path $pythonZipFile -DestinationPath $ReviewGatePythonDir -Force
        
        # Enable pip by modifying python312._pth file
        $pthFile = Join-Path $ReviewGatePythonDir "python312._pth"
        if (Test-Path $pthFile) {
            $pthContent = Get-Content $pthFile
            # Uncomment import site line and add Lib\site-packages
            $newPthContent = $pthContent -replace "^#import site", "import site"
            $newPthContent += "`nLib\site-packages"
            Set-Content -Path $pthFile -Value $newPthContent
        }
        
        # Download and install pip
        Write-Progress-Log "Installing pip..."
        Invoke-WebRequest -Uri $pipGetUrl -OutFile $getPipFile -UseBasicParsing
        & $ReviewGatePython $getPipFile --no-warn-script-location
        
        # Verify installation
        if (Test-Path $ReviewGatePython) {
            $installedVersion = & $ReviewGatePython --version 2>&1
            Write-Success-Log "Python 3.12 installed: $installedVersion"
        } else {
            throw "Python installation verification failed"
        }
        
        # Clean up
        Remove-Item $pythonZipFile -Force -ErrorAction SilentlyContinue
        Remove-Item $getPipFile -Force -ErrorAction SilentlyContinue
        
    } catch {
        Write-Error-Log "Failed to install Python 3.12: $($_.Exception.Message)"
        Write-Info-Log "Falling back to system Python..."
        
        # Fallback to system Python
        if (Get-Command python -ErrorAction SilentlyContinue) {
            $ReviewGatePython = "python"
            Write-Warning-Log "Using system Python - speech features may not work"
        } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
            $ReviewGatePython = "python3"
            Write-Warning-Log "Using system Python - speech features may not work"
        } else {
            Write-Error-Log "No Python available. Please install Python 3.12 manually"
            exit 1
        }
    }
}

# Set the Python command for subsequent operations
$pythonCmd = $ReviewGatePython
Write-Info-Log "Using Python: $pythonCmd"

# Create global Cursor extensions directory
$CursorExtensionsDir = Join-Path $env:USERPROFILE "cursor-extensions"
$ReviewGateDir = Join-Path $CursorExtensionsDir "review-gate-v2"

Write-Progress-Log "Creating global installation directory..."
New-Item -Path $ReviewGateDir -ItemType Directory -Force | Out-Null

# Copy MCP server files
Write-Progress-Log "Copying MCP server files..."
$mcpServerSrc = Join-Path $ScriptDir "review_gate_v2_mcp.py"
$requirementsSrc = Join-Path $ScriptDir "requirements.txt"

if (Test-Path $mcpServerSrc) {
    Copy-Item $mcpServerSrc $ReviewGateDir -Force
} else {
    Write-Error-Log "MCP server file not found: $mcpServerSrc"
    exit 1
}

if (Test-Path $requirementsSrc) {
    Copy-Item $requirementsSrc $ReviewGateDir -Force
} else {
    Write-Error-Log "Requirements file not found: $requirementsSrc"
    exit 1
}

# Create Python virtual environment using dedicated Python 3.12
Write-Progress-Log "Creating Python virtual environment..."
Set-Location $ReviewGateDir

# For embedded Python, we need to use virtualenv instead of venv
$venvDir = Join-Path $ReviewGateDir "venv"

# Remove existing venv if it exists (to ensure clean state)
if (Test-Path $venvDir) {
    Write-Info-Log "Removing existing virtual environment..."
    Remove-Item -Path $venvDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Install virtualenv and create venv
Write-Progress-Log "Installing virtualenv..."
try {
    & $pythonCmd -m pip install --upgrade pip virtualenv --no-warn-script-location 2>$null
    
    Write-Progress-Log "Creating virtual environment with Python 3.12..."
    & $pythonCmd -m virtualenv $venvDir --no-download
    
    if (Test-Path (Join-Path $venvDir "Scripts\python.exe")) {
        Write-Success-Log "Virtual environment created successfully"
    } else {
        throw "Virtual environment creation failed"
    }
} catch {
    Write-Warning-Log "virtualenv failed: $($_.Exception.Message)"
    Write-Progress-Log "Trying alternative venv method..."
    try {
        & $pythonCmd -m venv $venvDir
    } catch {
        Write-Error-Log "Failed to create virtual environment"
        exit 1
    }
}

# Activate virtual environment and install dependencies
Write-Progress-Log "Installing Python dependencies..."
$venvActivate = Join-Path $ReviewGateDir "venv\Scripts\Activate.ps1"
$venvPython = Join-Path $ReviewGateDir "venv\Scripts\python.exe"

if (Test-Path $venvActivate) {
    & $venvActivate
    & $venvPython -m pip install --upgrade pip
    
    # Install core dependencies first
    Write-Progress-Log "Installing core dependencies (mcp, pillow)..."
    & $venvPython -m pip install mcp>=1.9.2 Pillow>=10.0.0 asyncio typing-extensions>=4.14.0
    
    # Install SenseVoice (FunASR) for speech-to-text
    # SenseVoice: 阿里开源语音识别，中文准确率更高，速度比Whisper快5-15倍
    Write-Progress-Log "Installing SenseVoice (FunASR) for speech-to-text..."
    Write-Info-Log "SenseVoice provides better Chinese recognition accuracy"
    try {
        & $venvPython -m pip install funasr>=1.1.2 modelscope torch torchaudio
        Write-Success-Log "SenseVoice (FunASR) installed successfully"
        
        # Pre-download model to avoid first-run delay
        Write-Progress-Log "Pre-downloading SenseVoice model (this may take a few minutes)..."
        try {
            & $venvPython -c "from funasr import AutoModel; AutoModel(model='iic/SenseVoiceSmall', trust_remote_code=True, device='cpu')"
            Write-Success-Log "SenseVoice model downloaded successfully"
        } catch {
            Write-Warning-Log "Model pre-download failed - will download on first use"
            Write-Info-Log "This is normal if network is slow"
        }
    } catch {
        Write-Warning-Log "SenseVoice installation failed"
        Write-Info-Log "Speech-to-text will be disabled"
        Write-Info-Log "Common fixes:"
        Write-Step-Log "   - Check network connection"
        Write-Step-Log "   - Ensure enough disk space (~2GB)"
        Write-Step-Log "   - You can manually install later: pip install funasr modelscope"
    }
    
    deactivate
} else {
    Write-Error-Log "Failed to create virtual environment"
    exit 1
}

Write-Success-Log "Python environment created and dependencies installed"

# Create MCP configuration
$CursorMcpFile = Join-Path $env:USERPROFILE ".cursor\mcp.json"
Write-Progress-Log "Configuring MCP servers..."
$CursorDir = Join-Path $env:USERPROFILE ".cursor"
New-Item -Path $CursorDir -ItemType Directory -Force | Out-Null

# Prepare Review Gate V2 server configuration
$pythonPath = $venvPython -replace '\\', '/'
$mcpScriptPath = (Join-Path $ReviewGateDir "review_gate_v2_mcp.py") -replace '\\', '/'
$reviewGateDirPath = $ReviewGateDir -replace '\\', '/'

$reviewGateServer = @{
    command = $pythonPath
    args = @($mcpScriptPath)
    env = @{
        PYTHONPATH = $reviewGateDirPath
        PYTHONUNBUFFERED = "1"
        REVIEW_GATE_MODE = "cursor_integration"
    }
}

# Initialize configuration
$existingServerCount = 0
$mcpConfig = @{ mcpServers = @{} }

# Read and merge existing MCP configuration if it exists
if (Test-Path $CursorMcpFile) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $BackupFile = "$CursorMcpFile.backup.$timestamp"
    Write-Info-Log "Backing up existing MCP configuration to: $BackupFile"
    Copy-Item $CursorMcpFile $BackupFile -Force
    
    # Check if the existing config is valid JSON and merge
    try {
        $existingContent = Get-Content $CursorMcpFile -Raw -Encoding UTF8
        $existingConfig = $existingContent | ConvertFrom-Json
        
        if ($existingConfig.mcpServers) {
            # Preserve all existing servers
            $existingConfig.mcpServers.PSObject.Properties | ForEach-Object {
                if ($_.Name -ne "review-gate-v2") {
                    $mcpConfig.mcpServers[$_.Name] = $_.Value
                    $existingServerCount++
                }
            }
            Write-Success-Log "Found $existingServerCount existing MCP server(s), will preserve them"
        }
    } catch {
        Write-Warning-Log "Existing MCP config has invalid JSON format: $_"
        Write-Info-Log "Will create new configuration (backup saved)"
    }
} else {
    Write-Info-Log "Creating new MCP configuration file"
}

# Add Review Gate V2 server to configuration
$mcpConfig.mcpServers["review-gate-v2"] = $reviewGateServer

# Write merged configuration
Write-Progress-Log "Writing merged MCP configuration..."
try {
    $jsonContent = $mcpConfig | ConvertTo-Json -Depth 10
    Set-Content -Path $CursorMcpFile -Value $jsonContent -Encoding UTF8
    
    $totalServers = $mcpConfig.mcpServers.Count
    Write-Success-Log "MCP configuration updated successfully at: $CursorMcpFile"
    Write-Header-Log "Total MCP servers configured: $totalServers"
    
    # List all configured servers
    $mcpConfig.mcpServers.Keys | ForEach-Object {
        if ($_ -eq "review-gate-v2") {
            Write-Step-Log "  - $_ (Review Gate V2) [added/updated]"
        } else {
            Write-Step-Log "  - $_ [preserved]"
        }
    }
} catch {
    Write-Error-Log "Failed to create MCP configuration: $_"
    if (Test-Path $BackupFile) {
        Write-Progress-Log "Restoring from backup..."
        Copy-Item $BackupFile $CursorMcpFile -Force
        Write-Success-Log "Backup restored"
    } else {
        Write-Error-Log "No backup available, installation failed"
        exit 1
    }
}

# Test MCP server
Write-Progress-Log "Testing MCP server..."
Set-Location $ReviewGateDir
try {
    $testJob = Start-Job -ScriptBlock {
        param($venvPython, $reviewGateDir)
        & $venvPython (Join-Path $reviewGateDir "review_gate_v2_mcp.py")
    } -ArgumentList $venvPython, $ReviewGateDir
    
    Start-Sleep -Seconds 5
    Stop-Job $testJob -ErrorAction SilentlyContinue
    $testOutput = Receive-Job $testJob -ErrorAction SilentlyContinue
    Remove-Job $testJob -Force -ErrorAction SilentlyContinue
    
    if ($testOutput -match "Review Gate 2.0 server initialized") {
        Write-Success-Log "MCP server test successful"
    } else {
        Write-Warning-Log "MCP server test inconclusive (may be normal)"
    }
} catch {
    Write-Warning-Log "MCP server test failed (may be normal)"
}

# Install Cursor extension
$ExtensionFile = Join-Path $ScriptDir "cursor-extension\review-gate-v2-2.7.3-cn.5.vsix"
if (Test-Path $ExtensionFile) {
    Write-Progress-Log "Installing Cursor extension..."
    
    # Copy extension to installation directory
    Copy-Item $ExtensionFile $ReviewGateDir -Force
    
    # Try automated installation first
    $ExtensionInstalled = $false
    $cursorPaths = @(
        "${env:ProgramFiles}\Cursor\resources\app\bin\cursor.cmd",
        "${env:LOCALAPPDATA}\Programs\cursor\resources\app\bin\cursor.cmd",
        "${env:ProgramFiles(x86)}\Cursor\resources\app\bin\cursor.cmd"
    )
    
    foreach ($cursorCmd in $cursorPaths) {
        if (Test-Path $cursorCmd) {
            Write-Progress-Log "Attempting automated extension installation..."
            try {
                & $cursorCmd --install-extension $ExtensionFile | Out-Null
                Write-Success-Log "Extension installed automatically via command line"
                $ExtensionInstalled = $true
                break
            } catch {
                Write-Warning-Log "Automated installation failed: $($_.Exception.Message)"
            }
        }
    }
    
    # If automated installation failed, provide manual instructions
    if (-not $ExtensionInstalled) {
        Write-Header-Log "MANUAL EXTENSION INSTALLATION REQUIRED:"
        Write-Info-Log "Please complete the extension installation manually:"
        Write-Step-Log "1. Open Cursor IDE"
        Write-Step-Log "2. Press Ctrl+Shift+P"
        Write-Step-Log "3. Type 'Extensions: Install from VSIX'"
        Write-Step-Log "4. Select: $ReviewGateDir\review-gate-v2-2.7.3-cn.5.vsix"
        Write-Step-Log "5. Restart Cursor when prompted"
        Write-Host ""
        
        # Try to open Cursor if available
        $cursorExePaths = @(
            "${env:ProgramFiles}\Cursor\Cursor.exe",
            "${env:LOCALAPPDATA}\Programs\cursor\Cursor.exe",
            "${env:ProgramFiles(x86)}\Cursor\Cursor.exe"
        )
        
        $cursorFound = $false
        foreach ($path in $cursorExePaths) {
            if (Test-Path $path) {
                Write-Progress-Log "Opening Cursor IDE..."
                Start-Process $path -WorkingDirectory (Get-Location)
                $cursorFound = $true
                break
            }
        }
        
        if (-not $cursorFound) {
            Write-Info-Log "Please open Cursor IDE manually"
        }
    }
} else {
    Write-Error-Log "Extension file not found: $ExtensionFile"
    Write-Info-Log "Please ensure the extension is built in cursor-extension\ directory"
    Write-Info-Log "Or install manually from the Cursor Extensions marketplace"
}

# Install global rule (optional) - Windows-specific directory
$CursorRulesDir = Join-Path $env:APPDATA "Cursor\User\rules"
$ruleFile = Join-Path $ScriptDir "ReviewGate.mdc"
if (Test-Path $ruleFile) {
    Write-Progress-Log "Installing global rule..."
    New-Item -Path $CursorRulesDir -ItemType Directory -Force | Out-Null
    Copy-Item $ruleFile $CursorRulesDir -Force
    Write-Success-Log "Global rule installed to: $CursorRulesDir"
} elseif (Test-Path $ruleFile) {
    Write-Warning-Log "Could not determine Cursor rules directory"
    Write-Info-Log "Global rule available at: $ruleFile"
}

# Clean up any existing temp files
Write-Progress-Log "Cleaning up temporary files..."
$tempPath = [System.IO.Path]::GetTempPath()
Get-ChildItem $tempPath -Filter "review_gate_*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $tempPath -Filter "mcp_response*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Success-Log "Review Gate V2 Installation Complete!"
Write-Header-Log "======================================="
Write-Host ""
Write-Header-Log "Installation Summary:"
Write-Step-Log "   - MCP Server: $ReviewGateDir"
Write-Step-Log "   - MCP Config: $CursorMcpFile"
Write-Step-Log "   - Extension: $ReviewGateDir\review-gate-v2-2.7.3-cn.5.vsix"
Write-Step-Log "   - Global Rule: $CursorRulesDir\ReviewGate.mdc"
Write-Host ""
Write-Header-Log "Testing Your Installation:"
Write-Step-Log "1. Restart Cursor completely"
Write-Info-Log "2. Press Ctrl+Alt+G to test manual trigger"
Write-Info-Log "3. Or ask Cursor Agent: 'Use the review_gate_chat tool'"
Write-Host ""
Write-Header-Log "Speech-to-Text Features:"
Write-Step-Log "   - Click microphone icon in popup"
Write-Step-Log "   - Speak clearly for 2-3 seconds"
Write-Step-Log "   - Click stop to transcribe"
Write-Host ""
Write-Header-Log "Image Upload Features:"
Write-Step-Log "   - Click camera icon in popup"
Write-Step-Log "   - Select images (PNG, JPG, etc.)"
Write-Step-Log "   - Images are included in response"
Write-Host ""
Write-Header-Log "Troubleshooting:"
Write-Info-Log "   - Logs: Get-Content ([System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'review_gate_v2.log')) -Wait"
Write-Info-Log "   - Test FFmpeg: ffmpeg -version"
Write-Info-Log "   - Test SenseVoice: python -c 'from funasr import AutoModel; print(\"OK\")'"
Write-Info-Log "   - Browser Console: F12 in Cursor"
Write-Host ""
Write-Success-Log "Enjoy your voice-activated Review Gate!"

# Final verification
Write-Progress-Log "Final verification..."
$mcpServerFile = Join-Path $ReviewGateDir "review_gate_v2_mcp.py"
$venvDir = Join-Path $ReviewGateDir "venv"

if ((Test-Path $mcpServerFile) -and (Test-Path $CursorMcpFile) -and (Test-Path $venvDir)) {
    Write-Success-Log "All components installed successfully"
    exit 0
} else {
    Write-Error-Log "Some components may not have installed correctly"
    Write-Info-Log "Please check the installation manually"
    exit 1
}
