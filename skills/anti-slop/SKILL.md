---
name: anti-slop
description: Detect and remove slop in code, tests, process, and prose. Bloat, fake work, and over-gating are upstream causes of dead code and shipping paralysis.
metadata:
  origin: ECC
---

# Anti-Slop

Slop is output that exists to look like work: code nobody calls, tests that catch nothing, gates that produce review rounds instead of releases, prose that pads. This skill names the patterns and sets the removal rules. It applies during planning, TDD, refactoring, review, and cleanup, not as a separate pass at the end.

## When to Activate

- Any refactor or cleanup pass (pair with `refactor-clean` and `orch-refine-code`)
- Plan review before implementation (pair with `roast-me`)
- Writing or reviewing tests during `tdd-workflow`
- Reviewing a PR whose diff is bigger than its behavior change
- Writing docs, comments, commit messages, or status reports

## Core Concepts

### Code slop

- Zero-caller exports die on sight. If nothing calls it, delete it in the same PR that finds it. Grep for dynamic references first; if genuinely uncertain, mark with a dated removal note and delete on the next pass.
- One canonical implementation. Two systems doing one job is a defect even when both work. Merge or delete; never add a third.
- No speculative generality: no abstraction before the second concrete caller exists, no config for values that never vary, no interface with one implementer.
- Diff minimalism: ship the smallest diff that changes the behavior. Drive-by edits, reformatting, and renames go in separate commits or not at all.
- Comments state constraints the code cannot show. Never narrate the next line, never explain why the change is correct (that belongs in review), never apologize.

### Test slop

- Every test pays rent: it must name the real failure it catches. A test that cannot fail for a reason a user would care about gets deleted.
- Redundant coverage is negative value: it slows the suite and buries signal. When two tests always fail together, one of them goes.
- Asserting mocks against mocks proves wiring, not behavior. Prefer one integration test over five mock-echo tests.
- Delete tests in the same PR that obsoletes them. A skipped test is a lie with a TODO attached.

### Process slop

- Review rounds are capped at 2 by default. A further round needs a confirmed P0/P1 finding, not style or speculative hardening. Non-blocking findings ship as logged follow-ups with an owner.
- A gate that can spawn unbounded iterations is a defect in the gate, not diligence.
- Fake-work test: if this artifact (report, plan, scaffold, harness) were deleted, would anything user-visible change? If no, it was slop.
- Working software in front of users is the only terminal state. Local green, review chatter, and merged-but-undeployed are intermediate states and must be reported as such.

### Prose slop (docs, commits, reports)

- No throat-clearing openers, no filler adverbs, no "isn't just X" constructions, no em dashes, no hedged conclusions.
- Lead with the outcome. State numbers exactly. Cut anything that reads like a pull quote.

## Anti-Patterns

- "Might need it later" (delete it; git remembers)
- Wrapper functions that add a name and nothing else
- Re-exports that exist to shorten one import
- try/except that logs and continues, hiding the failure
- A second full review "to be safe" after a clean verdict
- Coverage targets hit by asserting getters and constants

## Best Practices

- Run the cleanup loop from `refactor-clean`: detect, categorize, delete one at a time, test after each.
- Roast the plan before writing code (`roast-me`): every component answers "why does this exist."
- Track deletions as wins. Lines removed with tests green is the strongest cleanup signal there is.

## Related Skills

- `roast-me`, `tdd-workflow`, `orch-refine-code`

## Credits

Concepts adapted from MIT-licensed prior art: rand/cc-polymath (anti-slop), hardikpandya/stop-slop, dmmulroy/anti-slop, ehmo/slopkit.
