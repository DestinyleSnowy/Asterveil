use crate::model::{Edition, MAX_EXPANDED, extension_manifest, version};
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().context("路径无效")?)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

// Never follow a directory junction or symlink while inspecting/removing a tree.
pub fn plain_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            metadata.file_attributes() & 0x400 == 0,
            "目录含有链接或重解析点"
        );
    }
    ensure!(!metadata.file_type().is_symlink(), "目录含有符号链接");
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            plain_tree(&entry?.path())?;
        }
    }
    Ok(())
}

pub fn remove_tree(path: &Path) -> Result<()> {
    if path.exists() {
        plain_tree(path)?;
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub fn safe_zip_path(name: &str) -> Result<PathBuf> {
    ensure!(
        !name.is_empty() && !name.contains(['\\', ':', '\0']) && !name.starts_with('/'),
        "ZIP 路径无效"
    );
    let mut path = PathBuf::new();
    for part in name.trim_end_matches('/').split('/') {
        ensure!(
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "<>\"|?*".contains(c)),
            "ZIP 路径无效"
        );
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        ensure!(
            ![
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9"
            ]
            .contains(&stem.as_str()),
            "ZIP 含保留文件名"
        );
        path.push(part);
    }
    Ok(path)
}

pub fn extract(archive: &Path, directory: &Path) -> Result<()> {
    fs::create_dir(directory)?;
    let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
    ensure!(zip.len() <= 20000, "ZIP 文件过多");
    let mut total = 0u64;
    let mut paths = HashSet::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let relative = safe_zip_path(entry.name())?;
        ensure!(
            !relative.components().next().is_some_and(|part| part
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("_metadata")),
            "更新包不能包含浏览器生成的元数据"
        );
        ensure!(
            paths.insert(relative.to_string_lossy().to_lowercase()),
            "ZIP 路径重复"
        );
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        ensure!(
            mode == 0 || mode == 0o100000 || mode == 0o040000,
            "ZIP 含特殊文件"
        );
        total = total.checked_add(entry.size()).context("ZIP 大小溢出")?;
        ensure!(total <= MAX_EXPANDED, "ZIP 解压后过大");
        let output = directory.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)?;
        } else {
            fs::create_dir_all(output.parent().context("ZIP 路径无效")?)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)?;
            let size = entry.size();
            let copied = std::io::copy(&mut (&mut entry).take(size + 1), &mut file)?;
            ensure!(copied == size, "ZIP 文件长度不匹配");
            file.sync_all()?;
        }
    }
    Ok(())
}

