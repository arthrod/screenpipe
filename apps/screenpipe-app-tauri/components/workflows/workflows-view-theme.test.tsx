// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeWorkflowData, WorkflowsApp } from "@screenpipe/workflows-ui";
import { createFixtureWorkflowsPlatform } from "@screenpipe/workflows-ui/fixture";
import { buildDetectedTask, CLARIFICATION_QUESTIONS, DEMO_TASK_ID } from "@/lib/automation-flows/demo-task/detected-task";
import { upsertTask } from "@/lib/automation-flows/demo-task/catalog";
import { IntegratedWorkflows } from "./integrated-workflows";

// The Workflows view (library, Task Page, evidence, questions, « Create
// automation ») rendered with its real stylesheets under the app's
// `dark` class: no element on screen may paint a light neutral surface or
// force a light colour scheme. Its dialogs (access notice, automatic updates)
// keep the light palette on purpose.

vi.mock("@/lib/hooks/use-settings", () => ({
  useSettings: () => ({ settings: { aiPresets: [], user: {}, workflowSource: "device" }, updateSettings: vi.fn(), isSettingsLoaded: true }),
}));
vi.mock("@/lib/hooks/use-is-enterprise-build", () => ({
  useEnterpriseBuildStatus: () => ({ isEnterprise: false, resolved: true }),
}));
vi.mock("@/lib/workflows/rollout", () => ({ useWorkflowsRolloutEnabled: () => true }));
vi.mock("@/lib/hooks/use-model-upsell-gating", () => ({ useModelUpsellGating: () => false }));
vi.mock("@/lib/hooks/use-managed-policy", () => ({ useManagedPolicy: () => ({ isManagedDeployment: false, policy: {} }) }));
vi.mock("@/lib/hooks/use-pi-models", () => ({ usePiModels: () => ({ piModels: [], isLoading: false, upgradeEligible: false }) }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/workflows/desktop-platform", async () => {
  const { createFixtureWorkflowsPlatform } = await import("@screenpipe/workflows-ui/fixture");
  return { desktopWorkflowsPlatform: createFixtureWorkflowsPlatform() };
});

const at = "2026-10-17T02:05:41Z";

// Every stylesheet of the shared package, with the class names vitest gives
// the CSS modules and `:global(x)` unwrapped, so jsdom cascades the real rules.
const modules = import.meta.glob<Record<string, string>>("../../node_modules/@screenpipe/workflows-ui/src/*.module.css", { eager: true, import: "default" });

function injectStylesheets() {
  // jsdom paints form controls white whatever the colour scheme; a browser's
  // default control fill follows it. Model that before the author rules.
  const userAgent = document.createElement("style");
  userAgent.dataset.workflowsTheme = "user-agent";
  userAgent.textContent = "input, textarea, select, button { background-color: transparent; }";
  document.head.appendChild(userAgent);
  for (const [file, names] of Object.entries(modules)) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    // Odd parts are `:global(...)` contents and keep their names.
    const css = source.split(/:global\(([^()]*)\)/).map((part, index) => index % 2
      ? part
      : part.replace(/\.([A-Za-z_][\w-]*)/g, (whole, name: string) => names[name] ? `.${names[name]}` : whole)).join("")
      // jsdom's selector engine emulates `:has()` by rebuilding a selector from
      // the subject element, which breaks on React's `:r8:`-style ids. Those
      // rules only re-tint an ancestor the children already paint; drop them.
      .replace(/[^{}]*:has\([^)]*\)[^{}]*\{[^{}]*\}/g, "");
    const style = document.createElement("style");
    style.dataset.workflowsTheme = file;
    style.textContent = css;
    document.head.appendChild(style);
    expect(style.sheet?.cssRules.length, `${file} parsed by jsdom`).toBeGreaterThan(0);
  }
}

// jsdom cascades declarations but neither resolves var() nor inherits custom
// properties, so the nearest declaring ancestor wins, as in a browser.
function customProperty(element: Element | null, name: string): string {
  for (let node = element; node; node = node.parentElement) {
    const value = getComputedStyle(node).getPropertyValue(name).trim();
    if (value) return value;
  }
  return "";
}

function resolve(element: Element, value: string, depth = 0): string {
  if (depth > 10 || !value.includes("var(")) return value;
  return resolve(element, value.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (_, name: string, fallback?: string) => customProperty(element, name) || fallback || ""), depth + 1);
}

