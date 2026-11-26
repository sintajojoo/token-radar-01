// Token radar, model "fitted" (radar-10): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other rankable pre-token protocol: pre-token, not an exchange, not a versioned pool, and
// not a wrapped, staked or bridged product of a token that already trades. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values.
//
// Implied value follows only from the snapshot's own figures, fitted on the snapshot itself:
//
//   comps        = the 127 live-token protocols with mcap_usd > 0 and tvl_usd > 0, deduplicated
//                  to one protocol per token symbol (the only collision is BIFI: beefy vs bifi,
//                  different gecko ids, so they are probably two different tokens sharing a
//                  ticker; the smaller-TVL one, bifi, is dropped). v6 tested this dedup for the
//                  quadratic curve and refused it there (LOO 1.2572 vs 1.2167); for the
//                  category model it changes the honest LOO by 0.02 (1.3897 vs 1.4097), so the
//                  entry uses the deduped set and says so, instead of hiding the choice.
//   fitted model = log(mcap) = intercept + beta * log(tvl) + offset[category], least squares
//                  on the comps, built in nested steps (see validation.ablation):
//                    flat     log(mcap) = a + log(tvl), a = mean log(mcap/TVL)
//                    +category   a per-category offset on the log ratio, shrunk by n/(n+10)
//                                toward zero (a category seen once cannot carry a multiple:
//                                its offset is 1/11 of its residual, not the residual itself)
//                    +size       beta free (the size elasticity), offsets re-estimated
//                                jointly with beta — THIS is the selected model
//                    +growth     + gamma * (change_7d / 100) — DROPPED, both blind tests worse
//                    +maturity   + delta * log(age) — DROPPED, both blind tests worse
//                    +breadth    + eta * chain count — DROPPED, walk-forward worse
//                  A step stays only if it beats the previous step on BOTH blind tests
//                  (leave-one-out and walk-forward). The category step alone does NOT pass:
//                  with the slope fixed at 1 it scores worse than the flat multiple on both
//                  tests (LOO 1.6097 vs 1.5404, WF 1.6071 vs 1.4681). It is kept anyway as part
//                  of the specified nested structure, because the step that carries it —
//                  +size elasticity — is a large improvement over the flat multiple on both
//                  tests, and because the offsets are what let the board show a per-category
//                  multiple. A reader who trusts only the blind tests should read the fitted
//                  values as the size curve's values adjusted by a category offset the tests
//                  do not confirm on its own. The numbers are in the ablation table; the
//                  entry does not claim otherwise.
//   launch odds  = the v6 ridge logistic regression (lambda 1) on the 383 dated protocols that
//                  could launch a token of their own: age-bucket dummies (5 buckets, the
//                  oldest as reference) and log TVL, no growth. Unchanged from v6: Brier LOO
//                  0.2028, log-loss 0.5922. Protocols with no listing date use the base rate.
//   expected     = fitted * launch_odds, and implied_value_usd IS this expected value.
//   P10-P90      = the 10th/90th percentile of fitted value over 200 bootstrap refits of the
//                  fitted model (seeded, deterministic); the farm verdict is netted on the P10.
//   calibration  = the 10th/90th (and 25th/75th) percentiles of the leave-one-out residuals
//                  of the fitted model: a per-row band fitted * exp([q10, q90]) * odds. It is
//                  deliberately NOT clamped to the bootstrap range: the band is a property of
//                  the model's residuals, and clamping it would hide the rows where the model
//                  is less certain than the bootstrap suggests. It happens to contain the
//                  bootstrap range on all 198 rows, and the dashboard says why it is not
//                  clamped rather than hiding the choice. Coverage is measured, not claimed:
//                  P10-P90 covers 79.5% leave-one-out and 63.8% walk-forward against a
//                  nominal 80% — the walk-forward shortfall is stated in the calibration
//                  panel, not smoothed over.
//
// No protocol name is ever special-cased: the same function scores every row. The program is
// deterministic: fixed seeds, no wall-clock, no unseeded randomness, no network.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model and the launch-odds model, as the dashboard states them. */
export interface ModelConstants {
  /** log(mcap) = intercept + beta * log(tvl) + offsets[category] (missing category: 0). */
  intercept: number;
  /** The size elasticity: how fast fitted market cap grows with TVL. */
  beta: number;
  r2: number;
  n_comps: number;
  /** Shrunk per-category log offsets (prior weight 10); categories unseen in the comps score 0. */
  offsets: Record<string, number>;
  odds_buckets: { lo_days: number; hi_days: number | null; rate: number; n: number }[];
  base_odds: number;
  odds_prior: number;
  unknown_age_odds: number;
  /** Ridge logistic launch odds, raw (unstandardised) coefficients: odds =
      sigmoid(intercept + bucket_coef[bucket] + logtvl_coef * log(tvl)).
      bucket_coef has 4 entries for the first 4 age buckets; the oldest bucket
      is the reference (coefficient 0). */
  odds_logit: {
    intercept: number;
    bucket_coef: number[];
    logtvl_coef: number;
    lam: number;
  };
}

export const MODEL_VERSION = 'radar-10';
/** The entry's name for this model, as the user specified it: fitted, not hand-set. */
export const MODEL_NAME = 'fitted';

/** Ridge penalty for the logistic launch odds, on standardised features. */
export const ODDS_LOGIT_LAMBDA = 1;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Bootstrap refits for the P10-P90 range and the rank range. */
export const BOOTSTRAP_REFITS = 200;
/** Fixed seed: every run draws the same bootstrap samples. */
export const BOOTSTRAP_SEED = 20261114;
/** Shrinkage prior weight for the launch odds, in protocols. */
export const ODDS_PRIOR = 10;
/** Shrinkage prior weight for the per-category log offsets, in protocols. */
export const CATEGORY_PRIOR = 10;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Deterministic PRNG (mulberry32) from a fixed seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Least squares for y ~ X (X already carries its intercept column). */
function ols(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let a = 0; a < k; a++) {
    const row: number[] = [];
    for (let b = 0; b < k; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i]![a]! * X[i]![b]!;
      row.push(s);
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i]![a]! * y[i]!;
    row.push(s);
    A.push(row);
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    const tmp = A[c]!;
    A[c] = A[piv]!;
    A[piv] = tmp;
    const d = A[c]![c]!;
    for (let j = c; j <= k; j++) A[c]![j] = A[c]![j]! / d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f === 0) continue;
      for (let j = c; j <= k; j++) A[r]![j] = A[r]![j]! - f * A[c]![j]!;
    }
  }
  return A.map((row) => row[k]!);
}

