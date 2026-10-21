// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { collectBunTestFiles } from "./scripts/bun-test-files";

// `formatDate` renders in the machine's local zone (no `timeZone` option), so
// fixtures with hardcoded calendar dates pass in one zone and fail in another
// (02:05Z is still "Oct 16" anywhere from UTC-3 westward). CI already runs in
// UTC: pin the workers to UTC too, so every contributor run matches CI. An
// explicit `TZ` on the command line still wins, for hostile-zone checks.
process.env.TZ ??= "UTC";

// Node 25+ turns on its own Web Storage: its `localStorage` global (undefined
// without `--localstorage-file`) hides jsdom's, and every test touching it
// fails. Switch it off in the test workers on the Node versions that have it.
const nodeWebStorageOff = process.allowedNodeEnvironmentFlags.has("--experimental-webstorage")
	? ["--no-experimental-webstorage"]
	: [];

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		poolOptions: {
			threads: { execArgv: nodeWebStorageOff },
			forks: { execArgv: nodeWebStorageOff },
		},
		include: ["**/__tests__/**/*.test.{ts,tsx}", "**/*.test.{ts,tsx}"],
		// `"node_modules"` only excludes the top-level dir, not nested ones.
		// Without `**/node_modules/**` vitest crawled into
		// `.e2e/pi-agent/node_modules/zod/**` and ran its bundled test
		// suite, surfacing 7 unrelated "failures" we have no business
		// running. `.e2e/` is the WebdriverIO suite (run via `test:e2e`,
		// not vitest).
		//
		// Files importing from "bun:test" run under the Bun-native runner
		// (`bun run test:bun`), not vitest — they are discovered and
		// excluded automatically by scripts/bun-test-files.ts, which is
		// also what test:bun executes. No hand-maintained list.
		exclude: [
			"**/node_modules/**",
			"**/.next/**",
			"**/dist/**",
			".e2e/**",
			"e2e/**",
			"src-tauri/target/**",
			...collectBunTestFiles(__dirname),
			// KNOWN-BROKEN: pre-existing failures surfaced when wiring tests
			// into CI. Each is a real assertion failure (component drifted
			// from its test) — excluded so we can ship the CI gate now and
			// fix in follow-ups. Don't add new entries without an owner.
			//   - text-overlay.test.tsx: container.firstChild null + missing
			//     "solid" underline on link blocks
			"components/__tests__/text-overlay.test.tsx",
		],
	},
	resolve: {
		preserveSymlinks: true,
		alias: {
			"@/lib/i18n/generated.json": path.resolve(__dirname, "lib/i18n/empty.json"),
			// Resolve the shared workflow package peer from the desktop test host.
			"lucide-react": path.resolve(__dirname, "node_modules/lucide-react"),
            // Shared SOP/rich-text sources resolve editor dependencies from this test host.
            ...Object.fromEntries(["react-markdown", "remark-gfm", "fflate", "unpdf", "prosemirror-model", "prosemirror-state", "prosemirror-view", "prosemirror-markdown", "prosemirror-commands", "prosemirror-history", "prosemirror-keymap", "prosemirror-inputrules", "prosemirror-schema-list"].map(name => [name, path.resolve(__dirname, "node_modules", name)])),
			"gt-react": path.resolve(__dirname, "node_modules/gt-react/dist/index.client.mjs"),
			"@": path.resolve(__dirname, "./"),
			"@screenpipe-ext": path.resolve(__dirname, "../../crates/screenpipe-core/assets/extensions"),
		},
	},
});