type Rgba = [number, number, number, number];
function colours(value: string): Rgba[] {
  const found: Rgba[] = [];
  for (const match of value.matchAll(/#([0-9a-f]{3,8})\b|rgba?\(([^)]*)\)|\b(white|ivory|snow|whitesmoke)\b/gi)) {
    if (match[1]) {
      let hex = match[1];
      if (hex.length <= 4) hex = [...hex].map(c => c + c).join("");
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      found.push([n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1]);
    } else if (match[2]) {
      const parts = match[2].split(/[\s,/]+/).filter(Boolean).map(Number);
      found.push([parts[0], parts[1], parts[2], parts[3] ?? 1]);
    } else {
      found.push([255, 255, 255, 1]);
    }
  }
  return found;
}

// A light neutral: bright and barely tinted (white, greys, cream). Saturated
// accents such as the lime mark stay allowed, and faint overlays are ignored.
function isLightSurface([r, g, b, a]: Rgba): boolean {
  if (a < 0.3) return false;
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  return luminance([r, g, b, a]) > 0.5 && chroma < 0.4;
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function textColour(element: Element): Rgba | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const found = colours(resolve(node, getComputedStyle(node).getPropertyValue("color")));
    if (found.length) return found[0];
  }
  return undefined;
}

// Like the app's own primary buttons, an active or primary control may invert
// in dark mode: a light fill carrying dark text. Anything else is a light block.
function isInvertedControl(element: Element): boolean {
  if (!element.matches("button, a, [role='button'], [role='tab']")) return false;
  const text = textColour(element);
  return text !== undefined && luminance(text) < 0.1;
}

// Favicons are drawn for a white tile, so the app-icon chips keep one in dark
// mode too, like a browser's tab strip. Only those small tiles are allowed.
function isIconTile(element: Element): boolean {
  // The browser badge nested in a tile is part of the same favicon surface.
  const tile = element.closest("[class*='appIcon']");
  if (!tile) return false;
  const width = parseFloat(getComputedStyle(tile).getPropertyValue("width"));
  return Number.isFinite(width) && width <= 28;
}

function lightSurfaces(root: Element): string[] {
  const offenders: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    // A hidden page (Context, while the Task Page shows) is not on screen.
    if (element.closest("[hidden]")) continue;
    const style = getComputedStyle(element);
    const painted = ["background-color", "background", "background-image"].map(p => style.getPropertyValue(p)).join(" ");
    const resolved = resolve(element, painted);
    const scheme = `${style.getPropertyValue("color-scheme")} ${(element as HTMLElement).style?.colorScheme ?? ""}`;
    const label = `<${element.tagName.toLowerCase()} class="${element.getAttribute("class") ?? ""}"${element.getAttribute("aria-label") ? ` aria-label="${element.getAttribute("aria-label")}"` : ""}>`;
    if (colours(resolved).some(isLightSurface) && !isInvertedControl(element) && !isIconTile(element)) offenders.push(`${label} paints ${resolved.trim()}`);
    if (/\blight\b/.test(scheme) && !/\bdark\b/.test(scheme)) offenders.push(`${label} forces color-scheme ${scheme.trim()}`);
  }
  return offenders;
}

async function renderTaskPage() {
  window.history.replaceState(null, "", "/home?mode=workflows");
  const task = buildDetectedTask(() => "data:image/webp;base64,AAAA", at);
  const catalog = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
  const platform = { ...createFixtureWorkflowsPlatform(catalog), createAutomationFlow: vi.fn(async () => {}), canCreateAutomationFlow: () => true };
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(<WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key: "demo", workflowId: DEMO_TASK_ID }} />));
  });
  await screen.findByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] });
  expect(screen.getByRole("button", { name: "Create automation" })).toBeInTheDocument();
  return container;
}

describe("Workflows view follows the app theme", () => {
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear();
    injectStylesheets();
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll("style[data-workflows-theme]").forEach(style => style.remove());
    document.documentElement.classList.remove("dark", "light");
  });

  it("paints the light palette when the app is light", async () => {
    document.documentElement.classList.add("light");
    const container = await renderTaskPage();
    // Guards the detector: the light theme does show light surfaces.
    expect(lightSurfaces(container).length).toBeGreaterThan(0);
  });

  it("leaves no light surface on the Task Page when the app is dark", async () => {
    document.documentElement.classList.add("dark");
    const container = await renderTaskPage();
    expect(lightSurfaces(container)).toEqual([]);
  });

  it("leaves no light surface or forced light select in the integrated view when the app is dark", async () => {
    document.documentElement.classList.add("dark");
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<IntegratedWorkflows active onModeChange={vi.fn()} recordingStatus={null} />));
    });
    expect(await screen.findByRole("combobox", { name: "Workflow source" })).toBeInTheDocument();
    expect(lightSurfaces(container)).toEqual([]);
  });
});
