// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { beforeEach, expect, it, vi } from "vitest";
import type { GuideVideoScene } from "@screenpipe/workflows-ui";

const mocks = vi.hoisted(() => ({
  createWorkflowVideo: vi.fn(),
  findWorkflowScreenshot: vi.fn(),
  loadOriginalWorkflowScreenshot: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ copyFile: vi.fn(), mkdir: vi.fn(), remove: vi.fn(), readDir: vi.fn(async () => []), stat: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn(async () => "/tmp/videos") }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/utils/tauri", () => ({ commands: { createWorkflowVideo: mocks.createWorkflowVideo } }));
vi.mock("./source-screenshot", () => ({ findWorkflowScreenshot: mocks.findWorkflowScreenshot }));
vi.mock("./original-screenshot", () => ({ loadOriginalWorkflowScreenshot: mocks.loadOriginalWorkflowScreenshot }));
import { desktopGuideVideo } from "./guide-video";

// Upstream #7634 gates /search and frame media behind PII redaction. The
// engine answers 503 {code:"privacy_pending"} until release: "not yet".
const pending = () => Object.assign(new Error("The screenshot is still being redacted; try again shortly."), { name: "PrivacyPendingError" });
const scene = {
  id: "section-0", title: "Review", narration: "Check the claim.",
  image: "data:image/png;base64,aW1hZ2U=", imageFrameId: 5, includeImage: true,
} as GuideVideoScene;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createWorkflowVideo.mockResolvedValue({ status: "ok", data: { path: "/v.mp4", captionsPath: "/v.vtt" } });
});

it("falls back to the scene's saved pixels while the original is still being redacted", async () => {
  mocks.loadOriginalWorkflowScreenshot.mockRejectedValue(pending());
  const result = await desktopGuideVideo.generate([scene], new AbortController().signal, () => {});
  expect(result.path).toBe("/v.mp4");
  expect(mocks.createWorkflowVideo.mock.calls[0][1][0]).toMatchObject({ image: scene.image });
});

it("falls back to saved pixels when the recorder search is still redacting", async () => {
  mocks.findWorkflowScreenshot.mockRejectedValue(pending());
  const sourced = { ...scene, imageFrameId: undefined, imageSources: [{ timestamp: "2026-09-23T19:07:42Z", app: "Docs" }] };
  await desktopGuideVideo.generate([sourced], new AbortController().signal, () => {});
  expect(mocks.createWorkflowVideo.mock.calls[0][1][0]).toMatchObject({ image: scene.image });
});

it("still fails the video when the original is gone for good", async () => {
  mocks.loadOriginalWorkflowScreenshot.mockRejectedValue(new Error("A screenshot is unavailable. Restore or replace that screenshot before rendering."));
  await expect(desktopGuideVideo.generate([scene], new AbortController().signal, () => {})).rejects.toThrow(/unavailable/);
  expect(mocks.createWorkflowVideo).not.toHaveBeenCalled();
});
