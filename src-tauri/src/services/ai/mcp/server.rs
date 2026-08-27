//! MCP server implementation
//!
//! Lightweight HTTP server using `tokio::net::TcpListener` that implements
//! the MCP JSON-RPC protocol for external tool integration.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use super::tools;

const MCP_CONFIG_FILE: &str = "mcp_config.json";

/// MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    /// Allowed origins for CORS (empty = localhost only)
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 3001,
            allowed_origins: Vec::new(),
        }
    }
}

impl McpConfig {
    /// Load configuration from disk
    pub fn load(config_dir: &Path) -> Result<Self, String> {
        let config_path = config_dir.join(MCP_CONFIG_FILE);

        if !config_path.exists() {
            return Ok(Self::default());
        }

        let contents = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read MCP config: {}", e))?;

        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse MCP config: {}", e))
    }

    /// Save configuration to disk
    pub fn save(&self, config_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;

        let config_path = config_dir.join(MCP_CONFIG_FILE);

        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize MCP config: {}", e))?;

        std::fs::write(&config_path, contents)
            .map_err(|e| format!("Failed to write MCP config: {}", e))
    }
}

/// MCP server status information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
    pub url: Option<String>,
    /// Why the server is not running, when the last start attempt failed
    pub last_error: Option<String>,
}

/// JSON-RPC request structure
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Value,
    method: String,
    params: Option<Value>,
}

/// JSON-RPC response structure
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

/// JSON-RPC error structure
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

impl JsonRpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

/// MCP server instance
pub struct McpServer {
    config: McpConfig,
    /// Directory the MCP configuration is persisted in
    config_dir: PathBuf,
    running: Arc<AtomicBool>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    /// Paths of repositories currently open in Leviathan
    open_repos: Arc<RwLock<Vec<String>>>,
    /// Error from the last failed start attempt, surfaced in the status
    last_error: Option<String>,
}

/// Shared MCP server state
pub type McpState = Arc<RwLock<McpServer>>;

/// Create a new MCP server state instance backed by the saved configuration
pub fn create_mcp_state(config_dir: PathBuf) -> McpState {
    Arc::new(RwLock::new(McpServer::new(config_dir)))
}

impl McpServer {
    /// Create a new MCP server, restoring the configuration saved on disk
    pub fn new(config_dir: PathBuf) -> Self {
        let config = McpConfig::load(&config_dir).unwrap_or_default();
        Self {
            config,
            config_dir,
            running: Arc::new(AtomicBool::new(false)),
            shutdown_tx: None,
            open_repos: Arc::new(RwLock::new(Vec::new())),
            last_error: None,
        }
    }

    /// Persist the current configuration, logging (but not failing on) write errors
    fn persist_config(&self) {
        if let Err(e) = self.config.save(&self.config_dir) {
            tracing::warn!("Failed to persist MCP config: {}", e);
        }
    }

