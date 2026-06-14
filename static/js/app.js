import { loadSessions, initSessions, newChat, showWelcome, createSession, renderSidebar, exportActiveSessionMarkdown, getActiveId } from './sessions.js';
import { loadModels, renderModelList, renderSidebarModelList, addEndpoint, getSelected, getCurrentEndpoint, initModelModal } from './models.js';
import { sendMessage, stopStream, hideConnBanner } from './chat.js';
import { toast, closeAllModals, mdToHtml, api } from './util.js';
import { runResearch, setResearchMode, isResearchMode } from './research.js';
import { loadGallery, initGalleryUpload } from './gallery.js';
import { initSlash, tryExecuteSlashCommand } from './slash.js';
import { attachFile, initDropZone } from './uploads.js';
import { loadProjects } from './projects.js';
import { openSearch, closeSearch, initSearch } from './search.js';
import { initCompareView, loadCompareModels } from './compare.js';
import { loadBrainPanel } from './brain.js';
import { openSettings, closeSettings, applyVis } from './settings.js';
import { toggleIncognitoMode, setIncognitoMode, getPermMode, setPermMode, permLabel, getEffort, setEffort } from './modes.js';
import { initPrivacyHandlers } from './privacy.js';
import { loadShortcuts, matchesShortcut } from './shortcuts.js';
import { startReminderPoll, initReminderPanel, loadReminders } from './reminders.js';
import { registerServiceWorker } from './push.js';

window._mdToHtml = mdToHtml;

// ── init ──────────────────────────────────────────────────────────────────────
let _pendingSso = null;   // unused in standalone aide; kept so legacy helpers don't throw

async function init() {
  let me = {};
  try { me = await fetch('/api/auth/me').then(r => r.json()); } catch {}
  if (!me.authenticated) { _showLoginScreen(); return; }
  await _boot();
}

function _stripParam(name) {
  const p = new URLSearchParams(location.search);
  p.delete(name);
  const q = p.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
}

// apex → mint a one-time code and send it back to the requesting app subdomain
async function _ssoRedirect(target) {
  try {
    const { code } = await fetch('/api/auth/handoff').then(r => r.json());
    location.assign(location.protocol + '//' + target + '/?_auth=' + encodeURIComponent(code));
  } catch { _stripParam('_sso'); _showLoginScreen(); }
}

// only relay a session to OUR own app subdomains (no open-redirect / token leak)
function _validSsoTarget(target) {
  try {
    const u = new URL(location.protocol + '//' + target);
    if (u.port !== location.port || u.hostname === parseHost().base) return false;
    const base = parseHost().base;
    if (!u.hostname.endsWith('.' + base)) return false;
    return !!SUBDOMAIN_VIEWS[u.hostname.slice(0, -('.' + base).length)];
  } catch { return false; }
}

async function _boot() {
  applyVis();
  if (localStorage.getItem('aide-sidebar-hidden')) document.body.classList.add('sidebar-hidden');
  await loadModels();
  await loadProjects();
  await initSessions();
  const ta = document.getElementById('composer-ta');
  initSlash(ta);
  const { initMentions } = await import('./mentions.js');
  initMentions(ta);
  initSearch();
  initDropZone();
  initPrivacyHandlers();
  startReminderPoll();
  registerServiceWorker();
  bindEvents();
  applyAideScope();
}

// standalone aide is a single app — no subdomains, no hub. boot straight into chat.
function applyAideScope() {
  document.body.classList.add('is-aide');
  document.body.dataset.app = 'aide';
  document.title = 'aide';
  _show('app-crumb', false);
  // a #sessionId is already restored by initSessions; otherwise land on chat
  if (!location.hash) showChatView();
  document.body.classList.remove('preboot', 'login-mode');
}

function _show(id, on) { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; }

function renderAppCrumb(appName) {
  const crumb = document.getElementById('app-crumb');
  if (!crumb) return;
  crumb.replaceChildren();
  crumb.appendChild(document.createTextNode(appName));
  if (appName !== 'alles') {
    const parent = document.createElement('span');
    parent.textContent = ' / alles';
    crumb.appendChild(parent);
  }
  crumb.title = appName === 'alles' ? 'home' : 'back to alles';
}

// cross-app jump → full-page nav to that app's subdomain, carrying an SSO handoff code
async function crossNav(sub) {
  let url = urlForApp(sub);
  try {
    const { code } = await fetch('/api/auth/handoff').then(r => r.json());
    if (code) url += (url.includes('?') ? '&' : '?') + '_auth=' + encodeURIComponent(code);
  } catch {}
  location.assign(url);
}

