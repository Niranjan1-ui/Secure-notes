'use strict';
const COLORS = ['sand', 'rose', 'sky', 'mint', 'lilac', 'amber'];
const PRI = ['Low', 'Normal', 'High'];
const VIEWS = [['all', 'All notes'], ['pinned', 'Pinned'], ['favorites', 'Favorites'], ['reminders', 'Reminders'], ['archived', 'Archive'], ['trash', 'Trash']];
const state = { user: null, view: 'all', category: '', tag: '', q: '', sort: 'updated', notes: [], stats: null, mode: 'login' };
const root = document.getElementById('root');

// Safe element builder: only ever uses textContent, never innerHTML
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
const cookie = n => (document.cookie.match('(?:^|; )' + n + '=([^;]*)') || [])[1] || '';
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cookie('sn_csrf') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status });
  return data;
}
let toastTimer;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
const fmt = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDT = d => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = d => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

// ---------- auth screen ----------
function strength(p) { let s = 0; if (p.length >= 10) s++; if (p.length >= 14) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++; return s; }
function renderAuth() {
  const reg = state.mode === 'register';
  const err = h('div', { class: 'err', role: 'alert' });
  const meter = h('div', { class: 'meter' }, h('i'));
  const name = h('input', { class: 'input', id: 'name', autocomplete: 'name', required: true });
  const email = h('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'email', required: true });
  const pass = h('input', { class: 'input', id: 'pass', type: 'password', autocomplete: reg ? 'new-password' : 'current-password', required: true, oninput: e => {
    const s = strength(e.target.value), i = meter.firstChild; i.style.width = (s * 20) + '%'; i.style.background = s < 3 ? 'var(--danger)' : s < 5 ? 'var(--brass)' : 'var(--ok)'; } });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try {
      state.user = await api(reg ? '/auth/register' : '/auth/login', 'POST', { name: name.value, email: email.value, password: pass.value });
      await loadApp();
    } catch (x) { err.textContent = x.message; }
  } },
    reg && h('div', { class: 'field' }, h('label', { for: 'name' }, 'Full name'), name),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'pass' }, reg ? 'Password (10+ characters)' : 'Password'), pass, reg && meter),
    err, h('button', { class: 'btn full', type: 'submit' }, reg ? 'Create your vault' : 'Unlock vault'));
  root.replaceChildren(h('div', { class: 'auth' },
    h('section', { class: 'auth-art' },
      h('div', { class: 'brand' }, h('span', { class: 'dial' }), 'Secure Notes'),
      h('div', {}, h('h1', {}, 'Write it down. Keep it yours.'), h('p', {}, 'A private notebook with categories, tags, reminders and priorities, kept behind a locked account.')),
      h('ul', { class: 'feature-list' }, h('li', {}, 'Passwords hashed with bcrypt'), h('li', {}, 'Session in an HttpOnly cookie with CSRF protection'), h('li', {}, 'Every note checked against its owner'))),
    h('section', { class: 'auth-form' }, h('div', { class: 'card' },
      h('h2', {}, reg ? 'Create your vault' : 'Welcome back'),
      h('p', { class: 'sub' }, reg ? 'It takes under a minute.' : 'Sign in to open your notes.'),
      form,
      h('p', { class: 'switch' }, reg ? 'Already have a vault? ' : 'New here? ',
        h('button', { onclick: () => { state.mode = reg ? 'login' : 'register'; renderAuth(); } }, reg ? 'Sign in' : 'Create an account'))))));
}

// ---------- app ----------
async function loadApp() { await Promise.all([refreshNotes(), refreshStats()]); renderApp(); }
async function refreshNotes() {
  const p = new URLSearchParams({ view: state.view, sort: state.sort });
  if (state.category) p.set('category', state.category);
  if (state.tag) p.set('tag', state.tag);
  if (state.q) p.set('q', state.q);
  state.notes = await api('/notes?' + p);
}
async function refreshStats() { state.stats = await api('/stats'); }
async function reload() { await Promise.all([refreshNotes(), refreshStats()]); renderApp(); }
const setView = v => { state.view = v; state.category = ''; state.tag = ''; reload(); };

