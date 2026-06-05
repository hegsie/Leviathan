//! Loopback server for OAuth callbacks
//!
//! This module provides a temporary HTTP server on localhost to receive
//! OAuth callbacks from providers like GitHub that don't support custom
//! URL schemes.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::error::LeviathanError;

/// The result of a successful OAuth callback: the authorization code together
/// with the `state` parameter echoed back by the provider. The caller is
/// responsible for validating `state` against the value it issued (CSRF / PKCE
/// flow-binding protection).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackResult {
    /// The authorization code returned by the provider.
    pub code: String,
    /// The `state` parameter echoed back (empty string if the provider omitted it).
    pub state: String,
}

/// A temporary loopback server for OAuth callbacks
pub struct LoopbackServer {
    /// The port the server is listening on
    port: u16,
    /// Sender to signal shutdown
    shutdown_tx: Option<mpsc::Sender<()>>,
    /// Receiver for the authorization code + state
    code_rx: Option<mpsc::Receiver<Result<CallbackResult, String>>>,
}

/// Preferred ports for OAuth callbacks (should match redirect URIs registered with providers)
const PREFERRED_PORTS: &[u16] = &[8080, 8081];

impl LoopbackServer {
    /// Create a new loopback server, preferring specific ports for OAuth compatibility
    pub fn new() -> Result<Self, LeviathanError> {
        // Try preferred ports first (these should match redirect URIs in OAuth apps)
        let listener = Self::bind_preferred_or_random()?;
        Self::from_listener(listener)
    }

