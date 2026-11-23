# Terminal

面向 Linux SSH 的桌面终端，使用与 VS Code 相同的 Electron + xterm.js 技术栈。只做终端，不包含 Windows 本地 Shell、SFTP、远程文件管理或代码编辑器。

## 运行

需要 Node.js 22 或更新版本与 Windows x64：

```powershell
cd Terminal
npm ci
npm start
```

`npm run pack` 生成 `release/Terminal-<版本>/Terminal.exe` 和配套运行库；`npm run dist` 另生成可分发 ZIP。解压完整目录后启动 exe，不能单独复制 exe。首次开发运行会下载 Electron 二进制。便携包免安装，但配置保存在系统用户的应用数据目录。应用及快捷方式显示为 Terminal，图标使用用户提供的原图；打包时嵌入多尺寸 Windows ICO。已有旧名称的配置目录继续复用，以保留连接、字体设置和主机指纹。

## 主题与配色

点击右上角“◐ 外观”，分别选择界面主题和终端配色，在预览中检查中文、英文、Emoji 和 16 色 ANSI 色板，点击“保存外观”应用。取消不会修改当前配色。

8 种界面主题：午夜、石墨、深海、松林、暮紫、晴纸、暖砂、高对比；另有“跟随系统”，系统深浅色变化时自动切换。标题栏以下的标签、工具栏、表单、搜索、阅读面板和提示消息均适配深浅色。

12 套终端配色：薄荷夜色、石墨金、深海蓝、松林绿、星云紫、余烬橙、冰川、磷光绿、晴纸、暖砂、青瓷、高对比。可独立搭配界面，也可以“跟随界面主题”。保存后直接更新所有已有标签与新连接，无需断开 SSH；重启保留选择，字体与性能设置不会覆盖配色选择。

配色覆盖终端背景、前景、光标、选区及 ANSI 16 色，其他颜色仍由 xterm 处理。远端程序显式输出的 24 位 RGB 颜色保持原值；如果远端应用固定使用浅色文字，请在该应用中同步选择浅色主题，或给终端保留深色配色。

主题定义在 `src/themes.js`，界面 token 样式在 `src/themes.css`。不引入额外渲染器、动效或轮询，切换配色保留终端缓冲。

## 字体是一级功能

打开“设置”，分别指定以下字体链，使用英文逗号分隔，无需加引号：

| 用途 | 默认优先链 |
| --- | --- |
| 英文、数字、拉丁字符 | Comic Mono → Consolas |
| 中文与 CJK | NSimSun → SimSun |
| 希腊字母、数学符号 | Cambria Math → STIX Two Math → Segoe UI Symbol |
| Emoji | Segoe UI Emoji → Noto Color Emoji |
| 其余字符 | Consolas → NSimSun → Segoe UI Symbol → monospace |

应用为每个字体建立带 `unicode-range` 的 `@font-face local()` 别名，将拉丁文、CJK、希腊字母/数学符号、Emoji 定向到不同字体链。每条链有独立 fallback，最后还有全局 fallback。直接加载本机已安装字体，无需下载或重新安装字体。

以 Comic Mono 的英文字符宽度为基准，测量本机字体度量并使用 `size-adjust` 校准中文和 Emoji；xterm 网格保证英文一列、中文两列、完整 Emoji 字素簇两列、希腊字母与常用数学符号一列。设置中显示对齐预览和首选字体是否加载成功。远端仍需使用一致的 Unicode 宽度表，尤其是复杂 Emoji；不同字符的可见墨迹宽度与字符占用的网格宽度并非同一概念。缺字时自动使用 fallback。旧版默认字体会迁移一次到 Comic Mono/NSimSun，之后保留用户自定义设置。

默认启用 xterm Unicode 15 字素簇扩展，改善组合 Emoji（如 🧑‍💻）的宽度处理。该上游扩展仍为实验性；可在设置切换 Unicode 11，适配远端使用旧版 `wcwidth` 的程序。远端 libc、应用宽度表和客户端不一致时仍可能错位。英文连字没有额外适配。