function renderApp() {
  const c = state.stats.counts, side = h('aside', { class: 'side', id: 'side' });
  const countFor = { all: c.total, pinned: c.pinned, favorites: c.favorites, reminders: c.reminders, archived: c.archived, trash: c.trash };
  side.append(
    h('div', { class: 'brand' }, h('span', { class: 'dial' }), 'Secure Notes'),
    h('button', { class: 'btn', onclick: () => openEditor() }, 'New note'),
    h('nav', { class: 'nav' }, VIEWS.map(([k, label]) => h('button', { class: state.view === k && !state.category && !state.tag ? 'on' : '', onclick: () => setView(k) }, label, h('span', { class: 'n' }, countFor[k] || 0)))),
    state.stats.categories.length ? h('div', {}, h('h4', {}, 'Categories'), h('nav', { class: 'nav' }, state.stats.categories.map(x =>
      h('button', { class: state.category === x.category ? 'on' : '', onclick: () => { state.view = 'all'; state.tag = ''; state.category = state.category === x.category ? '' : x.category; reload(); } }, x.category, h('span', { class: 'n' }, x.n))))) : null,
    state.stats.tags.length ? h('div', {}, h('h4', {}, 'Tags'), h('div', { class: 'tagcloud' }, state.stats.tags.map(x =>
      h('button', { class: 'chip' + (state.tag === x.tag ? ' on' : ''), onclick: () => { state.tag = state.tag === x.tag ? '' : x.tag; reload(); } }, '#' + x.tag)))) : null,
    h('div', { class: 'me' }, h('div', { class: 'avatar' }, (state.user.name[0] || '?').toUpperCase()),
      h('div', { class: 'who' }, h('b', {}, state.user.name), h('small', {}, state.user.email)),
      h('button', { class: 'chip', title: 'Edit profile', onclick: openProfile }, 'Edit'),
      h('button', { class: 'chip', onclick: async () => { await api('/auth/logout', 'POST'); state.user = null; state.mode = 'login'; renderAuth(); } }, 'Sign out')));

  const title = state.category || (state.tag ? '#' + state.tag : VIEWS.find(v => v[0] === state.view)[1]);
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search notes', value: state.q, 'aria-label': 'Search notes' });
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { state.q = search.value; await refreshNotes(); renderGrid(); }, 250); });
  const sort = h('select', { class: 'input', 'aria-label': 'Sort notes', onchange: e => { state.sort = e.target.value; reload(); } },
    [['updated', 'Recently edited'], ['created', 'Newest'], ['title', 'Title A to Z'], ['priority', 'Priority']].map(([v, l]) => h('option', { value: v, selected: state.sort === v }, l)));
  const stats = h('div', { class: 'stats' },
    [['Notes', c.total, true], ['Pinned', c.pinned], ['Upcoming reminders', c.reminders], ['Categories', state.stats.categories.length]].map(([l, n, a]) => h('div', { class: 'stat' + (a ? ' accent' : '') }, h('b', {}, n), h('span', {}, l))));
  const main = h('main', { class: 'main' },
    h('div', { class: 'top' }, h('button', { class: 'chip menu-btn', onclick: () => document.getElementById('side').classList.toggle('open') }, 'Menu'),
      h('h2', {}, title), search, sort,
      state.view === 'trash' && c.trash > 0 ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Permanently delete everything in Trash?')) { await api('/notes', 'DELETE'); toast('Trash emptied'); reload(); } } }, 'Empty trash') : null),
    state.view === 'all' && !state.category && !state.tag && !state.q ? stats : null,
    h('div', { id: 'grid' }));
  root.replaceChildren(h('div', { class: 'shell' }, side, main));
  renderGrid();
}

function renderGrid() {
  const g = document.getElementById('grid');
  if (!state.notes.length) {
    g.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, state.q ? 'No notes match your search' : state.view === 'trash' ? 'Trash is empty' : 'Nothing here yet'),
      h('p', {}, state.q ? 'Try a different word.' : 'Create a note to start filling your vault.'),
      state.view === 'all' && !state.q ? h('p', {}, h('button', { class: 'btn', onclick: () => openEditor() }, 'Create your first note')) : null));
    return;
  }
  g.replaceChildren(h('div', { class: 'grid' }, state.notes.map(noteCard)));
}

async function patch(n, data, msg) { await api('/notes/' + n.id, 'PATCH', data); if (msg) toast(msg); reload(); }
function noteCard(n) {
  const trash = state.view === 'trash';
  const acts = trash
    ? [['Restore', () => patch(n, { trashed: false }, 'Restored')], ['Delete forever', async () => { if (confirm('Delete this note forever?')) { await api('/notes/' + n.id, 'DELETE'); toast('Deleted'); reload(); } }]]
    : [[n.pinned ? 'Unpin' : 'Pin', () => patch(n, { pinned: !n.pinned })], [n.favorite ? 'Unfavorite' : 'Favorite', () => patch(n, { favorite: !n.favorite })],
       [n.archived ? 'Unarchive' : 'Archive', () => patch(n, { archived: !n.archived }, n.archived ? 'Unarchived' : 'Archived')], ['Trash', () => patch(n, { trashed: true }, 'Moved to Trash')]];
  const overdue = n.reminder_at && new Date(n.reminder_at) < new Date();
  return h('article', { class: 'note ' + n.color, onclick: () => !trash && openEditor(n) },
    n.pinned ? h('span', { class: 'pin' }, 'Pinned') : null,
    h('h3', {}, n.title), n.content ? h('p', {}, n.content) : null,
    h('div', { class: 'meta' }, h('span', { class: 'pri p' + n.priority, title: PRI[n.priority] + ' priority' }), h('span', { class: 'cat' }, n.category),
      n.tags.map(t => h('span', { class: 'tag' }, '#' + t)), n.favorite ? h('span', { class: 'tag' }, 'Favorite') : null,
      h('span', { class: 'date' }, 'Edited ' + fmt(n.updated_at)),
      n.reminder_at ? h('span', { class: 'rem' }, (overdue ? 'Was due ' : 'Reminder ') + fmtDT(n.reminder_at)) : null),
    h('div', { class: 'acts', onclick: e => e.stopPropagation() }, acts.map(([l, f]) => h('button', { onclick: f }, l))));
}

