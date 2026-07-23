# Security Policy

TheoryTracker's entire premise is a spoiler gate that holds. A way to see
content past your reading position — a card, field, relation, revision, timeline
entry, search result, graph node, or API response that leaks gated data — is a
security bug, not just a spoiler. Please report it privately.

## Reporting a vulnerability

**Do not open a public issue.** A public report describing a live gate bypass is
itself a working exploit against every deployed instance.

Use GitHub's **private vulnerability reporting**:
[Report a vulnerability](https://github.com/saltasaurus/theorytracker/security/advisories/new).

Please include the version or commit, the deployment method, and the smallest
steps that reproduce it.

## What to expect

This is a solo-maintained hobby project, so response is best-effort, not
contractual:

- **Acknowledgement** within about a week.
- An assessment and, for confirmed issues, a fix or mitigation plan once
  reproduced.
- Credit in the release notes if you'd like it.

## Scope

In scope: gate bypasses, authentication/authorization flaws, injection, secret
or session handling, and the rate-limit / import paths.

Known and documented (see the README "Honest limits") — not new reports:
in-process rate limiting, title/summary-only search, the `next-auth` v5 beta,
the two unreachable `sharp`/`postcss` advisories, and remote card-image IP
disclosure.
