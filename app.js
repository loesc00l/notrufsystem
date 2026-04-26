/* =========================================================================
 *  Notrufsystem - Prüfprotokoll nach DIN VDE 0834
 *  Single-Page-App gegen Supabase.
 * ========================================================================= */

/* ------------------------------------------------------------------ *
 *  Supabase-Client
 * ------------------------------------------------------------------ */
if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('YOUR-PROJECT')) {
  alert('Bitte config.js mit Supabase-URL und Anon-Key ausfüllen.');
}
const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

/* ------------------------------------------------------------------ *
 *  Hilfsfunktionen
 * ------------------------------------------------------------------ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ----- Theme (hell / dunkel) ------------------------------------- */
const THEME_KEY = 'notruf.theme';
function currentTheme(){
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function refreshThemeButton(){
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  // Direkt Symbol + Tooltip aktualisieren - unabhängig von CSS-Pseudo-Elementen
  btn.textContent = dark ? '🌞' : '🌙';
  btn.title = dark ? 'Auf Hell umschalten' : 'Auf Dunkel umschalten';
  btn.setAttribute('aria-label', btn.title);
}
function setTheme(t){
  if (t === 'dark' || t === 'light') {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  } else {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.removeItem(THEME_KEY); } catch (e) {}
  }
  refreshThemeButton();
}
function bindThemeButton(){
  const btn = document.getElementById('btn-theme');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  refreshThemeButton();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}
// Direkt + DCL + nach Login - egal wann der Button im DOM ist, er wird verdrahtet
bindThemeButton();
document.addEventListener('DOMContentLoaded', bindThemeButton);
// Wenn der Nutzer das System-Theme ändert und keine manuelle Wahl hat
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (!document.documentElement.getAttribute('data-theme')) refreshThemeButton();
});

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function show(id) { $$('.view').forEach(v => v.classList.add('hidden')); $(id).classList.remove('hidden'); }

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
const state = {
  user: null,
  protokollId: null,
  deckblatt: null,
  geraete: [],
  maengel: [],
  historie: [],                        // archivierte Prüfungen (geraete_history)
  historieBatch: '',                   // gewählte Prüfungsrunde (batch_id)
  filter: { text: '', status: '' },
  sort:   { col: 'nr', dir: 'asc' },   // Sortierzustand
  collapsed: new Set(),                // welche Räume sind zugeklappt
};

// Sichtbare/genutzte Prüfkriterien (Akust., Weiter., Notstr. wurden entfernt)
const CHECK_FIELDS = [
  'sichtpruefung','befestigung','rufausloesung','opt_anzeige','quittierung'
];

/* ------------------------------------------------------------------ *
 *  Authentifizierung
 * ------------------------------------------------------------------ */
function loginMsg(text, color){
  const el = $('#login-error');
  el.textContent = text || '';
  el.style.color = color || '';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMsg('');
  const email = ($('#login-email').value || '').trim().toLowerCase();
  const pw    = $('#login-password').value;
  if (!email || !pw) { loginMsg('Bitte E-Mail und Passwort eingeben.'); return; }
  $('#login-email').value = email; // normalisiert zurückspielen
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) {
    // Häufigster Fall: falsches PW oder unbestätigter Account
    let hint = error.message;
    if (/Invalid login credentials/i.test(error.message)) {
      hint = 'Anmeldung fehlgeschlagen. Mögliche Ursachen:\n'
           + '• Passwort falsch (Caps-Lock?)\n'
           + '• Account existiert nicht — auf "Registrieren" klicken\n'
           + '• Account nicht bestätigt — Bestätigungs-Mail prüfen oder unten "Passwort vergessen" nutzen';
    } else if (/Email not confirmed/i.test(error.message)) {
      hint = 'E-Mail noch nicht bestätigt. Bitte den Link in der Registrierungs-Mail anklicken oder "Passwort vergessen" verwenden.';
    }
    loginMsg(hint);
    return;
  }
  afterLogin(data.user);
});

$('#btn-signup').addEventListener('click', async () => {
  loginMsg('');
  const email = ($('#login-email').value || '').trim().toLowerCase();
  const pw    = $('#login-password').value;
  if (!email || !pw) { loginMsg('E-Mail und Passwort eingeben.'); return; }
  $('#login-email').value = email;
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { loginMsg(error.message); return; }
  if (data.user && !data.session) {
    loginMsg('Bestätigungs-E-Mail gesendet (' + email + '). Bitte prüfen (auch Spam-Ordner) und danach anmelden.', 'green');
  } else {
    afterLogin(data.user);
  }
});

$('#btn-forgot').addEventListener('click', async () => {
  loginMsg('');
  const email = ($('#login-email').value || '').trim().toLowerCase();
  if (!email) { loginMsg('Bitte zuerst die E-Mail-Adresse oben eintragen.'); return; }
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) { loginMsg(error.message); return; }
  loginMsg('E-Mail zum Zurücksetzen des Passworts wurde an ' + email + ' geschickt. Bitte Postfach prüfen (auch Spam).', 'green');
});

// Wenn der Nutzer per Reset-Link kommt (#access_token=... in URL), Passwort-Setzen anbieten
(async () => {
  const hash = window.location.hash || '';
  if (hash.includes('type=recovery') || hash.includes('access_token=')) {
    // Supabase verarbeitet den Hash automatisch in detectSessionInUrl
    setTimeout(async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        const newPw = prompt('Neues Passwort eingeben (mindestens 6 Zeichen):');
        if (newPw && newPw.length >= 6) {
          const { error } = await sb.auth.updateUser({ password: newPw });
          if (error) alert('Passwort-Reset fehlgeschlagen: ' + error.message);
          else      alert('Passwort wurde aktualisiert. Du bist jetzt angemeldet.');
        }
      }
    }, 400);
  }
})();