    /// Start the MCP server
    pub async fn start(&mut self) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("MCP server is already running".to_string());
        }

        let addr = format!("127.0.0.1:{}", self.config.port);
        let listener = match TcpListener::bind(&addr).await {
            Ok(listener) => listener,
            Err(e) => {
                let message = format!("Failed to bind to {}: {}", addr, e);
                self.last_error = Some(message.clone());
                return Err(message);
            }
        };

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        self.shutdown_tx = Some(shutdown_tx);

        let running = self.running.clone();
        running.store(true, Ordering::SeqCst);

        let open_repos = self.open_repos.clone();

        tokio::spawn(async move {
            Self::run_server(listener, running, shutdown_rx, open_repos).await;
        });

        // Remember that the server should come back up on the next launch
        self.last_error = None;
        self.config.enabled = true;
        self.persist_config();

        tracing::info!("MCP server started on {}", addr);
        Ok(())
    }

    /// Stop the MCP server
    pub async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Err("MCP server is not running".to_string());
        }

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        self.running.store(false, Ordering::SeqCst);

        // Remember that the server should stay down on the next launch
        self.last_error = None;
        self.config.enabled = false;
        self.persist_config();

        tracing::info!("MCP server stopped");
        Ok(())
    }

    /// Get the current server status
    pub fn get_status(&self) -> McpStatus {
        let running = self.running.load(Ordering::SeqCst);
        McpStatus {
            running,
            port: self.config.port,
            url: if running {
                Some(format!("http://127.0.0.1:{}", self.config.port))
            } else {
                None
            },
            last_error: self.last_error.clone(),
        }
    }

    /// Get the current configuration
    pub fn get_config(&self) -> &McpConfig {
        &self.config
    }

    /// Set the server configuration and persist it to disk
    pub fn set_config(&mut self, config: McpConfig) -> Result<(), String> {
        self.config = config;
        self.config.save(&self.config_dir)
    }

    /// Update the list of open repositories
    pub async fn update_open_repos(&self, repos: Vec<String>) {
        let mut open = self.open_repos.write().await;
        *open = repos;
    }

    /// Run the server loop accepting connections until shutdown
    async fn run_server(
        listener: TcpListener,
        running: Arc<AtomicBool>,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        open_repos: Arc<RwLock<Vec<String>>>,
    ) {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    running.store(false, Ordering::SeqCst);
                    break;
                }
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _addr)) => {
                            let repos = open_repos.clone();
                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(stream, repos).await {
                                    tracing::warn!("MCP connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::warn!("MCP accept error: {}", e);
                        }
                    }
                }
            }
        }
    }

    /// Handle a single HTTP connection
    async fn handle_connection(
        mut stream: tokio::net::TcpStream,
        open_repos: Arc<RwLock<Vec<String>>>,
    ) -> Result<(), String> {
        // Read until we find the end of headers, then read the body based on Content-Length
        let mut buf = Vec::with_capacity(65536);
        let mut tmp = vec![0u8; 8192];

        // Read headers first
        loop {
            let n = stream
                .read(&mut tmp)
                .await
                .map_err(|e| format!("Read error: {}", e))?;

            if n == 0 {
                if buf.is_empty() {
                    return Ok(());
                }
                break;
            }

            buf.extend_from_slice(&tmp[..n]);

            // Check if we have the complete headers
            let s = String::from_utf8_lossy(&buf);
            if s.contains("\r\n\r\n") || s.contains("\n\n") {
                // Check if we also have the full body
                if let Some(content_len) = parse_content_length(&s) {
                    let header_end = if let Some(idx) = s.find("\r\n\r\n") {
                        idx + 4
                    } else if let Some(idx) = s.find("\n\n") {
                        idx + 2
                    } else {
                        break;
                    };
                    let body_received = buf.len() - header_end;
                    if body_received >= content_len {
                        break;
                    }
                    // Need more body data, continue reading
                } else {
                    break;
                }
            }

            if buf.len() > 1_048_576 {
                // 1MB limit
                return Self::send_http_response(
                    &mut stream,
                    413,
                    &serde_json::to_string(&JsonRpcResponse::error(
                        Value::Null,
                        -32600,
                        "Request too large".to_string(),
                    ))
                    .unwrap_or_default(),
                )
                .await;
            }
        }

        let request_str = String::from_utf8_lossy(&buf);

        // Parse HTTP request - find the body after the blank line
        let body = if let Some(idx) = request_str.find("\r\n\r\n") {
            &request_str[idx + 4..]
        } else if let Some(idx) = request_str.find("\n\n") {
            &request_str[idx + 2..]
        } else {
            return Self::send_http_response(
                &mut stream,
                400,
                &serde_json::to_string(&JsonRpcResponse::error(
                    Value::Null,
                    -32700,
                    "Invalid HTTP request".to_string(),
                ))
                .unwrap_or_default(),
            )
            .await;
        };

        // Check if it's a POST request (MCP uses POST)
        let is_post = request_str.starts_with("POST ");

        // Handle OPTIONS for CORS preflight
        if request_str.starts_with("OPTIONS ") {
            return Self::send_cors_response(&mut stream).await;
        }

        if !is_post {
            return Self::send_http_response(
                &mut stream,
                405,
                &serde_json::to_string(&JsonRpcResponse::error(
                    Value::Null,
                    -32600,
                    "Method not allowed. Use POST.".to_string(),
                ))
                .unwrap_or_default(),
            )
            .await;
        }

        // Parse JSON-RPC request
        let rpc_request: JsonRpcRequest = match serde_json::from_str(body) {
            Ok(req) => req,
            Err(e) => {
                let response =
                    JsonRpcResponse::error(Value::Null, -32700, format!("Parse error: {}", e));
                let response_json = serde_json::to_string(&response).unwrap_or_default();
                return Self::send_http_response(&mut stream, 200, &response_json).await;
            }
        };

        // Route to handler
        let repos = open_repos.read().await;
        let response = Self::handle_rpc_request(&rpc_request, &repos).await;
        let response_json = serde_json::to_string(&response).unwrap_or_default();

        Self::send_http_response(&mut stream, 200, &response_json).await
    }

    /// Route a JSON-RPC request to the appropriate handler
    async fn handle_rpc_request(
        request: &JsonRpcRequest,
        open_repos: &[String],
    ) -> JsonRpcResponse {
        match request.method.as_str() {
            "initialize" => Self::handle_initialize(request),
            "tools/list" => Self::handle_tools_list(request),
            "tools/call" => Self::handle_tools_call(request, open_repos).await,
            _ => JsonRpcResponse::error(
                request.id.clone(),
                -32601,
                format!("Method not found: {}", request.method),
            ),
        }
    }

    /// Handle the `initialize` method
    fn handle_initialize(request: &JsonRpcRequest) -> JsonRpcResponse {
        let result = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "leviathan",
                "version": env!("CARGO_PKG_VERSION")
            }
        });
        JsonRpcResponse::success(request.id.clone(), result)
    }

    /// Handle the `tools/list` method
    fn handle_tools_list(request: &JsonRpcRequest) -> JsonRpcResponse {
        let tool_list = tools::get_tool_list();
        let result = serde_json::json!({
            "tools": tool_list
        });
        JsonRpcResponse::success(request.id.clone(), result)
    }

    /// Handle the `tools/call` method
    async fn handle_tools_call(request: &JsonRpcRequest, open_repos: &[String]) -> JsonRpcResponse {
        let params = match &request.params {
            Some(p) => p,
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    -32602,
                    "Missing params".to_string(),
                );
            }
        };

        let tool_name = match params.get("name").and_then(|n| n.as_str()) {
            Some(name) => name,
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    -32602,
                    "Missing tool name in params".to_string(),
                );
            }
        };

        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));

        match tools::call_tool(tool_name, &arguments, open_repos).await {
            Ok(result) => {
                let content = serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result).unwrap_or_default()
                    }]
                });
                JsonRpcResponse::success(request.id.clone(), content)
            }
            Err(e) => {
                let content = serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": e
                    }],
                    "isError": true
                });
                JsonRpcResponse::success(request.id.clone(), content)
            }
        }
    }

    /// Send an HTTP response with CORS headers (localhost only)
    async fn send_http_response(
        stream: &mut tokio::net::TcpStream,
        status: u16,
        body: &str,
    ) -> Result<(), String> {
        let status_text = match status {
            200 => "OK",
            400 => "Bad Request",
            405 => "Method Not Allowed",
            413 => "Payload Too Large",
            _ => "Error",
        };

        let response = format!(
            "HTTP/1.1 {status} {status_text}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Access-Control-Allow-Origin: http://localhost\r\n\
             Access-Control-Allow-Methods: POST, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type\r\n\
             Connection: close\r\n\
             \r\n{body}",
            body.len(),
        );

        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| format!("Write error: {}", e))?;

        stream
            .flush()
            .await
            .map_err(|e| format!("Flush error: {}", e))?;

        Ok(())
    }

    /// Send a CORS preflight response (localhost only)
    async fn send_cors_response(stream: &mut tokio::net::TcpStream) -> Result<(), String> {
        let response = "HTTP/1.1 204 No Content\r\n\
             Access-Control-Allow-Origin: http://localhost\r\n\
             Access-Control-Allow-Methods: POST, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type\r\n\
             Access-Control-Max-Age: 86400\r\n\
             Connection: close\r\n\
             \r\n";

        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| format!("Write error: {}", e))?;

        stream
            .flush()
            .await
            .map_err(|e| format!("Flush error: {}", e))?;

        Ok(())
    }
}

