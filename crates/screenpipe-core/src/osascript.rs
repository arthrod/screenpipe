// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

//! Time-limited `osascript` runs for the macOS capture path.
//!
//! An AppleScript round-trip to another app blocks until that app answers.
//! While a macOS Automation-consent prompt ("allow … to control Chrome") sits
//! unanswered, the call never returns, and every capture-path caller that asks
//! a browser for a URL, its window titles, or its incognito windows stalls
//! with it. Those callers go through [`run`] instead:
//!
//! - each run is killed after its deadline and reported as
//!   [`OsascriptOutcome::TimedOut`];
//! - after a timeout, scripts aimed at the same app are answered with
//!   [`OsascriptOutcome::CoolingDown`] for [`COOLDOWN`] without spawning, so
//!   an open prompt costs at most one wait per cooldown, not one per frame;
//! - while a run is in flight, a concurrent caller for the same app is
//!   answered with [`OsascriptOutcome::Busy`] at once instead of queueing on
//!   the same stalled target.
//!
//! Callers treat the skip outcomes exactly like a script that failed, which
//! keeps their existing AX / title fallbacks in charge.

use std::collections::HashMap;
use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// Deadline for per-window URL/title lookups, the incognito window query and
/// the DRM poll. Normal AppleScript round-trips take ~100-200 ms, so two full
/// seconds already means a stalled target.
pub const LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Deadline for the all-windows/all-tabs enumerations in browser_utils,
/// which walk every window of a heavy-tab session before answering.
pub const ENUMERATION_TIMEOUT: Duration = Duration::from_secs(5);

/// Skip a target app this long after one of its scripts timed out.
pub const COOLDOWN: Duration = Duration::from_secs(30);

/// A run still in flight after this long means its target is stalled: later
/// callers for it are answered [`OsascriptOutcome::Busy`] instead of each
/// waiting out the deadline. A normal round-trip takes ~100-200 ms, so
/// callers before that run alongside, as two healthy lookups always did.
const STALLED_AFTER: Duration = Duration::from_millis(500);

/// Result of a guarded `osascript` run.
#[derive(Debug)]
pub enum OsascriptOutcome {
    /// The script ran; stdout, stderr and exit status exactly as
    /// [`Command::output`] would have returned them.
    Completed(Output),
    /// Killed at the deadline — the target app never answered, most likely an
    /// Automation-consent prompt is sitting open.
    TimedOut,
    /// Skipped without spawning: this app timed out recently and is still
    /// cooling down (see [`COOLDOWN`]).
    CoolingDown,
    /// Skipped without spawning: another run for this app is already in
    /// flight.
    Busy,
    /// The child could not be spawned or reaped.
    Failed(io::Error),
}

/// `osascript -e <script>` under a deadline, with the per-app cooldown and
/// in-flight guard. `timeout` picks the deadline: [`LOOKUP_TIMEOUT`] for
/// per-window queries, [`ENUMERATION_TIMEOUT`] for all-windows enumerations.
pub fn run(script: &str, timeout: Duration) -> OsascriptOutcome {
    run_guarded(
        "osascript",
        &["-e", script],
        &script_target(script),
        timeout,
        COOLDOWN,
    )
}

/// The app an AppleScript addresses (`application "X"`), lowercased as the
/// cooldown key. Scripts that address no app share the empty key.
fn script_target(script: &str) -> String {
    const MARK: &str = "application \"";
    if let Some(i) = script.find(MARK) {
        let rest = &script[i + MARK.len()..];
        if let Some(j) = rest.find('"') {
            return rest[..j].to_lowercase();
        }
    }
    String::new()
}

/// Internal seam so the tests can drive `sh` children instead of `osascript`.
/// `target` is the cooldown key (see [`script_target`]).
fn run_guarded(
    program: &str,
    args: &[&str],
    target: &str,
    timeout: Duration,
    cooldown: Duration,
) -> OsascriptOutcome {
    let slot = match claim(target) {
        Ok(slot) => slot,
        Err(skipped) => return skipped,
    };
    // No lock is held across the child: a stalled target turns later callers
    // away (see `claim`) instead of queueing them behind the spawn.
    let mut cmd = Command::new(program);
    cmd.args(args);
    let outcome = output_with_deadline(&mut cmd, timeout);
    if matches!(outcome, OsascriptOutcome::TimedOut) {
        tracing::warn!(
            "osascript to {:?} timed out after {} ms (Automation-consent prompt open?); skipping it for {} s",
            if target.is_empty() { "<unknown>" } else { target },
            timeout.as_millis(),
            cooldown.as_secs()
        );
        if let Some(state) = lock_targets().get_mut(target) {
            state.cooldown_until = Some(Instant::now() + cooldown);
        }
    }
    drop(slot);
    outcome
}