$('#btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function afterLogin(user) {
  state.user = user;
  $('#user-email').textContent = user.email;
  show('#view-app');
  bindThemeButton();
  await loadProtokolle();
}

/* ------------------------------------------------------------------ *
 *  Tabs
 * ------------------------------------------------------------------ */
$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const t = btn.dataset.tab;
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== t));
  if (t === 'export') loadArchive();
  if (t === 'historie') loadHistorie();
}));

/* ------------------------------------------------------------------ *
 *  Protokolle laden / wechseln / neu
 * ------------------------------------------------------------------ */
async function loadProtokolle() {
  const { data, error } = await sb
    .from('protokolle')
    .select('id, krankenhaus, station, pruefdatum_von, created_at, archived_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) { toast('Fehler: ' + error.message); return; }

  const sel = $('#protokoll-select');
  sel.innerHTML = '';
  if (!data.length) {
    sel.innerHTML = '<option value="">(kein aktives Protokoll)</option>';
    state.protokollId = null;
    state.geraete = []; state.maengel = []; state.deckblatt = null;
    $('#count-geraete').textContent = '0';
    $('#count-maengel').textContent = '0';
    renderPruefliste(); renderMaengel();
    await loadArchive();
    return;
  }
  for (const p of data) {
    const label = [p.krankenhaus || '(ohne Name)', p.station, p.pruefdatum_von].filter(Boolean).join(' - ');
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  state.protokollId = sel.value;
  await loadAll();
}

$('#protokoll-select').addEventListener('change', async (e) => {
  state.protokollId = e.target.value;
  await loadAll();
});

$('#btn-new-protokoll').addEventListener('click', createProtokollPrompt);

async function createProtokollPrompt() {
  const k = prompt('Krankenhaus / Einrichtung:');
  if (k === null) return;
  const s = prompt('Station / Bereich:') || '';
  const a = prompt('Anlage / System:') || 'Notrufsystem';
  toast('Protokoll wird angelegt und 546 Geräte importiert...');
  const { data, error } = await sb.rpc('create_protokoll_with_devices', {
    p_krankenhaus: k, p_station: s, p_anlage: a
  });
  if (error) { alert('Fehler: ' + error.message); return; }
  toast('Protokoll angelegt.');
  await loadProtokolle();
}

/* ------------------------------------------------------------------ *
 *  Alle Daten für aktuelles Protokoll laden
 * ------------------------------------------------------------------ */
async function loadAll() {
  if (!state.protokollId) return;
  await Promise.all([loadDeckblatt(), loadGeraete(), loadMaengel()]);
}

async function loadDeckblatt() {
  const { data, error } = await sb.from('protokolle').select('*').eq('id', state.protokollId).single();
  if (error) { toast('Deckblatt: ' + error.message); return; }
  state.deckblatt = data;
  const f = $('#deckblatt-form');
  for (const k of ['krankenhaus','station','anlage','verantwortlicher','pruefdatum_von','pruefdatum_bis',
                   'pruefer','qualifikation','auftrag_nr','naechste_pruefung','bemerkung']) {
    if (f[k]) f[k].value = data[k] || '';
  }
}

async function loadGeraete() {
  const all = [];
  let from = 0, size = 1000;
  for (;;) {
    const { data, error } = await sb.from('geraete').select('*')
      .eq('protokoll_id', state.protokollId)
      .order('nr').range(from, from + size - 1);
    if (error) { toast('Geräte: ' + error.message); return; }
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  state.geraete = all;
  $('#count-geraete').textContent = all.length;
  renderPruefliste();
}

async function loadMaengel() {
  const { data, error } = await sb.from('maengel').select('*')
    .eq('protokoll_id', state.protokollId).order('nr');
  if (error) { toast('Mängel: ' + error.message); return; }
  state.maengel = data;
  $('#count-maengel').textContent = data.length;
  renderMaengel();
}

/* ------------------------------------------------------------------ *
 *  Deckblatt speichern
 * ------------------------------------------------------------------ */
$('#deckblatt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = {};
  for (const k of ['krankenhaus','station','anlage','verantwortlicher','pruefdatum_von','pruefdatum_bis',
                   'pruefer','qualifikation','auftrag_nr','naechste_pruefung','bemerkung']) {
    patch[k] = f[k].value || null;
  }
  const { error } = await sb.from('protokolle').update(patch).eq('id', state.protokollId);
  if (error) { $('#deckblatt-status').textContent = 'Fehler: ' + error.message; return; }
  $('#deckblatt-status').textContent = 'Gespeichert ' + new Date().toLocaleTimeString();
  await loadProtokolle();   // Label im Dropdown auffrischen
  // Dropdown-Selektion beibehalten
  $('#protokoll-select').value = state.protokollId;
});

/* ------------------------------------------------------------------ *
 *  Prüfliste rendern
 * ------------------------------------------------------------------ */
$('#filter-input').addEventListener('input', (e) => { state.filter.text = e.target.value.toLowerCase(); renderPruefliste(); });
$('#filter-status').addEventListener('change', (e) => { state.filter.status = e.target.value; renderPruefliste(); });

function matchesFilter(g) {
  const { text, status } = state.filter;
  if (text) {
    const hay = [g.raumname, g.zimmer, g.geraetetyp, g.sonderfunktion,
                 g.bemerkung, g.geprueft_von, g.bett, g.zbus_adresse, g.lon_id]
                .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(text)) return false;
  }
  if (status === 'open'  && g.gesamt_ergebnis)        return false;
  if (status === 'OK'    && g.gesamt_ergebnis !== 'OK')  return false;
  if (status === 'NOK'   && g.gesamt_ergebnis !== 'NOK') return false;
  if (status === 'NA'    && g.gesamt_ergebnis !== 'NA')  return false;
  return true;
}

/* ----- Gruppierung Zimmer -> Betten ------------------------------ */
function isBedDevice(d){
  return !!d.bett;
}
function buildGroups(devices){
  const map = new Map();
  for (const d of devices) {
    const key = d.zimmer || ('__id_' + d.id);
    if (!map.has(key)) map.set(key, { key, parent: null, children: [] });
    const g = map.get(key);
    if (isBedDevice(d)) g.children.push(d);
    else if (!g.parent) g.parent = d;
    else g.children.push(d);
  }
  for (const g of map.values()) {
    g.children.sort((a, b) =>
      String(a.bett||'').localeCompare(String(b.bett||''), 'de', { numeric: true }));
  }
  return [...map.values()];
}

/* ----- Sortierung ------------------------------------------------ */
function compareVals(a, b){
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'de', { numeric: true });
}
function sortGroups(groups){
  const { col, dir } = state.sort;
  const arr = [...groups];
  arr.sort((g1, g2) => {
    const a = (g1.parent || g1.children[0] || {})[col];
    const b = (g2.parent || g2.children[0] || {})[col];
    const c = compareVals(a, b);
    return dir === 'desc' ? -c : c;
  });
  return arr;
}
function groupMatches(g){
  return [g.parent, ...g.children].filter(Boolean).some(d => matchesFilter(d));
}

