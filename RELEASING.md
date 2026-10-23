# 源码与发布

## 上传源码

仓库根目录保留 `extension.js`、`lib/`、`translations/`、`tools/`、`package.json`、`package-lock.json`、许可和文档，以及 Git/VSIX 的忽略配置。

源码使用 npm 锁文件恢复依赖；`node_modules/`、生成的 VSIX、日志、临时文件和本机环境配置不提交。通过 Git 推送时 `.gitignore` 会排除它们。使用网页上传时选择源码文件及子目录，包含 `.gitignore`、`.gitattributes`、`.vscodeignore`，跳过本地 `.git/` 元数据。

如使用源代码 ZIP，先解压后上传其中的源码文件；把 ZIP 直接上传到仓库不会自动展开为源码。

## 构建安装包

要求 Node.js 22+，以及测试用的 Chrome/Edge。Windows 自带的 bsdtar 可用于离线打包；macOS 使用系统 tar，Linux 需安装 bsdtar。

```sh
npm ci
npm test
npm run pack
```

输出文件名由 `package.json` 的 name/version 决定，例如 `claude-code-zh-ast-0.2.7.vsix`。

打包会在独立暂存目录检查运行时文件和依赖。**VSIX 必须包含 acorn**，不能使用 `--no-dependencies` 省略它。源码目录不带 node_modules，与安装包必须带运行时依赖，是两个不同环节。

## 发布

更新功能时同步维护版本号、锁文件与 CHANGELOG；发布说明写明实际验证的平台和目标 Claude Code 版本。

源码通过 Git 仓库发布，生成的 VSIX 作为 Release 附件或扩展平台安装包发布。不要把整个开发工作目录压缩后改名为 VSIX。

发布前从干净源码执行以上构建命令，并用生成的安装包核验；不要只依赖开发目录中已经安装的模块。`npm run patch` 会修改本机 Claude Code，属于手动安装工具，不是源码上传或构建步骤。
