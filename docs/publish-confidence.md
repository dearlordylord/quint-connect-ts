# Publish confidence

The publish checks are split by the boundary they protect. This keeps ordinary feedback fast while still testing the artifact that consumers receive.

## Required checks

`pnpm run ci` remains the ordinary unit and static-analysis suite. It includes the cheap package-contract test, which checks the exact supported export declarations and the normalized `bin.intent = "bin/intent.js"` declaration. Existing unit tests cover executable precedence, process/resource finalization, typed replay errors, and representative lossless ITF decoding. These cases use fakes or in-memory traces because packing would add no useful coverage.

`pnpm test:packed-consumer` is the package-boundary integration check. It:

- verifies the repository-pinned Quint 0.32.0 CLI and builds the package;
- creates the current-version tarball with `pnpm pack`;
- validates exports and the CLI bin against the files actually present in that tarball;
- installs the tarball with pnpm's offline mode in a fresh temporary project;
- imports the default, Effect, Vitest, and Vitest Simple entrypoints without Zod installed;
- runs one real trace through the explicit local `quintBin` with Effect `4.0.0-beta.99`;
- executes the packed `intent` bin and verifies its expected missing-optional-tool diagnostic;
- installs Zod only after the Effect-only check and imports the Zod entrypoint; and
- removes the temporary project and tarball even when a check fails.

The packed test deliberately avoids registry publication, `npx`, network fallback for Quint, temporary Changesets versioning, and `npm publish --dry-run`. Those operations either mutate release state or duplicate the package contents already validated from the tarball.

## CI policy

The Node 22 packed-consumer job runs after `pnpm run ci` on every push and pull request and is required publish evidence. Bun 1.3.14 runs the same smoke procedure from the same package source on the weekly schedule and on manual workflow dispatch; its separate job builds its own tarball. Bun is retained because it represents a real consumer workload, but it is not in the pull-request critical path because runtime installation and cross-runtime behavior add cost and a separate source of CI failures.

Before publishing, both `pnpm run ci` and the Node packed-consumer smoke must pass; `prepublishOnly` runs both. For releases whose advertised workload depends on Bun, also require a recent successful scheduled Bun job or manually dispatch the workflow before publishing.
