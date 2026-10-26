// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

//! Vision's accurate text recognizer runs a model that Apple's ML runtime
//! (E5RT) compiles into `~/Library/Caches/<process>/com.apple.e5rt.e5bundlecache`.
//! When those files are removed while the process runs (macOS purges caches
//! under disk pressure), every accurate request fails for the rest of the
//! process. This test purges its own process's cache, so it has a test binary
//! to itself.

#![cfg(target_os = "macos")]

use screenpipe_screen::perform_ocr_apple;
use std::path::{Path, PathBuf};

fn e5rt_cache_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("current exe");
    let home = std::env::var_os("HOME").expect("HOME");
    PathBuf::from(home)
        .join("Library/Caches")
        .join(exe.file_name().expect("exe name"))
        .join("com.apple.e5rt.e5bundlecache")
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(files_under(&path));
        } else {
            out.push(path);
        }
    }
    out
}

#[test]
fn ocr_keeps_returning_text_after_the_vision_model_cache_is_purged() {
    let image = image::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/testing_OCR.png"))
        .expect("open testing_OCR.png");

    let (warm, _, _) = perform_ocr_apple(&image, &[]);
    assert!(
        warm.contains("receiver_count"),
        "warm-up OCR failed: {warm:?}"
    );

    let dir = e5rt_cache_dir();
    let files = files_under(&dir);
    assert!(
        !files.is_empty(),
        "expected Vision's compiled model under {}; has macOS moved the E5RT cache?",
        dir.display()
    );
    for file in &files {
        std::fs::remove_file(file).expect("remove cached model file");
    }

    for attempt in 1..=5 {
        let (text, _, _) = perform_ocr_apple(&image, &[]);
        assert!(
            text.contains("screenpipe-server.rs") && text.contains("core.rs"),
            "attempt {attempt}: no text after the model cache was purged: {text:?}"
        );
    }
}