function _showLoginScreen() {
  document.body.classList.remove('preboot');
  document.body.classList.add('login-mode');
  const screen = document.getElementById('login-screen');
  if (screen) screen.style.display = 'flex';
  const submit = document.getElementById('login-submit');
  if (!submit || submit.dataset.wired) return;   // re-entry must not stack listeners
  submit.dataset.wired = '1';
  submit.addEventListener('click', async () => {
    const pw = document.getElementById('login-pw')?.value;
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) {
      if (screen) screen.style.display = 'none';
      document.body.classList.remove('login-mode');
      _boot();
    } else toast('wrong password', 'error');
  });
  document.getElementById('login-pw')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-submit')?.click();
  });
}

init();

// ── views ─────────────────────────────────────────────────────────────────────
const _VIEW_IDS = ['chat', 'models-view', 'brain-view', 'gallery-view', 'compare-view', 'reminders-view'];

function hideAllViews() {
  _VIEW_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('composer-outer').style.display = 'none';
}

function showView(viewId, navKey, onShow) {
  hideAllViews();
  document.getElementById(viewId).style.display = 'flex';
  setNav(navKey);
  onShow?.();
}

const showChatView = () => {
  hideAllViews();
  document.getElementById('chat').style.display = 'flex';
  document.getElementById('composer-outer').style.display = 'block';
  setNav('chat');
};
const showModelsView  = () => showView('models-view',   'models',   () => renderSidebarModelList(document.getElementById('sidebar-model-search')?.value || ''));
const showBrainView   = () => showView('brain-view',    'brain',    loadBrainPanel);
const showGalleryView  = () => showView('gallery-view',  'gallery',  () => { loadGallery(); initGalleryUpload(); });
const showCompareView  = () => showView('compare-view',  'compare',  () => { initCompareView(); loadCompareModels(); });
const showRemindersView  = () => showView('reminders-view', 'reminders', initReminderPanel);

// central nav dispatch — used by both the sidebar nav-items and the home tiles
function navigateTo(v) {
  // memory lives inside settings, not as its own view
  if (v === 'memory') { openSettings('memory'); return; }
  if      (v === 'chat')      showChatView();
  else if (v === 'models')    showModelsView();
  else if (v === 'brain')     showBrainView();
  else if (v === 'gallery')   showGalleryView();
  else if (v === 'compare')   showCompareView();
  else if (v === 'reminders') showRemindersView();
  else if (v === 'settings')  openSettings();
  else showChatView();
}

// aide's tools live in the collapsible "tools" group
const _moreViews = new Set(['compare','gallery','brain','models','reminders']);

function setNav(view) {
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  // auto-expand tools section if navigating to a hidden item
  if (_moreViews.has(view)) {
    const items = document.getElementById('nav-more-items');
    const arrow = document.getElementById('nav-more-arrow');
    if (items && !items.classList.contains('open')) {
      items.classList.add('open');
      if (arrow) arrow.textContent = '▴';
      localStorage.setItem('nav-more-open', '1');
    }
  }
}

// ── events ────────────────────────────────────────────────────────────────────
let _eventsBound = false;

function bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  // tools collapse toggle
  const moreToggle = document.getElementById('nav-more-toggle');
  const moreItems  = document.getElementById('nav-more-items');
  const moreArrow  = document.getElementById('nav-more-arrow');
  if (moreToggle && moreItems) {
    if (localStorage.getItem('nav-more-open') !== '0') {   // open by default
      moreItems.classList.add('open');
      if (moreArrow) moreArrow.textContent = '▴';
    }
    moreToggle.addEventListener('click', () => {
      const isOpen = moreItems.classList.toggle('open');
      if (moreArrow) moreArrow.textContent = isOpen ? '▴' : '▾';
      localStorage.setItem('nav-more-open', isOpen ? '1' : '0');
    });
  }

  const ta = document.getElementById('composer-ta');

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  // dim send when empty (but never while recording — it doubles as the stop)
  const _sendBtn = document.getElementById('send-btn');
  const syncSend = () => { _sendBtn.classList.toggle('is-empty', !ta.value.trim() && !_sendBtn.classList.contains('recording')); };
  ta.addEventListener('input', syncSend);
  syncSend();
  _sendBtn.addEventListener('click', async () => {
    const { isRecording, stopRecording } = await import('./voice.js');
    if (isRecording()) stopRecording();
    else doSend();
  });
  // right-click send → schedule the message for later (delivered by the
  // reminder loop as a type=message reminder bound to this session)
  _sendBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) { toast('type a message first — then right-click to schedule it', ''); return; }
    _openSchedulePop(text, ta);
  });
  document.getElementById('stop-btn').addEventListener('click', stopStream);
  document.getElementById('conn-banner-x')?.addEventListener('click', hideConnBanner);

  document.getElementById('new-chat-btn').addEventListener('click', () => {
    showChatView();
    newChat();   // fresh chat — not persisted until first message
  });

  document.getElementById('session-search').addEventListener('input', e => renderSidebar(e.target.value));
  document.getElementById('sidebar-model-search')?.addEventListener('input', e => renderSidebarModelList(e.target.value));
  document.getElementById('models-refresh-btn')?.addEventListener('click', loadModels);
  document.getElementById('brain-refresh-btn')?.addEventListener('click', loadBrainPanel);
  document.getElementById('brain-open-memory-btn')?.addEventListener('click', () => openSettings('memory'));

  const toggleResearch = () => {
    const on = !isResearchMode();
    setResearchMode(on);
    document.getElementById('research-toggle-btn').classList.toggle('active', on);
    ta.placeholder = on ? 'research a topic...' : 'message aide...';
  };

  document.querySelector('.c-tools')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'research-toggle-btn') {
      e.preventDefault();
      e.stopPropagation();
      toggleResearch();
    } else if (btn.id === 'incognito-btn') {
      e.preventDefault();
      e.stopPropagation();
      toggleIncognitoMode();
    } else if (btn.id === 'more-tools-btn') {
      e.preventDefault();
      e.stopPropagation();
      toggleMoreTools();
    }
  });

  document.getElementById('shell-btn-tool').addEventListener('click', openShellPanel);
  document.getElementById('shell-panel-close')?.addEventListener('click', closeShellPanel);
  document.getElementById('shell-send-btn')?.addEventListener('click', submitShellPanel);
  document.getElementById('shell-input')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeShellPanel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitShellPanel();
    }
  });
  document.getElementById('mode-agent').addEventListener('click', () => setMode('agent'));
  document.getElementById('mode-chat').addEventListener('click',  () => setMode('chat'));
  // permission mode button + label
  const permBtn = document.getElementById('perm-mode-btn');
  if (permBtn) {
    setPermMode(getPermMode());   // sets label span + classes (keeps the icon)
    permBtn.addEventListener('click', e => { e.stopPropagation(); _openPermMenu(permBtn); });
  }
  const effortBtn = document.getElementById('effort-btn');
  if (effortBtn) {
    setEffort(getEffort());
    effortBtn.addEventListener('click', e => { e.stopPropagation(); _openEffortMenu(effortBtn); });
  }
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('topbar-settings-btn')?.addEventListener('click', openSettings);

  // your name → used by aide's greeting (client-only, no server round-trip)
  const nameInput = document.getElementById('s-user-name');
  if (nameInput) {
    nameInput.value = localStorage.getItem('alles-name') || '';
    nameInput.addEventListener('input', () => localStorage.setItem('alles-name', nameInput.value.trim()));
  }
  document.getElementById('app-crumb')?.addEventListener('click', () => showChatView());

  // persona picker
  document.getElementById('persona-btn').addEventListener('click', openPersonaPicker);

  // model picker
  document.getElementById('model-btn').addEventListener('click', openModelModal);
  document.getElementById('model-modal-close').addEventListener('click', closeAllModals);
  document.getElementById('model-search-input').addEventListener('input', e => renderModelList(e.target.value));

  // export/share/print dropdown
  document.getElementById('session-actions-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const existing = document.getElementById('_export_menu');
    if (existing) { existing.remove(); return; }
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = '_export_menu';
    menu.className = 'ctx-menu';
    menu.style.cssText = `display:block;right:${window.innerWidth - rect.right}px;top:${rect.bottom + 4}px;left:auto`;
    menu.innerHTML = `
      <div class="ctx-item" data-a="export">export markdown</div>
      <div class="ctx-item" data-a="share">copy share link</div>
      <div class="ctx-item" data-a="print">print / save pdf</div>`;
    menu.addEventListener('click', e => {
      const a = e.target.closest('.ctx-item')?.dataset.a;
      if (a === 'export') exportActiveSessionMarkdown();
      if (a === 'share')  _shareSession();
      if (a === 'print')  _printSession();
      menu.remove();
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  });
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    if (!document.body.classList.contains('is-aide')) return;
    document.body.classList.toggle('sidebar-hidden');
    localStorage.setItem('aide-sidebar-hidden', document.body.classList.contains('sidebar-hidden') ? '1' : '');
  });

  // attach button
  document.getElementById('attach-btn')?.addEventListener('click', () => {
    document.getElementById('file-input-hidden')?.click();
  });
  document.getElementById('file-input-hidden')?.addEventListener('change', async e => {
    for (const f of e.target.files) await attachFile(f);
    e.target.value = '';
  });

  // mic
  document.getElementById('mic-btn')?.addEventListener('click', async () => {
    const { isRecording, startRecording, stopRecording } = await import('./voice.js');
    if (isRecording()) stopRecording(); else startRecording();
  });

  // incognito
  setIncognitoMode(false);

  // sidebar nav + brand-as-home
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.view));
  });
  document.getElementById('brand-home')?.addEventListener('click', () => showChatView());

  // modal overlays close on backdrop click (except settings which manages itself)
  document.querySelectorAll('.modal-overlay:not(#settings-modal)').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeAllModals(); });
  });

  document.addEventListener('keydown', e => {
    const shortcuts = loadShortcuts();
    if (e.key === 'Escape') { closeAllModals(); closeSettings(); closeSearch(); closeMoreTools(); closeShellPanel(); }
    else if (matchesShortcut(e, shortcuts.search)) { e.preventDefault(); openSearch(); }
    else if (matchesShortcut(e, shortcuts.settings)) { e.preventDefault(); openSettings(); }
    else if (matchesShortcut(e, shortcuts.sidebar) && document.body.classList.contains('is-aide')) { e.preventDefault(); document.body.classList.toggle('sidebar-hidden'); }
    else if (matchesShortcut(e, shortcuts.new_chat)) { e.preventDefault(); document.getElementById('new-chat-btn')?.click(); }
    else if (matchesShortcut(e, shortcuts.send)) { e.preventDefault(); doSend(); }
  });
  document.addEventListener('click', () => {
    document.getElementById('ctx-menu').style.display = 'none';
    closeMoreTools();
  });
  // share-btn removed — export/share/print now in topbar-session-actions

  setInterval(loadModels, 30000);
}

