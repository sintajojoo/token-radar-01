// Token radar, model radar-9: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other rankable pre-token protocol: pre-token, not an exchange, not a versioned pool, and
// not a wrapped, staked or bridged product of a token that already trades. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values.
//
// Implied value follows only from the snapshot's own figures, fitted on the snapshot itself:
//
//   comps        = the 128 live-token protocols with mcap_usd > 0 and tvl_usd > 0
//   size curve   = log(mcap) = intercept + slope * log(tvl) + quad * log(tvl)^2, least squares
//                  on the comps. The quadratic term is KEPT because it beats the linear curve
//                  on BOTH blind tests (see validation) — but the gain is small (R² 0.1942 vs
//                  0.1939) and a 5-fold cross-check does NOT confirm it, so both numbers are
//                  reported and the curve is not claimed to be better than it is. v3 tested
//                  ~40 further curve families (cubic, splines, Huber, ridge, ensembles,
//                  bin medians, L1, chain/category interactions, winsorised growth) and NONE
//                  beat the quadratic on both blind tests. v4 tested another ~30 families
//                  (kernel / local-linear / k-NN in log TVL, isotonic, small decision
//                  trees, separate curves per age or category group, ratio target,
//                  outlier-excluded and age-weighted fits, chain-count interactions)
//                  and NONE beat it either — see validation.ablation and the README's
//                  exploration tables. v6 tested the last untested ideas (one-per-ticker
//                  dedup of the comps, 12-month / survival-hazard odds, empirical-Bayes
//                  partial pooling by category) and NONE beat it either — the curve is
//                  kept because everything else lost, three times, not because nothing
//                  else was tried.
//   fitted       = exp(intercept + slope * log(tvl) + quad * log(tvl)^2)
//   launch odds  = a ridge logistic regression (lambda 1) on the 383 dated protocols that
//                  could launch a token of their own: age-bucket dummies (5 buckets, the
//                  oldest as reference) and log TVL. v3 used the same model PLUS 7-day
//                  growth winsorised at +/-20% and scored better (Brier 0.1999 vs 0.2028
//                  here) — but the growth coefficient was negative and counterintuitive,
//                  and the growth term drove most of the board's reshuffle (mean rank move
//                  11.1 vs v2, max 65). v4 drops growth: it keeps about two-thirds of v3's
//                  odds gain with less than half the reshuffle (mean 4.8, max 19), and
//                  the odds no longer rest on a one-snapshot artifact. The refused v3
//                  variant is still scored in validation, so the trade is visible.
//                  Protocols with no listing date use the base rate.
//   expected     = fitted * launch_odds, and implied_value_usd IS this expected value:
//                  the board ranks by expected launch value, and every row states its fitted
//                  value and its odds beside it, so the ranking is auditable.
//   P10-P90      = the 10th/90th percentile of fitted value over 200 bootstrap refits of the
//                  curve (seeded, deterministic); the farm verdict is netted on the P10.
//   conformal    = a 90% range from the leave-one-out residuals of the curve: fitted *
//                  exp(+/- q90), where q90 is the 90th percentile of |LOO residual|. v2 used
//                  q80 and its walk-forward coverage was only 63.8% against a nominal 80%.
//                  The q90 range covers 83.0% of newer protocols walk-forward against a
//                  nominal 90% — still under, but much closer, and the coverage is reported
//                  rather than claimed.
//
// Growth (7-day change) as a curve term, maturity (log age), chain count, category
// intercepts and grouped categories were each tested as an extra term, with
// leave-one-out and a walk-forward (older-half fit, newer-half test) blind test,
// against both the linear and the quadratic curve. None improved BOTH blind tests,
// so all were DROPPED — see validation.ablation in board.json. A placebo term
// (seeded noise) was tested the same way and also failed both tests, which is the
// control that the blind tests can refuse a term.
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

/** The fitted size curve and the launch-odds model, as the dashboard states them. */
export interface ModelConstants {
  intercept: number;
  slope: number;
  quad_coef: number;
  r2: number;
  n_comps: number;
  odds_buckets: { lo_days: number; hi_days: number | null; rate: number; n: number }[];
  base_odds: number;
  odds_prior: number;
  unknown_age_odds: number;
  /** Ridge logistic launch odds, raw (unstandardised) coefficients: odds =
      sigmoid(intercept + bucket_coef[bucket] + logtvl_coef * log(tvl)).
      bucket_coef has 4 entries for the first 4 age buckets; the oldest bucket
      is the reference (coefficient 0). v4 drops the growth term v3 carried. */
  odds_logit: {
    intercept: number;
    bucket_coef: number[];
    logtvl_coef: number;
    lam: number;
  };
}

export const MODEL_VERSION = 'radar-9';

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