/* ----- Sortable headers ------------------------------------------ */
$$('.table-pruefliste thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sort.col === col) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort.col = col; state.sort.dir = 'asc'; }
    renderPruefliste();
  });
});

/* ----- Alle Räume auf-/zuklappen --------------------------------- */
$('#btn-expand-all').addEventListener('click', () => { state.collapsed.clear(); renderPruefliste(); });
$('#btn-collapse-all').addEventListener('click', () => {
  for (const g of buildGroups(state.geraete)) if (g.children.length) state.collapsed.add(g.key);
  renderPruefliste();
});
$('#btn-add-zimmer').addEventListener('click', addZimmer);

function chkCell(field, g) {
  const v = g[field] || '';
  return `<span class="chk" data-field="${field}">
    <button class="ok  ${v==='OK'  ? 'active':''}" data-val="OK">OK</button>
    <button class="nok ${v==='NOK' ? 'active':''}" data-val="NOK">NOK</button>
    <button class="na  ${v==='NA'  ? 'active':''}" data-val="NA">N/A</button>
  </span>`;
}

function deviceRow(d, role, opts = {}) {
  // role: 'flat' | 'room' | 'bed'
  const tr = document.createElement('tr');
  tr.dataset.id = d.id;
  tr.classList.add(role + '-row');

  const zimmer = d.zimmer || '';
  const bett   = d.bett   || '';

  let zimmerCell = esc(zimmer);
  if (role === 'room' && opts.hasChildren) {
    const arrow = opts.collapsed ? '▶' : '▼';
    zimmerCell = `<button class="toggle-btn" data-toggle="${esc(opts.groupKey)}" type="button" title="Betten ein-/ausblenden">${arrow}</button>${esc(zimmer)}`;
  }
  // "+ Bett" zeigen, wenn die Zeile ein Zimmer ist (oder eigenständig)
  const showAddBett = (role === 'room' || role === 'flat') && !!zimmer;
  const addBettBtn  = showAddBett
      ? `<button class="btn small mini-action" data-add-bett title="Bett hinzufügen">+ Bett</button>`
      : '';
  // "🗑 Zimmer" - kompletten Raum (inkl. aller Betten) löschen
  const showDelZimmer = (role === 'room' || role === 'flat') && !!zimmer;
  const delZimmerBtn  = showDelZimmer
      ? `<button class="btn small danger mini-action" data-del-zimmer title="Komplettes Zimmer löschen">🗑 Zimmer</button>`
      : '';

  // Status-Badge für die Karten-Ansicht (mobile)
  const status = d.gesamt_ergebnis || '';
  const statusBadge = status
      ? `<span class="badge ${status === 'OK' ? 'ok' : status === 'NOK' ? 'nok' : 'na'}">${status}</span>`
      : `<span class="badge open">offen</span>`;

  tr.innerHTML = `
    <td data-c="nr">${d.nr}</td>
    <td data-c="raumname"><input data-f="raumname" value="${esc(d.raumname)}" placeholder="Raumname" /></td>
    <td data-c="zimmer">
      <span class="cell-zimmer">${zimmerCell}</span>
      ${addBettBtn}
      ${delZimmerBtn}
      <span class="mobile-status">${statusBadge}</span>
    </td>
    <td data-c="bett">${esc(bett)}</td>
    <td data-c="sicht" class="m-hide">${chkCell('sichtpruefung', d)}</td>
    <td data-c="bef"   class="m-hide">${chkCell('befestigung', d)}</td>
    <td data-c="ruf"   class="m-hide">${chkCell('rufausloesung', d)}</td>
    <td data-c="opt"   class="m-hide">${chkCell('opt_anzeige', d)}</td>
    <td data-c="quitt" class="m-hide">${chkCell('quittierung', d)}</td>
    <td data-c="actions" class="actions-cell">
      <span class="desktop-only">${chkCell('gesamt_ergebnis_x', d).replace('data-field="gesamt_ergebnis_x"','data-field="gesamt_ergebnis"')}</span>
      <div class="quick-actions">
        <button class="btn primary quick-ok"  data-allok  type="button">✓ Alle OK</button>
        <button class="btn danger  quick-nok" data-allnok type="button">✗ NOK</button>
        <button class="btn small mini-action" data-del-row type="button" title="Eintrag löschen">✕</button>
      </div>
    </td>
    <td data-c="bemerkung"><input data-f="bemerkung" value="${esc(d.bemerkung)}" placeholder="Bemerkung / Mangelbeschreibung" /></td>
    <td data-c="von"  class="m-hide"><input data-f="geprueft_von" value="${esc(d.geprueft_von)}" placeholder="Prüfer" /></td>
    <td data-c="zeit" class="m-hide"><input data-f="geprueft_am"  type="datetime-local" step="60" value="${tsToLocal(d.geprueft_am)}" /></td>
  `;
  return tr;
}