async function _shareSession() {
  const sid = window._currentSession?.id;
  if (!sid) { toast('open a chat first', 'error'); return; }
  const btn = document.getElementById('session-share-btn');
  btn.textContent = '...'; btn.disabled = true;
  try {
    const r = await fetch(`/api/sessions/${sid}/share`, { method: 'POST' });
    const { url } = await r.json();
    const full = location.origin + url;
    await navigator.clipboard.writeText(full);
    toast('share link copied to clipboard', 'success');
  } catch { toast('share failed', 'error'); }
  btn.textContent = 'share'; btn.disabled = false;
}

function _printSession() {
  const sid = window._currentSession?.id;
  if (!sid) { window.print(); return; }
  // check if a share link exists, else just print current page
  fetch(`/api/sessions/${sid}/share`, { method: 'POST' })
    .then(r => r.json())
    .then(({ url }) => {
      const w = window.open(location.origin + url, '_blank');
      setTimeout(() => w?.print(), 600);
    })
    .catch(() => window.print());
}

function toggleMoreTools() {
  const existing = document.getElementById('_more_tools_menu');
  if (existing) { closeMoreTools(); return; }
  const btn = document.getElementById('more-tools-btn');
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = '_more_tools_menu';
  menu.className = 'ctx-menu more-tools-menu';
  menu.style.display = 'block';
  menu.style.left = Math.max(12, rect.right - 170) + 'px';
  menu.style.top = Math.max(12, rect.top - 136) + 'px';
  menu.innerHTML = `
    <div class="ctx-item" data-tool="incognito">incognito mode</div>
    <div class="ctx-item" data-tool="research">research mode</div>
    <div class="ctx-item" data-tool="shell">shell command</div>
    <div class="ctx-item" data-tool="attach">attach file</div>
  `;
  menu.addEventListener('click', e => {
    e.stopPropagation();
    const tool = e.target.closest('.ctx-item')?.dataset.tool;
    if (tool === 'incognito') document.getElementById('incognito-btn')?.click();
    if (tool === 'research') document.getElementById('research-toggle-btn')?.click();
    if (tool === 'shell') document.getElementById('shell-btn-tool')?.click();
    if (tool === 'attach') document.getElementById('attach-btn')?.click();
    closeMoreTools();
  });
  document.body.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
}