/// Parse the Content-Length header from an HTTP request string
fn parse_content_length(request: &str) -> Option<usize> {
    for line in request.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with("content-length:") {
            return lower
                .trim_start_matches("content-length:")
                .trim()
                .parse()
                .ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Build a server backed by a throwaway config directory.
    /// The TempDir is returned so it outlives the server.
    fn test_server() -> (TempDir, McpServer) {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let server = McpServer::new(dir.path().to_path_buf());
        (dir, server)
    }

    #[test]
    fn test_mcp_server_new() {
        let (_dir, server) = test_server();
        assert!(!server.running.load(Ordering::SeqCst));
        assert_eq!(server.config.port, 3001);
        assert!(!server.config.enabled);
    }

    #[test]
    fn test_get_status_not_running() {
        let (_dir, server) = test_server();
        let status = server.get_status();
        assert!(!status.running);
        assert_eq!(status.port, 3001);
        assert!(status.url.is_none());
    }

    #[test]
    fn test_get_status_running() {
        let (_dir, server) = test_server();
        server.running.store(true, Ordering::SeqCst);
        let status = server.get_status();
        assert!(status.running);
        assert_eq!(status.url, Some("http://127.0.0.1:3001".to_string()));
    }

    #[test]
    fn test_get_config() {
        let (_dir, server) = test_server();
        let config = server.get_config();
        assert!(!config.enabled);
        assert_eq!(config.port, 3001);
    }

    #[test]
    fn test_set_config() {
        let (_dir, mut server) = test_server();
        let config = McpConfig {
            enabled: true,
            port: 8080,
            allowed_origins: Vec::new(),
        };
        server.set_config(config).expect("Failed to set config");
        assert!(server.config.enabled);
        assert_eq!(server.config.port, 8080);
    }

    #[test]
    fn test_mcp_config_default() {
        let config = McpConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.port, 3001);
    }

    #[test]
    fn test_mcp_config_serialization() {
        let config = McpConfig {
            enabled: true,
            port: 4000,
            allowed_origins: Vec::new(),
        };
        let json = serde_json::to_string(&config).expect("Failed to serialize");
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"port\":4000"));
    }

    #[test]
    fn test_mcp_config_deserialization() {
        let json = r#"{"enabled":true,"port":5000}"#;
        let config: McpConfig = serde_json::from_str(json).expect("Failed to deserialize");
        assert!(config.enabled);
        assert_eq!(config.port, 5000);
    }

    #[test]
    fn test_mcp_status_serialization() {
        let status = McpStatus {
            running: true,
            port: 3001,
            url: Some("http://127.0.0.1:3001".to_string()),
            last_error: None,
        };
        let json = serde_json::to_string(&status).expect("Failed to serialize");
        assert!(json.contains("\"running\":true"));
        assert!(json.contains("\"port\":3001"));
        assert!(json.contains("\"url\":\"http://127.0.0.1:3001\""));
    }

    #[test]
    fn test_json_rpc_response_success() {
        let response = JsonRpcResponse::success(Value::Number(1.into()), serde_json::json!("ok"));
        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Value::Number(1.into()));
        assert!(response.result.is_some());
        assert!(response.error.is_none());
    }

    #[test]
    fn test_json_rpc_response_error() {
        let response =
            JsonRpcResponse::error(Value::Number(1.into()), -32600, "Bad request".to_string());
        assert_eq!(response.jsonrpc, "2.0");
        assert!(response.result.is_none());
        assert!(response.error.is_some());
        let err = response.error.unwrap();
        assert_eq!(err.code, -32600);
        assert_eq!(err.message, "Bad request");
    }

    #[test]
    fn test_json_rpc_request_parsing() {
        let json = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":null}"#;
        let request: JsonRpcRequest = serde_json::from_str(json).expect("Failed to parse");
        assert_eq!(request.jsonrpc, "2.0");
        assert_eq!(request.method, "initialize");
        assert_eq!(request.id, Value::Number(1.into()));
    }

    #[test]
    fn test_json_rpc_request_with_params() {
        let json = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_status","arguments":{"repo_path":"/tmp/repo"}}}"#;
        let request: JsonRpcRequest = serde_json::from_str(json).expect("Failed to parse");
        assert_eq!(request.method, "tools/call");
        assert!(request.params.is_some());
        let params = request.params.unwrap();
        assert_eq!(params["name"], "get_status");
    }

    #[tokio::test]
    async fn test_handle_initialize() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::Number(1.into()),
            method: "initialize".to_string(),
            params: None,
        };
        let response = McpServer::handle_initialize(&request);
        assert!(response.result.is_some());
        let result = response.result.unwrap();
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert_eq!(result["serverInfo"]["name"], "leviathan");
        assert_eq!(result["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn test_handle_tools_list() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::Number(1.into()),
            method: "tools/list".to_string(),
            params: None,
        };
        let response = McpServer::handle_tools_list(&request);
        assert!(response.result.is_some());
        let result = response.result.unwrap();
        assert!(result["tools"].is_array());
        assert!(!result["tools"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_handle_unknown_method() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::Number(1.into()),
            method: "unknown/method".to_string(),
            params: None,
        };
        let response = McpServer::handle_rpc_request(&request, &[]).await;
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32601);
    }

    #[tokio::test]
    async fn test_handle_tools_call_missing_params() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::Number(1.into()),
            method: "tools/call".to_string(),
            params: None,
        };
        let response = McpServer::handle_rpc_request(&request, &[]).await;
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32602);
    }

    #[tokio::test]
    async fn test_handle_tools_call_missing_name() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::Number(1.into()),
            method: "tools/call".to_string(),
            params: Some(serde_json::json!({"arguments": {}})),
        };
        let response = McpServer::handle_rpc_request(&request, &[]).await;
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32602);
    }

    #[tokio::test]
    async fn test_update_open_repos() {
        let (_dir, server) = test_server();
        server
            .update_open_repos(vec![
                "/path/to/repo1".to_string(),
                "/path/to/repo2".to_string(),
            ])
            .await;
        let repos = server.open_repos.read().await;
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0], "/path/to/repo1");
        assert_eq!(repos[1], "/path/to/repo2");
    }

    #[tokio::test]
    async fn test_start_stop_server() {
        let (_dir, mut server) = test_server();
        // Use a high port to avoid conflicts
        server
            .set_config(McpConfig {
                enabled: true,
                port: 19876,
                allowed_origins: Vec::new(),
            })
            .expect("Failed to set config");

        let result = server.start().await;
        assert!(result.is_ok());
        assert!(server.running.load(Ordering::SeqCst));

        // Starting again should fail
        let result = server.start().await;
        assert!(result.is_err());

        let result = server.stop().await;
        assert!(result.is_ok());
        assert!(!server.running.load(Ordering::SeqCst));

        // Stopping again should fail
        let result = server.stop().await;
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_content_length() {
        let request = "POST / HTTP/1.1\r\nContent-Length: 42\r\n\r\n";
        assert_eq!(parse_content_length(request), Some(42));
    }

    #[test]
    fn test_parse_content_length_missing() {
        let request = "POST / HTTP/1.1\r\n\r\n";
        assert_eq!(parse_content_length(request), None);
    }

    #[test]
    fn test_create_mcp_state() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let state = create_mcp_state(dir.path().to_path_buf());
        // Just verify it creates without panic
        assert!(Arc::strong_count(&state) >= 1);
    }

    // =====================================================
    // Configuration persistence
    // =====================================================

    #[test]
    fn test_mcp_config_save_and_load_round_trip() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let config = McpConfig {
            enabled: true,
            port: 4321,
            allowed_origins: Vec::new(),
        };

        config.save(dir.path()).expect("Failed to save config");

        let loaded = McpConfig::load(dir.path()).expect("Failed to load config");
        assert!(loaded.enabled);
        assert_eq!(loaded.port, 4321);
    }

    #[test]
    fn test_load_missing_config_returns_default() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let config = McpConfig::load(dir.path()).expect("Missing config should not be an error");
        assert!(!config.enabled);
        assert_eq!(config.port, 3001);
    }

    #[test]
    fn test_new_restores_saved_config() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        McpConfig {
            enabled: true,
            port: 4321,
            allowed_origins: Vec::new(),
        }
        .save(dir.path())
        .expect("Failed to save config");

        let server = McpServer::new(dir.path().to_path_buf());
        assert_eq!(server.get_config().port, 4321);
        assert!(server.get_config().enabled);
    }

    #[test]
    fn test_set_config_persists_across_instances() {
        let dir = TempDir::new().expect("Failed to create temp dir");

        {
            let mut server = McpServer::new(dir.path().to_path_buf());
            server
                .set_config(McpConfig {
                    enabled: true,
                    port: 4321,
                    allowed_origins: Vec::new(),
                })
                .expect("Failed to set config");
        }

        let restarted = McpServer::new(dir.path().to_path_buf());
        assert_eq!(restarted.get_config().port, 4321);
        assert!(restarted.get_config().enabled);
    }

    #[test]
    fn test_new_falls_back_to_default_on_corrupt_config() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        std::fs::write(dir.path().join(MCP_CONFIG_FILE), "not json").expect("Failed to write");

        let server = McpServer::new(dir.path().to_path_buf());
        assert_eq!(server.get_config().port, 3001);
        assert!(!server.get_config().enabled);
    }

    /// Ask the OS for a currently unused localhost port
    async fn free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to reserve a port");
        listener
            .local_addr()
            .expect("Failed to read reserved address")
            .port()
    }

    #[tokio::test]
    async fn test_start_enables_and_stop_disables_persisted_config() {
        let port = free_port().await;
        let dir = TempDir::new().expect("Failed to create temp dir");
        let mut server = McpServer::new(dir.path().to_path_buf());
        server
            .set_config(McpConfig {
                enabled: false,
                port,
                allowed_origins: Vec::new(),
            })
            .expect("Failed to set config");

        server.start().await.expect("Failed to start server");
        let saved = McpConfig::load(dir.path()).expect("Failed to load config");
        assert!(saved.enabled, "start() should persist enabled = true");
        assert_eq!(saved.port, port);

        server.stop().await.expect("Failed to stop server");
        let saved = McpConfig::load(dir.path()).expect("Failed to load config");
        assert!(!saved.enabled, "stop() should persist enabled = false");
    }

    #[tokio::test]
    async fn test_start_records_bind_error_in_status() {
        // Occupy a port so the server cannot bind to it
        let blocker = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to occupy port");
        let port = blocker
            .local_addr()
            .expect("Failed to read occupied address")
            .port();

        let dir = TempDir::new().expect("Failed to create temp dir");
        let mut server = McpServer::new(dir.path().to_path_buf());
        server
            .set_config(McpConfig {
                enabled: true,
                port,
                allowed_origins: Vec::new(),
            })
            .expect("Failed to set config");

        let result = server.start().await;
        assert!(result.is_err());

        let status = server.get_status();
        assert!(!status.running);
        let last_error = status.last_error.expect("Bind failure should be recorded");
        assert!(
            last_error.contains("Failed to bind"),
            "unexpected error: {}",
            last_error
        );

        drop(blocker);
    }
}
