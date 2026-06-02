import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

const APP = "codex-feishu-imui"
const SUPPORTED = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-arm64", "bun-linux-x64"] as const

type Target = (typeof SUPPORTED)[number]

type BuildArgs = {
  targets: Target[]
  outdir: string
}

type BuildResult = {
  version: string
  outdir: string
  targets: Target[]
  artifacts: string[]
}

function fail(msg: string): never {
  throw new Error(msg)
}

export function currentTarget(platform = process.platform, arch = process.arch): Target {
  if (platform === "darwin" && arch === "arm64") return "bun-darwin-arm64"
  if (platform === "darwin" && arch === "x64") return "bun-darwin-x64"
  if (platform === "linux" && arch === "arm64") return "bun-linux-arm64"
  if (platform === "linux" && arch === "x64") return "bun-linux-x64"
  return fail(`unsupported build host: ${platform}/${arch}`)
}

export function archiveBase(version: string, target: Target) {
  return `${APP}-${version}-${target}`
}

export function parseArgs(argv = process.argv): BuildArgs {
  const args = argv.slice(2)
  const targets: Target[] = []
  let outdir = path.join("dist", "release")

  for (let i = 0; i < args.length; i++) {
    const item = args[i]
    if (!item) continue
    if (item === "--target") {
      const val = args[++i]
      if (!val || !SUPPORTED.includes(val as Target)) fail(`unsupported target: ${val ?? "<missing>"}`)
      targets.push(val as Target)
      continue
    }
    if (item.startsWith("--target=")) {
      const val = item.slice("--target=".length)
      if (!SUPPORTED.includes(val as Target)) fail(`unsupported target: ${val}`)
      targets.push(val as Target)
      continue
    }
    if (item === "--outdir") {
      const val = args[++i]
      if (!val) fail("missing value for --outdir")
      outdir = val
      continue
    }
    if (item.startsWith("--outdir=")) {
      outdir = item.slice("--outdir=".length)
      continue
    }
    fail(`unknown option: ${item}`)
  }

  return {
    targets: targets.length > 0 ? targets : [currentTarget()],
    outdir,
  }
}

export function renderInstalledEnvExample(source: string) {
  return [
    "# Installed config template for Codex Feishu IMUI",
    "# install.sh 会把 __DATA_DIR__ 替换成当前机器上的实际数据目录。",
    "# 如需临时指定其他配置文件，可用：codex-feishu-imui --env-file /path/to/.env",
    "",
    source
      .replace(/^IMUI_DB_PATH=.*$/m, "IMUI_DB_PATH=__DATA_DIR__/imui.db")
      .replace(/^IMUI_DATA_DIR=.*$/m, "IMUI_DATA_DIR=__DATA_DIR__"),
  ].join("\n")
}

