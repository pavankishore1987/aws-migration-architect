# ─────────────────────────────────────────────────────────────────────────────
# install-windows.ps1 — Windows prerequisites for AWS Migration Architect
#
# Installs: Winget packages (AWS CLI, Terraform, Node.js), uv/uvx, Claude Code
# Requires: Windows 10 1709+ or Windows 11, PowerShell 5.1+, winget
#
# Usage (run as Administrator or allow UAC prompts):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\install-windows.ps1
# ─────────────────────────────────────────────────────────────────────────────

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

function Test-CommandExists {
    param([string]$cmd)
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Compare-SemVer {
    # Returns $true if $got >= $want
    param([string]$got, [string]$want)
    $g = [version]($got -replace '[^0-9.]')
    $w = [version]($want -replace '[^0-9.]')
    return $g -ge $w
}

function Install-WithWinget {
    param([string]$id, [string]$name)
    Write-Info "Installing $name via winget..."
    winget install --id $id --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "$name installation failed. Install manually from the vendor website."
    }
}

# Refresh PATH in current session after installs
function Update-SessionPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ── Header ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║      AWS Migration Architect — Windows Installer         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Check winget ──────────────────────────────────────────────────────────────
Write-Info "Checking winget (Windows Package Manager)..."
if (-not (Test-CommandExists "winget")) {
    Write-Fail @"
winget not found.
Install it from: https://aka.ms/getwinget
(Requires Windows 10 1709+ or Windows 11 — usually pre-installed on modern Windows)
"@
}
Write-Success "winget $(winget --version)"

# ── 1. AWS CLI ────────────────────────────────────────────────────────────────
Write-Info "Checking AWS CLI..."
if (Test-CommandExists "aws") {
    $awsVer = (aws --version 2>&1) -replace "aws-cli/(\S+).*",'$1'
    if (Compare-SemVer $awsVer "2.15.0") {
        Write-Success "AWS CLI $awsVer (>= 2.15.0 required)"
    } else {
        Write-Warn "AWS CLI $awsVer is below 2.15.0 — upgrading..."
        Install-WithWinget "Amazon.AWSCLI" "AWS CLI"
    }
} else {
    Install-WithWinget "Amazon.AWSCLI" "AWS CLI"
}
Update-SessionPath
Write-Success "AWS CLI: $((aws --version 2>&1) | Select-Object -First 1)"

# ── 2. Terraform ──────────────────────────────────────────────────────────────
Write-Info "Checking Terraform..."
if (Test-CommandExists "terraform") {
    $tfVer = (terraform version -json 2>$null | ConvertFrom-Json).terraform_version
    if ($null -eq $tfVer) {
        $tfVer = (terraform version | Select-Object -First 1) -replace "Terraform v",""
    }
    if (Compare-SemVer $tfVer "1.6.0") {
        Write-Success "Terraform $tfVer (>= 1.6.0 required)"
    } else {
        Write-Warn "Terraform $tfVer is below 1.6.0 — upgrading..."
        Install-WithWinget "Hashicorp.Terraform" "Terraform"
    }
} else {
    Install-WithWinget "Hashicorp.Terraform" "Terraform"
}
Update-SessionPath
Write-Success "Terraform: $((terraform version | Select-Object -First 1))"

# ── 3. uv / uvx ──────────────────────────────────────────────────────────────
Write-Info "Checking uv (required to run awsiac + awspricing MCP servers)..."
if (-not (Test-CommandExists "uv")) {
    Write-Info "Installing uv via official Windows installer..."
    $uvInstaller = "$env:TEMP\uv-installer.ps1"
    Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -OutFile $uvInstaller
    & powershell -ExecutionPolicy Bypass -File $uvInstaller
    Remove-Item $uvInstaller -Force

    # Add uv to current session PATH
    $uvPath = "$env:USERPROFILE\.cargo\bin"
    if (Test-Path $uvPath) {
        $env:Path += ";$uvPath"
    }
    $uvPath2 = "$env:USERPROFILE\.local\bin"
    if (Test-Path $uvPath2) {
        $env:Path += ";$uvPath2"
    }
    Update-SessionPath
}
if (Test-CommandExists "uv") {
    Write-Success "uv: $(uv --version)"
    Write-Success "uvx: $(uvx --version)"
} else {
    Write-Warn "uv installed but not yet on PATH. Restart PowerShell and re-run if needed."
}

# ── 4. Node.js ≥ 18 ───────────────────────────────────────────────────────────
Write-Info "Checking Node.js (required for Claude Code)..."
if (Test-CommandExists "node") {
    $nodeVer = (node --version) -replace "v",""
    if (Compare-SemVer $nodeVer "18.0.0") {
        Write-Success "Node.js $nodeVer (>= 18.0.0 required)"
    } else {
        Write-Warn "Node.js $nodeVer is below 18.0.0 — upgrading..."
        Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
        Update-SessionPath
    }
} else {
    Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    Update-SessionPath
}
Write-Success "Node.js: $(node --version)"
Write-Success "npm: $(npm --version)"

# ── 5. Claude Code ────────────────────────────────────────────────────────────
Write-Info "Checking Claude Code..."
if (-not (Test-CommandExists "claude")) {
    Write-Info "Installing Claude Code via npm..."
    npm install -g @anthropic-ai/claude-code
    Update-SessionPath
}
Write-Success "Claude Code ready"

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  All tools installed!                    ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Configure your two AWS profiles:"
Write-Host "       aws configure sso --profile migration-source"
Write-Host "       aws configure sso --profile migration-target"
Write-Host ""
Write-Host "  2. Log in and set env vars:"
Write-Host "       aws sso login --profile migration-source"
Write-Host "       aws sso login --profile migration-target"
Write-Host "       `$env:MIGRATION_SOURCE_PROFILE = 'migration-source'"
Write-Host "       `$env:MIGRATION_TARGET_PROFILE = 'migration-target'"
Write-Host ""
Write-Host "  3. (Persistent) To set env vars permanently:"
Write-Host "       [System.Environment]::SetEnvironmentVariable('MIGRATION_SOURCE_PROFILE','migration-source','User')"
Write-Host "       [System.Environment]::SetEnvironmentVariable('MIGRATION_TARGET_PROFILE','migration-target','User')"
Write-Host ""
Write-Host "  4. Install the plugin inside Claude Code:"
Write-Host "       /plugin install aws-migration-architect"
Write-Host ""
Write-Host "  5. Run the migration:"
Write-Host "       /aws-migration-architect:migrate"
Write-Host ""
Write-Host "NOTE: If any tool is not found after install, restart PowerShell" -ForegroundColor Yellow
Write-Host "      to pick up the updated PATH." -ForegroundColor Yellow
Write-Host ""
