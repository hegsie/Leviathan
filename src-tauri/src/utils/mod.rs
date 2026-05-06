//! Utility modules

pub mod cli_safety;
mod command;

pub use cli_safety::reject_flag_like;
pub use command::create_command;