function renderPruefliste() {
  const tbody = $('#pruefliste-body');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  const groups = sortGroups(buildGroups(state.geraete));

  for (const g of groups) {
    if (!groupMatches(g)) continue;
    const hasChildren = g.children.length > 0;
    const collapsed = state.collapsed.has(g.key);

    if (g.parent) {
      frag.appendChild(deviceRow(
        g.parent,
        hasChildren ? 'room' : 'flat',
        { hasChildren, collapsed, groupKey: g.key }
      ));
      if (hasChildren && !collapsed) {
        for (const c of g.children) frag.appendChild(deviceRow(c, 'bed'));
      }
    } else {
      // Keine Raumzeile vorhanden -> Betten flach anzeigen
      for (const c of g.children) frag.appendChild(deviceRow(c, 'flat'));
    }
  }
  tbody.appendChild(frag);

  // Sort-Indikator aktualisieren
  $$('.table-pruefliste thead th[data-sort]').forEach(th => {
    th.classList.remove('sorted-asc','sorted-desc');
    if (th.dataset.sort === state.sort.col) th.classList.add('sorted-' + state.sort.dir);
  });
}

function esc(v){ if (v==null) return ''; return String(v).replace(/"/g,'&quot;').replace(/</g,'&lt;') }

/* Timestamp-Helfer: ISO <-> datetime-local Inputfeld */
function tsToLocal(ts){
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())
       +'T'+p(d.getHours())+':'+p(d.getMinutes());
}
function tsFromLocal(local){
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
function tsForDisplay(ts){
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())
       +' '+p(d.getHours())+':'+p(d.getMinutes());
}

/* ------------------------------------------------------------------ *
 *  Räume / Betten anlegen + entfernen
 * ------------------------------------------------------------------ */
function nextGeraetNr(){
  return state.geraete.length
    ? Math.max(...state.geraete.map(g => g.nr || 0)) + 1
    : 1;
}

async function addZimmer(){
  if (!state.protokollId) { toast('Kein Protokoll ausgewählt'); return; }
  const name = (prompt('Name des neuen Zimmers (z. B. "U99" oder "AB 12"):') || '').trim();
  if (!name) return;
  const row = {
    protokoll_id: state.protokollId,
    nr: nextGeraetNr(),
    zimmer: name,
    bett: null
  };
  const { error } = await sb.from('geraete').insert(row);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadGeraete();
  toast('Zimmer "' + name + '" angelegt.');
}

async function addBettToRoom(parentDev){
  if (!state.protokollId) { toast('Kein Protokoll ausgewählt'); return; }
  const bett = (prompt('Bett-Bezeichnung für ' + (parentDev.zimmer || '') + ' (z. B. "A", "B", "1"):') || '').trim();
  if (!bett) return;
  const row = {
    protokoll_id: state.protokollId,
    nr: nextGeraetNr(),
    zimmer: parentDev.zimmer,
    bett,
    raumname: parentDev.raumname,
    geraetetyp: parentDev.geraetetyp
  };
  const { error } = await sb.from('geraete').insert(row);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadGeraete();
  toast('Bett "' + bett + '" zu ' + (parentDev.zimmer || '') + ' hinzugefügt.');
}

async function deleteGeraet(id){
  const g = state.geraete.find(x => x.id === id);
  if (!g) return;

  // Wenn die Zeile ein Zimmer (kein bett) ist und Betten existieren -> alle mit löschen
  const isRoom = !g.bett;
  const siblings = isRoom && g.zimmer
    ? state.geraete.filter(x => x.zimmer === g.zimmer && x.bett && x.id !== g.id)
    : [];

  let msg;
  if (siblings.length) {
    msg = 'Zimmer "' + g.zimmer + '" enthält ' + siblings.length + ' Bett(en).\n'
        + 'Komplett löschen (Zimmer + alle ' + siblings.length + ' Betten)?';
  } else {
    const label = (g.zimmer || '?') + (g.bett ? ' / ' + g.bett : '') + ' (Nr. ' + g.nr + ')';
    msg = 'Eintrag "' + label + '" wirklich löschen?';
  }
  if (!confirm(msg)) return;

  const ids = [id, ...siblings.map(s => s.id)];
  const { error } = await sb.from('geraete').delete().in('id', ids);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadGeraete();
  await loadMaengel();
  toast(siblings.length
    ? 'Zimmer "' + g.zimmer + '" mit ' + siblings.length + ' Bett(en) gelöscht.'
    : 'Eintrag gelöscht.');
}

async function deleteZimmer(zimmer){
  if (!zimmer) return;
  const all = state.geraete.filter(x => x.zimmer === zimmer);
  if (!all.length) return;
  const beds = all.filter(x => x.bett).length;
  const msg = 'Zimmer "' + zimmer + '" mit ' + all.length + ' Eintrag/Einträgen'
            + (beds ? ' (inkl. ' + beds + ' Bett[en])' : '') + ' wirklich löschen?';
  if (!confirm(msg)) return;
  const ids = all.map(x => x.id);
  const { error } = await sb.from('geraete').delete().in('id', ids);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadGeraete();
  await loadMaengel();
  toast('Zimmer "' + zimmer + '" gelöscht.');
}

/* ------------------------------------------------------------------ *
 *  Neue Prüfung starten — alte Tests archivieren + Daten zurücksetzen
 * ------------------------------------------------------------------ */
const RESET_FIELDS = [
  'sichtpruefung','befestigung','rufausloesung','akust_signal',
  'opt_anzeige','weiterleitung','quittierung','notstrom',
  'gesamt_ergebnis','bemerkung','geprueft_von','geprueft_am'
];

function devHasTestData(g){
  if (g.gesamt_ergebnis) return true;
  if (g.geprueft_am)     return true;
  if (g.bemerkung && g.bemerkung.trim()) return true;
  if (g.geprueft_von && g.geprueft_von.trim()) return true;
  for (const f of RESET_FIELDS) {
    if (f === 'gesamt_ergebnis' || f === 'bemerkung' || f === 'geprueft_von' || f === 'geprueft_am') continue;
    if (g[f]) return true;
  }
  return false;
}

async function archiveAndResetTests(){
  if (!state.protokollId) { toast('Kein Protokoll ausgewählt'); return; }
  const tested = state.geraete.filter(devHasTestData);
  if (!tested.length) {
    if (!confirm('Es liegen keine Testdaten vor. Trotzdem zurücksetzen?')) return;
  }
  const msg = tested.length
    ? `${tested.length} geprüfte Geräte werden in die Historie verschoben und die Prüfliste wird komplett geleert (alle Prüfkriterien, Bemerkungen, Prüfer, Zeitstempel auf leer).\n\nFortfahren?`
    : 'Prüfliste wird zurückgesetzt. Fortfahren?';
  if (!confirm(msg)) return;

  // batch_id clientseitig erzeugen, damit alle Zeilen einer Runde verknüpft sind
  const batchId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
                : 'b-' + Date.now() + '-' + Math.random().toString(16).slice(2);

  // 1) Snapshot in geraete_history kopieren
  if (tested.length) {
    const rows = tested.map(g => ({
      protokoll_id: state.protokollId,
      geraet_id:    g.id,
      batch_id:     batchId,
      nr:           g.nr,
      raumname:     g.raumname,
      zimmer:       g.zimmer,
      bett:         g.bett,
      geraetetyp:   g.geraetetyp,
      sichtpruefung: g.sichtpruefung,
      befestigung:   g.befestigung,
      rufausloesung: g.rufausloesung,
      akust_signal:  g.akust_signal,
      opt_anzeige:   g.opt_anzeige,
      weiterleitung: g.weiterleitung,
      quittierung:   g.quittierung,
      notstrom:      g.notstrom,
      gesamt_ergebnis: g.gesamt_ergebnis,
      bemerkung:     g.bemerkung,
      geprueft_von:  g.geprueft_von,
      geprueft_am:   g.geprueft_am
    }));
    const { error: histErr } = await sb.from('geraete_history').insert(rows);
    if (histErr) { toast('Historie-Fehler: ' + histErr.message); return; }
  }

  // 2) Felder in geraete leeren (nur für das aktive Protokoll)
  const patch = {};
  for (const f of RESET_FIELDS) patch[f] = null;
  const { error: updErr } = await sb
    .from('geraete')
    .update(patch)
    .eq('protokoll_id', state.protokollId);
  if (updErr) { toast('Reset-Fehler: ' + updErr.message); return; }

  // 3) Mängel der aktuellen Runde nicht löschen — sie bleiben dokumentarisch erhalten

  await loadGeraete();
  await loadMaengel();
  toast(tested.length
    ? `${tested.length} Tests archiviert, Prüfliste zurückgesetzt.`
    : 'Prüfliste zurückgesetzt.');
}

/* ------------------------------------------------------------------ *
 *  Historie laden + rendern
 * ------------------------------------------------------------------ */
async function loadHistorie(){
  if (!state.protokollId) { state.historie = []; renderHistorie(); return; }
  const { data, error } = await sb
    .from('geraete_history')
    .select('*')
    .eq('protokoll_id', state.protokollId)
    .order('archived_at', { ascending: false })
    .order('nr', { ascending: true });
  if (error) { toast('Historie: ' + error.message); return; }
  state.historie = data || [];
  // Standardmäßig die jüngste Runde anzeigen
  if (state.historie.length && !state.historie.find(h => h.batch_id === state.historieBatch)) {
    state.historieBatch = state.historie[0].batch_id;
  }
  renderHistorie();
}

function renderHistorie(){
  const tbody = $('#historie-body');
  const sel   = $('#historie-batch');
  if (!tbody || !sel) return;

  // Einzigartige Batches (jüngste zuerst)
  const batches = [];
  const seen = new Set();
  for (const h of state.historie) {
    if (seen.has(h.batch_id)) continue;
    seen.add(h.batch_id);
    batches.push({
      id: h.batch_id,
      archived_at: h.archived_at,
      count: state.historie.filter(x => x.batch_id === h.batch_id).length
    });
  }

  // Dropdown füllen
  sel.innerHTML = '';
  if (!batches.length) {
    sel.innerHTML = '<option value="">(keine archivierten Prüfungen)</option>';
  } else {
    for (const b of batches) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${tsForDisplay(b.archived_at)} — ${b.count} Geräte`;
      if (b.id === state.historieBatch) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // Tabelle füllen
  const rows = state.historie.filter(h => h.batch_id === state.historieBatch);
  tbody.innerHTML = '';
  for (const h of rows) {
    const tr = document.createElement('tr');
    const cellChk = (v) => v
      ? `<span class="badge ${v==='OK'?'ok':v==='NOK'?'nok':'na'}">${v}</span>`
      : '';
    tr.innerHTML = `
      <td>${h.nr ?? ''}</td>
      <td>${esc(h.raumname)}</td>
      <td>${esc(h.zimmer)}</td>
      <td>${esc(h.bett)}</td>
      <td>${cellChk(h.sichtpruefung)}</td>
      <td>${cellChk(h.befestigung)}</td>
      <td>${cellChk(h.rufausloesung)}</td>
      <td>${cellChk(h.opt_anzeige)}</td>
      <td>${cellChk(h.quittierung)}</td>
      <td>${cellChk(h.gesamt_ergebnis)}</td>
      <td>${esc(h.bemerkung)}</td>
      <td>${esc(h.geprueft_von)}</td>
      <td>${tsForDisplay(h.geprueft_am)}</td>
    `;
    tbody.appendChild(tr);
  }

  $('#count-historie').textContent = batches.length || '';
}

// Reset-Button und Batch-Wechsel verdrahten
$('#btn-reset-tests').addEventListener('click', archiveAndResetTests);
$('#historie-batch').addEventListener('change', (e) => {
  state.historieBatch = e.target.value;
  renderHistorie();
});

// Delegiertes Event-Handling für Prüf-Buttons und Text-Inputs
$('#pruefliste-body').addEventListener('click', async (e) => {
  // Aufklapp-/Zuklapp-Toggle für Räume
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    const k = toggleBtn.dataset.toggle;
    if (state.collapsed.has(k)) state.collapsed.delete(k);
    else state.collapsed.add(k);
    e.stopPropagation();
    renderPruefliste();
    return;
  }

  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);

  // "+ Bett" am Zimmer
  if (e.target.closest('[data-add-bett]')) {
    const parentDev = state.geraete.find(d => d.id === id);
    if (parentDev) await addBettToRoom(parentDev);
    return;
  }
  // Komplettes Zimmer löschen (alle Betten mit weg)
  if (e.target.closest('[data-del-zimmer]')) {
    const dev = state.geraete.find(d => d.id === id);
    if (dev && dev.zimmer) await deleteZimmer(dev.zimmer);
    return;
  }
  // Einzelner Eintrag löschen
  if (e.target.closest('[data-del-row]')) {
    await deleteGeraet(id);
    return;
  }
  // "✗ NOK" - Gesamtergebnis NOK + Fokus auf Bemerkung
  if (e.target.matches('[data-allnok]')) {
    const patch = { gesamt_ergebnis: 'NOK', geprueft_am: new Date().toISOString() };
    await patchGeraet(id, patch, row);
    // Den Bemerkung-Input direkt fokussieren (Karte neu gerendert -> per id wiederfinden)
    setTimeout(() => {
      const r = $(`tr[data-id="${id}"]`);
      const bem = r && r.querySelector('[data-f="bemerkung"]');
      if (bem) { bem.focus(); bem.scrollIntoView({behavior:'smooth', block:'center'}); }
    }, 60);
    return;
  }

  // "Alle OK" Button - bei einem Zimmer auch alle zugehörigen Betten setzen
  if (e.target.matches('[data-allok]')) {
    const nowIso = new Date().toISOString();
    const patch = { geprueft_am: nowIso };
    for (const f of CHECK_FIELDS) patch[f] = 'OK';
    patch.gesamt_ergebnis = 'OK';
    await patchGeraet(id, patch, row);

    // Wenn die geklickte Zeile ein Zimmer mit Betten ist: kaskadiere zu allen Betten
    const groups = buildGroups(state.geraete);
    const parentDev = state.geraete.find(d => d.id === id);
    if (parentDev) {
      const key = parentDev.zimmer;
      const grp = groups.find(g => g.key === key);
      if (grp && grp.parent && grp.parent.id === id && grp.children.length) {
        toast('Übernehme "Alle OK" auf ' + grp.children.length + ' Bett(en) ...');
        for (const child of grp.children) {
          await patchGeraet(child.id, patch, null);
        }
      }
    }
    return;
  }

  // Prüf-Chip
  const chkBtn = e.target.closest('.chk button');
  if (chkBtn) {
    const field = chkBtn.parentElement.dataset.field;
    const val   = chkBtn.dataset.val;
    const g     = state.geraete.find(x => x.id === id);
    const newVal = (g[field] === val) ? null : val;
    const patch = { [field]: newVal };

    // Auto-Gesamtergebnis: NOK wenn irgendein Kriterium NOK, sonst OK wenn alle gesetzt, sonst null
    if (field !== 'gesamt_ergebnis') {
      const probe = { ...g, ...patch };
      const vals = CHECK_FIELDS.map(f => probe[f]);
      if (vals.some(v => v === 'NOK')) patch.gesamt_ergebnis = 'NOK';
      else if (vals.every(v => v === 'OK' || v === 'NA')) patch.gesamt_ergebnis = 'OK';
    }

    // Beim Setzen einer Bewertung Datum + Uhrzeit automatisch eintragen
    if (newVal != null) patch.geprueft_am = new Date().toISOString();

    await patchGeraet(id, patch, row);
  }
});

$('#pruefliste-body').addEventListener('change', async (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const fld = e.target.dataset.f;
  if (!fld) return;
  const id = Number(row.dataset.id);
  let val = e.target.value || null;
  if (fld === 'geprueft_am') val = tsFromLocal(val);
  await patchGeraet(id, { [fld]: val }, row);
});

async function patchGeraet(id, patch, row) {
  const { data, error } = await sb.from('geraete').update(patch).eq('id', id).select().single();
  if (error) { toast('Fehler: ' + error.message); return; }
  const idx = state.geraete.findIndex(g => g.id === id);
  if (idx >= 0) state.geraete[idx] = data;
  renderPruefliste();

  // Auto-Mangel bei NOK
  if (patch.gesamt_ergebnis === 'NOK') {
    await ensureMangelForGeraet(data);
  }

  // Wenn alle Geräte geprüft sind: automatisch archivieren
  await maybeArchive();
}

const CHECK_LABEL = {
  sichtpruefung:'Sichtprüfung', befestigung:'Befestigung', rufausloesung:'Rufauslösung',
  opt_anzeige:'Opt. Anzeige', quittierung:'Quittierung'
};

function failedChecks(g) {
  return CHECK_FIELDS.filter(f => g[f] === 'NOK').map(f => CHECK_LABEL[f]);
}

/* ------------------------------------------------------------------ *
 *  Mängelliste
 * ------------------------------------------------------------------ */
async function ensureMangelForGeraet(g) {
  const existing = state.maengel.find(m => m.geraet_id === g.id && !m.erledigt_am);
  const fails = failedChecks(g);
  const beschreibung = (g.bemerkung && g.bemerkung.trim())
    ? g.bemerkung
    : (fails.length ? 'NOK: ' + fails.join(', ') : 'NOK - Details bitte erfassen');

  if (existing) {
    // Beschreibung beim bestehenden Eintrag aktualisieren, falls noch leer
    if (!existing.mangelbeschreibung || existing.mangelbeschreibung.startsWith('NOK')) {
      const { error } = await sb.from('maengel').update({
        mangelbeschreibung: beschreibung,
        raumname: g.raumname, zimmer: g.zimmer, bett: g.bett, geraetetyp: g.geraetetyp
      }).eq('id', existing.id);
      if (!error) await loadMaengel();
    }
    return;
  }

  const m = {
    protokoll_id: state.protokollId,
    geraet_id: g.id,
    nr: g.nr,
    raumname: g.raumname,
    zimmer: g.zimmer,
    bett: g.bett,
    geraetetyp: g.geraetetyp,
    pruefdatum: g.geprueft_am || new Date().toISOString().slice(0,10),
    mangelbeschreibung: beschreibung,
    prioritaet: 'M'
  };
  const { error } = await sb.from('maengel').insert(m);
  if (error) { toast('Mangel: ' + error.message); return; }
  await loadMaengel();
  toast('Mangel automatisch in die Mängelliste eingetragen.');
}

/* ------------------------------------------------------------------ *
 *  Archivierung
 * ------------------------------------------------------------------ */
async function maybeArchive() {
  if (!state.deckblatt || state.deckblatt.archived_at) return;
  if (!state.geraete.length) return;
  const allDone = state.geraete.every(g => g.gesamt_ergebnis);
  if (!allDone) return;

  const stamp = new Date().toISOString();
  const { error } = await sb.from('protokolle').update({ archived_at: stamp }).eq('id', state.protokollId);
  if (error) { toast('Archivieren fehlgeschlagen: ' + error.message); return; }
  state.deckblatt.archived_at = stamp;
  toast('🗄️ Alle Geräte geprüft - Protokoll wurde archiviert.');
  await loadProtokolle();      // archivierte werden im Dropdown ausgeblendet
  await loadArchive();
}

async function loadArchive() {
  const { data, error } = await sb
    .from('protokolle')
    .select('id, krankenhaus, station, pruefdatum_von, pruefdatum_bis, archived_at')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) { toast('Archiv: ' + error.message); return; }

  const box = $('#archive-list');
  box.innerHTML = '';
  if (!data.length) { box.innerHTML = '<div class="archive-empty">Keine archivierten Protokolle.</div>'; return; }
  for (const p of data) {
    const item = document.createElement('div');
    item.className = 'archive-item';
    const title = [p.krankenhaus || '(ohne Name)', p.station].filter(Boolean).join(' - ');
    const dates = [p.pruefdatum_von, p.pruefdatum_bis].filter(Boolean).join(' bis ');
    const arch = new Date(p.archived_at).toLocaleString('de-DE');
    item.innerHTML = `
      <div class="meta">
        <strong>${esc(title)}</strong>
        <small>${esc(dates)} - archiviert ${esc(arch)}</small>
      </div>
      <button class="btn small" data-restore="${p.id}">Wieder auswerfen</button>
    `;
    box.appendChild(item);
  }
}

$('#archive-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-restore]');
  if (!btn) return;
  const id = btn.dataset.restore;
  if (!confirm('Dieses Protokoll wieder aktivieren?')) return;
  const { error } = await sb.from('protokolle').update({ archived_at: null }).eq('id', id);
  if (error) { toast('Fehler: ' + error.message); return; }
  toast('Protokoll wieder aktiv.');
  await loadProtokolle();
  await loadArchive();
});

/* ------------------------------------------------------------------ *
 *  Prüfliste-Suche / Filter / Aufklappen
 * ------------------------------------------------------------------ */
$('#filter-input').addEventListener('input', (e) => {
  state.filter.text = e.target.value.toLowerCase();
  renderPruefliste();
});
$('#filter-status').addEventListener('change', (e) => {
  state.filter.status = e.target.value;
  renderPruefliste();
});
$('#btn-expand-all').addEventListener('click', () => {
  state.collapsed.clear();
  renderPruefliste();
});
$('#btn-collapse-all').addEventListener('click', () => {
  const groups = buildGroups(state.geraete);
  for (const g of groups) if (g.children.length) state.collapsed.add(g.key);
  renderPruefliste();
});

/* ------------------------------------------------------------------ *
 *  Sortierbare Tabellen-Header
 * ------------------------------------------------------------------ */
$$('.table-pruefliste thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sort.col === col) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.col = col;
      state.sort.dir = 'asc';
    }
    $$('.table-pruefliste thead th').forEach(t => t.classList.remove('sorted-asc','sorted-desc'));
    th.classList.add(state.sort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    renderPruefliste();
  });
});

/* ------------------------------------------------------------------ *
 *  Mängel manuell erfassen / löschen / editieren
 * ------------------------------------------------------------------ */
$('#btn-add-mangel').addEventListener('click', async () => {
  if (!state.protokollId) { toast('Erst Protokoll wählen.'); return; }
  const beschreibung = prompt('Mangelbeschreibung:');
  if (!beschreibung) return;
  const m = {
    protokoll_id: state.protokollId,
    pruefdatum: today(),
    mangelbeschreibung: beschreibung,
    prioritaet: 'M'
  };
  const { error } = await sb.from('maengel').insert(m);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadMaengel();
});

$('#maengel-body').addEventListener('input', async (e) => {
  const inp = e.target.closest('input,select,textarea');
  if (!inp) return;
  const tr = inp.closest('tr[data-id]'); if (!tr) return;
  const id = Number(tr.dataset.id);
  const field = inp.dataset.f; if (!field) return;
  const val = inp.value || null;
  const { error } = await sb.from('maengel').update({ [field]: val }).eq('id', id);
  if (error) toast('Fehler: ' + error.message);
});

$('#maengel-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del-mangel]');
  if (!btn) return;
  const id = Number(btn.dataset.delMangel);
  if (!confirm('Mangel wirklich löschen?')) return;
  const { error } = await sb.from('maengel').delete().eq('id', id);
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadMaengel();
});

/* ------------------------------------------------------------------ *
 *  Excel-Export
 * ------------------------------------------------------------------ */
$('#btn-export-xlsx').addEventListener('click', () => {
  if (!state.deckblatt) { toast('Erst Protokoll wählen.'); return; }
  const wb = XLSX.utils.book_new();
  const d = state.deckblatt;
  const deck = [
    ['Prüfprotokoll Notrufsystem nach DIN VDE 0834'],
    [],
    ['Krankenhaus / Einrichtung',  d.krankenhaus || ''],
    ['Station / Bereich',          d.station || ''],
    ['Anlage / System',            d.anlage || ''],
    ['Verantwortl. Techniker',     d.verantwortlicher || ''],
    ['Prüfdatum von',              d.pruefdatum_von || ''],
    ['Prüfdatum bis',              d.pruefdatum_bis || ''],
    ['Prüfer',                     d.pruefer || ''],
    ['Qualifikation / Firma',      d.qualifikation || ''],
    ['Prüfauftrag-Nr.',            d.auftrag_nr || ''],
    ['Nächste Prüfung fällig',     d.naechste_pruefung || ''],
    ['Bemerkung',                  d.bemerkung || ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deck), 'Deckblatt');

  const pHeader = ['Nr.','Raumname','Zimmer','Bett','SW-Version',
    'Sichtprüfung','Befestigung','Rufauslösung','Opt. Anzeige','Quittierung',
    'Gesamtergebnis','Bemerkung','Geprüft von','Datum / Zeit'];
  const pRows = state.geraete.map(g => [
    g.nr, g.raumname, g.zimmer || '', g.bett || '', g.sw_version,
    g.sichtpruefung, g.befestigung, g.rufausloesung, g.opt_anzeige, g.quittierung,
    g.gesamt_ergebnis, g.bemerkung, g.geprueft_von, tsForDisplay(g.geprueft_am)
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pHeader, ...pRows]), 'Prüfliste');

  const mHeader = ['Nr.','Raumname','Zimmer','Bett','Gerätetyp','Prüfdatum','Mangelbeschreibung','Sofortmaßnahme','Priorität','Verantwortlich','Erledigt am'];
  const mRows = state.maengel.map(m => [
    m.nr, m.raumname, m.zimmer || '', m.bett || '',
    m.geraetetyp, m.pruefdatum, m.mangelbeschreibung, m.sofortmassnahme, m.prioritaet, m.verantwortlich, m.erledigt_am
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([mHeader, ...mRows]), 'Mängel');

  if (state.historie && state.historie.length) {
    const hHeader = ['Archiviert am','Nr.','Raumname','Zimmer','Bett','Sicht','Bef.','Ruf','Opt.','Quitt.','Gesamt','Bemerkung','Prüfer','Datum / Zeit'];
    const hRows = state.historie.map(h => [
      tsForDisplay(h.archived_at), h.nr, h.raumname, h.zimmer || '', h.bett || '',
      h.sichtpruefung, h.befestigung, h.rufausloesung, h.opt_anzeige, h.quittierung,
      h.gesamt_ergebnis, h.bemerkung, h.geprueft_von, tsForDisplay(h.geprueft_am)
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hHeader, ...hRows]), 'Historie');
  }

  const fname = `Pruefprotokoll_${(d.station||'station').replace(/\s+/g,'_')}_${d.pruefdatum_bis||today()}.xlsx`;
  XLSX.writeFile(wb, fname);
});

$('#btn-print').addEventListener('click', () => window.print());

/* ------------------------------------------------------------------ *
 *  Init
 * ------------------------------------------------------------------ */
sb.auth.onAuthStateChange((_e, session) => {
  state.session = session || null;
  if (session) showApp(); else showLogin();
});

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  state.session = session || null;
  if (session) showApp(); else showLogin();
})();
