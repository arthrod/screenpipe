// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
//! SIGCONT watchdog for the desktop app.
//!
//! On 2026-10-29 the installed app sat for 17 hours with every thread parked
//! mid-instruction at 0% CPU, still answering nothing: not a crash, not a
//! deadlock, but a BSD-level stop (`SSTOP`) that a single `kill -CONT` undid
//! instantly. The stop coincided with RunningBoard/MenuBarAgent taking
//! "Suspendable" assertions on menu-bar apps under Low Power Mode and memory
//! pressure. A stopped process cannot help itself, so the app launches a copy
//! of its own binary in `--watchdog <pid>` mode, in its own process group,
//! which polls the parent's BSD state and sends SIGCONT when it finds it
//! stopped. Recording is the hot path: a stopped recorder is silent data
//! loss, and this costs one `proc_pidinfo` call every `POLL_INTERVAL`.
//!
//! The watchdog never continues a process a debugger holds (`P_TRACED`), and
//! exits on its own once the parent is gone.

// The sidecar is macOS-only; the pure helpers stay compiled everywhere so
// their tests run on every platform.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::time::Duration;

/// Hidden CLI mode: `screenpipe-app --watchdog <parent pid>`.
pub const WATCHDOG_ARG: &str = "--watchdog";

/// How often the watchdog samples the parent's BSD process state.
pub const POLL_INTERVAL: Duration = Duration::from_secs(15);

/// `p_flag` bit for a process under ptrace (`P_TRACED` in `sys/proc.h`,
/// surfaced as `PROC_FLAG_TRACED` in `proc_bsdinfo.pbi_flags`).
#[cfg(target_os = "macos")]
const PROC_FLAG_TRACED: u32 = 0x0000_0800;

/// Parse the parent pid out of `--watchdog <pid>`.
///
/// `None` unless the flag is present and followed by a positive integer, so a
/// stray `--watchdog` can never make the app run as a watchdog of nothing.
pub fn watchdog_target<I, S>(args: I) -> Option<i32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg.as_ref() == WATCHDOG_ARG {
            return args
                .next()
                .and_then(|pid| pid.as_ref().parse::<i32>().ok())
                .filter(|pid| *pid > 0);
        }
    }
    None
}

/// What one watchdog tick did to the parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tick {
    /// Parent is running (or sleeping) normally.
    Running,
    /// Parent was stopped and SIGCONT was sent.
    Revived,
    /// Parent is stopped under a debugger; left alone.
    Traced,
    /// Parent no longer exists: the watchdog should exit.
    Gone,
}

/// Parent's BSD state via `proc_pidinfo(PROC_PIDTBSDINFO)`.
#[cfg(target_os = "macos")]
fn bsd_info(pid: i32) -> Option<libc::proc_bsdinfo> {
    // SAFETY: proc_bsdinfo is plain data; proc_pidinfo fills exactly `size`
    // bytes on success and reports how many it wrote.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast::<libc::c_void>(),
            size,
        )
    };
    (written == size).then_some(info)
}

/// Is the process stopped at the BSD level (`SSTOP`, what `ps` shows as `T`)?
/// `None` when there is no such process (or it cannot be inspected).
#[cfg(target_os = "macos")]
pub fn process_is_stopped(pid: i32) -> Option<bool> {
    bsd_info(pid).map(|info| info.pbi_status == libc::SSTOP)
}

/// One watchdog tick: inspect the parent and continue it if it is stopped.
#[cfg(target_os = "macos")]
pub fn tick(parent: i32) -> Tick {
    let Some(info) = bsd_info(parent) else {
        return Tick::Gone;
    };
    if info.pbi_status != libc::SSTOP {
        return Tick::Running;
    }
    if info.pbi_flags & PROC_FLAG_TRACED != 0 {
        return Tick::Traced;
    }
    // SAFETY: plain signal send to a pid we just inspected.
    let sent = unsafe { libc::kill(parent, libc::SIGCONT) } == 0;
    if sent {
        Tick::Revived
    } else {
        Tick::Gone
    }
}

#[cfg(target_os = "macos")]
fn log_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".screenpipe").join("watchdog.log"))
}