export function renderPackageReadme(version: string, target: Target) {
  return [
    `# ${APP} ${version}`,
    "",
    `Target: ${target}`,
    "",
    "这是面向最终安装用户的说明文档。解压安装包后，也可以直接阅读本目录下的 `README.md`。",
    "",
    "## 1. 前置依赖",
    "",
    "需要先准备：",
    "",
    "- Codex CLI：本服务会在本机自动启动 `codex app-server --stdio`，用于驱动 Codex。",
    "- 飞书/Lark 自建应用：需要机器人能力、长连接事件订阅和必要权限。",
    "- 建议安装 [larksuite/cli](https://github.com/larksuite/cli)：用于检查飞书登录态、调试 IM/文档/云空间权限、排查 scope 和 OpenAPI 调用问题。",
    "",
    "安装 lark-cli 的推荐方式：",
    "",
    "```bash",
    "npx @larksuite/cli@latest install",
    "```",
    "",
    "如需让 AI Agent 也能直接操作飞书，建议同时安装 lark-cli skills：",
    "",
    "```bash",
    "npx skills add larksuite/cli -y -g",
    "```",
    "",
    "## 2. 安装 IMUI",
    "",
    "在解压后的安装包目录执行：",
    "",
    "```bash",
    "./install.sh",
    "```",
    "",
    "默认安装位置：",
    "",
    "- 启动入口：`~/.local/bin/codex-feishu-imui`",
    "- 服务助手：`~/.local/bin/codex-feishu-imui-service`",
    "- 真实二进制：`~/.local/lib/codex-feishu-imui/codex-feishu-imui`",
    "- 配置文件：`~/.config/codex-feishu-imui/.env`",
    "- 数据目录：`~/.local/share/codex-feishu-imui`",
    "",
    "可以用环境变量覆盖安装位置：",
    "",
    "```bash",
    "PREFIX=/opt/codex-feishu-imui ./install.sh",
    "CONFIG_DIR=/path/to/config DATA_DIR=/path/to/data ./install.sh",
    "```",
    "",
    "## 3. 配置",
    "",
    "安装后请编辑：",
    "",
    "```bash",
    "$EDITOR ~/.config/codex-feishu-imui/.env",
    "```",
    "",
    "最小可运行配置示例：",
    "",
    "```env",
    "LOG_LEVEL=info",
    "FEISHU_MODE=long_conn",
    "FEISHU_APP_ID=cli_xxx",
    "FEISHU_APP_SECRET=xxx",
    "FEISHU_BOT_OPEN_ID=ou_xxx",
    "CODEX_DIRECTORY=/absolute/path/to/your/working-directory",
    "CODEX_WORKSPACE=",
    "CODEX_MODEL=openai/gpt-5.4",
    "```",
    "",
    "配置说明：",
    "",
    "- `FEISHU_MODE=long_conn`：使用飞书长连接接收消息。",
    "- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`：飞书开放平台应用凭证，不要提交到 Git。",
    "- `FEISHU_BOT_OPEN_ID`：推荐配置，群聊首条消息 `@bot` 判断会更稳定。",
    "- `CODEX_DIRECTORY`：Codex 默认工作目录，建议使用绝对路径，不要求一定是 Git worktree。",
    "- `CODEX_MODEL`：默认模型，格式为 `[<provider>/]<model_id>[@<variant>]`。",
    "- `CODEX_WORKSPACE`：可选；需要远端 workspace 时再填，本地项目通常留空。",
    "- `CODEX_BASE_URL` / `CODEX_USERNAME` / `CODEX_PASSWORD`：兼容旧配置保留，当前 app-server stdio 模式通常不需要。",
    "",
    "## 4. 飞书应用检查",
    "",
    "在飞书开放平台确认：",
    "",
    "- 应用已开启机器人能力。",
    "- 事件订阅方式为“使用长连接接收事件”。",
    "- 已订阅 `im.message.receive_v1`。",
    "- 已授权消息接收、发送、附件读取、卡片交互等本服务需要的 scopes。",
    "- 修改权限或事件订阅后，记得发布/生效应用版本。",
    "",
    "可以用 lark-cli 辅助排查飞书侧问题，例如验证登录、查看 IM 能力或测试 OpenAPI。",
    "",
    "## 5. 启动",
    "",
    "确认 `codex` 命令在 PATH 中可用后，直接启动：",
    "",
    "```bash",
    "codex-feishu-imui",
    "```",
    "",
    "查看帮助：",
    "",
    "```bash",
    "codex-feishu-imui --help",
    "```",
    "",
    "也可以临时指定其他配置文件：",
    "",
    "```bash",
    "codex-feishu-imui --env-file /path/to/.env",
    "```",
    "",
    "启动成功后，服务会连接飞书长连接，并为每个 Codex 会话通过本机 `codex app-server --stdio` 与 Codex 通信。",
    "",
    "## 6. 长期运行（可选）",
    "",
    "安装后可使用服务助手：",
    "",
    "```bash",
    "codex-feishu-imui-service install",
    "codex-feishu-imui-service uninstall",
    "```",
    "",
    "说明：",
    "",
    "- macOS 默认生成 launchd 用户服务。",
    "- Linux 默认生成 systemd --user 服务。",
    "- 默认日志目录：`~/.local/share/codex-feishu-imui/log`。",
    "",
    "## 7. 飞书内常用命令",
    "",
    "- `/help`：查看帮助。",
    "- `/status`：查看当前会话和连接状态。",
    "- `/new`：新建 Codex 会话。",
    "- `/abort`：取消当前执行。",
    "- `/repo`：查看或设置默认工作目录/workspace。",
    "- `/sessions`：列出最近会话。",
    "- `/workspaces`：列出 workspace。",
    "- `/model`：查看或切换当前模型。",
    "- `/models`：列出可用模型。",
    "",
    "`/models` 在 provider 信息暴露 variants 时，会在对应 model 后显示 `[variants: ...]`；只有本次展示结果里存在 variants 时，末尾才会出现切换说明。",
    "",
    "`/model` 无参数时会说明：当 provider 暴露 variants 时，可在 `/models` 查看这些 variants；切换时使用 `/model <provider>/<model_id>@<variant>`，清除当前 variant 则直接使用 `/model <provider>/<model_id>`。",
    "",
    "## 8. 常见问题",
    "",
    "- 收不到飞书消息：检查长连接订阅、应用发布状态、机器人是否进群、`FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否正确。",
    "- 群聊首条 @bot 不稳定：补充 `FEISHU_BOT_OPEN_ID`。",
    "- Codex 无响应：确认 `codex` 命令可执行，且本机 Codex 已完成登录/配置。",
    "- 图片或文件不可用：检查附件读取权限、数据目录写权限和缓存目录容量。",
    "- 卡片更新失败：检查卡片相关权限，必要时用 lark-cli 或飞书开放平台日志排查接口错误。",
  ].join("\n")
}

