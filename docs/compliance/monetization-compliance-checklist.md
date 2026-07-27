# Monetization compliance checklist

> Product-owner input for the #154 legal-review gate. This checklist identifies product and UX work that legal-page copy cannot complete. It is not legal advice; confirm the requirements, ownership, and launch decisions with qualified counsel and the relevant platform providers.

## Status key

- **BUILT** — implemented and should be re-verified before launch.
- **PARTIAL** — some supporting work exists, but a launch requirement remains.
- **NOT BUILT** — no implementation has been accepted yet.
- **XSOLLA-OWNED** — Xsolla may provide the requirement, but the PO must verify it in the configured checkout.
- **PO-DECISION** — an explicit product or jurisdiction decision is still required.

| Obligation | Product / UX check | Source | Status |
| --- | --- | --- | --- |
| Real-money equivalent at conversion and pull | Show the real-money equivalent price wherever Stars are converted or spent on pulls, disclose the Star exchange rate, and offer a direct real-money purchase option for a pull. No qualifying point-of-sale UI exists yet. | FTC v. Cognosphere order patterns | **NOT BUILT** |
| Under-16 loot-box consent | Decide and implement the parental-consent line for users under 16 before paid randomized content is offered. | FTC v. Cognosphere order patterns | **PO-DECISION** |
| License disclosure at every purchase | Put “you are buying a license” beside every Buy button at the point of sale. Terms text alone does not satisfy this requirement. | California AB 2426 | **NOT BUILT** |
| Subscription consent and cancellation | Before Lunar Pass launch, capture separate affirmative consent to renewal terms, retain the consent record, provide immediate online cancellation, and send annual reminders where required. Audit what Xsolla subscription tooling supplies and what Dicesuki must build. | California ARL / AB 2863; ROSCA | **PARTIAL** |
| EU withdrawal setup | Verify that the configured Xsolla checkout captures immediate-delivery consent, waiver acknowledgment, and durable-medium confirmation for both bundle/content and Lunar Pass/service SKU shapes. | EU Consumer Rights Directive 14-day withdrawal rules | **XSOLLA-OWNED** |
| Belgium and Netherlands paid-gacha controls | At real-money launch, paid gacha will be disabled in Belgium. The geo-gating capability needed to enforce that plan is not built; build and test it. Make the Netherlands decision explicit too. | Belgium / Netherlands paid-randomized-content risk | **NOT BUILT** |
| Japan Stars analysis | Before selling to Japan, assess whether Stars with validity over six months are a prepaid instrument and determine the issuer question under the Merchant of Record model. | Japan Payment Services Act | **PO-DECISION** |
| No kompu-gacha mechanic | Keep crafting recipes deterministic. Never make a reward depend on completing a set of randomized paid drops. | Japan Consumer Affairs Agency kompu-gacha guardrail | **BUILT** — retain this as an economy-design invariant. |
| Star bundle remainders | Most Star bundles are not multiples of 160, creating the stranded-remainder pattern flagged by the FTC. PO decision 2026-07-27 (made in working session; to be folded into the monetization spec §7 decision log when the draft spec branch merges): accept the locked, Genshin-anchored bundle amounts knowingly. Mitigate with the real-money-equivalent display above; do not realign bundles without a new PO decision. | FTC v. Cognosphere order patterns | **PO-DECISION** |
| Neutral purchase age gate | Show a neutral age screen before the first purchase and decide the under-16 handling above. | FTC v. Cognosphere order patterns | **NOT BUILT** |
| EU / UK representative | Determine whether a non-EU developer needs an Article 27 EU representative and the corresponding UK representative arrangement. | GDPR Article 27; UK GDPR representative rules | **PO-DECISION** |
| Lunar Pass daily-value disclosure | Put the claim-or-lose warning adjacent to the Lunar Pass purchase button. Decide whether a grace or catch-up window is appropriate before launch. | Subscription fairness and product disclosure review | **NOT BUILT** |

## Release evidence to collect

For each non-PO decision item, attach the configured checkout screenshots or recordings, provider configuration evidence, and the exact deployed build/version to the #154 legal-review gate. Re-check jurisdiction rules and provider behavior before every real-money launch; this document is a planning checklist, not a substitute for legal review.
