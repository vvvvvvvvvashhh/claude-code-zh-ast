# Claude Code 汉化 (AST)

把 VS Code 系编辑器里 Claude Code 扩展（`anthropic.claude-code`）的界面换成简体中文，还可以一键让 Claude 用中文回复。

非 Anthropic 官方项目 · MIT · 作者 N1n3VASthR33H

> 这是本地补丁，不是官方语言包。它会直接修改本机 Claude Code 扩展的 `webview/index.js` 和 `package.json`，原文件备份在同目录的 `*.en-backup`。

## 安装

```cmd
code --install-extension claude-code-zh-ast-0.2.8.vsix
```

也可以在扩展面板里选 **Install from VSIX...**。其他编辑器换成各自的命令，比如 Devin Desktop 用 `devin-desktop`。

装好后，扩展会找到当前编辑器加载的 Claude Code 并打补丁，完成后按提示重载窗口即可。它只改当前编辑器里的 Claude Code，不会去动其他编辑器的安装。扩展运行在本地 UI 宿主，远程服务器上单独安装的 Claude Code 不在范围内。

**从旧版升级**

- 0.2.1 及更早：先卸载旧 ID `vbao.claude-code-zh-ast`，免得两份补丁工具同时运行。
- 0.2.4：直接装新版，不用先还原。如果提示备份或状态对不上，扩展会停下并保留文件，这时重装 Claude Code 再应用。

## 能翻译什么

补丁分两层：

- **AST 层**：用 acorn 解析 Claude Code 的代码，只替换确定用于显示的字符串，也就是显示属性和识别出的 localize 消息参数。条件表达式和字符串拼接里的值同样要过检查。不认识的调用、构造器参数和结构属性一律不碰，外面多包一层表达式也不会放行。
- **DOM 显示层**：界面渲染出来后，再替换文字，以及 placeholder、title、aria-label 这类提示文字。聊天内容、代码、编辑器、终端和输入框都会跳过。元素被移进这些区域时，本层改过的文字会还原。

操作菜单的搜索中英文都能用：输入“沙箱”或 `Sandbox` 都能找到同一个命令。命令的 ID、回调和你输入的内容不会被改。Claude Code 改版后如果识别不到这个搜索索引，会提示你改用英文关键词。

翻译不到的部分：

- Claude 实时生成的回复（想要中文回复，见下一节）
- Claude Code 扩展进程自己弹出的通知，以及服务端动态下发的部分文字

每次打完补丁都会重新解析一遍，确认语法没坏，并记录内容哈希和词典版本。语法没问题不代表界面一定正常：DOM 层靠 Claude Code 的容器标识判断哪里不能改，Claude Code 大改版后可能需要适配。

## 让 Claude 用中文回复

执行 **Claude 汉化: 让 Claude 用中文回复**。它会在 `~/.claude/settings.json` 里写入 `"language": "chinese"`，新会话生效。设置了 `$CLAUDE_CONFIG_DIR` 时，改的是 `$CLAUDE_CONFIG_DIR/settings.json`。

- 只改 `language` 这一项，其他配置、缩进和换行风格都保留。文件不是合法 JSON 时会拒绝修改。
- 已经设置了其他语言时，不会自动覆盖，手动执行这个命令才会替换。
- **Claude 汉化: 还原 Claude 回复语言** 只在值为 `chinese` 时删掉这一项，不会恢复你之前设的其他语言。

## 恢复英文 / 白屏自救

1. 执行 **Claude 汉化: 还原原版**。
2. 按提示重载窗口。还原后自动汉化会暂停，重载后也保持英文。
3. 想重新使用汉化时，执行 **Claude 汉化: 应用汉化**。

只卸载或禁用本扩展，不会撤销已经写进 Claude Code 的补丁。不想用了，请先还原，再卸载。

- 只有显示层出问题：关掉 `claudeZh.domLayer`，再手动应用。
- 提示备份或状态不匹配：不要拿来历不明的备份去覆盖。重装 Claude Code 恢复官方文件，再按需应用汉化。

