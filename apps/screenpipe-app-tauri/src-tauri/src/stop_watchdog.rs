// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
//! SIGCONT watchdog for the desktop app.
//!
//! On 2026-10-29 the installed app sat for 17 hours with every thread parked
//! mid-instruction at 0% CPU, still answering nothing: not a crash, not a
//! deadlock, and not a signal stop either (`ps` still said `S`), but a Mach
//! `task_suspend` that a single `kill -CONT` undid instantly. The actor is the
//! kernel: launchd spawns this app with `POSIX_SPAWN_PCONTROL_SUSPEND`
//! (`proc_pidinfo` flag `PROC_FLAG_PC_SUSP`), and when the compressor pool /
//! swap runs out, `no_paging_space_action` picks the biggest such process and
//! `proc_dopcontrol` suspends it ("memorystatus: suspending screenpipe-app
//! [765] due to swap exhaustion"), setting `PROC_FLAG_PA_SUSP`. That day had
//! 0 GB free, swap 14/18 GB, and jetsam killing the app's own XPC child 11 s
//! earlier. Nothing ever resumes such a process unless the user finds the
//! "run out of application memory" dialog. `low_swap_control` now opts the
//! app out of that pool; this watchdog is the second line: a suspended process
//! cannot help itself, so the app launches a copy of its own binary in
//! `--watchdog <pid>` mode, in its own process group, which polls the parent's
//! BSD state and sends SIGCONT when it is stopped by a signal (`SSTOP`) OR
//! carries `PA_SUSP`. SIGCONT reaches `task_resume_internal` in both cases
//! (XNU `psignal_internal`). Recording is the hot path: a stopped recorder is
//! silent data loss, and this costs one `proc_pidinfo` call every
//! `POLL_INTERVAL`.
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

/// `proc_bsdinfo.pbi_flags` bits, from XNU `bsd/sys/proc_info.h`. These are
/// the proc_info values, NOT the kernel-internal `p_flag` bits (`P_TRACED`
/// there is 0x800, which proc_info reports as `PROC_FLAG_PA_THROTTLE`).
#[cfg(target_os = "macos")]
const PROC_FLAG_TRACED: u32 = 0x2;
/// "In resource starvation situations, this process is to be suspended."
#[cfg(target_os = "macos")]
pub(crate) const PROC_FLAG_PC_SUSP: u32 = 0x400;
/// "The process is currently suspended due to resource starvation."
#[cfg(target_os = "macos")]
pub(crate) const PROC_FLAG_PA_SUSP: u32 = 0x1000;

#[cfg(target_os = "macos")]
fn is_traced(flags: u32) -> bool {
    flags & PROC_FLAG_TRACED != 0
}

/// `pbi_flags` as hex plus the names that matter for a stopped app, so the
/// watchdog log says whether macOS suspended it for resource starvation.
#[cfg(target_os = "macos")]
fn describe_flags(flags: u32) -> String {
    let mut names = Vec::new();
    if is_traced(flags) {
        names.push("TRACED");
    }
    if flags & PROC_FLAG_PC_SUSP != 0 {
        names.push("PC_SUSP");
    }
    if flags & PROC_FLAG_PA_SUSP != 0 {
        names.push("PA_SUSP");
    }
    if names.is_empty() {
        format!("{flags:#x}")
    } else {
        format!("{flags:#x} [{}]", names.join(" "))
    }
}

/// The watchdog is the app's child; once the app exits it is re-parented to
/// launchd. Checking this before every tick means a reused pid can never be
/// mistaken for the app.
#[cfg(target_os = "macos")]
fn parent_still_ours(parent: i32) -> bool {
    // SAFETY: plain syscall.
    let ppid = unsafe { libc::getppid() };
    ppid == parent
}

/// Why `bsd_info` could not read a process.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Probe {
    /// No such process.
    Gone,
    /// The process exists but could not be inspected (errno); keep watching.
    Unreadable(i32),
}

#[cfg(target_os = "macos")]
fn classify_probe_error(errno: i32) -> Probe {
    if errno == libc::ESRCH {
        Probe::Gone
    } else {
        Probe::Unreadable(errno)
    }
}

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

