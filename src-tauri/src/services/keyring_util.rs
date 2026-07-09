//! Chunked keyring storage (non-macOS backends).
//!
//! The Windows Credential Manager caps a single credential's secret at 2560
//! bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`), which the `keyring` crate surfaces as
//! *"Attribute 'password encoded as UTF-16' is longer than platform limit of 2560
//! chars"*. Microsoft Entra access tokens (JWTs) — especially in large tenants
//! whose tokens carry many group claims — routinely exceed this, so storing an
//! OAuth token or an OAuth bundle (access + refresh + expiry JSON) fails outright.
//!
//! This module transparently splits an oversized secret across several keyring
//! entries and reassembles it on read, so callers can store a secret of any size.
//! Short secrets (PATs, small tokens) are stored verbatim under the original key,
//! so existing entries keep working unchanged.
//!
//! macOS is handled separately by the callers (via the `security` CLI, which
//! reads the secret from stdin and has no such small limit), so this module is
//! only compiled for non-macOS targets.
#![cfg(not(target_os = "macos"))]

use keyring::{Entry, Error};

/// Maximum characters per keyring entry. Windows measures the UTF-16 length of
/// the secret; our secrets are ASCII (base64url JWTs, alphanumeric PATs, JSON),
/// i.e. one UTF-16 code unit per char, so 1000 chars stays comfortably under the
/// 2560 limit whether the backend counts code units (1000) or bytes (2000).
const MAX_CHARS_PER_ENTRY: usize = 1000;

/// Prefix written (with the chunk count appended) under the primary key when a
/// secret was chunked. The `|` guarantees no collision with a real secret: it is
/// absent from the base64url alphabet (JWTs / most tokens), and our JSON bundles
/// start with `{` — so no value we store can equal `<MARKER><digits>`.
const CHUNK_MARKER: &str = "__LV_CHUNKED_V1__|";

/// Build a distinct keyring account name for chunk `i` of `account`.
fn chunk_account(account: &str, i: usize) -> String {
    format!("{account}__lvchunk{i}")
}

/// Split `secret` into `MAX_CHARS_PER_ENTRY`-sized pieces on char boundaries
/// (never mid-UTF-8-sequence). Pure — unit-tested below.
fn split_into_chunks(secret: &str) -> Vec<String> {
    secret
        .chars()
        .collect::<Vec<char>>()
        .chunks(MAX_CHARS_PER_ENTRY)
        .map(|c| c.iter().collect())
        .collect()
}

/// The marker value written under the primary key for an `n`-chunk secret.
fn marker_for(n: usize) -> String {
    format!("{CHUNK_MARKER}{n}")
}

/// If `value` is a chunk marker, return the chunk count it encodes. Pure.
fn parse_marker(value: &str) -> Option<usize> {
    value
        .strip_prefix(CHUNK_MARKER)
        .and_then(|n| n.parse().ok())
}

fn entry(service: &str, account: &str) -> Result<Entry, Error> {
    Entry::new(service, account)
}

/// Store `secret`, chunking transparently when it exceeds one entry's capacity.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), Error> {
    // Clear any prior value (chunked or not) first, so a shrink from N chunks to
    // a plain value — or to fewer chunks — never leaves orphaned chunk entries.
    let _ = delete(service, account);

    if secret.chars().count() <= MAX_CHARS_PER_ENTRY {
        return entry(service, account)?.set_password(secret);
    }

    let chunks = split_into_chunks(secret);
    for (i, chunk) in chunks.iter().enumerate() {
        entry(service, &chunk_account(account, i))?.set_password(chunk)?;
    }
    // Write the marker LAST, so a reader that sees the marker is guaranteed all
    // chunks it points at are already present.
    entry(service, account)?.set_password(&marker_for(chunks.len()))
}

/// Read a secret, reassembling chunks when present. `Ok(None)` if absent.
pub fn get(service: &str, account: &str) -> Result<Option<String>, Error> {
    let head = match entry(service, account)?.get_password() {
        Ok(v) => v,
        Err(Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e),
    };

    let Some(n) = parse_marker(&head) else {
        return Ok(Some(head)); // plain (non-chunked) secret
    };

    let mut out = String::new();
    for i in 0..n {
        match entry(service, &chunk_account(account, i))?.get_password() {
            Ok(part) => out.push_str(&part),
            // A missing chunk means a partial/corrupt write — treat the whole
            // secret as absent rather than returning a truncated token.
            Err(Error::NoEntry) => return Ok(None),
            Err(e) => return Err(e),
        }
    }
    Ok(Some(out))
}

/// Delete a secret and any chunk entries it owns.
pub fn delete(service: &str, account: &str) -> Result<(), Error> {
    let head = match entry(service, account)?.get_password() {
        Ok(v) => Some(v),
        Err(Error::NoEntry) => None,
        Err(e) => return Err(e),
    };

    if let Some(head) = &head {
        if let Some(n) = parse_marker(head) {
            for i in 0..n {
                if let Ok(e) = entry(service, &chunk_account(account, i)) {
                    let _ = e.delete_credential();
                }
            }
        }
        let _ = entry(service, account)?.delete_credential();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_short_secret_is_single_chunk() {
        let chunks = split_into_chunks("short-token");
        assert_eq!(chunks, vec!["short-token".to_string()]);
    }

    #[test]
    fn test_split_respects_max_chars_and_roundtrips() {
        let secret: String = "a".repeat(2500);
        let chunks = split_into_chunks(&secret);
        assert_eq!(chunks.len(), 3); // 1000 + 1000 + 500
        assert!(chunks
            .iter()
            .all(|c| c.chars().count() <= MAX_CHARS_PER_ENTRY));
        assert_eq!(chunks.concat(), secret);
    }

    #[test]
    fn test_split_boundary_exact_multiple() {
        let secret: String = "x".repeat(MAX_CHARS_PER_ENTRY * 2);
        let chunks = split_into_chunks(&secret);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks.concat(), secret);
    }

    #[test]
    fn test_marker_roundtrips() {
        assert_eq!(parse_marker(&marker_for(4)), Some(4));
        assert_eq!(parse_marker(&marker_for(1)), Some(1));
    }

    #[test]
    fn test_parse_marker_ignores_real_secrets() {
        // A base64url JWT, a JSON bundle, and a PAT must never look like a marker.
        assert_eq!(
            parse_marker("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc"),
            None
        );
        assert_eq!(parse_marker("{\"accessToken\":\"eyJ...\"}"), None);
        assert_eq!(parse_marker("abcdef0123456789ABCDEF"), None);
        // The marker prefix without a valid count is not a marker either.
        assert_eq!(parse_marker(CHUNK_MARKER), None);
        assert_eq!(parse_marker(&format!("{CHUNK_MARKER}notanumber")), None);
    }

    #[test]
    fn test_chunk_account_is_distinct_and_indexed() {
        assert_eq!(chunk_account("acct", 0), "acct__lvchunk0");
        assert_ne!(chunk_account("acct", 0), chunk_account("acct", 1));
    }
}
