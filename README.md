# Token Radar — radar-9, v6 (last untested model ideas + presentation gaps; model unchanged)

A token launch radar that ranks pre-token protocols by expected launch value, with a
costed farm plan for every row. An entry for make.fun's token-radar-01 bounty
("Build the best token launch radar"). Built and tested locally only; not submitted.
This is v6, built from v5 (radar-9, kept intact in `../entry-v5/` as the fallback;
v4 in `../entry-v4/`, v3 in `../entry-v3/`, v2 in `../entry-v2/`, v1 in `../entry/`).
**The model did not change in v6**: the board rows, the fitted model, the odds and
the audit are byte-identical to v5's (verified by `diff` on `board.json` — rows,
model and audit clean; only `validation` gained fields). What changed: (a) the last
untested model ideas were tested and all refused — one-per-ticker dedup, 12-month /
survival odds, empirical-Bayes partial pooling by category; (b) the presentation
gaps found by the #1/#2 research (per-row value equation, sandbox/compare/export,
a sharp $25/h farm threshold, conformal tested four ways) were closed in the
dashboard, inside the 65,536-byte dashboard cap.

Snapshot: DefiLlama protocol index, `as_of` 2026-11-14, 758 protocols, watchlist floor
$50M, 40 watchlist protocols.

## What changed in v6 (vs v5)

### A. Model ideas tested, all refused — model stays radar-9

Four ideas that had not been tried in v1–v5 were tested in Python against the
exact blind tests `main.ts` uses (LOO, walk-forward older→newer n = 47, 5-fold by
slug, plus newer-third n = 31). A term/model stays only if it beats the v5
quadratic on **both** LOO and walk-forward. None did.

1. **One-per-ticker dedup of the comps.** Group the 128 comps by lowercased token
   symbol, keep the largest-TVL protocol per symbol. Only one symbol collides —
   BIFI (beefy vs bifi) — and the two carry different gecko ids
   (`beefy-finance` vs `bifi`), so they are probably two different tokens
   sharing a ticker, not one family. n falls 128 → 127; LOO 1.2572 vs 1.2167
   (worse), walk-forward 0.9822 (unchanged — bifi has no listing date), 5-fold
   1.2990 (slightly better), newer-third 0.9610 (unchanged). **Dropped** — fails
   LOO. Dedup by gecko id changes nothing: 128 distinct ids. This test is also
   in `board.json` as the ablation row `quad+dedup-by-symbol`, computed by
   `main.ts` itself.
2. **12-month odds.** Odds as the probability of launching within the next 12
   months, not the cohort "ever launched" rate. There are no launch dates in
   the snapshot, so the 12-month target cannot be validated directly — the only
   testable object is the survival model behind it, scored on the cohort
   outcome (see 3). From the fitted Weibull, the 12-month conditional odds
   over the 198 board rows run 0.163–0.425 (median 0.251), against the cohort
   odds' median 0.350 — reported here for reference, not used anywhere.
3. **Survival / hazard odds.** Current-status survival models (event time is
   interval-censored: a token launched at some unknown time ≤ age, or not yet):
   Weibull (scale 908 days, shape 0.607), Weibull AFT with log TVL (shape
   coefficient −0.217 — larger TVL associated with *later* launch, the opposite
   sign to the logistic's +0.294, a cross-sectional artifact of TVL growing
   with age), and a piecewise-constant hazard on the 5 age buckets (fitted
   hazards/day 0.002742, 0, 0.000157, 0.003345, 0.000255 — the 180–365 day
   bucket collapses to zero, which is the model overfitting a dip in the
   empirical rate). Cohort Brier/log-loss, LOO (n = 383): Weibull 0.2182 /
   0.6367, AFT 0.2154 / 0.6301, piecewise 0.2137 / 0.6336 — all worse than the
   v5 logistic's 0.2028 / 0.5922 (5-fold agrees: 0.2182 / 0.2144 / 0.2131 vs
   0.2024). **All dropped.**
4. **Empirical-Bayes partial pooling by category.** Category intercepts and
   slopes shrunk with a prior variance fitted from the residuals
   (method-of-moments τ²), refit inside every training set — the correct form
   of the category calibration that failed three times as a fixed-shrinkage
   intercept (LOO 1.32–1.35). Full-fit τ² = 0.6154 against residual σ² = 4.347
   (34 categories; largest shrunk offsets: Prediction Market +0.80, Staking
   Pool −0.69). Results: category intercept LOO 1.3385 / WF 1.1389; category
   slope LOO 1.3629 / WF 0.9693; 5-group intercept LOO 1.3983 / WF 1.0896;
   5-group slope LOO 1.3115 / WF 1.0797. **All dropped** — every variant fails
   LOO, and all but the category slope fail walk-forward too. Notably the EB
   variants *do* beat the quad on 5-fold (1.2505–1.2632 vs 1.3079) while losing
   LOO and walk-forward — the same 5-fold/LOO disagreement as quad vs linear,
   which is why the entry's pre-set rule (LOO *and* walk-forward) is what
   decides, not 5-fold.

### B. Presentation gaps closed (all in `dashboard/`)