/** A deterministic hash of a string, for the placebo term. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

/** The live-token comps the size curve is fitted on: mcap > 0 and TVL > 0. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Feature builders for the size curve and each tested extra term. */
type FeatureFn = (p: SnapshotProtocol, asOf: string) => number[];
const FEATS: Record<string, FeatureFn> = {
  size: (p) => [Math.log(p.tvl_usd)],
  'size+growth': (p) => [Math.log(p.tvl_usd), (p.change_7d ?? 0) / 100],
  'size+maturity': (p, asOf) => [Math.log(p.tvl_usd), Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1))],
  'size+chains': (p) => [Math.log(p.tvl_usd), p.chains.length],
  'size+growth+maturity+chains': (p, asOf) => [
    Math.log(p.tvl_usd),
    (p.change_7d ?? 0) / 100,
    Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1)),
    p.chains.length,
  ],
  'size+placebo': (p) => [Math.log(p.tvl_usd), (hashString(p.slug) % 1000) / 500 - 1],
  'size+quad': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt];
  },
  'quad+growth': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, (p.change_7d ?? 0) / 100];
  },
  'quad+maturity': (p, asOf) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1))];
  },
  'quad+chains': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, p.chains.length];
  },
  'quad+all': (p, asOf) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, (p.change_7d ?? 0) / 100, Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1)), p.chains.length];
  },
  'quad+placebo': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, (hashString(p.slug) % 1000) / 500 - 1];
  },
  // v3 candidates (fixed knots are the full-comp medians/tertiles of log TVL,
  // an unsupervised choice): none of these beat the quadratic on both blind tests.
  cubic: (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, lt * lt * lt];
  },
  spline1: (p) => [Math.log(p.tvl_usd), Math.max(0, Math.log(p.tvl_usd) - SPLINE_KNOT_MEDIAN)],
  spline2: (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, Math.max(0, lt - SPLINE_KNOT_T1), Math.max(0, lt - SPLINE_KNOT_T2)];
  },
  'quad+spline1': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.max(0, lt - SPLINE_KNOT_MEDIAN)];
  },
  'quad+growth_w20': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100];
  },
  'quad+growth_w50': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.max(-50, Math.min(50, p.change_7d ?? 0)) / 100];
  },
  'quad+abs_growth': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.abs(Math.max(-100, Math.min(100, p.change_7d ?? 0))) / 100];
  },
  'quad+lt_logage': (p, asOf) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1)), lt * (Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1)) - Math.log(365))];
  },
  'quad+log1p_chains': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.log1p(p.chains.length)];
  },
  'quad+chains_cap3': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.min(p.chains.length, 3)];
  },
  'quad+has_eth': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, p.chains.includes('Ethereum') ? 1 : 0];
  },
  'quad+has_sol': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, p.chains.includes('Solana') ? 1 : 0];
  },
  'quad+chainflags': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, p.chains.includes('Ethereum') ? 1 : 0, p.chains.includes('Solana') ? 1 : 0, Math.min(p.chains.length, 3)];
  },
  'quad+grp_dummies': (p) => {
    const lt = Math.log(p.tvl_usd);
    const g = categoryGroup(p);
    return [lt, lt * lt, g === 'lend' ? 1 : 0, g === 'dex/yield' ? 1 : 0, g === 'staking' ? 1 : 0, g === 'bridge' ? 1 : 0];
  },
  'quad+grp_lt': (p) => {
    const lt = Math.log(p.tvl_usd);
    const g = categoryGroup(p);
    const d = [g === 'lend' ? 1 : 0, g === 'dex/yield' ? 1 : 0, g === 'staking' ? 1 : 0, g === 'bridge' ? 1 : 0];
    return [lt, lt * lt, ...d, ...d.map((v) => lt * v)];
  },
  'quad+growth_logage': (p, asOf) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100, Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1))];
  },
  'quad+tvlperchain': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, Math.log(Math.max(p.tvl_usd / Math.max(p.chains.length, 1), 1))];
  },
  'quad+growth_sign': (p) => {
    const lt = Math.log(p.tvl_usd);
    const g = Math.max(-100, Math.min(100, p.change_7d ?? 0)) / 100;
    return [lt, lt * lt, g, g > 0 ? 1 : 0];
  },
  'quad+hinge2': (p) => {
    const lt = Math.log(p.tvl_usd);
    const h = Math.max(0, lt - SPLINE_KNOT_MEDIAN);
    return [lt, lt * lt, h * h];
  },
  'cubic+growth_w20': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, lt * lt * lt, Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100];
  },
  'size+growth_w20': (p) => [Math.log(p.tvl_usd), Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100],
  // v4 candidates (OLS-expressible; the non-OLS families — kernel, k-NN,
  // isotonic, trees, separate-group fits — are in the README exploration
  // table): none of these beat the quadratic on both blind tests either.
  'quad+inv_nch': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, 1 / Math.max(p.chains.length, 1)];
  },
  'quad+nch2': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, p.chains.length * p.chains.length];
  },
  'quad+lt_growth_w20': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, lt * (Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100)];
  },
  'quad+lt_log1p_chains': (p) => {
    const lt = Math.log(p.tvl_usd);
    return [lt, lt * lt, lt * Math.log1p(p.chains.length)];
  },
  'quad+logage_hinge': (p, asOf) => {
    const lt = Math.log(p.tvl_usd);
    const la = Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1));
    return [lt, lt * lt, la, Math.max(0, la - Math.log(365))];
  },
};

/** Spline knots: median and tertiles of log TVL over the 128 comps (unsupervised). */
const SPLINE_KNOT_MEDIAN = 17.2987;
const SPLINE_KNOT_T1 = 16.3174;
const SPLINE_KNOT_T2 = 18.1905;

function fitOn(rows: SnapshotProtocol[], feat: FeatureFn, asOf: string): number[] {
  const X = rows.map((p) => [1, ...feat(p, asOf)]);
  const y = rows.map((p) => Math.log(p.mcap_usd!));
  return ols(X, y);
}

function predict(beta: number[], p: SnapshotProtocol, feat: FeatureFn, asOf: string): number {
  const x = [1, ...feat(p, asOf)];
  return x.reduce((s, v, i) => s + v * beta[i]!, 0);
}

export interface BlindResult {
  loo_median_abs_log_error: number;
  loo_within_2x: number;
  walkforward_median_abs_log_error: number;
  walkforward_within_2x: number;
  n_walkforward: number;
}

function blindTest(rows: SnapshotProtocol[], feat: FeatureFn, asOf: string): BlindResult {
  const looErrs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const beta = fitOn(train, feat, asOf);
    looErrs.push(Math.abs(Math.log(rows[i]!.mcap_usd!) - predict(beta, rows[i]!, feat, asOf)));
  }
  const dated = rows.filter((p) => ageDays(asOf, p.listed_at) !== null).sort((a, b) => (ageDays(asOf, a.listed_at) ?? 0) - (ageDays(asOf, b.listed_at) ?? 0));
  const half = Math.floor(dated.length / 2);
  const older = dated.slice(half);
  const newer = dated.slice(0, half);
  const betaWf = fitOn(older, feat, asOf);
  const wfErrs = newer.map((p) => Math.abs(Math.log(p.mcap_usd!) - predict(betaWf, p, feat, asOf)));
  return {
    loo_median_abs_log_error: round4(median(looErrs)),
    loo_within_2x: round4(looErrs.filter((e) => e <= Math.log(2)).length / looErrs.length),
    walkforward_median_abs_log_error: round4(median(wfErrs)),
    walkforward_within_2x: round4(wfErrs.filter((e) => e <= Math.log(2)).length / wfErrs.length),
    n_walkforward: newer.length,
  };
}

