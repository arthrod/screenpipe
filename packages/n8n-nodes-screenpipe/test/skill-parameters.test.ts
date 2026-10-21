// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// The chat builds Flows from the `automation-flows` skill alone: it cannot read
// this package. Every parameter (and option value) of the ScreenPipe nodes must
// be named in the skill, or the chat leaves the node unconfigured.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { ScreenPipe } from "../nodes/ScreenPipe/ScreenPipe.node";
import { ScreenPipeAiTrigger } from "../nodes/ScreenPipeAiTrigger/ScreenPipeAiTrigger.node";
import { ScreenPipeTrigger } from "../nodes/ScreenPipeTrigger/ScreenPipeTrigger.node";

const skill = readFileSync(
  join(import.meta.dir, "../../../crates/screenpipe-core/assets/skills/automation-flows/SKILL.md"),
  "utf8",
);

function names(properties: INodeProperties[]): string[] {
  return properties.flatMap((property) => [
    property.name,
    ...((property.options ?? []) as { name?: string; value?: unknown; values?: INodeProperties[] }[]).flatMap((option) =>
      option.values ? names(option.values) : typeof option.value === "string" ? [option.value] : [],
    ),
  ]);
}

describe("the automation-flows skill names every ScreenPipe node parameter", () => {
  for (const node of [new ScreenPipe(), new ScreenPipeTrigger(), new ScreenPipeAiTrigger()]) {
    const description = node.description as INodeTypeDescription;
    test(description.name, () => {
      expect(skill).toContain(`CUSTOM.${description.name}\``);
      const missing = [...new Set(names(description.properties))].filter((name) => !skill.includes(`\`${name}\``));
      expect(missing).toEqual([]);
    });
  }

  test("polling triggers say how often they poll", () => {
    expect(skill).toContain("`pollTimes`");
  });
});
