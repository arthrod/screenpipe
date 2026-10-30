// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
//! Keep the kernel from suspending the recorder when swap runs out.
//!
//! launchd spawns LaunchAgents (and LaunchServices spawns ordinary apps) with
//! `POSIX_SPAWN_PCONTROL_SUSPEND`: `proc_pidinfo` shows it as
//! `PROC_FLAG_PC_SUSP`, "in resource starvation situations, this process is
//! to be suspended". When the compressor pool or swap is exhausted, XNU's
//! `no_paging_space_action` picks the biggest such process and
//! `proc_dopcontrol` calls `task_suspend` on it ("memorystatus: suspending
//! <name> [<pid>] due to swap exhaustion"). Nothing resumes it afterwards
//! except root's `proc_resetpcontrol` or a SIGCONT. That is what froze the
//! installed app for 17 hours on 2026-10-29 (0 GB free, swap 14/18 GB, every
//! thread parked mid-instruction, `ps` state S, `kill -CONT` revived it).
//!
//! launchd spawns the app with the bit clear. It is LaunchServices' own
//! application check-in that puts the process into the pool: proven on
//! 2026-10-30 with a dyld interposer on `proc_setpcontrol`, the call is
//! `proc_setpcontrol(PROC_SETPC_SUSPEND)` from `_LSApplicationCheckIn`
//! (LaunchServices) <- `_RegisterApplication` (HIServices, dispatch_once) <-
//! `+[NSApplication sharedApplication]` <- tao's `EventLoop::new` <-
//! `tauri::Builder::build`. Every GUI app registered with LaunchServices
//! carries it (Chrome, Zoom, Zed, the WebKit XPC helpers, ...); background
//! agents, Finder and Dock do not. A recorder must not be silently paused:
//! the capture it misses is gone. `proc_setpcontrol(PROC_SETPC_NONE)`
//! (libproc, public since 10.6) takes the process back out, so under the same
//! pressure the kernel acts on another candidate instead and, if this app is
//! ever the one holding half the compressor, kills it outright like any
//! unregistered process, which is visible and recoverable, unlike a pause.
//! Because the check-in runs inside `build()`, the opt-out has to come after
//! it: `keep_opted_out` asserts NONE from `RunEvent::Ready` and then every
//! `REASSERT_INTERVAL` in case anything re-registers the process later; one
//! syscall, nowhere near a hot path.
//! `stop_watchdog` remains the second line for a pause that still happens.

#[cfg(target_os = "macos")]
mod imp {
    use crate::stop_watchdog::{bsd_info, PROC_FLAG_PC_SUSP};

    extern "C" {
        /// libproc: set this process's own process-control state on resource
        /// starvation. Returns 0 or an errno value (not -1).
        fn proc_setpcontrol(control: libc::c_int) -> libc::c_int;
    }

    /// `PROC_SETPC_NONE`: the kernel takes no action on this process.
    pub const PROC_SETPC_NONE: libc::c_int = 0;
    /// `PROC_SETPC_SUSPEND`: what launchd spawned us with.
    pub const PROC_SETPC_SUSPEND: libc::c_int = 2;

    /// Does `pbi_flags` say the kernel may suspend this process on swap
    /// exhaustion?
    pub fn suspend_control_is_set(flags: u32) -> bool {
        flags & PROC_FLAG_PC_SUSP != 0
    }

    /// This process's `pbi_flags`.
    pub fn own_flags() -> Option<u32> {
        bsd_info(std::process::id() as i32)
            .ok()
            .map(|info| info.pbi_flags)
    }

    /// Set this process's process-control state.
    pub fn set_own_pcontrol(control: libc::c_int) -> std::io::Result<()> {
        // SAFETY: plain syscall wrapper on our own pid; no pointers.
        match unsafe { proc_setpcontrol(control) } {
            0 => Ok(()),
            errno => Err(std::io::Error::from_raw_os_error(errno)),
        }
    }

    /// How often `keep_opted_out` re-asserts the opt-out.
    pub const REASSERT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

