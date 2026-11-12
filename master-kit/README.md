# Bomi智绘 黄金母版3.0

这个资产包保存 Bomi智绘工作台已经验证过的完整工作流：共享趋势与素材库、系列生成、区域改款、爆款裂变、成片版本、白底图、任务并发、失败续做、MCP 对话入口和 ZIP 交付。

包内只有程序、插件、提示词和测试，不包含任何项目数据库、上传文件、生成图片、日志、账号凭据或本机路径。把 ZIP 移到另一台电脑后，可以恢复一套干净的 Bomi智绘，也可以创建一个名称和端口独立的新工作台。

## 环境要求

- macOS、Windows 或 Linux
- Node.js 20.9 或更高版本
- 安装包会自动安装锁定的本机 AI 运行组件
- 首次安装依赖时可访问 npm 软件源

以上要求适用于源码母版安装。已经构建好的 Bomi智绘 DMG、Windows 安装程序或 AppImage 会内置运行环境，不需要用户单独安装 Node.js。

## 在另一台电脑恢复 Bomi智绘

1. 解压 `bomi-golden-master-3.0.zip`。
2. macOS 双击 `install.command`，Windows 双击 `install.cmd`。
3. 也可在终端手动执行：

```sh
node master-kit/scripts/bootstrap.mjs
```

安装器会依次检查环境、安装锁定依赖与 AI 运行组件、运行单元测试、构建正式前端并安装智能组件。双击安装时会自动打开；手动安装完成后执行：

```sh
npm run open
```

正式服务为 `http://127.0.0.1:4174/`。首次打开显示 Bomi智绘启动页，帐号与 API 授权在设置中管理。Chat 模式已内置多轮对话、参考图生成和趋势资料分析。

如果只想先验证网页，不安装智能组件：

```sh
node master-kit/scripts/bootstrap.mjs --skip-plugin
```

完整浏览器验收会额外安装 Playwright Chromium：

```sh
node master-kit/scripts/bootstrap.mjs --full
```

在对应操作系统上生成免 Node.js 的桌面安装包：

```sh
# macOS DMG
npm run desktop:dist

# Windows NSIS 安装程序（在 Windows 上执行）
npm run desktop:dist:win
```

桌面应用把项目、上传文件和生成结果保存在系统应用数据目录，升级或替换应用本体不会覆盖这些数据。未签名的本地 macOS 构建首次打开时可能需要在 Finder 中右键选择“打开”。

## 创建一个独立的新工作台

先复制配置模板并修改名称、插件 ID 和端口：

```sh
cp master-kit/project.config.example.json my-workbench.json
```

然后执行：

```sh
node master-kit/scripts/create-workbench.mjs /绝对路径/我的新工作台 --config my-workbench.json
```

Windows 示例：

```powershell
node master-kit/scripts/create-workbench.mjs "D:\\Workbenches\\my-fashion-studio" --config my-workbench.json
```

初始化器会复制工作流内核，更新产品名、插件 ID、MCP 名称和前后端端口，并保持内部数据模型、任务状态机、版本保护和测试合同。进入新目录后运行 `node master-kit/scripts/bootstrap.mjs` 完成安装。

## 母版结构

- `src/`：正式 React 工作台界面。
- `server/`：文件仓库、任务状态机、并发执行器、HTTP 与 MCP。
- `plugins/<plugin-id>/`：智能组件清单和工作流技能。
- `tests/`：工作流合同测试和浏览器验收。
- `master-kit/AI-REPLICATION-PROMPT.md`：交给 AI 的复刻约束。
- `master-kit/project.config.example.json`：新工作台配置模板。
- `scripts/install-plugin.js`：自动适配当前电脑路径的插件安装器。
- `GOLDEN-TEMPLATE.json`：黄金母版名称、版本与 Git 标记。

## 数据迁移

干净母版不会携带业务数据。需要把原电脑上的项目、上传文件和成片一起迁移时，在关闭工作台服务后单独复制原项目目录中的 `.badmark/` 到新电脑对应工作台根目录。恢复前保留新电脑现有 `.badmark/` 备份。

同一台电脑同时运行多个派生工作台时，每个项目必须使用不同的 `frontendPort`、`backendPort` 和 `pluginId`。

## 更新和再打包

在母版源码中完成修改并通过验收后执行：

```sh
npm run check
npm run master:package
npm run master:verify
```

新的发布目录和 ZIP 会生成到 `releases/`。每次业务改动都应同步测试并创建独立 Git commit。
