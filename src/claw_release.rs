// Change note: verify sealed configuration and bounded environment overrides and provide verified bytes for private runtime copies.

use std::{collections::BTreeMap, fs, io::Read, path::Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const RELEASE_DOMAIN: &[u8] = b"hyacinthus.claw.release.v2";
const MAX_DESCRIPTOR_BYTES: u64 = 64 * 1024;
const MAX_COMPONENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENV_ENTRIES: usize = 128;
const MAX_ENV_KEY_BYTES: usize = 64;
const MAX_ENV_VALUE_BYTES: usize = 4 * 1024;
const MAX_ENV_DOCUMENT_BYTES: u64 = 1024 * 1024;

/// Mirrors the canonical descriptor without retaining configuration or credential values.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    schema_version: u8,
    renderer_version: u8,
    policy_version: u8,
    config_public: ByteIdentity,
    runtime_public: ByteIdentity,
    artifacts: Vec<Artifact>,
}

/// Identifies exactly one bounded immutable file.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ByteIdentity {
    sha256: String,
    length: u64,
}

/// Preserves canonical artifact field ordering when checking descriptor bytes.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    ordinal: u8,
    name: String,
    content: ByteIdentity,
    config: ByteIdentity,
}

/// Holds verified inputs without exposing private configuration in diagnostics.
pub(crate) struct RuntimeInputs {
    pub environment: BTreeMap<String, String>,
    pub configuration: Vec<u8>,
}

/// Loads overrides only after the exact release descriptor and both runtime inputs verify.
pub(crate) fn inputs(release_root: &Path, expected_digest: &str) -> Result<RuntimeInputs, ()> {
    let bytes = read_bounded(&release_root.join("release.json"), MAX_DESCRIPTOR_BYTES)?;
    if release_digest(&bytes) != expected_digest {
        return Err(());
    }
    let descriptor: Descriptor = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if descriptor.schema_version != 2
        || descriptor.renderer_version != 1
        || descriptor.policy_version != 1
        || descriptor.artifacts.len() > 64
        || serde_json::to_vec(&descriptor).map_err(|_| ())? != bytes
    {
        return Err(());
    }
    let configuration = verify_file(
        &release_root.join("config.public.json"),
        &descriptor.config_public,
    )?;
    let bytes = read_bounded(
        &release_root.join("runtime.public.json"),
        MAX_ENV_DOCUMENT_BYTES,
    )?;
    if u64::try_from(bytes.len()).map_err(|_| ())? != descriptor.runtime_public.length
        || raw_digest(&bytes) != descriptor.runtime_public.sha256
    {
        return Err(());
    }
    let overrides: BTreeMap<String, String> = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if serde_json::to_vec(&overrides).map_err(|_| ())? != bytes {
        return Err(());
    }
    validate_environment(&overrides)?;
    Ok(RuntimeInputs {
        environment: overrides,
        configuration,
    })
}

/// Opens only a bounded regular file and verifies actual bytes even if metadata changes.
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > limit {
        return Err(());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| ())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if u64::try_from(bytes.len()).map_err(|_| ())? != metadata.len() {
        return Err(());
    }
    Ok(bytes)
}

/// Returns the exact bounded configuration bytes only after their sealed identity verifies.
fn verify_file(path: &Path, identity: &ByteIdentity) -> Result<Vec<u8>, ()> {
    let bytes = read_bounded(path, MAX_COMPONENT_BYTES)?;
    if bytes.len() as u64 != identity.length || raw_digest(&bytes) != identity.sha256 {
        return Err(());
    }
    Ok(bytes)
}

