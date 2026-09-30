(() => {
  'use strict';

  // ---------- storage (fails safely in private mode) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fe:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fe:' + k, JSON.stringify(v)); } catch (e) {} }
  };

  const settings = Object.assign({ font: 19, zh: 'show', tts: 'on', rate: 0.9, theme: 'auto' }, store.get('settings', {}));
  let favs = new Set(store.get('favs', []));
  let readSet = new Set(store.get('read', []));
  let openChapters = new Set(store.get('open', [0, 1]));

  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let DATA = null;

  // ---------- settings ----------
  function applySettings() {
    document.documentElement.style.setProperty('--en-size', settings.font + 'px');
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
    document.body.classList.toggle('zh-hidden', settings.zh === 'hide');
    document.body.classList.toggle('zh-tap', settings.zh === 'tap');
    $('#fontRange').value = settings.font;
    $('#fontVal').textContent = settings.font + 'px';
    for (const [id, key] of [['zhMode', 'zh'], ['ttsMode', 'tts'], ['rateMode', 'rate'], ['themeMode', 'theme']]) {
      for (const b of $('#' + id).children) b.classList.toggle('on', String(settings[key]) === b.dataset.v);
    }
    store.set('settings', settings);
  }
  function bindSeg(id, key, num) {
    $('#' + id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      settings[key] = num ? parseFloat(b.dataset.v) : b.dataset.v;
      applySettings();
    });
  }
  bindSeg('zhMode', 'zh'); bindSeg('ttsMode', 'tts'); bindSeg('rateMode', 'rate', true); bindSeg('themeMode', 'theme');
  $('#fontRange').addEventListener('input', e => { settings.font = +e.target.value; applySettings(); });
  $('#fontDown').onclick = () => { settings.font = Math.max(15, settings.font - 1); applySettings(); };
  $('#fontUp').onclick = () => { settings.font = Math.min(28, settings.font + 1); applySettings(); };

  const sheet = $('#settingsSheet'), backdrop = $('#sheetBackdrop');
  const openSheet = () => { sheet.hidden = false; backdrop.hidden = false; };
  const closeSheet = () => { sheet.hidden = true; backdrop.hidden = true; };
  $('#settingsBtn').onclick = openSheet;
  backdrop.onclick = closeSheet;

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1600);
  }

  // ---------- speech ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice = null;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /(Samantha|Google US|Aria|Jenny|Ava|Allison)/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  function speak(text, onend) {
    if (!synth) { toast('此浏览器不支持朗读'); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\s\/\s/g, '. '));
    u.lang = 'en-US'; if (voice) u.voice = voice;
    u.rate = settings.rate;
    if (onend) { u.onend = onend; u.onerror = onend; }
    synth.speak(u);
  }

  // ---------- helpers ----------
  const chapLabel = c => c.n === 0 ? '精选' : String(c.n).padStart(2, '0');
  const secCode = (ci, si) => DATA[ci].n === 0 ? `0-${si + 1}` : `${DATA[ci].n}-${si + 1}`;
  const isVocab = sec => sec.p.filter(([en]) => /[.?!"]$/.test(en)).length < sec.p.length * 0.4;
  function flatIndex() {
    const list = [];
    DATA.forEach((c, ci) => c.secs.forEach((s, si) => list.push([ci, si])));
    return list;
  }
  let FLAT = [];

  function setBar(title, sub, back) {
    $('#barTitle').textContent = title;
    $('#barSub').textContent = sub || '';
    $('#backBtn').hidden = !back;
  }
  const navStack = [];
  $('#backBtn').onclick = () => {
    if (navStack.length > 1) history.back();
    else location.hash = '#/';
  };
  $('#searchBtn').onclick = () => { location.hash = '#/search'; };

  const starSvg = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';

  function cardHTML(en, zh, key, extra = '', after = '') {
    return `<div class="card" data-key="${key}">
      ${extra}
      <div class="en" lang="en">${en}</div>
      <div class="zh" lang="zh-CN">${zh}</div>${after}
      <button class="star${favs.has(key) ? ' on' : ''}" aria-label="收藏">${starSvg}</button>
    </div>`;
  }

  // ---------- views ----------
  function renderHome() {
    stopAuto();
    setBar('亲子英语8000句', '美国家庭万用 · 中英对照', false);
    const total = DATA.reduce((a, c) => a + c.secs.reduce((b, s) => b + s.p.length, 0), 0);
    const nsec = FLAT.length;
    const last = store.get('last', null);
    let html = `<div class="hero">
      <h1>美国家庭万用亲子英语</h1>
      <p>英文在上、中文在下 · 点击句子可朗读</p>
      <div class="stats"><div><b>${total}</b>句子</div><div><b>${DATA.length - 1}</b>章</div><div><b>${readSet.size}/${nsec}</b>已读小节</div></div>
    </div>`;
    if (last && DATA[last[0]] && DATA[last[0]].secs[last[1]]) {
      const c = DATA[last[0]], s = c.secs[last[1]];
      html += `<button class="continue" data-go="#/r/${last[0]}/${last[1]}">
        <span class="dot"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg></span>
        <span><small>继续阅读</small><b>${esc(secCode(last[0], last[1]))} ${esc(s.t)}</b></span></button>`;
    }
    html += `<div class="quick">
      <button data-go="#/search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>搜索句子</button>
      <button data-go="#/fav">${starSvg}我的收藏 (${favs.size})</button>
    </div>
    <div class="section-h">目录</div>`;
    DATA.forEach((c, ci) => {
      const cnt = c.secs.reduce((a, s) => a + s.p.length, 0);
      const open = openChapters.has(ci);
      html += `<div class="chapter${open ? ' open' : ''}" data-ci="${ci}">
        <button class="ch-toggle"><span class="num">${chapLabel(c)}</span>
          <span class="name"><b>${esc(c.name)}</b><small>${c.secs.length} 小节 · ${cnt} 句</small></span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
        <div class="subs"${open ? '' : ' hidden'}>
          ${c.secs.map((s, si) => `<a href="#/r/${ci}/${si}" class="${readSet.has(ci + '.' + si) ? 'read' : ''}">
            <span class="sn">${secCode(ci, si)}</span><span class="st">${esc(s.t)}</span><span class="sc">${s.p.length}</span></a>`).join('')}
        </div></div>`;
    });
    view.innerHTML = html;
    const y = store.get('homeScroll', 0);
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  view.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { location.hash = go.dataset.go; return; }
    const tog = e.target.closest('.ch-toggle');
    if (tog) {
      const ch = tog.parentElement, ci = +ch.dataset.ci;
      const open = !ch.classList.contains('open');
      ch.classList.toggle('open', open);
      ch.querySelector('.subs').hidden = !open;
      open ? openChapters.add(ci) : openChapters.delete(ci);
      store.set('open', [...openChapters]);
      return;
    }
    const star = e.target.closest('.star');
    if (star) {
      const key = star.closest('.card').dataset.key;
      if (favs.has(key)) { favs.delete(key); star.classList.remove('on'); toast('已取消收藏'); }
      else { favs.add(key); star.classList.add('on'); toast('已加入收藏'); }
      store.set('favs', [...favs]);
      return;
    }
    if (e.target.closest('a')) return;
    const card = e.target.closest('.card');
    if (card) {
      if (settings.zh === 'tap') card.classList.toggle('revealed');
      if (settings.tts === 'on') {
        stopAuto(false);
        document.querySelectorAll('.card.speaking').forEach(c => c.classList.remove('speaking'));
        card.classList.add('speaking');
        speak(card.querySelector('.en').textContent, () => card.classList.remove('speaking'));
      }
    }
  });

  let autoIdx = -1;
  function stopAuto(cancel = true) {
    if (autoIdx >= 0 && cancel && synth) synth.cancel();
    autoIdx = -1;
    const f = $('.fab'); if (f) f.innerHTML = playIcon;
  }
  const playIcon = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>';
  const stopIcon = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
  function autoNext() {
    const cards = [...document.querySelectorAll('#view .card')];
    document.querySelectorAll('.card.speaking').forEach(c => c.classList.remove('speaking'));
    if (autoIdx < 0 || autoIdx >= cards.length) { stopAuto(false); return; }
    const card = cards[autoIdx];
    card.classList.add('speaking');
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    speak(card.querySelector('.en').textContent, () => {
      if (autoIdx < 0) return;
      setTimeout(() => { if (autoIdx >= 0) { autoIdx++; autoNext(); } }, 700);
    });
  }

  function renderReader(ci, si) {
    stopAuto();
    const c = DATA[ci], s = c && c.secs[si];
    if (!s) { location.hash = '#/'; return; }
    store.set('last', [ci, si]);
    readSet.add(ci + '.' + si); store.set('read', [...readSet]);
    setBar(`${secCode(ci, si)} ${s.t}`, c.n === 0 ? c.name : `第${c.n}章 ${c.name}`, true);
    const pos = FLAT.findIndex(([a, b]) => a === ci && b === si);
    const prev = FLAT[pos - 1], next = FLAT[pos + 1];
    const link = (p, cls, label) => p
      ? `<a class="${cls}" href="#/r/${p[0]}/${p[1]}"><small>${label}</small><span>${esc(secCode(p[0], p[1]) + ' ' + DATA[p[0]].secs[p[1]].t)}</span></a>`
      : `<span class="empty"></span>`;
    view.innerHTML = `<div class="reader-head"><div class="crumb">${esc(c.n === 0 ? c.name : '第' + c.n + '章 · ' + c.name)}</div>
        <h1>${esc(s.t)}</h1></div>
      <p class="hint">${s.p.length} 句 · ${synth ? '点击句子朗读英文' : ''}${settings.zh === 'tap' ? '，点击显示中文' : ''}</p>
      <div class="${isVocab(s) ? 'vocab' : ''}">
        ${s.p.map(([en, zh], pi) => cardHTML(esc(en), esc(zh), `${ci}.${si}.${pi}`, `<div class="idx">${pi + 1}</div>`)).join('')}
      </div>
      <nav class="pager">${link(prev, 'prev', '‹ 上一节')}${link(next, 'next', '下一节 ›')}</nav>
      ${synth ? `<button class="fab" aria-label="连续朗读">${playIcon}</button>` : ''}`;
    const fab = $('.fab');
    if (fab) fab.onclick = () => {
      if (autoIdx >= 0) { stopAuto(); return; }
      const cards = [...document.querySelectorAll('#view .card')];
      const mid = window.innerHeight / 2;
      let start = cards.findIndex(c => c.getBoundingClientRect().bottom > 80);
      autoIdx = Math.max(0, start);
      fab.innerHTML = stopIcon;
      autoNext();
    };
    window.scrollTo(0, 0);
  }

  const fromLink = (ci, si) => `<a class="from" href="#/r/${ci}/${si}">${esc(secCode(ci, si) + ' ' + DATA[ci].secs[si].t)} ›</a>`;

  function highlight(text, q) {
    const t = esc(text);
    if (!q) return t;
    const re = new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return t.replace(re, '<mark>$1</mark>');
  }

  function renderSearch(q0) {
    stopAuto();
    setBar('搜索', '英文或中文关键词', true);
    view.innerHTML = `<div class="search-box"><input id="q" type="search" placeholder="例如：brush teeth / 刷牙" autocomplete="off" enterkeyhint="search"></div>
      <div id="results"></div>`;
    const input = $('#q'), out = $('#results');
    input.value = q0 || '';
    const run = () => {
      const q = input.value.trim();
      history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
      if (!q || (!/[㐀-鿿]/.test(q) && q.length < 2)) {
        out.innerHTML = `<div class="empty-state">输入关键词搜索全部 ${FLAT.length} 个小节的句子</div>`; return;
      }
      const ql = q.toLowerCase(); const res = [];
      DATA.forEach((c, ci) => c.secs.forEach((s, si) => s.p.forEach(([en, zh], pi) => {
        if (en.toLowerCase().includes(ql) || zh.includes(q)) res.push([ci, si, pi, en, zh]);
      })));
      const shown = res.slice(0, 200);
      out.innerHTML = `<div class="result-meta">找到 ${res.length} 句${res.length > 200 ? '（显示前 200 句）' : ''}</div>` +
        (shown.length ? shown.map(([ci, si, pi, en, zh]) => cardHTML(highlight(en, q), highlight(zh, q), `${ci}.${si}.${pi}`, '', fromLink(ci, si))).join('')
          : '<div class="empty-state">没有找到相关句子</div>');
    };
    let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 180); });
    run();
    if (!q0) setTimeout(() => input.focus(), 50);
  }

  function renderFav() {
    stopAuto();
    setBar('我的收藏', `${favs.size} 句`, true);
    const items = [...favs].map(k => k.split('.').map(Number)).filter(([ci, si, pi]) => DATA[ci] && DATA[ci].secs[si] && DATA[ci].secs[si].p[pi]);
    view.innerHTML = items.length ? items.map(([ci, si, pi]) => {
      const [en, zh] = DATA[ci].secs[si].p[pi];
      return cardHTML(esc(en), esc(zh), `${ci}.${si}.${pi}`, '', fromLink(ci, si));
    }).join('') : '<div class="empty-state">还没有收藏。阅读时点句子右上角的 ☆ 即可收藏。</div>';
    window.scrollTo(0, 0);
  }

  // ---------- router ----------
  let lastRoute = '';
  function route() {
    if (lastRoute === '#/' || lastRoute === '') store.set('homeScroll', window.scrollY);
    const h = location.hash || '#/';
    lastRoute = h;
    let m;
    if ((m = h.match(/^#\/r\/(\d+)\/(\d+)/))) renderReader(+m[1], +m[2]);
    else if ((m = h.match(/^#\/search(?:\?q=(.*))?/))) renderSearch(m[1] ? decodeURIComponent(m[1]) : '');
    else if (h.startsWith('#/fav')) renderFav();
    else renderHome();
    view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '#/').replace(/\?.*$/, '');
    if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
    else if (navStack[navStack.length - 1] !== h) navStack.push(h);
    route();
  });
  window.addEventListener('scroll', () => { if (lastRoute === '#/' || lastRoute === '') { clearTimeout(route._s); route._s = setTimeout(() => store.set('homeScroll', window.scrollY), 150); } }, { passive: true });

  applySettings();
  view.innerHTML = '<div class="empty-state">正在加载…</div>';
  fetch('data.json').then(r => r.json()).then(d => {
    DATA = d; FLAT = flatIndex(); navStack.push((location.hash || '#/').replace(/\?.*$/, '')); route();
  }).catch(() => { view.innerHTML = '<div class="empty-state">加载失败，请检查网络后重试。</div>'; });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
