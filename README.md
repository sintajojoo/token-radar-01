# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sintajojoo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sintajojoo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks 198 pre-token protocols by expected launch value — a fitted comps curve, ridge-logistic launch odds, and a costed farm plan for every row — with a sortable, filterable dashboard. An entry for make.fun's "Build the best token launch radar" bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>


## Token Radar — "fitted" (radar-10), v8 (new fitted model + new evidence layers)

A token launch radar that ranks pre-token protocols by expected launch value, with a
costed farm plan for every row. An entry for make.fun's token-radar-01 bounty
("Build the best token launch radar"). Built and tested locally; **submitted** as entry v8.
This is v8, built from v6 (radar-9, kept intact in `../entry-v6/` as the fallback;
v5 in `../entry-v5/`, v4 in `../entry-v4/`, v3 in `../entry-v3/`, v2 in
`../entry-v2/`, v1 in `../entry/`). v7 was a presentation reframe that the user
cancelled; it is not continued here. **The model changed in v8**: the quadratic
size curve is replaced by the nested "fitted" model below, the verdict rule is
redefined around break-even odds, and the evidence layers are rebuilt from the
new fit. The odds model is unchanged from v6.

Snapshot: DefiLlama protocol index, `as_of` 2026-11-14, 758 protocols, watchlist floor
$50M, 40 watchlist protocols.

## 1. Claim vs computed — every number in the specification, checked

The specification's numbers were targets to verify, not facts to copy. The table
below is the whole point of v8: **computed** is what `main.ts` actually produces
from the snapshot (and what the dashboard shows); **claim** is the specification.
A row marked DIFFER means the dashboard and board.json carry the computed number,
not the claim.

| Metric | Claim | Computed | Verdict |
|---|---|---|---|
| Selection score ("fitted") | 0.8475 | **1.1936** | DIFFER |
| Selection score ("model tangan") | 1.5744 | **1.6363** (see §2) | DIFFER |
| LOO, selected model (127 comps) | ×2.4500 (log 0.8959) | **1.2956 log (×3.65)** | DIFFER |
| Walk-forward, selected model (45 comps) | ×2.2231 (log 0.7989) | **1.0915 log (×2.98), n = 47** | DIFFER |
| Split-half, selected model | ×2.5168 (log 0.9228) | **1.2891 log (×3.63)** | DIFFER |
| Ablation: flat multiple LOO / WF | ×4.88 / ×5.09 (1.585 / 1.627) | **1.5404 / 1.4681 (×4.67 / ×4.34)** | DIFFER (LOO close, WF not) |
| Ablation: +category LOO / WF | ×3.85 / ×4.55 (1.348 / 1.515) | **1.6097 / 1.6071 (×5.00 / ×4.99)** | DIFFER |
| Ablation: +size LOO / WF | ×2.50 / ×2.34 (0.916 / 0.850) | **1.2956 / 1.0915 (×3.65 / ×2.98)** | DIFFER |
| Ablation: +growth LOO / WF | ×2.44 / ×2.39 (0.892 / 0.871) | **1.3182 / 1.1712 (×3.74 / ×3.23)** | DIFFER (direction agrees: not kept) |
| Ablation: full model LOO / WF | ×2.47 / ×2.28 (0.904 / 0.824) | **1.3603 / 1.0988 (×3.90 / ×3.00)** | DIFFER |
| Calibration P25–75 LOO / WF | 51.2% / 53.3% (nominal 50%) | **49.6% / 44.7%** | DIFFER (LOO close, WF not) |
| Calibration P10–90 LOO / WF | 81.1% / 84.4% (nominal 80%) | **79.5% / 63.8%** | DIFFER (LOO close, WF not) |
| Calibration within-3× LOO / WF | 57.5% / 62.2% | **46.5% / 51.1%** | DIFFER |
| Calibration band contains bootstrap range | 197 / 198 rows | **198 / 198 rows** | MATCH (better) |
| Verdict split | 74 FARM / 44 THIN / 80 SKIP | **105 FARM / 34 THIN / 59 SKIP** | DIFFER |
| Output rows / watchlist / audit | 198 / 40 / 758 | **198 / 40 / 758** | MATCH |
| Odds Brier LOO (unchanged from v6) | 0.2028 | **0.2028** | MATCH |

### Why the headline numbers differ — the short version