/// How the parent came to be stopped; both are undone by SIGCONT.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stopped {
    /// A stop signal (`SSTOP`, what `ps` shows as `T`).
    Signal,
    /// The kernel's no-paging-space action `task_suspend`ed it
    /// (`PROC_FLAG_PA_SUSP`); `ps` still shows `S`.
    SwapExhaustion,
}

/// The watchdog's one decision, kept pure because swap exhaustion cannot be
/// reproduced in a test. `SSTOP` wins over the flag so the log names what
/// `ps` would have shown.
#[cfg(target_os = "macos")]
fn stopped_how(status: u32, flags: u32) -> Option<Stopped> {
    if status == libc::SSTOP {
        Some(Stopped::Signal)
    } else if flags & PROC_FLAG_PA_SUSP != 0 {
        Some(Stopped::SwapExhaustion)
    } else {
        None
    }
}

/// `PA_SUSP` never clears (only root's `proc_resetpcontrol` does), so after a
/// swap-exhaustion revive every tick keeps re-sending a harmless SIGCONT; log
/// only when the reason changes, and again if the parent runs normally for a
/// tick first.
#[cfg(target_os = "macos")]
fn should_log(last: &mut Option<Stopped>, now: Option<Stopped>) -> bool {
    let changed = now.is_some() && now != *last;
    *last = now;
    changed
}

/// What one watchdog tick did to the parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tick {
    /// Parent is running (or sleeping) normally.
    Running,
    /// Parent was stopped and SIGCONT was sent; carries how and its `pbi_flags`.
    Revived(Stopped, u32),
    /// Parent is stopped under a debugger; left alone.
    Traced,
    /// Parent could not be inspected this tick (errno); keep watching.
    Unreadable(i32),
    /// Parent no longer exists: the watchdog should exit.
    Gone,
}

/// Parent's BSD state via `proc_pidinfo(PROC_PIDTBSDINFO)`.
#[cfg(target_os = "macos")]
pub(crate) fn bsd_info(pid: i32) -> Result<libc::proc_bsdinfo, Probe> {
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
    if written == size {
        Ok(info)
    } else {
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
        Err(classify_probe_error(errno))
    }
}

/// Is the process stopped at the BSD level (`SSTOP`, what `ps` shows as `T`)?
/// `None` when there is no such process (or it cannot be inspected).
#[cfg(target_os = "macos")]
pub fn process_is_stopped(pid: i32) -> Option<bool> {
    bsd_info(pid)
        .ok()
        .map(|info| info.pbi_status == libc::SSTOP)
}

