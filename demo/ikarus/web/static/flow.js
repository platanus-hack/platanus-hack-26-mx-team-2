/* Agent-flow visualization (progressive enhancement, no deps).
 *
 * Enriches each already-rendered Taint Ledger with a P-LLM -> Q-LLM -> Guardia
 * pipeline strip and a step-through that reveals the log row by row, lighting
 * the matching stage and the taint as it flows to the guard. Without JS the
 * ledger is fully visible as-is; with reduced-motion the walkthrough is instant.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KIND_STAGE = { source: 2, extract: 2, sink: 3 };  // ledger kind -> stage
  var CADENCE = 720;  // ms between reveals (content pacing, not a micro-interaction)

  function cellText(tr, i) {
    return (tr.children[i] && tr.children[i].textContent || '').trim();
  }
  function stageOf(tr) { return KIND_STAGE[cellText(tr, 1).toLowerCase()] || 1; }
  function isUntrusted(tr) { return /UNTRUSTED/.test(cellText(tr, 3)); }
  function isBlock(tr) { return /BLOCK/.test(cellText(tr, 4)); }
  function isSink(tr) { return cellText(tr, 1).toLowerCase() === 'sink'; }

  var STAGES = [
    { n: 1, tag: 'Capa 1', name: 'P-LLM' },
    { n: 2, tag: 'Capa 2', name: 'Q-LLM' },
    { n: 3, tag: 'Capa 3', name: 'Guardia' }
  ];

  function buildStrip() {
    var strip = document.createElement('div');
    strip.className = 'flow-strip';
    strip.setAttribute('aria-hidden', 'true');  // decorative twin of the ledger
    STAGES.forEach(function (s, i) {
      if (i) {
        var arr = document.createElement('span');
        arr.className = 'flow-arrow';
        arr.textContent = '→';
        strip.appendChild(arr);
      }
      var st = document.createElement('div');
      st.className = 'flow-stage' + (s.n === 3 ? ' guard' : '');
      st.dataset.stage = s.n;
      st.innerHTML = '<span class="flow-dot"></span><span class="flow-tag">' +
        s.tag + '</span><span class="flow-name">' + s.name + '</span>' +
        (s.n === 2 ? '<span class="flow-taint">taint</span>' : '') +
        (s.n === 3 ? '<span class="flow-verdict"></span>' : '');
      strip.appendChild(st);
    });
    return strip;
  }

  function Flow(article) {
    var table = article.querySelector('table.ledger');
    this.rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
    this.strip = buildStrip();
    this.stages = {};
    var self = this;
    this.strip.querySelectorAll('.flow-stage').forEach(function (el) {
      self.stages[el.dataset.stage] = el;
    });
    this.taint = this.strip.querySelector('.flow-taint');
    this.verdict = this.strip.querySelector('.flow-verdict');

    // Beats: a synthetic P-LLM "plan" beat, then one per ledger row.
    this.beats = [{ stage: 1, row: null }].concat(this.rows.map(function (r) {
      return { stage: stageOf(r), row: r };
    }));
    this.i = -1;

    var controls = document.createElement('div');
    controls.className = 'flow-controls';
    controls.innerHTML =
      '<button type="button" class="flow-btn" data-act="play">▶ Reproducir</button>' +
      '<button type="button" class="flow-btn ghost" data-act="step">▸ Paso</button>' +
      '<button type="button" class="flow-btn ghost" data-act="reset">⟲ Reiniciar</button>' +
      '<span class="flow-status" role="status" aria-live="polite"></span>';
    this.controls = controls;
    this.status = controls.querySelector('.flow-status');

    controls.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'play') self.play();
      else if (act === 'step') self.step();
      else if (act === 'reset') self.showFinal();
    });

    var wrap = article.querySelector('.ledger-wrap');
    article.insertBefore(this.strip, wrap);
    article.insertBefore(controls, wrap);
    // Default: start at the first phase (like the live walk) so rows are revealed
    // step by step, not all shown at once. "Reiniciar" jumps to the full summary.
    if (reduceMotion) { this.showFinal(); }
    else { this.reset(); this.advance(); }
  }

  Flow.prototype.clearStages = function () {
    for (var k in this.stages) this.stages[k].classList.remove('active');
  };
  Flow.prototype.lite = function (stage) {
    this.clearStages();
    if (this.stages[stage]) this.stages[stage].classList.add('active');
  };
  Flow.prototype.applyRow = function (row) {
    if (!row) return;
    row.classList.remove('pending');
    if (isUntrusted(row)) this.taint.classList.add('on');
    if (isSink(row)) {
      var block = isBlock(row);
      this.verdict.textContent = block ? 'BLOCK' : 'PASS';
      this.verdict.className = 'flow-verdict on ' + (block ? 'block' : 'pass');
    }
  };

  Flow.prototype.stopTimer = function () {
    if (this._t) { clearInterval(this._t); this._t = null; }
  };

  Flow.prototype.reset = function () {
    this.stopTimer();
    this.i = -1;
    this.clearStages();
    this.taint.classList.remove('on');
    this.verdict.className = 'flow-verdict';
    this.verdict.textContent = '';
    this.rows.forEach(function (r) { r.classList.add('pending'); });
    this.status.textContent = '';
  };

  Flow.prototype.showFinal = function () {  // all visible, outcome reflected
    this.reset();
    var self = this;
    this.rows.forEach(function (r) { self.applyRow(r); });
    this.clearStages();
    this.status.textContent = '';
  };

  // advance() runs one beat WITHOUT touching the timer, so it is safe to call
  // both from a manual "Paso" click and from play()'s interval. Returns false
  // when there are no beats left.
  Flow.prototype.advance = function () {
    if (this.i + 1 >= this.beats.length) return false;
    this.i++;
    var beat = this.beats[this.i];
    this.lite(beat.stage);
    this.applyRow(beat.row);
    this.status.textContent = this.i === 0
      ? 'P-LLM emite el plan (sin ver los datos)'
      : 'Paso ' + this.i + ' / ' + (this.beats.length - 1);
    return true;
  };

  Flow.prototype.step = function () {
    this.stopTimer();  // manual stepping cancels any running playback
    if (!this.advance()) this.showFinal();
  };

  Flow.prototype.play = function () {
    if (reduceMotion) { this.showFinal(); this.status.textContent = 'Flujo completo'; return; }
    this.reset();
    var self = this;
    this._t = setInterval(function () {
      if (!self.advance()) {  // done — never calls stopTimer indirectly
        self.stopTimer();
        self.clearStages();
        self.status.textContent = 'Flujo completo';
      }
    }, CADENCE);
  };

  function textOf(el, sel) {
    var n = el.querySelector(sel);
    return n ? (n.textContent || '').trim() : '';
  }

  // ---- Live walk: same navigable pipeline (strip + play/step/reset) over the
  // real per-step cards (naive -> P-LLM -> Q-LLM -> guard), one step at a time,
  // so the live run reads as a flow you can replay and go back through, not a
  // wall of logs. Without JS every step stays visible.
  function LiveWalk(root) {
    this.root = root;
    this.steps = Array.prototype.slice.call(root.querySelectorAll('.live-steps > .live-step'));
    if (this.steps.length < 2) return;   // nothing to navigate
    root.classList.add('walk-on');
    this.nodes = [];
    this.buildStrip();
    this.buildControls();
    this.reveal(0);
  }

  LiveWalk.prototype.buildStrip = function () {
    var strip = document.createElement('div');
    strip.className = 'flow-strip live';
    strip.setAttribute('aria-hidden', 'true');
    var self = this;
    this.steps.forEach(function (st, idx) {
      if (idx) {
        var arr = document.createElement('span');
        arr.className = 'flow-arrow'; arr.textContent = '→';
        strip.appendChild(arr);
      }
      var tag = textOf(st, '.flow-tag') || ('Capa ' + idx);
      var name = textOf(st, '.live-layer');
      var badgeEl = st.querySelector('.badge') || st.querySelector('.tt');
      var badge = badgeEl ? badgeEl.textContent.trim() : '';
      var bcls = /BLOCK|EXFIL/.test(badge) ? 'block'
               : /UNTRUSTED/.test(badge) ? 'taint'
               : badge === 'PASS' ? 'pass' : '';
      var node = document.createElement('button');
      node.type = 'button';
      node.className = 'flow-stage live' +
        (st.classList.contains('naive') ? ' naive' : '') +
        (st.classList.contains('guard') ? ' guard' : '');
      node.innerHTML = '<span class="flow-dot"></span><span class="flow-tag">' + tag +
        '</span><span class="flow-name">' + name + '</span>' +
        (badge ? '<span class="flow-verdict on ' + bcls + '">' + badge + '</span>' : '');
      node.addEventListener('click', function () { self.go(idx); });
      strip.appendChild(node);
      self.nodes.push(node);
    });
    this.strip = strip;
    this.root.insertBefore(strip, this.root.querySelector('.live-steps'));
  };

  LiveWalk.prototype.buildControls = function () {
    var c = document.createElement('div');
    c.className = 'flow-controls';
    c.innerHTML =
      '<button type="button" class="flow-btn" data-act="play">▶ Reproducir</button>' +
      '<button type="button" class="flow-btn ghost" data-act="step">▸ Paso</button>' +
      '<button type="button" class="flow-btn ghost" data-act="reset">⟲ Reiniciar</button>' +
      '<span class="flow-status" role="status" aria-live="polite"></span>';
    var self = this;
    this.status = c.querySelector('.flow-status');
    c.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'play') self.play();
      else if (act === 'step') self.step();
      else if (act === 'reset') self.go(0);
    });
    this.root.insertBefore(c, this.root.querySelector('.live-steps'));
  };

  LiveWalk.prototype.reveal = function (i) {
    this.i = i;
    this.steps.forEach(function (st, k) { st.classList.toggle('is-active', k === i); });
    this.nodes.forEach(function (n, k) {
      n.classList.toggle('active', k === i);
      n.classList.toggle('done', k < i);
    });
    if (this.status) {
      this.status.textContent = 'Paso ' + (i + 1) + ' / ' + this.steps.length +
        ' — ' + (textOf(this.steps[i], '.live-layer') || '');
    }
  };

  LiveWalk.prototype.stopTimer = function () {
    if (this._t) { clearInterval(this._t); this._t = null; }
  };
  LiveWalk.prototype.go = function (i) {
    this.stopTimer();
    this.reveal(Math.max(0, Math.min(i, this.steps.length - 1)));
  };
  LiveWalk.prototype.step = function () {
    this.stopTimer();
    this.reveal(Math.min(this.i + 1, this.steps.length - 1));
  };
  LiveWalk.prototype.play = function () {
    var self = this;
    if (reduceMotion) { this.reveal(this.steps.length - 1); return; }
    this.stopTimer();
    this.reveal(0);
    this._t = setInterval(function () {
      if (self.i + 1 >= self.steps.length) { self.stopTimer(); return; }
      self.reveal(self.i + 1);
    }, CADENCE);
  };

  function init(root) {
    (root || document).querySelectorAll('article.scene').forEach(function (a) {
      if (a.dataset.flow || !a.querySelector('table.ledger')) return;
      a.dataset.flow = '1';
      try { new Flow(a); } catch (e) { /* fail safe: leave ledger as-is */ }
    });
  }
  function initLive(root) {
    (root || document).querySelectorAll('.live-walk').forEach(function (w) {
      if (w.dataset.walk) return;
      w.dataset.walk = '1';
      try { new LiveWalk(w); } catch (e) { /* fail safe: leave steps visible */ }
    });
  }

  document.addEventListener('DOMContentLoaded', function () { init(document); initLive(document); });
  document.body.addEventListener('htmx:afterSwap', function (e) { init(e.target); initLive(e.target); });
})();
