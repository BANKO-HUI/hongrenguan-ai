#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '安装红人馆AI需要 Node.js 20.9 或更高版本。'
  printf '%s\n' '请先从 https://nodejs.org/ 安装 Node.js，再双击本文件。'
  printf '\n按回车键关闭…'
  read -r _
  exit 1
fi

node master-kit/scripts/bootstrap.mjs
node scripts/launch.js
printf '\n红人馆AI已安装并打开。按回车键关闭本窗口…'
read -r _
