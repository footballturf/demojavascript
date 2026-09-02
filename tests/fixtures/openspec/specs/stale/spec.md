---
title: Stale Spec
description: A valid spec with an old verification date
---

<!-- id: stale-spec -->
<!-- status: approved -->

Last verified: 2020-01-15

## Spec

### Requirement: Stale Requirement
The system must detect stale specs.

#### Scenario: Stale detection
Given a spec verified long ago
When the enforced file has changed
Then the status should be STALE

<!-- enforced: src/lib.js::staleFunction -->