function closeMoreTools() {
  document.getElementById('_more_tools_menu')?.remove();
  document.getElementById('more-tools-btn')?.setAttribute('aria-expanded', 'false');
}

// ── send ──────────────────────────────────────────────────────────────────────
async function doSend() {
  const ta = document.getElementById('composer-ta');
  const text = ta.value.trim();
  if (!text) return;
  if (await tryExecuteSlashCommand(text)) {
    ta.value = ''; ta.style.height = 'auto';
    return;
  }
  ta.value = ''; ta.style.height = 'auto';
  if (isResearchMode()) runResearch(text);
  else sendMessage(text);
}

// schedule-send popup (right-click on the send button)
async function _openSchedulePop(text, ta) {
  document.querySelector('.schedule-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'schedule-pop';
  pop.innerHTML = `
    <div class="schedule-pop-title">send later</div>
    <div class="date-input" id="schedule-when" data-type="datetime" data-ph="when to send"></div>
    <div class="schedule-pop-actions">
      <button class="btn primary" id="schedule-go">schedule</button>
      <button class="btn" id="schedule-cancel">cancel</button>
    </div>`;
  document.body.appendChild(pop);
  const btnRect = document.getElementById('send-btn').getBoundingClientRect();
  pop.style.right = `${Math.max(8, window.innerWidth - btnRect.right)}px`;
  pop.style.bottom = `${Math.max(8, window.innerHeight - btnRect.top + 8)}px`;
  const { initDatePicker } = await import('./datepick.js');
  const when = pop.querySelector('#schedule-when');
  initDatePicker(when);
  const close = () => { pop.remove(); document.removeEventListener('click', outside); };
  const outside = e => { if (!pop.contains(e.target) && !document.querySelector('.date-panel')?.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('click', outside), 0);
  pop.querySelector('#schedule-cancel').addEventListener('click', close);
  pop.querySelector('#schedule-go').addEventListener('click', async () => {
    const at = when.value;
    if (!at) { toast('pick a time', 'error'); return; }
    if (new Date(at) <= new Date()) { toast('that time is in the past', 'error'); return; }
    let sid = getActiveId();
    if (!sid) {
      const s = await createSession();
      sid = s?.id;
    }
    if (!sid) { toast('no session to schedule into', 'error'); return; }
    const r = await fetch('/api/reminders', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, trigger_at: at, type: 'message', session_id: sid }),
    });
    if (!r.ok) { toast('failed to schedule', 'error'); return; }
    ta.value = ''; ta.style.height = 'auto'; ta.dispatchEvent(new Event('input'));
    toast(`scheduled — aide will answer it ${new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()}`, 'success');
    close();
  });
}

// ── mode / theme ──────────────────────────────────────────────────────────────
function setMode(m) {
  document.getElementById('mode-agent').classList.toggle('active', m === 'agent');
  document.getElementById('mode-chat').classList.toggle('active', m === 'chat');
  // .agent-mode grows the box + reveals the agent control row (CSS-driven)
  document.querySelector('.composer-box')?.classList.toggle('agent-mode', m === 'agent');
}

function _openPermMenu(anchor) {
  document.getElementById('perm-menu')?.remove();
  const cur = getPermMode();
  const opts = [
    ['approve',  'approve',  'ask before each change (recommended)'],
    ['full_auto','auto',     '⚠ runs everything without asking'],
    ['plan',     'plan',     'read-only — just make a plan, change nothing'],
  ];
  const menu = document.createElement('div');
  menu.id = 'perm-menu';
  menu.className = 'perm-menu';
  menu.innerHTML = opts.map(([v, label, desc]) =>
    `<div class="perm-menu-item${v === cur ? ' active' : ''}${v === 'full_auto' ? ' warn' : ''}" data-v="${v}">
       <div class="perm-menu-label">${label}</div>
       <div class="perm-menu-desc">${desc}</div>
     </div>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
  menu.querySelectorAll('.perm-menu-item').forEach(it =>
    it.addEventListener('click', () => { setPermMode(it.dataset.v); menu.remove(); }));
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('click', h); }
  }), 0);
}

function _openEffortMenu(anchor) {
  document.getElementById('perm-menu')?.remove();
  const cur = getEffort();
  const opts = [
    ['low',    'low',    'quick & minimal — fewer turns'],
    ['medium', 'medium', 'balanced (default)'],
    ['high',   'high',   'thorough — more turns, deeper checks'],
  ];
  const menu = document.createElement('div');
  menu.id = 'perm-menu';
  menu.className = 'perm-menu';
  menu.innerHTML = opts.map(([v, label, desc]) =>
    `<div class="perm-menu-item${v === cur ? ' active' : ''}" data-v="${v}">
       <div class="perm-menu-label">${label}</div>
       <div class="perm-menu-desc">${desc}</div>
     </div>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
  menu.querySelectorAll('.perm-menu-item').forEach(it =>
    it.addEventListener('click', () => { setEffort(it.dataset.v); menu.remove(); }));
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('click', h); }
  }), 0);
}

