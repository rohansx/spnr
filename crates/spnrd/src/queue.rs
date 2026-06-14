//! Append-only, length-prefixed event queue (`~/.spnr/queue.log`).
//!
//! Each record is `u32` big-endian length + that many bytes. Append uses
//! `O_APPEND` so concurrent writers never interleave a record, and `sync_data`
//! so a crash loses at most the in-flight record, never corrupts earlier ones
//! (SAP/1 03 §4.2; invariant 3 — honest about loss). Reading stops at the first
//! truncated frame (a partially-written tail), returning everything before it.

use std::fs::OpenOptions;
use std::io::{Read as _, Write as _};
use std::path::Path;

/// Append one record. Best-effort durability: the record is fully written and
/// `sync_data`'d before returning, or an error is returned and nothing partial is
/// observable by readers (length-prefix framing + truncation-tolerant reader).
pub fn append(path: &Path, record: &[u8]) -> std::io::Result<()> {
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    let len = u32::try_from(record.len()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "record too large")
    })?;
    let mut framed = Vec::with_capacity(4 + record.len());
    framed.extend_from_slice(&len.to_be_bytes());
    framed.extend_from_slice(record);
    f.write_all(&framed)?;
    f.sync_data()?;
    Ok(())
}

/// Read every complete record in order. A truncated trailing frame (interrupted
/// write) is silently ignored. A missing file yields an empty vec.
///
/// Used by the queue tests and the daemon tests now, and by the flush-to-ingest
/// path when the backend slice lands; `spnr audit` ships its own inlined reader.
#[allow(dead_code)]
pub fn read_all(path: &Path) -> Vec<Vec<u8>> {
    let mut bytes = Vec::new();
    match OpenOptions::new().read(true).open(path) {
        Ok(mut f) => {
            if f.read_to_end(&mut bytes).is_err() {
                return Vec::new();
            }
        }
        Err(_) => return Vec::new(),
    }
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 4 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        let start = i + 4;
        let end = match start.checked_add(len) {
            Some(e) => e,
            None => break,
        };
        if end > bytes.len() {
            break; // truncated tail
        }
        out.push(bytes[start..end].to_vec());
        i = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_then_read_roundtrips_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("queue.log");
        append(&p, b"first").unwrap();
        append(&p, b"second").unwrap();
        append(&p, b"").unwrap(); // empty record is legal
        let recs = read_all(&p);
        assert_eq!(recs, vec![b"first".to_vec(), b"second".to_vec(), b"".to_vec()]);
    }

    #[test]
    fn missing_file_reads_empty() {
        assert!(read_all(Path::new("/no/such/spnr/queue.log")).is_empty());
    }

    #[test]
    fn truncated_tail_is_ignored_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("queue.log");
        append(&p, b"complete").unwrap();
        // Simulate an interrupted write: a length prefix claiming more than is present.
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(&99u32.to_be_bytes()).unwrap();
        f.write_all(b"partial").unwrap();
        let recs = read_all(&p);
        assert_eq!(recs, vec![b"complete".to_vec()]);
    }
}
