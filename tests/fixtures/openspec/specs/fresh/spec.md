---
title: Fresh Spec
description: A valid spec with a recent verification date
---

<!-- id: fresh-spec -->
<!-- status: approved -->

Last verified: 2026-08-01

## Spec

### Requirement: Fresh Requirement
The system must demonstrate freshness.

#### Scenario: Fresh scenario passes
Given a recently verified spec
When the freshness checker runs
Then the status should be FRESH

<!-- enforced: src/fresh.js::freshFunction -->
