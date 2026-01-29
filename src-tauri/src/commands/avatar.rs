//! Avatar command handlers
//! Generate Gravatar URLs and fallback avatar info from email addresses

use tauri::command;

use crate::error::Result;

/// Avatar information for a user
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarInfo {
    pub email: String,
    pub gravatar_url: String,
    pub initials: String,
    pub color: String,
}

/// Compute MD5 hash of a byte slice and return the hex string.
///
/// This is a self-contained MD5 implementation used solely for generating
/// Gravatar URL hashes. We avoid pulling in an external crate for this
/// single, non-security-critical use case.
fn md5_hex(input: &[u8]) -> String {
    // MD5 constants
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];

    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    // Pre-processing: adding padding bits
    let orig_len_bits = (input.len() as u64) * 8;
    let mut msg = input.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    // Append original length in bits as 64-bit little-endian
    msg.extend_from_slice(&orig_len_bits.to_le_bytes());

    // Initialize hash values
    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    // Process each 512-bit (64-byte) chunk
    for chunk in msg.chunks(64) {
        let mut m = [0u32; 16];
        for (i, word) in m.iter_mut().enumerate() {
            let offset = i * 4;
            *word = u32::from_le_bytes([
                chunk[offset],
                chunk[offset + 1],
                chunk[offset + 2],
                chunk[offset + 3],
            ]);
        }

        let mut a = a0;
        let mut b = b0;
        let mut c = c0;
        let mut d = d0;

        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };

            let f = f.wrapping_add(a).wrapping_add(K[i]).wrapping_add(m[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f.rotate_left(S[i]));
        }

        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    // Produce the final hash as hex string (little-endian bytes)
    let digest = [
        a0.to_le_bytes(),
        b0.to_le_bytes(),
        c0.to_le_bytes(),
        d0.to_le_bytes(),
    ]
    .concat();

    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Build an AvatarInfo from an email address
fn build_avatar_info(email: &str, size: u32) -> AvatarInfo {
    let normalized = email.trim().to_lowercase();
    let hash = md5_hex(normalized.as_bytes());

    let gravatar_url = format!("https://www.gravatar.com/avatar/{}?s={}&d=404", hash, size);

    let initials = generate_initials(&normalized);
    // Use first 6 hex chars of the hash as the color
    let color = format!("#{}", &hash[..6]);

    AvatarInfo {
        email: normalized,
        gravatar_url,
        initials,
        color,
    }
}

/// Generate initials from an email address.
///
/// Uses the local part (before @). If it contains a dot or underscore, takes
/// the first letter of each segment (up to 2). Otherwise uses the first two
/// characters of the local part.
fn generate_initials(email: &str) -> String {
    let local = email.split('@').next().unwrap_or(email);

    // Try to split on common separators
    let parts: Vec<&str> = local.split(['.', '_', '-']).collect();

    let initials = if parts.len() >= 2 {
        let first = parts[0].chars().next().unwrap_or(' ');
        let second = parts[1].chars().next().unwrap_or(' ');
        format!("{}{}", first, second)
    } else {
        // Just take first two chars
        local.chars().take(2).collect::<String>()
    };

    initials.to_uppercase()
}

/// Get avatar info for a single email address
#[command]
pub async fn get_avatar_url(email: String, size: Option<u32>) -> Result<AvatarInfo> {
    let size = size.unwrap_or(40);
    Ok(build_avatar_info(&email, size))
}

/// Get avatar info for multiple email addresses (batch)
#[command]
pub async fn get_avatar_urls(emails: Vec<String>, size: Option<u32>) -> Result<Vec<AvatarInfo>> {
    let size = size.unwrap_or(40);
    let results = emails
        .iter()
        .map(|email| build_avatar_info(email, size))
        .collect();
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_md5_hex_empty() {
        // MD5("") = d41d8cd98f00b204e9800998ecf8427e
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
    }

    #[test]
    fn test_md5_hex_hello() {
        // MD5("hello") = 5d41402abc4b2a76b9719d911017c592
        assert_eq!(md5_hex(b"hello"), "5d41402abc4b2a76b9719d911017c592");
    }

    #[test]
    fn test_md5_hex_email() {
        // MD5("test@example.com") = 55502f40dc8b7c769880b10874abc9d0
        assert_eq!(
            md5_hex(b"test@example.com"),
            "55502f40dc8b7c769880b10874abc9d0"
        );
    }

    #[test]
    fn test_generate_initials_simple() {
        assert_eq!(generate_initials("john@example.com"), "JO");
    }

    #[test]
    fn test_generate_initials_dotted() {
        assert_eq!(generate_initials("john.doe@example.com"), "JD");
    }

    #[test]
    fn test_generate_initials_underscore() {
        assert_eq!(generate_initials("jane_smith@example.com"), "JS");
    }

    #[test]
    fn test_generate_initials_hyphen() {
        assert_eq!(generate_initials("mary-jane@example.com"), "MJ");
    }

    #[test]
    fn test_build_avatar_info() {
        let info = build_avatar_info("Test@Example.com", 40);
        // Email should be normalized to lowercase and trimmed
        assert_eq!(info.email, "test@example.com");
        // Gravatar URL should use the md5 hash
        let expected_hash = md5_hex(b"test@example.com");
        assert!(info.gravatar_url.contains(&expected_hash));
        assert!(info.gravatar_url.contains("s=40"));
        assert!(info.gravatar_url.contains("d=404"));
        // Color should be a valid hex color
        assert!(info.color.starts_with('#'));
        assert_eq!(info.color.len(), 7);
    }

    #[test]
    fn test_build_avatar_info_custom_size() {
        let info = build_avatar_info("user@test.org", 80);
        assert!(info.gravatar_url.contains("s=80"));
    }

    #[tokio::test]
    async fn test_get_avatar_url_default_size() {
        let result = get_avatar_url("user@test.org".into(), None).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.gravatar_url.contains("s=40"));
    }

    #[tokio::test]
    async fn test_get_avatar_url_custom_size() {
        let result = get_avatar_url("user@test.org".into(), Some(64)).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.gravatar_url.contains("s=64"));
    }

    #[tokio::test]
    async fn test_get_avatar_urls_batch() {
        let emails = vec![
            "alice@example.com".into(),
            "bob@example.com".into(),
            "carol@example.com".into(),
        ];
        let result = get_avatar_urls(emails, Some(32)).await;
        assert!(result.is_ok());
        let infos = result.unwrap();
        assert_eq!(infos.len(), 3);
        assert_eq!(infos[0].email, "alice@example.com");
        assert_eq!(infos[1].email, "bob@example.com");
        assert_eq!(infos[2].email, "carol@example.com");
    }

    #[tokio::test]
    async fn test_get_avatar_urls_empty() {
        let result = get_avatar_urls(vec![], None).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_email_normalization() {
        let info1 = build_avatar_info("User@Example.COM", 40);
        let info2 = build_avatar_info("user@example.com", 40);
        assert_eq!(info1.gravatar_url, info2.gravatar_url);
        assert_eq!(info1.color, info2.color);
    }

    #[test]
    fn test_email_trimming() {
        let info1 = build_avatar_info("  user@example.com  ", 40);
        let info2 = build_avatar_info("user@example.com", 40);
        assert_eq!(info1.gravatar_url, info2.gravatar_url);
    }

    #[test]
    fn test_consistent_color() {
        // Same email should always produce the same color
        let info1 = build_avatar_info("test@example.com", 40);
        let info2 = build_avatar_info("test@example.com", 80);
        assert_eq!(info1.color, info2.color);
    }
}
