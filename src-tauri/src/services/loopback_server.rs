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

    /// Best-effort bind of the IPv6 loopback (`[::1]`) on the SAME port as the
    /// IPv4 listener. Azure's redirect uses the `localhost` host (Entra only
    /// ignores the port for `localhost`), and `localhost` can resolve to `::1`
    /// first (e.g. on Windows). Listening on `::1` too ensures the browser's
    /// callback reaches us regardless of which family `localhost` resolves to.
    /// Returns `None` (IPv4-only) when IPv6 is unavailable — a graceful degrade.
    fn try_bind_ipv6_loopback(port: u16) -> Option<TcpListener> {
        match TcpListener::bind(format!("[::1]:{}", port)) {
            Ok(listener) => {
                tracing::info!("OAuth loopback server also bound to [::1]:{}", port);
                Some(listener)
            }
            Err(e) => {
                tracing::debug!(
                    "IPv6 loopback ([::1]:{}) unavailable, IPv4 only: {}",
                    port,
                    e
                );
                None
            }
        }
    }

    /// Create a loopback server from an existing IPv4 listener, also listening on
    /// the IPv6 loopback (same port) when available.
    fn from_listener(listener: TcpListener) -> Result<Self, LeviathanError> {
        let port = listener
            .local_addr()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to get local address: {}", e)))?
            .port();

        let listener_v6 = Self::try_bind_ipv6_loopback(port);

        // Set up channels for shutdown and code reception
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();
        let (code_tx, code_rx) = mpsc::channel::<Result<CallbackResult, String>>();

        // Set non-blocking mode so the accept loop can poll both listeners.
        listener
            .set_nonblocking(true)
            .map_err(|e| LeviathanError::OAuth(format!("Failed to set non-blocking: {}", e)))?;
        if let Some(ref v6) = listener_v6 {
            v6.set_nonblocking(true)
                .map_err(|e| LeviathanError::OAuth(format!("Failed to set non-blocking: {}", e)))?;
        }

        // Spawn server thread
        thread::spawn(move || {
            Self::run_server(listener, listener_v6, shutdown_rx, code_tx);
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

    /// Run the server loop, polling the IPv4 listener and (when present) the IPv6
    /// loopback listener so the callback is received on whichever family the
    /// browser used to reach `localhost`.
    fn run_server(
        listener_v4: TcpListener,
        mut listener_v6: Option<TcpListener>,
        shutdown_rx: mpsc::Receiver<()>,
        code_tx: mpsc::Sender<Result<CallbackResult, String>>,
    ) {
        loop {
            // Check for shutdown signal
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            // Poll both loopback listeners (both non-blocking). `serviced` tracks
            // whether either accepted a connection this pass, so we only sleep when
            // both would-block.
            let mut serviced = false;

            // IPv4 loopback — the primary listener. A hard accept error here is fatal.
            match listener_v4.accept() {
                Ok((stream, _)) => {
                    serviced = true;
                    if let Some(result) = Self::handle_connection(stream) {
                        let _ = code_tx.send(result);
                        return;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    let _ = code_tx.send(Err(format!("Accept error: {}", e)));
                    return;
                }
            }

            // IPv6 loopback — best-effort. A hard accept error just drops this
            // listener (graceful degrade to IPv4-only, mirroring the bind-time
            // fallback), never aborting the whole server mid-sign-in.
            if let Some(v6) = listener_v6.as_ref() {
                match v6.accept() {
                    Ok((stream, _)) => {
                        serviced = true;
                        if let Some(result) = Self::handle_connection(stream) {
                            let _ = code_tx.send(result);
                            return;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => {
                        tracing::debug!("IPv6 loopback accept error, dropping to IPv4-only: {}", e);
                        listener_v6 = None;
                    }
                }
            }

            if !serviced {
                // No connection on either listener, sleep briefly.
                thread::sleep(Duration::from_millis(100));
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
        let query = path.split('?').nth(1).unwrap_or("");

        // Identify the OAuth callback by its query, not a fixed path: providers
        // differ in the redirect PATH they register — GitHub/GitLab/Bitbucket use
        // `/callback`, while Azure DevOps rides Microsoft's Visual Studio client
        // whose registered redirect is bare `http://localhost` (root `/`). Gating
        // on the presence of `code`/`error` accepts both and ignores incidental
        // requests (e.g. `/favicon.ico`, or a bare `/` with no query) rather than
        // mis-parsing them as a failed callback.
        if !(query.contains("code=") || query.contains("error=")) {
            Self::send_error_response(&mut stream, "Not found");
            return None; // Continue listening
        }

        // Parse + validate the callback query. State binding is enforced here
        // (pure, unit-tested below) BEFORE we tell the browser anything, so a
        // callback missing its `state` shows a failure page rather than a
        // misleading "Authorization Successful".
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

    /// The dual-listener accept loop must still receive a callback delivered over
    /// IPv4 (the family GitHub/GitLab/Bitbucket redirect to, and one of the two
    /// `localhost` may resolve to for Azure).
    #[test]
    fn test_wait_for_callback_receives_over_ipv4() {
        let server = LoopbackServer::new().unwrap();
        let port = server.port();
        let handle = thread::spawn(move || server.wait_for_callback(Duration::from_secs(5)));

        // Give the server thread a moment to start accepting.
        thread::sleep(Duration::from_millis(150));
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(b"GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let result = handle.join().unwrap().unwrap();
        assert_eq!(result.code, "abc");
        assert_eq!(result.state, "xyz");
    }

    /// Azure DevOps rides Microsoft's Visual Studio client, whose registered
    /// redirect is bare `http://localhost` — so the callback lands on the ROOT
    /// path `/`, not `/callback`. The server must still recognise it.
    #[test]
    fn test_wait_for_callback_receives_on_root_path() {
        let server = LoopbackServer::new().unwrap();
        let port = server.port();
        let handle = thread::spawn(move || server.wait_for_callback(Duration::from_secs(5)));

        thread::sleep(Duration::from_millis(150));
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(b"GET /?code=rootcode&state=rootstate HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let result = handle.join().unwrap().unwrap();
        assert_eq!(result.code, "rootcode");
        assert_eq!(result.state, "rootstate");
    }

    /// When IPv6 loopback is available, a callback delivered to `[::1]` (the family
    /// `localhost` resolves to first on some hosts, e.g. Windows) must also be
    /// received. Self-skips on hosts without IPv6 loopback.
    #[test]
    fn test_wait_for_callback_receives_over_ipv6_when_available() {
        let server = LoopbackServer::new().unwrap();
        let port = server.port();

        // Skip if this host has no usable IPv6 loopback (the server binds it
        // best-effort, so a connect here would fail for the same reason).
        let Ok(mut stream) = TcpStream::connect(("::1", port)) else {
            return;
        };

        let handle = thread::spawn(move || server.wait_for_callback(Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(150));
        stream
            .write_all(
                b"GET /callback?code=v6code&state=v6state HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .unwrap();

        let result = handle.join().unwrap().unwrap();
        assert_eq!(result.code, "v6code");
        assert_eq!(result.state, "v6state");
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
