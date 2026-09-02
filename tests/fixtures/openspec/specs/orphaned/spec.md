---
title: Orphaned Spec
description: A valid spec referencing a non-existent commit
---

<!-- id: orphaned-spec -->
<!-- status: approved -->

Last verified: 2023-06-01

## Spec

### Requirement: Orphaned Requirement
The system must detect orphaned specs.

#### Scenario: Orphaned detection
Given a spec referencing a file with no matching commit
When the freshness checker runs
Then the status should be ORPHANED

<!-- enforced: src/nonexistent.js::orphanedFunction -->
