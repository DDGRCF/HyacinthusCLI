// Change note: bundle the Claw activation fixture so standalone CLI release checks can compile.

use std::{
    env, fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::cli::{ClawRuntimeGuardArgs, ClawRuntimeProbeArgs};

const MAX_AUTHORITY_BYTES: u64 = 16 * 1024;
const ACTIVATION_SCHEMA_VERSION: u8 = 2;
const ARTIFACT_ROOT: &str = "/data/picoclaw/artifacts";
const READY_ROOT: &str = "/tmp/hyacinthus-claw-ready";
const GUARD_NONCE_ENV: &str = "HYACINTHUS_CLAW_GUARD_NONCE";
const EXIT_AUTHORITY_REJECTED: i32 = 78;
const EXIT_RUNTIME_FAILED: i32 = 70;
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(200);
const RUNNING_POLL_INTERVAL: Duration = Duration::from_secs(1);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(150);
const PROBE_IO_TIMEOUT: Duration = Duration::from_millis(500);
const MAX_PROBE_RESPONSE_BYTES: usize = 512;
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// Mirrors the closed activation pointer wire contract consumed inside the runtime container.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ActivationAuthorityDocument {
    schema_version: u8,
    instance: String,
    release_digest: Option<String>,
    config_revision: u64,
    source_activation_fence: u64,
    activation_fence: u64,
    runtime_epoch: u64,
    desired_state: RuntimeIntent,
    program_name: String,
    previous_pointer_digest: Option<String>,
}

/// Closes the only runtime intent accepted by the startup guard.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeIntent {
    Running,
    Stopped,
    Deleted,
}

/// Executes the hidden guard and never loads profiles, credentials, or network configuration.
pub fn run(args: &ClawRuntimeGuardArgs) -> i32 {
    if validate_args(args).is_err() {
        eprintln!("Claw runtime guard rejected its launch identity");
        return EXIT_AUTHORITY_REJECTED;
    }
    let first = match read_authority(&args.authority_path) {
        Ok(bytes) => bytes,
        Err(()) => {
            eprintln!("Claw runtime guard could not read canonical authority");
            return EXIT_AUTHORITY_REJECTED;
        }
    };
    if validate_authority(&first, args).is_err() {
        eprintln!("Claw runtime guard rejected canonical authority");
        return EXIT_AUTHORITY_REJECTED;
    }
    let second = match read_authority(&args.authority_path) {
        Ok(bytes) => bytes,
        Err(()) => {
            eprintln!("Claw runtime guard could not reconfirm canonical authority");
            return EXIT_AUTHORITY_REJECTED;
        }
    };
    if second != first || validate_authority(&second, args).is_err() {
        eprintln!("Claw runtime guard observed changed authority");
        return EXIT_AUTHORITY_REJECTED;
    }
    supervise_picoclaw(args, &second)
}

/// Executes one container-local HTTP health probe without loading profiles or network clients.
pub fn run_probe(args: &ClawRuntimeProbeArgs) -> i32 {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), args.health_port);
    i32::from(!probe_health(address))
}

/// Validates server-derived arguments and the guard nonce inherited through the provider.
fn validate_args(args: &ClawRuntimeGuardArgs) -> Result<(), ()> {
    if !valid_segment(&args.instance)
        || !valid_digest(&args.pointer_digest)
        || !valid_digest(&args.release_digest)
        || args.activation_fence == 0
        || args.runtime_epoch != args.activation_fence
        || args.program_name != format!("picoclaw-{}-e{}", args.instance, args.runtime_epoch)
        || args.program_name.len() > 100
        || args.guard_nonce.is_nil()
        || args.health_port == 0
    {
        return Err(());
    }
    let expected_path = Path::new(ARTIFACT_ROOT)
        .join(&args.instance)
        .join("active.json");
    if args.authority_path != expected_path {
        return Err(());
    }
    let inherited_nonce = env::var(GUARD_NONCE_ENV)
        .ok()
        .and_then(|value| Uuid::parse_str(&value).ok());
    if inherited_nonce != Some(args.guard_nonce) {
        return Err(());
    }
    Ok(())
}

/// Reads one bounded regular authority file without accepting a symlink at the final component.
fn read_authority(path: &Path) -> Result<Vec<u8>, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
        || metadata.len() > MAX_AUTHORITY_BYTES
    {
        return Err(());
    }
    let bytes = fs::read(path).map_err(|_| ())?;
    if u64::try_from(bytes.len()).ok() != Some(metadata.len()) {
        return Err(());
    }
    Ok(bytes)
}