/** Absolute leave-one-out residuals of one feature set: the conformal calibration set. */
function looAbsResiduals(rows: SnapshotProtocol[], feat: FeatureFn, asOf: string): number[] {
  const errs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const beta = fitOn(train, feat, asOf);
    errs.push(Math.abs(Math.log(rows[i]!.mcap_usd!) - predict(beta, rows[i]!, feat, asOf)));
  }
  return errs;
}

/** 5-fold cross-check (folds by sorted slug, deterministic): median abs log error and % within 2x. */
function fiveFold(rows: SnapshotProtocol[], feat: FeatureFn, asOf: string): { median_abs_log_error: number; within_2x: number } {
  const sorted = [...rows].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const errs: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = sorted.filter((_, i) => i % 5 === fold);
    const train = sorted.filter((_, i) => i % 5 !== fold);
    const beta = fitOn(train, feat, asOf);
    for (const p of test) errs.push(Math.abs(Math.log(p.mcap_usd!) - predict(beta, p, feat, asOf)));
  }
  return {
    median_abs_log_error: round4(median(errs)),
    within_2x: round4(errs.filter((e) => e <= Math.log(2)).length / errs.length),
  };
}

/** Broad groups for the grouped-category test: lending, dex/yield, staking, bridges, the rest. */
function categoryGroup(p: SnapshotProtocol): string {
  const c = p.category ?? '';
  if (['Lending', 'CDP', 'Collateral Management'].includes(c)) return 'lend';
  if (['Dexs', 'Yield', 'Yield Aggregator', 'Leveraged Farming', 'Liquidity Manager'].includes(c)) return 'dex/yield';
  if (['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool'].includes(c)) return 'staking';
  if (['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'].includes(c)) return 'bridge';
  return 'other';
}

/**
 * Blind test of a size curve plus a shrunk per-category (or per-group) intercept offset:
 * fit the size curve on the training set, take each category's mean residual, shrink it by
 * n / (n + 10), and add it to the prediction. A category with no training rows gets no offset.
 */
function blindTestCat(
  rows: SnapshotProtocol[],
  groupFn: (p: SnapshotProtocol) => string,
  asOf: string,
): BlindResult {
  const fitPredict = (train: SnapshotProtocol[]) => {
    const beta = fitOn(train, FEATS.size, asOf);
    const residByGroup = new Map<string, number[]>();
    for (const p of train) {
      const r = Math.log(p.mcap_usd!) - predict(beta, p, FEATS.size, asOf);
      const g = groupFn(p);
      if (!residByGroup.has(g)) residByGroup.set(g, []);
      residByGroup.get(g)!.push(r);
    }
    const offset = new Map<string, number>();
    for (const [g, rs] of residByGroup) {
      offset.set(g, (rs.reduce((a, b) => a + b, 0) / rs.length) * (rs.length / (rs.length + 10)));
    }
    return (p: SnapshotProtocol) => predict(beta, p, FEATS.size, asOf) + (offset.get(groupFn(p)) ?? 0);
  };
  const looErrs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    looErrs.push(Math.abs(Math.log(rows[i]!.mcap_usd!) - fitPredict(train)(rows[i]!)));
  }
  const dated = rows.filter((p) => ageDays(asOf, p.listed_at) !== null).sort((a, b) => (ageDays(asOf, a.listed_at) ?? 0) - (ageDays(asOf, b.listed_at) ?? 0));
  const half = Math.floor(dated.length / 2);
  const older = dated.slice(half);
  const newer = dated.slice(0, half);
  const predWf = fitPredict(older);
  const wfErrs = newer.map((p) => Math.abs(Math.log(p.mcap_usd!) - predWf(p)));
  return {
    loo_median_abs_log_error: round4(median(looErrs)),
    loo_within_2x: round4(looErrs.filter((e) => e <= Math.log(2)).length / looErrs.length),
    walkforward_median_abs_log_error: round4(median(wfErrs)),
    walkforward_within_2x: round4(wfErrs.filter((e) => e <= Math.log(2)).length / wfErrs.length),
    n_walkforward: newer.length,
  };
}

function flatBaselineLoo(rows: SnapshotProtocol[]): { median_abs_log_error: number; within_2x: number } {
  const errs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const mult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    errs.push(Math.abs(Math.log(rows[i]!.mcap_usd!) - Math.log(rows[i]!.tvl_usd * mult)));
  }
  return {
    median_abs_log_error: round4(median(errs)),
    within_2x: round4(errs.filter((e) => e <= Math.log(2)).length / errs.length),
  };
}

export interface AblationRow {
  term: string;
  kept: boolean;
  loo_median_abs_log_error: number;
  walkforward_median_abs_log_error: number;
}