// ---------- editor ----------
function openEditor(n) {
  const isNew = !n; n = n || { title: '', content: '', category: 'General', tags: [], color: 'sand', priority: 1, pinned: false, favorite: false, reminder_at: null };
  let color = n.color;
  const err = h('div', { class: 'err', role: 'alert' });
  const title = h('input', { class: 'input', id: 'f-title', maxlength: 160, value: n.title, required: true });
  const content = h('textarea', { class: 'input', id: 'f-content', maxlength: 20000 }); content.value = n.content;
  const cat = h('input', { class: 'input', id: 'f-cat', maxlength: 40, value: n.category, list: 'cats' });
  const cats = h('datalist', { id: 'cats' }, ['General', 'Work', 'Personal', 'Ideas', 'Study', 'Finance', 'Health', 'Travel', ...state.stats.categories.map(c => c.category)].map(c => h('option', { value: c })));
  const tags = h('input', { class: 'input', id: 'f-tags', placeholder: 'comma, separated, tags', value: n.tags.join(', ') });
  const pri = h('select', { class: 'input', id: 'f-pri' }, PRI.map((l, i) => h('option', { value: i, selected: n.priority === i }, l)));
  const rem = h('input', { class: 'input', id: 'f-rem', type: 'datetime-local', value: toLocalInput(n.reminder_at) });
  const pinned = h('input', { type: 'checkbox', checked: n.pinned }), fav = h('input', { type: 'checkbox', checked: n.favorite });
  const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Note color' }, COLORS.map(c =>
    h('button', { type: 'button', class: 'sw ' + c + (c === color ? ' on' : ''), 'aria-label': c, onclick: e => { color = c; sw.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const close = () => scrim.remove();
  const scrim = h('div', { class: 'scrim', onclick: e => e.target === scrim && close() },
    h('form', { class: 'modal', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const body = { title: title.value, content: content.value, category: cat.value, color, priority: Number(pri.value), pinned: pinned.checked, favorite: fav.checked,
        reminder_at: rem.value ? new Date(rem.value).toISOString() : null, tags: tags.value.split(',').map(s => s.trim()).filter(Boolean) };
      try { await (isNew ? api('/notes', 'POST', body) : api('/notes/' + n.id, 'PATCH', body)); close(); toast(isNew ? 'Note created' : 'Note saved'); reload(); }
      catch (x) { err.textContent = x.message; }
    } },
      h('h3', {}, isNew ? 'New note' : 'Edit note'),
      h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'Title'), title),
      h('div', { class: 'field' }, h('label', { for: 'f-content' }, 'Note'), content),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'f-cat' }, 'Category'), cat, cats), h('div', { class: 'field' }, h('label', { for: 'f-pri' }, 'Priority'), pri)),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'f-tags' }, 'Tags'), tags), h('div', { class: 'field' }, h('label', { for: 'f-rem' }, 'Reminder'), rem)),
      h('div', { class: 'field' }, h('label', {}, 'Color'), sw),
      h('div', { class: 'checks' }, h('label', {}, pinned, 'Pin to top'), h('label', {}, fav, 'Mark as favorite')),
      err, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'), h('button', { class: 'btn', type: 'submit' }, 'Save note'))));
  document.body.append(scrim); title.focus();
  scrim.addEventListener('keydown', e => e.key === 'Escape' && close());
}

function openProfile() {
  const name = h('input', { class: 'input', id: 'p-name', maxlength: 80, value: state.user.name }), bio = h('input', { class: 'input', id: 'p-bio', maxlength: 240, value: state.user.bio || '' });
  const err = h('div', { class: 'err' }), close = () => scrim.remove();
  const scrim = h('div', { class: 'scrim', onclick: e => e.target === scrim && close() },
    h('form', { class: 'modal', onsubmit: async e => { e.preventDefault(); try { state.user = await api('/auth/me', 'PATCH', { name: name.value, bio: bio.value }); close(); toast('Profile updated'); renderApp(); } catch (x) { err.textContent = x.message; } } },
      h('h3', {}, 'Your profile'), h('div', { class: 'field' }, h('label', { for: 'p-name' }, 'Name'), name), h('div', { class: 'field' }, h('label', { for: 'p-bio' }, 'Bio'), bio),
      h('p', { class: 'sub' }, 'Member since ' + fmt(state.user.created_at) + (state.user.last_login ? ' · last sign-in ' + fmtDT(state.user.last_login) : '')),
      err, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'), h('button', { class: 'btn', type: 'submit' }, 'Save profile'))));
  document.body.append(scrim); name.focus();
}

// ---------- boot ----------
(async () => { try { state.user = await api('/auth/me'); await loadApp(); } catch { renderAuth(); } })();
