#!/bin/bash

# TinySecret 重新載入腳本
# 此腳本會自動拉取最新代碼、更新依賴並重啟服務

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

# 檢查是否為 git 倉庫
is_git_repo() {
    git rev-parse --git-dir > /dev/null 2>&1
}

# 停止當前運行的服務
stop_service() {
    print_info "檢查是否有正在運行的服務..."
    
    # 查找運行中的 node server.js 進程
    if pgrep -f "node server.js" > /dev/null; then
        print_info "發現正在運行的服務，正在停止..."
        pkill -f "node server.js" || true
        sleep 2
        
        # 再次檢查是否已停止
        if pgrep -f "node server.js" > /dev/null; then
            print_warning "服務未能正常停止，嘗試強制停止..."
            pkill -9 -f "node server.js" || true
            sleep 1
        fi
        
        print_success "服務已停止"
    else
        print_info "沒有發現正在運行的服務"
    fi
}

# 拉取最新代碼
pull_latest_code() {
    print_info "拉取最新代碼..."
    
    if ! is_git_repo; then
        print_error "當前目錄不是 git 倉庫"
        exit 1
    fi
    
    # 檢查是否有未提交的更改
    if ! git diff-index --quiet HEAD --; then
        print_warning "檢測到未提交的更改"
        print_info "當前更改："
        git status --short
        echo ""
        read -p "是否要暫存當前更改並繼續？(y/N): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "暫存當前更改..."
            git stash
            STASHED=true
        else
            print_error "已取消操作"
            exit 1
        fi
    fi
    
    # 拉取最新代碼
    if git pull; then
        print_success "代碼更新完成"
        
        # 如果有暫存的更改，嘗試恢復
        if [ "$STASHED" = true ]; then
            print_info "嘗試恢復暫存的更改..."
            if git stash pop; then
                print_success "已恢復暫存的更改"
            else
                print_warning "恢復暫存的更改時發生衝突，請手動處理"
            fi
        fi
    else
        print_error "拉取代碼失敗"
        exit 1
    fi
}

# 更新依賴
update_dependencies() {
    print_info "檢查並更新依賴..."
    
    if [ ! -f "package.json" ]; then
        print_error "找不到 package.json 文件"
        exit 1
    fi
    
    # 檢查 package.json 或 package-lock.json 是否有變更
    if git diff HEAD@{1} HEAD -- package.json package-lock.json > /dev/null 2>&1; then
        print_info "檢測到依賴變更，重新安裝依賴..."
        if npm install; then
            print_success "依賴更新完成"
        else
            print_error "依賴安裝失敗"
            exit 1
        fi
    else
        print_info "依賴未變更，跳過安裝步驟"
    fi
}

# 啟動服務
start_service() {
    print_info "啟動服務器..."
    echo ""
    
    # 在後台啟動服務
    nohup npm start > /dev/null 2>&1 &
    SERVER_PID=$!
    
    # 等待一下確保服務啟動
    sleep 2
    
    # 檢查服務是否成功啟動
    if ps -p $SERVER_PID > /dev/null; then
        print_success "服務已啟動 (PID: $SERVER_PID)"
        print_info "服務運行在: http://localhost:10359"
        echo ""
        print_info "查看日誌: tail -f nohup.out"
        print_info "停止服務: kill $SERVER_PID 或執行 pkill -f 'node server.js'"
    else
        print_error "服務啟動失敗，請檢查錯誤訊息"
        if [ -f nohup.out ]; then
            print_info "最近的錯誤日誌："
            tail -20 nohup.out
        fi
        exit 1
    fi
}

# 主流程
main() {
    print_info "開始重新載入 TinySecret..."
    echo ""
    
    # 確保使用系統安裝的 node/npm，不使用 nvm
    # 清除可能的 nvm 環境變數（如果存在）
    unset NVM_DIR
    unset NVM_CD_FLAGS
    unset NVM_BIN
    unset NVM_INC
    
    # 確保 PATH 中優先使用系統安裝的 node/npm
    # 移除可能的 nvm 路徑
    export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$HOME/.nvm" | tr '\n' ':' | sed 's/:$//')
    
    # 檢查 Node.js 和 npm（確保使用系統安裝的版本）
    if ! command_exists node; then
        print_error "Node.js 未安裝，請先執行 ./install.sh"
        exit 1
    fi
    
    if ! command_exists npm; then
        print_error "npm 未安裝，請先執行 ./install.sh"
        exit 1
    fi
    
    # 驗證 node 和 npm 版本（確保是系統安裝的版本）
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    NODE_PATH=$(which node)
    print_info "使用 Node.js: $NODE_VERSION, npm: $NPM_VERSION"
    print_info "Node.js 路徑: $NODE_PATH"
    
    # 檢查是否在使用 nvm 管理的 node（如果是，給出警告）
    if echo "$NODE_PATH" | grep -q "\.nvm"; then
        print_warning "檢測到使用 nvm 管理的 Node.js"
        print_warning "建議使用系統安裝的 Node.js，請先執行 ./install.sh"
    fi
    
    # 檢查 git
    if ! command_exists git; then
        print_error "git 未安裝，請先安裝 git"
        exit 1
    fi
    
    # 執行步驟
    stop_service
    echo ""
    
    pull_latest_code
    echo ""
    
    update_dependencies
    echo ""
    
    start_service
    echo ""
    
    print_success "重新載入完成！"
}

# 執行主函數
main

