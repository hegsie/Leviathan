//! Embedding pipeline and semantic search infrastructure
//!
//! Provides ONNX-based text embedding, per-repository SQLite vector storage
//! with sqlite-vec for cosine similarity search, and an orchestrating index
//! service that ties everything together.

pub mod embedding_index;
pub mod embedding_model;
#[cfg(feature = "embedding-onnx")]
pub mod onnx_engine;
pub mod vector_store;

pub use embedding_index::{EmbeddingIndexState, SharedEmbeddingIndex};
pub use vector_store::{EmbeddingIndexStatus, VectorSearchResult};