export function renderServiceReadme() {
  return [
    "# Service Helper",
    "",
    "安装完成后，可以使用：",
    "",
    "```bash",
    "codex-feishu-imui-service install",
    "codex-feishu-imui-service uninstall",
    "```",
    "",
    "说明：",
    "",
    "- macOS 默认管理 launchd 用户服务",
    "- Linux 默认管理 systemd --user 服务",
    "- 助手会复用安装时记录的 PREFIX / CONFIG_DIR / DATA_DIR",
    "- 如需覆盖，也可以在执行时临时传入同名环境变量",
  ].join("\n")
}

export function renderServiceHelperScript() {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    `APP="${APP}"`,
    'BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'PREFIX=$(CDPATH= cd -- "$BIN_DIR/.." && pwd)',
    'LIB_DIR="$PREFIX/lib/$APP"',
    'INSTALL_ENV="$LIB_DIR/install.env"',
    'if [ -f "$INSTALL_ENV" ]; then',
    '  . "$INSTALL_ENV"',
    "fi",
    'CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"',
    'CONFIG_DIR="${CONFIG_DIR:-$CONFIG_BASE/$APP}"',
    'DATA_DIR="${DATA_DIR:-$DATA_BASE/$APP}"',
    'LOG_DIR="$DATA_DIR/log"',
    'APP_BIN="$BIN_DIR/$APP"',
    'DRY_RUN="${IMUI_SERVICE_DRY_RUN:-0}"',
    'cmd="${1:-}"',
    'manager="${2:-}"',
    "",
    'if [ -z "$manager" ]; then',
    '  case "$(uname -s)" in',
    '    Darwin) manager="launchd" ;;',
    '    Linux) manager="systemd" ;;',
    '    *) echo "unsupported platform; please specify launchd or systemd" >&2; exit 1 ;;',
    "  esac",
    "fi",
    "",
    'launchd_file="$HOME/Library/LaunchAgents/com.$APP.plist"',
    'systemd_dir="$HOME/.config/systemd/user"',
    'systemd_file="$systemd_dir/$APP.service"',
    "",
    "install_launchd() {",
    '  mkdir -p "$(dirname "$launchd_file")" "$LOG_DIR"',
    '  cat > "$launchd_file" <<EOF',
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>com.codex-feishu-imui</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>' + '$APP_BIN' + '</string>',
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>WorkingDirectory</key>',
    '  <string>' + '$DATA_DIR' + '</string>',
    '  <key>StandardOutPath</key>',
    '  <string>' + '$LOG_DIR/stdout.log' + '</string>',
    '  <key>StandardErrorPath</key>',
    '  <string>' + '$LOG_DIR/stderr.log' + '</string>',
    '</dict>',
    '</plist>',
    'EOF',
    '  if [ "$DRY_RUN" != "1" ]; then',
    '    launchctl bootout "gui/$(id -u)" "$launchd_file" >/dev/null 2>&1 || launchctl unload "$launchd_file" >/dev/null 2>&1 || true',
    '    launchctl bootstrap "gui/$(id -u)" "$launchd_file" >/dev/null 2>&1 || launchctl load "$launchd_file"',
    "  fi",
    '  echo "Installed launchd user service: $launchd_file"',
    '  echo "Logs: $LOG_DIR"',
    "}",
    "",
    "uninstall_launchd() {",
    '  if [ "$DRY_RUN" != "1" ]; then',
    '    launchctl bootout "gui/$(id -u)" "$launchd_file" >/dev/null 2>&1 || launchctl unload "$launchd_file" >/dev/null 2>&1 || true',
    "  fi",
    '  rm -f "$launchd_file"',
    '  echo "Removed launchd user service: $launchd_file"',
    "}",
    "",
    "install_systemd() {",
    '  mkdir -p "$systemd_dir" "$LOG_DIR"',
    '  cat > "$systemd_file" <<EOF',
    '[Unit]',
    'Description=Codex Feishu IMUI',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'ExecStart=' + '$APP_BIN',
    'WorkingDirectory=' + '$DATA_DIR',
    'Restart=always',
    'RestartSec=3',
    'Environment=HOME=' + '$HOME',
    '',
    '[Install]',
    'WantedBy=default.target',
    'EOF',
    '  if [ "$DRY_RUN" != "1" ]; then',
    '    systemctl --user daemon-reload',
    '    systemctl --user enable --now "$APP.service"',
    "  fi",
    '  echo "Installed systemd user service: $systemd_file"',
    '  echo "Hint: if the service should survive logout, enable lingering for this user."',
    "}",
    "",
    "uninstall_systemd() {",
    '  if [ "$DRY_RUN" != "1" ]; then',
    '    systemctl --user disable --now "$APP.service" >/dev/null 2>&1 || true',
    "  fi",
    '  rm -f "$systemd_file"',
    '  if [ "$DRY_RUN" != "1" ]; then',
    '    systemctl --user daemon-reload >/dev/null 2>&1 || true',
    "  fi",
    '  echo "Removed systemd user service: $systemd_file"',
    "}",
    "",
    'case "$cmd" in',
    '  install)',
    '    case "$manager" in',
    '      launchd) install_launchd ;;',
    '      systemd) install_systemd ;;',
    '      *) echo "unknown service manager: $manager" >&2; exit 1 ;;',
    '    esac',
    '    ;;',
    '  uninstall)',
    '    case "$manager" in',
    '      launchd) uninstall_launchd ;;',
    '      systemd) uninstall_systemd ;;',
    '      *) echo "unknown service manager: $manager" >&2; exit 1 ;;',
    '    esac',
    '    ;;',
    '  *)',
    '    echo "usage: $APP-service <install|uninstall> [launchd|systemd]" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    "",
  ].join("\n")
}