/// One watchdog tick: inspect the parent and continue it if it is stopped.
#[cfg(target_os = "macos")]
pub fn tick(parent: i32) -> Tick {
    let info = match bsd_info(parent) {
        Ok(info) => info,
        Err(Probe::Gone) => return Tick::Gone,
        Err(Probe::Unreadable(errno)) => return Tick::Unreadable(errno),
    };
    let Some(how) = stopped_how(info.pbi_status, info.pbi_flags) else {
        return Tick::Running;
    };
    if is_traced(info.pbi_flags) {
        return Tick::Traced;
    }
    // SAFETY: plain signal send to a pid we just inspected.
    let sent = unsafe { libc::kill(parent, libc::SIGCONT) } == 0;
    if sent {
        Tick::Revived(how, info.pbi_flags)
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
    let mut unreadable_logged = false;
    let mut last_revive: Option<Stopped> = None;
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if !parent_still_ours(parent) {
            log_line(&format!(
                "parent pid={parent} exited (watchdog re-parented); exiting"
            ));
            return 0;
        }
        match tick(parent) {
            Tick::Running => {
                should_log(&mut last_revive, None);
            }
            Tick::Unreadable(errno) => {
                if !unreadable_logged {
                    log_line(&format!(
                        "parent pid={parent} could not be inspected (errno {errno}); still watching"
                    ));
                    unreadable_logged = true;
                }
            }
            Tick::Revived(how, flags) => {
                if should_log(&mut last_revive, Some(how)) {
                    let what = match how {
                        Stopped::Signal => "stopped by a signal (SSTOP)",
                        Stopped::SwapExhaustion => {
                            "suspended by the kernel for swap exhaustion (PA_SUSP)"
                        }
                    };
                    log_line(&format!(
                        "parent pid={parent} was {what} with pbi_flags={}; sent SIGCONT",
                        describe_flags(flags)
                    ));
                }
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

        assert!(matches!(tick(pid), Tick::Revived(Stopped::Signal, _)));
        wait_for(pid, Some(false));
        assert_eq!(tick(pid), Tick::Running);

        child.kill().expect("kill sleep");
        child.wait().expect("reap sleep");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn swap_exhaustion_suspension_needs_sigcont_even_while_status_says_running() {
        // 2026-10-29: `ps` said S, pbi_status was never SSTOP, and the process
        // was still frozen. The control bit alone (PC_SUSP) is not a stop.
        assert_eq!(
            stopped_how(libc::SRUN, PROC_FLAG_PA_SUSP),
            Some(Stopped::SwapExhaustion)
        );
        assert_eq!(
            stopped_how(libc::SSLEEP, PROC_FLAG_PC_SUSP | PROC_FLAG_PA_SUSP),
            Some(Stopped::SwapExhaustion)
        );
        assert_eq!(stopped_how(libc::SRUN, PROC_FLAG_PC_SUSP), None);
        assert_eq!(stopped_how(libc::SSLEEP, 0), None);
        assert_eq!(stopped_how(libc::SSTOP, 0), Some(Stopped::Signal));
        assert_eq!(
            stopped_how(libc::SSTOP, PROC_FLAG_PA_SUSP),
            Some(Stopped::Signal)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn swap_exhaustion_revive_is_logged_once_until_the_parent_runs_again() {
        let mut last = None;
        assert!(should_log(&mut last, Some(Stopped::SwapExhaustion)));
        // PA_SUSP persists, so the next ticks revive again: stay quiet.
        assert!(!should_log(&mut last, Some(Stopped::SwapExhaustion)));
        assert!(!should_log(&mut last, Some(Stopped::SwapExhaustion)));
        // A different reason is news.
        assert!(should_log(&mut last, Some(Stopped::Signal)));
        assert!(!should_log(&mut last, Some(Stopped::Signal)));
        // Running normally resets, so a later stop is logged again.
        assert!(!should_log(&mut last, None));
        assert!(should_log(&mut last, Some(Stopped::Signal)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn traced_flag_is_the_proc_info_bit() {
        // bsd/sys/proc_info.h: PROC_FLAG_TRACED is 2. 0x800 is
        // PROC_FLAG_PA_THROTTLE, the resource-starvation throttle.
        assert_eq!(PROC_FLAG_TRACED, 0x2);
        assert!(is_traced(PROC_FLAG_TRACED));
        assert!(!is_traced(0x800));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn starvation_suspension_is_named_in_the_flag_description() {
        assert_eq!(describe_flags(0x1000), "0x1000 [PA_SUSP]");
        assert_eq!(describe_flags(0x400 | 0x2), "0x402 [TRACED PC_SUSP]");
        assert_eq!(describe_flags(0), "0x0");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parent_identity_follows_getppid() {
        // SAFETY: plain syscall.
        let ppid = unsafe { libc::getppid() };
        assert!(parent_still_ours(ppid));
        assert!(!parent_still_ours(std::process::id() as i32));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn probe_separates_a_missing_process_from_an_unreadable_one() {
        let mut child = std::process::Command::new("/usr/bin/true")
            .spawn()
            .expect("spawn true");
        let pid = child.id() as i32;
        child.wait().expect("reap true");
        assert!(matches!(bsd_info(pid), Err(Probe::Gone)));
        assert_eq!(tick(pid), Tick::Gone);
        // Any other errno keeps the watchdog alive instead of abandoning the app.
        assert_eq!(classify_probe_error(libc::ESRCH), Probe::Gone);
        assert_eq!(
            classify_probe_error(libc::EPERM),
            Probe::Unreadable(libc::EPERM)
        );
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