/// Requires exact raw digest, canonical bytes, running intent, and every supplied target field.
fn validate_authority(bytes: &[u8], args: &ClawRuntimeGuardArgs) -> Result<(), ()> {
    if bytes.is_empty()
        || bytes.len() > usize::try_from(MAX_AUTHORITY_BYTES).map_err(|_| ())?
        || raw_sha256(bytes) != args.pointer_digest
    {
        return Err(());
    }
    let document: ActivationAuthorityDocument = serde_json::from_slice(bytes).map_err(|_| ())?;
    if serde_json::to_vec(&document).map_err(|_| ())? != bytes
        || document.schema_version != ACTIVATION_SCHEMA_VERSION
        || document.instance != args.instance
        || document.release_digest.as_deref() != Some(args.release_digest.as_str())
        || document.config_revision == 0
        || document.source_activation_fence >= document.activation_fence
        || document.activation_fence != args.activation_fence
        || document.runtime_epoch != args.runtime_epoch
        || document.desired_state != RuntimeIntent::Running
        || document.program_name != args.program_name
        || document
            .previous_pointer_digest
            .as_deref()
            .is_some_and(|digest| !valid_digest(digest))
    {
        return Err(());
    }
    Ok(())
}

/// Keeps the guard resident, waits for PicoClaw readiness, and terminates on authority drift.
#[cfg(unix)]
fn supervise_picoclaw(args: &ClawRuntimeGuardArgs, authority: &[u8]) -> i32 {
    let shutdown = Arc::new(AtomicBool::new(false));
    if signal_hook::flag::register(signal_hook::consts::SIGTERM, Arc::clone(&shutdown)).is_err()
        || signal_hook::flag::register(signal_hook::consts::SIGINT, Arc::clone(&shutdown)).is_err()
    {
        eprintln!("Claw runtime guard could not install shutdown handlers");
        return EXIT_RUNTIME_FAILED;
    }
    let marker = match ReadyMarker::prepare(args.guard_nonce) {
        Ok(marker) => marker,
        Err(()) => {
            eprintln!("Claw runtime guard could not prepare readiness state");
            return EXIT_RUNTIME_FAILED;
        }
    };
    let mut child = match Command::new("/sbin/su-exec")
        .args(["10001:10001", "/usr/local/bin/picoclaw", "gateway", "-E"])
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            eprintln!("Claw runtime guard could not start PicoClaw");
            return EXIT_RUNTIME_FAILED;
        }
    };
    let ready_deadline = Instant::now() + READY_TIMEOUT;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), args.health_port);
    let mut ready = false;
    loop {
        if shutdown.load(Ordering::Relaxed) {
            terminate_child_gracefully(&mut child);
            return 0;
        }
        match child.try_wait() {
            Ok(Some(status)) => return child_exit_code(status),
            Ok(None) => {}
            Err(_) => {
                terminate_child(&mut child);
                return EXIT_RUNTIME_FAILED;
            }
        }
        let unchanged = read_authority(&args.authority_path)
            .ok()
            .filter(|bytes| bytes == authority)
            .is_some_and(|bytes| validate_authority(&bytes, args).is_ok());
        if !unchanged {
            terminate_child(&mut child);
            eprintln!("Claw runtime guard observed changed authority");
            return EXIT_AUTHORITY_REJECTED;
        }
        if !ready {
            if probe_health(address) {
                if marker.publish(args.guard_nonce).is_err() {
                    terminate_child(&mut child);
                    return EXIT_RUNTIME_FAILED;
                }
                ready = true;
            } else if Instant::now() >= ready_deadline {
                terminate_child(&mut child);
                eprintln!("Claw runtime guard readiness timed out");
                return EXIT_RUNTIME_FAILED;
            }
        }
        thread::sleep(if ready {
            RUNNING_POLL_INTERVAL
        } else {
            STARTUP_POLL_INTERVAL
        });
    }
}

/// Requires one bounded HTTP 2xx response from the exact container-local health endpoint.
fn probe_health(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) else {
        return false;
    };
    if stream.set_read_timeout(Some(PROBE_IO_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(PROBE_IO_TIMEOUT)).is_err()
        || stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .is_err()
    {
        return false;
    }
    let mut response = [0_u8; MAX_PROBE_RESPONSE_BYTES];
    let Ok(length) = stream.read(&mut response) else {
        return false;
    };
    let Ok(head) = std::str::from_utf8(&response[..length]) else {
        return false;
    };
    head.lines()
        .next()
        .and_then(|line| line.split_ascii_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .is_some_and(|status| (200..300).contains(&status))
}

/// Rejects unsupported platforms because resident signal supervision is part of the invariant.
#[cfg(not(unix))]
fn supervise_picoclaw(_args: &ClawRuntimeGuardArgs, _authority: &[u8]) -> i32 {
    eprintln!("Claw runtime guard requires Unix supervision");
    EXIT_RUNTIME_FAILED
}

/// Owns one boot-specific readiness marker and removes it whenever supervision exits.
struct ReadyMarker(PathBuf);

impl ReadyMarker {
    /// Prepares one private readiness directory and rejects any pre-existing marker.
    fn prepare(guard_nonce: Uuid) -> Result<Self, ()> {
        let root = Path::new(READY_ROOT);
        match fs::symlink_metadata(root) {
            Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            }
            Ok(_) => return Err(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(root).map_err(|_| ())?;
            }
            Err(_) => return Err(()),
        }
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(|_| ())?;
        let path = ready_marker_path(guard_nonce);
        if fs::symlink_metadata(&path).is_ok() {
            return Err(());
        }
        Ok(Self(path))
    }

    /// Publishes the exact nonce through a newly created, synchronized regular file.
    fn publish(&self, guard_nonce: Uuid) -> Result<(), ()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.0)
            .map_err(|_| ())?;
        file.write_all(guard_nonce.to_string().as_bytes())
            .map_err(|_| ())?;
        file.sync_all().map_err(|_| ())
    }
}

