#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-mac.sh — macOS prerequisites for AWS Migration Architect
#
# Installs: Homebrew (if missing), AWS CLI ≥ 2.15, Terraform ≥ 1.6,
#           uv/uvx (for MCP servers), Node.js (if missing), Claude Code
#
# Usage:
#   chmod +x scripts/install-mac.sh
#   ./scripts/install-mac.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

require_version() {
  local name="$1" got="$2" want="$3"
  if printf '%s\n%s\n' "$want" "$got" | sort -V -C 2>/dev/null; then
    success "$name $got (>= $want required)"
  else
    error "$name $got is below the minimum required version $want"
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       AWS Migration Architect — macOS Installer          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Homebrew ───────────────────────────────────────────────────────────────
info "Checking Homebrew..."
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  success "Homebrew installed"
else
  success "Homebrew $(brew --version | head -1)"
fi

# ── 2. AWS CLI ────────────────────────────────────────────────────────────────
info "Checking AWS CLI..."
if ! command -v aws &>/dev/null; then
  info "Installing AWS CLI via Homebrew..."
  brew install awscli
else
  AWS_VERSION=$(aws --version 2>&1 | awk '{print $1}' | cut -d/ -f2)
  require_version "AWS CLI" "$AWS_VERSION" "2.15.0"
fi
success "AWS CLI: $(aws --version 2>&1 | head -1)"

# ── 3. Terraform ──────────────────────────────────────────────────────────────
info "Checking Terraform..."
if ! command -v terraform &>/dev/null; then
  info "Installing Terraform via Homebrew..."
  brew tap hashicorp/tap 2>/dev/null || true
  brew install hashicorp/tap/terraform
else
  TF_VERSION=$(terraform version -json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['terraform_version'])" 2>/dev/null \
               || terraform version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  require_version "Terraform" "$TF_VERSION" "1.6.0"
fi
success "Terraform: $(terraform version | head -1)"

# ── 4. uv / uvx ──────────────────────────────────────────────────────────────
info "Checking uv (required to run awsiac + awspricing MCP servers)..."
if ! command -v uv &>/dev/null; then
  info "Installing uv via Homebrew..."
  brew install uv
fi
success "uv: $(uv --version)"
success "uvx: $(uvx --version)"

# ── 5. Node.js (for Claude Code) ──────────────────────────────────────────────
info "Checking Node.js (required for Claude Code)..."
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via Homebrew..."
  brew install node
fi
NODE_VERSION=$(node --version | sed 's/v//')
require_version "Node.js" "$NODE_VERSION" "18.0.0"
success "Node.js: $(node --version)"

# ── 6. Claude Code ────────────────────────────────────────────────────────────
info "Checking Claude Code..."
if ! command -v claude &>/dev/null; then
  info "Installing Claude Code via npm..."
  npm install -g @anthropic-ai/claude-code
else
  success "Claude Code: $(claude --version 2>/dev/null || echo 'installed')"
fi
success "Claude Code ready"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  All tools installed!                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Configure your two AWS profiles:"
echo "       aws configure sso --profile migration-source"
echo "       aws configure sso --profile migration-target"
echo ""
echo "  2. Log in and export env vars:"
echo "       aws sso login --profile migration-source"
echo "       aws sso login --profile migration-target"
echo "       export MIGRATION_SOURCE_PROFILE=migration-source"
echo "       export MIGRATION_TARGET_PROFILE=migration-target"
echo ""
echo "  3. Install the plugin inside Claude Code:"
echo "       /plugin install aws-migration-architect"
echo ""
echo "  4. Run the migration:"
echo "       /aws-migration-architect:migrate"
echo ""
