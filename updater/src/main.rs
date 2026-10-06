mod install;
mod model;
mod network;
mod transaction;

use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::{
    io::{Read, Write},
    path::Path,
    process::Command,
    time::Duration,
};
use transaction::Transaction;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    protocol: u32,
    command: String,
    version: String,
    edition: model::Edition,
}

fn handle(id: &str, request: Request) -> Result<serde_json::Value> {
    ensure!(request.protocol == 1, "请升级插件或本地更新器");
    model::version(&request.version)?;
    let binding = install::binding(id)?;
    ensure!(binding.edition == request.edition, "绑定版本不匹配");
    let tx = Transaction::open(&binding.directory, binding.edition)?;
    tx.recover()?;
    match request.command.as_str() {
        "status" => {
            let manifest = model::extension_manifest(&tx.target, &tx.edition)?;
            Ok(
                serde_json::json!({"state":"ready", "version":manifest["version"], "updaterVersion":env!("CARGO_PKG_VERSION"), "transaction":tx.read()?}),
            )
        }
        "prepare" => {
            ensure!(
                model::extension_manifest(&tx.target, &tx.edition)?["version"] == request.version,
                "插件版本已变化，请重新加载"
            );
            network::prepare(&tx)
        }
        "apply" => {
            ensure!(
                model::extension_manifest(&tx.target, &tx.edition)?["version"] == request.version,
                "插件版本已变化，请重新加载"
            );
            // Start the watchdog before changing files; it uses the same directory lock.
            spawn_watchdog(id)?;
            let version = tx.apply()?;
            Ok(serde_json::json!({"state":"installed", "version":version}))
        }
        "confirm" => Ok(
            serde_json::json!({"state": if tx.confirm(&request.version)? { "confirmed" } else { "ready" }}),
        ),
        _ => bail!("不支持的更新命令"),
    }
}

fn spawn_watchdog(id: &str) -> Result<()> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--watch")
        .arg(id)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().context("无法启动更新恢复进程")?;
    Ok(())
}

fn watchdog(id: &str) -> Result<()> {
    ensure!(model::valid_id(id), "扩展 ID 无效");
    let binding = install::binding(id)?;
    for _ in 0..36 {
        std::thread::sleep(Duration::from_secs(5));
        if let Ok(tx) = Transaction::open(&binding.directory, binding.edition.clone()) {
            if tx.recover().is_err() {
                continue;
            }
            if tx
                .read()?
                .is_none_or(|j| j.phase != "pending" && j.phase != "applying")
            {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn read_frame(input: &mut impl Read) -> Result<Option<Vec<u8>>> {
    let mut length = [0u8; 4];
    // An empty stream is normal on browser disconnect; a partial frame is not.
    if input.read(&mut length[..1])? == 0 {
        return Ok(None);
    }
    input.read_exact(&mut length[1..])?;
    let length = u32::from_le_bytes(length) as usize;
    ensure!(length > 0 && length <= 65536, "通信消息大小无效");
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes)?;
    Ok(Some(bytes))
}
fn write_frame(output: &mut impl Write, value: &serde_json::Value) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    ensure!(bytes.len() <= 1024 * 1024, "通信响应过大");
    output.write_all(&(bytes.len() as u32).to_le_bytes())?;
    output.write_all(&bytes)?;
    output.flush()?;
    Ok(())
}

fn main_inner() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("--verify") => {
            ensure!(args.len() == 3, "用法: --verify 清单 签名");
            let release = model::verify_release(
                &std::fs::read(&args[1])?,
                &std::fs::read(&args[2])?,
                &model::public_key()?,
            )?;
            println!("{}", release.version);
            Ok(())
        }
        Some("--version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("--install") => {
            ensure!(
                args.len() == 4,
                "用法: --install chrome|edge 扩展ID 扩展目录"
            );
            install::install(&args[1], &args[2], Path::new(&args[3]))
        }
        Some("--unbind") => {
            ensure!(args.len() == 2, "用法: --unbind 扩展ID");
            install::unbind(&args[1])
        }
        Some("--repair") => {
            ensure!(
                args.len() == 2 && model::valid_id(&args[1]),
                "用法: --repair 扩展ID"
            );
            let binding = install::binding(&args[1])?;
            let tx = Transaction::open(&binding.directory, binding.edition)?;
            ensure!(tx.backup().exists(), "没有可恢复的旧版备份");
            tx.rollback()
        }
        Some("--watch") => {
            ensure!(args.len() == 2, "恢复参数无效");
            watchdog(&args[1])
        }
        Some(origin) => {
            let id = model::origin_id(origin)?;
            install::binding(id)?;
            let mut input = std::io::stdin().lock();
            let mut output = std::io::stdout().lock();
            while let Some(bytes) = read_frame(&mut input)? {
                let result = serde_json::from_slice::<Request>(&bytes)
                    .context("通信请求无效")
                    .and_then(|request| handle(id, request));
                let response = match result {
                    Ok(value) => serde_json::json!({"ok":true,"result":value}),
                    Err(error) => {
                        serde_json::json!({"ok":false,"error":error.to_string().chars().take(240).collect::<String>()})
                    }
                };
                write_frame(&mut output, &response)?;
            }
            Ok(())
        }
        None => bail!("请通过 install.ps1 安装本地更新器"),
    }
}
fn main() {
    if let Err(error) = main_inner() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_reject_truncation_and_oversize() {
        assert!(read_frame(&mut &[][..]).unwrap().is_none());
        for bytes in [vec![1], vec![1, 0, 0, 0], vec![255, 255, 255, 255]] {
            assert!(read_frame(&mut bytes.as_slice()).is_err());
        }
        let mut data = Vec::new();
        write_frame(&mut data, &serde_json::json!({"ok":true})).unwrap();
        let result = read_frame(&mut data.as_slice()).unwrap().unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&result).unwrap()["ok"],
            true
        );
    }
}