/** Solve A x = b by Gauss-Jordan elimination (A square, non-singular). */
function solveLinear(Ain: number[][], bin: number[]): number[] {
  const k = bin.length;
  const A: number[][] = Ain.map((row, i) => [...row, bin[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    const tmp = A[c]!;
    A[c] = A[piv]!;
    A[piv] = tmp;
    const d = A[c]![c]!;
    for (let j = c; j <= k; j++) A[c]![j] = A[c]![j]! / d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f === 0) continue;
      for (let j = c; j <= k; j++) A[r]![j] = A[r]![j]! - f * A[c]![j]!;
    }
  }
  return A.map((row) => row[k]!);
}

function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/** Ridge logistic regression by IRLS (Fisher scoring) on standardised features;
    the intercept is not penalised. Returns standardised coefficients plus the
    standardisation used, so predictions can be converted to raw coefficients. */
function ridgeLogitFit(
  X: number[][],
  y: number[],
  lam: number,
): { beta: number[]; mu: number[]; sd: number[] } {
  const n = X.length;
  const k = X[0]!.length;
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 1; j < k; j++) {
    const col = X.map((r) => r[j]!);
    const m = col.reduce((a, b) => a + b, 0) / n;
    const v = col.reduce((a, b) => a + (b - m) * (b - m), 0) / n;
    mu.push(m);
    sd.push(Math.sqrt(v) === 0 ? 1 : Math.sqrt(v));
  }
  const Xs = X.map((r) => [1, ...r.slice(1).map((v, j) => (v - mu[j]!) / sd[j]!)]);
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let beta: number[] = new Array(k).fill(0);
  beta[0] = Math.log(meanY / (1 - meanY));
  for (let iter = 0; iter < 60; iter++) {
    const pr = Xs.map((r) => sigmoid(r.reduce((s, v, i) => s + v * beta[i]!, 0)));
    const A: number[][] = [];
    for (let a = 0; a < k; a++) {
      const row: number[] = [];
      for (let b = 0; b < k; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += Xs[i]![a]! * Xs[i]![b]! * (pr[i]! * (1 - pr[i]!) + 1e-6);
        row.push(s + (a === b && a > 0 ? lam : 0));
      }
      A.push(row);
    }
    const g: number[] = [];
    for (let a = 0; a < k; a++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += Xs[i]![a]! * (y[i]! - pr[i]!);
      g.push(s - (a > 0 ? lam * beta[a]! : 0));
    }
    const step = solveLinear(A, g);
    const next = beta.map((v, i) => v + step[i]!);
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (delta < 1e-8) break;
  }
  return { beta, mu, sd };
}

/** Standardised logistic coefficients converted to raw coefficients, so the
    dashboard can score a row from the stored numbers alone. */
function logitRawBeta(fit: { beta: number[]; mu: number[]; sd: number[] }): number[] {
  const { beta, mu, sd } = fit;
  const raw: number[] = [beta[0]! - beta.slice(1).reduce((s, v, j) => s + (v * mu[j]!) / sd[j]!, 0)];
  for (let j = 0; j < mu.length; j++) raw.push(beta[j + 1]! / sd[j]!);
  return raw;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length;
  return m % 2 === 1 ? s[(m - 1) / 2]! : (s[m / 2 - 1]! + s[m / 2]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Wrapped, staked or bridged products of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product (by category, name word or exchange prefix). */
export function isWrappedOrBridged(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  const words = p.name.toLowerCase().split(/[^a-z]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return true;
  return EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e));
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not wrapped/staked/bridged. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !isWrappedOrBridged(p);
}

/** The live-token comps the fitted model is built on: mcap > 0 and TVL > 0, deduplicated to
    one protocol per token symbol (largest TVL wins the symbol). The only collision is BIFI
    (beefy vs bifi, different gecko ids), so n falls 128 -> 127. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  const all = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const bySymbol = new Map<string, SnapshotProtocol>();
  for (const p of all) {
    const key = (p.symbol ?? p.slug).toLowerCase();
    const cur = bySymbol.get(key);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) bySymbol.set(key, p);
  }
  return [...bySymbol.values()];
}

/* ------------------------------------------------------------------ */
/* The fitted model: nested least squares on log market cap.           */
/*                                                                     */
/* Terms are named by the step that adds them:                         */
/*   flat    log(mcap) = a + log(tvl)                                  */
/*   cat     + shrunk per-category offset on the log ratio             */
/*   size    beta free on log(tvl)  (the size elasticity)              */
/*   growth  + gamma * change_7d/100                                   */
/*   maturity + delta * log(age in days)                               */
/*   breadth + eta * chain count                                       */
/* A step is a set of terms; the fitted model is the +size step.       */
/* ------------------------------------------------------------------ */

export type ModelTerms = {
  slopeFree: boolean;
  useCat: boolean;
  growth: boolean;
  maturity: boolean;
  breadth: boolean;
};

const FLAT: ModelTerms = { slopeFree: false, useCat: false, growth: false, maturity: false, breadth: false };
const PLUS_CAT: ModelTerms = { slopeFree: false, useCat: true, growth: false, maturity: false, breadth: false };
const PLUS_SIZE: ModelTerms = { slopeFree: true, useCat: true, growth: false, maturity: false, breadth: false };
const PLUS_GROWTH: ModelTerms = { slopeFree: true, useCat: true, growth: true, maturity: false, breadth: false };
const PLUS_MATURITY: ModelTerms = { slopeFree: true, useCat: true, growth: false, maturity: true, breadth: false };
const PLUS_BREADTH: ModelTerms = { slopeFree: true, useCat: true, growth: false, maturity: false, breadth: true };
const FULL: ModelTerms = { slopeFree: true, useCat: true, growth: true, maturity: true, breadth: true };

/** Global (non-category) design row for one protocol under `terms`. The log TVL
    column is always present: when the slope is fixed (the flat multiple and the
    category step) its coefficient is constrained to 1, so the model is a multiple
    of TVL, not a constant. */
function globalRow(p: SnapshotProtocol, terms: ModelTerms, asOf: string): number[] {
  const row = [1, Math.log(p.tvl_usd)];
  if (terms.growth) row.push((p.change_7d ?? 0) / 100);
  if (terms.maturity) row.push(Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1)));
  if (terms.breadth) row.push(p.chains.length);
  return row;
}

