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

/// A temporary loopback server for OAuth callbacks
pub struct LoopbackServer {
    /// The port the server is listening on
    port: u16,
    /// Sender to signal shutdown
    shutdown_tx: Option<mpsc::Sender<()>>,
    /// Receiver for the authorization code
    code_rx: Option<mpsc::Receiver<Result<String, String>>>,
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
        let (code_tx, code_rx) = mpsc::channel::<Result<String, String>>();

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

    /// Wait for the OAuth callback and return the authorization code
    ///
    /// Returns the authorization code on success, or an error message on failure.
    /// Times out after 5 minutes.
    pub fn wait_for_callback(mut self, timeout: Duration) -> Result<String, LeviathanError> {
        let code_rx = self
            .code_rx
            .take()
            .ok_or_else(|| LeviathanError::OAuth("Server already consumed".to_string()))?;

        // Wait for the code with timeout
        match code_rx.recv_timeout(timeout) {
            Ok(Ok(code)) => {
                // Shutdown the server
                if let Some(tx) = self.shutdown_tx.take() {
                    let _ = tx.send(());
                }
                Ok(code)
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
        code_tx: mpsc::Sender<Result<String, String>>,
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
    fn handle_connection(mut stream: TcpStream) -> Option<Result<String, String>> {
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

        // Parse query parameters
        let query = path.split('?').nth(1).unwrap_or("");
        let params: std::collections::HashMap<&str, &str> = query
            .split('&')
            .filter_map(|param| {
                let mut parts = param.splitn(2, '=');
                Some((parts.next()?, parts.next()?))
            })
            .collect();

        // Check for error
        if let Some(error) = params.get("error") {
            let description = params.get("error_description").unwrap_or(&"Unknown error");
            Self::send_error_response(&mut stream, description);
            return Some(Err(format!("{}: {}", error, description)));
        }

        // Get the authorization code
        if let Some(code) = params.get("code") {
            Self::send_success_response(&mut stream);
            return Some(Ok(code.to_string()));
        }

        Self::send_error_response(&mut stream, "No authorization code received");
        Some(Err("No authorization code received".to_string()))
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
}
