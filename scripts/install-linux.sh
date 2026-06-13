#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-linux.sh — Linux prerequisites for AWS Migration Architect
#
# Supports: Ubuntu/Debian (apt), RHEL/Fedora/Amazon Linux (dnf/yum), Arch (pacman)
# Installs: AWS CLI ≥ 2.15, Terraform ≥ 1.6, uv/uvx, Node.js ≥ 18, Claude Code
#
# Usage:
#   chmod +x scripts/install-linux.sh
#   ./scripts/install-linux.sh
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

# Detect package manager
detect_pkg_manager() {
  if command -v apt-get &>/dev/null; then echo "apt"
  elif command -v dnf &>/dev/null;   then echo "dnf"
  elif command -v yum &>/dev/null;   then echo "yum"
  elif command -v pacman &>/dev/null; then echo "pacman"
  else error "No supported package manager found (apt/dnf/yum/pacman)"; fi
}

pkg_install() {
  local PKG_MGR
  PKG_MGR=$(detect_pkg_manager)
  case "$PKG_MGR" in
    apt)    sudo apt-get install -y "$@" ;;
    dnf)    sudo dnf install -y "$@" ;;
    yum)    sudo yum install -y "$@" ;;
    pacman) sudo pacman -Sy --noconfirm "$@" ;;
  esac
}

ARCH=$(uname -m)
# Normalize architecture name for AWS CLI download
case "$ARCH" in
  x86_64)  AWS_ARCH="x86_64" ;;
  aarch64) AWS_ARCH="aarch64" ;;
  arm64)   AWS_ARCH="aarch64" ;;
  *)       error "Unsupported architecture: $ARCH" ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       AWS Migration Architect — Linux Installer          ║"
echo "╚══════════════════════════════════════════════════════════╝"
PKG_MGR=$(detect_pkg_manager)
echo "  Package manager : $PKG_MGR"
echo "  Architecture    : $ARCH"
echo ""

# ── System dependencies ───────────────────────────────────────────────────────
info "Updating package index and installing system dependencies..."
case "$PKG_MGR" in
  apt)
    sudo apt-get update -qq
    pkg_install curl unzip gnupg software-properties-common ca-certificates lsb-release
    ;;
  dnf|yum)
    pkg_install curl unzip gnupg2 ca-certificates
    ;;
  pacman)
    sudo pacman -Sy --noconfirm curl unzip gnupg
    ;;
esac

# ── 1. AWS CLI ────────────────────────────────────────────────────────────────
info "Checking AWS CLI..."
if command -v aws &>/dev/null; then
  AWS_VERSION=$(aws --version 2>&1 | awk '{print $1}' | cut -d/ -f2)
  require_version "AWS CLI" "$AWS_VERSION" "2.15.0"
else
  info "Installing AWS CLI v2 (official installer)..."
  TMP=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "$TMP/awscliv2.zip"
  unzip -q "$TMP/awscliv2.zip" -d "$TMP"
  sudo "$TMP/aws/install" --update
  rm -rf "$TMP"
  success "AWS CLI installed"
fi
success "AWS CLI: $(aws --version 2>&1 | head -1)"

# ── 2. Terraform ──────────────────────────────────────────────────────────────
info "Checking Terraform..."
if command -v terraform &>/dev/null; then
  TF_VERSION=$(terraform version -json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['terraform_version'])" 2>/dev/null \
               || terraform version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  require_version "Terraform" "$TF_VERSION" "1.6.0"
else
  info "Installing Terraform via HashiCorp repository..."
  case "$PKG_MGR" in
    apt)
      curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
      echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
        | sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null
      sudo apt-get update -qq
      pkg_install terraform
      ;;
    dnf|yum)
      sudo "$PKG_MGR" install -y yum-utils 2>/dev/null || true
      sudo "$PKG_MGR" config-manager --add-repo https://rpm.releases.hashicorp.com/RHEL/hashicorp.repo
      pkg_install terraform
      ;;
    pacman)
      # AUR: terraform — requires an AUR helper or manual build
      if command -v yay &>/dev/null; then
        yay -Sy --noconfirm terraform
      else
        warn "Install Terraform manually from https://developer.hashicorp.com/terraform/downloads"
        warn "Or install an AUR helper like 'yay' first"
      fi
      ;;
  esac
  success "Terraform installed"
fi
success "Terraform: $(terraform version | head -1)"

# ── 3. uv / uvx ──────────────────────────────────────────────────────────────
info "Checking uv (required to run awsiac + awspricing MCP servers)..."
if ! command -v uv &>/dev/null; then
  info "Installing uv via official installer..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Source the env update if installer modified shell profile
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
fi
success "uv: $(uv --version)"
success "uvx: $(uvx --version)"

# ── 4. Node.js ≥ 18 ───────────────────────────────────────────────────────────
info "Checking Node.js (required for Claude Code)..."
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  require_version "Node.js" "$NODE_VERSION" "18.0.0"
else
  info "Installing Node.js 22 LTS via NodeSource..."
  case "$PKG_MGR" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      pkg_install nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      pkg_install nodejs
      ;;
    pacman)
      pkg_install nodejs npm
      ;;
  esac
  success "Node.js installed"
fi
success "Node.js: $(node --version)"

# ── 5. Claude Code ────────────────────────────────────────────────────────────
info "Checking Claude Code..."
if ! command -v claude &>/dev/null; then
  info "Installing Claude Code via npm..."
  npm install -g @anthropic-ai/claude-code
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

# Remind user to reload PATH if uv was just installed
if ! command -v uv &>/dev/null 2>&1; then
  warn "Restart your shell or run: source \$HOME/.cargo/env"
  warn "to make 'uv' and 'uvx' available in your PATH."
fi