/// Append one timestamped line to `~/.screenpipe/watchdog.log`. The watchdog
/// has no tracing subscriber of its own; this file is the only trace it leaves.
#[cfg(target_os = "macos")]
fn log_line(message: &str) {
    use std::io::Write;
    let Some(path) = log_path() else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(
            file,
            "{} pid={} {}",
            chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z"),
            std::process::id(),
            message
        );
    }
}

/// Body of the `--watchdog <pid>` mode. Returns the process exit code once
/// the parent is gone.
#[cfg(target_os = "macos")]
pub fn run(parent: i32) -> i32 {
    log_line(&format!("watching parent pid={parent}"));
    loop {
        std::thread::sleep(POLL_INTERVAL);
        match tick(parent) {
            Tick::Running => {}
            Tick::Revived => {
                log_line(&format!(
                    "parent pid={parent} was stopped (SSTOP); sent SIGCONT"
                ));
            }
            Tick::Traced => {
                log_line(&format!(
                    "parent pid={parent} is stopped under a debugger; leaving it"
                ));
            }
            Tick::Gone => {
                log_line(&format!("parent pid={parent} is gone; exiting"));
                return 0;
            }
        }
    }
}

#[cfg(target_os = "macos")]
static WATCHDOG: std::sync::OnceLock<std::sync::Mutex<std::process::Child>> =
    std::sync::OnceLock::new();

/// Launch the watchdog for this process. Idempotent; failures only log.
///
/// The child gets its own process group so a stop aimed at the app's group
/// does not take the watchdog down with it, and no inherited stdio so it can
/// never hold the app's pipes open.
#[cfg(target_os = "macos")]
pub fn spawn_for_current_process() {
    use std::os::unix::process::CommandExt;
    if WATCHDOG.get().is_some() {
        return;
    }
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            tracing::warn!("stop watchdog: cannot resolve current executable: {error}");
            return;
        }
    };
    let parent = std::process::id();
    let spawned = std::process::Command::new(exe)
        .arg(WATCHDOG_ARG)
        .arg(parent.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn();
    match spawned {
        Ok(child) => {
            tracing::info!(
                "stop watchdog: spawned pid={} for parent pid={parent} (log: {:?})",
                child.id(),
                log_path()
            );
            let _ = WATCHDOG.set(std::sync::Mutex::new(child));
        }
        Err(error) => tracing::warn!("stop watchdog: failed to spawn: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_watchdog_target() {
        assert_eq!(
            watchdog_target(["screenpipe-app", "--watchdog", "765"]),
            Some(765)
        );
        assert_eq!(
            watchdog_target(["--watchdog", "765", "--autostart"]),
            Some(765)
        );
        assert_eq!(watchdog_target(["screenpipe-app", "--autostart"]), None);
        assert_eq!(watchdog_target(["screenpipe-app", "--watchdog"]), None);
        assert_eq!(watchdog_target(["--watchdog", "zero"]), None);
        assert_eq!(watchdog_target(["--watchdog", "0"]), None);
        assert_eq!(watchdog_target(["--watchdog", "-1"]), None);
        assert_eq!(watchdog_target(std::iter::empty::<&str>()), None);
    }

    #[cfg(target_os = "macos")]
    fn wait_for(pid: i32, expected: Option<bool>) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while process_is_stopped(pid) != expected {
            assert!(
                std::time::Instant::now() < deadline,
                "pid {pid} never reached stopped={expected:?} (now {:?})",
                process_is_stopped(pid)
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn tick_revives_a_stopped_child() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("60")
            .spawn()
            .expect("spawn sleep");
        let pid = child.id() as i32;
        wait_for(pid, Some(false));
        assert_eq!(tick(pid), Tick::Running);

        // SAFETY: our own child.
        assert_eq!(unsafe { libc::kill(pid, libc::SIGSTOP) }, 0);
        wait_for(pid, Some(true));

        assert_eq!(tick(pid), Tick::Revived);
        wait_for(pid, Some(false));
        assert_eq!(tick(pid), Tick::Running);

        child.kill().expect("kill sleep");
        child.wait().expect("reap sleep");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn tick_reports_a_reaped_child_as_gone() {
        let mut child = std::process::Command::new("/usr/bin/true")
            .spawn()
            .expect("spawn true");
        let pid = child.id() as i32;
        child.wait().expect("reap true");
        assert_eq!(process_is_stopped(pid), None);
        assert_eq!(tick(pid), Tick::Gone);
    }
}
