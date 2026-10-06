use crate::{
    model::{self, Edition, HOST, valid_id},
    transaction::{atomic_json, plain_tree},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    pub directory: PathBuf,
    pub edition: Edition,
    pub browser: String,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Config {
    pub bindings: BTreeMap<String, Binding>,
}

// Chromium can start hosts through cmd.exe, which cannot launch verbatim paths.
// Canonical paths stay in bindings; only browser-facing paths use DOS/UNC syntax.
fn browser_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}

pub fn config_root() -> Result<PathBuf> {
    Ok(std::env::current_exe()?
        .parent()
        .context("更新器路径无效")?
        .to_owned())
}
pub fn read_config(root: &Path) -> Result<Config> {
    let path = root.join("bindings.json");
    if !path.exists() {
        return Ok(Config::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
pub fn binding(id: &str) -> Result<Binding> {
    read_config(&config_root()?)?
        .bindings
        .remove(id)
        .context("此扩展尚未绑定更新器，请重新运行安装程序")
}

#[cfg(windows)]
fn register(browser: &str, manifest: &Path) -> Result<()> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let vendor = match browser {
        "chrome" => "Google\\Chrome",
        "edge" => "Microsoft\\Edge",
        _ => anyhow::bail!("仅支持 Chrome 或 Edge"),
    };
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!("Software\\{vendor}\\NativeMessagingHosts\\{HOST}"))?;
    key.set_value("", &browser_path(manifest))?;
    Ok(())
}
#[cfg(not(windows))]
fn register(_: &str, _: &Path) -> Result<()> {
    anyhow::bail!("首版安装器仅支持 Windows")
}

pub fn install(browser: &str, id: &str, directory: &Path) -> Result<()> {
    ensure!(
        cfg!(all(windows, target_arch = "x86_64")),
        "首版仅支持 Windows x64"
    );
    ensure!(
        matches!(browser, "chrome" | "edge") && valid_id(id),
        "浏览器或扩展 ID 无效"
    );
    let directory = directory.canonicalize().context("找不到扩展目录")?;
    ensure!(
        !directory.join(".git").exists() && !directory.join("package.json").exists(),
        "请选择构建后的扩展目录"
    );
    plain_tree(&directory)?;
    let edition = if model::extension_manifest(&directory, &Edition::Light).is_ok() {
        Edition::Light
    } else {
        model::extension_manifest(&directory, &Edition::Full)?;
        Edition::Full
    };
    model::validate_resources(
        &directory,
        &model::extension_manifest(&directory, &edition)?,
    )?;
    // Check write access now, without changing extension contents.
    let probe = tempfile::NamedTempFile::new_in(directory.parent().context("安装路径无效")?)
        .context("扩展所在目录不可写")?;
    drop(probe);
    let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").context("找不到本地应用目录")?)
        .join("Asterveil")
        .join("Updater");
    fs::create_dir_all(&root)?;
    plain_tree(&root)?;
    let root = root.canonicalize()?;
    use fs2::FileExt;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("install.lock"))?;
    lock.try_lock_exclusive().context("另一个安装正在进行")?;
    let mut config = read_config(&root)?;
    if let Some(previous) = config.bindings.get(id) {
        ensure!(
            previous.directory == directory,
            "此 ID 已绑定其他目录，请先解除旧绑定"
        );
        ensure!(
            previous.browser == browser,
            "请为不同浏览器使用独立扩展目录并分别绑定"
        );
    }
    let executable = root.join(format!(
        "asterveil-updater-{}.exe",
        env!("CARGO_PKG_VERSION")
    ));
    let source = std::env::current_exe()?;
    if source != executable
        && (!executable.exists() || fs::read(&source)? != fs::read(&executable)?)
    {
        let mut tmp = tempfile::NamedTempFile::new_in(&root)?;
        std::io::copy(&mut fs::File::open(source)?, &mut tmp)?;
        tmp.as_file().sync_all()?;
        tmp.persist(&executable).map_err(|e| e.error)?;
    }
    config.bindings.insert(
        id.to_owned(),
        Binding {
            directory,
            edition,
            browser: browser.to_owned(),
        },
    );
    atomic_json(&root.join("bindings.json"), &config)?;
    let manifest = root.join(format!("{HOST}.json"));
    atomic_json(
        &manifest,
        &serde_json::json!({"name": HOST, "description":"Asterveil updater", "path": browser_path(&executable), "type":"stdio", "allowed_origins":config.bindings.keys().map(|id| format!("chrome-extension://{id}/")).collect::<Vec<_>>()}),
    )?;
    register(browser, &manifest)?;
    Ok(())
}

pub fn unbind(id: &str) -> Result<()> {
    ensure!(valid_id(id), "扩展 ID 无效");
    let root = config_root()?;
    use fs2::FileExt;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("install.lock"))?;
    lock.try_lock_exclusive()?;
    let mut config = read_config(&root)?;
    config.bindings.remove(id).context("没有此绑定")?;
    atomic_json(&root.join("bindings.json"), &config)?;
    let path = root.join(format!("{HOST}.json"));
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&path)?)?;
    manifest["allowed_origins"] = serde_json::json!(
        config
            .bindings
            .keys()
            .map(|id| format!("chrome-extension://{id}/"))
            .collect::<Vec<_>>()
    );
    atomic_json(&path, &manifest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chromium_paths_omit_windows_verbatim_prefix() {
        assert_eq!(
            browser_path(Path::new(r"\\?\C:\Users\Test\updater.exe")),
            r"C:\Users\Test\updater.exe"
        );
        assert_eq!(
            browser_path(Path::new(r"\\?\UNC\server\share\updater.exe")),
            r"\\server\share\updater.exe"
        );
    }
}