impl Drop for ReadyMarker {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Derives the only readiness path accepted for one boot nonce.
fn ready_marker_path(guard_nonce: Uuid) -> PathBuf {
    Path::new(READY_ROOT).join(guard_nonce.to_string())
}

/// Immediately terminates and reaps a stale or failed child without leaving an orphan.
fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Forwards TERM on normal shutdown, waits within policy, then applies a final hard stop.
#[cfg(unix)]
fn terminate_child_gracefully(child: &mut Child) {
    use nix::{
        sys::signal::{kill, Signal},
        unistd::Pid,
    };

    if let Ok(pid) = i32::try_from(child.id()) {
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }
    let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    terminate_child(child);
}

/// Falls back to immediate termination on unsupported platforms.
#[cfg(not(unix))]
fn terminate_child_gracefully(child: &mut Child) {
    terminate_child(child);
}

/// Preserves successful PicoClaw exit and sanitizes signal or platform-specific statuses.
fn child_exit_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(EXIT_RUNTIME_FAILED)
}

/// Computes one lowercase SHA-256 without allocating provider or path details.
fn raw_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Accepts one portable direct-child instance segment.
fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\', '\0'])
        && !value.chars().any(char::is_control)
}

/// Accepts one canonical lowercase SHA-256 identity.
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use std::{net::TcpListener, path::PathBuf};

    use super::*;

    /// Builds one exact running pointer and the arguments expected by the guard.
    fn fixture() -> (ClawRuntimeGuardArgs, Vec<u8>) {
        let bytes = include_bytes!("../tests/fixtures/claw-activation-v2.json")
            .strip_suffix(b"\n")
            .expect("fixture newline")
            .to_vec();
        let document: ActivationAuthorityDocument =
            serde_json::from_slice(&bytes).expect("bundled activation fixture must decode");
        let args = ClawRuntimeGuardArgs {
            authority_path: PathBuf::from(ARTIFACT_ROOT)
                .join(&document.instance)
                .join("active.json"),
            pointer_digest: raw_sha256(&bytes),
            instance: document.instance,
            release_digest: document.release_digest.expect("running release"),
            activation_fence: document.activation_fence,
            runtime_epoch: document.runtime_epoch,
            program_name: document.program_name,
            guard_nonce: Uuid::from_u128(9),
            health_port: 8_081,
        };
        (args, bytes)
    }

    #[test]
    fn canonical_running_authority_matches_every_guard_target_field() {
        let (args, bytes) = fixture();
        assert_eq!(validate_authority(&bytes, &args), Ok(()));
    }

    #[test]
    fn guard_rejects_noncanonical_or_stale_authority() {
        let (args, bytes) = fixture();
        let mut whitespace = bytes.clone();
        whitespace.push(b'\n');
        assert_eq!(validate_authority(&whitespace, &args), Err(()));
        let mut stale = args.clone();
        stale.activation_fence += 1;
        assert_eq!(validate_authority(&bytes, &stale), Err(()));
        let mut stopped: ActivationAuthorityDocument =
            serde_json::from_slice(&bytes).expect("fixture must decode");
        stopped.desired_state = RuntimeIntent::Stopped;
        let stopped = serde_json::to_vec(&stopped).expect("stopped fixture must encode");
        let mut stopped_args = args;
        stopped_args.pointer_digest = raw_sha256(&stopped);
        assert_eq!(validate_authority(&stopped, &stopped_args), Err(()));
    }

    #[test]
    fn readiness_marker_is_exact_and_boot_scoped() {
        let nonce = Uuid::new_v4();
        let marker = ReadyMarker::prepare(nonce).expect("ready marker");
        assert!(!ready_marker_path(nonce).exists());
        marker.publish(nonce).expect("publish readiness");
        assert_eq!(
            fs::read_to_string(ready_marker_path(nonce)).expect("marker bytes"),
            nonce.to_string()
        );
    }

    /// Serves one bounded loopback response and runs the same probe used by Docker healthcheck.
    fn probe_response(status_line: &'static str) -> bool {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("listener must bind");
        let address = listener.local_addr().expect("listener address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("probe must connect");
            let mut request = [0_u8; 256];
            let _ = stream.read(&mut request);
            stream
                .write_all(format!("{status_line}\r\nContent-Length: 0\r\n\r\n").as_bytes())
                .expect("probe response must write");
        });
        let healthy = probe_health(address);
        server.join().expect("probe server must stop");
        healthy
    }

    /// Proves redirects and failures cannot be mistaken for a ready application.
    #[test]
    fn live_probe_accepts_only_http_success() {
        assert!(probe_response("HTTP/1.1 204 No Content"));
        assert!(!probe_response("HTTP/1.1 503 Service Unavailable"));
    }
}
