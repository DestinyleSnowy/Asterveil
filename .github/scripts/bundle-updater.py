"""Build universal bundles from extension and per-platform updater ZIPs."""

import hashlib
import json
from pathlib import Path
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[2]


def read_archive(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError(f"Corrupt archive: {path.name}")
        files = {}
        for item in archive.infolist():
            if item.is_dir():
                continue
            name = item.filename
            if (
                name in files
                or "\\" in name
                or ":" in name
                or any(part in ("", ".", "..") for part in name.split("/"))
            ):
                raise ValueError(f"Invalid archive entry: {name}")
            files[name] = archive.read(item)
        return files


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".output"
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    platforms = ("windows-x64", "macos-arm64", "macos-x64", "linux-x64")
    updaters = {}
    for platform in platforms:
        files = read_archive(output / f"Asterveil-Updater-{platform}.zip")
        executable = "asterveil-updater.exe" if platform == "windows-x64" else "asterveil-updater"
        for required in (executable, "README.md", "release-public-key.hex", "THIRD_PARTY_LICENSES.txt"):
            if required not in files:
                raise ValueError(f"Missing {platform} updater file: {required}")
        updaters.update({f"updater/{platform}/{name}": data for name, data in files.items()})
    for product in ("Asterveil", "Asterveil Pro"):
        prefix = product.replace(" ", "-")
        extension = read_archive(output / f"{prefix}-{version}-chrome.zip")
        manifest = json.loads(extension["manifest.json"])
        if manifest["name"] != product or manifest["version"] != version:
            raise ValueError("Extension product/version mismatch")
        files = {f"extension/{name}": data for name, data in extension.items()}
        files.update(updaters)
        files["install-updater.vbs"] = (ROOT / "updater/install-ui.vbs").read_bytes()
        for name in ("install-updater.sh", "install-updater.command"):
            files[name] = (ROOT / "updater/install-unix.sh").read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")
        files["install-updater.cmd"] = (
            '@echo off\r\n'
            'wscript.exe "%~dp0install-updater.vbs"\r\n'
        ).encode("ascii")
        files["README.txt"] = (
            f"{product} {version} — With updater\n\n"
            "1. 将整个压缩包解压到固定目录。\n"
            "2. 打开 chrome://extensions 或 edge://extensions，开启开发者模式，\n"
            "   选择“加载已解压的扩展程序”，加载本包中的 extension 文件夹。\n"
            "3. Windows 双击 install-updater.cmd；macOS 双击 install-updater.command；\n"
            "   Linux 在终端运行 sh install-updater.sh。安装页自动识别浏览器、ID 和目录，\n"
            "   确认后点击安装；识别不到时可手动填写。\n"
            "4. 刷新网站，在 Asterveil 设置 → 关于中开启自动更新。\n\n"
            "已有用户保留原扩展加载目录：仅将 extension 内的文件更新到原目录，\n"
            "重新加载扩展，再运行安装入口，在安装页选择原来的插件目录。\n"
            "不同浏览器使用独立目录并分别绑定。\n"
            "自动更新只接收正式稳定版，草稿和预发布版本需手动安装。\n"
            "更新器自身仍需手动升级；安装和恢复说明见各平台 updater 子目录的 README.md。\n\n"
            "Windows 10/11 x64；macOS Intel/Apple Silicon 与 Linux x64 尚未实机验证。\n"
            "macOS 二进制未签名和公证，系统可能阻止启动；不建议绕过系统安全策略。\n"
            "Linux 需要 glibc 2.35+、OpenSSL 3、xdg-open 和非沙盒版 Chrome/Edge。\n"
        ).encode("utf-8-sig")
        path = output / f"{prefix}-{version}-chrome-with-updater.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                executable = name.endswith(("/asterveil-updater", ".sh", ".command"))
                info.external_attr = (0o100755 if executable else 0o100644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        if read_archive(path) != files:
            raise ValueError(f"Bundle verification failed: {path.name}")
        print(f"Verified {path.name}")
    names = [
        f"{prefix}-{version}-chrome{suffix}.zip"
        for prefix in ("Asterveil", "Asterveil-Pro")
        for suffix in ("", "-with-updater")
    ] + ["update-manifest.json", "update-manifest.sig"]
    checksums = "".join(
        f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n"
        for name in names
    )
    (output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