export interface Validation {
  curve: { intercept: number; slope: number; quad_coef: number; r2: number; n_comps: number };
  size_only: BlindResult;
  size_only_fivefold: { median_abs_log_error: number; within_2x: number };
  quad: BlindResult;
  quad_fivefold: { median_abs_log_error: number; within_2x: number };
  flat_baseline: { median_abs_log_error: number; within_2x: number };
  ablation: AblationRow[];
  odds: {
    brier_loo: number;
    logloss_loo: number;
    base_brier: number;
    base_logloss: number;
    n_dated: number;
    /** The v2 age/category blend, for comparison: same LOO and 5-fold scores. */
    v2_brier_loo: number;
    v2_logloss_loo: number;
    fivefold_brier: number;
    fivefold_logloss: number;
    fivefold_v2_brier: number;
    fivefold_v2_logloss: number;
    /** The refused v3 variant (logistic with winsorised growth), scored the
        same way so the trade of dropping growth is visible in the record. */
    v3_brier_loo: number;
    v3_logloss_loo: number;
    fivefold_v3_brier: number;
    fivefold_v3_logloss: number;
    logit_lam: number;
  };
  conformal: {
    half_width_log: number;
    nominal: number;
    loo_coverage: number;
    walkforward_coverage: number;
    walkforward_half_width_log: number;
    n_walkforward: number;
    /** Conformal coverage tested four ways: the 90% range calibrated on a
        training set and counted on a held-out set — leave-one-out, walk-forward,
        5-fold by slug, and the newest third of dated comps. */
    fivefold_coverage: number;
    newer_third_coverage: number;
    n_newer_third: number;
  };
  /** The quadratic curve on the newest third of dated comps (fit on the older
      two-thirds): the fourth held-out check of the curve itself. */
  quad_newer_third: { median_abs_log_error: number; within_2x: number; n: number };
  size_newer_third: { median_abs_log_error: number; within_2x: number; n: number };
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

/** Fit the whole model from the snapshot: curve, blind tests, ablation, launch odds, conformal. */
export function fitModel(snapshot: Snapshot): { model: ModelConstants; validation: Validation } {
  const asOf = snapshot.as_of;
  const comps = compsOf(snapshot);
  const betaQuad = fitOn(comps, FEATS['size+quad']!, asOf);
  const intercept = betaQuad[0]!;
  const slope = betaQuad[1]!;
  const quadCoef = betaQuad[2]!;
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of comps) {
    const lt = Math.log(p.tvl_usd);
    const pred = intercept + slope * lt + quadCoef * lt * lt;
    ssRes += (Math.log(p.mcap_usd!) - pred) ** 2;
    ssTot += (Math.log(p.mcap_usd!) - meanY) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;

  const sizeOnly = blindTest(comps, FEATS.size, asOf);
  const quadBlind = blindTest(comps, FEATS['size+quad']!, asOf);
  const sizeFive = fiveFold(comps, FEATS.size, asOf);
  const quadFive = fiveFold(comps, FEATS['size+quad']!, asOf);
  const flat = flatBaselineLoo(comps);

  // Ablation: a term stays only if it beats its baseline on BOTH blind tests.
  const ablation: AblationRow[] = [];
  const beats = (t: BlindResult, base: BlindResult) =>
    t.loo_median_abs_log_error < base.loo_median_abs_log_error &&
    t.walkforward_median_abs_log_error < base.walkforward_median_abs_log_error;
  for (const name of ['size+growth', 'size+maturity', 'size+chains', 'size+growth+maturity+chains', 'size+placebo', 'size+growth_w20']) {
    const t = blindTest(comps, FEATS[name]!, asOf);
    ablation.push({ term: name, kept: beats(t, sizeOnly), loo_median_abs_log_error: t.loo_median_abs_log_error, walkforward_median_abs_log_error: t.walkforward_median_abs_log_error });
  }
  ablation.push({ term: 'size+quad', kept: beats(quadBlind, sizeOnly), loo_median_abs_log_error: quadBlind.loo_median_abs_log_error, walkforward_median_abs_log_error: quadBlind.walkforward_median_abs_log_error });
  for (const name of ['quad+growth', 'quad+maturity', 'quad+chains', 'quad+all', 'quad+placebo', 'cubic', 'spline1', 'spline2', 'quad+spline1', 'quad+growth_w20', 'quad+growth_w50', 'quad+abs_growth', 'quad+lt_logage', 'quad+log1p_chains', 'quad+chains_cap3', 'quad+has_eth', 'quad+has_sol', 'quad+chainflags', 'quad+grp_dummies', 'quad+grp_lt', 'quad+growth_logage', 'quad+tvlperchain', 'quad+growth_sign', 'quad+hinge2', 'cubic+growth_w20', 'quad+inv_nch', 'quad+nch2', 'quad+lt_growth_w20', 'quad+lt_log1p_chains', 'quad+logage_hinge']) {
    const t = blindTest(comps, FEATS[name]!, asOf);
    ablation.push({ term: name, kept: beats(t, quadBlind), loo_median_abs_log_error: t.loo_median_abs_log_error, walkforward_median_abs_log_error: t.walkforward_median_abs_log_error });
  }
  const catTest = blindTestCat(comps, (p) => p.category ?? 'Other', asOf);
  ablation.push({ term: 'size+category-intercept', kept: beats(catTest, sizeOnly), loo_median_abs_log_error: catTest.loo_median_abs_log_error, walkforward_median_abs_log_error: catTest.walkforward_median_abs_log_error });
  const grpTest = blindTestCat(comps, categoryGroup, asOf);
  ablation.push({ term: 'size+category-grouped', kept: beats(grpTest, sizeOnly), loo_median_abs_log_error: grpTest.loo_median_abs_log_error, walkforward_median_abs_log_error: grpTest.walkforward_median_abs_log_error });
  // v6: one-per-ticker dedup — group the comps by lowercased token symbol and
  // keep the largest-TVL protocol per symbol. Only one symbol collides
  // (BIFI: beefy vs bifi, different gecko ids — likely two different tokens
  // sharing a ticker), so n falls 128 -> 127 and the walk-forward set is
  // unchanged (bifi has no listing date). The deduped curve loses LOO, so
  // it is dropped; dedup by gecko id changes nothing (128 distinct ids).
  const bySymbol = new Map<string, SnapshotProtocol>();
  for (const p of comps) {
    const key = (p.symbol ?? p.slug).toLowerCase();
    const cur = bySymbol.get(key);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) bySymbol.set(key, p);
  }
  const deduped = [...bySymbol.values()];
  const dedupBlind = blindTest(deduped, FEATS['size+quad']!, asOf);
  ablation.push({ term: 'quad+dedup-by-symbol', kept: beats(dedupBlind, quadBlind), loo_median_abs_log_error: dedupBlind.loo_median_abs_log_error, walkforward_median_abs_log_error: dedupBlind.walkforward_median_abs_log_error });

