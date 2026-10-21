// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// On Windows, WebView2 runs Tauri's IPC init script in child frames too
// (`AddScriptToExecuteOnDocumentCreated`) while wry's `on_navigation` fires
// for main-document navigations only — so a page open in the agent-owned
// browser can embed `<iframe src="http://tauri.localhost/">` and speak IPC
// under its host webview's label. The structural defense is the ACL itself:
// the sensitive grants (fs over `$HOME/**`, the screenpipe shell sidecar,
// plain `http:default`) must be bound to window labels of genuine
// first-party app windows, never to a glob that also matches the
// owned-browser webviews. Those webviews hold no capability at all — their
// result bridge (`browser_scripts/owned_browser_bridge.js`) deliberately
// never calls `window.__TAURI__`.

type Permission = string | { identifier?: string };
type Capability = {
  identifier?: string;
  local?: boolean;
  windows?: string[];
  permissions?: Permission[];
};

const srcTauri = resolve(process.cwd(), "src-tauri");
const capabilitiesDir = resolve(srcTauri, "capabilities");

// Mirrors tauri-utils `CapabilityFile`: a file holds one capability, a list
// of them, or `{ "capabilities": [...] }` (same reader as
// webview-remote-ipc.test.ts).
function capabilitiesIn(file: string): Capability[] {
  const parsed = JSON.parse(readFileSync(resolve(capabilitiesDir, file), "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed.capabilities) ? parsed.capabilities : [parsed];
}

function allCapabilities(): { file: string; capability: Capability }[] {
  return readdirSync(capabilitiesDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => capabilitiesIn(file).map((capability) => ({ file, capability })));
}

function permissionIdentifier(permission: Permission): string {
  return typeof permission === "string" ? permission : (permission.identifier ?? "");
}

// The sensitive families named by the review: filesystem access, shell
// execution (screenpipe sidecar, launchers), and the raw http plugin.
function isHighValue(identifier: string): boolean {
  return (
    identifier.startsWith("fs:") || identifier.startsWith("shell:") || identifier.startsWith("http:")
  );
}

function capabilitiesWithHighValuePermissions() {
  return allCapabilities().filter(({ capability }) =>
    (capability.permissions ?? []).some((permission) =>
      isHighValue(permissionIdentifier(permission)),
    ),
  );
}

// Mirrors tauri-utils `parse_glob_patterns` (the `glob` crate): window labels
// never contain `/`, so a `*` that matches any run of characters and a `?`
// for one character is a faithful subset for the patterns used here.
function globMatches(pattern: string, label: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(label);
}

// Owned-browser window labels, from src-tauri/src/owned_browser.rs:
// `WEBVIEW_LABEL` ("owned-browser"), `browser_tab_label` (dynamic
// "owned-browser-tab-<id>", id ≤ 64 chars of [a-zA-Z0-9-_]), and
// `BACKGROUND_HOST_LABEL` (a webview-less host window — guarded anyway).
const OWNED_BROWSER_LABELS = [
  "owned-browser",
  "owned-browser-tab-0",
  "owned-browser-tab-0ecdb833-b162-4c92-8e3b-4a5d2f6c1a77",
  "owned-browser-bg-host",
];

// Every label the app creates a webview with app content for
// (`WebviewUrl::App`): window/show.rs `RewindWindowId` (main, home, search,
// onboarding, chat, permission-recovery), window/panel.rs
// `main_label_for_mode` ("main-window"), viewer.rs `label_for_path`
// (dynamic "viewer-<16 hex>"), commands.rs ("shortcut-reminder",
// "notification-inbox", "notification-panel"), and
// commands/starred_sessions.rs ("starred-sessions"). Windows that load
// external origins (login-browser, google-calendar-auth, pipe windows) hold
// no local capability either way — a `local: true` capability never applies
// to a remote origin — so they are absent on purpose.
const APP_WINDOW_LABELS = [
  "chat",
  "home",
  "main",
  "main-window",
  "notification-inbox",
  "notification-panel",
  "onboarding",
  "permission-recovery",
  "search",
  "shortcut-reminder",
  "starred-sessions",
];
const APP_WINDOW_GLOBS = [...APP_WINDOW_LABELS, "viewer-*"].sort();

describe("webview capability window scoping", () => {
  it("grants no fs/shell/http permission on a window glob matching the owned browser", () => {
    const offenders: string[] = [];
    for (const { file, capability } of capabilitiesWithHighValuePermissions()) {
      const globs = capability.windows ?? [];
      for (const glob of globs) {
        for (const label of OWNED_BROWSER_LABELS) {
          if (globMatches(glob, label)) {
            offenders.push(`${file} ${capability.identifier}: window "${glob}" matches ${label}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("binds every fs/shell/http grant to known first-party app windows only", () => {
    const globs = new Set<string>();
    for (const { capability } of capabilitiesWithHighValuePermissions()) {
      for (const glob of capability.windows ?? []) globs.add(glob);
    }
    expect([...globs].sort()).toEqual(APP_WINDOW_GLOBS);
  });

  it("keeps granting the app windows the fs/shell/http set", () => {
    // Positive guard: scoping must narrow the window list, not thin the
    // grants — the app's own windows still need the full set.
    const sampleLabels = [...APP_WINDOW_LABELS, "viewer-0123456789abcdef"];
    for (const label of sampleLabels) {
      const granted = new Set(
        capabilitiesWithHighValuePermissions()
          .filter(({ capability }) =>
            (capability.windows ?? []).some((glob) => globMatches(glob, label)),
          )
          .flatMap(({ capability }) =>
            (capability.permissions ?? []).map((permission) => permissionIdentifier(permission)),
          ),
      );
      for (const identifier of ["fs:allow-read-file", "shell:allow-execute", "http:default"]) {
        expect(granted.has(identifier), `${label}: ${identifier}`).toBe(true);
      }
    }

    // The fs scope the review called out — `$HOME/**` read access — must
    // still reach the main window.
    const fsScopes = capabilitiesWithHighValuePermissions()
      .filter(({ capability }) =>
        (capability.windows ?? []).some((glob) => globMatches(glob, "main")),
      )
      .flatMap(({ capability }) =>
        (capability.permissions ?? []).filter(
          (permission) => permissionIdentifier(permission) === "fs:scope",
        ),
      ) as { allow?: { path?: string }[] }[];
    const paths = fsScopes.flatMap((scope) => (scope.allow ?? []).map((entry) => entry.path));
    expect(paths).toContain("$HOME/**");
  });
});