1. **Per-row value equation** (kevin v3's gap): every detail view now has a
   "Value equation — this row, literally" section with this row's own numbers
   substituted — e.g. Steakhouse: `fitted = exp(10.0549 + 0.1893 x ln(TVL) +
   0.0088 x ln(TVL)^2) = exp(10.0549 + 0.1893 x 21.7363 + 0.0088 x 21.7363^2)
   = $91.1M`; `odds = sigmoid(-3.304204 + -2.369614 [age 365–730 days] +
   0.293539 x ln(TVL)) = sigmoid(0.707) = 67%`; `implied = fitted x odds =
   $91.1M x 67% = $61.0M`. Undated rows show the base rate instead of a bucket.
2. **Sandbox, compare, export** (kiencx v3's gap), in one "Tools" panel at the
   bottom of the board page: a sandbox (protocol, capture share, capital — it
   recomputes $/hour, gas drag and the verdict under *your* capital and states
   that breakeven never moves with capital), a side-by-side compare of two
   protocols (rank, fitted, odds, verdict, $/hour, $25/h line, and which row
   is higher by how much), and an "Export board as CSV" button (the rows the
   current filter shows, 199 lines with header for the unfiltered board).
   The tools only read the board's numbers and never write back: after
   changing the sandbox the page still recomputes 198 / 198 rows and the DOM
   still holds 198 board rows (verified in Playwright).
3. **Sharp $25/h farm threshold** (kevin's gap): every detail view now states
   "Clears $25/h at capture" — the capture share of the P10 that solves
   (25 × hours + gas) / P10, e.g. Steakhouse "<0.001% of P10". Honest note:
   *every* row clears $25/h at some capture ≤ 100% (gas is ~$27 against P10s
   of $10K and up), so the line is informative through the capture percentage,
   not through a yes/no — and it is shown as a percentage for that reason.
4. **Conformal tested four ways:** the model panel now reports all four
   held-out conformal coverages, each calibrated on a training set and counted
   on a held-out set — LOO 89.8% (n = 128), walk-forward 83.0% (n = 47),
   5-fold 88.3% (n = 128), newest third 87.1% (n = 31) — computed by `main.ts`
   and stored in `board.json` (`validation.conformal.fivefold_coverage`,
   `.newer_third_coverage`), not hand-written. The newest-third curve check
   is there too: quad 0.9610 vs linear 1.1242 (n = 31).
5. **Kept from v5, untouched:** the honesty panel (now also citing the 88% /
   87% held-out checks), the honest conformal label (walk-forward 83%,
   nominal 90%), verdict transparency, the dark terminal theme, and the
   overclaim sweep (no best/accurate/proven/guarantee/certain).

Byte budget: the dashboard was 52,031 bytes in v5 against a 65,536-byte cap, so
the tools panel, the equation section and the extra text had ~13,500 bytes to
fit in. They fit: **63,159 bytes total** (app.css 11,575 + app.js 51,120 +
index.html 464), with 2,377 bytes to spare. Nothing was cut for size — the
honesty panel, the model panel and the board screenshot (still 3 table rows
fully visible) are all intact. If a v7 adds more, the cap is the binding
constraint, not the dossier (1,043,695 bytes vs a 1.5 MiB cap).

## What v6 could NOT fix (stated, not hidden)

- The curve still did not improve: three systematic sweeps (~70 families in
  v3/v4 plus the four v6 ideas) and the quadratic still stands, with the same
  weak absolute numbers (R² 0.1942, leave-one-out median error x3.38) and the
  same unconfirmed 5-fold. The error is dominated by a handful of extreme
  protocols, and every flexible family fits the bulk worse, not better.
- The survival odds lose to the logistic even though they are the more
  principled model for a launch *time* — because the snapshot has no launch
  dates, only current status, so the survival fit is driven by the same
  cross-sectional rates the logistic already captures, with extra parameters.
- TVL is still counted twice and the TVL→launch direction is still
  unidentified from one snapshot.
- The conformal interval still undercovers newer protocols (83.0%
  walk-forward against a nominal 90%), and at x30.8 either way it is very
  wide. The four-way table shows the undercoverage is specific to the
  walk-forward split (88% / 87% on the other two held-out checks), which is
  itself informative: newer protocols are the hardest to cover.
- The $25/h line is near-trivially cleared by every row (see B.3 above) — it
  is a readability aid, not a discriminator between rows.
- The quad-vs-linear question is still near a coin flip on the cross-checks,
  and the odds gain is still 0.0064 of Brier. No presentation change can make
  the curve better or the odds gain larger; v6 discloses both instead.
- The farm verdicts still do not move with the model, because they are
  threshold rules on the P10. That is shown per row rather than asserted
  in this README alone.

## What changed in v5 (vs v4) — all presentation, no model

1. **An honesty panel on the board, readable in the board screenshot.**
   "What we claim — and what we don't" sits under the lede, above the integrity
   strip, with the numbers that were previously only in this README and the model
   panel: quad beats linear on the two pre-set blind tests (LOO 1.2167 vs 1.2234;
   walk-forward 0.9822 vs 1.1118) but only just; 5-fold favours linear (1.2834 vs
   1.3079) and repeated 5-fold agrees (linear 1.2665, quad 1.2859); the odds gain
   over v2 is small (Brier 0.2092 → 0.2028); TVL is counted twice (fitted value
   and odds) and a launch may attract TVL first, which one snapshot cannot
   disentangle; the P5–P95 range is nominal 90% but walk-forward only 83% fell
   inside it (n = 47). Beside the text, a small histogram shows the launch-odds
   distribution across the 198 rows (most rows at low odds; the board's top is
   the high-odds tail). To keep 3 board rows visible in the 1440x900 board
   screenshot, the size-curve chart moved below the table (it is still on the
   page, with the model panel), the chart was slimmed, and the lede, strip and
   controls were tightened.
2. **Conformal label corrected to achieved coverage.** The detail view now reads
   "P5–P95 expected (conformal; walk-forward coverage 83%, nominal 90%)", and the
   model panel now says the range is *nominally* a 90% range and gives the
   achieved walk-forward figure as 83% (39 of 47 newer protocols fell inside),
   instead of leading with the nominal 90%. The interval itself is unchanged:
   half-width 3.4281, same `conf_lo_usd` / `conf_hi_usd` on every row.
3. **Screenshots grew from legitimate content, not padding.** Board 205,083 →
   226,409 bytes, detail 233,490 → 260,815 bytes, filtered 143,481 → 225,744
   bytes (all 1440x900). The growth is the honesty panel, the odds histogram,
   the verdict one-liner in the detail view and the residual chart in the model
   panel. They are still below the 300–350 KB guide in the rules (flat UI
   compresses well); the guide is not a gate — the gate caps each screenshot at
   512 KiB — and no file was inflated artificially. The board screenshot still
   shows 3 table rows in full.
4. **Farm verdicts are now derived in front of the reader.** Every detail view
   carries a one-line verdict rule under "Farm economics" (e.g. for Steakhouse
   Financial: "Gas drag 5% (gas / capital) — inside the 10% FARM limit;
   breakeven 0.0018 bps — inside the 1 bp FARM limit. Verdict: FARM.") and a
   "Why this verdict" section with per-row gas drag %, breakeven bps, expected
   $/hour at 0.001% capture vs gas $/hour (gas bill / hours), the P10, which
   threshold decides the verdict, and the note that the verdict is decided by
   these two thresholds on the P10 only — the P10 moved when the odds model
   changed in v2–v4, but no row crossed a threshold, so the 105 FARM / 36 THIN /
   57 SKIP split is unchanged since v1. The rule itself was verified against the
   board: it reproduces all 198 verdicts. The verdicts, thresholds and farm
   economics are unchanged from v4.
5. **Overclaim sweep of the dashboard text** (`index.html`, `app.js`, `app.css`).
   Found and fixed: the page `<title>` still said "radar-6" (stale since v1) —
   now "radar-9"; the table caption said "strongest expected value first" —
   now "largest expected value first"; "the quadratic term beats it on both"
   is now "scores better on both" (the numbers beside it are unchanged);
   "the curve is honest about how noisy market caps are" is now the plain
   "R² 0.1942 is low: market caps are noisy"; "a wider 90% conformal range" is
   now "a wider conformal range (nominal 90%, achieved 83% walk-forward)". No
   occurrence of "best", "accurate", "proven", "guarantee" or "certain" remains
   in the dashboard files. A residual histogram was added to the model panel
   (in-sample residuals of the 128 comps, labelled as in-sample so it is not
   read as a held-out error).

## What v5 could NOT fix without changing the model (stated, not hidden)

- The quad-vs-linear question is still near a coin flip on the cross-checks,
  and the odds gain is still 0.0064 of Brier. No presentation change can make
  the curve better or the odds gain larger; v5 discloses both instead.
- TVL is still counted twice and the TVL→launch direction is still
  unidentified from one snapshot. Fixing that needs a different design (e.g.
  a second snapshot, or odds without log TVL — the age+growth variant without
  TVL scored worse, Brier 0.2074, and reshuffled more), not a label.
- The conformal interval still undercovers walk-forward (83% vs nominal 90%)
  and is still x30.8 wide. Widening it to force 90% walk-forward coverage
  would be a model change (a new half-width), and v5 deliberately did not do
  it: the label now reports the achieved 83% instead.
- The farm verdicts still do not move with the model, because they are
  threshold rules on the P10. That is now shown per row rather than asserted
  in this README alone.

Snapshot: DefiLlama protocol index, `as_of` 2026-11-14, 758 protocols, watchlist floor
$50M, 40 watchlist protocols.

## The model (radar-9)

Fitted on the snapshot itself, every run — no hardcoded list of names, no fixed multiple.

- **Comps:** the 128 live-token protocols with `mcap_usd > 0` and `tvl_usd > 0`.
- **Size curve (least squares, unchanged from v2/v3):**
  `log(mcap) = 10.0549 + 0.1893 * log(tvl) + 0.0088 * log(tvl)^2`,
  R² 0.1942, n = 128. v3 tested ~40 curve families and v4 tested ~30 more (see
  Validation) — none beat this curve on both blind tests — and v6 tested the
  last four untested ideas (one-per-ticker dedup, survival/hazard odds,
  empirical-Bayes partial pooling) with the same result. The curve is kept
  because everything else lost, three times, not because nothing else was tried.
- **Fitted value:** `exp(10.0549 + 0.1893 * log(tvl) + 0.0088 * log(tvl)^2)`.
- **Launch odds — CHANGED in v4: a ridge logistic regression** (lambda 1, features
  standardised inside the fit) on the 383 dated protocols that could launch a
  token of their own. Features: age-bucket dummies (5 buckets, oldest as
  reference) and log TVL. **No growth term.** Raw coefficients (stored in
  `board.json` / `data.js`, so the dashboard recomputes the same odds):

  | Term | Coefficient |
  | --- | --- |
  | Intercept | −3.304204 |
  | Age 0–180 days | −2.799943 |
  | Age 180–365 days | −2.250530 |
  | Age 365–730 days | −2.369614 |
  | Age 730–1100 days | −1.269975 |
  | Age 1100+ days (reference) | 0 |
  | log TVL | +0.293539 |

  Odds on the board run 0.172–0.920 (median 0.350). Protocols with no listing
  date use the base rate 50.1% — the logistic model needs an age, and an undated
  protocol must not be scored as if it were in the oldest bucket.
  The empirical token rate by age bucket (for reference only — the logistic
  model, not this table, sets the odds):

  | Age | Odds | n |
  | --- | --- | --- |
  | 0–180 days | 29.0% | 66 |
  | 180–365 days | 40.0% | 50 |
  | 365–730 days | 39.6% | 124 |
  | 730–1100 days | 61.4% | 65 |
  | 1100+ days | 81.8% | 78 |

  Why growth was dropped, stated as a trade, not a win: the v3 variant (the
  same logistic model plus 7-day growth winsorised at ±20%) scores better —
  Brier 0.1999 vs 0.2028 here, log-loss 0.5845 vs 0.5922, confirmed on 5-fold
  too. But its growth coefficient was negative (falling 7-day TVL associated
  with having a token — counterintuitive, plausibly a one-snapshot artifact),
  and growth drove most of the board's reshuffle against v2: mean absolute
  rank move 11.1 places, max 65. Dropping growth keeps about two-thirds of
  v3's Brier gain (0.2092 → 0.2028 of v3's 0.2092 → 0.1999) and 60% of its
  log-loss gain, with less than half the reshuffle (mean 4.8, max 19). The
  refused v3 variant is scored in `board.json` (`validation.odds.v3_*`) and on
  the dashboard, so the trade is visible in the record rather than asserted.
  log TVL still enters twice — once in the fitted value, once in the odds —
  so the board's top is still more TVL-concentrated than v2's; see Limitations.
- **Expected value (what the board ranks by, and what `implied_value_usd` holds):**
  `fitted value x launch odds`. Every row also states its fitted value, its odds,
  its bootstrap P10–P90 expected range (200 bootstrap refits of the curve, seed
  20261114), its conformal range, and its rank range, so the ranking is auditable.
- **Conformal range — unchanged from v3:** fitted x exp(±3.4281), where 3.4281
  is the 90th percentile of the absolute leave-one-out residuals — a 90% range
  (P5–P95), much wider than the bootstrap range (about x30.8 either way). v2 used
  the 80th percentile (half-width 2.4383) and its walk-forward coverage was only
  63.8% against a nominal 80%. The 90% range covers 83.0% of newer protocols
  walk-forward (calibrated on the older half, tested on the newer 47) against a
  nominal 90% — still under, but much closer. Leave-one-out coverage is 89.8%
  by construction. The farm verdict is netted on the narrower bootstrap P10, and
  the dashboard says so, so the two ranges are not confused.
- **Board:** 198 rankable pre-token rows — every one of the 40 watchlist protocols,
  plus every other pre-token protocol that is not an exchange, not a versioned pool,
  and not a wrapped / staked / bridged product. Audit: 198 ranked + 416 live-token +
  144 excluded (42 exchanges, 11 versioned pools, 91 wrapped / staked / bridged) = 758.

## Validation (computed by `main.ts` on this snapshot, reported as measured)

### v1 (linear, radar-6) vs v2 (quadratic, radar-7) vs v3 (quadratic + logistic with growth, radar-8) vs v4/v5/v6 (quadratic + logistic without growth, radar-9)

| | LOO median abs log error | LOO within 2x | Walk-forward median abs log error | Walk-forward within 2x | Odds Brier (LOO) | Odds log-loss (LOO) |
| --- | --- | --- | --- | --- | --- | --- |
| v1 linear | 1.2234 (x3.40) | 32.0% | 1.1118 (x3.04) | 34.0% | 0.2102 (age-only) | 0.6090 |
| v2 quadratic | 1.2167 (x3.38) | 32.8% | 0.9822 (x2.67) | 38.3% | 0.2092 (blend) | 0.6072 |
| v3 | 1.2167 (x3.38) | 32.8% | 0.9822 (x2.67) | 38.3% | **0.1999 (logistic + growth)** | **0.5845** |
| v4 | 1.2167 (x3.38) | 32.8% | 0.9822 (x2.67) | 38.3% | 0.2028 (logistic, no growth) | 0.5922 |
| v5 | 1.2167 (x3.38) | 32.8% | 0.9822 (x2.67) | 38.3% | 0.2028 (logistic, no growth) | 0.5922 |
| v6 | 1.2167 (x3.38) | 32.8% | 0.9822 (x2.67) | 38.3% | 0.2028 (logistic, no growth) | 0.5922 |
| Flat baseline (median mcap/TVL, LOO) | 1.6233 (x5.07) | 28.1% | — | — | base rate 0.2513 | 0.6958 |

Walk-forward fits on the older half by listing date and tests the newer half
(n = 47). The curve is unchanged from v2/v3, so its numbers are identical; v4's
change is entirely in the odds. The v4 odds also confirm on 5-fold:
Brier 0.2024 / log-loss 0.5951 vs the v2 blend's 0.2094 / 0.6092 and v3's
0.1985 / 0.5846.
The quadratic term still wins on both pre-specified blind tests vs linear —
but the 5-fold cross-check (folds by sorted slug) does **not** confirm it:
quadratic 1.3079 vs linear 1.2834. Repeated 5-fold (5 seeded shuffles of the
fold order) agrees: linear mean 1.2665, quadratic mean 1.2859. The quad is kept
because it passed the two tests the entry set in advance; the disagreement is
stated here and on the dashboard so the gain is not oversold.

- **Ablation — one term kept, the rest dropped**, because a term stays only if it
  beats its baseline curve on both blind tests. Computed by `main.ts` (40 terms):

  | Term | LOO | Walk-forward | Kept |
  | --- | --- | --- | --- |
  | size+growth (7-day change) | 1.3253 | 1.0337 | No — worse LOO |
  | size+maturity (log age) | 1.2711 | 1.1282 | No — worse both |
  | size+chains | 1.2973 | 1.1451 | No — worse both |
  | size+growth+maturity+chains | 1.2836 | 1.0474 | No — worse LOO |
  | size+placebo (seeded noise) | 1.3124 | 1.1401 | No — control; the tests can refuse a term |
  | size+growth_w20 | 1.2849 | 1.2312 | No — worse both |
  | size+quad | 1.2167 | 0.9822 | **Yes — beats linear on both** |
  | quad+growth | 1.3311 | 0.9557 | No — worse LOO |
  | quad+maturity | 1.2809 | 1.1446 | No — worse both |
  | quad+chains | 1.3092 | 0.9835 | No — worse LOO |
  | quad+all | 1.2912 | 1.1043 | No — worse both |
  | quad+placebo (seeded noise) | 1.3257 | 1.1942 | No — control; the tests can refuse a term |
  | cubic | 1.2695 | 0.9367 | No — worse LOO (better WF only) |
  | spline1 (hinge at median log TVL) | 1.2672 | 1.1334 | No — worse both |
  | spline2 (hinges at tertiles) | 1.2753 | 1.2552 | No — worse both |
  | quad+spline1 | 1.2468 | 0.9710 | No — worse LOO |
  | quad+growth_w20 | 1.2769 | 1.0153 | No — worse both |
  | quad+growth_w50 | 1.3311 | 0.9557 | No — worse LOO |
  | quad+abs_growth | 1.3277 | 0.9780 | No — worse LOO |
  | quad+lt_logage | 1.2594 | 1.1104 | No — worse both |
  | quad+log1p_chains | 1.3735 | 1.1301 | No — worse both |
  | quad+chains_cap3 | 1.2337 | 1.0633 | No — worse both |
  | quad+has_eth | 1.2474 | 1.2470 | No — worse both |
  | quad+has_sol | 1.2355 | 1.0133 | No — worse both |
  | quad+chainflags | 1.2720 | 1.5782 | No — worse both |
  | quad+grp_dummies | 1.2664 | 1.4422 | No — worse both |
  | quad+grp_lt | 1.3231 | 1.4914 | No — worse both |
  | quad+growth_logage | 1.3655 | 1.1943 | No — worse both |
  | quad+tvlperchain | 1.3541 | 1.1386 | No — worse both |
  | quad+growth_sign | 1.3324 | 1.3050 | No — worse both |
  | quad+hinge2 | 1.2799 | 1.0524 | No — worse both |
  | cubic+growth_w20 | 1.3785 | 0.9620 | No — worse LOO |
  | quad+inv_nch (NEW v4) | 1.2247 | 1.1037 | No — worse both |
  | quad+nch2 (NEW v4) | 1.2483 | 0.9363 | No — worse LOO (better WF only) |
  | quad+lt_growth_w20 (NEW v4) | 1.2793 | 1.0957 | No — worse both |
  | quad+lt_log1p_chains (NEW v4) | 1.3873 | 1.1281 | No — worse both |
  | quad+logage_hinge (NEW v4) | 1.3178 | 1.2612 | No — worse both |
  | quad+dedup-by-symbol (NEW v6) | 1.2572 | 0.9822 | No — worse LOO (better 5-fold 1.2990, same WF and newer-third) |
  | size+category-intercept (shrunk, prior 10) | 1.3200 | 1.0915 | No — worse both |
  | size+category-grouped (5 groups, shrunk) | 1.3519 | 1.5076 | No — worse both |

  The cubic's walk-forward advantage (0.9367) does not survive a different
  split: with the newer third as the test set, cubic scores 0.9735 vs the
  quadratic's 0.9610 — the half-split advantage was noise from 47 protocols,
  several of which (rain, bitway-earn, obol) miss by 4–6 log points under every
  curve. Category calibration failed again, as in v2/v3: per-category intercepts
  are noisy on 128 comps (most categories have under 10 comps).
- **Exploration-only models, v4 sweep** (same blind-test definitions, run in
  Python during the v4 sweep; not part of `main.ts`, so their numbers are not in
  `board.json` — except the five OLS terms above, which are):

  | Model | LOO | Walk-forward | 5-fold | Newer-third | Kept |
  | --- | --- | --- | --- | --- | --- |
  | kernel NW h=0.5 | 1.3030 | 1.1019 | 1.2899 | 1.0794 | No — worse both |
  | kernel NW h=1.0 | 1.4091 | 0.9908 | 1.3377 | 1.0055 | No — worse LOO |
  | kernel NW h=1.5 | 1.4046 | 1.0005 | 1.3522 | 1.0428 | No — worse LOO |
  | kernel NW h=2.0 | 1.3686 | 1.0259 | 1.2571 | 1.0226 | No — worse LOO |
  | local-linear h=1.0 | 1.2917 | 1.1173 | 1.2754 | 1.0486 | No — worse both |
  | local-linear h=1.5 | 1.2672 | 1.1357 | 1.2844 | 0.9478 | No — worse both |
  | local-linear h=2.0 | 1.2396 | 1.1000 | 1.2729 | 0.9803 | No — worse both |
  | kNN k=5 mean | 1.4191 | 1.2599 | 1.4598 | 1.7754 | No — worse both |
  | kNN k=10 mean | 1.4801 | 1.0991 | 1.4335 | 1.5361 | No — worse both |
  | kNN k=15 mean | 1.2676 | 1.0583 | 1.2655 | 1.1607 | No — worse both |
  | kNN k=20 mean | 1.3107 | 0.9814 | 1.2273 | 0.9760 | No — worse LOO (WF better by 0.0008) |
  | kNN k=10 median | 1.4979 | 0.9448 | 1.4793 | 1.3680 | No — worse LOO |
  | isotonic on log TVL | 1.4028 | 1.3407 | 1.3674 | 1.6589 | No — worse both |
  | tree depth1 minleaf15 | 1.3826 | 1.1682 | 1.2898 | 1.1507 | No — worse both |
  | tree depth2 minleaf10 | 1.4549 | 1.1070 | 1.3462 | 1.4465 | No — worse both |
  | tree depth2 minleaf15 | 1.3806 | 1.2417 | 1.3426 | 1.1583 | No — worse both |
  | tree depth3 minleaf15 | 1.3590 | 1.2417 | 1.3474 | 1.2721 | No — worse both |
  | age-group linear | 1.3248 | 1.0007 | 1.2846 | 1.2503 | No — worse LOO |
  | age-group quad | 1.3974 | 1.0908 | 1.3395 | 1.2850 | No — worse both |
  | cat-group linear shrunk | 1.3577 | 1.4945 | 1.3013 | 1.2309 | No — worse both |
  | cat-group quad shrunk | 1.3321 | 1.2045 | 1.2601 | 1.3170 | No — worse both |
  | ratio quad (log mcap/TVL) | 1.2167 | 0.9822 | 1.3079 | 0.9610 | Identical to quad (algebra), not a new model |
  | quad excl rain/bitway/obol | 1.2427 | 0.9822 | 1.2453 | 0.9610 | No — worse LOO; WF unchanged (the outliers are old) |
  | quad age-weighted | 1.2812 | 0.9820 | 1.2161 | 0.9979 | No — worse LOO |

- **Exploration-only models, v6 sweep** (same blind-test definitions, run in
  Python during the v6 sweep; not part of `main.ts`, so their numbers are not in
  `board.json` — except the dedup term above, which is):

  | Model | LOO | Walk-forward | 5-fold | Newer-third | Kept |
  | --- | --- | --- | --- | --- | --- |
  | quad dedup-by-symbol (n=127) | 1.2572 | 0.9822 | 1.2990 | 0.9610 | No — worse LOO |
  | EB category intercept | 1.3385 | 1.1389 | 1.2578 | 1.0660 | No — worse both |
  | EB category slope | 1.3629 | 0.9693 | 1.2613 | 0.9596 | No — worse LOO (better WF only) |
  | EB group5 intercept | 1.3983 | 1.0896 | 1.2505 | 1.1279 | No — worse both |
  | EB group5 slope | 1.3115 | 1.0797 | 1.2632 | 0.9610 | No — worse both |

  The EB variants are the one place 5-fold and the pre-set tests point opposite
  ways: all four beat the quad on 5-fold (1.2505–1.2632 vs 1.3079) while losing
  LOO and (except the category slope) walk-forward. The entry keeps the
  pre-set rule — LOO *and* walk-forward — so all four are dropped, and the
  disagreement is stated here rather than resolved by picking the test that
  flatters the new model.

- **Launch odds, survival variants, v6 sweep** (cohort outcome, n = 383 dated
  protocols; Brier / log-loss, leave-one-out and 5-fold):

  | Odds | Brier LOO | Log-loss LOO | Brier 5-fold | Log-loss 5-fold | Kept |
  | --- | --- | --- | --- | --- | --- |
  | **v5/v6 logistic, no growth (kept)** | **0.2028** | **0.5922** | **0.2024** | **0.5951** | **Yes** |
  | Weibull survival (no covariates) | 0.2182 | 0.6367 | 0.2182 | 0.6354 | No — worse both |
  | Weibull AFT (log TVL) | 0.2154 | 0.6301 | 0.2144 | 0.6266 | No — worse both |
  | Piecewise-constant hazard (5 buckets) | 0.2137 | 0.6336 | 0.2131 | 0.6347 | No — worse both |

  The survival models are the more principled form for a launch *time*, but
  the snapshot carries no launch dates — only current status — so they are fit
  on the same cross-sectional rates the logistic already captures, with extra
  parameters, and they score worse on both evaluations. The 12-month
  conditional odds from the fitted Weibull (median 0.251 over the 198 board
  rows, range 0.163–0.425) are reported in "What changed in v6" and used
  nowhere: the 12-month target itself has no ground truth in this snapshot.

  The largest quad residuals are rain (6.49), xdai-stake-bridge (6.02),
  concentrator (5.01), nexo (4.96), bitway-earn (4.92) and aave-v2 (4.77) log
  points — the error is dominated by a handful of extreme protocols, not by a
  missing smooth shape: every flexible family (kernel, kNN, isotonic, trees)
  fits the bulk worse, not better. The v3 exploration table (ridge, Huber,
  trimmed, winsorised-y, piecewise, L1, ensembles, bin medians) is unchanged
  and still stands: nothing there beat the quadratic on both blind tests either.
- **Launch odds variants, leave-one-out (n = 383) and 5-fold:**

  | Odds | Brier LOO | Log-loss LOO | Brier 5-fold | Log-loss 5-fold | Mean |rank move| vs v2 | Max move |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | v2 blend (age 85% + category 15%) | 0.2092 | 0.6072 | 0.2094 | 0.6092 | 0.0 | 2 |
  | v3 logistic + growth | 0.1999 | 0.5845 | 0.1985 | 0.5846 | 11.1 | 65 |
  | **v4 logistic, no growth (kept)** | **0.2028** | **0.5922** | **0.2024** | **0.5951** | **4.8** | **19** |
  | logistic age-bucket only | 0.2101 | 0.6089 | 0.2108 | 0.6147 | 5.8 | 26 |
  | logistic age + growth (no TVL) | 0.2074 | 0.6019 | 0.2070 | 0.6051 | 13.5 | 85 |
  | 25% v3 logistic + 75% v2 blend | 0.2040 | 0.5955 | 0.2038 | 0.5970 | 3.5 | 23 |
  | 50% v3 logistic + 50% v2 blend | 0.2008 | 0.5875 | 0.2002 | 0.5885 | 6.3 | 39 |
  | 75% v3 logistic + 25% v2 blend | 0.1994 | 0.5835 | 0.1984 | 0.5841 | 8.9 | 57 |
  | 50% logistic-no-TVL + 50% v2 blend | 0.2066 | 0.6004 | 0.2065 | 0.6025 | 6.3 | 39 |

  Two notes. First, the 75% mix beats even the pure v3 logistic on both
  evaluations (Brier 0.1994 vs 0.1999 LOO, 0.1984 vs 0.1985 5-fold) — a tiny,
  consistent ensemble gain. It was refused anyway: it keeps the growth term
  and most of its reshuffle (mean 8.9), and a 75/25 weight chosen after seeing
  the scores would be a post-hoc fudge, not a model. Second, the age+growth
  variant (no TVL) reshuffles the board more than the full v3 model (mean
  13.5, max 85) — growth, not TVL, is the volatile driver of v3's reshuffle.
  That is why dropping growth, rather than TVL, is the conservative fix.
- **Conformal interval:** half-width 3.4281 in log terms (a factor of about
  x30.8 either way on the fitted value). Leave-one-out coverage 89.8%;
  walk-forward coverage 83.0% (n = 47, calibrated on the older half at q90).
  Tested four ways in v6 (each calibrated on a training set, counted on a
  held-out set, computed by `main.ts`): LOO 89.8% (n = 128), walk-forward 83.0%
  (n = 47), 5-fold 88.3% (n = 128), newest third 87.1% (n = 31). The
  undercoverage is specific to the walk-forward split. A conditional conformal
  per TVL tercile was tested in v3 and did worse walk-forward (66.0%); per age
  bucket it cannot even be calibrated, because the older half contains no young
  protocols. The interval is honest about how wide the truth is; it is not used
  for farm verdicts.

## Farm plans

Seven steps per row, each with a cost and a time, derived from the protocol's own
category, chains, TVL and age. Gas per transaction: Ethereum $12, Solana $0.05,
major L2s $1, other chains $0.50. Capital by TVL: $250 / $150 / $100 / $50.
Hold 30–60 days by age. The farm rules are unchanged from v2/v3 — only the P10
they are netted on moved, because the odds moved.

The verdict is netted on the **P10** expected value, from two costs: the gas bill
as a share of the capital (gas drag) and as a share of the P10 (breakeven).
FARM when gas drag ≤ 10% and breakeven ≤ 1 bp; THIN when gas drag ≤ 30% and
breakeven ≤ 5 bps; otherwise SKIP. This board: 105 FARM, 36 THIN, 57 SKIP —
the same counts as v2 and v3, and no row flips verdict vs v3 (the odds move
every row's P10 in the same direction often enough that the thresholds do not
bite differently).

Per row: $/hour at **three** labelled capture shares of the P10 — 0.001%, 0.01%
and 0.1% — shown together so the 0.1% figure (100x the 0.001% one) is never read
alone as a forecast; the capture share at which the row clears $25/h (new in
v6, solved from the same $/hour arithmetic); capture breakeven; and the capital
that flips the verdict.
Raising capital only fixes the gas drag, never the breakeven, so of the 93
non-FARM rows, 88 flip to FARM at the stated larger capital and 5 do not — for
those 5 the breakeven is the blocker, and the plan says so.

## Top 10

| Rank | Protocol | Expected value | Odds | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $61,048,725 | 67.0% | SKIP |
| 2 | Steakhouse Financial | $60,995,348 | 67.0% | FARM |
| 3 | Gauntlet | $42,010,608 | 63.2% | FARM |
| 4 | Veda | $41,755,666 | 63.2% | FARM |
| 5 | USDD | $32,092,626 | 60.5% | FARM |
| 6 | Polymarket International | $25,502,132 | 92.0% | FARM |
| 7 | Upshift | $19,393,433 | 55.1% | SKIP |
| 8 | Symbiotic | $18,410,213 | 75.1% | SKIP |
| 9 | Plume Vaults | $16,491,260 | 74.1% | SKIP |
| 10 | Nonce Capital | $15,945,441 | 44.6% | SKIP |

The fitted values are identical to v2/v3 — the reshuffle is entirely the odds.
Sentora takes #1 back from Steakhouse (their fitted values are $91.2M and
$91.1M; under the no-growth odds Sentora's 67.0% just edges Steakhouse's 67.0%
on unrounded values). Nonce Capital, which the growth term had lifted to #8
in v3 (odds 53.8%), falls to #10 at 44.6% without it. Mean absolute rank move
vs v2 is 4.8 places (max 19); vs v3 it is 9.9 (max 61). 9 of the v2 top 10 stay
in the top 10.

## The dashboard

`dashboard/` is a static page (index.html + app.css + app.js, 63,159 bytes total,
no network, no framework), in the dark terminal-radar theme chosen for v2
(canvas #0a0f0d, accent #2fd48a, all text/background pairs ≥7:1 contrast). It is
sortable and filterable (category, chain, farm verdict, watchlist-only, search),
has a detail view for every protocol with the full model breakdown (bootstrap and
conformal ranges, the three $/hour levels, capture breakeven, capital flip),
farm economics, and a "Why this verdict" section (gas drag, breakeven, expected
$/hour vs gas $/hour, the deciding threshold), a "Value equation" section that
shows the row's value as a literal equation with its own numbers substituted, a
"Tools" panel (sandbox for capture/capital assumptions, side-by-side compare of
two protocols, export of the filtered board as CSV), a separate live-token tab at
market value, an integrity strip (6 checks, all passing), an honesty panel
("What we claim — and what we don't", with the launch-odds histogram), a
size-curve chart (the 128 comps as a scatter, bin medians, the fitted curve;
below the table in v5 so the honesty panel fits above the fold), and a
validation panel with the curve, the blind-test numbers, the ablation table,
the odds table and a residual histogram.

The page recomputes every row from the snapshot figures with the same function
`main.ts` runs and reports the count: **198 / 198 rows match board.json**.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Node 22.18+ (tested on Node v24.22.1), standard library only. Two runs write
byte-identical output (`diff -r` clean). Outputs: `board.json` (198 rows plus the
model, validation and audit), `data.js`, `dashboard/`, `screenshots/`,
`dossier.json` (1,043,695 bytes with the three screenshots below). The board
rows, model, odds and audit are byte-identical to v5's (`diff` on those fields
clean); `board.json` as a whole differs only because `validation` gained the
four-way conformal coverages, the newest-third curve check and the dedup
ablation row — all computed by `main.ts`, none hand-written. Every implied
value, odds, fitted value, rank, top 10 and verdict is v5's, unchanged.

Screenshots (1440x900, real renders of this dashboard in headless Chromium,
via Playwright, no JS errors, page recomputes 198 / 198 rows):
`1-board.png` (231,734 bytes, 3 table rows fully visible), `2-detail.png`
(271,135 bytes, Steakhouse Financial, with the value equation and the $25/h
line), `3-filtered.png` (231,115 bytes, Risk Curators filter, 34 rows). They are
still below the 300–350 KB guide in the rules despite the added content — flat UI
compresses well, and no file was inflated artificially. The gate only caps
screenshots at 512 KiB, and the dossier is 1,043,695 bytes, well under its 1.5 MiB
cap. The sandbox, compare and CSV export were exercised in the same Playwright
run: changing the sandbox leaves the board at 198 / 198 recomputed rows, the
compare shows both protocols side by side, and the export downloads 199 lines
(header + 198 rows) for the unfiltered board.

## Limitations — stated honestly

- The size curve did not improve in v6 either: three systematic sweeps (~70
  families in v3/v4 plus the four v6 ideas) and the quadratic still stands, with
  the same weak absolute numbers (R² 0.1942, leave-one-out median error x3.38)
  and the same unconfirmed 5-fold. The error is dominated by a handful of
  extreme protocols (rain misses by 6.5 log points under every curve), and every
  flexible family fits the bulk worse, not better. Market caps are noisy, and
  the curve explains about a fifth of their log variance. This is a property of
  the snapshot (n = 128 comps), not of effort: the curve cannot be improved
  from this snapshot alone, and v6 says so instead of dressing up a worse
  model as a better one.
- The odds gain is real on two evaluations, but it still concentrates the board
  on sheer size: log TVL now enters both the fitted value and the odds. If tokens
  themselves inflate TVL (incentives, attention), part of that signal is an
  effect of having a token, not a cause of launching one. The ranking then
  favours protocols that already look tokenised. Dropping growth removes the
  counterintuitive coefficient; it does not remove this double-counting.
- The conformal interval still undercovers newer protocols (83.0% walk-forward
  coverage against a nominal 90%), and at x30.8 either way it is very wide.
  It is shown as a range, not used for verdicts.
- Category calibration failed outright, three times now: per-category intercepts
  made both blind tests worse. The model therefore still scores every protocol
  with one shared curve; categories enter the odds only through the logistic
  model's age/TVL features, not as their own terms.
- Launch odds are cohort rates from one snapshot date, not a forecast of when (or
  whether) any protocol launches a token. A protocol that "records no token" may
  still have one its DefiLlama record does not carry.
- The $/hour figures rest on labelled capture assumptions; change the assumption
  and the figure changes 100-fold. The breakeven, capture breakeven and gas-drag
  figures do not rest on it.
- There is no server-side grade for this bounty, so the 7 official gate checks
  can only be confirmed at submission; every check that can be run locally passes
  (board shape, 40/40 coverage, farm steps, screenshot sizes, dossier
  byte-identical to `buildDossier` output, determinism).