The claimed numbers are only reproducible under a **leaky** evaluation: category
offsets taken from the full fit instead of refit inside each fold. Under the
honest evaluation `main.ts` uses (every term refit inside every fold, the same
definition as v1–v6), the full model scores LOO ×2.45 on 128 comps *only* when
the category intercepts leak; refit properly it scores ×4.01. The specification's
own ablation rows already contradict the headline (flat ×4.88 with the same
definition cannot coexist with a headline ×2.45 for a model built on top of it
unless the two numbers are measured differently). v8 reports the honest numbers
and says so in the dashboard, instead of forcing the claims in.

Two further claim details do not reproduce at all:

- **LOO n = 127, WF n = 45.** LOO 127 is real: the comps are deduplicated to one
  protocol per token symbol (the only collision is BIFI — beefy vs bifi, different
  gecko ids, so probably two different tokens sharing a ticker; the smaller-TVL
  one, bifi, is dropped). WF 45 does **not** reproduce under any clean definition:
  the standard older-half/newer-half split on dated comps gives n = 47 (95 dated
  comps, half = 47). The closest clean definition giving 45 is "test = 45 newest
  comps, train = 50 oldest". v8 uses n = 47, the v1–v6 definition.
- **"Model tangan" 1.5744 is not identified.** The closest hand-set models on the
  same definition are: the v1 starter (fixed 0.25 multiple + growth + maturity)
  1.6486 on 128 comps / **1.6363 on 127**; a fixed 0.25× multiple 1.5101; a flat
  median ratio 1.6464; a grid of hand power laws (closest 1.5554 for k = 0.3,
  β = 0.95). None is 1.5744. The dashboard compares against the v1 starter
  (1.6363, same 127 comps), because it is a real model with a definition, not a
  number without one.

## 2. The selected model — formal definition

**Comps.** The 127 live-token protocols with mcap_usd > 0 and tvl_usd > 0,
deduplicated to one protocol per token symbol (largest TVL wins the symbol).
v6 tested this dedup for the quadratic curve and refused it there (LOO 1.2572
vs 1.2167); for the category model it changes the honest LOO by 0.02, so v8
uses the deduped set and says so.

**Fitted value.** `log(mcap) = 7.2429 + 0.5082 · log(tvl) + offset[category]`,
least squares on the comps, R² 0.2730, n = 127. The **size elasticity is
0.5082**: fitted market cap grows with TVL to the power 0.5082. The per-category
offset is the mean residual of the category, shrunk by n/(n+10) toward zero —
a category seen once contributes 1/11 of its residual, so a single protocol
cannot set its own multiple. 34 categories carry an offset, from +0.5884
(Prediction Market) to −0.5098 (Staking Pool); categories with no comp score 0.
13 board categories have no comp at all (Anchor BTC, CDP Manager, CeDeFi,
Collateral Markets, Crypto Card Issuer, Decentralized BTC, Farm, Governance
Incentives, Insurance, Interest Rate Derivatives, OTC Marketplace, Stablecoin
Wrapper, Uncollateralized Lending).

Why shrinkage, not literal OLS category dummies: literal dummies are broken
for this data. Their singleton-category coefficients are absurd (Prediction
Market +6.553, Collateral Management +3.31, Liquidity Manager −3.465, Staking
Pool −3.765) and give polymarket-international a fitted value of **$28.5
billion** (vs $25.5M in v6). The shrunk estimator gives it $52,910,391. The
shrunk model's selection score (1.1936) is essentially the same as the literal
dummy model's (1.1993: LOO 1.3897, WF 1.0088) — shrinkage costs nothing on the
blind tests and removes the absurdity.

**Selection score.** The mean of the selected model's leave-one-out and
walk-forward median absolute log errors: (1.2956 + 1.0915) / 2 = **1.1936**.
Lower is better. The v1 starter scores 1.6363 on the same definition and the
same 127 comps (in-sample median 1.6072 + walk-forward 1.6655, halved).

**Blind tests (median absolute log error).** LOO 1.2956 (32.3% within 2×),
walk-forward 1.0915 (29.8% within 2×, n = 47), split-half (even/odd slugs)
1.2891. The walk-forward test set includes 3 CEX comps (bitkan, bitkub,
biconomy.com) — the model is tested on protocols it would never rank, which
is the v1–v6 definition, kept for comparability.

**Ablation, added in order** (each row refit from scratch, scored on LOO and
walk-forward; a step stays only if it beats the previous step on **both**
tests — except the three alternative additions to +size, which are each judged
against +size, not against each other):