export function renderInstallScript(version: string) {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    `APP="${APP}"`,
    `VERSION="${version}"`,
    'ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'PREFIX="${PREFIX:-$HOME/.local}"',
    'BIN_DIR="$PREFIX/bin"',
    'LIB_DIR="$PREFIX/lib/$APP"',
    'SHARE_DIR="$PREFIX/share/$APP"',
    'CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"',
    'CONFIG_DIR="${CONFIG_DIR:-$CONFIG_BASE/$APP}"',
    'DATA_DIR="${DATA_DIR:-$DATA_BASE/$APP}"',
    "",
    'mkdir -p "$BIN_DIR" "$LIB_DIR" "$SHARE_DIR" "$CONFIG_DIR" "$DATA_DIR"',
    'cp "$ROOT/bin/$APP" "$LIB_DIR/$APP"',
    'chmod +x "$LIB_DIR/$APP"',
    'cp "$ROOT/share/README-package.md" "$SHARE_DIR/README.md"',
    'cp "$ROOT/share/README-service.md" "$SHARE_DIR/README-service.md"',
    'cp "$ROOT/share/service-helper.sh" "$LIB_DIR/service-helper.sh"',
    'chmod +x "$LIB_DIR/service-helper.sh"',
    'sed "s#__DATA_DIR__#$DATA_DIR#g" "$ROOT/share/$APP.env.example" > "$CONFIG_DIR/.env.example"',
    'if [ ! -f "$CONFIG_DIR/.env" ]; then',
    '  cp "$CONFIG_DIR/.env.example" "$CONFIG_DIR/.env"',
    "fi",
    'cat > "$LIB_DIR/install.env" <<EOF',
    'PREFIX=$PREFIX',
    'CONFIG_DIR=$CONFIG_DIR',
    'DATA_DIR=$DATA_DIR',
    'EOF',
    "cat > \"$BIN_DIR/$APP\" <<'EOF'",
    "#!/usr/bin/env sh",
    "set -eu",
    `APP="${APP}"`,
    'BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'PREFIX=$(CDPATH= cd -- "$BIN_DIR/.." && pwd)',
    'LIB_DIR="$PREFIX/lib/$APP"',
    'INSTALL_ENV="$LIB_DIR/install.env"',
    'if [ -f "$INSTALL_ENV" ]; then',
    '  . "$INSTALL_ENV"',
    'fi',
    'CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'CONFIG_DIR="${CONFIG_DIR:-$CONFIG_BASE/$APP}"',
    'IMUI_ENV_FILE="${IMUI_ENV_FILE:-$CONFIG_DIR/.env}" exec "$LIB_DIR/$APP" "$@"',
    "EOF",
    'chmod +x "$BIN_DIR/$APP"',
    "cat > \"$BIN_DIR/$APP-service\" <<'EOF'",
    "#!/usr/bin/env sh",
    "set -eu",
    `APP="${APP}"`,
    'BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'PREFIX=$(CDPATH= cd -- "$BIN_DIR/.." && pwd)',
    'LIB_DIR="$PREFIX/lib/$APP"',
    'exec "$LIB_DIR/service-helper.sh" "$@"',
    "EOF",
    'chmod +x "$BIN_DIR/$APP-service"',
    "",
    'echo "Installed $APP $VERSION"',
    'echo "Binary: $BIN_DIR/$APP"',
    'echo "Service helper: $BIN_DIR/$APP-service"',
    'echo "Config: $CONFIG_DIR/.env"',
    'echo "Data:   $DATA_DIR"',
    'echo "Run:    $APP --help"',
    "",
  ].join("\n")
}

