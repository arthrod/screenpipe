// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Builds the node catalog of the local n8n, in two layers from one read of
// the same image:
//
// - n8n-catalog.json, the check layer: the node types n8n really loads, so
//   ScreenPipe refuses a Flow with an invented, disabled or incomplete node
//   (crates/screenpipe-engine/src/flow_checks.rs). For each type: its
//   versions, whether it is a trigger, the credentials it requires and the
//   parameters it requires, with the display rules (and the defaults those
//   rules read) that switch them on.
// - n8n-nodes.json.gz, the browsing layer the chat searches and reads
//   (crates/screenpipe-engine/src/n8n_nodes.rs): an index of every type,
//   switched-off ones flagged, and per type a card of its latest version with
//   trimmed parameters (allowed values, display rules, nested fields). Icons,
//   routing data and long docs are dropped. Gzipped: the engine embeds it.
//
// Run it again after changing the n8n image or the ScreenPipe nodes:
//
//   bun infra/automation-flows/n8n-catalog.ts
//
// Reads the running container ($N8N_CONTAINER, default automation-flows-n8n-1)
// and the ScreenPipe nodes in packages/n8n-nodes-screenpipe.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const container = process.env.N8N_CONTAINER ?? "automation-flows-n8n-1";
const here = import.meta.dir;
const out = join(here, "n8n-catalog.json");
const browsingOut = join(here, "n8n-nodes.json.gz");