    /// Leave the pool now and keep leaving it every `REASSERT_INTERVAL` for
    /// the life of the process. Idempotent: a second call is a no-op.
    pub fn keep_opted_out() {
        static STARTED: std::sync::Once = std::sync::Once::new();
        STARTED.call_once(|| {
            opt_out_of_low_swap_suspension();
            std::thread::Builder::new()
                .name("low-swap-control".into())
                .spawn(|| loop {
                    std::thread::sleep(REASSERT_INTERVAL);
                    opt_out_of_low_swap_suspension();
                })
                .map(drop)
                .unwrap_or_else(|error| {
                    tracing::warn!("low swap control: re-assert thread failed to start: {error}")
                });
        });
    }

    /// Leave the kernel's suspend-on-swap-exhaustion pool. Idempotent and
    /// quiet when already out.
    pub fn opt_out_of_low_swap_suspension() {
        let before = own_flags();
        if let Some(flags) = before {
            if !suspend_control_is_set(flags) {
                tracing::debug!(
                    "low swap control: not in the kernel's suspend pool (pbi_flags={flags:#x})"
                );
                return;
            }
        }
        if let Err(error) = set_own_pcontrol(PROC_SETPC_NONE) {
            tracing::warn!(
                "low swap control: proc_setpcontrol(NONE) failed: {error}; macOS may still suspend this process on swap exhaustion"
            );
            return;
        }
        let after = own_flags();
        match after {
            Some(flags) if !suspend_control_is_set(flags) => tracing::info!(
                "low swap control: left the kernel's suspend-on-swap-exhaustion pool (pbi_flags {:#x} -> {flags:#x})",
                before.unwrap_or(0)
            ),
            Some(flags) => tracing::warn!(
                "low swap control: proc_setpcontrol(NONE) returned 0 but PC_SUSP is still set (pbi_flags={flags:#x})"
            ),
            None => tracing::warn!(
                "low swap control: proc_setpcontrol(NONE) succeeded but proc_pidinfo on self failed"
            ),
        }
    }
}

#[cfg(target_os = "macos")]
pub use imp::{keep_opted_out, opt_out_of_low_swap_suspension};

/// No-op off macOS.
#[cfg(not(target_os = "macos"))]
pub fn opt_out_of_low_swap_suspension() {}

/// No-op off macOS; see the module docs.
#[cfg(not(target_os = "macos"))]
pub fn keep_opted_out() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::imp::*;

    #[test]
    fn own_process_leaves_the_kernels_suspend_pool() {
        // `cargo test` is spawned by a shell, so start from what launchd does
        // to the installed app: mark ourselves suspendable. Harmless unless
        // the machine runs out of swap during these microseconds.
        set_own_pcontrol(PROC_SETPC_SUSPEND).expect("proc_setpcontrol(SUSPEND)");
        let before = own_flags().expect("proc_pidinfo on self");
        assert!(
            suspend_control_is_set(before),
            "PC_SUSP should be set after PROC_SETPC_SUSPEND; flags={before:#x}"
        );

        opt_out_of_low_swap_suspension();

        let after = own_flags().expect("proc_pidinfo on self");
        assert!(
            !suspend_control_is_set(after),
            "PC_SUSP should be clear after opting out; flags={after:#x}"
        );
        // Idempotent and quiet the second time.
        opt_out_of_low_swap_suspension();
        assert!(!suspend_control_is_set(own_flags().unwrap()));

        // The periodic form leaves the pool immediately as well, even when
        // something (WebKit, in the app) put us back in after the first call.
        set_own_pcontrol(PROC_SETPC_SUSPEND).expect("proc_setpcontrol(SUSPEND)");
        assert!(suspend_control_is_set(own_flags().unwrap()));
        keep_opted_out();
        assert!(!suspend_control_is_set(own_flags().unwrap()));
        keep_opted_out();
        assert!(!suspend_control_is_set(own_flags().unwrap()));
    }

    #[test]
    fn the_flag_is_the_proc_info_bit() {
        // bsd/sys/proc_info.h: PROC_FLAG_PC_SUSP 0x400; PA_SUSP 0x1000 is the
        // "currently suspended" action bit, not the control bit.
        assert!(suspend_control_is_set(0x400));
        assert!(!suspend_control_is_set(0x1000));
        assert!(!suspend_control_is_set(0));
    }
}
