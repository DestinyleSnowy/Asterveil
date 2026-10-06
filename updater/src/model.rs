use anyhow::{Result, bail, ensure};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const REPOSITORY: &str = "DestinyleSnowy/Asterveil";
pub const HOST: &str = "cn.asterveil.updater";
pub const MAX_ARCHIVE: u64 = 200 * 1024 * 1024;
pub const MAX_EXPANDED: u64 = 600 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    Light,
    Full,
}

impl Edition {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Light => "Asterveil",
            Self::Full => "Asterveil Pro",
        }
    }
    pub fn asset(&self, version: &str) -> String {
        format!("{}-{version}-chrome.zip", self.name().replace(' ', "-"))
    }
}

pub fn version(value: &str) -> Result<[u32; 3]> {
    let parts = value.split('.').collect::<Vec<_>>();
    ensure!(parts.len() == 3, "版本号无效");
    let mut result = [0; 3];
    for (i, part) in parts.into_iter().enumerate() {
        ensure!(
            !part.is_empty()
                && part.bytes().all(|b| b.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0')),
            "版本号无效"
        );
        result[i] = part.parse()?;
        ensure!(result[i] <= 65535, "版本号无效");
    }
    Ok(result)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Package {
    pub edition: Edition,
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub schema: u32,
    pub repository: String,
    pub version: String,
    pub min_updater: String,
    pub packages: Vec<Package>,
}

pub fn verify_release(bytes: &[u8], signature: &[u8], public_key: &[u8; 32]) -> Result<Release> {
    VerifyingKey::from_bytes(public_key)?
        .verify_strict(bytes, &Signature::from_slice(signature)?)
        .map_err(|_| anyhow::anyhow!("更新签名验证失败"))?;
    let release: Release = serde_json::from_slice(bytes)?;
    ensure!(
        release.schema == 1 && release.repository == REPOSITORY,
        "更新清单不匹配"
    );
    version(&release.version)?;
    ensure!(
        version(&release.min_updater)? <= version(env!("CARGO_PKG_VERSION"))?,
        "请先升级本地更新器"
    );
    ensure!(release.packages.len() == 2, "更新清单缺少版本");
    for edition in [Edition::Light, Edition::Full] {
        let matches = release
            .packages
            .iter()
            .filter(|p| p.edition == edition)
            .collect::<Vec<_>>();
        ensure!(matches.len() == 1, "更新清单版本重复");
        let p = matches[0];
        ensure!(
            p.name == edition.asset(&release.version) && p.size > 0 && p.size <= MAX_ARCHIVE,
            "更新附件无效"
        );
        ensure!(
            p.sha256.len() == 64 && hex::decode(&p.sha256).is_ok(),
            "更新校验值无效"
        );
    }
    Ok(release)
}

pub fn public_key() -> Result<[u8; 32]> {
    hex::decode(include_str!("../release-public-key.hex").trim())?
        .try_into()
        .map_err(|_| anyhow::anyhow!("发布公钥无效"))
}

pub fn extension_manifest(path: &Path, edition: &Edition) -> Result<serde_json::Value> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path.join("manifest.json"))?)?;
    ensure!(
        value["name"] == edition.name() && value["manifest_version"] == 3,
        "目录不是对应版本的 Asterveil"
    );
    version(value["version"].as_str().unwrap_or_default())?;
    ensure!(value.get("update_url").is_none(), "不支持接管商店安装");
    Ok(value)
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

pub fn validate_resources(path: &Path, manifest: &serde_json::Value) -> Result<()> {
    let permissions = manifest["permissions"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("请先安装支持自动更新的插件版本"))?;
    ensure!(
        ["alarms", "nativeMessaging"]
            .iter()
            .all(|p| permissions.iter().any(|v| v == p)),
        "请先安装支持自动更新的插件版本"
    );
    let mut resources = vec![
        manifest["background"]["service_worker"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("扩展后台文件缺失"))?,
    ];
    if let Some(popup) = manifest["action"]["default_popup"].as_str() {
        resources.push(popup);
    }
    for key in ["icons", "default_icon"] {
        let icons = if key == "icons" {
            &manifest[key]
        } else {
            &manifest["action"][key]
        };
        if let Some(icons) = icons.as_object() {
            for value in icons.values() {
                resources.push(
                    value
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("扩展资源声明无效"))?,
                );
            }
        }
    }
    if let Some(scripts) = manifest["content_scripts"].as_array() {
        for script in scripts {
            for kind in ["js", "css"] {
                if let Some(files) = script[kind].as_array() {
                    for file in files {
                        resources.push(
                            file.as_str()
                                .ok_or_else(|| anyhow::anyhow!("扩展脚本声明无效"))?,
                        );
                    }
                }
            }
        }
    }
    if let Some(rules) = manifest["declarative_net_request"]["rule_resources"].as_array() {
        for rule in rules {
            resources.push(
                rule["path"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("扩展规则声明无效"))?,
            );
        }
    }
    for resource in resources {
        let relative = crate::transaction::safe_zip_path(resource)?;
        ensure!(path.join(relative).is_file(), "扩展包缺少清单引用的文件");
    }
    Ok(())
}

pub fn origin_id(origin: &str) -> Result<&str> {
    if let Some(id) = origin
        .strip_prefix("chrome-extension://")
        .and_then(|s| s.strip_suffix('/'))
        && valid_id(id)
    {
        return Ok(id);
    }
    bail!("扩展来源无效")
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    #[test]
    fn versions_and_origins() {
        assert!(version("0.10.0").unwrap() > version("0.9.9").unwrap());
        for s in ["1.2", "1.2.3-beta", "01.2.3", "1.2.65536", "-1.2.3"] {
            assert!(version(s).is_err());
        }
        assert!(origin_id("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/").is_ok());
        assert!(origin_id("https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/").is_err());
    }
    #[test]
    fn signed_metadata_rejects_tampering_and_wrong_repository() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let mut release = Release {
            schema: 1,
            repository: REPOSITORY.into(),
            version: "0.2.0".into(),
            min_updater: "0.1.0".into(),
            packages: [Edition::Light, Edition::Full]
                .into_iter()
                .map(|e| Package {
                    name: e.asset("0.2.0"),
                    edition: e,
                    size: 10,
                    sha256: "00".repeat(32),
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&release).unwrap();
        let sig = key.sign(&bytes).to_bytes();
        assert!(verify_release(&bytes, &sig, &key.verifying_key().to_bytes()).is_ok());
        let mut tampered = bytes.clone();
        tampered.push(b' ');
        assert!(verify_release(&tampered, &sig, &key.verifying_key().to_bytes()).is_err());
        release.repository = "other/repo".into();
        let bytes = serde_json::to_vec(&release).unwrap();
        assert!(
            verify_release(
                &bytes,
                &key.sign(&bytes).to_bytes(),
                &key.verifying_key().to_bytes()
            )
            .is_err()
        );
    }
}
