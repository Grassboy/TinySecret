#!/bin/bash

# TinySecret 安裝腳本
# 此腳本會自動檢查並安裝 Node.js/npm（如需要），然後安裝依賴並啟動服務

set -e  # 遇到錯誤立即退出

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印帶顏色的訊息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 檢查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 檢查 Node.js 是否安裝
check_node() {
    if command_exists node; then
        NODE_VERSION=$(node --version)
        print_success "Node.js 已安裝: $NODE_VERSION"
        
        # 檢查版本是否 >= 14（建議最低版本）
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_MAJOR" -lt 14 ]; then
            print_warning "Node.js 版本過舊 ($NODE_VERSION)，建議升級到 14 或更高版本"
        fi
        return 0
    else
        return 1
    fi
}

# 檢查 npm 是否安裝
check_npm() {
    if command_exists npm; then
        NPM_VERSION=$(npm --version)
        print_success "npm 已安裝: $NPM_VERSION"
        return 0
    else
        return 1
    fi
}

# 安裝 Node.js 和 npm（使用 nvm）
install_node_with_nvm() {
    print_info "嘗試使用 nvm 安裝 Node.js..."
    
    # 檢查 nvm 是否已安裝
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        print_info "載入 nvm..."
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        
        if command_exists nvm; then
            print_info "使用 nvm 安裝 Node.js LTS 版本..."
            nvm install --lts
            nvm use --lts
            nvm alias default node
            return 0
        fi
    fi
    
    # 如果 nvm 未安裝，嘗試安裝 nvm
    print_info "nvm 未安裝，嘗試安裝 nvm..."
    
    if command_exists curl; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        
        if command_exists nvm; then
            print_info "使用 nvm 安裝 Node.js LTS 版本..."
            nvm install --lts
            nvm use --lts
            nvm alias default node
            return 0
        fi
    elif command_exists wget; then
        wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        
        if command_exists nvm; then
            print_info "使用 nvm 安裝 Node.js LTS 版本..."
            nvm install --lts
            nvm use --lts
            nvm alias default node
            return 0
        fi
    fi
    
    return 1
}

# 使用系統套件管理器安裝 Node.js
install_node_with_package_manager() {
    print_info "嘗試使用系統套件管理器安裝 Node.js..."
    
    if command_exists apt-get; then
        # Debian/Ubuntu
        print_info "檢測到 apt-get，使用 apt 安裝 Node.js..."
        sudo apt-get update
        sudo apt-get install -y nodejs npm
        return 0
    elif command_exists yum; then
        # CentOS/RHEL
        print_info "檢測到 yum，使用 yum 安裝 Node.js..."
        sudo yum install -y nodejs npm
        return 0
    elif command_exists dnf; then
        # Fedora
        print_info "檢測到 dnf，使用 dnf 安裝 Node.js..."
        sudo dnf install -y nodejs npm
        return 0
    elif command_exists brew; then
        # macOS
        print_info "檢測到 Homebrew，使用 brew 安裝 Node.js..."
        brew install node
        return 0
    fi
    
    return 1
}

# 主安裝流程
main() {
    print_info "開始安裝 TinySecret..."
    echo ""
    
    # 檢查 Node.js
    if ! check_node; then
        print_warning "Node.js 未安裝，開始安裝..."
        echo ""
        
        # 優先嘗試使用 nvm 安裝
        if install_node_with_nvm; then
            print_success "使用 nvm 成功安裝 Node.js"
        # 如果 nvm 失敗，嘗試使用系統套件管理器
        elif install_node_with_package_manager; then
            print_success "使用系統套件管理器成功安裝 Node.js"
        else
            print_error "無法自動安裝 Node.js"
            echo ""
            print_info "請手動安裝 Node.js："
            echo "  1. 訪問 https://nodejs.org/ 下載並安裝"
            echo "  2. 或使用 nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
            echo ""
            exit 1
        fi
        
        # 重新檢查
        if ! check_node; then
            print_error "Node.js 安裝失敗，請手動安裝後重新執行此腳本"
            exit 1
        fi
    fi
    
    # 檢查 npm
    if ! check_npm; then
        print_error "npm 未安裝，這通常不應該發生（npm 應該隨 Node.js 一起安裝）"
        print_info "請手動安裝 npm 或重新安裝 Node.js"
        exit 1
    fi
    
    echo ""
    print_info "開始安裝專案依賴..."
    
    # 安裝依賴
    if npm install; then
        print_success "依賴安裝完成"
    else
        print_error "依賴安裝失敗"
        exit 1
    fi
    
    echo ""
    print_success "安裝完成！"
    echo ""
    print_info "啟動服務器..."
    echo ""
    
    # 啟動服務器
    npm start
}

# 執行主函數
main

