//! System hardware detection for local AI model recommendations
//!
//! Detects available RAM and GPU capabilities to recommend appropriate model tiers.

use serde::{Deserialize, Serialize};

use super::model_registry::ModelTier;

/// GPU vendor classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpuVendor {
    Apple,
    Nvidia,
    Amd,
    Intel,
    Unknown,
}

/// Information about the system's GPU
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vendor: GpuVendor,
    pub vram_bytes: Option<u64>,
    pub metal_supported: bool,
    pub cuda_supported: bool,
}

/// Detected system capabilities for local AI inference
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCapabilities {
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub gpu_info: Option<GpuInfo>,
    pub recommended_tier: ModelTier,
    /// Whether GPU acceleration (Metal/CUDA) is available at inference time.
    /// If false, only small models should be recommended since CPU inference is slow.
    pub gpu_acceleration_available: bool,
}

const GB: u64 = 1_073_741_824;

/// Check whether GPU acceleration is available for llama.cpp inference.
///
/// On macOS ARM64, Metal is auto-enabled at compile time by llama-cpp-2.
/// On Linux/Windows with the `cuda` feature, CUDA is available.
fn detect_gpu_acceleration() -> bool {
    #[cfg(target_os = "macos")]
    {
        // llama-cpp-2 auto-enables Metal on macOS ARM64
        cfg!(target_arch = "aarch64")
    }

    #[cfg(not(target_os = "macos"))]
    {
        // CUDA is available when compiled with the cuda feature
        cfg!(feature = "cuda")
    }
}

/// Detect system capabilities for local AI inference.
pub fn detect() -> SystemCapabilities {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let total_ram_bytes = sys.total_memory();
    let available_ram_bytes = sys.available_memory();

    let gpu_info = detect_gpu();
    let gpu_acceleration_available = detect_gpu_acceleration();

    let recommended_tier = recommend_tier(total_ram_bytes, &gpu_info, gpu_acceleration_available);

    SystemCapabilities {
        total_ram_bytes,
        available_ram_bytes,
        gpu_info,
        recommended_tier,
        gpu_acceleration_available,
    }
}

/// Calculate the recommended model tier based on system capabilities.
///
/// `gpu_acceleration_available` indicates whether the binary has GPU acceleration
/// (Metal/CUDA) enabled and working. Without it, we cap at UltraLight (1B models)
/// since larger models are too slow on CPU.
pub fn recommend_tier(
    total_ram_bytes: u64,
    gpu_info: &Option<GpuInfo>,
    gpu_acceleration_available: bool,
) -> ModelTier {
    let has_capable_gpu = gpu_acceleration_available
        && gpu_info
            .as_ref()
            .map(|gpu| {
                // Apple Silicon (Metal) is always capable
                if gpu.vendor == GpuVendor::Apple && gpu.metal_supported {
                    return true;
                }
                // NVIDIA with >= 4GB VRAM
                if gpu.vendor == GpuVendor::Nvidia {
                    if let Some(vram) = gpu.vram_bytes {
                        return vram >= 4 * GB;
                    }
                }
                false
            })
            .unwrap_or(false);

    if total_ram_bytes >= 16 * GB && has_capable_gpu {
        ModelTier::Standard
    } else if total_ram_bytes >= 8 * GB {
        ModelTier::UltraLight
    } else {
        ModelTier::None
    }
}

