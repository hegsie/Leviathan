//! ONNX-based sentence embedding engine
//!
//! Loads an all-MiniLM-L6-v2 ONNX model and produces 384-dimensional
//! normalized embeddings from text input.

use std::path::Path;

use ndarray::{Array1, Array2};
use ort::session::Session;
use ort::value::Value;
use tokenizers::Tokenizer;

/// ONNX-based sentence embedding engine
pub struct OnnxEmbeddingEngine {
    session: Session,
    tokenizer: Tokenizer,
    embedding_dim: usize,
}

impl OnnxEmbeddingEngine {
    /// Load the ONNX model and tokenizer from a directory.
    ///
    /// The directory must contain `model.onnx` and `tokenizer.json`.
    pub fn load(model_dir: &Path) -> Result<Self, String> {
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        if !model_path.exists() {
            return Err(format!("Model file not found: {}", model_path.display()));
        }
        if !tokenizer_path.exists() {
            return Err(format!(
                "Tokenizer file not found: {}",
                tokenizer_path.display()
            ));
        }

        let session = Session::builder()
            .map_err(|e| format!("Failed to create ONNX session builder: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("Failed to load ONNX model: {}", e))?;

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        Ok(Self {
            session,
            tokenizer,
            embedding_dim: 384,
        })
    }

    /// Get the embedding dimension (384 for all-MiniLM-L6-v2)
    pub fn dim(&self) -> usize {
        self.embedding_dim
    }

    /// Embed a single text string, returns a normalized vector.
    pub fn embed(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let batch = self.embed_batch(&[text], 1)?;
        batch
            .into_iter()
            .next()
            .ok_or_else(|| "Empty embedding result".to_string())
    }

    /// Batch embed multiple texts for efficiency.
    ///
    /// Processes in chunks of `batch_size` texts at a time.
    /// Returns a Vec of normalized embedding vectors.
    pub fn embed_batch(
        &mut self,
        texts: &[&str],
        batch_size: usize,
    ) -> Result<Vec<Vec<f32>>, String> {
        let mut all_embeddings = Vec::with_capacity(texts.len());

        for chunk in texts.chunks(batch_size) {
            let chunk_embeddings = self.embed_chunk(chunk)?;
            all_embeddings.extend(chunk_embeddings);
        }

        Ok(all_embeddings)
    }

    /// Embed a single chunk of texts (no chunking logic)
    fn embed_chunk(&mut self, texts: &[&str]) -> Result<Vec<Vec<f32>>, String> {
        let batch_size = texts.len();
        if batch_size == 0 {
            return Ok(Vec::new());
        }

        // Tokenize all texts
        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("Tokenization failed: {}", e))?;

        // Find max length for padding
        let max_len = encodings
            .iter()
            .map(|e| e.get_ids().len())
            .max()
            .unwrap_or(0);
        let max_len = max_len.min(512); // Cap at model's max sequence length

        // Build input tensors
        let mut input_ids = Array2::<i64>::zeros((batch_size, max_len));
        let mut attention_mask = Array2::<i64>::zeros((batch_size, max_len));
        let mut token_type_ids = Array2::<i64>::zeros((batch_size, max_len));

        for (i, encoding) in encodings.iter().enumerate() {
            let ids = encoding.get_ids();
            let mask = encoding.get_attention_mask();
            let types = encoding.get_type_ids();
            let len = ids.len().min(max_len);

            for j in 0..len {
                input_ids[[i, j]] = ids[j] as i64;
                attention_mask[[i, j]] = mask[j] as i64;
                token_type_ids[[i, j]] = types[j] as i64;
            }
        }

        // Run inference — Value::from_array requires owned arrays
        let input_ids_value = Value::from_array(input_ids.clone())
            .map_err(|e| format!("Failed to create input_ids tensor: {}", e))?;
        let attention_mask_clone = attention_mask.clone();
        let attention_mask_value = Value::from_array(attention_mask_clone)
            .map_err(|e| format!("Failed to create attention_mask tensor: {}", e))?;
        let token_type_ids_value = Value::from_array(token_type_ids.clone())
            .map_err(|e| format!("Failed to create token_type_ids tensor: {}", e))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_value,
                "attention_mask" => attention_mask_value,
                "token_type_ids" => token_type_ids_value,
            ])
            .map_err(|e| format!("ONNX inference failed: {}", e))?;