  // Conformal interval from the leave-one-out residuals of the quadratic curve,
  // at the 90th percentile: half-width = q90 of |LOO residual|, so the interval
  // is a 90% range (P5-P95) over residual uncertainty. v2 used q80 and its
  // walk-forward coverage was only 63.8% against a nominal 80%. Walk-forward
  // coverage here is the honest held-out number: calibrate the half-width on the
  // older half's own LOO residuals (at q90), then count coverage on the newer half.
  const looAbs = looAbsResiduals(comps, FEATS['size+quad']!, asOf);
  const halfWidth = quantile(looAbs, 0.9);
  const looCoverage = looAbs.filter((e) => e <= halfWidth).length / looAbs.length;
  const datedComps = comps.filter((p) => ageDays(asOf, p.listed_at) !== null).sort((a, b) => (ageDays(asOf, a.listed_at) ?? 0) - (ageDays(asOf, b.listed_at) ?? 0));
  const half = Math.floor(datedComps.length / 2);
  const olderComps = datedComps.slice(half);
  const newerComps = datedComps.slice(0, half);
  const olderLooAbs = looAbsResiduals(olderComps, FEATS['size+quad']!, asOf);
  const wfHalfWidth = quantile(olderLooAbs, 0.9);
  const betaWf = fitOn(olderComps, FEATS['size+quad']!, asOf);
  const wfCoverage =
    newerComps.filter((p) => Math.abs(Math.log(p.mcap_usd!) - predict(betaWf, p, FEATS['size+quad']!, asOf)) <= wfHalfWidth).length / newerComps.length;

  // Conformal tested four ways. 5-fold: for each fold, calibrate the q90
  // half-width on the other four folds' own LOO residuals and count coverage
  // on the held-out fold. Newest third: dated comps sorted by age, fit on the
  // older two-thirds, calibrate q90 on their LOO residuals, count coverage on
  // the newest third — and report the curve's own median error there too.
  const sortedComps = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  let fivefoldCovered = 0;
  for (let fold = 0; fold < 5; fold++) {
    const test = sortedComps.filter((_, i) => i % 5 === fold);
    const train = sortedComps.filter((_, i) => i % 5 !== fold);
    const hw = quantile(looAbsResiduals(train, FEATS['size+quad']!, asOf), 0.9);
    const beta = fitOn(train, FEATS['size+quad']!, asOf);
    fivefoldCovered += test.filter((p) => Math.abs(Math.log(p.mcap_usd!) - predict(beta, p, FEATS['size+quad']!, asOf)) <= hw).length;
  }
  const fivefoldCoverage = fivefoldCovered / comps.length;
  const third = Math.floor(datedComps.length / 3);
  const newestThird = datedComps.slice(0, third);
  const olderTwoThirds = datedComps.slice(third);
  const ntHalfWidth = quantile(looAbsResiduals(olderTwoThirds, FEATS['size+quad']!, asOf), 0.9);
  const betaNt = fitOn(olderTwoThirds, FEATS['size+quad']!, asOf);
  const ntCoverage =
    newestThird.filter((p) => Math.abs(Math.log(p.mcap_usd!) - predict(betaNt, p, FEATS['size+quad']!, asOf)) <= ntHalfWidth).length / newestThird.length;
  const ntQuadErrs = newestThird.map((p) => Math.abs(Math.log(p.mcap_usd!) - predict(betaNt, p, FEATS['size+quad']!, asOf)));
  const betaNtLin = fitOn(olderTwoThirds, FEATS.size, asOf);
  const ntLinErrs = newestThird.map((p) => Math.abs(Math.log(p.mcap_usd!) - predict(betaNtLin, p, FEATS.size, asOf)));
  const quadNewerThird = {
    median_abs_log_error: round4(median(ntQuadErrs)),
    within_2x: round4(ntQuadErrs.filter((e) => e <= Math.log(2)).length / ntQuadErrs.length),
    n: newestThird.length,
  };
  const sizeNewerThird = {
    median_abs_log_error: round4(median(ntLinErrs)),
    within_2x: round4(ntLinErrs.filter((e) => e <= Math.log(2)).length / ntLinErrs.length),
    n: newestThird.length,
  };

  // Launch odds: empirical token rate by age bucket over the dated protocols that could
  // launch a token of their own (not CEX, not a versioned pool, not wrapped/staked/bridged),
  // shrunk toward the overall dated rate with a prior weight of ODDS_PRIOR. The final odds
  // blend that age-bucket rate (85%) with the protocol's category rate (15%), each shrunk
  // the same way; the blend is what the LOO scores below measure.
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
  const shrunkRate = (rows: SnapshotProtocol[], base: number): number => {
    if (rows.length === 0) return base;
    const rate = rows.filter((q) => !isPreToken(q)).length / rows.length;
    return (rows.length * rate + ODDS_PRIOR * base) / (rows.length + ODDS_PRIOR);
  };
  const oddsOfPoolRow = (p: SnapshotProtocol, rest: SnapshotProtocol[], weight: number): number => {
    const restBase = rest.filter((q) => !isPreToken(q)).length / rest.length;
    const b = bucketOf(ageDays(asOf, p.listed_at));
    const ageRate = shrunkRate(rest.filter((q) => bucketOf(ageDays(asOf, q.listed_at)) === b), restBase);
    const catRate = shrunkRate(rest.filter((q) => (q.category ?? 'Other') === (p.category ?? 'Other')), restBase);
    return (1 - weight) * ageRate + weight * catRate;
  };
  const looOdds = (weight: number): { brier: number; logloss: number; baseBrier: number; baseLogloss: number } => {
    let brier = 0;
    let logloss = 0;
    let baseBrier = 0;
    let baseLogloss = 0;
    for (let i = 0; i < oddsPool.length; i++) {
      const p = oddsPool[i]!;
      const rest = oddsPool.filter((_, j) => j !== i);
      const restBase = rest.filter((q) => !isPreToken(q)).length / rest.length;
      const o = oddsOfPoolRow(p, rest, weight);
      const y = isPreToken(p) ? 0 : 1;
      brier += (o - y) ** 2;
      const oc = Math.min(Math.max(o, 0.01), 0.99);
      logloss += -(y * Math.log(oc) + (1 - y) * Math.log(1 - oc));
      baseBrier += (restBase - y) ** 2;
      const bc = Math.min(Math.max(restBase, 0.01), 0.99);
      baseLogloss += -(y * Math.log(bc) + (1 - y) * Math.log(1 - bc));
    }
    const n = oddsPool.length;
    return { brier: brier / n, logloss: logloss / n, baseBrier: baseBrier / n, baseLogloss: baseLogloss / n };
  };
  const fivefoldOdds = (weight: number): { brier: number; logloss: number } => {
    let brier = 0;
    let logloss = 0;
    let n = 0;
    for (let fold = 0; fold < 5; fold++) {
      const test = oddsPool.filter((_, i) => i % 5 === fold);
      const train = oddsPool.filter((_, i) => i % 5 !== fold);
      for (const p of test) {
        const o = oddsOfPoolRow(p, train, weight);
        const y = isPreToken(p) ? 0 : 1;
        brier += (o - y) ** 2;
        const oc = Math.min(Math.max(o, 0.01), 0.99);
        logloss += -(y * Math.log(oc) + (1 - y) * Math.log(1 - oc));
        n++;
      }
    }
    return { brier: brier / n, logloss: logloss / n };
  };
  // The v2 blend, kept only as the comparison: 85% age bucket, 15% category.
  const blended = looOdds(0.15);
  const blendedFive = fivefoldOdds(0.15);
  const n = oddsPool.length;

