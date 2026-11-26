# AniWave — instructions for AI coding agents

## Mission
Build AniWave into a modern anime platform with a searchable catalog, lawful video playback integrations, user accounts, and community features. Improve the existing application incrementally; do not replace working systems without an approved migration plan.

## Read before changing code
- Read this file and `docs/AI_DEVELOPER_SPEC.md`.
- Inspect the relevant source files and current Git history before proposing edits.
- The current frontend is primarily a single-page `index.html` application with inline CSS/JavaScript.
- Firebase Authentication and Cloud Firestore are used by the client.
- `firestore.rules` and `firestore.rules.test.js` define and test database access policy.
- `firebase.json` configures the Firestore emulator on port 8085.
- The admin-facing AniWave Assistant currently calls a Cloudflare Worker staging endpoint. Do not assume that endpoint's source code or deployment configuration is present in this repository.

## Safe development workflow
1. Work only on a dedicated feature branch. Never commit directly to `main`.
2. Make the smallest coherent change that satisfies the task.
3. Preserve existing behavior and data compatibility unless the task explicitly approves a breaking migration.
4. Never add credentials, API keys, service-account files, bearer tokens, private user data, or production secrets to Git.
5. Never weaken Firestore rules to make a feature work. Add or update rules tests for every changed access pattern.
6. Do not run destructive database operations, change Firebase production data, deploy Cloudflare Workers, publish a release, or merge a PR without explicit human approval.
7. For frontend work, check responsive behavior, keyboard access, loading/empty/error states, and escaping of user-generated content.
8. Prefer semantic HTML and small reusable functions. Avoid introducing a framework or build system without a documented migration proposal and approval.
9. Use lawful, licensed, or user-provided video sources only. Do not scrape, proxy, or embed unauthorized streams.
10. Do not claim tests passed unless they were actually run and their results are available.

## Required validation
- Run the relevant existing tests where the environment permits.
- For Firestore rule changes, run `npm run test:rules` and report emulator/tooling limitations accurately.
- For UI changes, include a concise manual browser test checklist; add automated browser tests when the project has an established runner.
- Inspect the final diff for secrets, unrelated changes, unsafe HTML insertion, and accidental changes to production configuration.

## Pull request expectations
Every PR must state: purpose, user-visible changes, implementation notes, tests actually run, risks/migrations, and manual verification steps. Keep PRs focused and leave merging/deployment to the repository owner.