pub fn tree_hash(directory: &Path) -> Result<String> {
    plain_tree(directory)?;
    fn visit(root: &Path, current: &Path, hash: &mut Sha256) -> Result<()> {
        let mut entries = fs::read_dir(current)?
            .map(|e| e.map(|e| e.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        entries.sort();
        for path in entries {
            // Chromium creates DNR caches here after loading an unpacked extension.
            // ZIP extraction forbids this reserved directory; it is not executable payload.
            if current == root
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("_metadata"))
            {
                continue;
            }
            if path.is_dir() {
                visit(root, &path, hash)?;
            } else {
                let name = path
                    .strip_prefix(root)?
                    .to_string_lossy()
                    .replace('\\', "/");
                hash.update((name.len() as u64).to_le_bytes());
                hash.update(name.as_bytes());
                hash.update(fs::metadata(&path)?.len().to_le_bytes());
                let mut file = File::open(path)?;
                let mut buffer = [0u8; 65536];
                loop {
                    let n = file.read(&mut buffer)?;
                    if n == 0 {
                        break;
                    }
                    hash.update(&buffer[..n]);
                }
            }
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    visit(directory, directory, &mut hash)?;
    Ok(hex::encode(hash.finalize()))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Journal {
    pub phase: String,
    pub version: String,
    pub previous: String,
    pub tree_hash: String,
    pub deadline: u64,
}

pub struct Transaction {
    pub target: PathBuf,
    pub work: PathBuf,
    pub edition: Edition,
    _lock: File,
}

impl Transaction {
    pub fn open(target: &Path, edition: Edition) -> Result<Self> {
        ensure!(
            target.is_absolute() && target.file_name().is_some(),
            "安装路径无效"
        );
        let parent = target.parent().context("安装路径无效")?;
        // The canonical parent must not change after binding.
        ensure!(parent.canonicalize()? == parent, "安装目录已移动");
        let hash = hex::encode(Sha256::digest(target.to_string_lossy().as_bytes()));
        let work = parent.join(format!(".asterveil-update-{}", &hash[..16]));
        fs::create_dir_all(&work)?;
        plain_tree(&work)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(work.join("lock"))?;
        lock.try_lock_exclusive().context("另一个更新正在进行")?;
        Ok(Self {
            target: target.to_owned(),
            work,
            edition,
            _lock: lock,
        })
    }
    pub fn read(&self) -> Result<Option<Journal>> {
        let path = self.work.join("state.json");
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
    }
    pub fn write(&self, journal: &Journal) -> Result<()> {
        atomic_json(&self.work.join("state.json"), journal)
    }
    pub fn stage(&self) -> PathBuf {
        self.work.join("stage")
    }
    pub fn backup(&self) -> PathBuf {
        self.work.join("backup")
    }
    pub fn recover(&self) -> Result<()> {
        if let Some(j) = self.read()?
            && (j.phase == "applying" || (j.phase == "pending" && now() >= j.deadline))
        {
            self.rollback()?;
        }
        Ok(())
    }
    pub fn prepared(&self, release: &str) -> Result<()> {
        let old = extension_manifest(&self.target, &self.edition)?;
        let new = extension_manifest(&self.stage(), &self.edition)?;
        crate::model::validate_resources(&self.stage(), &new)?;
        ensure!(
            new["version"] == release && new.get("key") == old.get("key"),
            "扩展版本或身份不匹配"
        );
        ensure!(
            version(release)? > version(old["version"].as_str().context("版本无效")?)?,
            "拒绝降级更新"
        );
        self.write(&Journal {
            phase: "prepared".into(),
            version: release.into(),
            previous: old["version"].as_str().unwrap().into(),
            tree_hash: tree_hash(&self.stage())?,
            deadline: 0,
        })
    }
    pub fn apply(&self) -> Result<String> {
        let mut j = self.read()?.context("没有待安装更新")?;
        ensure!(j.phase == "prepared", "更新尚未准备完成");
        let old = extension_manifest(&self.target, &self.edition)?;
        ensure!(old["version"] == j.previous, "当前版本已改变，请重新检查");
        ensure!(tree_hash(&self.stage())? == j.tree_hash, "待安装文件已改变");
        plain_tree(&self.target)?;
        remove_tree(&self.backup())?;
        j.phase = "applying".into();
        self.write(&j)?;
        let result = (|| -> Result<()> {
            fs::rename(&self.target, self.backup()).context("安装目录被占用")?;
            fs::rename(self.stage(), &self.target)?;
            j.phase = "pending".into();
            j.deadline = now() + 120;
            self.write(&j)?;
            Ok(())
        })();
        if let Err(error) = result {
            self.rollback()?;
            return Err(error);
        }
        Ok(j.version)
    }
    pub fn confirm(&self, running: &str) -> Result<bool> {
        let Some(mut j) = self.read()? else {
            return Ok(false);
        };
        if j.phase != "pending" {
            return Ok(false);
        }
        ensure!(j.version == running, "等待新版插件启动");
        let manifest = extension_manifest(&self.target, &self.edition)?;
        ensure!(
            manifest["version"] == running && tree_hash(&self.target)? == j.tree_hash,
            "新版文件校验失败"
        );
        j.phase = "confirmed".into();
        self.write(&j)?;
        // Retain one backup until the next update for explicit recovery.
        Ok(true)
    }
    pub fn rollback(&self) -> Result<()> {
        let mut j = self.read()?.context("没有可恢复的更新")?;
        if self.backup().exists() {
            extension_manifest(&self.backup(), &self.edition)?;
            let failed = self.work.join("failed");
            remove_tree(&failed)?;
            if self.target.exists() {
                plain_tree(&self.target)?;
                fs::rename(&self.target, &failed)?;
            }
            if let Err(error) = fs::rename(self.backup(), &self.target) {
                if failed.exists() {
                    let _ = fs::rename(&failed, &self.target);
                }
                return Err(error.into());
            }
        } else {
            ensure!(self.target.exists(), "恢复目录缺失，请重新安装扩展");
        }
        j.phase = if matches!(j.phase.as_str(), "pending" | "confirmed" | "rolled_back") {
            "rolled_back"
        } else {
            "retryable"
        }
        .into();
        self.write(&j)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest(path: &Path, ver: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(
            path.join("manifest.json"),
            format!(r#"{{"name":"Asterveil","manifest_version":3,"version":"{ver}","permissions":["nativeMessaging","alarms"],"background":{{"service_worker":"background.js"}}}}"#),
        )
        .unwrap();
        fs::write(path.join("background.js"), "// fixture").unwrap();
    }
    #[test]
    fn rejects_windows_zip_escape_and_device_paths() {
        for s in [
            "../x", "/x", "C:/x", "x\\y", "x:stream", "CON.txt", "a/NUL", "x. /y", "a/./b", "a//b",
        ] {
            assert!(safe_zip_path(s).is_err(), "{s}");
        }
        assert!(safe_zip_path("chunks/editor.js").is_ok());
    }
    #[test]
    fn update_confirm_and_rollback() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let target = root.join("extension");
        manifest(&target, "0.1.0");
        let tx = Transaction::open(&target, Edition::Light).unwrap();
        manifest(&tx.stage(), "0.2.0");
        tx.prepared("0.2.0").unwrap();
        assert!(Transaction::open(&target, Edition::Light).is_err());
        tx.apply().unwrap();
        assert!(tx.confirm("0.1.0").is_err());
        assert!(tx.confirm("0.2.0").unwrap());
        tx.rollback().unwrap();
        assert_eq!(
            extension_manifest(&target, &Edition::Light).unwrap()["version"],
            "0.1.0"
        );
    }
    #[test]
    fn crash_between_directory_moves_recovers() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let target = root.join("extension");
        manifest(&target, "0.1.0");
        let tx = Transaction::open(&target, Edition::Light).unwrap();
        manifest(&tx.stage(), "0.2.0");
        tx.prepared("0.2.0").unwrap();
        let mut j = tx.read().unwrap().unwrap();
        j.phase = "applying".into();
        tx.write(&j).unwrap();
        fs::rename(&target, tx.backup()).unwrap();
        tx.recover().unwrap();
        assert_eq!(
            extension_manifest(&target, &Edition::Light).unwrap()["version"],
            "0.1.0"
        );
    }
    #[test]
    fn staged_tampering_and_downgrade_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let target = root.join("extension");
        manifest(&target, "0.1.0");
        let tx = Transaction::open(&target, Edition::Light).unwrap();
        manifest(&tx.stage(), "0.0.9");
        assert!(tx.prepared("0.0.9").is_err());
        manifest(&tx.stage(), "0.2.0");
        tx.prepared("0.2.0").unwrap();
        fs::write(tx.stage().join("extra.js"), "bad").unwrap();
        assert!(tx.apply().is_err());
        assert_eq!(
            extension_manifest(&target, &Edition::Light).unwrap()["version"],
            "0.1.0"
        );
    }

    #[test]
    fn expired_startup_confirmation_restores_previous_version() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().canonicalize().unwrap().join("extension");
        manifest(&target, "0.1.0");
        let tx = Transaction::open(&target, Edition::Light).unwrap();
        manifest(&tx.stage(), "0.2.0");
        tx.prepared("0.2.0").unwrap();
        tx.apply().unwrap();
        let mut journal = tx.read().unwrap().unwrap();
        journal.deadline = 0;
        tx.write(&journal).unwrap();
        tx.recover().unwrap();
        assert_eq!(
            extension_manifest(&target, &Edition::Light).unwrap()["version"],
            "0.1.0"
        );
        assert_eq!(tx.read().unwrap().unwrap().phase, "rolled_back");
    }

    #[test]
    fn incomplete_extension_cannot_be_staged() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().canonicalize().unwrap().join("extension");
        manifest(&target, "0.1.0");
        let tx = Transaction::open(&target, Edition::Light).unwrap();
        manifest(&tx.stage(), "0.2.0");
        fs::remove_file(tx.stage().join("background.js")).unwrap();
        assert!(tx.prepared("0.2.0").is_err());
    }

    #[test]
    fn zip_extraction_rejects_case_collisions_and_corruption() {
        use zip::{ZipWriter, write::SimpleFileOptions};
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("test.zip");
        let mut zip = ZipWriter::new(File::create(&archive).unwrap());
        for name in ["same.js", "SAME.js"] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"test").unwrap();
        }
        zip.finish().unwrap();
        assert!(extract(&archive, &temp.path().join("stage")).is_err());
        fs::write(&archive, b"not a zip").unwrap();
        assert!(extract(&archive, &temp.path().join("other")).is_err());
    }

    #[test]
    fn browser_generated_metadata_does_not_invalidate_payload_hash() {
        let temp = tempfile::tempdir().unwrap();
        manifest(temp.path(), "0.1.0");
        let expected = tree_hash(temp.path()).unwrap();
        fs::create_dir(temp.path().join("_metadata")).unwrap();
        fs::write(
            temp.path().join("_metadata/generated_indexed_ruleset"),
            "cache",
        )
        .unwrap();
        assert_eq!(tree_hash(temp.path()).unwrap(), expected);
        fs::write(temp.path().join("background.js"), "changed").unwrap();
        assert_ne!(tree_hash(temp.path()).unwrap(), expected);
    }
}
