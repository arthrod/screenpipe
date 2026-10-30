// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
//! Tell macOS the app is doing real work for as long as it lives.
//!
//! The desktop app is a menu-bar app with no visible window most of the time,
//! which is exactly the shape macOS likes to nap, suspend (RunningBoard
//! "Suspendable" assertions under Low Power Mode), or terminate. It is also a
//! recorder: any of those is silent data loss. `Info.plist` already opts out
//! of automatic and sudden termination; this holds the matching
//! `NSProcessInfo` activity so the runtime agrees. Idle-sleep prevention is
//! deliberately NOT requested here: that is the user's `keep_computer_awake`
//! setting (`screenpipe_engine::power::awake`).

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    use std::sync::OnceLock;

    /// The activity token. Ending the activity means releasing it, so it is
    /// held for the life of the process and never touched again; that is what
    /// makes the `Send`/`Sync` claim below sound.
    struct ActivityToken(#[allow(dead_code)] Retained<ProtocolObject<dyn NSObjectProtocol>>);
    // SAFETY: see `ActivityToken` — write-once, never read, never dropped.
    unsafe impl Send for ActivityToken {}
    unsafe impl Sync for ActivityToken {}

    static ACTIVITY: OnceLock<ActivityToken> = OnceLock::new();

    pub fn begin_recording_activity() {
        if ACTIVITY.get().is_some() {
            return;
        }
        let options = NSActivityOptions::Background
            | NSActivityOptions::SuddenTerminationDisabled
            | NSActivityOptions::AutomaticTerminationDisabled;
        let reason = NSString::from_str("screenpipe is recording");
        let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(options, &reason);
        let _ = ACTIVITY.set(ActivityToken(token));
        tracing::info!("process activity: background recording activity held for process lifetime");
    }
}

/// Hold a background, no-sudden/automatic-termination `NSProcessInfo`
/// activity for the rest of the process. Idempotent. No-op off macOS.
pub fn begin_recording_activity() {
    #[cfg(target_os = "macos")]
    imp::begin_recording_activity();
}
