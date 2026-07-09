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
//! ## Layout
//! - A separate metadata entry `"{account}__lvmeta"` holds `"{count}:{slot}"` when
//!   the secret is chunked, and is ABSENT for a plain (unchunked) secret. Keeping
//!   the chunk marker out-of-band means a plain secret can never be misread as a
//!   marker, no matter its contents (relevant for the arbitrary git-password path).
//! - Chunks live under `"{account}__lvchunk{slot}_{i}"`. `slot` (0/1) alternates
//!   on each rewrite so a new generation is written to fresh keys, leaving the old
//!   generation fully intact until the metadata write commits the switch. A write
//!   failure mid-sequence therefore preserves the previously-stored value rather
//!   than destroying it.
//!
//! macOS is handled separately by the callers (via the `security` CLI, which
//! reads the secret from stdin and has no such small limit), so this module is
//! only compiled for non-macOS targets.
#![cfg(not(target_os = "macos"))]

use keyring::{Entry, Error};

/// Maximum UTF-16 code units per keyring entry. Windows measures the secret's
/// UTF-16 length against the 2560-byte (1280-unit) cap; budgeting by UTF-16 units
/// — not Rust `char`s — keeps each chunk safely under it even for astral-plane
/// characters (2 units each), which matters because the arbitrary git-password
/// path shares this code. 1200 units = 2400 bytes, comfortably below 2560.
const MAX_UTF16_UNITS_PER_ENTRY: usize = 1200;

/// Keyring account name of the out-of-band chunk metadata for `account`.
fn meta_account(account: &str) -> String {
    format!("{account}__lvmeta")
}

/// Keyring account name for chunk `i` of generation `slot` of `account`.
fn chunk_account(account: &str, slot: u8, i: usize) -> String {
    format!("{account}__lvchunk{slot}_{i}")
}

/// Split `secret` into pieces each within `MAX_UTF16_UNITS_PER_ENTRY` UTF-16
/// units, never splitting a `char`. Pure — unit-tested below.
fn split_into_chunks(secret: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for ch in secret.chars() {
        let ch_units = ch.len_utf16();
        if units + ch_units > MAX_UTF16_UNITS_PER_ENTRY && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            units = 0;
        }
        current.push(ch);
        units += ch_units;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Format the metadata value for a `count`-chunk secret in generation `slot`.
fn format_meta(count: usize, slot: u8) -> String {
    format!("{count}:{slot}")
}

/// Parse a metadata value into `(count, slot)`. Pure.
fn parse_meta(value: &str) -> Option<(usize, u8)> {
    let (count, slot) = value.split_once(':')?;
    Some((count.parse().ok()?, slot.parse().ok()?))
}

fn entry(service: &str, account: &str) -> Result<Entry, Error> {
    Entry::new(service, account)
}

/// Best-effort delete of a single credential (missing is fine).
fn delete_quietly(service: &str, account: &str) {
    if let Ok(e) = entry(service, account) {
        let _ = e.delete_credential();
    }
}

/// Read the chunk metadata for `account`, if present.
fn read_meta(service: &str, account: &str) -> Option<(usize, u8)> {
    let value = entry(service, &meta_account(account))
        .ok()?
        .get_password()
        .ok()?;
    parse_meta(&value)
}

/// Store `secret`, chunking transparently when it exceeds one entry's capacity.
///
/// Failure-atomic: the previously-stored value stays readable until the switch is
/// committed (metadata write for a chunked secret; primary overwrite for a plain
/// one), so a mid-sequence keyring error never leaves the account without a token.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), Error> {
    let old = read_meta(service, account);

    if secret.encode_utf16().count() <= MAX_UTF16_UNITS_PER_ENTRY {
        // Plain: overwrite the primary key atomically (in-place replace). Only
        // AFTER that succeeds do we drop any prior chunked generation, so a
        // failure here leaves the old value intact.
        entry(service, account)?.set_password(secret)?;
        if let Some((count, slot)) = old {
            delete_quietly(service, &meta_account(account));
            for i in 0..count {
                delete_quietly(service, &chunk_account(account, slot, i));
            }
        }
        return Ok(());
    }

    // Chunked: write the new generation to the OTHER slot so the old generation is
    // untouched, then commit by writing the metadata. A failure before the commit
    // leaves the old metadata + old chunks fully intact.
    let new_slot = match old {
        Some((_, 0)) => 1,
        _ => 0,
    };
    let chunks = split_into_chunks(secret);
    for (i, chunk) in chunks.iter().enumerate() {
        entry(service, &chunk_account(account, new_slot, i))?.set_password(chunk)?;
    }
    // COMMIT — from here reads resolve to the new generation.
    entry(service, &meta_account(account))?.set_password(&format_meta(chunks.len(), new_slot))?;

    // Best-effort cleanup of the previous generation and any stale plain primary.
    delete_quietly(service, account);
    if let Some((count, slot)) = old {
        for i in 0..count {
            delete_quietly(service, &chunk_account(account, slot, i));
        }
    }
    Ok(())
}

