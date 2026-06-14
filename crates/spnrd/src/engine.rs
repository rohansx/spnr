//! The impression engine — pure, deterministic, and undercount-biased.
//!
//! Per session (04-impression-engine.md): `UserPromptSubmit` opens a WAITING
//! interval; `Pre/PostToolUse` carve out TOOL_RUNNING sub-spans that DON'T count;
//! `Stop` closes the interval and accrues impressions. A WAITING second counts only
//! if a render-liveness heartbeat landed within `GATE_WINDOW_MS` of that second's
//! tick AND the session is tty-attested AND not paused. Impressions per interval =
//! `floor(countable_seconds / 5)`, capped. Every ambiguity rounds DOWN (invariant 3):
//! partial trailing seconds are dropped, and no heartbeat ⇒ zero.
//!
//! All times are unix milliseconds (the daemon stamps them on receipt — hooks
//! carry no trustworthy timestamp, 15-spike-results S2).

/// Liveness gate width (15-spike-results S3: covers the ~1 Hz `refreshInterval`
/// tick + ~300 ms debounce + jitter). Published constant; finalize under load.
pub const GATE_WINDOW_MS: u64 = 2000;
/// Seconds of attested wait per billable impression.
pub const IMPRESSION_SECONDS: u64 = 5;
/// Cap per wait interval (5 min of continuous wait — beyond that something's wrong).
pub const MAX_IMPRESSIONS_PER_INTERVAL: u64 = 60;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Idle,
    Waiting,
    ToolRunning,
}

/// Per-session counting state.
#[derive(Debug)]
pub struct Session {
    phase: Phase,
    /// Start of the current WAITING sub-span (ms), if open.
    subspan_open_ms: Option<u64>,
    /// Countable whole seconds accumulated across the current interval's sub-spans.
    countable_seconds: u64,
    /// Heartbeat receipt timestamps (ms) seen during the current interval.
    heartbeats: Vec<u64>,
    paused: bool,
    tty_attested: bool,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            subspan_open_ms: None,
            countable_seconds: 0,
            heartbeats: Vec::new(),
            paused: false,
            tty_attested: true, // the adapter flips this off for headless sessions
        }
    }
}

impl Session {
    /// Current phase. Part of the engine API; consumed by the daemon's status
    /// surface and the host-replay harness (08-testing-strategy.md).
    #[allow(dead_code)]
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }
    /// Flip off for headless/non-TTY sessions so they accrue nothing. Wired when
    /// the daemon's TTY attestation (controlling-terminal check) lands in a later
    /// slice; the engine already honors it (see `paused_session_earns_zero`-style
    /// gating via `countable_seconds_in`).
    #[allow(dead_code)]
    pub fn set_tty_attested(&mut self, attested: bool) {
        self.tty_attested = attested;
    }

    pub fn on_heartbeat(&mut self, ts_ms: u64) {
        // Only meaningful inside an interval; harmless otherwise.
        self.heartbeats.push(ts_ms);
    }

    /// `UserPromptSubmit` — open a WAITING interval (start the first sub-span).
    pub fn on_prompt_submit(&mut self, ts_ms: u64) {
        self.reset_interval();
        self.phase = Phase::Waiting;
        self.subspan_open_ms = Some(ts_ms);
    }

    /// `PreToolUse` — pause counting; tool-execution time is excluded.
    pub fn on_pre_tool(&mut self, ts_ms: u64) {
        if self.phase == Phase::Waiting {
            self.close_subspan(ts_ms);
            self.phase = Phase::ToolRunning;
        }
    }

    /// `PostToolUse` — resume the WAITING interval (open a new sub-span).
    pub fn on_post_tool(&mut self, ts_ms: u64) {
        if self.phase == Phase::ToolRunning {
            self.phase = Phase::Waiting;
            self.subspan_open_ms = Some(ts_ms);
        }
    }

    /// `Stop` — close the interval and return the impressions earned (capped).
    pub fn on_stop(&mut self, ts_ms: u64) -> u64 {
        if self.phase == Phase::Waiting {
            self.close_subspan(ts_ms);
        }
        let impressions =
            (self.countable_seconds / IMPRESSION_SECONDS).min(MAX_IMPRESSIONS_PER_INTERVAL);
        self.reset_interval();
        impressions
    }

    fn close_subspan(&mut self, close_ms: u64) {
        if let Some(open) = self.subspan_open_ms.take() {
            self.countable_seconds += countable_seconds_in(
                open,
                close_ms,
                &self.heartbeats,
                GATE_WINDOW_MS,
                self.paused,
                self.tty_attested,
            );
        }
    }

    fn reset_interval(&mut self) {
        self.phase = Phase::Idle;
        self.subspan_open_ms = None;
        self.countable_seconds = 0;
        self.heartbeats.clear();
    }
}

