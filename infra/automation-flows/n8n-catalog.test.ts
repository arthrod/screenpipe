// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// The node catalog ScreenPipe checks chat-built Flows against must describe
// the n8n this repo runs. Regenerate it with `bun infra/automation-flows/n8n-catalog.ts`.
// Run: bun test infra/automation-flows/n8n-catalog.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detail, group, indexEntry, screenpipeTypes } from "./n8n-catalog.ts";

const here = import.meta.dir;
const catalog = JSON.parse(readFileSync(join(here, "n8n-catalog.json"), "utf8"));
const compose = readFileSync(join(here, "docker-compose.yml"), "utf8");
const demo = JSON.parse(readFileSync(join(here, "workflows/novadesk-support-tickets.json"), "utf8"));
// The browsing layer the chat searches (gzip: it is embedded in the engine).
const browsing = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(here, "n8n-nodes.json.gz")))));
type Entry = { type: string; name: string; description: string; version: number; trigger?: boolean; credentials: string[]; off?: boolean };

describe("n8n node catalog", () => {
  test("describes the pinned n8n image", () => {
    const pinned = compose.match(/image:\s*n8nio\/n8n:([\w.-]+)/)?.[1];
    expect(pinned).toBeDefined();
    expect(catalog.n8n).toBe(pinned);
  });

  test("knows every node of the demo workflow, at its version", () => {
    for (const node of demo.nodes) {
      const groups = catalog.nodes[node.type];
      expect(groups, node.type).toBeDefined();
      expect(groups.some((g: { versions: number[] }) => g.versions.includes(node.typeVersion)), `${node.type} ${node.typeVersion}`).toBe(true);
    }
  });

  test("leaves out the nodes this n8n switches off, and has the ScreenPipe nodes", () => {
    expect(catalog.excluded).toContain("n8n-nodes-base.executeCommand");
    expect(catalog.nodes["n8n-nodes-base.executeCommand"]).toBeUndefined();
    for (const type of ["CUSTOM.screenPipe", "CUSTOM.screenPipeTool", "CUSTOM.screenPipeTrigger", "CUSTOM.screenPipeAiTrigger"]) {
      expect(catalog.nodes[type], type).toBeDefined();
    }
  });
});

describe("n8n node browsing layer", () => {
  test("comes from the same n8n image as the check layer", () => {
    expect(browsing.n8n).toBe(catalog.n8n);
  });

  test("lists every type the check accepts, at its latest version, and nothing else usable", () => {
    const usable = browsing.index.filter((entry: Entry) => !entry.off);
    expect(usable.map((entry: Entry) => entry.type).sort()).toEqual(Object.keys(catalog.nodes).sort());
    for (const entry of usable) {
      const versions = catalog.nodes[entry.type].flatMap((g: { versions: number[] }) => g.versions);
      expect(entry.version, entry.type).toBe(Math.max(...versions));
      expect(browsing.details[entry.type] ?? browsing.details[entry.toolOf], entry.type).toBeDefined();
    }
  });

  test("lists the switched-off types, flagged", () => {
    const off = browsing.index.filter((entry: Entry) => entry.off).map((entry: Entry) => entry.type).sort();
    expect(off).toEqual([...catalog.excluded].sort());
    const command = browsing.index.find((entry: Entry) => entry.type === "n8n-nodes-base.executeCommand");
    expect(command.name).toBe("Execute Command");
  });

  test("the AI-tool twin of a switched-off node is switched off too", () => {
    // n8n builds `<name>Tool` twins from the nodes it loads, so none exists here.
    expect(catalog.nodes["n8n-nodes-base.executeCommandTool"]).toBeUndefined();
    expect(catalog.excluded).toContain("n8n-nodes-base.executeCommandTool");
    const twin = browsing.index.find((entry: Entry) => entry.type === "n8n-nodes-base.executeCommandTool");
    expect(twin.off).toBe(true);
  });

  test("a card keeps allowed values, display rules and required fields nested in collections", () => {
    const gmail = browsing.details["n8n-nodes-base.gmail"];
    const operation = gmail.properties.find((p: { name: string; show?: Record<string, unknown> }) => p.name === "operation" && p.show?.resource?.[0] === "message");
    expect(operation.options).toContainEqual({ value: "send", does: "Send a message" });
    const sendTo = gmail.properties.find((p: { name: string }) => p.name === "sendTo");
    expect(sendTo).toMatchObject({ required: true, show: { resource: ["message"] } });
    // « Send and wait » form fields: a fixed collection whose label is required.
    const form = gmail.properties.find((p: { name: string }) => p.name === "formFields");
    const label = form.groups[0].fields.find((f: { name: string }) => f.name === "fieldLabel");
    expect(label.required).toBe(true);
    // Locators say how to address a resource.
    const jira = browsing.details["n8n-nodes-base.jira"];
    expect(jira.properties.find((p: { name: string }) => p.name === "project").modes).toContain("id");
    expect(JSON.stringify(gmail)).not.toMatch(/iconUrl|routing|<a href/);
  });
});

describe("ScreenPipe n8n nodes", () => {
  test("are in both layers exactly as the package describes them (run the generator after changing them)", async () => {
    const types = await screenpipeTypes();
    expect(types.map(([type]) => type).sort()).toEqual(
      Object.keys(catalog.nodes).filter((type) => type.startsWith("CUSTOM.")).sort(),
    );
    for (const [type, description] of types) {
      expect(catalog.nodes[type], type).toEqual([group(description)]);
      const toolOf = type.endsWith("Tool") ? type.slice(0, -"Tool".length) : undefined;
      const entry = browsing.index.find((e: Entry) => e.type === type);
      expect(entry, type).toEqual(indexEntry(type, description, { toolOf }));
      if (!toolOf) expect(browsing.details[type], type).toEqual(detail(description));
    }
  });
});