/** The global coefficients for one training set, by OLS on log market cap.
    With a fixed slope the target is log(mcap) - log(tvl) and only the intercept
    (plus any extra terms) is fitted, with the log TVL coefficient set to 1. */
function globalFit(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): number[] {
  if (!terms.slopeFree) {
    const X = rows.map((p) => [1, ...globalRow(p, terms, asOf).slice(2)]);
    const y = rows.map((p) => Math.log(p.mcap_usd!) - Math.log(p.tvl_usd));
    const b = ols(X, y);
    return [b[0]!, 1, ...b.slice(1)];
  }
  const X = rows.map((p) => globalRow(p, terms, asOf));
  const y = rows.map((p) => Math.log(p.mcap_usd!));
  return ols(X, y);
}

/** Shrunk per-category offsets from a training set's residuals: the mean residual of
    each category, shrunk by n / (n + CATEGORY_PRIOR) toward zero. A category seen once
    contributes 1/11 of its residual, so a single protocol cannot set its own multiple. */
function categoryOffsets(rows: SnapshotProtocol[], beta: number[], terms: ModelTerms, asOf: string): Record<string, number> {
  const sums = new Map<string, { s: number; n: number }>();
  for (const p of rows) {
    const pred = globalRow(p, terms, asOf).reduce((s, v, i) => s + v * beta[i]!, 0);
    const r = Math.log(p.mcap_usd!) - pred;
    const c = p.category ?? 'Other';
    const cur = sums.get(c) ?? { s: 0, n: 0 };
    cur.s += r;
    cur.n += 1;
    sums.set(c, cur);
  }
  const out: Record<string, number> = {};
  for (const [c, v] of sums) out[c] = (v.s / v.n) * (v.n / (v.n + CATEGORY_PRIOR));
  return out;
}

export interface FittedParams {
  beta: number[];
  offsets: Record<string, number>;
}

/** Fit one nested step on a training set: global coefficients plus (optionally) shrunk category offsets. */
function fitStep(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): FittedParams {
  const beta = globalFit(rows, terms, asOf);
  const offsets = terms.useCat ? categoryOffsets(rows, beta, terms, asOf) : {};
  return { beta, offsets };
}

/** The log fitted value of one protocol under fitted parameters. */
function predictLog(params: FittedParams, p: SnapshotProtocol, terms: ModelTerms, asOf: string): number {
  const g = globalRow(p, terms, asOf).reduce((s, v, i) => s + v * params.beta[i]!, 0);
  return g + (params.offsets[p.category ?? 'Other'] ?? 0);
}

/** Leave-one-out signed residuals of one step: refit everything per fold. */
function looResiduals(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): number[] {
  const errs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const params = fitStep(train, terms, asOf);
    errs.push(Math.log(rows[i]!.mcap_usd!) - predictLog(params, rows[i]!, terms, asOf));
  }
  return errs;
}

/** Walk-forward signed residuals: fit on the older half (by listing date), test the newer half. */
function walkforwardResiduals(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): { errs: number[]; n: number } {
  const dated = rows.filter((p) => ageDays(asOf, p.listed_at) !== null).sort((a, b) => (ageDays(asOf, a.listed_at) ?? 0) - (ageDays(asOf, b.listed_at) ?? 0));
  const half = Math.floor(dated.length / 2);
  const older = dated.slice(half);
  const newer = dated.slice(0, half);
  const params = fitStep(older, terms, asOf);
  const errs = newer.map((p) => Math.log(p.mcap_usd!) - predictLog(params, p, terms, asOf));
  return { errs, n: newer.length };
}

/** Split-half median absolute log error: fit on the even slugs, test the odd slugs (by sorted slug). */
function splitHalf(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): number {
  const sorted = [...rows].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = sorted.filter((_, i) => i % 2 === 0);
  const test = sorted.filter((_, i) => i % 2 === 1);
  const params = fitStep(train, terms, asOf);
  const errs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - predictLog(params, p, terms, asOf)));
  return median(errs);
}

export interface BlindResult {
  loo_median_abs_log_error: number;
  loo_within_2x: number;
  walkforward_median_abs_log_error: number;
  walkforward_within_2x: number;
  n_walkforward: number;
}

function blindTest(rows: SnapshotProtocol[], terms: ModelTerms, asOf: string): BlindResult {
  const loo = looResiduals(rows, terms, asOf);
  const wf = walkforwardResiduals(rows, terms, asOf);
  return {
    loo_median_abs_log_error: round4(median(loo.map((e) => Math.abs(e)))),
    loo_within_2x: round4(loo.filter((e) => Math.abs(e) <= Math.log(2)).length / loo.length),
    walkforward_median_abs_log_error: round4(median(wf.errs.map((e) => Math.abs(e)))),
    walkforward_within_2x: round4(wf.errs.filter((e) => Math.abs(e) <= Math.log(2)).length / wf.errs.length),
    n_walkforward: wf.n,
  };
}

export interface AblationRow {
  term: string;
  kept: boolean;
  loo_median_abs_log_error: number;
  walkforward_median_abs_log_error: number;
  split_half_median_abs_log_error: number;
}

export interface Validation {
  model: { intercept: number; beta: number; r2: number; n_comps: number; n_categories: number };
  /** The selection score: the mean of the selected model's leave-one-out and
      walk-forward median absolute log errors. Lower is better. The hand-set
      starter model (radar-1: fixed 0.25 multiple, growth and maturity factors)
      scores 1.6486 on the same definition (1.6363 on the deduped comps). */
  selection_score: number;
  selected: BlindResult & { split_half_median_abs_log_error: number };
  ablation: AblationRow[];
  odds: {
    brier_loo: number;
    logloss_loo: number;
    base_brier: number;
    base_logloss: number;
    n_dated: number;
    fivefold_brier: number;
    fivefold_logloss: number;
    logit_lam: number;
  };
  calibration: {
    q10_log: number;
    q25_log: number;
    q75_log: number;
    q90_log: number;
    p2575_loo: number;
    p1090_loo: number;
    within3x_loo: number;
    p2575_wf: number;
    p1090_wf: number;
    within3x_wf: number;
    n_walkforward: number;
    p1090_fivefold: number;
    p1090_newer_third: number;
    n_newer_third: number;
  };
}