    /// Create a loopback server on a specific required port
    /// Returns an error if the port is not available
    pub fn new_with_port(port: u16) -> Result<Self, LeviathanError> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
            .map_err(|e| LeviathanError::OAuth(format!(
                "Port {} is not available for OAuth callback. Please close any application using this port and try again. Error: {}",
                port, e
            )))?;
        tracing::info!("OAuth loopback server bound to required port {}", port);
        Self::from_listener(listener)
    }

    /// Create a loopback server from an existing listener
    fn from_listener(listener: TcpListener) -> Result<Self, LeviathanError> {
        let port = listener
            .local_addr()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to get local address: {}", e)))?
            .port();

        // Set up channels for shutdown and code reception
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();
        let (code_tx, code_rx) = mpsc::channel::<Result<CallbackResult, String>>();

        // Set non-blocking mode with timeout
        listener
            .set_nonblocking(true)
            .map_err(|e| LeviathanError::OAuth(format!("Failed to set non-blocking: {}", e)))?;

        // Spawn server thread
        thread::spawn(move || {
            Self::run_server(listener, shutdown_rx, code_tx);
        });

        Ok(Self {
            port,
            shutdown_tx: Some(shutdown_tx),
            code_rx: Some(code_rx),
        })
    }

    /// Try to bind to preferred ports first, fall back to random port
    fn bind_preferred_or_random() -> Result<TcpListener, LeviathanError> {
        // Try preferred ports first
        for &port in PREFERRED_PORTS {
            if let Ok(listener) = TcpListener::bind(format!("127.0.0.1:{}", port)) {
                tracing::info!("OAuth loopback server bound to preferred port {}", port);
                return Ok(listener);
            }
        }

        // Fall back to random port
        tracing::info!("Preferred ports unavailable, using random port");
        TcpListener::bind("127.0.0.1:0")
            .map_err(|e| LeviathanError::OAuth(format!("Failed to bind loopback server: {}", e)))
    }

    /// Get the port the server is listening on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Get the redirect URI for this server
    pub fn get_redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Wait for the OAuth callback and return the authorization code + state.
    ///
    /// Returns a [`CallbackResult`] (authorization code plus the echoed `state`)
    /// on success, or an error message on failure. The caller MUST validate the
    /// returned `state` against the value it issued.
    /// Times out after 5 minutes.
    pub fn wait_for_callback(
        mut self,
        timeout: Duration,
    ) -> Result<CallbackResult, LeviathanError> {
        let code_rx = self
            .code_rx
            .take()
            .ok_or_else(|| LeviathanError::OAuth("Server already consumed".to_string()))?;

        // Wait for the code with timeout
        match code_rx.recv_timeout(timeout) {
            Ok(Ok(result)) => {
                // Shutdown the server
                if let Some(tx) = self.shutdown_tx.take() {
                    let _ = tx.send(());
                }
                Ok(result)
            }
            Ok(Err(error)) => {
                if let Some(tx) = self.shutdown_tx.take() {
                    let _ = tx.send(());
                }
                Err(LeviathanError::OAuth(error))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(tx) = self.shutdown_tx.take() {
                    let _ = tx.send(());
                }
                Err(LeviathanError::OAuth(
                    "OAuth callback timed out".to_string(),
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(LeviathanError::OAuth(
                "Server thread disconnected".to_string(),
            )),
        }
    }

    /// Run the server loop
    fn run_server(
        listener: TcpListener,
        shutdown_rx: mpsc::Receiver<()>,
        code_tx: mpsc::Sender<Result<CallbackResult, String>>,
    ) {
        loop {
            // Check for shutdown signal
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            // Try to accept a connection
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(result) = Self::handle_connection(stream) {
                        let _ = code_tx.send(result);
                        break;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No connection yet, sleep briefly
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    let _ = code_tx.send(Err(format!("Accept error: {}", e)));
                    break;
                }
            }
        }
    }

    /// Handle an incoming HTTP connection
    fn handle_connection(mut stream: TcpStream) -> Option<Result<CallbackResult, String>> {
        let mut buffer = [0; 4096];

        // Set read timeout
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

        // Read the request
        let n = match stream.read(&mut buffer) {
            Ok(n) => n,
            Err(_) => return Some(Err("Failed to read request".to_string())),
        };

        let request = String::from_utf8_lossy(&buffer[..n]);

        // Parse the request line
        let first_line = request.lines().next().unwrap_or("");

        // Extract the path
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 {
            Self::send_error_response(&mut stream, "Invalid request");
            return Some(Err("Invalid request".to_string()));
        }

        let path = parts[1];

        // Check if this is the callback path
        if !path.starts_with("/callback") {
            Self::send_error_response(&mut stream, "Not found");
            return None; // Continue listening
        }

        // Parse + validate the callback query. State binding is enforced here
        // (pure, unit-tested below) BEFORE we tell the browser anything, so a
        // callback missing its `state` shows a failure page rather than a
        // misleading "Authorization Successful".
        let query = path.split('?').nth(1).unwrap_or("");
        match parse_callback_query(query) {
            Ok(result) => {
                Self::send_success_response(&mut stream);
                Some(Ok(result))
            }
            Err(msg) => {
                Self::send_error_response(&mut stream, &msg);
                Some(Err(msg))
            }
        }
    }

    /// Send a success response to the browser
    fn send_success_response(stream: &mut TcpStream) {
        let html = r#"<!DOCTYPE html>
<html>
<head>
    <title>Authorization Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        h1 { margin: 0 0 10px 0; }
        p { margin: 0; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Authorization Successful!</h1>
        <p>You can close this window and return to Leviathan.</p>
    </div>
    <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>"#;

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }

    /// Send an error response to the browser
    fn send_error_response(stream: &mut TcpStream, error: &str) {
        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head>
    <title>Authorization Failed</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
            color: white;
        }}
        .container {{
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }}
        h1 {{ margin: 0 0 10px 0; }}
        p {{ margin: 0; opacity: 0.9; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Authorization Failed</h1>
        <p>{}</p>
    </div>
</body>
</html>"#,
            html_escape(error)
        );

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

impl Drop for LoopbackServer {
    fn drop(&mut self) {
        // Signal shutdown if not already done
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Decode a single application/x-www-form-urlencoded query component
/// (percent-decoding plus `+` -> space). Used for `code` and `state` so that
/// state validation compares the decoded value the provider echoed back.
fn url_decode_component(s: &str) -> String {
    // `+` represents a space in query strings.
    let s = s.replace('+', " ");
    match urlencoding::decode(&s) {
        Ok(decoded) => decoded.into_owned(),
        // Fall back to the raw value if it isn't valid percent-encoding.
        Err(_) => s,
    }
}

/// Parse and validate an OAuth callback query string.
///
/// Returns the authorization `code` together with the echoed `state`. The
/// `state` MUST be present and non-empty — it binds the callback to the flow we
/// started (CSRF / flow-binding). A provider error, a missing code, or a missing
/// state all produce an `Err`, so the caller shows the browser a failure page
/// instead of a misleading success page.
fn parse_callback_query(query: &str) -> Result<CallbackResult, String> {
    let params: std::collections::HashMap<&str, &str> = query
        .split('&')
        .filter_map(|param| {
            let mut parts = param.splitn(2, '=');
            Some((parts.next()?, parts.next()?))
        })
        .collect();

    if let Some(error) = params.get("error") {
        let description = params.get("error_description").unwrap_or(&"Unknown error");
        return Err(format!("{}: {}", error, description));
    }

    let code = match params.get("code") {
        Some(code) => url_decode_component(code),
        None => return Err("No authorization code received".to_string()),
    };
    // An empty code (e.g. `?code=&state=...`) is unusable — treat it the same as
    // a missing code so the browser gets a failure page and no token exchange is
    // attempted with an empty code.
    if code.is_empty() {
        return Err("No authorization code received".to_string());
    }

    let state = params
        .get("state")
        .map(|s| url_decode_component(s))
        .unwrap_or_default();
    if state.is_empty() {
        return Err("OAuth callback missing required state parameter".to_string());
    }

    Ok(CallbackResult { code, state })
}

/// Simple HTML escaping
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_creation() {
        let server = LoopbackServer::new().unwrap();
        assert!(server.port() > 0);
        assert!(server.get_redirect_uri().starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn test_redirect_uri_format() {
        let server = LoopbackServer::new().unwrap();
        let uri = server.get_redirect_uri();
        assert!(uri.contains("/callback"));
    }

    #[test]
    fn test_url_decode_component_plain() {
        assert_eq!(url_decode_component("abc123"), "abc123");
    }

    #[test]
    fn test_url_decode_component_percent_and_plus() {
        assert_eq!(url_decode_component("a%2Bb"), "a+b");
        assert_eq!(url_decode_component("hello+world"), "hello world");
        assert_eq!(url_decode_component("state%20value"), "state value");
    }

    #[test]
    fn test_url_decode_component_invalid_falls_back() {
        // Incomplete percent-escape should not panic; return best-effort value.
        let out = url_decode_component("%zz");
        assert_eq!(out, "%zz");
    }

    #[test]
    fn test_callback_result_equality() {
        let a = CallbackResult {
            code: "code1".to_string(),
            state: "state1".to_string(),
        };
        let b = CallbackResult {
            code: "code1".to_string(),
            state: "state1".to_string(),
        };
        assert_eq!(a, b);
    }

    #[test]
    fn test_parse_callback_query_accepts_code_and_state() {
        let result = parse_callback_query("code=abc123&state=xyz789").unwrap();
        assert_eq!(result.code, "abc123");
        assert_eq!(result.state, "xyz789");
    }

    #[test]
    fn test_parse_callback_query_rejects_missing_state() {
        // A code with no state must be rejected BEFORE any success response.
        let err = parse_callback_query("code=abc123").unwrap_err();
        assert!(
            err.contains("state"),
            "missing state must be rejected: {err}"
        );
    }

    #[test]
    fn test_parse_callback_query_rejects_empty_state() {
        let err = parse_callback_query("code=abc123&state=").unwrap_err();
        assert!(err.contains("state"), "empty state must be rejected: {err}");
    }

    #[test]
    fn test_parse_callback_query_rejects_missing_code() {
        let err = parse_callback_query("state=xyz789").unwrap_err();
        assert!(err.contains("code"), "missing code must be rejected: {err}");
    }

    #[test]
    fn test_parse_callback_query_rejects_empty_code() {
        // `?code=&state=...` is unusable and must be rejected like a missing code,
        // so the browser gets a failure page and no token exchange is attempted.
        let err = parse_callback_query("code=&state=xyz789").unwrap_err();
        assert!(err.contains("code"), "empty code must be rejected: {err}");
    }

    #[test]
    fn test_parse_callback_query_propagates_provider_error() {
        let err = parse_callback_query("error=access_denied&error_description=The+user+said+no")
            .unwrap_err();
        assert!(err.contains("access_denied"));
    }
}