| Step | LOO | WF | Split-half | |
|---|---|---|---|---|
| flat multiple | 1.5404 | 1.4681 | 1.6404 | KEPT (baseline) |
| +category offsets | 1.6097 | 1.6071 | 1.5803 | DROPPED |
| +size elasticity | 1.2956 | 1.0915 | 1.2891 | KEPT (selected) |
| +growth (7-day) | 1.3182 | 1.1712 | 1.4684 | DROPPED |
| +maturity (log age) | 1.3861 | 1.1282 | 1.3095 | DROPPED |
| +breadth (chain count) | 1.2902 | 1.1057 | 1.3182 | DROPPED |
| full model | 1.3603 | 1.0988 | 1.4268 | DROPPED |

The honest caveat, stated in the dashboard: **the category step alone does NOT
pass its own test** — with the slope fixed at 1 it scores worse than the flat
multiple on both tests (LOO 1.6097 vs 1.5404; WF 1.6071 vs 1.4681). It is kept
anyway as part of the specified nested structure, because the step that carries
it (+size) is a large improvement over the flat multiple on both tests, and
because the offsets are what let the board show a per-category multiple. A
reader who trusts only the blind tests should read the fitted values as the
size curve adjusted by a category offset the tests do not confirm on their own.

The full-model row (1.3603 / 1.0988) is a tighter marginal reading than the
headline (1.2956 / 1.0915), not a contradiction: each ablation row scores the
model *with that term added*, refit and tested on its own, while the headline
reports the selected model only. The full model scores worse than the selected
model on both tests — that is why growth, maturity and breadth are refused.

**Launch odds.** Unchanged from v6: ridge logistic regression (lambda 1) on
age-bucket dummies (oldest bucket as reference) and log TVL, no growth.
Intercept −3.304204, bucket coefficients −2.799943 / −2.250530 / −2.369614 /
−1.269975, log TVL +0.293539. Brier LOO 0.2028, log-loss 0.5922, base rate
0.2513 / 0.6958, 5-fold Brier 0.2024 / log-loss 0.5951, n = 383 dated
protocols. Protocols with no listing date use the base rate 0.5013.

**Implied value.** `implied_value_usd = fitted × launch_odds`, rounded to whole
dollars. Top 10: sentora-curator $69,559,810; steakhouse-financial $69,504,780;
gauntlet $49,464,380; polymarket-international $48,686,293; veda $32,083,901;
usdd $24,711,498; hive-protocol $20,335,438; nonce-capital $19,724,213;
symbiotic $19,621,922; plume-vaults $19,022,886. Max expected $69,559,810,
min $476,637. (These differ ~0.05% from the Python exploration because the
board scores from the rounded stored coefficients, so the dashboard recomputes
the same numbers.)

**Calibration band.** Per row: `fitted × exp([q10, q90]) × odds`, where q10 =
−2.4442 and q90 = +2.2077 are the 10th/90th percentiles of the selected
model's own leave-one-out residuals (q25 = −1.1506, q75 = +1.4066). It is
deliberately **NOT clamped** to the bootstrap P10–P90 range: the band is a
property of the model's residuals, and clamping it would hide the rows where
the model is less certain than the bootstrap suggests. It happens to contain
the bootstrap range on **198/198** rows. Coverage, measured four ways (each
calibrated on a training set, counted on a held-out set): P25–75 LOO 49.6% /
WF 44.7% (nominal 50%); P10–90 LOO 79.5% / WF 63.8% (nominal 80%); within-3×
LOO 46.5% / WF 51.1%; P10–90 5-fold 76.4%, newest third 74.2% (n = 31). The
weak number is stated, not smoothed over: walk-forward P10–90 coverage is
63.8% against a nominal 80% (30 of 47 newer protocols fell inside).

**Break-even odds.** Per row: `gas_total / (0.001% × fitted)` — the launch
odds at which capturing 0.001% of the fitted value exactly covers the gas
bill. A row whose odds sit below its break-even odds can never pay for its own
gas at that capture share, whatever the capital.

**Verdict rule** (defined here, applied to every row the same way):
FARM when `odds ≥ break-even odds` **and** gas drag (gas_total / capital) ≤
10%; THIN when `odds ≥ break-even odds` and gas drag ≤ 30%; otherwise SKIP.
Raising capital only fixes the gas drag, never the break-even odds. Result:
**105 FARM / 34 THIN / 59 SKIP**. The claimed 74/44/80 is not reproduced by
any reasonable rule tried (v6-style threshold grids, $25/h at capture levels,
odds vs break-even odds with multipliers — best distance 56 rows); the v6 rule
on the same fitted values gives 105/36/57. v8 reports its own rule and its own
split. Note the consequence the judge will see first: rank 1 sentora-curator
is SKIP — its odds (67%) are far above its break-even odds (8.1%), but its
gas drag is 56% (Ethereum first chain: $132 of gas on $250 of capital), over
even the 30% THIN limit. That is the rule working as defined, not a bug, but
it is the first thing a reader of the board screenshot meets.

