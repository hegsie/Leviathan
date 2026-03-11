//! Local AI inference system
//!
//! Provides local model management, system detection, and inference
//! for privacy-first AI features.

pub mod model_manager;
pub mod model_registry;
pub mod system_detect;

pub use model_manager::ModelManager;
pub use model_registry::{ModelEntry, ModelRegistry, ModelTier};
pub use system_detect::{GpuInfo, GpuVendor, SystemCapabilities};