/// Count whole WAITING seconds in `[open_ms, close_ms)` that are covered by a fresh
/// heartbeat. A second `[open + (k-1)·1000, open + k·1000)` counts iff, at its tick
/// boundary `t = open + k·1000`, the most recent heartbeat at-or-before `t` is within
/// `gate_window_ms`. Paused or non-attested ⇒ zero. Partial trailing second dropped.
pub fn countable_seconds_in(
    open_ms: u64,
    close_ms: u64,
    heartbeats: &[u64],
    gate_window_ms: u64,
    paused: bool,
    tty_attested: bool,
) -> u64 {
    if paused || !tty_attested || close_ms <= open_ms {
        return 0;
    }
    let whole = (close_ms - open_ms) / 1000;
    let mut count = 0;
    for k in 1..=whole {
        let tick = open_ms + k * 1000;
        // Most recent heartbeat at-or-before the tick.
        let recent = heartbeats.iter().copied().filter(|&h| h <= tick).max();
        if let Some(h) = recent {
            if tick - h <= gate_window_ms {
                count += 1;
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed a timeline of `(ts_ms, event)` and return total impressions.
    fn run(events: &[(u64, &str)]) -> u64 {
        let mut s = Session::default();
        let mut total = 0;
        for &(ts, ev) in events {
            match ev {
                "prompt" => s.on_prompt_submit(ts),
                "pre" => s.on_pre_tool(ts),
                "post" => s.on_post_tool(ts),
                "stop" => total += s.on_stop(ts),
                "hb" => s.on_heartbeat(ts),
                other => panic!("bad event {other}"),
            }
        }
        total
    }

    fn heartbeats_every_sec(from_ms: u64, to_ms: u64) -> Vec<(u64, &'static str)> {
        (from_ms / 1000..=to_ms / 1000)
            .map(|s| (s * 1000, "hb"))
            .collect()
    }

    #[test]
    fn dense_heartbeats_yield_floor_seconds_over_five() {
        // 30s wait, a heartbeat every second -> 30 countable -> 6 impressions.
        let mut tl = vec![(0u64, "prompt")];
        tl.extend(heartbeats_every_sec(0, 30_000));
        tl.push((30_000, "stop"));
        assert_eq!(run(&tl), 6);
    }

    #[test]
    fn headless_no_heartbeats_earns_zero() {
        // The single most important rule: no liveness -> no impressions.
        assert_eq!(run(&[(0, "prompt"), (60_000, "stop")]), 0);
    }

    #[test]
    fn never_exceeds_ground_truth_wall_seconds_over_five() {
        // Heartbeats present but sparse (every 3s, gate is 2s) -> many seconds are
        // NOT covered, so impressions must be well under wall/5 and never above it.
        let mut tl = vec![(0u64, "prompt")];
        for s in 0..40 {
            tl.push((s * 3000, "hb"));
        }
        tl.push((120_000, "stop"));
        let imp = run(&tl);
        let wall_seconds = 120;
        assert!(imp <= wall_seconds / IMPRESSION_SECONDS, "overcounted: {imp}");
    }

    #[test]
    fn tool_running_time_is_excluded() {
        // 10s wait, 100s tool, 10s wait, dense heartbeats throughout.
        let mut tl = vec![(0u64, "prompt")];
        tl.extend(heartbeats_every_sec(0, 120_000));
        tl.push((10_000, "pre")); // pause counting
        tl.push((110_000, "post")); // resume after 100s of tool time
        tl.push((120_000, "stop"));
        // Only the 2×10s WAITING spans count -> 20 countable -> 4 impressions,
        // NOT 120s/5 = 24.
        assert_eq!(run(&tl), 4);
    }

    #[test]
    fn interval_cap_is_enforced() {
        // 10 minutes of dense-heartbeat wait would be 120 impressions; capped at 60.
        let mut tl = vec![(0u64, "prompt")];
        tl.extend(heartbeats_every_sec(0, 600_000));
        tl.push((600_000, "stop"));
        assert_eq!(run(&tl), MAX_IMPRESSIONS_PER_INTERVAL);
    }

    #[test]
    fn paused_session_earns_zero() {
        let mut s = Session::default();
        s.set_paused(true);
        s.on_prompt_submit(0);
        for sec in 0..30 {
            s.on_heartbeat(sec * 1000);
        }
        assert_eq!(s.on_stop(30_000), 0);
    }

    #[test]
    fn partial_trailing_second_is_dropped() {
        // 29.9s of dense heartbeats -> 29 whole seconds -> 5 impressions (not 6).
        let mut tl = vec![(0u64, "prompt")];
        tl.extend(heartbeats_every_sec(0, 30_000));
        tl.push((29_900, "stop"));
        assert_eq!(run(&tl), 5);
    }
}