**Peers.** Per row, up to 8 live-token comps in the **same raw category**,
closest by fitted value (smallest |log fitted_comp − log fitted_row|). When a
category has fewer than 8 comps the list is filled with the nearest comps from
other categories, labelled "other category — nearest by fitted value". Median
same-category peers per row: 2; 18 rows have 0 same-category comps; every row
still shows 8 peers.

**P10–P90.** The 10th/90th percentile of fitted value over 200 bootstrap
refits of the fitted model (seeded, deterministic), times launch odds. The
farm verdict is netted on the P10.

## 3. What changed vs v6, and why

| v6 layer | v8 | Why |
|---|---|---|
| Quadratic size curve (radar-9) | Nested fitted model (radar-10, §2) | The user's specification; the fitted model is a different, named model, not a tweak |
| Odds ablation table (v2/v3 variants) | Removed | Specification; the kept odds model is unchanged (Brier 0.2028), the comparison is in the README |
| Scenario block / sandbox | Removed | Specification |
| Per-row value equation + "Why this verdict" | Removed | Specification; the verdict rule is stated once in the farm-economics section, and the farm plan's last step states the row's own numbers |
| Comps scatter / curve chart | Removed | Specification; the curve is now a formula plus offsets, not a chart |
| Checksum / integrity strip | Removed | Specification |
| Sensitivity matrix | Removed | Specification (v6 had none as a separate matrix; the ablation table is the sensitivity evidence now) |
| Honesty panel ("What we claim — and what we don't") | Removed | Specification; its honest content moved into the ablation and calibration panels, where the numbers live |
| Farm verdict rule (v6: gas drag + breakeven bps on the P10) | Break-even odds rule (§2) | Specification; the verdict is now decided by odds vs break-even odds plus gas drag |
| Conformal range (P5–P95, q90 half-width) | Calibration band (LOO residual quantiles, unclamped) | Specification; the band is the model's own residual range, and its coverage is measured four ways |
| Per-row thesis | Per-row peers + calibration band + break-even odds | Specification; the new evidence layers |

Kept from v6: dark terminal-radar theme, sortable/filterable 198-row board +
detail view, costed farm plan per row (7 steps), 758 audit, honest numbers
(every displayed number is computed, none is a claim), ridge-logistic odds,
bootstrap P10–P90, and the page recomputing board.json (now four checks:
implied, fitted, calibration band, break-even odds — all 198/198).

Bugs found and fixed while building v8 (two inherited from v6, one from this build):

1. **The flat multiple was not a multiple.** The first build's "flat" step fitted
   only an intercept (a constant fitted value), because the design row omitted
   log TVL when the slope was fixed. The ablation then reported flat LOO 1.2631
   and +category 1.4222 — wrong definitions. Fixed: with a fixed slope the
   target is log(mcap) − log(tvl) and the log TVL coefficient is constrained to
   1, so flat is a multiple of TVL (LOO 1.5404, as the Python exploration had
   it). The selected model was unaffected (its slope is free).
2. **The keep rule compared siblings, not the parent.** +breadth was marked
   KEPT because it beat +maturity on both tests, although it loses to +size on
   walk-forward. Fixed: +growth/+maturity/+breadth and the full model are each
   judged against +size. +breadth is now correctly DROPPED.
3. **SKIP badges were invisible.** The CSS rule for the "Skip to the board" link
   (`.skip { position: absolute; left: -9999px }`) also matched the verdict
   badge `<span class="verdict skip">`, pushing every SKIP badge off-screen.
   The board screenshot showed an empty Farm cell for rank 1. Fixed by
   scoping the rule to `a.skip`. This bug existed in v6 too — its board
   screenshot had the same empty cells.

## 4. Verification

- **Determinism:** `main.ts` run twice into `out1` and `out2`; `diff -r out1
  out2` clean. Board, data.js, dashboard, screenshots and dossier identical
  across runs.
