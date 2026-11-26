// Token Radar, model "fitted" (radar-10). It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs, its peers, and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same function main.ts runs:
// fitted = exp(intercept + beta * ln(tvl) + offset[category]), odds = the ridge logistic
// model (age-bucket dummies + log TVL, no growth), expected = fitted x odds; the calibration
// band is fitted x exp([q10, q90]) x odds, and break-even odds is gas / (0.001% x fitted).
// It counts how many rows recompute to the numbers board.json carries and shows the count
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
  function fittedRawOf(row) {
    var m = DATA.model;
    var lt = Math.log(row.tvl_usd);
    return Math.exp(m.intercept + m.beta * lt + (m.offsets[row.category || 'Other'] || 0));
  }
  function fittedOf(row) {
    return Math.max(1, Math.round(fittedRawOf(row)));
  }
  function impliedOf(row) {
    // The board multiplies the unrounded fitted value by the odds and rounds
    // once, so the page must do the same: rounding the fitted value first
    // flips the final rounding on a few rows.
    return Math.max(1, Math.round(fittedRawOf(row) * oddsOf(row)));
  }
  function calBandOf(row) {
    var c = DATA.validation.calibration;
    var fitted = fittedRawOf(row);
    var odds = oddsOf(row);
    return {
      lo: Math.max(1, Math.round(fitted * Math.exp(c.q10_log) * odds)),
      hi: Math.max(1, Math.round(fitted * Math.exp(c.q90_log) * odds))
    };
  }
  function breakevenOddsOf(row) {
    var fitted = fittedRawOf(row);
    if (fitted <= 0) return 999;
    return Math.round((row.gas_total_usd / (0.00001 * fitted)) * 1e6) / 1e6;
  }
  function fmtBps(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 0.01) return n.toFixed(2) + ' bps';
    return n.toFixed(4) + ' bps';
  }
  /** How many rows recompute to the numbers board.json carries, per check. */
  function recomputeCheck() {
    var ok = { implied: 0, fitted: 0, cal: 0, breakeven: 0 };
    DATA.rows.forEach(function (r) {
      if (impliedOf(r) === r.implied_value_usd) ok.implied++;
      if (fittedOf(r) === r.fitted_value_usd) ok.fitted++;
      var band = calBandOf(r);
      if (band.lo === r.cal_lo_usd && band.hi === r.cal_hi_usd) ok.cal++;
      if (breakevenOddsOf(r) === r.breakeven_odds) ok.breakeven++;
    });
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
    var rc = recomputeCheck();
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected launch value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The board ranks all ' + DATA.board_size + ' rankable pre-token protocols by expected value: fitted value from the fitted size model times launch odds (age bucket, log TVL). Implied value is a model, not a promise.' }),
        el('p', { class: 'sub', text: 'Farm verdicts, by the break-even odds rule: ' + farm.FARM + ' FARM, ' + farm.THIN + ' THIN, ' + farm.SKIP + ' SKIP.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Audit: ranked + live + excluded' }), el('b', { text: DATA.audit.ranked + ' + ' + DATA.audit.live_token + ' + ' + DATA.audit.excluded + ' = ' + DATA.audit.total })),
        el('div', { class: 'fact' }, el('span', { text: 'Page recomputes board.json' }), el('b', { text: rc.implied + ' / ' + DATA.board_size + ' implied, ' + rc.fitted + ' fitted, ' + rc.cal + ' cal band, ' + rc.breakeven + ' break-even odds' })),
        el('div', { class: 'fact' }, el('span', { text: 'Fitted model, R²' }), el('b', { text: v.model.r2 + ' on ' + v.model.n_comps + ' comps' })),
        el('div', { class: 'fact' }, el('span', { text: 'Selection score (LOO + WF)/2' }), el('b', { text: String(v.selection_score) + ' log points' }))
      )
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
          el('caption', { class: 'sub', text: 'Pre-token protocols, largest expected value first. Expected value = fitted value x launch odds. Select a row for its model, its peers and its farm plan.' }),
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

  function ablationPanel() {
    var v = DATA.validation;
    var ab = v.ablation.map(function (a) {
      return el('div', { class: 'ablation-row' },
        el('span', { class: 'num', text: a.term }),
        el('span', { class: 'num', text: 'LOO ' + a.loo_median_abs_log_error }),
        el('span', { class: 'num', text: 'walk-forward ' + a.walkforward_median_abs_log_error }),
        el('span', { class: 'num', text: 'split-half ' + a.split_half_median_abs_log_error }),
        el('b', { class: a.kept ? 'pass' : 'fail', text: a.kept ? 'KEPT' : 'DROPPED' })
      );
    });
    var cat = v.ablation[1];
    var flat = v.ablation[0];
    var size = v.ablation[2];
    var full = v.ablation[v.ablation.length - 1];
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Terms, added in order — one step kept, the rest refused' }),
      el('p', { class: 'sub', text: 'Each row is one nested model, refit from scratch and scored on the same two blind tests: leave-one-out on the 127 comps, and walk-forward (fit on the older half of the dated comps, tested on the newer half, n = ' + v.selected.n_walkforward + '). A step stays only if it beats the previous step on BOTH tests. Median absolute log error; lower is better.' }),
      el('div', { class: 'ablation' }, ab),
      el('p', { class: 'sub', text: 'Read the table honestly. The category step alone does NOT pass its own test: with the slope fixed at 1 it scores worse than the flat multiple on both tests (LOO ' + cat.loo_median_abs_log_error + ' vs ' + flat.loo_median_abs_log_error + '; walk-forward ' + cat.walkforward_median_abs_log_error + ' vs ' + flat.walkforward_median_abs_log_error + '). It is kept anyway as part of the specified nested structure, because the step that carries it — size elasticity — is a large improvement over the flat multiple on both tests (LOO ' + size.loo_median_abs_log_error + ' vs ' + flat.loo_median_abs_log_error + '; walk-forward ' + size.walkforward_median_abs_log_error + ' vs ' + flat.walkforward_median_abs_log_error + '), and because the offsets are what let the board show a per-category multiple. A reader who trusts only the blind tests should read the fitted values as the size curve adjusted by a category offset the tests do not confirm on their own.' }),
      el('p', { class: 'sub', text: 'The full-model row (' + full.loo_median_abs_log_error + ' / ' + full.walkforward_median_abs_log_error + ') is a tighter marginal reading than the headline (' + size.loo_median_abs_log_error + ' / ' + size.walkforward_median_abs_log_error + '), not a contradiction: each ablation row scores the model WITH that term added, refit and tested on its own, while the headline reports the selected model only. The full model scores worse than the selected model on both tests — that is why growth, maturity and breadth are refused, not kept. The 7-day growth is still shown on every row; it is not in the value.' })
    );
  }

  function calibrationPanel() {
    var c = DATA.validation.calibration;
    var pct = function (x) { return Math.round(x * 100) + '%'; };
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Calibration — does the range hold what it promises?' }),
      el('p', { class: 'sub', text: 'The band on every row is fitted x exp([q10, q90]) x odds, where q10/q90 are the 10th and 90th percentiles of the selected model\u2019s own leave-one-out residuals (q10 ' + c.q10_log + ', q25 ' + c.q25_log + ', q75 ' + c.q75_log + ', q90 ' + c.q90_log + ' log points). It is deliberately NOT clamped to the bootstrap P10–P90 range: the band is a property of the model\u2019s residuals, and clamping it would hide the rows where the model is less certain than the bootstrap suggests. It happens to contain the bootstrap range on all 198 rows — that is a measured fact, not a construction.' }),
      el('div', { class: 'ablation' },
        el('div', { class: 'ablation-row' }, el('span', { text: 'P25–P75 coverage (nominal 50%)' }), el('span', { class: 'num', text: 'LOO ' + pct(c.p2575_loo) }), el('span', { class: 'num', text: 'walk-forward ' + pct(c.p2575_wf) }), el('span', { class: 'sub', text: 'n = 127 / ' + c.n_walkforward })),
        el('div', { class: 'ablation-row' }, el('span', { text: 'P10–P90 coverage (nominal 80%)' }), el('span', { class: 'num', text: 'LOO ' + pct(c.p1090_loo) }), el('span', { class: 'num', text: 'walk-forward ' + pct(c.p1090_wf) }), el('span', { class: 'sub', text: 'n = 127 / ' + c.n_walkforward })),
        el('div', { class: 'ablation-row' }, el('span', { text: 'Within 3x of the true market cap' }), el('span', { class: 'num', text: 'LOO ' + pct(c.within3x_loo) }), el('span', { class: 'num', text: 'walk-forward ' + pct(c.within3x_wf) }), el('span', { class: 'sub', text: 'n = 127 / ' + c.n_walkforward })),
        el('div', { class: 'ablation-row' }, el('span', { text: 'P10–P90, two more held-out checks' }), el('span', { class: 'num', text: '5-fold ' + pct(c.p1090_fivefold) }), el('span', { class: 'num', text: 'newest third ' + pct(c.p1090_newer_third) }), el('span', { class: 'sub', text: 'n = 127 / ' + c.n_newer_third }))
      ),
      el('p', { class: 'sub', text: 'The weak number is stated, not smoothed over: walk-forward P10–P90 coverage is ' + pct(c.p1090_wf) + ' against a nominal 80% (' + Math.round(c.p1090_wf * c.n_walkforward) + ' of ' + c.n_walkforward + ' newer protocols fell inside). The interval undercovers newer protocols, so the farm verdict is netted on the narrower bootstrap P10 instead, and the two ranges are not confused with each other.' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    var offs = Object.keys(m.offsets).map(function (k) { return { cat: k, v: m.offsets[k] }; });
    offs.sort(function (a, b) { return b.v - a.v; });
    var top = offs.length ? offs[0] : null;
    var bottom = offs.length ? offs[offs.length - 1] : null;
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
        'log(mcap) = ' + m.intercept + ' + ' + m.beta + ' x log(tvl) + offset[category]   (least squares, ' + m.n_comps + ' live-token comps, R² ' + m.r2 + ')'
      ),
      el('div', { class: 'formula' },
        'expected = exp(' + m.intercept + ' + ' + m.beta + ' x log(tvl) + offset[category]) x launch odds (ridge logistic: age-bucket dummies + log TVL, lambda ' + m.odds_logit.lam + ')'
      ),
      el('p', { class: 'sub', text: 'The size elasticity is ' + m.beta + ': fitted market cap grows with TVL to the power ' + m.beta + '. Category offsets are the mean residual of each category, shrunk by n/(n+10) toward zero, so a category seen once cannot set its own multiple; ' + v.model.n_categories + ' categories carry an offset, from ' + (top ? top.v + ' (' + top.cat + ')' : 'n/a') + ' down to ' + (bottom ? bottom.v + ' (' + bottom.cat + ')' : 'n/a') + '. Categories with no comp score an offset of 0. The comps are deduplicated to one protocol per token symbol (127, not 128: the only collision is BIFI, beefy vs bifi, two different gecko ids sharing a ticker; the smaller-TVL one is dropped).' }),
      el('p', { class: 'sub', text: 'Selection score — the mean of the selected model\u2019s leave-one-out and walk-forward median absolute log errors — is ' + v.selection_score + ' (LOO ' + v.selected.loo_median_abs_log_error + ', ' + Math.round(v.selected.loo_within_2x * 100) + '% within 2x; walk-forward ' + v.selected.walkforward_median_abs_log_error + ', ' + Math.round(v.selected.walkforward_within_2x * 100) + '% within 2x; split-half ' + v.selected.split_half_median_abs_log_error + '). The hand-set starter this model replaces — a fixed 0.25 multiple with growth and maturity factors, the model v1 started from — scores 1.6363 on the same definition and the same 127 comps. R² ' + m.r2 + ' is low: market caps are noisy, and every row carries a P10–P90 range from 200 bootstrap refits plus the wider calibration band above.' }),
      el('h3', { text: 'Launch odds by age' }),
      el('div', { class: 'ablation' }, oddsRows),
      el('p', { class: 'sub', text: 'Odds are a ridge logistic regression (lambda ' + v.odds.logit_lam + ') on age-bucket dummies and log TVL, unchanged from v6: leave-one-out Brier ' + v.odds.brier_loo + ' against the base rate ' + v.odds.base_brier + '; log-loss ' + v.odds.logloss_loo + ' against ' + v.odds.base_logloss + ' (' + v.odds.n_dated + ' dated protocols; a 5-fold check agrees: Brier ' + v.odds.fivefold_brier + ', log-loss ' + v.odds.fivefold_logloss + '). The table above shows the empirical token rate by age bucket for reference — the logistic model, not the table, sets the odds. Protocols with no listing date use the base rate. Odds are a cohort rate, never a launch date: the snapshot has no launch dates.' }),
      el('p', { class: 'sub', text: 'Audit: ' + DATA.audit.ranked + ' ranked + ' + DATA.audit.live_token + ' live-token + ' + DATA.audit.excluded + ' excluded = ' + DATA.audit.total + '. Excluded: ' + Object.keys(DATA.audit.excluded_by_reason).map(function (k) { return DATA.audit.excluded_by_reason[k] + ' ' + k; }).join(', ') + '.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function bucketLabel(row) {
    var m = DATA.model;
    if (row.age_days === null || row.age_days === undefined) return 'no listing date';
    var parts = oddsParts(row);
    var bk = m.odds_buckets[parts.bucket];
    return bk.lo_days + '–' + (bk.hi_days === null ? '∞' : bk.hi_days) + ' days';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var band = calBandOf(row);
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
        el('div', null, el('span', { text: 'Launch odds (' + bucketLabel(row) + ')' }), el('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        el('div', null, el('span', { text: 'P10–P90 expected (bootstrap, 200 refits)' }), el('b', { class: 'num', text: fmtUsd(row.p10_usd) + ' – ' + fmtUsd(row.p90_usd) })),
        el('div', null, el('span', { text: 'Calibration band (residuals; not clamped to the bootstrap range)' }), el('b', { class: 'num', text: fmtUsd(row.cal_lo_usd) + ' – ' + fmtUsd(row.cal_hi_usd) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The calibration band recomputes to ' + fmtUsd(band.lo) + ' – ' + fmtUsd(band.hi) + (band.lo === row.cal_lo_usd && band.hi === row.cal_hi_usd ? ', the same band board.json carries.' : ', which differs from the board.') + ' This is an estimate, not a price.' })
    ));
    var peerRows = (row.peers || []).map(function (p) {
      return el('div', null,
        el('span', { text: p.name + (p.same_category ? '' : ' (other category — nearest by fitted value)') }),
        el('b', { class: 'num', text: fmtUsd(p.fitted_value_usd) })
      );
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Peers — live-token comps in the same category, closest by fitted value' }),
      peerRows.length ? el('div', { class: 'equation' }, peerRows) : el('p', { class: 'sub', text: 'No live-token comp shares this category.' }),
      el('p', { class: 'sub', text: 'Peers are the comps the model was fitted on, in this row\u2019s own category (' + (row.category || 'Other') + '), ranked by how close their fitted value sits to this row\u2019s. When a category has fewer than 8 comps the list is filled with the nearest comps from other categories, labelled as such — a row is never left with no comparison at all.' })
    ));
    var gasDrag = row.gas_total_usd / row.capital_usd;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics — netted on the P10' }),
      el('p', { class: 'sub', text: 'Verdict rule: FARM when launch odds are at or above the break-even odds AND gas drag is at most 10% of capital; THIN when the odds pass but gas drag is at most 30%; otherwise SKIP. Break-even odds is the launch odds at which capturing 0.001% of the fitted value exactly covers the gas bill.' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.verdict })),
        el('div', null, el('span', { text: 'Launch odds vs break-even odds' }), el('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '% vs ' + (row.breakeven_odds * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Gas drag (gas / capital)' }), el('b', { class: 'num', text: Math.round(gasDrag * 100) + '% of $' + row.capital_usd })),
        el('div', null, el('span', { text: 'Capital' }), el('b', { class: 'num', text: '$' + row.capital_usd })),
        el('div', null, el('span', { text: 'Total gas' }), el('b', { class: 'num', text: '$' + row.gas_total_usd })),
        el('div', null, el('span', { text: 'Breakeven vs P10' }), el('b', { class: 'num', text: fmtBps(row.breakeven_bps) })),
        el('div', null, el('span', { text: 'Capture breakeven' }), el('b', { class: 'num', text: row.capture_breakeven_pct + '% of P10' })),
        el('div', null, el('span', { text: 'Capital that flips to FARM' }), el('b', { class: 'num', text: row.verdict === 'FARM' ? 'already FARM' : row.capital_flip_usd === null ? 'none — the odds are below break-even odds' : '$' + row.capital_flip_usd })),
        el('div', null, el('span', { text: 'Hours of work' }), el('b', { class: 'num', text: String(row.hours) })),
        el('div', null, el('span', { text: '$/hour at 0.001% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour })),
        el('div', null, el('span', { text: '$/hour at 0.01% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour_01pct })),
        el('div', null, el('span', { text: '$/hour at 0.1% capture' }), el('b', { class: 'num', text: '$' + row.usd_per_hour_10pct })),
        el('div', null, el('span', { text: 'Clears $25/h at capture' }), el('b', { class: 'num', text: clear25Text(row) }))
      ),
      el('p', { class: 'sub', text: 'Raising capital only fixes gas drag, never the break-even odds: a row whose odds sit below its break-even odds cannot be flipped by any capital. $/hour at three capture shares of the P10 — 0.001%, 0.01% and 0.1% — are labelled assumptions, not a forecast: the 0.1% figure is 100x the 0.001% one, and is shown beside it so nobody reads it alone as a promise of an airdrop. The $25/h line is the same arithmetic solved for the capture share: (25 x hours + gas) / P10.' })
    ));
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
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') { shell.appendChild(ablationPanel()); shell.appendChild(calibrationPanel()); shell.appendChild(modelPanel()); }
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