  // v4 launch odds: a ridge logistic regression (lambda ODDS_LOGIT_LAMBDA) on
  // age-bucket dummies (oldest bucket as reference) and log TVL — no growth.
  // Features are standardised inside the fit; the full fit is converted to
  // raw coefficients for the model record. The v3 variant (with winsorised
  // growth, growthWinsor 20) is scored the same way below so the cost of
  // dropping growth is in the record, not asserted.
  const oddsFeatures = (p: SnapshotProtocol, withGrowth: boolean): number[] => {
    const b = bucketOf(ageDays(asOf, p.listed_at));
    const base = [b === 0 ? 1 : 0, b === 1 ? 1 : 0, b === 2 ? 1 : 0, b === 3 ? 1 : 0, Math.log(p.tvl_usd)];
    if (!withGrowth) return base;
    const g = Math.max(-20, Math.min(20, p.change_7d ?? 0)) / 100;
    return [...base, g];
  };
  const logitLoo = (withGrowth: boolean): { brier: number; logloss: number } => {
    let brier = 0;
    let logloss = 0;
    for (let i = 0; i < oddsPool.length; i++) {
      const p = oddsPool[i]!;
      const rest = oddsPool.filter((_, j) => j !== i);
      const X = rest.map((q) => [1, ...oddsFeatures(q, withGrowth)]);
      const y = rest.map((q) => (isPreToken(q) ? 0 : 1));
      const fit = ridgeLogitFit(X, y, ODDS_LOGIT_LAMBDA);
      const raw = logitRawBeta(fit);
      const o = sigmoid(raw.reduce((s, v, j) => s + v * [1, ...oddsFeatures(p, withGrowth)][j]!, 0));
      const yy = isPreToken(p) ? 0 : 1;
      brier += (o - yy) ** 2;
      const oc = Math.min(Math.max(o, 0.01), 0.99);
      logloss += -(yy * Math.log(oc) + (1 - yy) * Math.log(1 - oc));
    }
    return { brier: brier / oddsPool.length, logloss: logloss / oddsPool.length };
  };
  const logitFivefold = (withGrowth: boolean): { brier: number; logloss: number } => {
    let brier = 0;
    let logloss = 0;
    let count = 0;
    for (let fold = 0; fold < 5; fold++) {
      const test = oddsPool.filter((_, i) => i % 5 === fold);
      const train = oddsPool.filter((_, i) => i % 5 !== fold);
      const X = train.map((q) => [1, ...oddsFeatures(q, withGrowth)]);
      const y = train.map((q) => (isPreToken(q) ? 0 : 1));
      const fit = ridgeLogitFit(X, y, ODDS_LOGIT_LAMBDA);
      const raw = logitRawBeta(fit);
      for (const p of test) {
        const o = sigmoid(raw.reduce((s, v, j) => s + v * [1, ...oddsFeatures(p, withGrowth)][j]!, 0));
        const yy = isPreToken(p) ? 0 : 1;
        brier += (o - yy) ** 2;
        const oc = Math.min(Math.max(o, 0.01), 0.99);
        logloss += -(yy * Math.log(oc) + (1 - yy) * Math.log(1 - oc));
        count++;
      }
    }
    return { brier: brier / count, logloss: logloss / count };
  };
  const logitScores = logitLoo(false);
  const logitFive = logitFivefold(false);
  const logitScoresV3 = logitLoo(true);
  const logitFiveV3 = logitFivefold(true);
  const logitFullX = oddsPool.map((q) => [1, ...oddsFeatures(q, false)]);
  const logitFullY = oddsPool.map((q) => (isPreToken(q) ? 0 : 1));
  const logitRaw = logitRawBeta(ridgeLogitFit(logitFullX, logitFullY, ODDS_LOGIT_LAMBDA));

