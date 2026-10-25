# content-proof

Project notes for agents. Universal preferences live in `~/.claude/CLAUDE.md`; this file holds only
what is specific to this repo.

## Toolchain

- Node 22 and **npm 10**. CI (`.github/workflows/ci.yml:14`) and Vercel both run the npm bundled with
  Node 22. `package.json` pins this via `packageManager` and `engines`, and `.npmrc` sets
  `engine-strict=true`, so a local `npm install` under npm 12 fails with `EBADENGINE` instead of
  rewriting the lockfile.
- To change `package-lock.json` locally, use npm 10 explicitly: `npx -y npm@10 install --package-lock-only`.
  Why: `README.md:202`. A lockfile written by npm 12 broke CI twice in 2026-10.
- Checks CI runs, in order: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Docs worth reading before changing behaviour

- `README.md` — setup, scripts, deployment.
- `UBIQUITOUS_LANGUAGE.md` — the domain terms used in code and copy.
- `docs/adr/` — architecture decisions, including the per-user signing key ADR.