/// Read a secret, reassembling chunks when present. `Ok(None)` if absent.
pub fn get(service: &str, account: &str) -> Result<Option<String>, Error> {
    if let Some((count, slot)) = read_meta(service, account) {
        let mut out = String::new();
        for i in 0..count {
            match entry(service, &chunk_account(account, slot, i))?.get_password() {
                Ok(part) => out.push_str(&part),
                // A missing chunk means a partial/corrupt write — treat the whole
                // secret as absent rather than returning a truncated token.
                Err(Error::NoEntry) => return Ok(None),
                Err(e) => return Err(e),
            }
        }
        return Ok(Some(out));
    }

    match entry(service, account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Delete a secret and any chunk/metadata entries it owns.
pub fn delete(service: &str, account: &str) -> Result<(), Error> {
    if let Some((count, slot)) = read_meta(service, account) {
        for i in 0..count {
            delete_quietly(service, &chunk_account(account, slot, i));
        }
        delete_quietly(service, &meta_account(account));
    }
    match entry(service, account)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16_len(s: &str) -> usize {
        s.encode_utf16().count()
    }

    #[test]
    fn test_split_short_secret_is_single_chunk() {
        assert_eq!(
            split_into_chunks("short-token"),
            vec!["short-token".to_string()]
        );
    }

    #[test]
    fn test_split_ascii_respects_budget_and_roundtrips() {
        let secret: String = "a".repeat(2500);
        let chunks = split_into_chunks(&secret);
        assert_eq!(chunks.len(), 3); // 1200 + 1200 + 100
        assert!(chunks
            .iter()
            .all(|c| utf16_len(c) <= MAX_UTF16_UNITS_PER_ENTRY));
        assert_eq!(chunks.concat(), secret);
    }

    #[test]
    fn test_split_astral_chars_budgets_by_utf16_units_not_chars() {
        // Each 😀 is 2 UTF-16 code units. 700 of them = 1400 units > one entry,
        // and a naive char-count split (1000) would put 1000*2=2000 units in a
        // chunk, overflowing the cap. Budgeting by units must not.
        let secret: String = "😀".repeat(700);
        let chunks = split_into_chunks(&secret);
        assert!(chunks.len() >= 2);
        assert!(
            chunks
                .iter()
                .all(|c| utf16_len(c) <= MAX_UTF16_UNITS_PER_ENTRY),
            "every chunk must stay within the UTF-16 unit budget"
        );
        assert_eq!(chunks.concat(), secret); // no char was split
    }

    #[test]
    fn test_split_boundary_exact_multiple() {
        let secret: String = "x".repeat(MAX_UTF16_UNITS_PER_ENTRY * 2);
        let chunks = split_into_chunks(&secret);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks.concat(), secret);
    }

    #[test]
    fn test_meta_roundtrips() {
        assert_eq!(parse_meta(&format_meta(4, 0)), Some((4, 0)));
        assert_eq!(parse_meta(&format_meta(1, 1)), Some((1, 1)));
    }

    #[test]
    fn test_parse_meta_rejects_junk() {
        // A real secret in the primary key is never parsed as metadata (metadata
        // lives under a separate account), but parse_meta must still be strict.
        assert_eq!(parse_meta("eyJhbGciOiJSUzI1NiJ9.abc"), None);
        assert_eq!(parse_meta("{\"accessToken\":\"x\"}"), None);
        assert_eq!(parse_meta("3"), None); // no slot
        assert_eq!(parse_meta("3:x"), None); // non-numeric slot
        assert_eq!(parse_meta("x:0"), None); // non-numeric count
        assert_eq!(parse_meta(""), None);
    }

    #[test]
    fn test_chunk_and_meta_accounts_are_distinct() {
        assert_eq!(chunk_account("acct", 0, 0), "acct__lvchunk0_0");
        assert_eq!(chunk_account("acct", 1, 2), "acct__lvchunk1_2");
        assert_ne!(chunk_account("acct", 0, 0), chunk_account("acct", 1, 0));
        assert_ne!(chunk_account("acct", 0, 0), chunk_account("acct", 0, 1));
        assert_eq!(meta_account("acct"), "acct__lvmeta");
        assert_ne!(meta_account("acct"), chunk_account("acct", 0, 0));
    }
}
