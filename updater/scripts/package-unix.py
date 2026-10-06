"""Package an untested macOS/Linux build without executing it."""
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
platform = sys.argv[1]
if platform not in ("macos-arm64", "macos-x64", "linux-x64"):
    raise ValueError("Unsupported build target")
output = root / ".output"
output.mkdir(exist_ok=True)
licenses = output / f"licenses-{platform}.txt"
subprocess.run(["node", str(root / "updater/scripts/licenses.mjs"), str(licenses)], check=True)
files = {
    "asterveil-updater": root / "updater/target/release/asterveil-updater",
    "README.md": root / "updater/README.md",
    "release-public-key.hex": root / "updater/release-public-key.hex",
    "LICENSE": root / "LICENSE",
    "THIRD_PARTY_LICENSES.txt": licenses,
}
path = output / f"Asterveil-Updater-{platform}.zip"
with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, source in files.items():
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.external_attr = (0o100755 if name == "asterveil-updater" else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, source.read_bytes())
    archive.writestr("UNTESTED.txt", "此平台尚未实机验证，仅完成编译和打包。macOS 未公证；Linux 需要 glibc 2.35+、OpenSSL 3 和桌面浏览器。\n")
print(path)