export function renderUninstallScript() {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    `APP="${APP}"`,
    'PREFIX="${PREFIX:-$HOME/.local}"',
    'BIN_DIR="$PREFIX/bin"',
    'LIB_DIR="$PREFIX/lib/$APP"',
    'SHARE_DIR="$PREFIX/share/$APP"',
    'CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"',
    'CONFIG_DIR="${CONFIG_DIR:-$CONFIG_BASE/$APP}"',
    'DATA_DIR="${DATA_DIR:-$DATA_BASE/$APP}"',
    "",
    'launchd_file="$HOME/Library/LaunchAgents/com.$APP.plist"',
    'systemd_file="$HOME/.config/systemd/user/$APP.service"',
    'launchctl bootout "gui/$(id -u)" "$launchd_file" >/dev/null 2>&1 || launchctl unload "$launchd_file" >/dev/null 2>&1 || true',
    'rm -f "$launchd_file"',
    'systemctl --user disable --now "$APP.service" >/dev/null 2>&1 || true',
    'rm -f "$systemd_file"',
    'systemctl --user daemon-reload >/dev/null 2>&1 || true',
    'rm -f "$BIN_DIR/$APP"',
    'rm -f "$BIN_DIR/$APP-service"',
    'rm -f "$LIB_DIR/$APP"',
    'rm -f "$LIB_DIR/service-helper.sh"',
    'rm -f "$LIB_DIR/install.env"',
    'rmdir "$LIB_DIR" 2>/dev/null || true',
    'rm -f "$SHARE_DIR/README.md"',
    'rm -f "$SHARE_DIR/README-service.md"',
    'rmdir "$SHARE_DIR" 2>/dev/null || true',
    "",
    'echo "Removed installed launcher, helper and binary for $APP."',
    'echo "Config and data are kept by default:"',
    'echo "  $CONFIG_DIR"',
    'echo "  $DATA_DIR"',
    "",
  ].join("\n")
}