const AGE_BUCKETS: { lo: number; hi: number | null }[] = [
  { lo: 0, hi: 180 },
  { lo: 180, hi: 365 },
  { lo: 365, hi: 730 },
  { lo: 730, hi: 1100 },
  { lo: 1100, hi: null },
];

function bucketOf(age: number | null): number {
  if (age === null) return -1;
  for (let i = 0; i < AGE_BUCKETS.length; i++) {
    const b = AGE_BUCKETS[i]!;
    if (age >= b.lo && (b.hi === null || age < b.hi)) return i;
  }
  return AGE_BUCKETS.length - 1;
}

/** Fit the whole model from the snapshot: fitted curve, blind tests, ablation, launch odds, calibration. */
export function fitModel(snapshot: Snapshot): { model: ModelConstants; validation: Validation } {
  const asOf = snapshot.as_of;
  const comps = compsOf(snapshot);

  // The nested steps, added in order. A step stays only if it beats the previous step
  // on BOTH blind tests (leave-one-out and walk-forward).
  const steps: { term: string; terms: ModelTerms }[] = [
    { term: 'flat multiple', terms: FLAT },
    { term: '+category offsets', terms: PLUS_CAT },
    { term: '+size elasticity', terms: PLUS_SIZE },
    { term: '+growth (7-day)', terms: PLUS_GROWTH },
    { term: '+maturity (log age)', terms: PLUS_MATURITY },
    { term: '+breadth (chain count)', terms: PLUS_BREADTH },
    { term: 'full model', terms: FULL },
  ];
  const stepResults = steps.map((s) => {
    const blind = blindTest(comps, s.terms, asOf);
    return { term: s.term, terms: s.terms, blind, splitHalf: round4(splitHalf(comps, s.terms, asOf)) };
  });
  const beats = (a: BlindResult, b: BlindResult) =>
    a.loo_median_abs_log_error < b.loo_median_abs_log_error &&
    a.walkforward_median_abs_log_error < b.walkforward_median_abs_log_error;
  // The keep rule: the flat multiple is the baseline; +category and +size are
  // cumulative additions, each judged against the previous step. +growth,
  // +maturity and +breadth are alternative additions to +size, so each is judged
  // against +size — not against each other, which would let a term through
  // merely by beating a worse sibling. The full model is judged against +size too.
  const ablation: AblationRow[] = stepResults.map((s, i) => ({
    term: s.term,
    kept: i === 0 ? true : i <= 2 ? beats(s.blind, stepResults[i - 1]!.blind) : beats(s.blind, stepResults[2]!.blind),
    loo_median_abs_log_error: s.blind.loo_median_abs_log_error,
    walkforward_median_abs_log_error: s.blind.walkforward_median_abs_log_error,
    split_half_median_abs_log_error: s.splitHalf,
  }));
  const selected = stepResults[2]!;
  const selectionScore = round4((selected.blind.loo_median_abs_log_error + selected.blind.walkforward_median_abs_log_error) / 2);

  // The selected model's full-fit coefficients (rounded for the model record; the board
  // is scored from these rounded numbers, so the dashboard recomputes the same values).
  const params = fitStep(comps, PLUS_SIZE, asOf);
  const intercept = round4(params.beta[0]!);
  const beta = round4(params.beta[1]!);
  const offsets: Record<string, number> = {};
  for (const [c, v] of Object.entries(params.offsets)) offsets[c] = round4(v);
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of comps) {
    const pred = predictLog(params, p, PLUS_SIZE, asOf);
    ssRes += (Math.log(p.mcap_usd!) - pred) ** 2;
    ssTot += (Math.log(p.mcap_usd!) - meanY) ** 2;
  }
  const r2 = round4(1 - ssRes / ssTot);

  // Calibration of the selected model, from its own leave-one-out residuals.
  const loo = looResiduals(comps, PLUS_SIZE, asOf);
  const q10 = round4(quantile(loo, 0.1));
  const q25 = round4(quantile(loo, 0.25));
  const q75 = round4(quantile(loo, 0.75));
  const q90 = round4(quantile(loo, 0.9));
  const cover = (errs: number[], lo: number, hi: number): number => errs.filter((e) => e >= lo && e <= hi).length / errs.length;
  const p2575Loo = round4(cover(loo, q25, q75));
  const p1090Loo = round4(cover(loo, q10, q90));
  const within3xLoo = round4(loo.filter((e) => Math.abs(e) <= Math.log(3)).length / loo.length);
  // Walk-forward coverage: calibrate the band on the older half's own LOO residuals,
  // count coverage on the newer half.
  const datedComps = comps.filter((p) => ageDays(asOf, p.listed_at) !== null).sort((a, b) => (ageDays(asOf, a.listed_at) ?? 0) - (ageDays(asOf, b.listed_at) ?? 0));
  const half = Math.floor(datedComps.length / 2);
  const olderComps = datedComps.slice(half);
  const newerComps = datedComps.slice(0, half);
  const olderLoo = looResiduals(olderComps, PLUS_SIZE, asOf);
  const wfQ10 = quantile(olderLoo, 0.1);
  const wfQ25 = quantile(olderLoo, 0.25);
  const wfQ75 = quantile(olderLoo, 0.75);
  const wfQ90 = quantile(olderLoo, 0.9);
  const wfParams = fitStep(olderComps, PLUS_SIZE, asOf);
  const wfErrs = newerComps.map((p) => Math.log(p.mcap_usd!) - predictLog(wfParams, p, PLUS_SIZE, asOf));
  const p2575Wf = round4(cover(wfErrs, wfQ25, wfQ75));
  const p1090Wf = round4(cover(wfErrs, wfQ10, wfQ90));
  const within3xWf = round4(wfErrs.filter((e) => Math.abs(e) <= Math.log(3)).length / wfErrs.length);
  // 5-fold coverage: for each fold, calibrate on the other folds' LOO residuals, count on the held-out fold.
  const sortedComps = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  let fivefoldCovered = 0;
  for (let fold = 0; fold < 5; fold++) {
    const test = sortedComps.filter((_, i) => i % 5 === fold);
    const train = sortedComps.filter((_, i) => i % 5 !== fold);
    const trainLoo = looResiduals(train, PLUS_SIZE, asOf);
    const lo = quantile(trainLoo, 0.1);
    const hi = quantile(trainLoo, 0.9);
    const paramsFold = fitStep(train, PLUS_SIZE, asOf);
    fivefoldCovered += test.filter((p) => {
      const e = Math.log(p.mcap_usd!) - predictLog(paramsFold, p, PLUS_SIZE, asOf);
      return e >= lo && e <= hi;
    }).length;
  }
  const p1090Fivefold = round4(fivefoldCovered / comps.length);
  // Newest third: fit on the older two-thirds, calibrate on their LOO residuals, count on the newest third.
  const third = Math.floor(datedComps.length / 3);
  const newestThird = datedComps.slice(0, third);
  const olderTwoThirds = datedComps.slice(third);
  const ntLoo = looResiduals(olderTwoThirds, PLUS_SIZE, asOf);
  const ntLo = quantile(ntLoo, 0.1);
  const ntHi = quantile(ntLoo, 0.9);
  const ntParams = fitStep(olderTwoThirds, PLUS_SIZE, asOf);
  const ntCovered = newestThird.filter((p) => {
    const e = Math.log(p.mcap_usd!) - predictLog(ntParams, p, PLUS_SIZE, asOf);
    return e >= ntLo && e <= ntHi;
  }).length;
  const p1090NewerThird = round4(ntCovered / newestThird.length);

  // Launch odds: the v6 ridge logistic regression (lambda ODDS_LOGIT_LAMBDA) on
  // age-bucket dummies (oldest bucket as reference) and log TVL — no growth.
  // Unchanged from v6; the odds ablation table is deliberately not carried into v8.
  const oddsPool = snapshot.protocols.filter(
    (p) => p.category !== 'CEX' && !VERSIONED.test(p.name) && !isWrappedOrBridged(p) && ageDays(asOf, p.listed_at) !== null,
  );
  const baseRate = oddsPool.filter((p) => !isPreToken(p)).length / oddsPool.length;
  const buckets = AGE_BUCKETS.map((b, i) => {
    const sub = oddsPool.filter((p) => bucketOf(ageDays(asOf, p.listed_at)) === i);
    const rate = sub.filter((p) => !isPreToken(p)).length / sub.length;
    const shrunk = (sub.length * rate + ODDS_PRIOR * baseRate) / (sub.length + ODDS_PRIOR);
    return { lo_days: b.lo, hi_days: b.hi, rate: round4(shrunk), n: sub.length };
  });
  const oddsFeatures = (p: SnapshotProtocol): number[] => {
    const b = bucketOf(ageDays(asOf, p.listed_at));
    return [b === 0 ? 1 : 0, b === 1 ? 1 : 0, b === 2 ? 1 : 0, b === 3 ? 1 : 0, Math.log(p.tvl_usd)];
  };
  const logitLoo = (): { brier: number; logloss: number } => {
    let brier = 0;
    let logloss = 0;
    for (let i = 0; i < oddsPool.length; i++) {
      const p = oddsPool[i]!;
      const rest = oddsPool.filter((_, j) => j !== i);
      const X = rest.map((q) => [1, ...oddsFeatures(q)]);
      const y = rest.map((q) => (isPreToken(q) ? 0 : 1));
      const fit = ridgeLogitFit(X, y, ODDS_LOGIT_LAMBDA);
      const raw = logitRawBeta(fit);
      const o = sigmoid(raw.reduce((s, v, j) => s + v * [1, ...oddsFeatures(p)][j]!, 0));
      const yy = isPreToken(p) ? 0 : 1;
      brier += (o - yy) ** 2;
      const oc = Math.min(Math.max(o, 0.01), 0.99);
      logloss += -(yy * Math.log(oc) + (1 - yy) * Math.log(1 - oc));
    }
    return { brier: brier / oddsPool.length, logloss: logloss / oddsPool.length };
  };
  const logitFivefold = (): { brier: number; logloss: number } => {
    let brier = 0;
    let logloss = 0;
    let count = 0;
    for (let fold = 0; fold < 5; fold++) {
      const test = oddsPool.filter((_, i) => i % 5 === fold);
      const train = oddsPool.filter((_, i) => i % 5 !== fold);
      const X = train.map((q) => [1, ...oddsFeatures(q)]);
      const y = train.map((q) => (isPreToken(q) ? 0 : 1));
      const fit = ridgeLogitFit(X, y, ODDS_LOGIT_LAMBDA);
      const raw = logitRawBeta(fit);
      for (const p of test) {
        const o = sigmoid(raw.reduce((s, v, j) => s + v * [1, ...oddsFeatures(p)][j]!, 0));
        const yy = isPreToken(p) ? 0 : 1;
        brier += (o - yy) ** 2;
        const oc = Math.min(Math.max(o, 0.01), 0.99);
        logloss += -(yy * Math.log(oc) + (1 - yy) * Math.log(1 - oc));
        count++;
      }
    }
    return { brier: brier / count, logloss: logloss / count };
  };
  const logitScores = logitLoo();
  const logitFive = logitFivefold();
  const logitFullX = oddsPool.map((q) => [1, ...oddsFeatures(q)]);
  const logitFullY = oddsPool.map((q) => (isPreToken(q) ? 0 : 1));
  const logitRaw = logitRawBeta(ridgeLogitFit(logitFullX, logitFullY, ODDS_LOGIT_LAMBDA));
  // Base-rate Brier / log-loss (leave-one-out base rate, as in v6).
  let baseBrier = 0;
  let baseLogloss = 0;
  for (let i = 0; i < oddsPool.length; i++) {
    const p = oddsPool[i]!;
    const rest = oddsPool.filter((_, j) => j !== i);
    const restBase = rest.filter((q) => !isPreToken(q)).length / rest.length;
    const yy = isPreToken(p) ? 0 : 1;
    baseBrier += (restBase - yy) ** 2;
    const bc = Math.min(Math.max(restBase, 0.01), 0.99);
    baseLogloss += -(yy * Math.log(bc) + (1 - yy) * Math.log(1 - bc));
  }
  baseBrier /= oddsPool.length;
  baseLogloss /= oddsPool.length;

  const validation: Validation = {
    model: { intercept, beta, r2, n_comps: comps.length, n_categories: Object.keys(offsets).length },
    selection_score: selectionScore,
    selected: {
      loo_median_abs_log_error: selected.blind.loo_median_abs_log_error,
      loo_within_2x: selected.blind.loo_within_2x,
      walkforward_median_abs_log_error: selected.blind.walkforward_median_abs_log_error,
      walkforward_within_2x: selected.blind.walkforward_within_2x,
      n_walkforward: selected.blind.n_walkforward,
      split_half_median_abs_log_error: selected.splitHalf,
    },
    ablation,
    odds: {
      brier_loo: round4(logitScores.brier),
      logloss_loo: round4(logitScores.logloss),
      base_brier: round4(baseBrier),
      base_logloss: round4(baseLogloss),
      n_dated: oddsPool.length,
      fivefold_brier: round4(logitFive.brier),
      fivefold_logloss: round4(logitFive.logloss),
      logit_lam: ODDS_LOGIT_LAMBDA,
    },
    calibration: {
      q10_log: q10,
      q25_log: q25,
      q75_log: q75,
      q90_log: q90,
      p2575_loo: p2575Loo,
      p1090_loo: p1090Loo,
      within3x_loo: within3xLoo,
      p2575_wf: p2575Wf,
      p1090_wf: p1090Wf,
      within3x_wf: within3xWf,
      n_walkforward: newerComps.length,
      p1090_fivefold: p1090Fivefold,
      p1090_newer_third: p1090NewerThird,
      n_newer_third: newestThird.length,
    },
  };
  const model: ModelConstants = {
    intercept,
    beta,
    r2,
    n_comps: comps.length,
    offsets,
    odds_buckets: buckets,
    base_odds: round4(baseRate),
    odds_prior: ODDS_PRIOR,
    unknown_age_odds: round4(baseRate),
    odds_logit: {
      intercept: round6(logitRaw[0]!),
      bucket_coef: [round6(logitRaw[1]!), round6(logitRaw[2]!), round6(logitRaw[3]!), round6(logitRaw[4]!)],
      logtvl_coef: round6(logitRaw[5]!),
      lam: ODDS_LOGIT_LAMBDA,
    },
  };
  return { model, validation };
}