function inContainer(command: string): string {
  const run = Bun.spawnSync(["docker", "exec", container, "sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`docker exec ${container} ${command}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

type Display = { show?: Record<string, unknown[]>; hide?: Record<string, unknown[]> };
type Property = {
  name: string;
  displayName?: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  description?: string;
  displayOptions?: Display;
  // Option values, collection fields, or fixed-collection groups (`values`).
  options?: (Partial<Property> & { name: string; value?: unknown; values?: Property[] })[];
  modes?: { name: string }[];
  typeOptions?: { loadOptionsMethod?: string; multipleValues?: boolean };
};
export type Description = {
  name: string;
  displayName?: string;
  description?: string;
  version: number | number[];
  group?: string[];
  polling?: boolean;
  usableAsTool?: unknown;
  codex?: { alias?: string[] };
  credentials?: { name: string; required?: boolean; displayOptions?: Display }[];
  properties?: Property[];
};

/** Only `show` and `hide`: the rules the check evaluates. */
function rules(display: Display | undefined) {
  const kept: Display = {};
  if (display?.show && Object.keys(display.show).length) kept.show = display.show;
  if (display?.hide && Object.keys(display.hide).length) kept.hide = display.hide;
  return kept;
}

/** Parameter names a display rule reads (`/resource` is the root `resource`). */
function readNames(display: Display | undefined): string[] {
  return [display?.show, display?.hide]
    .flatMap((side) => Object.keys(side ?? {}))
    .filter((key) => !key.startsWith("@"))
    .map((key) => key.replace(/^\//, ""));
}

/** One version group: what the check needs, nothing else. */
export function group(description: Description) {
  const properties = description.properties ?? [];
  const credentials = (description.credentials ?? [])
    .filter((credential) => credential.required)
    .map((credential) => ({ name: credential.name, ...rules(credential.displayOptions) }));
  // Required parameters, and every definition of a parameter a rule reads
  // (transitively): its default decides whether a rule matches.
  const wanted = new Set<string>(properties.filter((p) => p.required).map((p) => p.name));
  for (const credential of description.credentials ?? []) readNames(credential.displayOptions).forEach((n) => wanted.add(n));
  let size = -1;
  while (size !== wanted.size) {
    size = wanted.size;
    for (const property of properties) if (wanted.has(property.name)) readNames(property.displayOptions).forEach((n) => wanted.add(n));
  }
  const params = properties
    .filter((property) => wanted.has(property.name))
    .map((property) => ({
      name: property.name,
      ...(property.type ? { type: property.type } : {}),
      default: property.default ?? null,
      ...(property.required ? { required: true } : {}),
      ...rules(property.displayOptions),
    }));
  // Not `webhooks`: action nodes such as Gmail have one for « send and wait ».
  const trigger = Boolean(description.group?.includes("trigger") || description.polling);
  return {
    versions: [description.version].flat(),
    ...(trigger ? { trigger: true } : {}),
    credentials,
    params,
  };
}

// ---------------------------------------------------------------------------
// Browsing layer
// ---------------------------------------------------------------------------

/** UI-only parameter types: nothing to fill. */
const DISPLAY_ONLY = new Set(["notice", "callout", "hidden", "button", "icon", "curlImport"]);
const MAX_DESCRIPTION = 160;

const latest = (description: Description) => Math.max(...[description.version].flat());

/** Plain text, short: n8n descriptions carry HTML links and long docs. */
function short(text: string | undefined): string | undefined {
  const plain = text?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!plain) return undefined;
  return plain.length > MAX_DESCRIPTION ? `${plain.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : plain;
}

/** Whether an `@version` rule keeps a parameter at `version`; an unknown condition keeps it. */
function versionAllows(display: Display | undefined, version: number): boolean {
  const holds = (allowed: unknown) => {
    const condition = (allowed as { _cnd?: Record<string, unknown> } | null)?._cnd;
    if (!condition) return allowed === version;
    const [op, arg] = Object.entries(condition)[0] ?? [];
    const range = arg as { from: number; to: number };
    switch (op) {
      case "eq": return version === arg;
      case "not": return version !== arg;
      case "gte": return version >= (arg as number);
      case "lte": return version <= (arg as number);
      case "gt": return version > (arg as number);
      case "lt": return version < (arg as number);
      case "between": return version >= range.from && version <= range.to;
      default: return true;
    }
  };
  const shown = display?.show?.["@version"];
  const hidden = display?.hide?.["@version"];
  return (!shown || shown.some(holds)) && !(hidden && hidden.some(holds));
}

/** A parameter as the chat needs it to fill a node; nothing for the editor's UI. */
function param(property: Property, version: number): Record<string, unknown> | undefined {
  if (DISPLAY_ONLY.has(property.type ?? "") || !versionAllows(property.displayOptions, version)) return undefined;
  const fields = (list: Property[] | undefined) =>
    (list ?? []).map((p) => param(p, version)).filter((p): p is Record<string, unknown> => Boolean(p));
  const kept: Record<string, unknown> = {
    name: property.name,
    ...(property.displayName && property.displayName !== property.name ? { displayName: property.displayName } : {}),
    type: property.type,
    default: property.default ?? null,
    ...(property.required ? { required: true } : {}),
  };
  const description = short(property.description);
  if (description) kept.description = description;
  if (property.typeOptions?.multipleValues) kept.multiple = true;
  if (property.type === "options" || property.type === "multiOptions") {
    // Values loaded from the user's account (Jira projects…): no fixed list.
    if (property.typeOptions?.loadOptionsMethod) kept.dynamic = true;
    // A bare value, or `{value, does}` when n8n says what choosing it does
    // (resources and operations).
    const values = (property.options ?? [])
      .filter((o) => o.value !== undefined)
      .map((o) => {
        const does = short((o as { action?: string }).action ?? o.description);
        return does ? { value: o.value, does } : o.value;
      });
    if (values.length) kept.options = values;
  } else if (property.type === "collection") {
    kept.fields = fields(property.options as Property[]);
  } else if (property.type === "fixedCollection") {
    kept.groups = (property.options ?? []).map((o) => ({ name: o.name, fields: fields(o.values) }));
  } else if (property.type === "resourceLocator") {
    kept.modes = (property.modes ?? []).map((m) => m.name);
  }
  return { ...kept, ...rules(property.displayOptions) };
}

/** The card of a type's latest version. */
export function detail(description: Description) {
  const version = latest(description);
  return {
    version,
    credentials: (description.credentials ?? []).map((credential) => ({
      name: credential.name,
      ...(credential.required ? { required: true } : {}),
      ...rules(credential.displayOptions),
    })),
    properties: (description.properties ?? []).map((p) => param(p, version)).filter(Boolean),
  };
}

/** One search entry: enough to pick a type, then read its card. */
export function indexEntry(type: string, description: Description, extra: { off?: boolean; toolOf?: string } = {}) {
  const aliases = description.codex?.alias ?? [];
  return {
    type,
    name: description.displayName ?? description.name,
    description: short(description.description) ?? "",
    version: latest(description),
    ...(group(description).trigger ? { trigger: true } : {}),
    credentials: [...new Set((description.credentials ?? []).map((credential) => credential.name))],
    ...(aliases.length ? { aliases } : {}),
    ...(extra.toolOf ? { toolOf: extra.toolOf } : {}),
    ...(extra.off ? { off: true } : {}),
  };
}

/** n8n adds a `<name>Tool` twin of every node usable as an AI Agent tool. */
const toolTwin = (description: Description): Description => ({ ...description, group: [], polling: false });

/** The ScreenPipe nodes, as this n8n loads them (`CUSTOM.`), with their tool twins. */
export async function screenpipeTypes(): Promise<[string, Description][]> {
  const customDir = join(here, "../../packages/n8n-nodes-screenpipe/nodes");
  const types: [string, Description][] = [];
  for (const dir of readdirSync(customDir).sort()) {
    const module = await import(join(customDir, dir, `${dir}.node.ts`));
    const description: Description = new module[dir]().description;
    types.push([`CUSTOM.${description.name}`, description]);
    if (description.usableAsTool) types.push([`CUSTOM.${description.name}Tool`, toolTwin(description)]);
  }
  return types;
}

async function generate() {
  const n8nVersion = inContainer("n8n --version").trim();

  const packages: [string, string][] = inContainer(
    'find /usr/local/lib/node_modules/n8n/node_modules/.pnpm -path "*dist/types/nodes.json"',
  )
    .trim()
    .split("\n")
    .map((path) => [path, path.includes("n8n-nodes-langchain") ? "@n8n/n8n-nodes-langchain." : "n8n-nodes-base."]);

  // NODES_EXCLUDE when set, else n8n's own default list (from its config).
  const excludeEnv = inContainer("printenv NODES_EXCLUDE || true").trim();
  const configPath = inContainer('find /usr/local/lib/node_modules/n8n/node_modules/.pnpm -path "*@n8n/config/dist/configs/nodes.config.js" | head -1').trim();
  const defaultExclude = inContainer(`cat '${configPath}'`).match(/this\.exclude = (\[[^\]]*\]);/)?.[1];
  if (!excludeEnv && !defaultExclude) throw new Error("cannot find n8n's excluded nodes");
  const excluded: string[] = JSON.parse((excludeEnv || defaultExclude!).replace(/'/g, '"'));

  const nodes: Record<string, ReturnType<typeof group>[]> = {};
  // Per type, its latest version's description (read by the index and the card).
  const newest: Record<string, { description: Description; toolOf?: string }> = {};
  const add = (type: string, description: Description, toolOf?: string) => {
    const current = newest[type];
    if (!current || latest(description) > latest(current.description)) newest[type] = { description, toolOf };
    // n8n builds tool twins from the nodes it loads: a switched-off node has none.
    if (toolOf && excluded.includes(toolOf) && !excluded.includes(type)) excluded.push(type);
    if (excluded.includes(type)) return;
    (nodes[type] ??= []).push(group(description));
  };
  for (const [path, prefix] of packages) {
    const descriptions: Description[] = JSON.parse(inContainer(`cat '${path}'`));
    for (const description of descriptions) {
      add(prefix + description.name, description);
      if (description.usableAsTool && !descriptions.some((d) => d.name === `${description.name}Tool`)) {
        add(`${prefix}${description.name}Tool`, toolTwin(description), prefix + description.name);
      }
    }
  }
  for (const [type, description] of await screenpipeTypes()) {
    add(type, description, type.endsWith("Tool") ? type.slice(0, -"Tool".length) : undefined);
  }

  const types = Object.keys(nodes).sort();
  const body = types.map((type) => `${JSON.stringify(type)}:${JSON.stringify(nodes[type])}`).join(",\n");
  writeFileSync(
    out,
    `{"n8n":${JSON.stringify(n8nVersion)},"excluded":${JSON.stringify(excluded)},"nodes":{\n${body}\n}}\n`,
  );
  console.log(`n8n ${n8nVersion}: ${types.length} node types (${excluded.length} excluded) → ${out}`);

  // A tool twin shares its node's card; only its index entry says so.
  const listed = Object.keys(newest).sort();
  const index = listed.map((type) =>
    indexEntry(type, newest[type].description, { off: excluded.includes(type), toolOf: newest[type].toolOf }),
  );
  const cards = listed
    .filter((type) => !excluded.includes(type) && !newest[type].toolOf)
    .map((type) => `${JSON.stringify(type)}:${JSON.stringify(detail(newest[type].description))}`);
  const browsing =
    `{"n8n":${JSON.stringify(n8nVersion)},"index":[\n${index.map((entry) => JSON.stringify(entry)).join(",\n")}\n],` +
    `"details":{\n${cards.join(",\n")}\n}}\n`;
  // zlib writes mtime 0: the same image always gives the same bytes.
  const packed = Bun.gzipSync(Buffer.from(browsing), { level: 9 });
  writeFileSync(browsingOut, packed);
  const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;
  console.log(`browsing layer: ${index.length} entries, ${kib(browsing.length)} JSON, ${kib(packed.length)} gzip → ${browsingOut}`);
}

if (import.meta.main) await generate();