async function bundle(root: string, stage: string, target: Target) {
  const out = spawnSync("bun", ["build", "./src/app/main.ts", "--compile", "--target", target, "--outfile", path.join(stage, "bin", APP)], {
    cwd: root,
    stdio: "inherit",
  })
  if (out.status !== 0) fail(`bun build failed for ${target}`)
}

async function archive(parent: string, base: string, outfile: string) {
  const out = spawnSync("tar", ["-czf", outfile, base], {
    cwd: parent,
    stdio: "inherit",
  })
  if (out.status !== 0) fail(`tar archive failed for ${base}`)
}

function stamp(now = new Date()) {
  return now.toISOString().replaceAll("-", "").replaceAll(":", "").replaceAll(".", "").replace("T", "-").replace("Z", "Z")
}

async function archivePath(outdir: string, base: string) {
  const stable = path.join(outdir, `${base}.tar.gz`)
  if (!existsSync(stable)) return stable
  return path.join(outdir, `${base}-${stamp()}.tar.gz`)
}

export async function buildRelease(root = process.cwd(), argv = process.argv): Promise<BuildResult> {
  const args = parseArgs(argv)
  const outdir = path.resolve(root, args.outdir)
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: string }
  const version = pkg.version ?? "0.1.0"
  const env = await readFile(path.join(root, ".env.example"), "utf8")
  const artifacts: string[] = []

  await mkdir(outdir, { recursive: true })

  for (const target of args.targets) {
    const base = archiveBase(version, target)
    const temp = await mkdtemp(path.join(tmpdir(), `${APP}-${target}-`))
    const stage = path.join(temp, base)
    await mkdir(path.join(stage, "bin"), { recursive: true })
    await mkdir(path.join(stage, "share"), { recursive: true })

    try {
      await bundle(root, stage, target)
      await cp(path.join(root, "README.md"), path.join(stage, "share", "README-source.md"))
      await writeFile(path.join(stage, "VERSION"), `${version}\n`)
      const packageReadme = renderPackageReadme(version, target)
      await writeFile(path.join(stage, "README.md"), packageReadme)
      await writeFile(path.join(stage, "share", "README-package.md"), packageReadme)
      await writeFile(path.join(stage, "share", "README-service.md"), renderServiceReadme())
      await writeFile(path.join(stage, "share", "service-helper.sh"), renderServiceHelperScript())
      await writeFile(path.join(stage, "share", `${APP}.env.example`), renderInstalledEnvExample(env))
      await writeFile(path.join(stage, "install.sh"), renderInstallScript(version))
      await writeFile(path.join(stage, "uninstall.sh"), renderUninstallScript())
      await chmod(path.join(stage, "install.sh"), 0o755)
      await chmod(path.join(stage, "uninstall.sh"), 0o755)
      await chmod(path.join(stage, "share", "service-helper.sh"), 0o755)

      const outfile = await archivePath(outdir, base)
      await archive(temp, base, outfile)
      artifacts.push(outfile)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }

  return {
    version,
    outdir,
    targets: args.targets,
    artifacts,
  }
}

if (import.meta.main) {
  const out = await buildRelease()
  console.log(
    JSON.stringify({
      type: "release",
      version: out.version,
      outdir: out.outdir,
      targets: out.targets,
      artifacts: out.artifacts,
    }),
  )
}