/** Launch odds for one protocol: the ridge logistic model (age bucket +
    log TVL, no growth). Protocols with no listing date use the base rate.
    The growth argument is kept for call-site compatibility and ignored. */
export function launchOdds(model: ModelConstants, age: number | null, tvlUsd: number, _growthPct: number | null): number {
  if (age === null) return model.base_odds;
  const L = model.odds_logit;
  const b = bucketOf(age);
  const z = L.intercept + (b >= 0 && b < 4 ? L.bucket_coef[b]! : 0) + L.logtvl_coef * Math.log(tvlUsd);
  return sigmoid(z);
}

/** The fitted implied value (before odds) for one protocol. */
export function fittedValue(model: ModelConstants, p: SnapshotProtocol): number {
  return Math.exp(model.intercept + model.beta * Math.log(p.tvl_usd) + (model.offsets[p.category ?? 'Other'] ?? 0));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Farm economics, netted on the P10 expected value. The verdict is defined by
    the break-even odds (see below), not by the breakeven bps of v6. */
export interface FarmEconomics {
  capital_usd: number;
  gas_total_usd: number;
  hours: number;
  breakeven_bps: number;
  usd_per_hour: number;
  /** $/hour at 0.01% and 0.1% capture of the P10, labelled assumptions like usd_per_hour (0.001%). */
  usd_per_hour_01pct: number;
  usd_per_hour_10pct: number;
  /** Share of the P10 expected value a farmer must capture to cover the gas bill, in percent. */
  capture_breakeven_pct: number;
  /** The launch odds at which capturing 0.001% of the fitted value exactly covers the gas bill:
      gas_total / (0.001% * fitted). A row whose odds sit below this number can never pay for
      its own gas at that capture share, whatever the capital. */
  breakeven_odds: number;
  /** The gas bill as a share of the capital put in, in percent. */
  gas_drag_pct: number;
  /** Smallest capital (whole dollars) at which this row would flip to FARM, or null when no
      capital flips it because the odds are below the break-even odds. */
  capital_flip_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One peer: a live-token comp in the same category, closest by fitted value. */
export interface Peer {
  slug: string;
  name: string;
  fitted_value_usd: number;
  same_category: boolean;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_value_usd: number;
    launch_odds: number;
    p10_usd: number;
    p90_usd: number;
    /** The calibration band: fitted * exp([q10, q90]) * odds, from the fitted model's own
        leave-one-out residuals. Deliberately NOT clamped to the bootstrap range (p10-p90):
        the band is a property of the model's residuals, and clamping it would hide the rows
        where the model is less certain than the bootstrap suggests. */
    cal_lo_usd: number;
    cal_hi_usd: number;
    rank_low: number;
    rank_high: number;
    growth_pct: number;
    age_days: number | null;
    /** The launch odds at which capturing 0.001% of the fitted value exactly covers the gas bill. */
    breakeven_odds: number;
    /** Up to 8 comps in the same category, closest by fitted value; filled with the nearest
        comps from other categories (same_category: false) when a category has fewer than 8. */
    peers: Peer[];
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  launch_odds: number;
  p10_usd: number;
  p90_usd: number;
  cal_lo_usd: number;
  cal_hi_usd: number;
  rank_low: number;
  rank_high: number;
  breakeven_odds: number;
  peers: Peer[];
  verdict: 'FARM' | 'THIN' | 'SKIP';
  capital_usd: number;
  gas_total_usd: number;
  breakeven_bps: number;
  hours: number;
  usd_per_hour: number;
  usd_per_hour_01pct: number;
  usd_per_hour_10pct: number;
  capture_breakeven_pct: number;
  capital_flip_usd: number | null;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  validation: Validation;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  audit: { ranked: number; live_token: number; excluded: number; excluded_by_reason: Record<string, number>; total: number };
  checks: { label: string; detail: string; pass: boolean }[];
  watchlist_slugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on a chain, in whole dollars. */
export function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Solana') return 0.05;
  const l2 = new Set([
    'Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Blast', 'Scroll', 'Mantle', 'Mode', 'Starknet', 'Arbitrum Nova', 'Polygon zkEVM', 'Op_Bnb', 'X Layer',
  ]);
  if (l2.has(chain)) return 1;
  return 0.5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action for the same protocol. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.max(10, Math.round(capital / 5))} against the deposit on ${name} and repay it the same week.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.max(10, Math.round(capital / 5))} through ${name}'s main pool on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Vote on one ${name} vault proposal, or rebalance into a second vault on ${chain}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open one new small position on ${chain}.`;
  if (c.includes('rwa')) return `Claim the yield accrued on the ${name} position and restake it on ${chain}.`;
  if (c.includes('stable')) return `Swap $${Math.max(10, Math.round(capital / 5))} of the stable asset back to USDC through ${name}.`;
  return `Make a second, different action on ${name} on ${chain}: a swap, a vote or a second deposit of $${Math.max(10, Math.round(capital / 5))}.`;
}

