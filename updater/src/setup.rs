use crate::{install, model};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
struct Candidate {
    browser: String,
    profile: String,
    id: String,
    directory: String,
    product: String,
}

fn product(path: &Path) -> Option<String> {
    [model::Edition::Light, model::Edition::Full]
        .into_iter()
        .find(|edition| model::extension_manifest(path, edition).is_ok())
        .map(|edition| edition.name().to_owned())
}

fn candidates(directory: Option<&Path>) -> Vec<Candidate> {
    let wanted = directory.and_then(product);
    let mut result = Vec::new();
    for browser in ["chrome", "edge"] {
        let Ok(root) = install::browser_root(browser) else {
            continue;
        };
        let Ok(profiles) = fs::read_dir(root) else {
            continue;
        };
        for profile in profiles.flatten().filter(|entry| entry.path().is_dir()) {
            for file in ["Preferences", "Secure Preferences"] {
                let path = profile.path().join(file);
                if fs::metadata(&path)
                    .map(|m| m.len() > 32 * 1024 * 1024)
                    .unwrap_or(true)
                {
                    continue;
                }
                let Ok(bytes) = fs::read(path) else { continue };
                let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
                    continue;
                };
                let Some(settings) = value
                    .pointer("/extensions/settings")
                    .and_then(|v| v.as_object())
                else {
                    continue;
                };
                for (id, entry) in settings {
                    if !model::valid_id(id) {
                        continue;
                    }
                    let Some(path) = entry.get("path").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let path = PathBuf::from(path);
                    // Only unpacked, absolute paths: store extension directories are not candidates.
                    if !path.is_absolute() {
                        continue;
                    }
                    let Some(name) = product(&path) else { continue };
                    if wanted.as_ref().is_some_and(|wanted| wanted != &name) {
                        continue;
                    }
                    let directory = path.to_string_lossy().into_owned();
                    if result.iter().any(|c: &Candidate| {
                        c.id == *id && c.browser == browser && c.directory == directory
                    }) {
                        continue;
                    }
                    result.push(Candidate {
                        browser: browser.into(),
                        profile: value
                            .pointer("/profile/name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&profile.file_name().to_string_lossy())
                            .to_owned(),
                        id: id.clone(),
                        directory,
                        product: name,
                    });
                }
            }
        }
    }
    result
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    browser: String,
    id: String,
    directory: PathBuf,
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, bytes: &[u8]) -> Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\nConnection: close\r\n\r\n",
        bytes.len()
    )?;
    stream.write_all(bytes)?;
    Ok(())
}

fn request(
    stream: &mut TcpStream,
    host: &str,
    token: &str,
    directory: Option<&Path>,
) -> Result<bool> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0u8; 2048];
        let count = stream.read(&mut chunk)?;
        ensure!(count > 0 && buffer.len() + count <= 65536, "请求无效");
        buffer.extend_from_slice(&chunk[..count]);
        if let Some(index) = buffer.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break index + 4;
        }
        ensure!(buffer.len() <= 16384, "请求头过大");
    };
    let headers = std::str::from_utf8(&buffer[..header_end])?.to_owned();
    let mut lines = headers.split("\r\n");
    let first = lines.next().context("请求无效")?;
    let fields = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim()))
        .collect::<Vec<_>>();
    let field = |name: &str| fields.iter().find(|(k, _)| k == name).map(|(_, v)| *v);
    ensure!(field("host") == Some(host), "请求来源无效");
    if first == "GET / HTTP/1.1" {
        respond(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            include_bytes!("../setup.html"),
        )?;
        return Ok(false);
    }
    ensure!(
        field("authorization") == Some(format!("Bearer {token}").as_str()),
        "安装会话已失效，请重新打开安装程序"
    );
    ensure!(field("transfer-encoding").is_none(), "请求无效");
    if first == "GET /api/scan HTTP/1.1" {
        let value = serde_json::json!({"candidates":candidates(directory),"directory":directory.map(|p|p.to_string_lossy()),"experimental":!cfg!(windows)});
        respond(
            stream,
            "200 OK",
            "application/json",
            &serde_json::to_vec(&value)?,
        )?;
        return Ok(false);
    }
    ensure!(
        field("origin") == Some(format!("http://{host}").as_str()),
        "请求来源无效"
    );
    if first == "POST /api/close HTTP/1.1" {
        respond(stream, "200 OK", "application/json", b"{}")?;
        return Ok(true);
    }
    ensure!(first == "POST /api/install HTTP/1.1", "请求无效");
    let length = field("content-length")
        .context("请求无效")?
        .parse::<usize>()?;
    ensure!(length <= 16384, "请求过大");
    while buffer.len() < header_end + length {
        let mut chunk = [0u8; 2048];
        let count = stream.read(&mut chunk)?;
        ensure!(count > 0, "请求不完整");
        buffer.extend_from_slice(&chunk[..count]);
    }
    let selection: Selection = serde_json::from_slice(&buffer[header_end..header_end + length])?;
    install::install(&selection.browser, &selection.id, &selection.directory)?;
    respond(stream, "200 OK", "application/json", b"{\"ok\":true}")?;
    Ok(false)
}

pub fn run(directory: Option<&Path>) -> Result<()> {
    let directory = directory
        .map(Path::canonicalize)
        .transpose()
        .context("找不到插件目录")?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let host = listener.local_addr()?.to_string();
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| anyhow::anyhow!("无法创建安装会话"))?;
    let token = hex::encode(bytes);
    let url = format!("http://{host}/#{token}");
    #[cfg(windows)]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    command
        .arg(&url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    println!("{url}");
    if command.spawn().is_err() {
        eprintln!("请在浏览器中打开上方本地地址");
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(900) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                match request(&mut stream, &host, &token, directory.as_deref()) {
                    Ok(true) => break,
                    Ok(false) => (),
                    Err(error) => {
                        let _ = respond(
                            &mut stream,
                            "400 Bad Request",
                            "application/json",
                            &serde_json::to_vec(&serde_json::json!({"error":error.to_string()}))?,
                        );
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(80))
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
