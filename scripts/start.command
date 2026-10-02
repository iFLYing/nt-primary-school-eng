#!/bin/bash
# 英语单词闯关营 - 启动脚本 (macOS)
cd "$(dirname "$0")"
echo "========================================"
echo "  正在启动 英语单词闯关营..."
echo "========================================"

# 优先使用包内自带 Node，其次系统 Node
if [ -x "$(pwd)/node/bin/node" ]; then
  NODE_BIN="$(pwd)/node/bin/node"
  echo "使用包内 Node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
  echo "使用系统 Node"
else
  echo "未找到 Node 运行时，请安装 Node.js 或下载完整版包。"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

"$NODE_BIN" "$(pwd)/server/server.js"

read -n 1 -s -r -p "服务已关闭，按任意键退出..."
