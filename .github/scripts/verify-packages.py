"""Verify WXT release archives using only the Python standard library."""

import hashlib
import json
import os
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[2]
BASE_PERMISSIONS = {"storage", "activeTab", "scripting", "declarativeNetRequest", "alarms", "nativeMessaging"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_package(output, name, version):
    full = name == "Asterveil Pro"
    archive = output / f"{name.replace(' ', '-')}-{version}-chrome.zip"
    with zipfile.ZipFile(archive) as package:
        require(package.testzip() is None, f"Corrupt ZIP: {archive.name}")
        entries = [item.filename for item in package.infolist() if not item.is_dir()]
        require(len(entries) == len(set(entries)), f"Duplicate ZIP entries: {archive.name}")
        files = set(entries)
        require(
            not any(file.split("/", 1)[0].lower() == "_metadata" for file in files),
            f"Browser-generated cache must not be packaged: {archive.name}",
        )
        directory = output / name
        built_files = {
            path.relative_to(directory).as_posix()
            for path in directory.rglob("*")
            if path.is_file()
            # Chromium creates this cache after loading an unpacked extension.
            and path.relative_to(directory).parts[0].lower() != "_metadata"
        }
        require(files == built_files, f"ZIP does not match built files: {archive.name}")
        for file in files:
            require(
                package.read(file) == (directory / file).read_bytes(),
                f"ZIP contains stale content: {archive.name}/{file}",
            )

        manifest = json.loads(package.read("manifest.json"))
        require(manifest["name"] == name, f"Wrong product name: {archive.name}")
        require(manifest["version"] == version, f"Wrong version: {archive.name}")
        require(manifest["manifest_version"] == 3, "Expected Manifest V3")
        expected_permissions = BASE_PERMISSIONS | ({"management"} if not full else set())
        require(
            set(manifest.get("permissions", [])) == expected_permissions,
            f"Unexpected permissions: {archive.name}",
        )
        require(
            not manifest.get("optional_permissions"),
            f"Unexpected optional permissions: {archive.name}",
        )

        required_files = {
            manifest["background"]["service_worker"],
            manifest["action"]["default_popup"],
            *manifest["icons"].values(),
            *manifest["action"]["default_icon"].values(),
        }
        for script in manifest["content_scripts"]:
            required_files.update(script.get("js", []))
            required_files.update(script.get("css", []))
        for rules in manifest["declarative_net_request"]["rule_resources"]:
            required_files.add(rules["path"])
        require(required_files <= files, f"Missing manifest resources: {archive.name}")

        dependencies = ["marked", "dompurify", "katex", "html-to-image"]
        if full:
            dependencies += [
                "pdf-lib", "pdfjs-dist", "@pdf-lib/standard-fonts",
                "@pdf-lib/upng", "pako", "tslib",
            ]
        for dependency in dependencies:
            require(
                any(file.startswith(f"licenses/{dependency}/") for file in files),
                f"Missing {dependency} license: {archive.name}",
            )
        if full:
            for folder in ["cmaps", "standard_fonts", "wasm", "iccs"]:
                require(
                    any(file.startswith(f"pdfjs/{folder}/") for file in files),
                    f"Missing PDF resources: {folder}",
                )
            resources = manifest.get("web_accessible_resources", [])
            require(
                any("pdfjs/*" in item.get("resources", []) for item in resources),
                "Pro does not expose its PDF resources",
            )
        else:
            require(not manifest.get("web_accessible_resources"), "Light exposes extra resources")
            require(
                not any(
                    file.startswith(("pdfjs/", "licenses/pdf", "licenses/@pdf-lib/"))
                    for file in files
                ),
                "PDF resources leaked into the light edition",
            )
    return archive


def main():
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / ".output"
    archives = [verify_package(output, name, version) for name in ["Asterveil", "Asterveil Pro"]]
    checksums = "".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in archives
    )
    (output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8", newline="\n")
    lines = [f"- `{path.name}` ({path.stat().st_size:,} bytes)" for path in archives]
    print("Verified release packages:\n" + "\n".join(lines))
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(
                f"## Asterveil {version}\n\n" + "\n".join(lines)
                + "\n\nSHA-256 checksums included.\n"
            )


if __name__ == "__main__":
    main()
