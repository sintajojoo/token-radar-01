// Token Radar, model radar-9. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same function main.ts runs:
// fitted = exp(intercept + slope * ln(tvl) + quad * ln(tvl)^2), odds = the ridge logistic
// model (age-bucket dummies + log TVL, no growth), expected = fitted x odds.
// It counts how many rows recompute to the number board.json carries and shows the count
// on the cover, so the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function oddsParts(row) {
    var m = DATA.model;
    if (row.age_days === null || row.age_days === undefined) return null;
    var L = m.odds_logit;
    var b = -1;
    for (var i = 0; i < m.odds_buckets.length; i++) {
      var bk = m.odds_buckets[i];
      if (row.age_days >= bk.lo_days && (bk.hi_days === null || row.age_days < bk.hi_days)) { b = i; break; }
    }
    if (b < 0) b = m.odds_buckets.length - 1;
    var z = L.intercept + (b < 4 ? L.bucket_coef[b] : 0) + L.logtvl_coef * Math.log(row.tvl_usd);
    return { z: z, bucket: b, bucketCoef: b < 4 ? L.bucket_coef[b] : 0 };
  }
  function oddsOf(row) {
    var m = DATA.model;
    if (row.age_days === null || row.age_days === undefined) return m.base_odds;
    var parts = oddsParts(row);
    var zc = Math.max(-30, Math.min(30, parts.z));
    return 1 / (1 + Math.exp(-zc));
  }
  /** The capture share of the P10 at which this row's $/hour reaches $25,
      or null when no capture share (even 100%) gets there. */
  function clear25(row) {
    if (!row.p10_usd || row.p10_usd <= 0) return null;
    var need = ((25 * row.hours + row.gas_total_usd) / row.p10_usd) * 100;
    return need;
  }
  function clear25Text(row) {
    var need = clear25(row);
    if (need === null) return 'n/a';
    if (need < 0.001) return '<0.001% of P10';
    if (need <= 100) return need.toFixed(3) + '% of P10';
    return 'never — needs ' + Math.round(need) + '% of P10';
  }
  function impliedOf(row) {
    var m = DATA.model;
    var lt = Math.log(row.tvl_usd);
    var fitted = Math.exp(m.intercept + m.slope * lt + m.quad_coef * lt * lt);
    return Math.max(1, Math.round(fitted * oddsOf(row)));
  }
  function fmtBps(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 0.01) return n.toFixed(2) + ' bps';
    return n.toFixed(4) + ' bps';
  }
  function recomputeCheck() {
    var ok = 0;
    DATA.rows.forEach(function (r) { if (impliedOf(r) === r.implied_value_usd) ok++; });
    return ok;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watchlist') === '1') state.watchlist = true;
    // v12: split cover — board + detail side by side in one frame (Clearboard
    // lesson). The detail opens non-modal, no backdrop, beside the board.
    if (params.get('split') === '1') {
      state.split = true;
      document.body.classList.add('split');
      if (!state.selected) state.selected = 'steakhouse-financial';
    }
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  var WATCHLIST = null;

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchlist && !WATCHLIST[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var v = DATA.validation;
    var farm = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { farm[r.verdict]++; });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected launch value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The board ranks all ' + DATA.board_size + ' rankable pre-token protocols by expected value: fitted value from the quadratic size curve times launch odds (age bucket, log TVL). Implied value is a model, not a promise.' }),
        el('p', { class: 'sub', text: 'Farm verdicts, netted on the P10: ' + farm.FARM + ' FARM, ' + farm.THIN + ' THIN, ' + farm.SKIP + ' SKIP.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Audit: ranked + live + excluded' }), el('b', { text: DATA.audit.ranked + ' + ' + DATA.audit.live_token + ' + ' + DATA.audit.excluded + ' = ' + DATA.audit.total })),
        el('div', { class: 'fact' }, el('span', { text: 'Page recomputes board.json' }), el('b', { text: recomputeCheck() + ' / ' + DATA.board_size + ' rows match' })),
        el('div', { class: 'fact' }, el('span', { text: 'Size curve, R²' }), el('b', { text: v.curve.r2 + ' on ' + v.curve.n_comps + ' comps' })),
        el('div', { class: 'fact' }, el('span', { text: 'LOO error (log)' }), el('b', { text: v.quad.loo_median_abs_log_error + ', flat ' + v.flat_baseline.median_abs_log_error }))
      )
    );
  }

  function oddsHistSvg() {
    var bins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    DATA.rows.forEach(function (r) { var b = Math.min(9, Math.floor(r.launch_odds * 10)); bins[b]++; });
    var max = Math.max.apply(null, bins);
    var W = 190, H = 58, BW = 15, GAP = 4;
    var bars = bins.map(function (n, i) {
      var h = max ? Math.max(1, Math.round((n / max) * 40)) : 0;
      return '<rect x="' + (i * (BW + GAP)) + '" y="' + (44 - h) + '" width="' + BW + '" height="' + h + '" fill="#2fd48a"><title>' + Math.round(i * 10) + '–' + Math.round((i + 1) * 10) + '% odds: ' + n + ' rows</title></rect>';
    }).join('');
    var sorted = DATA.rows.map(function (r) { return r.launch_odds; }).sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Launch odds across the 198 rows, median ' + Math.round(med * 100) + ' percent">' + bars +
      '<text x="0" y="56" class="axis">0%</text><text x="86" y="56" class="axis">50%</text><text x="172" y="56" class="axis">100%</text></svg>';
  }

  function honestyPanel() {
    var v = DATA.validation;
    return el('section', { class: 'panel honesty', 'aria-label': 'What we claim and what we do not claim' },
      el('div', { class: 'honesty-head' },
        el('h2', { text: 'What we claim — and what we don\u2019t' }),
        el('span', { class: 'sub', text: 'Blind-test scores, not adjectives. Full tables are below.' })
      ),
      el('div', { class: 'honesty-cols' },
        el('div', { class: 'honesty-col' },
          el('b', { class: 'claim-h', text: 'We claim' }),
          el('p', { text: 'The board ranks 198 pre-token protocols by fitted value \u00d7 launch odds. The quadratic curve beats the linear curve on the two pre-set blind tests (LOO ' + v.quad.loo_median_abs_log_error + ' vs ' + v.size_only.loo_median_abs_log_error + '; walk-forward ' + v.quad.walkforward_median_abs_log_error + ' vs ' + v.size_only.walkforward_median_abs_log_error + ') \u2014 but only just.' }),
          el('p', { text: 'Launch odds beat the base rate (Brier ' + v.odds.brier_loo + ' vs ' + v.odds.base_brier + ') and the v2 blend (' + v.odds.v2_brier_loo + ').' })
        ),
        el('div', { class: 'honesty-col' },
          el('b', { class: 'claim-h dont', text: 'We don\u2019t claim' }),
          el('p', { text: 'Quad vs linear is near a coin flip: 5-fold favours linear (' + v.size_only_fivefold.median_abs_log_error + ' vs ' + v.quad_fivefold.median_abs_log_error + '), and repeated 5-fold agrees (linear 1.2665, quad 1.2859). The odds gain over v2 is small: Brier 0.2092 \u2192 0.2028.' }),
          el('p', { text: 'TVL is counted twice \u2014 in the fitted value and in the odds \u2014 and a launch may attract TVL first. One snapshot cannot tell cause from effect. The P5\u2013P95 range is nominal 90%; walk-forward only 83% fell inside it (n = 47) — the other held-out checks are 88% (5-fold, n = 128) and 87% (newest third, n = 31).' })
        ),
        el('div', { class: 'honesty-hist' },
          el('b', { class: 'claim-h', text: 'Launch odds, 198 rows' }),
          el('div', { class: 'hist-body', html: oddsHistSvg() }),
          el('span', { class: 'sub', text: 'Most rows sit at low odds; the top of the board is the high-odds tail, not the typical protocol.' })
        )
      )
    );
  }

  function checksStrip() {
    var items = DATA.checks.map(function (c) {
      return el('div', { class: 'check' },
        el('span', { class: c.pass ? 'pass' : 'fail', text: c.pass ? 'PASS' : 'FAIL' }),
        el('div', null, el('b', { text: c.label }), el('span', { class: 'sub', text: c.detail }))
      );
    });
    return el('section', { class: 'strip', 'aria-label': 'Integrity checks' }, items);
  }

  function curveChart() {
    var cc = DATA.curve_chart;
    if (!cc || !cc.bins || cc.bins.length === 0) return null;
    var W = 1200, H = 46, PL = 70, PR = 20, PT = 8, PB = 22;
    var xs = cc.curve.map(function (p) { return p.log_tvl; }).concat(cc.bins.map(function (b) { return b.log_tvl; })).concat((cc.points || []).map(function (p) { return p.log_tvl; }));
    var ys = cc.curve.map(function (p) { return p.log_mcap; }).concat(cc.bins.map(function (b) { return b.log_mcap; })).concat((cc.points || []).map(function (p) { return p.log_mcap; }));
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys) - 0.5, y1 = Math.max.apply(null, ys) + 0.5;
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    var path = cc.curve.map(function (p, i) { return (i === 0 ? 'M' : 'L') + X(p.log_tvl).toFixed(1) + ',' + Y(p.log_mcap).toFixed(1); }).join(' ');
    var dots = cc.bins.map(function (b) {
      return '<circle cx="' + X(b.log_tvl).toFixed(1) + '" cy="' + Y(b.log_mcap).toFixed(1) + '" r="' + (4 + Math.min(6, b.n)) + '" fill="#2fd48a"><title>' + b.n + ' comps, median log mcap ' + b.log_mcap + '</title></circle>';
    }).join('');
    var xTicks = [];
    for (var t = Math.ceil(x0); t <= Math.floor(x1); t++) {
      xTicks.push('<text x="' + X(t).toFixed(1) + '" y="' + (H - 12) + '" class="axis">$' + Math.round(Math.exp(t) / 1e6) + 'M TVL</text>');
      xTicks.push('<line x1="' + X(t).toFixed(1) + '" y1="' + PT + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - PB) + '" class="grid"/>');
    }
    var scatter = (cc.points || []).map(function (p) {
      return '<circle cx="' + X(p.log_tvl).toFixed(1) + '" cy="' + Y(p.log_mcap).toFixed(1) + '" r="3" fill="#2fd48a" opacity="0.45"/>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Size curve: live-token comps by TVL and market cap, with the fitted quadratic curve">' +
      xTicks.join('') + scatter +
      '<path d="' + path + '" fill="none" stroke="#e6f0ea" stroke-width="2"/>' + dots +
      '<text x="' + PL + '" y="' + (PT + 2) + '" class="axis">log market cap</text></svg>';
    return el('section', { class: 'panel chart' },
      el('div', { class: 'chart-head' },
        el('h2', { text: 'The size curve, against the comps' }),
        el('span', { class: 'sub', text: 'Small dots are the 128 comps; large dots are bin medians; the line is the fitted curve.' })
      ),
      el('div', { class: 'chart-body', html: svg })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'THIN', 'SKIP'].map(function (c) { return el('option', { value: c, text: c, selected: c === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    var wl = el('button', { type: 'button', class: 'button', 'aria-pressed': state.watchlist ? 'true' : 'false', text: state.watchlist ? 'Watchlist only: on' : 'Watchlist only', onclick: function () { state.watchlist = !state.watchlist; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdictSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Watchlist' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict ' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }),
        el('td', null, verdictBadge(r.verdict))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, largest expected value first. Expected value = fitted value x launch odds. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Expected value'),
            sortHeader('odds', 'Odds'),
            el('th', { scope: 'col', text: 'Farm' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function residualChart() {
    var pts = (DATA.curve_chart && DATA.curve_chart.points) || [];
    var m = DATA.model;
    if (!pts.length) return null;
    var res = pts.map(function (p) { return p.log_mcap - (m.intercept + m.slope * p.log_tvl + m.quad_coef * p.log_tvl * p.log_tvl); });
    var lo = Math.min.apply(null, res), hi = Math.max.apply(null, res);
    var NB = 12, bins = [];
    for (var i = 0; i < NB; i++) bins.push(0);
    res.forEach(function (r) { var b = Math.min(NB - 1, Math.floor(((r - lo) / (hi - lo || 1)) * NB)); bins[b]++; });
    var max = Math.max.apply(null, bins);
    var W = 600, H = 84, BW = 44, GAP = 6;
    var bars = bins.map(function (n, i) {
      var h = max ? Math.max(1, Math.round((n / max) * 56)) : 0;
      return '<rect x="' + (i * (BW + GAP)) + '" y="' + (68 - h) + '" width="' + BW + '" height="' + h + '" fill="#2fd48a"><title>' + n + ' comps in this residual bin</title></rect>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="In-sample residuals of the fitted curve on the 128 comps">' + bars +
      '<text x="0" y="82" class="axis">' + lo.toFixed(1) + ' (overvalued by the curve)</text>' +
      '<text x="' + (W - 150) + '" y="82" class="axis">' + hi.toFixed(1) + ' (undervalued)</text></svg>';
    return el('div', null,
      el('h3', { text: 'Where the curve misses: residuals on the 128 comps' }),
      el('div', { class: 'chart-body', html: svg }),
      el('p', { class: 'sub', text: 'Log market cap minus fitted log market cap, per comp. This is in-sample — every comp helped fit the curve, so it flatters the fit; the blind-test errors above (median 1.2167 log points leave-one-out) are the honest error. The spread is wide and lopsided: a few protocols miss by 5–6 log points under every curve tried.' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    var ab = v.ablation.map(function (a) {
      return el('div', { class: 'ablation-row' },
        el('span', { class: 'num', text: a.term }),
        el('span', { class: 'num', text: 'LOO ' + a.loo_median_abs_log_error }),
        el('span', { class: 'num', text: 'walk-forward ' + a.walkforward_median_abs_log_error }),
        el('b', { class: a.kept ? 'pass' : 'fail', text: a.kept ? 'KEPT' : 'DROPPED' })
      );
    });
    var oddsRows = m.odds_buckets.map(function (b) {
      return el('div', { class: 'ablation-row' },
        el('span', { text: b.lo_days + '–' + (b.hi_days === null ? '∞' : b.hi_days) + ' days' }),
        el('span', { class: 'num', text: Math.round(b.rate * 100) + '%' }),
        el('span', { class: 'num', text: 'n=' + b.n }),
        el('span', { class: 'sub', text: 'token rate' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How expected value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'log(mcap) = ' + m.intercept + ' + ' + m.slope + ' x log(tvl) + ' + m.quad_coef + ' x log(tvl)^2   (least squares, ' + m.n_comps + ' live-token comps, R² ' + m.r2 + ')'
      ),
      el('div', { class: 'formula' },
        'expected = exp(' + m.intercept + ' + ' + m.slope + ' x log(tvl) + ' + m.quad_coef + ' x log(tvl)^2) x launch odds (ridge logistic: age-bucket dummies + log TVL, lambda ' + m.odds_logit.lam + ')'
      ),
      el('p', { class: 'sub', text: 'Blind tests on the comps: leave-one-out median abs log error ' + v.quad.loo_median_abs_log_error + ' (' + Math.round(v.quad.loo_within_2x * 100) + '% within 2x), walk-forward ' + v.quad.walkforward_median_abs_log_error + ' (' + Math.round(v.quad.walkforward_within_2x * 100) + '% within 2x). The linear curve scores ' + v.size_only.loo_median_abs_log_error + ' leave-one-out and ' + v.size_only.walkforward_median_abs_log_error + ' walk-forward, so the quadratic term scores better on both — but only just: R² moves from 0.1939 to ' + m.r2 + ', and a 5-fold check does not confirm the gain (quadratic ' + v.quad_fivefold.median_abs_log_error + ' vs linear ' + v.size_only_fivefold.median_abs_log_error + '; repeated 5-fold over 5 shuffles agrees, linear 1.2665 vs quadratic 1.2859). On the newest third of dated comps (fit on the older two-thirds, n = ' + v.quad_newer_third.n + ') the quadratic scores ' + v.quad_newer_third.median_abs_log_error + ' vs linear ' + v.size_newer_third.median_abs_log_error + '. A flat median multiple scores ' + v.flat_baseline.median_abs_log_error + ' leave-one-out. R² ' + m.r2 + ' is low: market caps are noisy, and every row carries a P10–P90 range from 200 bootstrap refits plus a wider conformal range (nominal 90%, achieved 83% walk-forward).' }),
      el('p', { class: 'sub', text: 'Conformal range: fitted x exp(±' + v.conformal.half_width_log + '), the 90th percentile of the leave-one-out residuals, so it is nominally a 90% range (P5–P95) — not an achieved one. Tested four ways, each calibrated on a training set and counted on a held-out set: leave-one-out ' + Math.round(v.conformal.loo_coverage * 100) + '% (n = 128), walk-forward ' + Math.round(v.conformal.walkforward_coverage * 100) + '% (n = ' + v.conformal.n_walkforward + '), 5-fold ' + Math.round(v.conformal.fivefold_coverage * 100) + '% (n = 128), newest third ' + Math.round(v.conformal.newer_third_coverage * 100) + '% (n = ' + v.conformal.n_newer_third + '). Walk-forward is the weakest of the four (' + Math.round(v.conformal.walkforward_coverage * v.conformal.n_walkforward) + ' of ' + v.conformal.n_walkforward + ' newer protocols fell inside) against a nominal 90% — the interval still undercovers newer protocols, and the farm verdict is netted on the narrower bootstrap P10 instead, stated here so the two ranges are not confused.' }),
      el('h3', { text: 'Terms tested — one kept, the rest dropped' }),
      el('div', { class: 'ablation' }, ab),
      el('p', { class: 'sub', text: 'A term stays only if it beats its baseline curve on BOTH blind tests. The quadratic term is the only one that does, against the linear curve. Growth, maturity, chain count, the full combination, category intercepts and grouped categories each failed at least one, so they are not in the value — the 7-day growth is still shown on every row. The placebo (seeded noise) also failed both, which is the control that the tests can refuse a term. v6 tested the last untested ideas — one-per-ticker dedup of the comps, survival/hazard odds, empirical-Bayes partial pooling by category — and all failed at least one blind test too; the numbers are in the README exploration table.' }),
      el('h3', { text: 'Launch odds by age' }),
      el('div', { class: 'ablation' }, oddsRows),
      el('p', { class: 'sub', text: 'Odds are a ridge logistic regression (lambda ' + v.odds.logit_lam + ') on age-bucket dummies and log TVL. Leave-one-out Brier ' + v.odds.brier_loo + ' against the base rate ' + v.odds.base_brier + ', the v2 age/category blend ' + v.odds.v2_brier_loo + ' and the refused v3 variant with growth ' + v.odds.v3_brier_loo + '; log-loss ' + v.odds.logloss_loo + ' against ' + v.odds.base_logloss + ', v2 ' + v.odds.v2_logloss_loo + ' and v3 ' + v.odds.v3_logloss_loo + ' (' + v.odds.n_dated + ' dated protocols; a 5-fold check agrees: Brier ' + v.odds.fivefold_brier + ' vs v2 ' + v.odds.fivefold_v2_brier + ' and v3 ' + v.odds.fivefold_v3_brier + '). Growth was dropped deliberately: the v3 variant scored better but its growth coefficient was negative and it drove most of the board reshuffle, so v4 keeps about two-thirds of its gain with less than half the reshuffle. The table above shows the empirical token rate by age bucket for reference — the logistic model, not the table, sets the odds. Protocols with no listing date use the base rate. Odds are a cohort rate, never a launch date: the snapshot has no launch dates.' }),
      el('div', null, residualChart()),
      el('p', { class: 'sub', text: 'Audit: ' + DATA.audit.ranked + ' ranked + ' + DATA.audit.live_token + ' live-token + ' + DATA.audit.excluded + ' excluded = ' + DATA.audit.total + '. Excluded: ' + Object.keys(DATA.audit.excluded_by_reason).map(function (k) { return DATA.audit.excluded_by_reason[k] + ' ' + k; }).join(', ') + '.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function verdictOneLiner(row) {
    var drag = row.gas_total_usd / row.capital_usd;
    var dragTxt = 'Gas drag ' + Math.round(drag * 100) + '% (gas / capital)' + (drag <= 0.1 ? ' — inside the 10% FARM limit' : drag <= 0.3 ? ' — outside the 10% FARM limit, inside the 30% THIN limit' : ' — outside the 30% THIN limit');
    var beTxt = 'breakeven ' + fmtBps(row.breakeven_bps) + (row.breakeven_bps <= 1 ? ' — inside the 1 bp FARM limit' : row.breakeven_bps <= 5 ? ' — outside the 1 bp FARM limit, inside the 5 bp THIN limit' : ' — outside the 5 bp THIN limit');
    return dragTxt + '; ' + beTxt + '. Verdict: ' + row.verdict + '.';
  }

  function verdictWhySection(row) {
    var gasDrag = row.gas_total_usd / row.capital_usd;
    var gasPerHour = row.gas_total_usd / row.hours;
    var dragNote = gasDrag <= 0.1 ? 'passes the 10% FARM limit' : gasDrag <= 0.3 ? 'passes the 30% THIN limit, fails the 10% FARM limit' : 'over the 30% THIN limit';
    var beNote = row.breakeven_bps <= 1 ? 'passes the 1 bp FARM limit' : row.breakeven_bps <= 5 ? 'passes the 5 bp THIN limit, fails the 1 bp FARM limit' : 'over the 5 bp THIN limit';
    var deciding;
    if (row.verdict === 'FARM') deciding = 'Both thresholds pass, so FARM.';
    else if (row.verdict === 'THIN') deciding = (gasDrag > 0.1 ? 'Gas drag (' + Math.round(gasDrag * 100) + '%)' : 'Breakeven (' + row.breakeven_bps + ' bps)') + ' only passes at the THIN level, so THIN, not FARM.';
    else {
      var failing = [];
      if (gasDrag > 0.3) failing.push('gas drag (' + Math.round(gasDrag * 100) + '% of capital)');
      if (row.breakeven_bps > 5) failing.push('breakeven (' + row.breakeven_bps + ' bps of the P10)');
      deciding = failing.join(' and ') + (failing.length > 1 ? ' fail' : ' fails') + ' even the THIN limit, so SKIP' + (failing.length === 1 ? ' — even though the other threshold passes.' : '.');
    }
    var counts = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[r.verdict]++; });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this verdict: ' + row.verdict }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Gas drag (gas / capital)' }), el('b', { class: 'num', text: Math.round(gasDrag * 100) + '% — ' + dragNote })),
        el('div', null, el('span', { text: 'Breakeven vs P10' }), el('b', { class: 'num', text: fmtBps(row.breakeven_bps) + ' — ' + beNote })),
        el('div', null, el('span', { text: 'Expected $/hour (0.001% capture)' }), el('b', { class: 'num', text: '$' + row.usd_per_hour })),
        el('div', null, el('span', { text: 'Gas $/hour (gas bill / hours)' }), el('b', { class: 'num', text: '$' + gasPerHour.toFixed(2) })),
        el('div', null, el('span', { text: 'P10 expected value' }), el('b', { class: 'num', text: fmtUsd(row.p10_usd) }))
      ),
      el('p', { class: 'sub', text: 'FARM needs gas drag ≤ 10% and breakeven ≤ 1 bp. THIN needs ≤ 30% and ≤ 5 bp. Otherwise SKIP. ' + deciding }),
      el('p', { class: 'sub', text: 'The verdict is decided by these two thresholds on the P10 — not by the fitted value or the odds directly. The P10 moved when the odds model changed in v2–v4, but no row crossed a threshold, so the split ' + counts.FARM + ' FARM / ' + counts.THIN + ' THIN / ' + counts.SKIP + ' SKIP is unchanged since v1. Raising capital only fixes gas drag, never breakeven.' })
    );
  }

  function bucketLabel(row) {
    var m = DATA.model;
    if (row.age_days === null || row.age_days === undefined) return 'no listing date';
    var parts = oddsParts(row);
    var bk = m.odds_buckets[parts.bucket];
    return bk.lo_days + '–' + (bk.hi_days === null ? '∞' : bk.hi_days) + ' days';
  }
  /** The row's value as a literal equation, with this row's own numbers
      substituted — the same arithmetic the page recomputes, shown, not hidden. */
  function valueEquation(row) {
    var m = DATA.model;
    var lt = Math.log(row.tvl_usd);
    var fittedLine = 'fitted = exp(' + m.intercept + ' + ' + m.slope + ' x ln(TVL) + ' + m.quad_coef + ' x ln(TVL)^2)'
      + ' = exp(' + m.intercept + ' + ' + m.slope + ' x ' + lt.toFixed(4) + ' + ' + m.quad_coef + ' x ' + lt.toFixed(4) + '^2)'
      + ' = ' + fmtUsd(row.fitted_value_usd);
    var oddsLine;
    if (row.age_days === null || row.age_days === undefined) {
      oddsLine = 'odds = base rate ' + Math.round(m.base_odds * 100) + '% (no listing date, so no age bucket)';
    } else {
      var parts = oddsParts(row);
      oddsLine = 'odds = sigmoid(' + m.odds_logit.intercept + ' + ' + parts.bucketCoef + ' [age ' + bucketLabel(row) + '] + ' + m.odds_logit.logtvl_coef + ' x ln(TVL))'
        + ' = sigmoid(' + parts.z.toFixed(3) + ') = ' + Math.round(row.launch_odds * 100) + '%';
    }
    var impliedLine = 'implied = fitted x odds = ' + fmtUsd(row.fitted_value_usd) + ' x ' + (Math.round(row.launch_odds * 1000) / 10) + '% = ' + fmtUsd(row.implied_value_usd);
    return [fittedLine, oddsLine, impliedLine];
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + '  ·  rank range ' + row.rank_low + '–' + row.rank_high }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Expected value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth (shown, not used)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Fitted value' }), el('b', { class: 'num', text: fmtUsd(row.fitted_value_usd) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        el('div', null, el('span', { text: 'P10–P90 expected (bootstrap)' }), el('b', { class: 'num', text: fmtUsd(row.p10_usd) + ' – ' + fmtUsd(row.p90_usd) })),
        el('div', null, el('span', { text: 'P5–P95 expected (conformal; walk-forward coverage 83%, nominal 90%)' }), el('b', { class: 'num', text: fmtUsd(row.conf_lo_usd) + ' – ' + fmtUsd(row.conf_hi_usd) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Value equation — this row, literally' }),
      el('div', { class: 'formula' }, valueEquation(row).join('\n') ),
      el('p', { class: 'sub', text: 'ln(TVL) is the natural log of this row\u2019s TVL. The bucket term is the age bucket this row falls in (' + bucketLabel(row) + '); undated rows use the base rate instead of a bucket. Every number above comes from this row and the model in board.json — substitute them and you get the same expected value.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics — netted on the P10' }),
      el('p', { class: 'sub', text: verdictOneLiner(row) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.verdict })),
        el('div', null, el('span', { text: 'Capital' }), el('b', { class: 'num', text: '$' + row.capital_usd })),
        el('div', null, el('span', { text: 'Total gas' }), el('b', { class: 'num', text: '$' + row.gas_total_usd + ' (' + Math.round((row.gas_total_usd / row.capital_usd) * 100) + '% of capital)' })),
        el('div', null, el('span', { text: 'Breakeven vs P10' }), el('b', { class: 'num', text: fmtBps(row.breakeven_bps) })),
        el('div', null, el('span', { text: 'Capture breakeven' }), el('b', { class: 'num', text: row.capture_breakeven_pct + '% of P10' })),
        el('div', null, el('span', { text: 'Capital that flips to FARM' }), el('b', { class: 'num', text: row.verdict === 'FARM' ? 'already FARM' : row.capital_flip_usd === null ? 'none — breakeven blocks it' : '$' + row.capital_flip_usd })),
        el('div', null, el('span', { text: 'Hours of work' }), el('b', { class: 'num', text: String(row.hours) })),
        el('div', null, el('span', { text: '$/hour at 0.001% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour })),
        el('div', null, el('span', { text: '$/hour at 0.01% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour_01pct })),
        el('div', null, el('span', { text: '$/hour at 0.1% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour_10pct })),
        el('div', null, el('span', { text: 'Clears $25/h at capture' }), el('b', { class: 'num', text: clear25Text(row) }))
      ),
      el('p', { class: 'sub', text: 'Breakeven is the gas bill as a share of the P10 expected value. $/hour at three capture shares of the P10 — 0.001%, 0.01% and 0.1% — are labelled assumptions, not a forecast: the 0.1% figure is 100x the 0.001% one, and is shown beside it so nobody reads it alone as a promise of an airdrop. The $25/h line is the same arithmetic solved for the capture share: (25 x hours + gas) / P10.' })
    ));
    dialog.appendChild(verdictWhySection(row));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) state.split ? dialog.show() : dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function protoSelect(defSlug, label) {
    var sel = el('select', { 'aria-label': label });
    DATA.rows.forEach(function (r) {
      var o = el('option', { value: r.slug, text: r.rank + '. ' + r.name });
      if (r.slug === defSlug) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  function rowBySlug(slug) {
    return DATA.rows.filter(function (r) { return r.slug === slug; })[0];
  }
  /** Sandbox, compare and export. What-if tools only: they read the board's
      numbers and never write back to it — the board above always uses the
      model's capital and the 0.001% capture assumption. */
  function toolsPanel() {
    var sbProto = protoSelect('steakhouse-financial', 'Sandbox protocol');
    var sbCapture = el('select', { 'aria-label': 'Sandbox capture share' },
      [['0.00001', '0.001% capture'], ['0.0001', '0.01% capture'], ['0.001', '0.1% capture'], ['0.01', '1% capture']].map(function (c) {
        return el('option', { value: c[0], text: c[1] });
      })
    );
    var sbCapital = el('input', { type: 'number', min: '1', step: '1', 'aria-label': 'Sandbox capital in dollars' });
    var sbOut = el('div', { class: 'equation' });
    function sbRender() {
      var row = rowBySlug(sbProto.value);
      if (!row) return;
      var cap = parseFloat(sbCapital.value);
      if (!cap || cap <= 0) { cap = row.capital_usd; sbCapital.value = String(cap); }
      var share = parseFloat(sbCapture.value);
      var perHour = (share * row.p10_usd - row.gas_total_usd) / row.hours;
      var drag = row.gas_total_usd / cap;
      var verdict = drag <= 0.1 && row.breakeven_bps <= 1 ? 'FARM' : drag <= 0.3 && row.breakeven_bps <= 5 ? 'THIN' : 'SKIP';
      sbOut.textContent = '';
      sbOut.appendChild(el('div', null, el('span', { text: '$/hour at your capture' }), el('b', { class: 'num', text: '$' + perHour.toFixed(2) })));
      sbOut.appendChild(el('div', null, el('span', { text: 'Gas drag at your capital' }), el('b', { class: 'num', text: Math.round(drag * 100) + '% of $' + cap })));
      sbOut.appendChild(el('div', null, el('span', { text: 'Verdict at your capital' }), el('b', { class: 'num', text: verdict + ' (breakeven ' + fmtBps(row.breakeven_bps) + ' unchanged — capital never fixes breakeven)' })));
    }
    sbProto.addEventListener('change', function () { var r = rowBySlug(sbProto.value); if (r) sbCapital.value = String(r.capital_usd); sbRender(); });
    sbCapture.addEventListener('change', sbRender);
    sbCapital.addEventListener('input', sbRender);
    sbCapital.value = String((rowBySlug('steakhouse-financial') || DATA.rows[0]).capital_usd);

    var cpA = protoSelect(DATA.rows[0].slug, 'Compare protocol A');
    var cpB = protoSelect(DATA.rows[1].slug, 'Compare protocol B');
    var cpOut = el('div', { class: 'equation' });
    function cpRender() {
      var a = rowBySlug(cpA.value), b = rowBySlug(cpB.value);
      if (!a || !b) return;
      cpOut.textContent = '';
      [['Rank', a.rank, b.rank], ['Expected value', fmtUsd(a.implied_value_usd), fmtUsd(b.implied_value_usd)],
       ['Fitted value', fmtUsd(a.fitted_value_usd), fmtUsd(b.fitted_value_usd)],
       ['Launch odds', Math.round(a.launch_odds * 100) + '%', Math.round(b.launch_odds * 100) + '%'],
       ['Verdict', a.verdict, b.verdict], ['$/hour (0.001%)', '$' + a.usd_per_hour, '$' + b.usd_per_hour],
       ['Clears $25/h', clear25Text(a), clear25Text(b)]].forEach(function (r) {
        cpOut.appendChild(el('div', null, el('span', { text: r[0] }), el('b', { class: 'num', text: r[1] + '  vs  ' + r[2] })));
      });
      var hi = a.implied_value_usd >= b.implied_value_usd ? a : b;
      var lo = hi === a ? b : a;
      cpOut.appendChild(el('div', null, el('span', { text: 'Higher expected value' }), el('b', { class: 'num', text: hi.name + ' by ' + fmtUsd(hi.implied_value_usd - lo.implied_value_usd) })));
    }
    cpA.addEventListener('change', cpRender);
    cpB.addEventListener('change', cpRender);

    var exportBtn = el('button', { class: 'button primary', type: 'button', text: 'Export board as CSV', onclick: exportCsv });
    function exportCsv() {
      var list = rows();
      var head = 'rank,slug,name,category,chains,tvl_usd,age_days,fitted_value_usd,launch_odds,implied_value_usd,verdict,usd_per_hour_0.001pct\n';
      var esc = function (v) { var s = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      var body = list.map(function (r) {
        return [r.rank, r.slug, esc(r.name), esc(r.category || ''), esc((r.chains || []).join(';')), r.tvl_usd, r.age_days === null ? '' : r.age_days, r.fitted_value_usd, r.launch_odds, r.implied_value_usd, r.verdict, r.usd_per_hour].join(',');
      }).join('\n');
      var blob = new Blob([head + body + '\n'], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'token-radar-board.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }
    sbRender();
    cpRender();
    return el('section', { class: 'panel tools', 'aria-label': 'Sandbox, compare and export' },
      el('h2', { text: 'Tools — sandbox, compare, export' }),
      el('p', { class: 'sub', text: 'What-if tools. They read the board\u2019s numbers and never change them: the board above always uses the model\u2019s capital and the 0.001% capture assumption. Anything you change here stays in this panel.' }),
      el('div', { class: 'tools-grid' },
        el('div', { class: 'tool' },
          el('h3', { text: 'Sandbox — try an assumption' }),
          el('div', { class: 'field' }, el('label', { text: 'Protocol' }), sbProto),
          el('div', { class: 'field' }, el('label', { text: 'Capture share of the P10' }), sbCapture),
          el('div', { class: 'field' }, el('label', { text: 'Capital ($)' }), sbCapital),
          sbOut
        ),
        el('div', { class: 'tool' },
          el('h3', { text: 'Compare two protocols' }),
          el('div', { class: 'field' }, el('label', { text: 'Protocol A' }), cpA),
          el('div', { class: 'field' }, el('label', { text: 'Protocol B' }), cpB),
          cpOut
        ),
        el('div', { class: 'tool' },
          el('h3', { text: 'Export the board' }),
          el('p', { class: 'sub', text: 'Downloads the rows the current filter shows as CSV — rank, fitted value, odds, implied value, verdict and $/hour — so the board can be checked in a spreadsheet.' }),
          exportBtn
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(honestyPanel());
    shell.appendChild(checksStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var chart = curveChart();
    if (chart) shell.appendChild(chart);
    if (state.tab === 'pre-token') { shell.appendChild(modelPanel()); shell.appendChild(toolsPanel()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  WATCHLIST = {};
  if (DATA.watchlist_slugs) DATA.watchlist_slugs.forEach(function (s) { WATCHLIST[s] = true; });
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