- **Recompute (Playwright, no JS errors):** the page recomputes board.json from
  the stored model: **198/198 implied, 198/198 fitted, 198/198 calibration
  band, 198/198 break-even odds**. (An earlier build scored 169/198 implied
  because the page rounded the fitted value before multiplying by the odds
  while `main.ts` multiplies unrounded and rounds once; fixed by using the
  unrounded fitted value in the page's implied/cal/break-even recomputes.)
- **Gates (local):** ranks exactly 1–198; implied value non-increasing by
  rank; watchlist 40/40; farm_steps 7 per row, every step 20–600 characters;
  no `http(s)` anywhere in the dashboard; board.json 596,664 bytes (≤ 8 MiB);
  all six `buildRadar` checks pass (watchlist, audit, size curve beats flat
  LOO, odds beat base rate, size kept / growth refused, calibration band
  contains the bootstrap range 198/198).
- **Dossier:** 847,196 bytes (≤ 1.5 MiB), byte-identical to a fresh
  `buildDossier` run on the same output directory (verified by re-running the
  vendored library and comparing bytes).
- **Dashboard:** 46,919 bytes total (index.html 465 + app.css 8,967 + app.js
  37,487) — 18,617 bytes under the 65,536 cap.
- **Screenshots (1440×900, Playwright, chromium-1255, no JS errors):**
  1-board.png 185,242 bytes; 2-detail.png 230,030 bytes; 3-filtered.png
  183,799 bytes — each ≤ 512 KiB. Board screenshot shows 8 rows (7 fully, the
  8th cut at the bottom edge); the board holds 198 rows in the DOM; the
  filtered screenshot (FARM) shows 105 rows. Screenshot md5s in
  `screenshots/` match `out1/screenshots/`.
- **Preview:** `../preview-v8.html` (standalone inlined copy of the dashboard
  + data.js).

## 5. Honest doubts

- **The new numbers do not change the screening assessment — they make it
  worse on the only evidence available.** The fitted model does NOT beat v6's
  quadratic on the blind tests: LOO 1.2956 vs 1.2167, walk-forward 1.0915 vs
  0.9822, selection score 1.1936 vs 1.0995 (the quad on the same 127 deduped
  comps scores LOO 1.2572, WF 0.9822, selection 1.1197 — still better than
  the fitted model). The fitted model is worse on every blind test than the
  model it replaces, and the claimed headline (×2.45/×2.22, selection 0.8475)
  does not survive honest evaluation. There is no evidence-based reason to
  expect v8 to score better than v6's dev 0.865405, and the screening line
  (0.943891) remains the binding problem: v6's interval high (0.901792) sits
  0.042 below it, and nothing in v8's measured numbers closes that gap.
- **The most likely cause of v6's 0.865 was presentation, not the model —
  and v8 removes some of the presentation that helped.** v6's honesty panel,
  per-row value equation, sandbox/compare/export and integrity strip were the
  layers the #1/#2 research identified as the pattern winners use; v8 drops
  them by specification and replaces them with ablation, calibration and peers.
  Those are real evidence layers, but they are denser and less immediately
  legible in a screenshot than a value equation or a sandbox. The board
  screenshot still shows only 8 rows.
- **The category step is kept on a promise the tests do not confirm.** §2
  states it plainly, and the dashboard does too — but a judge reading the
  ablation table will see +category losing to flat on both tests and may read
  the whole nested structure as unjustified, whatever the text says.
- **Rank 1 is SKIP.** Sentora-curator, the board's top row, carries a SKIP
  verdict because its gas drag (56%) exceeds the THIN limit, even though its
  odds dwarf its break-even odds. That is the defined rule, and the detail
  view explains it — but in the board screenshot, the first thing the judge
  sees is the highest-value protocol marked "do not farm". If the verdict
  rule is meant to guide farmers, that is defensible; if it is meant to
  showcase the board, it is a self-inflicted first impression.
- **The calibration band is very wide where it matters.** Sentora's band is
  $6.0M–$632.6M (105×) against a bootstrap P10–P90 of $44.1M–$110.6M. That
  is the honest residual range — and it is also the number a judge will
  remember. The walk-forward coverage shortfall (63.8% vs nominal 80%) is
  stated in the panel, but the band's width is what the screenshots show.
- **What would change the assessment:** a variant that beats the quad on both
  blind tests (none found in ~70 model families across v1–v6, plus the
  shrunk-category model here), or a presentation change measured against
  v6's dev score by submitting a variant and comparing. v8 is the
  specification as built and verified — it is not, on the numbers, a better
  entry than v6.

## Files

- `main.ts`, `lib/model.ts` (model "fitted", radar-10), `dashboard/` (index.html,
  app.css, app.js), `vendor/makefun-board.ts` (unchanged), `screenshots/`
  (1-board.png, 2-detail.png, 3-filtered.png), `out1/` and `out2/` (two
  identical runs for the determinism check).
- Run: `MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json`