function toggleTheme() {
  const root = document.documentElement;
  if (root.dataset.theme === 'light') {
    delete root.dataset.theme; localStorage.removeItem('aide-theme');
  } else {
    root.dataset.theme = 'light'; localStorage.setItem('aide-theme', 'light');
  }
}

// ── model picker ──────────────────────────────────────────────────────────────
let _modelModalInited = false;
function openModelModal() {
  document.getElementById('model-modal').style.display = 'flex';
  if (!_modelModalInited) { initModelModal(); _modelModalInited = true; }
  // make sure models tab is active
  document.querySelector('.mm-tab[data-tab="models"]')?.click();
  renderModelList();
  const inp = document.getElementById('model-search-input');
  if (inp) { inp.value = ''; inp.focus(); }
}

// ── persona picker ────────────────────────────────────────────────────────────
let _personas = [];

export async function refreshPersonaBtn() {
  try { _personas = await fetch('/api/personas').then(r => r.json()); } catch { return; }
  const btn   = document.getElementById('persona-btn');
  const label = document.getElementById('persona-label');
  const session = window._currentSession;
  if (!session) { btn.style.display = 'none'; return; }
  const active = _personas.find(p => p.id === session.persona_id) || _personas.find(p => p.is_default);
  if (active) {
    btn.style.display = 'flex'; label.textContent = active.name;
  } else if (_personas.length > 0) {
    btn.style.display = 'flex'; label.textContent = 'no persona';
  } else {
    btn.style.display = 'none';
  }
}

window._refreshPersonaBtn = refreshPersonaBtn;

async function openPersonaPicker() {
  if (!_personas.length) _personas = await fetch('/api/personas').then(r => r.json());
  const session = window._currentSession;
  if (!session) return;
  const existing = document.getElementById('_persona_picker');
  if (existing) { existing.remove(); return; }
  const picker = document.createElement('div');
  picker.id = '_persona_picker';
  picker.className = 'ctx-menu';
  picker.style.cssText = 'display:block;top:50px;left:260px;min-width:160px';
  const none = document.createElement('div');
  none.className = 'ctx-item'; none.textContent = '— none';
  none.addEventListener('click', async () => {
    await fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH', headers: {'content-type':'application/json'},
      body: JSON.stringify({ persona_id: '' }),
    });
    window._currentSession.persona_id = null; refreshPersonaBtn(); picker.remove();
  });
  picker.appendChild(none);
  for (const p of _personas) {
    const item = document.createElement('div');
    item.className = 'ctx-item'; item.textContent = p.name;
    item.addEventListener('click', async () => {
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH', headers: {'content-type':'application/json'},
        body: JSON.stringify({ persona_id: p.id }),
      });
      window._currentSession.persona_id = p.id;
      toast(`persona set: ${p.name}`, 'success'); refreshPersonaBtn(); picker.remove();
    });
    picker.appendChild(item);
  }
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0);
}

// ── shell prompt ──────────────────────────────────────────────────────────────
function openShellPanel() {
  const panel = document.getElementById('shell-panel');
  if (!panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  document.getElementById('shell-btn-tool')?.classList.toggle('active', willOpen);
  if (willOpen) document.getElementById('shell-input')?.focus();
}

function closeShellPanel() {
  const panel = document.getElementById('shell-panel');
  if (!panel) return;
  panel.hidden = true;
  document.getElementById('shell-btn-tool')?.classList.remove('active');
}

function submitShellPanel() {
  const input = document.getElementById('shell-input');
  const command = input?.value.trim();
  if (!command) { toast('shell command required', 'error'); return; }
  input.value = '';
  closeShellPanel();
  const message = `\`\`\`sh\n${command}\n\`\`\``;
  if (isResearchMode()) runResearch(message);
  else sendMessage(message);
}
