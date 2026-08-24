# YAI Weekly Report Development Rules

This repository owns weekly calculation, interpretation, private derived event
history, Telegram weekly feedback, and privacy-safe public dashboard output.
It does not own personal input collection.

Before changing worklife integration:

1. Inspect the current worktree and preserve unrelated changes.
2. Read `..\yai-worklife-agent\docs\YAI_PERSONAL_SUITE_ARCHITECTURE.md`.
3. Read `..\yai-worklife-agent\contracts\yai-personal-suite.v1.json` and the relevant schemas.
4. Classify the change as `Contract impact: none | additive | breaking`.

Contract impact rules:

- `none`: weekly calculations, private synthesis, dashboard presentation, or delivery changes that do not alter worklife input expectations.
- `additive`: consume new optional fields with a fallback when absent.
- `breaking`: require, rename, reinterpret, relocate, or newly write worklife data. Add a new major contract version and keep v1 compatibility during migration.

Boundaries:

- Self-reports, now-context, life-baseline, and non-calendar routines are owned by `yai-worklife-agent` and are read-only here.
- `private_weekly_event_history` is the only registered cross-repository write. It is logically owned here but physically stored in the private worklife repository.
- Never place self-report originals, raw now-context, or full event history in `data/history.json`, `docs/`, or other public payloads.
- The newest authoritative personal data must be read through the registered paths; derived weekly interpretation must not overwrite source facts.
- Do not collect Telegram daily input or recreate the worklife daily agent.

Verification:

- Validate every checked-out worklife input against the central v1 schemas.
- Run `npm.cmd test` for code changes.
- Run the privacy tests whenever public payload fields or rendering change.
