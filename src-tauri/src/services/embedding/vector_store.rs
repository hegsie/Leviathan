//! Per-repository SQLite vector storage using sqlite-vec
//!
//! Stores commit embeddings as binary blobs and provides cosine similarity
//! search via the sqlite-vec extension's virtual tables.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Once;

use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use serde::{Deserialize, Serialize};

/// Register sqlite-vec as an auto-extension (once globally)
#[allow(clippy::missing_transmute_annotations)]
fn ensure_sqlite_vec_registered() {
    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

/// A search result from the vector store
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchResult {
    pub oid: String,
    pub distance: f32,
    pub summary: String,
}

/// Status of the embedding index for a repository
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingIndexStatus {
    pub total_commits: usize,
    pub indexed_commits: usize,
    pub is_building: bool,
    pub is_ready: bool,
    pub model_downloaded: bool,
}

/// Vector store backed by SQLite + sqlite-vec
pub struct VectorStore {
    conn: Connection,
}

impl VectorStore {
    /// Open or create the vector store database at the given path.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        ensure_sqlite_vec_registered();

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create embedding index directory: {}", e))?;
        }

        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open embedding database: {}", e))?;

        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    /// Open an in-memory vector store (for testing)
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        ensure_sqlite_vec_registered();

        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory database: {}", e))?;

        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    /// Initialize the database schema
    fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS commit_embeddings (
                    oid TEXT PRIMARY KEY,
                    summary TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS vec_commits USING vec0(
                    embedding float[384]
                );
            ",
            )
            .map_err(|e| format!("Failed to initialize schema: {}", e))?;

        Ok(())
    }

    /// Insert or update a single commit embedding
    pub fn upsert_embedding(
        &self,
        oid: &str,
        summary: &str,
        embedding: &[f32],
    ) -> Result<(), String> {
        let blob = embedding_to_blob(embedding);

        // First, check if a row already exists
        let existing_rowid: Option<i64> = self
            .conn
            .query_row(
                "SELECT rowid FROM commit_embeddings WHERE oid = ?1",
                params![oid],
                |row| row.get(0),
            )
            .ok();

        if let Some(rowid) = existing_rowid {
            // Update existing
            self.conn
                .execute(
                    "UPDATE commit_embeddings SET summary = ?1, embedding = ?2, indexed_at = unixepoch() WHERE oid = ?3",
                    params![summary, blob, oid],
                )
                .map_err(|e| format!("Failed to update embedding: {}", e))?;

            self.conn
                .execute(
                    "UPDATE vec_commits SET embedding = ?1 WHERE rowid = ?2",
                    params![blob, rowid],
                )
                .map_err(|e| format!("Failed to update vector index: {}", e))?;
        } else {
            // Insert new
            self.conn
                .execute(
                    "INSERT INTO commit_embeddings (oid, summary, embedding) VALUES (?1, ?2, ?3)",
                    params![oid, summary, blob],
                )
                .map_err(|e| format!("Failed to insert embedding: {}", e))?;

            let rowid = self.conn.last_insert_rowid();

            self.conn
                .execute(
                    "INSERT INTO vec_commits (rowid, embedding) VALUES (?1, ?2)",
                    params![rowid, blob],
                )
                .map_err(|e| format!("Failed to insert into vector index: {}", e))?;
        }

        Ok(())
    }

    /// Batch insert embeddings within a transaction for speed
    pub fn upsert_embeddings_batch(
        &self,
        items: &[(String, String, Vec<f32>)],
    ) -> Result<(), String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        for (oid, summary, embedding) in items {
            let blob = embedding_to_blob(embedding);

            let existing_rowid: Option<i64> = tx
                .query_row(
                    "SELECT rowid FROM commit_embeddings WHERE oid = ?1",
                    params![oid],
                    |row| row.get(0),
                )
                .ok();

            if let Some(rowid) = existing_rowid {
                tx.execute(
                    "UPDATE commit_embeddings SET summary = ?1, embedding = ?2, indexed_at = unixepoch() WHERE oid = ?3",
                    params![summary, blob, oid],
                )
                .map_err(|e| format!("Failed to update embedding: {}", e))?;

                tx.execute(
                    "UPDATE vec_commits SET embedding = ?1 WHERE rowid = ?2",
                    params![blob, rowid],
                )
                .map_err(|e| format!("Failed to update vector index: {}", e))?;
            } else {
                tx.execute(
                    "INSERT INTO commit_embeddings (oid, summary, embedding) VALUES (?1, ?2, ?3)",
                    params![oid, summary, blob],
                )
                .map_err(|e| format!("Failed to insert embedding: {}", e))?;

                let rowid = tx.last_insert_rowid();

                tx.execute(
                    "INSERT INTO vec_commits (rowid, embedding) VALUES (?1, ?2)",
                    params![rowid, blob],
                )
                .map_err(|e| format!("Failed to insert into vector index: {}", e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;

        Ok(())
    }

    /// Get the set of all indexed commit OIDs
    pub fn get_indexed_oids(&self) -> Result<HashSet<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT oid FROM commit_embeddings")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let oids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query OIDs: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(oids)
    }

    /// Count of indexed commits
    pub fn count(&self) -> Result<usize, String> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM commit_embeddings", [], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Failed to count embeddings: {}", e))?;

        Ok(count as usize)
    }

    /// Perform cosine similarity search.
    /// Returns the top `limit` results closest to the query vector.
    /// `min_similarity` filters out results below the threshold (0.0-1.0).
    pub fn search_similar(
        &self,
        query_embedding: &[f32],
        limit: usize,
        min_similarity: f32,
    ) -> Result<Vec<VectorSearchResult>, String> {
        let query_blob = embedding_to_blob(query_embedding);
        let max_distance = 1.0 - min_similarity;

        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT
                    ce.oid,
                    ce.summary,
                    vc.distance
                FROM vec_commits vc
                JOIN commit_embeddings ce ON ce.rowid = vc.rowid
                WHERE vc.embedding MATCH ?1
                    AND k = ?2
                    AND vc.distance <= ?3
                ORDER BY vc.distance ASC
            ",
            )
            .map_err(|e| format!("Failed to prepare search query: {}", e))?;

        let results = stmt
            .query_map(params![query_blob, limit as i64, max_distance], |row| {
                Ok(VectorSearchResult {
                    oid: row.get(0)?,
                    summary: row.get(1)?,
                    distance: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to execute search: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(results)
    }

    /// Delete all embeddings (for full rebuild)
    pub fn clear(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                DELETE FROM vec_commits;
                DELETE FROM commit_embeddings;
            ",
            )
            .map_err(|e| format!("Failed to clear embeddings: {}", e))?;

        Ok(())
    }
}

/// Convert a float vector to a byte blob for SQLite storage
fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_embedding(seed: f32) -> Vec<f32> {
        let mut v: Vec<f32> = (0..384).map(|i| (i as f32 * seed).sin()).collect();
        // L2 normalize
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut v {
                *x /= norm;
            }
        }
        v
    }

    #[test]
    fn test_open_and_init_schema() {
        let store = VectorStore::open_in_memory().unwrap();
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn test_upsert_and_count() {
        let store = VectorStore::open_in_memory().unwrap();
        let emb = make_test_embedding(1.0);

        store
            .upsert_embedding("abc123", "Add feature", &emb)
            .unwrap();
        assert_eq!(store.count().unwrap(), 1);
    }

    #[test]
    fn test_upsert_batch() {
        let store = VectorStore::open_in_memory().unwrap();
        let items: Vec<(String, String, Vec<f32>)> = (0..5)
            .map(|i| {
                (
                    format!("oid{}", i),
                    format!("Commit {}", i),
                    make_test_embedding(i as f32 + 0.1),
                )
            })
            .collect();

        store.upsert_embeddings_batch(&items).unwrap();
        assert_eq!(store.count().unwrap(), 5);
    }

    #[test]
    fn test_get_indexed_oids() {
        let store = VectorStore::open_in_memory().unwrap();
        let emb1 = make_test_embedding(1.0);
        let emb2 = make_test_embedding(2.0);

        store.upsert_embedding("aaa", "First", &emb1).unwrap();
        store.upsert_embedding("bbb", "Second", &emb2).unwrap();

        let oids = store.get_indexed_oids().unwrap();
        assert_eq!(oids.len(), 2);
        assert!(oids.contains("aaa"));
        assert!(oids.contains("bbb"));
    }

    #[test]
    fn test_search_similar() {
        let store = VectorStore::open_in_memory().unwrap();

        // Insert embeddings with different seeds so they're distinguishable
        let emb1 = make_test_embedding(1.0);
        let emb2 = make_test_embedding(2.0);
        let emb3 = make_test_embedding(3.0);

        store.upsert_embedding("a", "Fix auth bug", &emb1).unwrap();
        store
            .upsert_embedding("b", "Add new feature", &emb2)
            .unwrap();
        store
            .upsert_embedding("c", "Update dependencies", &emb3)
            .unwrap();

        // Search with a vector close to emb1
        let results = store.search_similar(&emb1, 3, 0.0).unwrap();
        assert!(!results.is_empty());
        // First result should be the most similar (emb1 itself, distance ~0)
        assert_eq!(results[0].oid, "a");
    }

    #[test]
    fn test_clear() {
        let store = VectorStore::open_in_memory().unwrap();
        let emb = make_test_embedding(1.0);

        store.upsert_embedding("abc", "Test", &emb).unwrap();
        assert_eq!(store.count().unwrap(), 1);

        store.clear().unwrap();
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn test_duplicate_upsert() {
        let store = VectorStore::open_in_memory().unwrap();
        let emb1 = make_test_embedding(1.0);
        let emb2 = make_test_embedding(2.0);

        store
            .upsert_embedding("abc", "Original summary", &emb1)
            .unwrap();
        store
            .upsert_embedding("abc", "Updated summary", &emb2)
            .unwrap();

        assert_eq!(store.count().unwrap(), 1);

        let oids = store.get_indexed_oids().unwrap();
        assert_eq!(oids.len(), 1);
        assert!(oids.contains("abc"));
    }
}