## 命令与设置

| 命令 | 作用 |
|---|---|
| Claude 汉化: 应用汉化 | 检查并重打补丁，同时取消暂停 |
| Claude 汉化: 还原原版 | 恢复英文，并暂停自动汉化 |
| Claude 汉化: 打开翻译词典 | 查看内置的 AST 词典 |
| Claude 汉化: 让 Claude 用中文回复 | 在用户配置里设置 `language` |
| Claude 汉化: 还原 Claude 回复语言 | 值为 `chinese` 时删除该项 |

| 设置 | 默认 | 说明 |
|---|---|---|
| `claudeZh.autoApply` | `true` | 启动时自动检查并汉化。执行过还原后会暂停，直到你手动应用 |
| `claudeZh.mode` | `calls` | `safe` 只翻明确的显示属性；`calls` 再加上识别出的 localize 消息参数；`all` 只为兼容旧配置保留，结构保护照样生效 |
| `claudeZh.domLayer` | `true` | 是否启用显示层 |
| `claudeZh.customTranslations` | `{}` | 自定义词条（英文 → 中文），AST、显示层和命令/设置说明都会用到 |
| `claudeZh.exclude` | `[]` | 保持英文的原文；和自定义词条冲突时以它为准 |

这些设置针对整个编辑器里的 Claude Code，不区分工作区。改完后手动应用一次，再重载窗口。词典、模式或引擎有变化时，补丁会从核验过的英文备份重新生成；什么都没变就不重复写入。

## 命令行

在源码目录用，需要 Node.js 22+，先执行 `npm ci`。命令行工具不读编辑器设置。

```cmd
rem 自动定位并打补丁；--no-dom 不加显示层
node tools/patch.js
node tools/patch.js --no-dom

rem 指定目标文件或扩展目录
node tools/patch.js "C:\path\to\webview\index.js"
node tools/patch.js --extensions-dir "C:\path\to\extensions"

rem 查看 / 取消中文回复
node tools/reply-zh.js --status
node tools/reply-zh.js --unset
```

不带目标时，只有找到唯一一个 Claude Code 才会继续；找到多个就要你指定 `index.js` 路径，不会凭目录时间猜。

## 开发

```cmd
npm ci
npm test
npm run pack
```

- `npm test` 覆盖结构字符串保护、备份与还原、状态文件损坏、还原后重启、命令行参数，以及在真实浏览器里跑的 DOM 回归。浏览器测试要用本机的 Chrome 或 Edge，可以用 `CHROME_PATH` 指定。
- `npm run pack` 离线打包 VSIX。Windows 上用系统自带的 bsdtar，其他系统需要装一个支持 ZIP 的 bsdtar。打包前会在独立目录里检查文件，并试加载依赖 acorn。
- 上传源码、打安装包和发布前检查，见 [RELEASING.md](RELEASING.md)。

**改词典**

- `translations/built-in.json`：AST 层词典
- `translations/dom.json`：显示层补充

补漏翻可以先列出没翻的，再机翻：

```cmd
node tools/list-untranslated.js --json todo.json
node tools/translate-batch.js todo.json
```

机翻优先读环境变量：`ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`CLAUDE_ZH_MODEL` 或 `ANTHROPIC_MODEL`。没设时读 `~/.claude/settings.json` 的 `env` 段。密钥不会写进词典。机翻结果记得人工校对。

## 验证范围

在 Windows 上对 Claude Code 2.1.307 验证过：补丁、结构字符串保护、还原，以及打开面板、菜单、中英文搜索。其他平台和所有交互路径还没覆盖。各版本修了什么，见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT © N1n3VASthR33H，只覆盖本项目的代码和中文译文。

词典里的英文原文版权归 Anthropic，仅作翻译对照，仓库里不含 Claude Code 程序代码。在本地修改第三方扩展可能不符合它的使用条款，使用前请自行确认。