        // Extract output tensor: shape [batch, seq_len, hidden_dim]
        let output = &outputs[0];

        let output_array = output
            .try_extract_array::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {}", e))?;

        let shape = output_array.shape();

        if shape.len() != 3 {
            return Err(format!(
                "Unexpected output shape: {:?}, expected [batch, seq, dim]",
                shape
            ));
        }

        let seq_len = shape[1];
        let hidden_dim = shape[2];

        // Mean pooling with attention mask
        let mut embeddings = Vec::with_capacity(batch_size);

        for i in 0..batch_size {
            // Extract hidden states for this sample
            let mut hidden = Array2::<f32>::zeros((seq_len, hidden_dim));
            for s in 0..seq_len {
                for d in 0..hidden_dim {
                    hidden[[s, d]] = output_array[[i, s, d]];
                }
            }

            let mask = attention_mask.row(i).to_owned();

            let pooled = mean_pool(&hidden, &mask);
            let normalized = l2_normalize(&pooled);
            embeddings.push(normalized.to_vec());
        }

        Ok(embeddings)
    }
}

/// Mean pooling: average hidden states weighted by attention mask
fn mean_pool(hidden_states: &Array2<f32>, attention_mask: &Array1<i64>) -> Array1<f32> {
    let seq_len = hidden_states.shape()[0];
    let hidden_dim = hidden_states.shape()[1];

    let mut sum = Array1::<f32>::zeros(hidden_dim);
    let mut count: f32 = 0.0;

    for i in 0..seq_len {
        let mask_val = attention_mask[i] as f32;
        if mask_val > 0.0 {
            sum += &(&hidden_states.row(i) * mask_val);
            count += mask_val;
        }
    }

    if count > 0.0 {
        sum /= count;
    }

    sum
}

/// L2 normalize a vector
fn l2_normalize(v: &Array1<f32>) -> Array1<f32> {
    let norm = v.mapv(|x| x * x).sum().sqrt();
    if norm > 0.0 {
        v / norm
    } else {
        v.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mean_pool() {
        let hidden = Array2::from_shape_vec((3, 2), vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]).unwrap();
        let mask = Array1::from_vec(vec![1, 1, 0]); // Only first two tokens

        let result = mean_pool(&hidden, &mask);
        assert!((result[0] - 2.0).abs() < 1e-6); // (1+3)/2
        assert!((result[1] - 3.0).abs() < 1e-6); // (2+4)/2
    }

    #[test]
    fn test_l2_normalize() {
        let v = Array1::from_vec(vec![3.0, 4.0]);
        let result = l2_normalize(&v);
        let norm: f32 = result.mapv(|x| x * x).sum().sqrt();
        assert!((norm - 1.0).abs() < 1e-6);
        assert!((result[0] - 0.6).abs() < 1e-6);
        assert!((result[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn test_l2_normalize_zero() {
        let v = Array1::from_vec(vec![0.0, 0.0]);
        let result = l2_normalize(&v);
        assert!((result[0]).abs() < 1e-6);
        assert!((result[1]).abs() < 1e-6);
    }

    #[test]
    fn test_mean_pool_all_masked() {
        let hidden = Array2::from_shape_vec((2, 2), vec![1.0, 2.0, 3.0, 4.0]).unwrap();
        let mask = Array1::from_vec(vec![0, 0]);

        let result = mean_pool(&hidden, &mask);
        assert!((result[0]).abs() < 1e-6);
        assert!((result[1]).abs() < 1e-6);
    }
}