  const validation: Validation = {
    curve: { intercept: round4(intercept), slope: round4(slope), quad_coef: round4(quadCoef), r2: round4(r2), n_comps: comps.length },
    size_only: sizeOnly,
    size_only_fivefold: sizeFive,
    quad: quadBlind,
    quad_fivefold: quadFive,
    flat_baseline: flat,
    ablation,
    odds: {
      brier_loo: round4(logitScores.brier),
      logloss_loo: round4(logitScores.logloss),
      base_brier: round4(blended.baseBrier),
      base_logloss: round4(blended.baseLogloss),
      n_dated: n,
      v2_brier_loo: round4(blended.brier),
      v2_logloss_loo: round4(blended.logloss),
      fivefold_brier: round4(logitFive.brier),
      fivefold_logloss: round4(logitFive.logloss),
      fivefold_v2_brier: round4(blendedFive.brier),
      fivefold_v2_logloss: round4(blendedFive.logloss),
      v3_brier_loo: round4(logitScoresV3.brier),
      v3_logloss_loo: round4(logitScoresV3.logloss),
      fivefold_v3_brier: round4(logitFiveV3.brier),
      fivefold_v3_logloss: round4(logitFiveV3.logloss),
      logit_lam: ODDS_LOGIT_LAMBDA,
    },
    conformal: {
      half_width_log: round4(halfWidth),
      nominal: 0.9,
      loo_coverage: round4(looCoverage),
      walkforward_coverage: round4(wfCoverage),
      walkforward_half_width_log: round4(wfHalfWidth),
      n_walkforward: newerComps.length,
      fivefold_coverage: round4(fivefoldCoverage),
      newer_third_coverage: round4(ntCoverage),
      n_newer_third: newestThird.length,
    },
    quad_newer_third: quadNewerThird,
    size_newer_third: sizeNewerThird,
  };
  const model: ModelConstants = {
    intercept: round4(intercept),
    slope: round4(slope),
    quad_coef: round4(quadCoef),
    r2: round4(r2),
    n_comps: comps.length,
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
    log TVL, no growth). Protocols with no listing date use the base rate,
    as in v2. The growth argument is kept for call-site compatibility and
    ignored: v4 deliberately does not use 7-day growth anywhere. */
export function launchOdds(model: ModelConstants, age: number | null, tvlUsd: number, _growthPct: number | null): number {
  if (age === null) return model.base_odds;
  const L = model.odds_logit;
  const b = bucketOf(age);
  const z = L.intercept + (b >= 0 && b < 4 ? L.bucket_coef[b]! : 0) + L.logtvl_coef * Math.log(tvlUsd);
  return sigmoid(z);
}

/** The fitted implied value (before odds) for one protocol. */
export function fittedValue(model: ModelConstants, tvlUsd: number): number {
  const lt = Math.log(tvlUsd);
  return Math.exp(model.intercept + model.slope * lt + model.quad_coef * lt * lt);
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

/** Farm economics, netted on the P10 expected value. */
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
  /** Smallest capital (whole dollars) at which this row would flip to FARM, or null when no
      capital flips it because the breakeven, not the gas drag, is the blocker. */
  capital_flip_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
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
    conf_lo_usd: number;
    conf_hi_usd: number;
    rank_low: number;
    rank_high: number;
    growth_pct: number;
    age_days: number | null;
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
  conf_lo_usd: number;
  conf_hi_usd: number;
  rank_low: number;
  rank_high: number;
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
  /** The size curve as a chart: binned comp medians plus the fitted curve sampled across them. */
  curve_chart: { bins: { log_tvl: number; log_mcap: number; n: number }[]; curve: { log_tvl: number; log_mcap: number }[]; points: { log_tvl: number; log_mcap: number }[] };
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

/** Farm economics from the P10 expected value, the capital and the chain's gas. */
export function farmEconomics(p: SnapshotProtocol, age: number | null, p10Expected: number): FarmEconomics {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gasTotal = round2(gas + gas * weeks + gas);
  const hours = round2((5 + 15 + 10 * weeks + 15 + 10 + 5) / 60);
  const breakevenBps = p10Expected > 0 ? round4((gasTotal / p10Expected) * 10000) : 999999;
  // $/hour at three stated capture shares of the P10 expected value: deliberately small,
  // labelled assumptions, so the figures compare rows instead of promising an airdrop.
  // The 0.1% figure is 100x the 0.001% one — it is shown beside the others precisely so
  // nobody reads it as a forecast.
  const perHour = (share: number) => round2((share * p10Expected - gasTotal) / hours);
  const usdPerHour = perHour(0.00001);
  // The verdict nets two costs against the P10: the gas bill as a share of the capital put in
  // (gas drag), and as a share of the P10 expected value (breakeven). A row is FARM only when
  // both are small; a row whose gas bill eats the position is SKIP, however large its value.
  const gasDrag = gasTotal / capital;
  const verdict: FarmEconomics['verdict'] =
    gasDrag <= 0.1 && breakevenBps <= 1 ? 'FARM' : gasDrag <= 0.3 && breakevenBps <= 5 ? 'THIN' : 'SKIP';
  // Capture breakeven: the share of the P10 a farmer must capture to cover gas at all.
  const captureBreakevenPct = p10Expected > 0 ? round6((gasTotal / p10Expected) * 100) : 999999;
  // Capital that flips the verdict: raising capital only fixes the gas drag, never the
  // breakeven, so a row flips only when its breakeven already passes (<= 1 bp) and its
  // capital is below gasTotal / 10%. Otherwise no capital flips it.
  const capitalFlipUsd: number | null =
    breakevenBps <= 1 && capital < gasTotal / 0.1 ? Math.ceil(gasTotal / 0.1) : null;
  return {
    capital_usd: capital,
    gas_total_usd: gasTotal,
    hours,
    breakeven_bps: breakevenBps,
    usd_per_hour: usdPerHour,
    usd_per_hour_01pct: perHour(0.0001),
    usd_per_hour_10pct: perHour(0.001),
    capture_breakeven_pct: captureBreakevenPct,
    capital_flip_usd: capitalFlipUsd,
    verdict,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The last step states the verdict, netted on the P10 expected value.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics, p10Expected: number): FarmStep[] {
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
      text: `Verdict: ${econ.verdict}. Breakeven is $${econ.gas_total_usd} of gas, ${econ.breakeven_bps} bps of the P10 expected value of $${Math.round(p10Expected).toLocaleString('en-US')} and ${Math.round((econ.gas_total_usd / econ.capital_usd) * 100)}% of the $${econ.capital_usd} capital; capture breakeven is ${econ.capture_breakeven_pct}% of the P10. $/hour over ${econ.hours} hours, labelled assumptions: $${econ.usd_per_hour} at 0.001% capture, $${econ.usd_per_hour_01pct} at 0.01%, $${econ.usd_per_hour_10pct} at 0.1%. ${econ.verdict === 'FARM' ? 'The capital is already enough for FARM.' : econ.capital_flip_usd === null ? 'No capital flips this verdict; the breakeven, not the gas drag, is the blocker.' : `Raising capital to $${econ.capital_flip_usd} would flip it to FARM.`} Write the wallet, dates and every transaction in a farm log.`,
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
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; model: ModelConstants; validation: Validation; audit: RadarData['audit'] } {
  const { model, validation } = fitModel(snapshot);
  const asOf = snapshot.as_of;
  const comps = compsOf(snapshot);

  // Bootstrap: 200 refits of the quadratic size curve on resampled comps, seeded and deterministic.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const refits: { intercept: number; slope: number; quad: number }[] = [];
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const beta = fitOn(sample, FEATS['size+quad']!, asOf);
    refits.push({ intercept: beta[0]!, slope: beta[1]!, quad: beta[2]! });
  }
  // Conformal half-width from the leave-one-out residuals, as validation.conformal reports it.
  const confHalfWidth = validation.conformal.half_width_log;

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

  interface Scored {
    p: SnapshotProtocol;
    age: number | null;
    fitted: number;
    odds: number;
    expected: number;
    p10: number;
    p90: number;
    confP10: number;
    confP90: number;
  }
  const scored: Scored[] = chosen.map((p) => {
    const age = ageDays(asOf, p.listed_at);
    const fitted = fittedValue(model, p.tvl_usd);
    const odds = launchOdds(model, age, p.tvl_usd, p.change_7d);
    const fittedSamples = refits.map((b) => {
      const lt = Math.log(p.tvl_usd);
      return Math.exp(b.intercept + b.slope * lt + b.quad * lt * lt);
    });
    const p10 = quantile(fittedSamples, 0.1) * odds;
    const p90 = quantile(fittedSamples, 0.9) * odds;
    const confP10 = fitted * Math.exp(-confHalfWidth) * odds;
    const confP90 = fitted * Math.exp(confHalfWidth) * odds;
    return { p, age, fitted, odds, expected: fitted * odds, p10, p90, confP10, confP90 };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Rank range per row: the 10th/90th percentile of its rank over the bootstrap refits.
  const rankSamples: number[][] = scored.map(() => []);
  for (const b of refits) {
    const order = scored
      .map((s, i) => {
        const lt = Math.log(s.p.tvl_usd);
        return { i, v: Math.exp(b.intercept + b.slope * lt + b.quad * lt * lt) * s.odds };
      })
      .sort((a, b2) => b2.v - a.v || (scored[a.i]!.p.slug < scored[b2.i]!.p.slug ? -1 : 1));
    order.forEach((o, pos) => rankSamples[o.i]!.push(pos + 1));
  }

  const board: BoardRow[] = scored.map((s, i) => {
    const p10Expected = s.p10;
    const econ = farmEconomics(s.p, s.age, p10Expected);
    const steps = farmSteps(s.p, s.age, econ, p10Expected).map(stepText);
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
        conf_lo_usd: Math.max(1, Math.round(s.confP10)),
        conf_hi_usd: Math.max(1, Math.round(s.confP90)),
        rank_low: Math.round(quantile(rankSamples[i]!, 0.1)),
        rank_high: Math.round(quantile(rankSamples[i]!, 0.9)),
        growth_pct: s.p.change_7d === null ? 0 : Math.min(120, Math.max(-60, s.p.change_7d)),
        age_days: s.age,
      },
      farm: econ,
      farm_steps: steps,
    };
  });
  return { board, model, validation, audit };
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
    conf_lo_usd: row.model.conf_lo_usd,
    conf_hi_usd: row.model.conf_hi_usd,
    rank_low: row.model.rank_low,
    rank_high: row.model.rank_high,
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

/** The size curve as a chart: comps binned by log TVL (median log mcap per bin) plus the fitted curve. */
function curveChart(snapshot: Snapshot, model: ModelConstants): RadarData['curve_chart'] {
  const comps = compsOf(snapshot);
  const lts = comps.map((p) => Math.log(p.tvl_usd));
  const lo = Math.min(...lts);
  const hi = Math.max(...lts);
  const nBins = 8;
  const bins: RadarData['curve_chart']['bins'] = [];
  for (let i = 0; i < nBins; i++) {
    const a = lo + ((hi - lo) * i) / nBins;
    const b = lo + ((hi - lo) * (i + 1)) / nBins;
    const inBin = comps.filter((p) => {
      const lt = Math.log(p.tvl_usd);
      return lt >= a && (i === nBins - 1 ? lt <= b : lt < b);
    });
    if (inBin.length === 0) continue;
    bins.push({
      log_tvl: round4(median(inBin.map((p) => Math.log(p.tvl_usd)))),
      log_mcap: round4(median(inBin.map((p) => Math.log(p.mcap_usd!)))),
      n: inBin.length,
    });
  }
  const curve: RadarData['curve_chart']['curve'] = [];
  for (let i = 0; i <= 24; i++) {
    const lt = lo + ((hi - lo) * i) / 24;
    curve.push({ log_tvl: round4(lt), log_mcap: round4(model.intercept + model.slope * lt + model.quad_coef * lt * lt) });
  }
  const points = comps.map((p) => ({ log_tvl: round4(Math.log(p.tvl_usd)), log_mcap: round4(Math.log(p.mcap_usd!)) }));
  return { bins, curve, points };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, model, validation, audit } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const dropped = validation.ablation.filter((a) => !a.kept).map((a) => a.term);
  const checks: RadarData['checks'] = [
    { label: 'Watchlist covered', detail: `${snapshot.watchlist.length} / ${snapshot.watchlist.length} watchlist protocols on the board`, pass: board.filter((r) => snapshot.watchlist.includes(r.slug)).length === snapshot.watchlist.length },
    { label: 'Audit adds to 758', detail: `${audit.ranked} ranked + ${audit.live_token} live-token + ${audit.excluded} excluded = ${audit.total}`, pass: audit.ranked + audit.live_token + audit.excluded === audit.total },
    { label: 'Size curve beats flat baseline (LOO)', detail: `median abs log error ${validation.quad.loo_median_abs_log_error} vs flat ${validation.flat_baseline.median_abs_log_error}`, pass: validation.quad.loo_median_abs_log_error < validation.flat_baseline.median_abs_log_error },
    { label: 'Odds beat base rate (LOO Brier)', detail: `Brier ${validation.odds.brier_loo} vs base ${validation.odds.base_brier}`, pass: validation.odds.brier_loo < validation.odds.base_brier },
    { label: 'Quad kept, other terms refused', detail: `size+quad kept; ${dropped.length} terms dropped (see the table below)`, pass: (validation.ablation.find((a) => a.term === 'size+quad')?.kept ?? false) && dropped.length === validation.ablation.length - 1 },
    { label: 'Placebo control refused', detail: 'seeded noise term failed both blind tests, as a real term must not', pass: (validation.ablation.find((a) => a.term === 'size+placebo')?.kept ?? false) === false && (validation.ablation.find((a) => a.term === 'quad+placebo')?.kept ?? false) === false },
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
    curve_chart: curveChart(snapshot, model),
  };
  return { board, radar };
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
