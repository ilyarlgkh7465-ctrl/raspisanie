(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const DAY = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const DAY_S = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const DAY_ACC = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const TYPE = { lec: 'Лекция', prac: 'Практика', lab: 'Лабораторная', oiz: 'ОИЗ', pe: 'Физкультура' };
  const FIELD = { room: 'аудитория', b: 'корпус', who: 'преподаватель', s: 'предмет', t: 'тип занятия', p: 'пара' };
  const KIND = {
    dz: { short: 'ДЗ', long: 'Домашнее задание' },
    sr: { short: 'СР', long: 'Самостоятельная работа' },
    note: { short: 'Староста', long: 'Комментарий' },
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('rasp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rasp.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem('rasp.' + k); } catch (e) {} },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = s => esc(s)
    .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .replace(/\n/g, '<br>');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ?now=2026-11-09T09:00 — подменить текущее время (для проверки), ?date=2026-11-12 — открыть день
  const qs = new URLSearchParams(location.search);
  const NOW = qs.get('now');
  const now = () => (NOW ? new Date(NOW) : new Date());

  /* ---------- Платформа и установка ---------- */
  const UA = navigator.userAgent;
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(UA);
  const STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (S) render(); });
  window.addEventListener('appinstalled', () => { installEvt = null; store.set('installHide', true); if (S) render(); });

  /* ---------- Telegram ---------- */
  let tg = null;
  const tgHome = { supported: false, status: 'unknown' };
  function initTg() {
    const w = window.Telegram && window.Telegram.WebApp;
    if (!w || !w.initData) return;
    tg = w;
    const root = document.documentElement;
    root.classList.add('tg');
    const scheme = () => {
      root.classList.toggle('dark', tg.colorScheme === 'dark');
      root.classList.toggle('light', tg.colorScheme !== 'dark');
    };
    scheme();
    tg.onEvent('themeChanged', scheme);
    try { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor('secondary_bg_color'); } catch (e) {}
    try { tg.disableVerticalSwipes(); } catch (e) {}
    try {
      if (tg.isVersionAtLeast('8.0') && typeof tg.addToHomeScreen === 'function') {
        tgHome.supported = true;
        tg.checkHomeScreenStatus(st => { tgHome.status = st; if (S) render(); });
        tg.onEvent('homeScreenAdded', () => { tgHome.status = 'added'; if (S) render(); });
      }
    } catch (e) {}
    tg.ready();
    tg.expand();
  }
  const haptic = (kind) => {
    try {
      if (!tg) return;
      if (kind) tg.HapticFeedback.notificationOccurred(kind);
      else tg.HapticFeedback.selectionChanged();
    } catch (e) {}
  };
  function ask(msg) {
    if (tg && tg.showConfirm) return new Promise(r => { try { tg.showConfirm(msg, ok => r(!!ok)); } catch (e) { r(confirm(msg)); } });
    return Promise.resolve(confirm(msg));
  }

  /* ---------- Даты ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
  const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 864e5);
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
  const fmtDay = d => `${d.getDate()} ${MON[d.getMonth()]}`;
  const fmtDur = m => (m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`);

  /* ---------- Данные ---------- */
  let S = null;
  let CH = { items: [] };
  let TASKS = { items: [] };
  let online = true;
  const state = {
    date: null,
    weekendJump: false,
    prefs: store.get('prefs', { lab: null, eng: null }),
    key: store.get('adminKey', ''),
    admin: false,
    rendered: [],
  };

  const weekNo = d => {
    const w = Math.floor(dayDiff(mondayOf(d), parseYmd(S.weekAnchor)) / 7);
    return (((w % 2) + 2) % 2) + 1;
  };
  const span = p => [toMin(S.pairs[p - 1].start), toMin(S.pairs[p - 1].end)];

  // all=true — без фильтра по подгруппам
  function lessonsFor(date, all) {
    const key = ymd(date);
    const w = weekNo(date);
    const inTerm = key >= S.period.from && key <= S.period.to;
    if (!inTerm) return { list: [], w, inTerm, dayNotes: [] };

    let list = (S.days[String(date.getDay())] || [])
      .filter(l => !l.w || l.w === w)
      .map(l => Object.assign({}, l));

    // Правки поверх основного расписания
    for (const c of CH.items || []) {
      if (c.date !== key) continue;
      if (c.add) {
        list.push(Object.assign({}, c.add, { p: c.pair || c.add.p, added: true, note: c.note || c.add.note }));
        continue;
      }
      for (const l of list) {
        if (l.p !== c.pair) continue;
        if (c.split && (l.split !== c.split || l.opt !== c.opt)) continue;
        if (c.cancel) l.cancel = true;
        if (c.change) { l.changed = Object.keys(c.change); Object.assign(l, c.change); }
        if (c.note) l.note = c.note;
      }
    }

    // Комментарии старосты: «пары не будет», другая аудитория, заметка
    const dayNotes = [];
    for (const n of TASKS.items || []) {
      if (n.kind !== 'note' || n.date !== key) continue;
      if (!n.pair) {
        dayNotes.push(n);
        if (n.cancel) list.forEach(l => { l.cancel = true; });
        continue;
      }
      for (const l of list) {
        if (!taskMatches(n, l)) continue;
        if (n.cancel) l.cancel = true;
        if (n.room) { l.room = n.room; l.changed = (l.changed || []).concat('room'); }
        (l.notes = l.notes || []).push(n);
      }
    }

    if (!all) list = list.filter(l => !l.split || !state.prefs[l.split] || state.prefs[l.split] === l.opt);
    list.sort((a, b) => a.p - b.p || String(a.opt || '').localeCompare(String(b.opt || '')));
    return { list, w, inTerm, dayNotes };
  }

  const active = list => list.filter(l => !l.cancel);

  function nextFirst(from) {
    for (let i = 1; i <= 14; i++) {
      const d = addDays(from, i);
      const a = active(lessonsFor(d).list);
      if (a.length) return { d, l: a[0] };
    }
    return null;
  }

  /* ---------- Задания (ДЗ и СР) ---------- */
  const taskVisible = t => !t.split || !state.prefs[t.split] || state.prefs[t.split] === t.opt;
  const itemsOn = key => (TASKS.items || []).filter(t => t.date === key && taskVisible(t));
  const tasksOn = key => itemsOn(key).filter(t => t.kind !== 'note');
  const taskMatches = (t, l) => t.pair === l.p && t.s === l.s && (!t.split || (t.split === l.split && t.opt === l.opt));

  // Следующая такая же пара (тот же предмет и тип, та же подгруппа)
  function nextOccurrence(l, fromKey) {
    const from = parseYmd(fromKey);
    const same = (x, strict) => x.s === l.s && !x.cancel && (!strict || x.t === l.t) &&
      (!l.split || (x.split === l.split && x.opt === l.opt));
    for (const strict of [true, false]) {
      for (let i = 1; i <= 28; i++) {
        const d = addDays(from, i);
        const x = lessonsFor(d, true).list.find(y => same(y, strict));
        if (x) return { date: ymd(d), p: x.p };
      }
    }
    return null;
  }

  function upcomingTasks() {
    const today = ymd(now());
    return (TASKS.items || [])
      .filter(t => t.date >= today && taskVisible(t))
      .sort((a, b) => (a.date + pad(a.pair)).localeCompare(b.date + pad(b.pair)));
  }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (state.key) headers['X-Admin-Key'] = state.key;
    const r = await fetch('api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
    return j;
  }

  async function checkAdmin(key) {
    try {
      const prev = state.key;
      state.key = key;
      const me = await api('GET', 'me');
      if (!me.admin) state.key = prev;
      return !!me.admin;
    } catch (e) {
      return /попыт/.test(e.message) ? e.message : null; // слишком много попыток или нет сети
    }
  }

  /* ---------- Отрисовка ---------- */
  const I = {
    book: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7"/></svg>',
    share: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    kebab: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    down: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/></svg>',
    phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/></svg>',
  };

  function relLabel(d) {
    const diff = dayDiff(d, now());
    return diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : diff === -1 ? 'вчера' : '';
  }

  function rangeLabel(a, b) {
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${b.getDate()} ${MON[a.getMonth()]}`
      : `${fmtDay(a)} – ${fmtDay(b)}`;
  }

  function renderHeader() {
    const d = state.date;
    $('#dayName').textContent = DAY[d.getDay()];
    const r = relLabel(d);
    $('#rel').textContent = r;
    $('#rel').hidden = !r;
    $('#dayDate').textContent = fmtDay(d);
    $('#weekNo').textContent = `${weekNo(d)}-я неделя`;
    $('#adm').hidden = !state.admin;
    document.title = `Расписание ${S.group}`;

    const parts = [];
    for (const [k, sp] of Object.entries(S.splits)) {
      const v = state.prefs[k];
      if (v) parts.push(sp.short[v]);
    }
    $('#prefsLabel').textContent = parts.length ? parts.join(' · ') : 'Подгруппа';

    const soon = upcomingTasks().filter(t => dayDiff(parseYmd(t.date), now()) <= 7).length;
    const b = $('#tasksBadge');
    b.textContent = soon;
    b.hidden = !soon;
  }

  function renderStrip() {
    const mon = mondayOf(state.date);
    const fri = addDays(mon, 4);
    $('#range').textContent = rangeLabel(mon, fri);
    const today = ymd(now());
    const sel = ymd(state.date);
    let html = '';
    for (let i = 0; i < 5; i++) {
      const d = addDays(mon, i);
      const k = ymd(d);
      const has = active(lessonsFor(d).list).length > 0;
      const ts = itemsOn(k);
      const dot = ts.length ? `<i class="mark${ts.some(t => t.kind === 'note' && t.cancel) ? ' x' : ts.some(t => t.kind === 'sr') ? ' sr' : ''}"></i>` : '';
      const cls = ['day', k === sel && 'sel', k === today && 'today', !has && 'off'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-d="${k}" aria-pressed="${k === sel}" aria-label="${DAY[d.getDay()]}, ${fmtDay(d)}${ts.length ? ', есть задания' : ''}"><span>${DAY_S[d.getDay()]}</span><b>${d.getDate()}</b>${dot}</button>`;
    }
    $('#strip').innerHTML = html;
  }

  function where(l) {
    const room = l.room ? `<b>${esc(l.room)}</b>` : '';
    const b = l.b ? `<span>корп. ${esc(l.b)}</span>` : '';
    if (!room && !b) return '';
    return `<div class="where${l.room && l.room.length > 5 ? ' long' : ''}">${room}${b}</div>`;
  }

  function taskHtml(t) {
    const edit = state.admin ? ` data-task="${esc(t.id)}" role="button" tabindex="0"` : '';
    return `<div class="task k-${esc(t.kind)}${state.admin ? ' editable' : ''}"${edit}>
      <span class="tk">${KIND[t.kind] ? KIND[t.kind].short : 'ДЗ'}</span>
      <span class="tx">${t.text ? linkify(t.text) : esc(KIND[t.kind] ? KIND[t.kind].long : '')}</span>
    </div>`;
  }

  function noteText(n) {
    if (n.text) return linkify(n.text);
    if (n.cancel) return n.pair ? 'Пары не будет' : 'Пар не будет';
    if (n.room) return `Перенесли в ${esc(n.room)}`;
    return '';
  }
  function noteHtml(n) {
    const edit = state.admin ? ` data-task="${esc(n.id)}" role="button" tabindex="0"` : '';
    return `<div class="task ${n.cancel ? 'k-cancel' : 'k-note'}${state.admin ? ' editable' : ''}"${edit}>
      <span class="tk">Староста</span><span class="tx">${noteText(n)}</span></div>`;
  }
  function dayNoteHtml(n) {
    const edit = state.admin ? ` data-task="${esc(n.id)}" role="button" tabindex="0"` : '';
    return `<div class="card daynote ${n.cancel ? 'k-cancel' : 'k-note'}${state.admin ? ' editable' : ''}"${edit}>
      <div class="lbl">Староста · весь день</div>
      <p>${n.cancel ? '<b>Пар не будет.</b> ' : ''}${n.text ? linkify(n.text) : ''}</p></div>`;
  }

  function lessonCard(l, idx, isNow, tasks) {
    const P = S.pairs[l.p - 1];
    const sp = l.split && S.splits[l.split];
    const splitTag = sp && !state.prefs[l.split] ? `<span class="tag">${esc(sp.short[l.opt])}</span>` : '';
    const status = l.cancel ? '<span class="chip x">Отменена</span>' : l.added ? '<span class="chip add">Добавлена</span>' : '';
    const changed = l.changed && l.changed.length && !l.cancel
      ? `<p class="flag">Изменено: ${esc(l.changed.map(f => FIELD[f] || f).join(', '))}</p>` : '';
    const notes = l.notes || [];
    const tasksBlock = tasks.length || notes.length
      ? `<div class="tasks">${notes.map(noteHtml).join('')}${tasks.map(taskHtml).join('')}</div>` : '';
    const add = state.admin ? `<button type="button" class="addtask" data-add="${idx}">+ Добавить</button>` : '';
    return `<article class="lesson t-${esc(l.t)}${isNow ? ' now' : ''}${l.cancel ? ' cancel' : ''}">
      <div class="when"><b>${P.start}</b><span>${P.end}</span><i>${l.p} пара</i></div>
      <div class="what">
        <div class="tags"><span class="chip">${esc(TYPE[l.t] || 'Занятие')}</span>${status}${splitTag}</div>
        <h3>${esc(l.s)}</h3>
        ${l.who ? `<p class="who">${esc(l.who)}</p>` : ''}
        ${changed}
        ${l.note ? `<p class="note">${esc(l.note)}</p>` : ''}
        ${tasksBlock}
        ${add}
      </div>
      ${where(l)}
    </article>`;
  }

  function placeText(l) {
    return [l.room && `ауд. ${l.room}`, l.b && `корп. ${l.b}`].filter(Boolean).join(', ');
  }

  // Карточка «сейчас / дальше» — только для сегодняшнего дня
  function renderStatus() {
    const box = $('#status');
    const d = state.date;
    const today = startOfDay(now());
    let html = '';

    if (state.weekendJump && dayDiff(d, today) > 0 && dayDiff(d, today) <= 2) {
      const f = active(lessonsFor(d).list)[0];
      const when = dayDiff(d, today) === 1 ? 'Завтра' : cap(DAY_ACC[d.getDay()]);
      html = `<div class="card status"><div class="lbl">Выходной</div>
        <div class="ttl">${f ? `${when} к ${S.pairs[f.p - 1].start}` : 'Показываем следующую неделю'}</div>
        ${f ? `<div class="det">${esc(f.s)}${placeText(f) ? ', ' + esc(placeText(f)) : ''}</div>` : ''}</div>`;
    } else if (dayDiff(d, today) === 0) {
      const list = active(lessonsFor(d).list);
      const t = now();
      const m = t.getHours() * 60 + t.getMinutes();
      const cur = list.find(l => { const [s, e] = span(l.p); return m >= s && m < e; });
      const next = list.find(l => span(l.p)[0] > m);

      if (cur) {
        const [s, e] = span(cur.p);
        const pct = Math.round(((m - s) / (e - s)) * 100);
        html = `<div class="card status"><div class="lbl"><i class="live"></i>Сейчас · ${cur.p} пара</div>
          <div class="ttl">${esc(cur.s)}</div>
          <div class="det">${esc(placeText(cur) || 'без аудитории')} · до ${S.pairs[cur.p - 1].end}, ещё ${fmtDur(e - m)}</div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>`;
      } else if (next) {
        const first = next === list[0];
        html = `<div class="card status"><div class="lbl">${first ? 'Первая пара' : 'Дальше'}</div>
          <div class="ttl">${esc(next.s)}</div>
          <div class="det">в ${S.pairs[next.p - 1].start}${placeText(next) ? ', ' + esc(placeText(next)) : ''} · через ${fmtDur(span(next.p)[0] - m)}</div></div>`;
      } else {
        const nf = nextFirst(today);
        const when = nf ? (dayDiff(nf.d, today) === 1 ? 'Завтра' : cap(DAY_ACC[nf.d.getDay()])) : '';
        html = `<div class="card status"><div class="lbl">${list.length ? 'На сегодня всё' : 'Сегодня пар нет'}</div>
          ${nf ? `<div class="ttl">${when} к ${S.pairs[nf.l.p - 1].start}</div><div class="det">${esc(nf.l.s)}${placeText(nf.l) ? ', ' + esc(placeText(nf.l)) : ''}</div>` : ''}</div>`;
      }
    }
    box.innerHTML = html;
  }

  function showInstallCard() {
    if (STANDALONE || store.get('installHide', false)) return false;
    if (tg) return tgHome.supported && tgHome.status !== 'added' && tgHome.status !== 'unsupported';
    return IS_IOS || IS_ANDROID;
  }

  function renderCards() {
    const needSetup = Object.keys(S.splits).some(k => state.prefs[k] == null);
    let html = '';
    if (needSetup) {
      html = `<div class="card setup"><p><b>Выбери свою подгруппу</b>Тогда останутся только твои пары</p><button type="button" data-open="settings">Выбрать</button></div>`;
    } else if (showInstallCard()) {
      html = `<div class="card setup install"><span class="ico">${I.phone}</span><p><b>Значок на экран</b>Открывай как приложение</p><button type="button" data-open="install">Как?</button><button type="button" class="x" data-hide-install aria-label="Скрыть">×</button></div>`;
    }
    $('#setup').innerHTML = html;
  }

  function renderList(dir) {
    const d = state.date;
    const key = ymd(d);
    const { list, inTerm, dayNotes } = lessonsFor(d);
    const full = lessonsFor(d, true).list;
    const dayTasks = tasksOn(key);
    const isToday = dayDiff(d, now()) === 0;
    let curPair = null;
    if (isToday) {
      const t = now();
      const m = t.getHours() * 60 + t.getMinutes();
      const cur = active(list).find(l => { const [s, e] = span(l.p); return m >= s && m < e; });
      if (cur) curPair = cur.p;
    }

    state.rendered = list;
    let html = dayNotes.map(dayNoteHtml).join('');
    if (!inTerm) {
      html = `<div class="empty"><b>Вне семестра</b><span>Расписание действует с ${fmtDay(parseYmd(S.period.from))} по ${fmtDay(parseYmd(S.period.to))}</span></div>`;
    } else if (isWeekend(d)) {
      html = `<div class="empty"><b>Выходной</b><span>Пар нет</span></div>`;
    } else if (!list.length) {
      html = `<div class="empty"><b>Пар нет</b><span>Свободный день</span></div>`;
    } else {
      const ps = list.map(l => l.p);
      const lo = Math.min(...ps), hi = Math.max(...ps);
      for (let p = lo; p <= hi; p++) {
        const at = list.filter(l => l.p === p);
        if (!at.length) {
          html += `<div class="gap">окно · ${p} пара, ${S.pairs[p - 1].start}–${S.pairs[p - 1].end}</div>`;
          continue;
        }
        for (const l of at) {
          html += lessonCard(l, list.indexOf(l), p === curPair && !l.cancel, dayTasks.filter(t => taskMatches(t, l)));
        }
      }
    }
    // Задания, которые не привязались ни к одной паре (например, пару убрали)
    const orphan = itemsOn(key).filter(t => t.pair && !full.some(l => taskMatches(t, l)));
    if (orphan.length) {
      html += `<div class="card orphan"><div class="lbl">Отметки на этот день</div>${orphan.map(t =>
        `<div class="osub">${esc(t.s)} · ${t.pair} пара</div>${t.kind === 'note' ? noteHtml(t) : taskHtml(t)}`).join('')}</div>`;
    }
    if (state.admin && inTerm) html += '<button type="button" class="addtask wide" data-addday>+ Комментарий ко всему дню</button>';

    const el = $('#list');
    el.innerHTML = html;
    if (dir) {
      el.classList.remove('in-next', 'in-prev');
      void el.offsetWidth;
      el.classList.add(dir > 0 ? 'in-next' : 'in-prev');
    }
  }

  function renderFoot() {
    const from = fmtDay(parseYmd(S.period.from));
    const to = fmtDay(parseYmd(S.period.to));
    const upd = [S.updated, CH.updated, (TASKS.updated || '').slice(0, 10)].filter(Boolean).sort().pop();
    const links = [];
    if (!STANDALONE) links.push('<button type="button" class="link" data-open="install">Установить на телефон</button>');
    links.push(state.admin
      ? '<button type="button" class="link" data-open="admin">Режим старосты</button>'
      : '<button type="button" class="link" data-open="admin">Вход для старосты</button>');
    $('#foot').innerHTML = `Группа ${esc(S.group)} · семестр ${from} – ${to}<br>Данные от ${upd ? fmtDay(parseYmd(upd)) : '—'}${online ? '' : '<br><span class="off">Нет сети — показана сохранённая версия</span>'}<div class="links">${links.join('<span>·</span>')}</div>`;
  }

  function render(dir) {
    renderHeader();
    renderStrip();
    renderStatus();
    renderCards();
    renderList(dir);
    renderFoot();
  }

  /* ---------- Навигация ---------- */
  function go(date, dir) {
    if (ymd(date) === ymd(state.date)) return;
    state.date = startOfDay(date);
    state.weekendJump = false;
    haptic();
    render(dir);
  }
  function shiftDay(n) {
    let d = addDays(state.date, n);
    while (isWeekend(d)) d = addDays(d, n);
    go(d, n);
  }
  function initialDate() {
    const q = qs.get('date');
    if (q) return parseYmd(q);
    let d = startOfDay(now());
    if (d.getDay() === 6) { d = addDays(d, 2); state.weekendJump = true; }
    else if (d.getDay() === 0) { d = addDays(d, 1); state.weekendJump = true; }
    return d;
  }

  /* ---------- Окна (нижние листы) ---------- */
  let sheetKind = null;
  let sheetCtx = {};

  function openSheet(kind, ctx) {
    sheetKind = kind;
    sheetCtx = ctx || {};
    paintSheet();
    $('#sheet').classList.add('open');
    if (tg) { try { tg.BackButton.show(); } catch (e) {} }
    const f = $('#sheetContent [autofocus]');
    if (f && !IS_IOS) setTimeout(() => f.focus(), 250);
  }

  function closeSheet() {
    if (!sheetKind) return;
    const kind = sheetKind;
    sheetKind = null;
    $('#sheet').classList.remove('open');
    if (tg) { try { tg.BackButton.hide(); } catch (e) {} }
    if (document.activeElement) document.activeElement.blur();
    if (kind === 'settings') {
      // Закрыли, ничего не выбрав, — показываем обе подгруппы и больше не спрашиваем
      let changed = false;
      for (const k of Object.keys(S.splits)) if (state.prefs[k] == null) { state.prefs[k] = ''; changed = true; }
      if (changed) store.set('prefs', state.prefs);
    }
    render();
  }

  function paintSheet() {
    const html = {
      settings: settingsHtml,
      tasks: tasksHtml,
      install: installHtml,
      admin: adminHtml,
      editor: editorHtml,
    }[sheetKind]();
    $('#sheetContent').innerHTML = html;
  }

  function seg(act, items, cur) {
    return `<div class="seg">${items.map(([v, name]) =>
      `<button type="button" data-act="${act}" data-v="${esc(v)}" class="${cur === v ? 'on' : ''}">${name}</button>`).join('')}</div>`;
  }

  function settingsHtml() {
    let html = `<h2>Мои подгруппы</h2><p class="hint">Выбери свои — чужие пары пропадут из расписания. Сохраняется на этом телефоне.</p>`;
    for (const [k, sp] of Object.entries(S.splits)) {
      const items = Object.entries(sp.options).map(([o, name]) => [o, esc(name)]).concat([['', 'Обе']]);
      html += `<div class="field"><div class="label">${esc(sp.title)}</div>${seg('pref:' + k, items, state.prefs[k])}`;
      if (sp.hint) html += `<p class="hint">${esc(sp.hint)}</p>`;
      html += '</div>';
    }
    return html + `<button type="button" class="done" data-act="close">Готово</button>`;
  }

  function plainNote(n) {
    if (n.text) return n.text;
    if (n.cancel) return n.pair ? 'Пары не будет' : 'Пар не будет';
    if (n.room) return `Перенесли в ${n.room}`;
    return '';
  }

  function tasksHtml() {
    const list = upcomingTasks();
    let html = `<h2>Задания</h2><p class="hint">ДЗ, самостоятельные и комментарии старосты.${state.admin ? ' Добавить — кнопкой «+ Добавить» на паре.' : ''}</p>`;
    if (!list.length) return html + `<div class="empty flat"><b>Пока ничего нет</b><span>Как только появятся — будут здесь и на парах</span></div><button type="button" class="done" data-act="close">Закрыть</button>`;
    let last = '';
    html += '<div class="tlist">';
    for (const t of list) {
      if (t.date !== last) {
        last = t.date;
        const d = parseYmd(t.date);
        const r = relLabel(d);
        html += `<div class="tdate">${DAY[d.getDay()]}, ${fmtDay(d)}${r ? ` · ${r}` : ''}</div>`;
      }
      const isNote = t.kind === 'note';
      const label = isNote ? (t.cancel ? 'Отмена' : 'Инфо') : (KIND[t.kind] ? KIND[t.kind].short : 'ДЗ');
      const cls = isNote ? (t.cancel ? 'k-cancel' : 'k-note') : 'k-' + t.kind;
      const P = S.pairs[t.pair - 1];
      const text = isNote ? plainNote(t) : t.text;
      html += `<button type="button" class="titem" data-act="goto" data-v="${esc(t.date)}">
        <span class="tk ${esc(cls)}">${label}</span>
        <span class="tb"><b>${t.pair ? esc(t.s) : 'Весь день'}</b>${t.pair ? `<i>${t.pair} пара${P ? ', ' + P.start : ''}</i>` : ''}
        ${text ? `<span class="tt">${esc(text)}</span>` : ''}</span>
      </button>`;
    }
    return html + `</div><button type="button" class="done" data-act="close">Закрыть</button>`;
  }

  function installHtml() {
    const plat = sheetCtx.plat || (IS_ANDROID ? 'android' : 'ios');
    const steps = arr => `<ol class="steps">${arr.map(([ico, text]) => `<li><span class="si">${ico}</span><p>${text}</p></li>`).join('')}</ol>`;
    let html = `<h2>Установить на телефон</h2><p class="hint">Значок на главном экране: расписание в одно касание, без браузера. После первого открытия работает и без интернета.</p>`;
    if (tg && tgHome.supported && tgHome.status !== 'added') {
      html += `<button type="button" class="done" data-act="tghome">Добавить на главный экран</button>
        <p class="hint center">Telegram сам создаст значок. Или поставь через браузер:</p>`;
    }
    html += `<div class="field">${seg('plat', [['ios', 'iPhone'], ['android', 'Android']], plat)}</div>`;
    if (plat === 'ios') {
      html += steps([
        [I.share, 'Открой ссылку в <b>Safari</b> и нажми <b>«Поделиться»</b>. В новых iOS эта кнопка прячется за <b>•••</b> рядом с адресной строкой.'],
        [I.plus, 'Пролистай список и выбери <b>«На экран „Домой“»</b>. Если пункта не видно — нажми <b>«Ещё»</b>.'],
        [I.check, 'Нажми <b>«Добавить»</b>. Появится значок «Расписание», открывается как приложение.'],
      ]);
    } else {
      if (installEvt) html += `<button type="button" class="done" data-act="install">Установить приложение</button><p class="hint center">Или вручную:</p>`;
      html += steps([
        [I.kebab, 'Открой ссылку в <b>Chrome</b> и нажми <b>⋮</b> в правом верхнем углу.'],
        [I.down, 'Выбери <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.'],
        [I.check, 'Нажми <b>«Установить»</b>. «Расписание» появится среди приложений.'],
      ]);
    }
    html += `<button type="button" class="ghost" data-act="copylink">Скопировать ссылку</button>`;
    return html + `<button type="button" class="done soft" data-act="close">Понятно</button>`;
  }

  function adminHtml() {
    if (state.admin) {
      return `<h2>Режим старосты</h2>
        <p class="hint">На каждой паре есть «+ Добавить»: ДЗ, самостоятельная или комментарий — «пары не будет», другая аудитория, любая заметка. Внизу дня — комментарий ко всему дню. Нажми на добавленное, чтобы исправить или удалить. Остальные всё видят, но менять не могут.</p>
        <button type="button" class="done" data-act="close">Хорошо</button>
        <button type="button" class="ghost danger" data-act="logout">Выйти из режима старосты</button>`;
    }
    return `<h2>Вход для старосты</h2>
      <p class="hint">Код выдаёт тот, кто ведёт расписание. Остальным он не нужен — смотреть можно и так.</p>
      <form class="field" data-form="login">
        <input class="input" id="adminCode" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Код старосты" autofocus>
        <p class="err" id="adminErr" hidden></p>
        <button type="submit" class="done">Войти</button>
      </form>
      <button type="button" class="ghost" data-act="close">Отмена</button>`;
  }

  function editorHtml() {
    const c = sheetCtx;
    const l = c.lesson;
    const d = parseYmd(c.date);
    const when = `${DAY[d.getDay()]}, ${fmtDay(d)}`;
    let html = l ? `<h2>${esc(l.s)}</h2><p class="hint">${when} · ${l.p} пара</p>` : `<h2>Весь день</h2><p class="hint">${when}</p>`;
    if (l) {
      const kinds = c.mode === 'edit'
        ? (c.kind === 'note' ? null : [['dz', 'ДЗ'], ['sr', 'СР']])
        : [['dz', 'ДЗ'], ['sr', 'СР'], ['note', 'Комментарий']];
      if (kinds) html += `<div class="field"><div class="label">Что отметить</div>${seg('kind', kinds, c.kind)}</div>`;
    }
    const err = '<p class="err" id="taskErr" hidden></p>';
    if (c.kind === 'note') {
      html += `<div class="field"><div class="label">${l ? 'Пара' : 'Пары в этот день'}</div>${seg('cancel', [['0', l ? 'Будет' : 'Как обычно'], ['1', 'Не будет']], c.cancel ? '1' : '0')}</div>`;
      if (l && !c.cancel) {
        html += `<div class="field"><div class="label">Другая аудитория — если поменяли</div>
          <input class="input" id="noteRoom" type="text" maxlength="40" autocomplete="off" placeholder="Сейчас: ${esc(l.room || '—')}" value="${esc(c.room || '')}"></div>`;
      }
      const optional = c.cancel || (c.room || '').trim();
      html += `<div class="field"><div class="label">Комментарий${optional ? ' — необязательно' : ''}</div>
        <textarea class="input" id="taskText" rows="3" maxlength="1500" placeholder="${l ? 'Например: ОИЗ не будет, преподаватель на конференции' : 'Например: день здоровья, пар не будет'}">${esc(c.text || '')}</textarea>${err}</div>`;
    } else {
      if (c.mode === 'new' && c.next) {
        const nd = parseYmd(c.next.date);
        html += `<div class="field"><div class="label">Где показать</div>${seg('target', [['this', 'На этой паре'], ['next', 'К следующей']], c.target)}
          <p class="hint">${c.target === 'next' ? `Появится на паре ${DAY_ACC[nd.getDay()]}, ${fmtDay(nd)}${c.kind === 'sr' ? '.' : ', — к ней надо сделать.'}` : 'Появится на этой паре.'}</p></div>`;
      }
      html += `<div class="field"><div class="label">${c.kind === 'sr' ? 'Тема или что повторить — необязательно' : 'Что задали'}</div>
        <textarea class="input" id="taskText" rows="4" maxlength="1500" placeholder="${c.kind === 'sr' ? 'Например: кинематика, формулы из лекции 3' : 'Например: № 1–5 из методички, стр. 34'}">${esc(c.text || '')}</textarea>${err}</div>`;
    }
    html += `<button type="button" class="done" data-act="tsave">${c.mode === 'new' ? 'Сохранить' : 'Сохранить изменения'}</button>`;
    html += c.mode === 'edit'
      ? '<button type="button" class="ghost danger" data-act="tdel">Удалить</button>'
      : '<button type="button" class="ghost" data-act="close">Отмена</button>';
    return html;
  }

  function openEditorNew(idx) {
    const l = state.rendered[idx];
    if (!l) return;
    const date = ymd(state.date);
    const next = nextOccurrence(l, date);
    openSheet('editor', { mode: 'new', lesson: l, date, next, kind: 'dz', target: next ? 'next' : 'this', text: '', cancel: false, room: '' });
  }

  function openEditorDay() {
    openSheet('editor', { mode: 'new', lesson: null, date: ymd(state.date), kind: 'note', text: '', cancel: false, room: '' });
  }

  function openEditorEdit(id) {
    const t = (TASKS.items || []).find(x => x.id === id);
    if (!t) return;
    const lesson = !t.pair ? null : (lessonsFor(parseYmd(t.date), true).list.find(l => taskMatches(t, l)) ||
      { s: t.s, p: t.pair, split: t.split, opt: t.opt });
    openSheet('editor', { mode: 'edit', id, lesson, date: t.date, kind: t.kind, text: t.text || '', cancel: !!t.cancel, room: t.room || '' });
  }

  function grabEditor() {
    const ta = $('#taskText');
    if (ta) sheetCtx.text = ta.value;
    const rm = $('#noteRoom');
    if (rm) sheetCtx.room = rm.value;
  }

  async function saveTask() {
    const c = sheetCtx;
    grabEditor();
    const text = (c.text || '').trim();
    const room = c.kind === 'note' && !c.cancel ? (c.room || '').trim() : '';
    const err = $('#taskErr');
    const fail = msg => { err.textContent = msg; err.hidden = false; haptic('error'); };
    if (c.kind === 'dz' && !text) return fail('Напиши, что задали');
    if (c.kind === 'note' && !text && !c.cancel && !room) return fail('Напиши комментарий или отметь, что пары не будет');
    const btn = $('[data-act="tsave"]');
    btn.disabled = true;
    const fields = { kind: c.kind, text };
    if (c.kind === 'note') Object.assign(fields, { cancel: !!c.cancel, room });
    try {
      if (c.mode === 'new') {
        const l = c.lesson;
        const target = c.kind !== 'note' && c.target === 'next' && c.next ? c.next : { date: c.date, p: l ? l.p : 0 };
        await api('POST', 'tasks', Object.assign({
          date: target.date, pair: target.p, s: l ? l.s : '',
          split: (l && l.split) || null, opt: (l && l.opt) || null,
        }, fields));
      } else {
        await api('PUT', 'tasks/' + encodeURIComponent(c.id), fields);
      }
      await loadTasks();
      haptic('success');
      closeSheet();
      const moved = c.mode === 'new' && c.kind !== 'note' && c.target === 'next' && c.next;
      toast(moved ? `Сохранено — будет ${DAY_ACC[parseYmd(c.next.date).getDay()]}, ${fmtDay(parseYmd(c.next.date))}` : 'Сохранено');
    } catch (e) {
      btn.disabled = false;
      fail(e.message === 'Failed to fetch' ? 'Нет связи с сервером' : e.message);
    }
  }

  async function deleteTask() {
    if (!(await ask('Удалить это задание?'))) return;
    try {
      await api('DELETE', 'tasks/' + encodeURIComponent(sheetCtx.id));
      await loadTasks();
      haptic('success');
      closeSheet();
      toast('Удалено');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function login(code) {
    const err = $('#adminErr');
    code = code.trim();
    if (!code) return;
    const ok = await checkAdmin(code);
    if (ok === true) {
      state.admin = true;
      store.set('adminKey', code);
      haptic('success');
      closeSheet();
      toast('Режим старосты включён');
    } else {
      err.textContent = ok === null ? 'Нет связи с сервером' : ok === false ? 'Код не подошёл' : ok;
      err.hidden = false;
      haptic('error');
    }
  }

  let toastTimer = 0;
  function toast(text, bad) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- Загрузка ---------- */
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  async function loadTasks() {
    try {
      TASKS = await getJSON('api/tasks');
      store.set('cache.tasks', TASKS);
    } catch (e) {
      TASKS = store.get('cache.tasks', { items: [] });
    }
  }
  async function loadData() {
    online = true;
    try {
      S = await getJSON('data/schedule.json');
      store.set('cache.schedule', S);
    } catch (e) {
      S = store.get('cache.schedule', null);
      online = false;
    }
    try {
      CH = await getJSON('data/changes.json');
      store.set('cache.changes', CH);
    } catch (e) {
      CH = store.get('cache.changes', { items: [] });
      online = false;
    }
    await loadTasks();
  }

  function bind() {
    $('#strip').addEventListener('click', e => {
      const b = e.target.closest('[data-d]');
      if (b) { const d = parseYmd(b.dataset.d); go(d, d > state.date ? 1 : -1); }
    });
    $('#prevWeek').addEventListener('click', () => go(addDays(state.date, -7), -1));
    $('#nextWeek').addEventListener('click', () => go(addDays(state.date, 7), 1));
    $('#range').addEventListener('click', () => {
      let d = startOfDay(now());
      while (isWeekend(d)) d = addDays(d, 1);
      go(d, d > state.date ? 1 : -1);
    });

    // Кнопки, которые открывают окна, и действия на карточках
    document.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const open = e.target.closest('[data-open]');
      if (open) { openSheet(open.dataset.open); return; }
      if (e.target.closest('[data-hide-install]')) { store.set('installHide', true); render(); return; }
      const add = e.target.closest('[data-add]');
      if (add && state.admin) { openEditorNew(Number(add.dataset.add)); return; }
      if (e.target.closest('[data-addday]') && state.admin) { openEditorDay(); return; }
      const task = e.target.closest('#list [data-task]');
      if (task && state.admin) { openEditorEdit(task.dataset.task); }
    });
    document.addEventListener('keydown', e => {
      const task = e.target.closest && e.target.closest('#list [data-task]');
      if (task && state.admin && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEditorEdit(task.dataset.task); }
    });

    // Действия внутри окна
    $('#sheet').addEventListener('click', async e => {
      if (e.target.id === 'sheet') { closeSheet(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const v = b.dataset.v;
      if (act === 'close') closeSheet();
      else if (act.startsWith('pref:')) {
        state.prefs[act.slice(5)] = v;
        store.set('prefs', state.prefs);
        haptic();
        paintSheet();
        render();
      } else if (act === 'goto') {
        const d = parseYmd(v);
        closeSheet();
        go(d, d > state.date ? 1 : -1);
      } else if (act === 'plat') {
        sheetCtx.plat = v;
        paintSheet();
      } else if (act === 'install' && installEvt) {
        installEvt.prompt();
        try { await installEvt.userChoice; } catch (err) {}
        installEvt = null;
        closeSheet();
      } else if (act === 'tghome' && tg) {
        try { tg.addToHomeScreen(); } catch (err) {}
      } else if (act === 'copylink') {
        const url = location.origin + location.pathname;
        try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch (err) { toast(url); }
      } else if (act === 'logout') {
        state.admin = false;
        state.key = '';
        store.del('adminKey');
        closeSheet();
        toast('Режим старосты выключен');
      } else if (act === 'kind' || act === 'target' || act === 'cancel') {
        grabEditor();
        if (act === 'cancel') { sheetCtx.cancel = v === '1'; if (sheetCtx.cancel) sheetCtx.room = ''; }
        else sheetCtx[act] = v;
        paintSheet();
      } else if (act === 'tsave') saveTask();
      else if (act === 'tdel') deleteTask();
    });
    $('#sheet').addEventListener('submit', e => {
      e.preventDefault();
      if (e.target.dataset.form === 'login') login($('#adminCode').value);
    });
    $('#openTasks').addEventListener('click', () => openSheet('tasks'));
    if (tg) { try { tg.BackButton.onClick(closeSheet); } catch (e) {} }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sheetKind) { closeSheet(); return; }
      if (sheetKind || /INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'ArrowRight') shiftDay(1);
      else if (e.key === 'ArrowLeft') shiftDay(-1);
    });

    // Свайп влево/вправо по списку — следующий/предыдущий день
    const list = $('#list');
    let sx = 0, sy = 0, st = 0;
    list.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    list.addEventListener('touchend', e => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 700) shiftDay(dx < 0 ? 1 : -1);
    }, { passive: true });

    // Раз в 30 секунд обновляем «сейчас», при возвращении в приложение — подтягиваем свежее
    setInterval(() => { if (!sheetKind && dayDiff(state.date, now()) === 0) { renderStatus(); renderList(); } }, 30000);
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || sheetKind) return;
      await loadData();
      if (S) render();
    });
    window.addEventListener('online', async () => { await loadData(); if (S && !sheetKind) render(); });
    window.addEventListener('offline', () => { online = false; renderFoot(); });
  }

  async function main() {
    initTg();

    // Ссылка для старосты вида …/#admin=КОД: забираем код и сразу убираем его из адреса
    let linkKey = '';
    if (location.hash.indexOf('#admin=') === 0) {
      linkKey = decodeURIComponent(location.hash.slice(7));
      history.replaceState(null, '', location.pathname + location.search);
    }

    await loadData();
    if (!S) {
      $('#list').innerHTML = '<div class="empty"><b>Не получилось загрузить</b><span>Проверь интернет и открой ещё раз</span></div>';
      return;
    }
    state.date = initialDate();
    bind();
    render();

    const key = linkKey || state.key;
    if (key) {
      const ok = await checkAdmin(key);
      if (ok === true) {
        state.admin = true;
        store.set('adminKey', key);
        if (linkKey) toast('Режим старосты включён');
        render();
      } else if (ok === false) {
        state.key = '';
        store.del('adminKey');
        if (linkKey) toast('Код старосты не подошёл', true);
      }
    }

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  main();
})();