微软拼音输入采用组合结束事件所确认的文本，避免 Windows TSF 替换整个隐藏输入框时，旧偏移吞掉中文。构建使用固定版本 xterm.js 6.0.0 源码并应用 `patches/xterm-ime.mjs` 中可审查的兼容补丁；不修改 node_modules，也不将拼音候选过程发送到 SSH。输入法组合期间，应用快捷键让出事件；确认和取消分别处理，避免重复提交。参考上游 [#6049](https://github.com/xtermjs/xterm.js/issues/6049) 与 [#6051](https://github.com/xtermjs/xterm.js/pull/6051)。

## SSH

支持密码、加密或未加密私钥、SSH Agent；应用内连接设置只保存名称、主机、端口、用户名与认证类型。密码、私钥口令和私钥内容不落盘。手动连接可通过文件选择器选择私钥；来自用户 SSH config 的 IdentityFile 直接按配置读取。Agent 使用 `SSH_AUTH_SOCK`，Windows 默认尝试 OpenSSH agent 命名管道。

启动和打开连接对话框时，自动读取 Windows 当前用户的 `~/.ssh/config`（通常是 `C:\Users\你的用户名\.ssh\config`）。主机选择器有独立的 config 分组；选中别名后点击连接，或手动输入别名并选择“使用 ~/.ssh/config 自动认证”。每次连接重新读取配置，不向原 config 写入内容；“刷新 SSH config”可立即更新列表。

支持 `Host` 多别名、通配符与否定匹配、大小写不敏感的指令、首个值优先、`HostName`、`User`、`Port`、多个 `IdentityFile`、路径引号/空格、`~` 与常用 `%d/%h/%n/%p/%r` 变量、带通配符的 `Include`、`IdentityAgent`、`IdentitiesOnly`、`PreferredAuthentications`、`ServerAliveInterval`、`ConnectTimeout`。相对 Include 路径从用户 `.ssh` 目录解析。具体主机别名列入列表，通配模式可通过输入实际别名使用。支持 `ProxyJump` 单跳、多跳和链式跳板，每一跳独立验证主机指纹；跳板配置中也可指定各自 IdentityFile。密码或私钥口令输入框目前向各跳使用同一个本次输入值。

密钥未完成认证且服务器允许密码登录时，会自动弹出目标主机的密码框；跳板与目标主机分别认证。支持 keyboard-interactive 的服务器提示和验证码输入。未提供加密私钥口令时可弹框解锁；输入仅用于当前会话，不保存。取消或关闭会话会取消待处理提示。

密码框关闭后显式退出密码输入上下文，恢复终端普通文本输入框和 Windows 原生 WebView 输入焦点，避免停留在密码模式的输入法禁用状态。此操作仅在应用处于前台时执行；不修改系统输入法设置，也不将密码临时切成明文。

`Match` 支持 all/host/originalhost/user/localuser；不执行 `Match exec`，检测到其他 Match 条件会提示不支持。通用 `ProxyCommand` 暂不执行，会明确提示改用 ProxyJump；不支持硬件密钥交互、系统级 ssh_config、SSH config 中的算法覆盖/端口转发/RemoteCommand 等全部 OpenSSH 扩展。

首次连接会显示 SHA256 主机密钥指纹，核对后保存。主机密钥改变会再次提示。记录保存在 Electron `userData` 的 `known-hosts.json`，与系统 OpenSSH `known_hosts` 分开；不使用 config 的 StrictHostKeyChecking 来绕过核验。

## Vim、Codex CLI、Claude CLI

SSH 请求真正的远程 PTY，使用 `TERM=xterm-256color`，并请求 `COLORTERM=truecolor`、`TERM_PROGRAM=SilkTerminal`（服务器可拒绝环境变量）。终端支持 ANSI 16/256 色、24 位颜色、备用屏幕、光标形状、应用光标键、鼠标报告、括号粘贴和 Unicode。Vim/Neovim 的按键由终端原样传给远端；不拦截普通 Ctrl+C、Ctrl+W、Esc、Alt 或 vi 按键。按住 Shift 可绕过 TUI 鼠标捕获选择文字。

远程 Shell 执行 `exit`、收到 EOF 或 SSH 连接关闭后，自动移除对应标签，不再保留“已断开”标签。后台标签退出不切换当前标签；当前标签退出后切换到相邻标签；最后一个退出后返回连接首页，应用窗口保留。连接错误以提示消息显示后关闭标签。手动关闭仍对活动连接进行确认。

Codex CLI 和 Claude CLI 在远端按其正常方式安装启动即可。本项目提供通用终端协议支持，没有冒充两者专用客户端；尚未对真实 Linux 上的 Vim、Codex CLI、Claude CLI 做端到端兼容认证。多行输入可使用应用本身的快捷键，例如 Claude 的反斜杠加 Enter 或应用支持的粘贴模式。复杂 tmux/Emoji 布局需结合远端配置实测。断线不自动重放输入；长任务建议在远端 tmux 中执行，再通过“重新连接”恢复。

## Markdown 阅读

先选中终端中的 Markdown，再打开“Markdown 阅读”。无选区时从当前缓冲区提取最近最多 4,000 行、500,000 个字符并合并软换行。支持标题、列表、代码块、表格、引用，可编辑源文本、手动刷新。不是文件浏览器，不会从远端自动读取文件：先在终端 `cat README.md` 或选择 CLI 输出。

阅读内容经 DOMPurify 清洗，禁止脚本、图片、嵌入内容和外部链接导航。终端保持 VT 网格，不在交互式 TUI 中插入 HTML，阅读面板打开时才执行 Markdown 解析。

## LaTeX 数学公式

阅读面板离线渲染 `$...$` / `\(...\)` 行内公式和 `$$...$$` / `\[...\]` 独立公式。支持 KaTeX 的希腊字母、分式、上下标、积分、求和与矩阵，例如：

```latex
行内：$\alpha+\beta=\gamma$

$$
\int_0^\infty e^{-x}\,dx=1
\qquad \begin{pmatrix}a&b\\c&d\end{pmatrix}
$$
```

公式使用随应用附带的 KaTeX 数学字体，保持数学排版的符号度量；普通终端里的希腊字母使用上面的 Cambria Math 字体链。代码块和行内代码保留原始 LaTeX。支持的是数学公式，不是完整的 LaTeX 文档编译；普通 VT 终端仍显示源文本，选区/输出进入阅读面板后显示排版结果。

KaTeX 随阅读器按需加载，不请求 CDN；禁用受信任命令和外部资源，限制宏展开次数、公式大小、单公式长度 8,192 字符及每快照 500 个公式。语法错误显示源文本而不使终端崩溃。

## 性能策略与取舍

- 默认每会话 50,000 行滚动历史，设置可调到 1,000–500,000 行；这是淘汰最旧内容的滚动缓冲，不是无限日志。宽行、颜色属性、标签数量都会影响实际内存。最多 24 个会话。
- 后端每发送一批 SSH 数据就暂停读取，xterm 解析完成回传序号后继续；不以定时器无限堆积字符串。UTF-8 使用字节流输入，保留跨包解码状态。
- 每个标签只创建一次 xterm，切换保留终端对象与缓冲，隐藏标签停止可见绘制，但持续解析以维持 SSH 输出和 TUI 状态。后台高吞吐仍有 CPU 成本。
- 默认使用 DOM 模式，减少 WebGL 上下文与纹理开销。也可选择 WebGL；只有活跃标签分配 WebGL 上下文，切走显式释放 GPU 上下文，代价是切回时需要重建字形图集。WebGL 初始化失败或上下文丢失时回退 DOM。
- 默认关闭光标闪烁、滚动动画、透明背景；尺寸变化节流；无后台资源轮询。
- 输入与粘贴限制 1 MiB，远端输入队列超过 2 MiB 时提示丢弃本次输入。远端输出会背压减速，这是避免无限内存增长的必要取舍。
- Electron 自身有 Chromium 基础资源开销；不能保证 CPU、内存和显存同时达到所有原生终端的最低值。此版本不做磁盘历史分页和无限上下文。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| Ctrl+Shift+T | 新 SSH 连接 |
| Ctrl+Tab / Ctrl+Shift+Tab | 下一个 / 上一个标签 |
| Ctrl+Shift+W | 关闭标签（活动连接会确认） |
| Ctrl+Shift+F | 搜索已保留历史；Enter 下一个，Shift+Enter 上一个 |
| Ctrl+Shift+M | Markdown 阅读面板 |
| Ctrl+Shift+C / Ctrl+Shift+V | 复制选区 / 粘贴 |
| 右键 | 有选区时复制并清除选区；没有选区时粘贴 |
| Ctrl+C | 有选区时复制；没有选区时保留远端中断行为 |

右键由终端界面处理，不会同时向 Vim 等 TUI 发送右键鼠标事件。TUI 开启鼠标捕获时，用 Shift+拖动选择文字，再右键复制。粘贴使用 xterm 的括号粘贴协议（远端启用时），并保持 1 MiB 大小限制。

## 验证

```powershell
npm test
npm run test:ui
npm audit
```

`npm test` 使用本机 SSH2 服务进行真实协议测试：PTY、输入、UTF-8/真彩色、resize、输出确认背压、30,000 行传输、未信任主机拒绝与资源清理。

`npm run test:ui` 启动 Electron 和隔离配置目录，在本机 SSH 服务上测试多语种字体设置、Markdown 清洗、30,000 行输出、四标签切换、后台输出、备用屏幕和 DOM 回退。测试服务器主机指纹仅在此自动化进程中自动接受，产品始终要求核对。截图与测量保存在 `test-results`；测量含自动化等待，不能当作纯渲染器基准或对其他终端的性能优势证明。

技术参考：[xterm 流量控制](https://xtermjs.org/docs/guides/flowcontrol/)、[xterm 终端配置](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security/)、[ssh2](https://github.com/mscdex/ssh2)。