/// Applies the backend's closed user-environment policy without allowing server identity overrides.
fn validate_environment(overrides: &BTreeMap<String, String>) -> Result<(), ()> {
    if overrides.len() > MAX_ENV_ENTRIES {
        return Err(());
    }
    for (key, value) in overrides {
        let reserved = matches!(
            key.as_str(),
            "HOME" | "PATH" | "USER" | "LOGNAME" | "SHELL" | "TMPDIR"
        ) || [
            "LD_",
            "DYLD_",
            "PYTHON",
            "PICOCLAW",
            "HYACINTHUS_",
            "SUPERVISOR",
        ]
        .iter()
        .any(|prefix| key.starts_with(prefix));
        let valid_key = !key.is_empty()
            && key.len() <= MAX_ENV_KEY_BYTES
            && key.bytes().enumerate().all(|(index, byte)| {
                byte == b'_' || byte.is_ascii_uppercase() || (index > 0 && byte.is_ascii_digit())
            });
        let valid_value = !value.is_empty()
            && value.len() <= MAX_ENV_VALUE_BYTES
            && !value.chars().any(|character| {
                character.is_control() || matches!(character, '%' | ',' | '"' | '\\')
            });
        if reserved || !valid_key || !valid_value {
            return Err(());
        }
    }
    Ok(())
}

/// Matches the backend's length-framed release digest, not its raw file hash.
fn release_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((RELEASE_DOMAIN.len() as u64).to_be_bytes());
    hasher.update(RELEASE_DOMAIN);
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Produces the raw byte identity stored in the immutable descriptor.
fn raw_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds real private files with the same descriptor shape emitted by the backend.
    fn fixture(overrides: BTreeMap<String, String>) -> (tempfile::TempDir, String) {
        let root = tempfile::tempdir().expect("private release fixture");
        let config = b"{\"gateway\":{\"port\":8081}}";
        let environment = serde_json::to_vec(&overrides).expect("environment fixture");
        let descriptor = Descriptor {
            schema_version: 2,
            renderer_version: 1,
            policy_version: 1,
            config_public: ByteIdentity {
                sha256: raw_digest(config),
                length: config.len() as u64,
            },
            runtime_public: ByteIdentity {
                sha256: raw_digest(&environment),
                length: environment.len() as u64,
            },
            artifacts: Vec::new(),
        };
        let bytes = serde_json::to_vec(&descriptor).expect("canonical fixture");
        fs::write(root.path().join("release.json"), &bytes).expect("descriptor");
        fs::write(root.path().join("config.public.json"), config).expect("config");
        fs::write(root.path().join("runtime.public.json"), environment).expect("environment");
        (root, release_digest(&bytes))
    }

    /// Preserves valid overrides and rejects changed runtime or config bytes without revealing values.
    #[test]
    fn loads_exact_release_and_rejects_payload_drift() {
        let expected = BTreeMap::from([("MODEL_TOKEN".to_owned(), "test-only-value".to_owned())]);
        let (root, digest) = fixture(expected.clone());
        assert_eq!(inputs(root.path(), &digest).unwrap().environment, expected);
        assert!(inputs(root.path(), &"a".repeat(64)).is_err());
        fs::write(root.path().join("runtime.public.json"), b"{}").unwrap();
        assert!(inputs(root.path(), &digest).is_err());
        let (root, digest) = fixture(BTreeMap::new());
        fs::write(root.path().join("config.public.json"), b"{}").unwrap();
        assert!(inputs(root.path(), &digest).is_err());
    }

    /// Enforces reserved namespaces and byte/shape bounds at the child-process boundary.
    #[test]
    fn rejects_reserved_or_unbounded_overrides() {
        for (key, value) in [
            ("PATH", "/tmp"),
            ("PICOCLAW_CONFIG", "/tmp"),
            ("LD_PRELOAD", "bad"),
            ("HYACINTHUS_CLAW_FENCE", "7"),
            ("lowercase", "value"),
            ("TOKEN", ""),
            ("TOKEN", "line\nbreak"),
        ] {
            let (root, digest) = fixture(BTreeMap::from([(key.into(), value.into())]));
            assert!(inputs(root.path(), &digest).is_err());
        }
        assert!(validate_environment(&BTreeMap::from([(
            "TOKEN".into(),
            "x".repeat(MAX_ENV_VALUE_BYTES + 1)
        )]))
        .is_err());
    }

    /// Rejects descriptor symlinks even when the linked bytes would have the expected digest.
    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_release_files() {
        let (root, digest) = fixture(BTreeMap::new());
        fs::rename(
            root.path().join("release.json"),
            root.path().join("source.json"),
        )
        .unwrap();
        std::os::unix::fs::symlink("source.json", root.path().join("release.json")).unwrap();
        assert!(inputs(root.path(), &digest).is_err());
    }
}
