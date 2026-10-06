# Asterveil Windows 更新器

支持 Windows 10/11 x64、Chrome/Edge 桌面版，以及通过“加载已解压的扩展程序”安装的 Asterveil 普通版和 Pro。首次必须手动安装带自动更新功能的扩展版本并重新加载；更新器不能为旧插件凭空添加通信权限。

## 安装

1. 从项目正式 Release 下载所需版本的 `*-chrome-with-updater-windows-x64.zip`，完整解压。新安装用户在浏览器中加载其中的 `extension` 文件夹。
2. 在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，记录 Asterveil 的扩展 ID 与实际加载目录。
3. 新安装用户双击包根目录的 `install-updater.cmd`，输入 ID 和浏览器（`chrome` / `edge`），安装器自动使用包内的 `extension` 目录。已有用户保留原插件目录，运行 `updater/install.cmd` 并输入实际加载路径。不要选择源码根目录、压缩包或浏览器商店安装目录。
4. 在网站的 Asterveil 设置 → 关于中开启“自动更新”。“检查更新”会检查并安装可用新版，不依赖自动更新开关。

也可在包内的 `updater` 目录打开 PowerShell 运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Browser edge -ExtensionId <32位ID> -Directory 'D:\Extensions\Asterveil Pro'
```

安装在当前用户的 `%LOCALAPPDATA%\Asterveil\Updater`，只写当前用户的 Native Messaging 注册项，不需要系统服务或计划任务。扩展目录及其父目录必须可写。不同浏览器必须分别加载不同目录，多个浏览器配置也建议使用独立目录；普通版与 Pro 必须各自绑定。切换目录或浏览器配置后，应重新检查 ID 并绑定。

## 更新行为

- 浏览器启动和每六小时检查；浏览器关闭时不运行。联网失败保留现状，下次检查重试。
- 更新器先访问 GitHub Release API、签名清单和实际 ZIP 下载服务器，使用 HTTPS，保留证书校验。使用 reqwest 的系统代理支持和进程代理环境变量；浏览器专属代理扩展不一定作用于本地程序，PAC/认证代理环境需实际验证。不会自动改代理或切换镜像。
- 只接受固定仓库的正式稳定版，验证内置 Ed25519 公钥、清单、附件大小和 SHA-256，再解压到同磁盘的暂存目录。拒绝路径越界、设备文件名、链接和过量解压。
- 普通版只更新普通版，Pro 只更新 Pro，拒绝版本降级或扩展身份改变。
- 正在作答、保存草稿、导出、预览提交或发送提交时等待。页面输入后至少等待两分钟；无法确认旧页面状态时，需刷新或关闭该页面后才能安装。
- 安装时短暂锁定页面交互，备份旧目录再替换，新后台自行重载并确认启动。不会强制刷新网页；网页功能在正常刷新后切换。
- 新版未在两分钟内确认启动，恢复进程会恢复旧目录。已崩溃或停用的扩展仍可能需要在扩展管理页手动重新加载。曾回滚失败的同一版本不会被反复自动安装。
- 同目录互斥锁避免重复写入；断电或进程退出后根据事务记录恢复。浏览器本地设置和草稿不会删除。更新前的一个备份会保留到下一次更新。
- 更新器自身首版手动升级，重新下载安装包并运行安装即可。发行包暂未做 Windows Authenticode 签名，Windows 可能显示发行者提示；更新内容使用独立的 Ed25519 签名校验。

## 恢复与解绑

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Action Repair -ExtensionId <32位ID>
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Action Unbind -ExtensionId <32位ID>
```

恢复后在浏览器中重新加载扩展。解绑只停止此扩展使用更新器，不删除扩展目录、设置或草稿。所有绑定解除后可删除 `%LOCALAPPDATA%\Asterveil\Updater`，并移除当前用户注册表 `Software\Google\Chrome\NativeMessagingHosts\cn.asterveil.updater` / `Software\Microsoft\Edge\NativeMessagingHosts\cn.asterveil.updater` 中属于本更新器的条目。

## 开发与发布

```powershell
cargo test --locked --manifest-path updater/Cargo.toml
cargo clippy --locked --manifest-path updater/Cargo.toml --all-targets -- -D warnings
cargo build --release --locked --manifest-path updater/Cargo.toml
powershell -NoProfile -File updater/scripts/package.ps1
npm run build:all
npx playwright install chromium
npm run test:updater:browser
```

浏览器集成测试在独立配置中测试普通版和 Pro 的安装脚本、本地通信、真实网络检测、文件替换、自动重载确认、存储保留、回滚和深浅色/窄屏设置页。它临时注册测试 Native Messaging 主机，结束时恢复原注册项；测试产物保存在 `.tmp/updater-browser-*`。更新安装使用暂存的新版本夹具，不会发布或修改远程 Release；签名、下载哈希及损坏包另有原生测试覆盖。

发布清单由 `updater/scripts/release.mjs` 签名，私钥必须与 `release-public-key.hex` 匹配。首次密钥创建：

当前开发机已生成与仓库公钥对应的私钥，位置为 `%LOCALAPPDATA%\AsterveilReleaseKeys\update-ed25519.private.pem`，目录访问权限已限制为当前用户。请安全备份并配置 Actions Secret；不要重新生成或提交私钥。

```powershell
node updater/scripts/release.mjs keygen C:\SecureKeys\Asterveil.private.pem
```

仅首次发布前创建。不要在已有更新器分发后重新生成公钥，否则旧更新器无法验证新版本。私钥不放进仓库、安装包或日志，安全备份；将 PEM 全文保存到仓库 Actions secret `ASTERVEIL_UPDATE_PRIVATE_KEY`。发布工作流缺少此 secret 时直接失败，不生成未签名的更新。

本地签名并生成四个发行包：

```powershell
$env:ASTERVEIL_UPDATE_PRIVATE_KEY_FILE = 'C:\SecureKeys\Asterveil.private.pem'
node updater/scripts/release.mjs sign .output
python .github/scripts/bundle-updater.py .output
```

每次 Release 提供四个下载包：普通版和 Pro 各有仅插件（without updater，沿用 `*-chrome.zip` 文件名）与含 Windows 更新器（`*-chrome-with-updater-windows-x64.zip`）两种；另外包含 `update-manifest.json`、二进制 `update-manifest.sig` 与 `SHA256SUMS.txt`。含更新器的包内提供 `extension/`、`updater/` 和根目录安装入口。自动更新仍下载仅插件的 ZIP，不重复替换本地更新器。签名清单包含版本、最低更新器版本、版本类型、文件名、大小与哈希。先创建草稿，审核后发布；更新器忽略草稿和预发布版本。

私钥轮换和更新器自身自动更新不属于首版；前者需先通过可信渠道升级更新器内置公钥。