/// Detect GPU information. Platform-specific implementation.
fn detect_gpu() -> Option<GpuInfo> {
    #[cfg(target_os = "macos")]
    {
        detect_gpu_macos()
    }

    #[cfg(target_os = "windows")]
    {
        detect_gpu_windows()
    }

    #[cfg(target_os = "linux")]
    {
        detect_gpu_linux()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn detect_gpu_macos() -> Option<GpuInfo> {
    let output = std::process::Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&json_str).ok()?;

    let displays = parsed.get("SPDisplaysDataType")?.as_array()?;
    let first = displays.first()?;

    let name = first
        .get("sppci_model")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown GPU")
        .to_string();

    // Detect vendor from chipset or model name
    let vendor = if name.contains("Apple") || first.get("sppci_vendor").is_none() {
        // Apple Silicon GPUs don't have a separate vendor field typically
        GpuVendor::Apple
    } else {
        let vendor_str = first
            .get("sppci_vendor")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if vendor_str.contains("NVIDIA") || vendor_str.contains("nvidia") {
            GpuVendor::Nvidia
        } else if vendor_str.contains("AMD") || vendor_str.contains("amd") {
            GpuVendor::Amd
        } else if vendor_str.contains("Intel") || vendor_str.contains("intel") {
            GpuVendor::Intel
        } else {
            GpuVendor::Unknown
        }
    };

    // On Apple Silicon, VRAM is shared with system RAM
    let vram_bytes = first
        .get("sppci_vram_shared")
        .or_else(|| first.get("sppci_vram"))
        .and_then(|v| v.as_str())
        .and_then(|s| {
            // Format is typically "X GB" or "X MB"
            let s = s.trim();
            if let Some(gb_str) = s.strip_suffix(" GB") {
                gb_str.trim().parse::<u64>().ok().map(|n| n * GB)
            } else if let Some(mb_str) = s.strip_suffix(" MB") {
                mb_str.trim().parse::<u64>().ok().map(|n| n * 1_048_576)
            } else {
                None
            }
        });

    let metal_supported = vendor == GpuVendor::Apple
        || first
            .get("sppci_metal_supported")
            .and_then(|v| v.as_str())
            .map(|s| s.contains("supported") || s.contains("spdisplays_supported"))
            .unwrap_or(false);

    Some(GpuInfo {
        name,
        vendor,
        vram_bytes,
        metal_supported,
        cuda_supported: false,
    })
}

#[cfg(target_os = "windows")]
fn detect_gpu_windows() -> Option<GpuInfo> {
    let output = std::process::Command::new("wmic")
        .args([
            "path",
            "win32_VideoController",
            "get",
            "Name,AdapterRAM",
            "/format:list",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut name = String::new();
    let mut vram_bytes: Option<u64> = None;

    for line in text.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("Name=") {
            name = val.to_string();
        } else if let Some(val) = line.strip_prefix("AdapterRAM=") {
            vram_bytes = val.parse::<u64>().ok();
        }
    }

    if name.is_empty() {
        return None;
    }

    let name_lower = name.to_lowercase();
    let vendor = if name_lower.contains("nvidia") || name_lower.contains("geforce") {
        GpuVendor::Nvidia
    } else if name_lower.contains("amd") || name_lower.contains("radeon") {
        GpuVendor::Amd
    } else if name_lower.contains("intel") {
        GpuVendor::Intel
    } else {
        GpuVendor::Unknown
    };

    let cuda_supported = vendor == GpuVendor::Nvidia;

    Some(GpuInfo {
        name,
        vendor,
        vram_bytes,
        metal_supported: false,
        cuda_supported,
    })
}

#[cfg(target_os = "linux")]
fn detect_gpu_linux() -> Option<GpuInfo> {
    // Try NVIDIA first via proc filesystem
    if let Some(info) = detect_nvidia_linux() {
        return Some(info);
    }

    // Fall back to lspci
    detect_gpu_lspci()
}

#[cfg(target_os = "linux")]
fn detect_nvidia_linux() -> Option<GpuInfo> {
    use std::fs;

    let nvidia_dir = std::path::Path::new("/proc/driver/nvidia/gpus");
    if !nvidia_dir.exists() {
        return None;
    }

    let entry = fs::read_dir(nvidia_dir).ok()?.next()?.ok()?;
    let info_path = entry.path().join("information");
    let content = fs::read_to_string(info_path).ok()?;

    let mut name = String::new();
    for line in content.lines() {
        if let Some(val) = line.strip_prefix("Model:") {
            name = val.trim().to_string();
            break;
        }
    }

    if name.is_empty() {
        name = "NVIDIA GPU".to_string();
    }

    // Try to get VRAM from nvidia-smi
    let vram_bytes = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()
        .and_then(|out| {
            let s = String::from_utf8_lossy(&out.stdout);
            s.trim().parse::<u64>().ok().map(|mb| mb * 1_048_576)
        });

    Some(GpuInfo {
        name,
        vendor: GpuVendor::Nvidia,
        vram_bytes,
        metal_supported: false,
        cuda_supported: true,
    })
}

#[cfg(target_os = "linux")]
fn detect_gpu_lspci() -> Option<GpuInfo> {
    let output = std::process::Command::new("lspci").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);

    // Look for VGA or 3D controller lines
    for line in text.lines() {
        if line.contains("VGA")
            || line.contains("3D controller")
            || line.contains("Display controller")
        {
            let name_lower = line.to_lowercase();
            let vendor = if name_lower.contains("nvidia") {
                GpuVendor::Nvidia
            } else if name_lower.contains("amd") || name_lower.contains("radeon") {
                GpuVendor::Amd
            } else if name_lower.contains("intel") {
                GpuVendor::Intel
            } else {
                GpuVendor::Unknown
            };

            // Extract name from after the colon
            let name = line
                .split(':')
                .nth(2)
                .unwrap_or("Unknown GPU")
                .trim()
                .to_string();

            return Some(GpuInfo {
                name,
                vendor,
                vram_bytes: None,
                metal_supported: false,
                cuda_supported: vendor == GpuVendor::Nvidia,
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recommend_tier_standard_apple_silicon() {
        let gpu = Some(GpuInfo {
            name: "Apple M1".to_string(),
            vendor: GpuVendor::Apple,
            vram_bytes: None,
            metal_supported: true,
            cuda_supported: false,
        });
        assert_eq!(recommend_tier(16 * GB, &gpu, true), ModelTier::Standard);
    }

    #[test]
    fn test_recommend_tier_standard_nvidia() {
        let gpu = Some(GpuInfo {
            name: "NVIDIA RTX 3060".to_string(),
            vendor: GpuVendor::Nvidia,
            vram_bytes: Some(6 * GB),
            metal_supported: false,
            cuda_supported: true,
        });
        assert_eq!(recommend_tier(16 * GB, &gpu, true), ModelTier::Standard);
    }

    #[test]
    fn test_recommend_tier_ultralight_low_vram() {
        let gpu = Some(GpuInfo {
            name: "NVIDIA GTX 1050".to_string(),
            vendor: GpuVendor::Nvidia,
            vram_bytes: Some(2 * GB),
            metal_supported: false,
            cuda_supported: true,
        });
        // 16GB RAM but GPU only has 2GB VRAM — falls to UltraLight
        assert_eq!(recommend_tier(16 * GB, &gpu, true), ModelTier::UltraLight);
    }

    #[test]
    fn test_recommend_tier_ultralight_enough_ram() {
        assert_eq!(recommend_tier(8 * GB, &None, false), ModelTier::UltraLight);
    }

    #[test]
    fn test_recommend_tier_none_low_ram() {
        assert_eq!(recommend_tier(4 * GB, &None, false), ModelTier::None);
    }

    #[test]
    fn test_recommend_tier_ultralight_no_gpu() {
        // 16GB RAM but no GPU at all — UltraLight (not Standard)
        assert_eq!(recommend_tier(16 * GB, &None, false), ModelTier::UltraLight);
    }

    #[test]
    fn test_recommend_tier_amd_gpu_not_standard() {
        let gpu = Some(GpuInfo {
            name: "AMD Radeon RX 6800".to_string(),
            vendor: GpuVendor::Amd,
            vram_bytes: Some(16 * GB),
            metal_supported: false,
            cuda_supported: false,
        });
        // AMD GPUs don't qualify for Standard tier (no CUDA/Metal)
        assert_eq!(recommend_tier(16 * GB, &gpu, true), ModelTier::UltraLight);
    }

    #[test]
    fn test_recommend_tier_cpu_only_caps_at_ultralight() {
        let gpu = Some(GpuInfo {
            name: "Apple M3 Max".to_string(),
            vendor: GpuVendor::Apple,
            vram_bytes: None,
            metal_supported: true,
            cuda_supported: false,
        });
        // GPU hardware present but acceleration not available (CPU-only build)
        assert_eq!(recommend_tier(48 * GB, &gpu, false), ModelTier::UltraLight);
    }

    #[test]
    fn test_detect_runs_without_panic() {
        // Smoke test: detect() should not panic regardless of platform
        let caps = detect();
        assert!(caps.total_ram_bytes > 0);
    }

    #[test]
    fn test_gpu_vendor_serialization() {
        let vendor = GpuVendor::Apple;
        let json = serde_json::to_string(&vendor).unwrap();
        assert_eq!(json, "\"apple\"");

        let deserialized: GpuVendor = serde_json::from_str("\"nvidia\"").unwrap();
        assert_eq!(deserialized, GpuVendor::Nvidia);
    }

    #[test]
    fn test_system_capabilities_serialization() {
        let caps = SystemCapabilities {
            total_ram_bytes: 16 * GB,
            available_ram_bytes: 8 * GB,
            gpu_info: None,
            recommended_tier: ModelTier::UltraLight,
            gpu_acceleration_available: false,
        };
        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains("\"totalRamBytes\""));
        assert!(json.contains("\"recommendedTier\""));
        assert!(json.contains("\"gpuAccelerationAvailable\""));
    }
}
