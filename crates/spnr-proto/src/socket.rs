//! Daemon socket datagram schema (the hook/status -> spnrd wire).
//!
//! CONTENT FIREWALL (invariant 2): this enum is STRUCTURALLY incapable of
//! carrying work product. The only payloads are the host hook event name, the
//! raw session id (salted-hashed by the daemon before anything leaves the box),
//! and a tiny fixed command set. There is NO field for content/message/text/
//! prompt/cwd/transcript_path/file_path. `spnr-hook` constructs `Hook` from
//! exactly the three keys it skims off stdin (07 §2.1); it never deserializes
//! the rest of the payload.
//!
//! The codec is deliberately tiny (no serde_json on the hot path) so `spnr-hook`
//! and `spnr-status` stay dependency-lean and < 1 MB stripped (09 §5).

/// A control command from `spnr-cli`/`spnr-status` to the daemon. Closed set; no
/// free-form payload. Kept separate from `Hook`/`Heartbeat` so the daemon can
/// rate-limit and bound each shape independently (07 §1, T6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocketCmd {
    /// "are you alive / status snapshot" ping from `spnr-status` (coalesced ≤1/s).
    Ping,
    /// User pause request (settings state machine -> Paused).
    Pause,
    /// User resume request.
    Resume,
}

/// A datagram on the `~/.spnr/spnrd.sock` Unix socket.
///
/// Untrusted, rate-limited, fixed-size input (07 §1, T6). Contains NO content field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocketMsg {
    /// A forwarded host hook. Only the two firewall-safe keys are carried.
    Hook {
        /// e.g. "SessionStart", "UserPromptSubmit", "Stop" (`hook_event_name`).
        event_name: String,
        /// Raw host `session_id`; salted-hashed by the daemon, never transmitted raw.
        session_id: String,
    },
    /// A render-liveness heartbeat from `spnr-status` (statusLine refreshInterval:1).
    Heartbeat {
        /// Raw host `session_id`; salted-hashed by the daemon, never transmitted raw.
        session_id: String,
    },
    /// A control command (see [`SocketCmd`]).
    Cmd(SocketCmd),
}

// --- Wire tags for the compact tag-length-value (TLV) datagram codec. ---
//
// A datagram is a single leading tag byte that selects the variant, followed by
// that variant's fixed shape. Strings are length-prefixed with a big-endian u16
// (a session id / hook event name is always well under 64 KiB). There is NO
// variable open field, NO key/value map, NO content slot — the codec can only
// ever express the three closed variants below, which is the structural half of
// the content firewall (invariant 2): you cannot decode a "prompt" because the
// grammar has nowhere to put one.
const TAG_HOOK: u8 = 0x01;
const TAG_HEARTBEAT: u8 = 0x02;
const TAG_CMD: u8 = 0x03;

const CMD_PING: u8 = 0x01;
const CMD_PAUSE: u8 = 0x02;
const CMD_RESUME: u8 = 0x03;

/// Append a big-endian u16 length prefix + the string bytes. A string longer
/// than `u16::MAX` is truncated at the byte boundary rather than panicking
/// (invariant 1); host session ids / hook names are far shorter, so this is a
/// defensive clamp that never fires in practice.
fn put_str(out: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len().min(u16::MAX as usize);
    out.extend_from_slice(&(len as u16).to_be_bytes());
    out.extend_from_slice(&bytes[..len]);
}

/// Read a big-endian u16 length prefix + that many UTF-8 bytes, advancing
/// `cursor`. Returns `None` on truncation or invalid UTF-8 — every failure path
/// is a quiet `None`, never a panic, on untrusted socket input (invariant 1).
fn take_str(bytes: &[u8], cursor: &mut usize) -> Option<String> {
    let start = *cursor;
    let len_end = start.checked_add(2)?;
    if len_end > bytes.len() {
        return None;
    }
    let len = u16::from_be_bytes([bytes[start], bytes[start + 1]]) as usize;
    let str_end = len_end.checked_add(len)?;
    if str_end > bytes.len() {
        return None;
    }
    let s = std::str::from_utf8(&bytes[len_end..str_end]).ok()?.to_string();
    *cursor = str_end;
    Some(s)
}

impl SocketMsg {
    /// Encode to a compact byte datagram (hand-rolled, no serde_json on the hot path).
    ///
    /// Layout (all lengths big-endian u16):
    /// ```text
    /// Hook       : 0x01 | len(event_name) name… | len(session_id) sid…
    /// Heartbeat  : 0x02 | len(session_id) sid…
    /// Cmd(Ping)  : 0x03 0x01
    /// Cmd(Pause) : 0x03 0x02
    /// Cmd(Resume): 0x03 0x03
    /// ```
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        match self {
            SocketMsg::Hook {
                event_name,
                session_id,
            } => {
                out.push(TAG_HOOK);
                put_str(&mut out, event_name);
                put_str(&mut out, session_id);
            }
            SocketMsg::Heartbeat { session_id } => {
                out.push(TAG_HEARTBEAT);
                put_str(&mut out, session_id);
            }
            SocketMsg::Cmd(cmd) => {
                out.push(TAG_CMD);
                out.push(match cmd {
                    SocketCmd::Ping => CMD_PING,
                    SocketCmd::Pause => CMD_PAUSE,
                    SocketCmd::Resume => CMD_RESUME,
                });
            }
        }
        out
    }

    /// Decode a datagram. Returns `None` on any malformed input — the daemon
    /// treats all socket input as untrusted and never panics on it (invariant 1).
    /// Trailing bytes after a well-formed message are rejected (strict framing),
    /// so a smuggled extra field cannot ride along.
    pub fn decode(bytes: &[u8]) -> Option<SocketMsg> {
        let (&tag, rest) = bytes.split_first()?;
        let mut cursor = 0usize;
        let msg = match tag {
            TAG_HOOK => {
                let event_name = take_str(rest, &mut cursor)?;
                let session_id = take_str(rest, &mut cursor)?;
                SocketMsg::Hook {
                    event_name,
                    session_id,
                }
            }
            TAG_HEARTBEAT => {
                let session_id = take_str(rest, &mut cursor)?;
                SocketMsg::Heartbeat { session_id }
            }
            TAG_CMD => {
                let (&cmd_byte, cmd_rest) = rest.split_first()?;
                cursor = 1; // consumed the single command byte
                let _ = cmd_rest;
                let cmd = match cmd_byte {
                    CMD_PING => SocketCmd::Ping,
                    CMD_PAUSE => SocketCmd::Pause,
                    CMD_RESUME => SocketCmd::Resume,
                    _ => return None,
                };
                SocketMsg::Cmd(cmd)
            }
            _ => return None,
        };
        // Strict framing: no trailing bytes permitted.
        if cursor != rest.len() {
            return None;
        }
        Some(msg)
    }
}
