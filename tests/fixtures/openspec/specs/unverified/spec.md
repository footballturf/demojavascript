---
title: Unverified Spec
description: A valid spec without a Last verified date
---

<!-- id: unverified-spec -->
<!-- status: draft -->

## Spec

### Requirement: Unverified Requirement
The system should handle specs without verification dates.

#### Scenario: Missing verification date
Given a spec without Last verified
When the freshness checker runs
Then the status should be UNVERIFIED

<!-- enforced: src/unverified.js::unverifiedFunction -->
