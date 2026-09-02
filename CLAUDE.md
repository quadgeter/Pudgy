# model.md — Rules for AI Assistance on This Project

This file defines how an AI model should work on this codebase. Read this first.

## Reference documents

- **pudgy.md** — the architecture document for this project. Treat it as the README / source of
  truth for tech stack, project structure, and design decisions. If you're unsure how something
  should be structured, or whether a pattern already exists for a problem, check pudgy.md before
  inventing a new approach.
- **current.md** — the current state of the project: what's built, what's in progress, open
  TODOs, and a log of recent major decisions.
- **specs/** — per-feature specification documents (e.g. `specs/monthly-spend.md`). Before
  implementing any feature that has a spec, read it fully first. A spec's inclusion/result rules
  (numbered, e.g. `SPEND-04`) are binding — implement exactly what they say, including edge
  cases the obvious/naive implementation would miss. If a spec's "Status" field says `Draft`, or
  it has an unresolved open-questions section, stop and flag it rather than implementing around
  the gap or picking a default yourself.

## General rules

1. **Don't contradict `pudgy.md` or `specs/` without flagging it.** If a request conflicts with
   an established architecture decision (e.g. "put the sync job in a SvelteKit endpoint" when
   `pudgy.md` says background sync lives in the persistent Hono backend), or with a numbered
   rule in a spec, point out the conflict and ask before proceeding, rather than silently
   deviating.
2. **Prefer the patterns already in use.** This project follows a provider-adapter pattern (see
   `pudgy.md`) for external data sources, a repository layer for DB access, and discriminated
   unions to make invalid states unrepresentable where practical. New code should follow these
   conventions rather than introducing a competing style.
3. **Money is always integer cents (`Cents = number`), never a raw JS `number` used loosely,
   and never a decimal string.** This was finalized 2026-09-01 — decimal strings are not a
   valid alternative representation anywhere in this codebase. JavaScript floats can't
   represent currency exactly, so all monetary fields (`Account.balance`, `Transaction.amount`,
   `CategoryLimit.limit`, `Budget.totalIncome`) are signed integers counting cents. Arithmetic
   on them is plain integer `+`/`-`/`*` — no decimal library needed or wanted.
4. **Categories are a hardcoded union/enum**, not a user-editable table. This is a single-user
   app; new categories are added by editing code, not through a settings UI.
5. **Shared types live in `packages/shared`, imported by both `apps/api` and `apps/web`.**
   Domain types (`Account`, `Transaction`, `Category`, `Budget`, etc.) must be defined once
   there — never redefined in either app.
6. **Keep domain logic free of framework specifics.** Code in `packages/shared` should not
   import Hono, tRPC, SvelteKit, or DB client types. Code in `apps/api/src/services` should not
   import Hono/tRPC types either — those belong in the router layer that consumes the service.
7. **Domain code is pure.** Nothing under `packages/shared/src/domain` may perform I/O or read
   ambient state: no `fetch`, no DB client, no filesystem, no `Date.now()`, no `new Date()`
   with no argument, no `Math.random()`. Anything time-dependent takes the date or month as a
   parameter. This is what makes the domain layer exhaustively testable, and it is not
   negotiable for convenience.
8. **The frontend never talks to the DB directly.** All data access from `apps/web` goes through
   the tRPC client — no direct DB imports in the frontend app, ever.
9. **Ask before big structural changes.** Changing the project layout, swapping a core dependency
   (e.g. DB library, ORM, framework), or altering the provider-adapter interface are the kind of
   changes that ripple everywhere — confirm intent before doing them.

## Working from specs

10. **The spec is the source of truth for behavior.** Before implementing anything in a domain
    area that has a spec in `specs/`, read the spec. Implement what it says, not what seems
    reasonable.
11. **Never invent an answer to an open question.** Specs have an "Open questions" section for
    decisions that haven't been made. If implementing requires resolving one, stop and ask.
    Picking a sensible-looking default and moving on is the single most damaging thing that can
    happen here, because it produces working code built on an unrecorded assumption.
12. **If the spec doesn't cover a case you hit, say so.** Don't fill the gap silently. A gap in
    the spec is information worth surfacing — it usually means the rule set is incomplete, not
    that the case is unimportant.
13. **Rule IDs are permanent.** `SPEND-08` refers to one rule forever. Never renumber, never
    reuse an ID for a different rule. When a rule is superseded, strike it through and mark it
    retired with a date and a pointer to its replacement, rather than deleting it.
14. **Specs describe current behavior, in place.** Don't create a new spec file for a change to
    an existing area — amend that area's spec. Proposed changes belong in the PR description or
    an issue, not in `specs/`. One spec per domain area, not one per feature.

## Tests

15. **Every rule test names its spec ID in the title**, e.g.
    `it('SPEND-08: excludes transactions dated before budget.startDate', ...)`. CI greps both
    directions: a rule with no test fails the build, and a test naming an ID that no spec
    defines also fails the build.
16. **Test files mirror spec areas, not features.** `spend.rules.test.ts` and
    `spend.props.test.ts` grow in place as the spend area grows. Don't add
    `spend-rollover.test.ts`.
17. **Domain tests use no mocks.** If a test in `packages/shared` needs a mock, rule 7 has been
    violated somewhere and the fix is to move the I/O out, not to add the mock.
18. **No network access in any test.** Provider adapters are tested against recorded fixtures
    committed under `apps/api/tests/fixtures`. Fixtures are regenerated deliberately, never
    fetched during a test run.
19. **Adapter behavior is tested once, against the interface.** New providers are added to the
    existing `describe.each` contract suite rather than getting a bespoke test file, so that
    every adapter is held to the same normalization guarantees (sign convention, integer cents,
    date-only strings).
20. **Never weaken a test to make it pass.** If an assertion fails, the implementation is wrong
    or the spec is wrong. Changing the assertion to match the current output is only correct
    after the spec has been amended and that amendment logged in `current.md`. Deleting,
    skipping, loosening a tolerance, or narrowing a property's generator to dodge a failure is
    never the fix.
21. **Property tests must be verified to fail.** When adding a fast-check property, confirm it
    actually catches a deliberately broken implementation before considering it done. A property
    that passes against broken code is testing nothing.

## The held-out suite

22. **Never read, run, modify, or reference anything under `spec-tests/`.** This directory is a
    deliberately withheld test suite, maintained by hand and kept out of the development loop.
    It exists to detect implementations that fit the visible tests rather than satisfying the
    spec. Reading it defeats its only purpose. If a task appears to require looking in there,
    that's a signal something has gone wrong — stop and ask.

## Updating current.md

**After any major change, update current.md.** A major change includes (non-exhaustive):

- A refactor that changes the shape of a model, interface, or module boundary
- A database migration or schema change
- Adding, removing, or upgrading a dependency
- A change to project structure (new top-level directory, moved files)
- A new architectural decision (e.g. switching database libraries, changing how budget spend is
  calculated)
- A spec in `specs/` moving from `Draft` to `Ready for implementation`, or being amended after
  implementation has started
- An open question in a spec being resolved
- A spec rule being retired or superseded
  When updating current.md:
- Add a dated entry to the "Recent decisions" section summarizing what changed and why.
- Update the TODO list to reflect completed items and any new follow-up work the change
  introduced.
- If the change affects the architecture itself (not just implementation), also update
  `pudgy.md`.
- If the change alters what the system does, also amend the relevant spec in `specs/` — and
  when an open question is resolved, delete it from the spec's Open questions section and
  rewrite the affected rule as a decided rule.
  Small changes — a bug fix, a new route that follows an existing pattern, a minor refactor within
  a single file — do not require a current.md update.
