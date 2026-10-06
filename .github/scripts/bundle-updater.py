"""Build Windows bundles from the already verified extension and updater ZIPs."""

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
    updater = read_archive(output / "Asterveil-Updater-windows-x64.zip")
    for required in ("asterveil-updater.exe", "install.ps1", "install.cmd", "README.md"):
        if required not in updater:
            raise ValueError(f"Missing updater file: {required}")
    for product in ("Asterveil", "Asterveil Pro"):
        prefix = product.replace(" ", "-")
        extension = read_archive(output / f"{prefix}-{version}-chrome.zip")
        manifest = json.loads(extension["manifest.json"])
        if manifest["name"] != product or manifest["version"] != version:
            raise ValueError("Extension product/version mismatch")
        files = {f"extension/{name}": data for name, data in extension.items()}
        files.update({f"updater/{name}": data for name, data in updater.items()})
        files["install-updater.cmd"] = (
            '@echo off\r\n'
            'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\\install.ps1" '
            '-Directory "%~dp0extension"\r\n'
            'pause\r\n'
        ).encode("ascii")
        files["README.txt"] = (
            f"{product} {version} — With updater / Windows 10/11 x64\n\n"
            "1. 将整个压缩包解压到固定目录。\n"
            "2. 打开 chrome://extensions 或 edge://extensions，开启开发者模式，\n"
            "   选择“加载已解压的扩展程序”，加载本包中的 extension 文件夹。\n"
            "3. 双击 install-updater.cmd，填写浏览器和刚加载的扩展 ID。\n"
            "   安装程序已自动指定 extension 文件夹，无需再输入目录。\n"
            "4. 刷新网站，在 Asterveil 设置 → 关于中开启自动更新。\n\n"
            "已有用户保留原扩展加载目录：仅将 extension 内的文件更新到原目录，\n"
            "重新加载扩展，再运行 updater/install.cmd 并填写原加载目录。\n"
            "不同浏览器使用独立目录并分别绑定。\n"
            "自动更新只接收正式稳定版，草稿和预发布版本需手动安装。\n"
            "更新器自身仍需手动升级；安装和恢复说明见 updater/README.md。\n"
        ).encode("utf-8-sig")
        path = output / f"{prefix}-{version}-chrome-with-updater-windows-x64.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(name, data)
        if read_archive(path) != files:
            raise ValueError(f"Bundle verification failed: {path.name}")
        print(f"Verified {path.name}")
    names = [
        f"{prefix}-{version}-chrome{suffix}.zip"
        for prefix in ("Asterveil", "Asterveil-Pro")
        for suffix in ("", "-with-updater-windows-x64")
    ] + ["update-manifest.json", "update-manifest.sig"]
    checksums = "".join(
        f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n"
        for name in names
    )
    (output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