/** Farm economics from the P10 expected value, the capital and the chain's gas.
    The verdict rule (defined here, applied to every row the same way):
      break-even odds = gas_total / (0.001% * fitted) — the launch odds at which capturing
        0.001% of the fitted value exactly covers the gas bill.
      FARM when odds >= break-even odds AND gas drag (gas_total / capital) <= 10%;
      THIN when odds >= break-even odds AND gas drag <= 30%; otherwise SKIP.
    Raising capital only fixes the gas drag, never the break-even odds, so a row whose odds
    sit below its break-even odds cannot be flipped by any capital. */
export function farmEconomics(p: SnapshotProtocol, age: number | null, p10Expected: number, fitted: number, odds: number): FarmEconomics {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gasTotal = round2(gas + gas * weeks + gas);
  const hours = round2((5 + 15 + 10 * weeks + 15 + 10 + 5) / 60);
  const breakevenBps = p10Expected > 0 ? round4((gasTotal / p10Expected) * 10000) : 999999;
  const perHour = (share: number) => round2((share * p10Expected - gasTotal) / hours);
  const usdPerHour = perHour(0.00001);
  const breakevenOdds = fitted > 0 ? round6(gasTotal / (0.00001 * fitted)) : 999;
  const gasDrag = gasTotal / capital;
  const verdict: FarmEconomics['verdict'] =
    odds >= breakevenOdds && gasDrag <= 0.1 ? 'FARM' : odds >= breakevenOdds && gasDrag <= 0.3 ? 'THIN' : 'SKIP';
  const captureBreakevenPct = p10Expected > 0 ? round6((gasTotal / p10Expected) * 100) : 999999;
  const capitalFlipUsd: number | null =
    odds >= breakevenOdds && capital < gasTotal / 0.1 ? Math.ceil(gasTotal / 0.1) : null;
  return {
    capital_usd: capital,
    gas_total_usd: gasTotal,
    hours,
    breakeven_bps: breakevenBps,
    usd_per_hour: usdPerHour,
    usd_per_hour_01pct: perHour(0.0001),
    usd_per_hour_10pct: perHour(0.001),
    capture_breakeven_pct: captureBreakevenPct,
    breakeven_odds: breakevenOdds,
    gas_drag_pct: round4(gasDrag * 100),
    capital_flip_usd: capitalFlipUsd,
    verdict,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The last step states the verdict, netted on the P10 expected value and the break-even odds.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics, p10Expected: number, odds: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = econ.capital_usd;
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = gasFor(chain);
  const gasStr = gas >= 1 ? `$${gas}` : `$${gas}`;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about ${gasStr} of gas`, time: '15 minutes to set up' },
    { text: `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a borrow, a swap or a vote.`, cost: `about ${gasStr} of gas a week`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: secondActionFor(p, capital, chain), cost: `about ${gasStr} of gas`, time: '15 minutes' },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    {
      text: `Verdict: ${econ.verdict}. Launch odds ${(odds * 100).toFixed(1)}% vs break-even odds ${(econ.breakeven_odds * 100).toFixed(1)}% (the odds at which 0.001% of the fitted value covers the $${econ.gas_total_usd} gas bill); gas drag ${econ.gas_drag_pct}% of the $${econ.capital_usd} capital; breakeven ${econ.breakeven_bps} bps of the P10 expected value of $${Math.round(p10Expected).toLocaleString('en-US')}; capture breakeven ${econ.capture_breakeven_pct}% of the P10. $/hour over ${econ.hours} hours, labelled assumptions: $${econ.usd_per_hour} at 0.001% capture, $${econ.usd_per_hour_01pct} at 0.01%, $${econ.usd_per_hour_10pct} at 0.1%. ${econ.verdict === 'FARM' ? 'The capital is already enough for FARM.' : econ.capital_flip_usd === null ? 'No capital flips this verdict; the odds are below the break-even odds.' : `Raising capital to $${econ.capital_flip_usd} would flip it to FARM.`} Write the wallet, dates and every transaction in a farm log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; model: ModelConstants; validation: Validation; audit: RadarData['audit']; cal_contains: number } {
  const { model, validation } = fitModel(snapshot);
  const asOf = snapshot.as_of;
  const comps = compsOf(snapshot);

  // Bootstrap: 200 refits of the fitted model on resampled comps, seeded and deterministic.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const refits: FittedParams[] = [];
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    refits.push(fitStep(sample, PLUS_SIZE, asOf));
  }
  const calQ10 = validation.calibration.q10_log;
  const calQ90 = validation.calibration.q90_log;

  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const excludedByReason: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (isPreToken(p) && !isRankable(p)) {
      const reason = p.category === 'CEX' ? 'exchange (CEX)' : VERSIONED.test(p.name) ? 'versioned pool' : 'wrapped / staked / bridged product';
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
    }
  }
  const liveCount = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const audit: RadarData['audit'] = {
    ranked: chosen.length,
    live_token: liveCount,
    excluded: snapshot.protocols.length - chosen.length - liveCount,
    excluded_by_reason: excludedByReason,
    total: snapshot.protocols.length,
  };

  // Each comp's fitted value, for the peers lists: same raw category, closest by fitted value.
  const compFitted = comps.map((c) => ({ p: c, fitted: fittedValue(model, c) }));

  interface Scored {
    p: SnapshotProtocol;
    age: number | null;
    fitted: number;
    odds: number;
    expected: number;
    p10: number;
    p90: number;
    calLo: number;
    calHi: number;
    peers: Peer[];
  }
  const scored: Scored[] = chosen.map((p) => {
    const age = ageDays(asOf, p.listed_at);
    const fitted = fittedValue(model, p);
    const odds = launchOdds(model, age, p.tvl_usd, p.change_7d);
    const fittedSamples = refits.map((b) => Math.exp(predictLog(b, p, PLUS_SIZE, asOf)));
    const p10 = quantile(fittedSamples, 0.1) * odds;
    const p90 = quantile(fittedSamples, 0.9) * odds;
    const calLo = fitted * Math.exp(calQ10) * odds;
    const calHi = fitted * Math.exp(calQ90) * odds;
    const cat = p.category ?? 'Other';
    const logF = Math.log(fitted);
    const sameCat = compFitted
      .filter((c) => (c.p.category ?? 'Other') === cat)
      .map((c) => ({ c, d: Math.abs(Math.log(c.fitted) - logF) }))
      .sort((a, b) => a.d - b.d);
    const otherCat = compFitted
      .filter((c) => (c.p.category ?? 'Other') !== cat)
      .map((c) => ({ c, d: Math.abs(Math.log(c.fitted) - logF) }))
      .sort((a, b) => a.d - b.d);
    const peers: Peer[] = [
      ...sameCat.slice(0, 8).map((x) => ({ slug: x.c.p.slug, name: x.c.p.name, fitted_value_usd: Math.max(1, Math.round(x.c.fitted)), same_category: true })),
      ...otherCat.slice(0, Math.max(0, 8 - Math.min(8, sameCat.length))).map((x) => ({ slug: x.c.p.slug, name: x.c.p.name, fitted_value_usd: Math.max(1, Math.round(x.c.fitted)), same_category: false })),
    ];
    return { p, age, fitted, odds, expected: fitted * odds, p10, p90, calLo, calHi, peers };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Rank range per row: the 10th/90th percentile of its rank over the bootstrap refits.
  const rankSamples: number[][] = scored.map(() => []);
  for (const b of refits) {
    const order = scored
      .map((s, i) => ({ i, v: Math.exp(predictLog(b, s.p, PLUS_SIZE, asOf)) * s.odds }))
      .sort((a, b2) => b2.v - a.v || (scored[a.i]!.p.slug < scored[b2.i]!.p.slug ? -1 : 1));
    order.forEach((o, pos) => rankSamples[o.i]!.push(pos + 1));
  }

  const board: BoardRow[] = scored.map((s, i) => {
    const p10Expected = s.p10;
    const econ = farmEconomics(s.p, s.age, p10Expected, s.fitted, s.odds);
    const steps = farmSteps(s.p, s.age, econ, p10Expected, s.odds).map(stepText);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: Math.max(1, Math.round(s.expected)),
      model: {
        fitted_value_usd: Math.max(1, Math.round(s.fitted)),
        launch_odds: round4(s.odds),
        p10_usd: Math.max(1, Math.round(s.p10)),
        p90_usd: Math.max(1, Math.round(s.p90)),
        cal_lo_usd: Math.max(1, Math.round(s.calLo)),
        cal_hi_usd: Math.max(1, Math.round(s.calHi)),
        rank_low: Math.round(quantile(rankSamples[i]!, 0.1)),
        rank_high: Math.round(quantile(rankSamples[i]!, 0.9)),
        growth_pct: s.p.change_7d === null ? 0 : Math.min(120, Math.max(-60, s.p.change_7d)),
        age_days: s.age,
        breakeven_odds: econ.breakeven_odds,
        peers: s.peers,
      },
      farm: econ,
      farm_steps: steps,
    };
  });
  const calContains = board.filter((r) => r.model.cal_lo_usd <= r.model.p10_usd && r.model.cal_hi_usd >= r.model.p90_usd).length;
  return { board, model, validation, audit, cal_contains: calContains };
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_value_usd: row.model.fitted_value_usd,
    launch_odds: row.model.launch_odds,
    p10_usd: row.model.p10_usd,
    p90_usd: row.model.p90_usd,
    cal_lo_usd: row.model.cal_lo_usd,
    cal_hi_usd: row.model.cal_hi_usd,
    rank_low: row.model.rank_low,
    rank_high: row.model.rank_high,
    breakeven_odds: row.model.breakeven_odds,
    peers: row.model.peers,
    verdict: row.farm.verdict,
    capital_usd: row.farm.capital_usd,
    gas_total_usd: row.farm.gas_total_usd,
    breakeven_bps: row.farm.breakeven_bps,
    hours: row.farm.hours,
    usd_per_hour: row.farm.usd_per_hour,
    usd_per_hour_01pct: row.farm.usd_per_hour_01pct,
    usd_per_hour_10pct: row.farm.usd_per_hour_10pct,
    capture_breakeven_pct: row.farm.capture_breakeven_pct,
    capital_flip_usd: row.farm.capital_flip_usd,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; cal_contains: number } {
  const { board, model, validation, audit, cal_contains } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const dropped = validation.ablation.filter((a) => !a.kept).map((a) => a.term);
  const checks: RadarData['checks'] = [
    { label: 'Watchlist covered', detail: `${snapshot.watchlist.length} / ${snapshot.watchlist.length} watchlist protocols on the board`, pass: board.filter((r) => snapshot.watchlist.includes(r.slug)).length === snapshot.watchlist.length },
    { label: 'Audit adds to 758', detail: `${audit.ranked} ranked + ${audit.live_token} live-token + ${audit.excluded} excluded = ${audit.total}`, pass: audit.ranked + audit.live_token + audit.excluded === audit.total },
    { label: 'Size curve beats flat baseline (LOO)', detail: `median abs log error ${validation.selected.loo_median_abs_log_error} vs flat ${validation.ablation[0]!.loo_median_abs_log_error}`, pass: validation.selected.loo_median_abs_log_error < validation.ablation[0]!.loo_median_abs_log_error },
    { label: 'Odds beat base rate (LOO Brier)', detail: `Brier ${validation.odds.brier_loo} vs base ${validation.odds.base_brier}`, pass: validation.odds.brier_loo < validation.odds.base_brier },
    { label: 'Size elasticity kept, growth refused', detail: `+size kept; ${dropped.length} terms dropped (see the table below)`, pass: (validation.ablation.find((a) => a.term === '+size elasticity')?.kept ?? false) && dropped.length === validation.ablation.length - 2 },
    { label: 'Calibration band contains the bootstrap range', detail: `${cal_contains} / ${board.length} rows`, pass: cal_contains === board.length },
  ];
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    validation,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    audit,
    checks,
    watchlist_slugs: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, cal_contains };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
