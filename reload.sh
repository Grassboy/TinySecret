#!/bin/bash

# reload.sh - 重新載入最新代碼並啟動服務

set -e

echo "=== 重新載入 TinySecret ==="
echo ""

# 一、git pull
echo "1. 從 Git 拉取最新代碼..."
git pull
echo ""

# 二、執行 install.sh
echo "2. 執行 install.sh..."
bash install.sh

echo ""
echo "=== 重新載入完成 ==="