/// Guard state per target app. The mutex is only held for short bookkeeping,
/// never across the child process, so a capture-path caller can at worst be
/// told [`OsascriptOutcome::Busy`] or [`OsascriptOutcome::CoolingDown`],
/// never blocked.
#[derive(Default)]
struct TargetState {
    cooldown_until: Option<Instant>,
    /// When each run still in flight started; the oldest one decides
    /// whether the target looks stalled.
    in_flight: Vec<Instant>,
}

/// One run's claim on its target, given back on drop, so a panic between
/// claim and release cannot leave the app answering `Busy`.
struct InFlight<'a> {
    target: &'a str,
    started: Instant,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        if let Some(state) = lock_targets().get_mut(self.target) {
            if let Some(i) = state.in_flight.iter().position(|&at| at == self.started) {
                state.in_flight.swap_remove(i);
            }
        }
    }
}

fn claim(target: &str) -> Result<InFlight<'_>, OsascriptOutcome> {
    let mut targets = lock_targets();
    let state = targets.entry(target.to_string()).or_default();
    let now = Instant::now();
    if state
        .in_flight
        .iter()
        .min()
        .is_some_and(|&oldest| now.duration_since(oldest) >= STALLED_AFTER)
    {
        tracing::debug!(
            "osascript to {:?} skipped: a run has been in flight for {:?}",
            target,
            STALLED_AFTER
        );
        return Err(OsascriptOutcome::Busy);
    }
    if let Some(until) = state.cooldown_until {
        if now < until {
            tracing::debug!(
                "osascript to {:?} skipped: cooling down after a timeout",
                target
            );
            return Err(OsascriptOutcome::CoolingDown);
        }
        state.cooldown_until = None;
    }
    state.in_flight.push(now);
    Ok(InFlight {
        target,
        started: now,
    })
}

static TARGETS: LazyLock<Mutex<HashMap<String, TargetState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_targets() -> MutexGuard<'static, HashMap<String, TargetState>> {
    TARGETS.lock().unwrap_or_else(|e| e.into_inner())
}

/// [`Command::output`] with a deadline: poll `try_wait`, and on `timeout`
/// kill and reap the child instead of waiting for the target app to answer.
fn output_with_deadline(cmd: &mut Command, timeout: Duration) -> OsascriptOutcome {
    let mut child = match cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => return OsascriptOutcome::Failed(e),
    };
    let out_reader = spawn_reader(child.stdout.take());
    let err_reader = spawn_reader(child.stderr.take());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return OsascriptOutcome::Failed(e),
        }
        if started.elapsed() >= timeout {
            kill(&mut child);
            // Don't join the pipe readers: if anything else still holds the
            // pipes open, the joins would outlive the deadline. The reader
            // threads finish on their own once the pipes close.
            drop(out_reader);
            drop(err_reader);
            return OsascriptOutcome::TimedOut;
        }
        thread::sleep(Duration::from_millis(15));
    };
    OsascriptOutcome::Completed(Output {
        status,
        stdout: out_reader.join().unwrap_or_default(),
        stderr: err_reader.join().unwrap_or_default(),
    })
}

fn spawn_reader<R: Read + Send + 'static>(pipe: Option<R>) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    })
}

fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Instant;

    /// Run `sh -c <script>` guarded, under a one-off app name so tests never
    /// need `osascript` and never collide on the shared cooldown state.
    fn sh_for(app: &str, script: &str, timeout: Duration) -> OsascriptOutcome {
        run_guarded("sh", &["-c", script], app, timeout, COOLDOWN)
    }

    fn completed(outcome: OsascriptOutcome) -> Output {
        match outcome {
            OsascriptOutcome::Completed(output) => output,
            other => panic!("expected Completed, got {:?}", other),
        }
    }

    #[test]
    fn output_stderr_and_exit_status_pass_through_unchanged() {
        let output = completed(sh_for(
            "PassthroughOsascriptApp",
            "printf hi; printf err >&2; exit 3",
            LOOKUP_TIMEOUT,
        ));
        assert_eq!(output.stdout, b"hi");
        assert_eq!(output.stderr, b"err");
        assert_eq!(output.status.code(), Some(3));
    }

    #[test]
    fn a_child_past_the_deadline_is_killed_and_reports_timed_out() {
        let started = Instant::now();
        let outcome = sh_for(
            "DeadlineOsascriptApp",
            "sleep 2",
            Duration::from_millis(200),
        );
        assert!(
            matches!(outcome, OsascriptOutcome::TimedOut),
            "got {:?}",
            outcome
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "kill + reap took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn after_a_timeout_the_same_app_cools_down_without_spawning() {
        let outcome = sh_for(
            "CooldownOsascriptApp",
            "sleep 2",
            Duration::from_millis(200),
        );
        assert!(
            matches!(outcome, OsascriptOutcome::TimedOut),
            "got {:?}",
            outcome
        );

        // Same app: answered at once, and the script never runs (it would
        // print if it did).
        let started = Instant::now();
        let outcome = sh_for(
            "CooldownOsascriptApp",
            "echo spawned",
            Duration::from_secs(5),
        );
        assert!(
            matches!(outcome, OsascriptOutcome::CoolingDown),
            "got {:?}",
            outcome
        );
        assert!(started.elapsed() < Duration::from_millis(500));

        // A different app is unaffected.
        let output = completed(sh_for(
            "CooldownOtherOsascriptApp",
            "printf ok",
            LOOKUP_TIMEOUT,
        ));
        assert_eq!(output.stdout, b"ok");
    }

    #[test]
    fn an_expired_cooldown_lets_the_next_run_spawn() {
        let cooldown = Duration::from_millis(200);
        let outcome = run_guarded(
            "sh",
            &["-c", "sleep 2"],
            "ExpiredOsascriptApp",
            Duration::from_millis(100),
            cooldown,
        );
        assert!(
            matches!(outcome, OsascriptOutcome::TimedOut),
            "got {:?}",
            outcome
        );
        thread::sleep(cooldown + Duration::from_millis(100));
        let output = completed(run_guarded(
            "sh",
            &["-c", "printf back"],
            "ExpiredOsascriptApp",
            LOOKUP_TIMEOUT,
            cooldown,
        ));
        assert_eq!(output.stdout, b"back");
    }

    #[test]
    fn a_concurrent_call_for_a_healthy_app_runs_alongside() {
        // Two healthy lookups to one app (capture and the meeting probe) both
        // used to get their answer; only a stalled target turns callers away.
        let first = thread::spawn(|| {
            sh_for(
                "AlongsideOsascriptApp",
                "sleep 1; printf first",
                LOOKUP_TIMEOUT,
            )
        });
        thread::sleep(Duration::from_millis(100));
        let output = completed(sh_for(
            "AlongsideOsascriptApp",
            "printf second",
            LOOKUP_TIMEOUT,
        ));
        assert_eq!(output.stdout, b"second");
        assert_eq!(completed(first.join().unwrap()).stdout, b"first");
    }

    #[test]
    fn a_call_while_the_app_looks_stalled_is_busy() {
        let first = thread::spawn(|| {
            sh_for(
                "StalledOsascriptApp",
                "sleep 1.5; printf done",
                LOOKUP_TIMEOUT,
            )
        });
        // Past `STALLED_AFTER` with no answer: the target looks stalled.
        thread::sleep(STALLED_AFTER + Duration::from_millis(300));
        let started = Instant::now();
        let outcome = sh_for("StalledOsascriptApp", "echo spawned", LOOKUP_TIMEOUT);
        assert!(
            matches!(outcome, OsascriptOutcome::Busy),
            "got {:?}",
            outcome
        );
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(completed(first.join().unwrap()).stdout, b"done");
    }

    #[test]
    fn a_finished_run_does_not_leave_the_app_looking_stalled() {
        // The oldest run ends while a newer one is still in flight: the stall
        // check must age the newer one, not the run that already answered.
        let first = thread::spawn(|| {
            sh_for(
                "HandoverOsascriptApp",
                "sleep 0.6; printf first",
                LOOKUP_TIMEOUT,
            )
        });
        thread::sleep(Duration::from_millis(300));
        let second = thread::spawn(|| {
            sh_for(
                "HandoverOsascriptApp",
                "sleep 1; printf second",
                LOOKUP_TIMEOUT,
            )
        });
        assert_eq!(completed(first.join().unwrap()).stdout, b"first");
        // The second run has been in flight ~300 ms, under `STALLED_AFTER`.
        let output = completed(sh_for(
            "HandoverOsascriptApp",
            "printf third",
            LOOKUP_TIMEOUT,
        ));
        assert_eq!(output.stdout, b"third");
        assert_eq!(completed(second.join().unwrap()).stdout, b"second");
    }

    #[test]
    fn the_in_flight_claim_is_given_back_when_the_run_unwinds() {
        // A panic between claim and release must not leave the app answering
        // `Busy` for the rest of the session.
        let unwound = std::panic::catch_unwind(|| {
            let _slot = claim("UnwindOsascriptApp").ok().unwrap();
            panic!("unwind with the claim held");
        });
        assert!(unwound.is_err());
        let targets = lock_targets();
        let state = &targets["UnwindOsascriptApp"];
        assert!(state.in_flight.is_empty());
    }

    #[test]
    fn the_target_app_is_parsed_from_the_script() {
        assert_eq!(
            script_target(r#"tell application "Google Chrome" to return 1"#),
            "google chrome"
        );
        assert_eq!(
            script_target(r#"if application "Arc" is running then"#),
            "arc"
        );
        assert_eq!(script_target("return 1"), "");
    }
}
