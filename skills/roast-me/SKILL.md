---
name: roast-me
description: Adversarial critique with a verdict that gates execution. Run on plans before implementation and on designs before they grow components.
metadata:
  origin: ECC
---

# Roast Me

A structured hostile review of an artifact: plan, design, diff, spec, or idea. The output is a verdict, not encouragement. Fatal findings block implementation until fixed or explicitly overridden by the owner in writing.

## When to Activate

- At plan time for any multi-file change (orch pipelines run this before implementation starts)
- On request: "roast this", "red-team this", "poke holes in this"
- Before adding a new system, service, dependency, or abstraction
- When a workstream has run more than 2 days without a production-visible result

## Core Concepts

### Forced questions

Every roast answers all six:

1. What must be true for this to work, and which of those assumptions is unverified?
2. How does it break? Name specific failure paths, never generic "risk."
3. What would a competitor shipping in two days cut from this plan?
4. What is missing that a strong version would have?
5. What existing thing already does this job? A second system for the same job is a finding.
6. What does done look like, and what does failure look like?

### Verdict tiers

- **FATAL**: breaks the core purpose, or the component has no reason to exist. Blocks implementation.
- **IMPORTANT**: materially weakens the result. Fix now or log with an owner and a date.
- **MINOR**: noise. Mention once, never re-litigate.

Each finding also gets a triage label: worth-fixing, matter-of-taste, or wrong. Only worth-fixing findings survive to the fix list.

### The gate

Implementation does not start while a FATAL stands. The owner may override with an explicit written acceptance of the named risk. IMPORTANT findings never block on their own; they ship as logged follow-ups per the `anti-slop` process rules.

### Tone

Attack the work, never the person. Specific beats harsh: quote the exact line, name the exact component. No praise padding; earned strengths get one line at the end. If context is insufficient to judge, ask the missing questions instead of hedging a verdict.

### Scope-creep prevention

The roast identifies problems; it does not redesign. Alternatives are capped at 3, each one sentence with the tradeoff named. A roast that produces a bigger plan than the one it reviewed has failed.

## Anti-Patterns

- Roasting after implementation as theater
- Generic critiques that fit any plan ("consider edge cases")
- Verdicts with no gate: a FATAL that everyone reads and ignores
- A third review round without a new confirmed P0/P1
- Softening: "this might potentially be worth considering"

## Best Practices

- One roast per plan, one re-roast after fixes. Then build.
- Archive the verdict next to the plan so the fix list stays checkable.
- Pair with `anti-slop` during cleanup: the roast kills components, anti-slop kills lines.

## Related Skills

- `anti-slop`, `tdd-workflow`, `orch-refine-code`

## Credits

Concepts adapted from MIT-licensed prior art: premdevai/brutal-claude-skills (devils-advocate, pre-mortem), dlowd/claude-skill-critique (triage labels), serbanghita/claude-code-plan-critique (critique-gated execution).
