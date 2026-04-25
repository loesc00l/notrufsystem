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
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const email = $('#login-email').value;
  const pw    = $('#login-password').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) { $('#login-error').textContent = error.message; return; }
  afterLogin(data.user);
});

$('#btn-signup').addEventListener('click', async () => {
  $('#login-error').textContent = '';
  const email = $('#login-email').value;
  const pw    = $('#login-password').value;
  if (!email || !pw) { $('#login-error').textContent = 'E-Mail und Passwort eingeben.'; return; }
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { $('#login-error').textContent = error.message; return; }
  if (data.user && !data.session) {
    $('#login-error').style.color = 'green';
    $('#login-error').textContent = 'Bestätigungs-E-Mail gesendet. Bitte prüfen und danach anmelden.';
  } else {
    afterLogin(data.user);
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function afterLogin(user) {
  state.user = user;
  $('#user-email').textContent = user.email;
  show('#view-app');
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

  tr.innerHTML = `
    <td>${d.nr}</td>
    <td><input data-f="raumname" value="${esc(d.raumname)}" /></td>
    <td>${zimmerCell}</td>
    <td>${esc(bett)}</td>
    <td>${chkCell('sichtpruefung', d)}</td>
    <td>${chkCell('befestigung', d)}</td>
    <td>${chkCell('rufausloesung', d)}</td>
    <td>${chkCell('opt_anzeige', d)}</td>
    <td>${chkCell('quittierung', d)}</td>
    <td>${chkCell('gesamt_ergebnis_x', d).replace('data-field="gesamt_ergebnis_x"','data-field="gesamt_ergebnis"')}
       <br><button class="btn small" data-allok>Alle OK</button></td>
    <td><input data-f="bemerkung" value="${esc(d.bemerkung)}" /></td>
    <td><input data-f="geprueft_von" value="${esc(d.geprueft_von)}" /></td>
    <td><input data-f="geprueft_am" type="date" value="${d.geprueft_am||''}" /></td>
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

  // "Alle OK" Button - bei einem Zimmer auch alle zugehörigen Betten setzen
  if (e.target.matches('[data-allok]')) {
    const patch = {};
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

    await patchGeraet(id, patch, row);
  }
});

$('#pruefliste-body').addEventListener('change', async (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const fld = e.target.dataset.f;
  if (!fld) return;
  const id = Number(row.dataset.id);
  const val = e.target.value || null;
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
        <small>${esc(dates)} ${dates ? '· ' : ''}archiviert: ${esc(arch)}</small>
      </div>
      <button class="btn small" data-restore="${p.id}">Wieder auswerfen</button>
    `;
    box.appendChild(item);
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-restore]');
  if (!btn) return;
  const pid = btn.dataset.restore;
  if (!confirm('Protokoll wieder aktivieren? Es erscheint dann wieder im Dropdown.')) return;
  const { error } = await sb.from('protokolle').update({ archived_at: null }).eq('id', pid);
  if (error) { toast(error.message); return; }
  toast('Protokoll wieder aktiviert.');
  await loadProtokolle();
  await loadArchive();
});

$('#btn-add-mangel').addEventListener('click', async () => {
  const { error } = await sb.from('maengel').insert({
    protokoll_id: state.protokollId, mangelbeschreibung: '', prioritaet: 'M'
  });
  if (error) { toast('Fehler: ' + error.message); return; }
  await loadMaengel();
});

function renderMaengel() {
  const tbody = $('#maengel-body');
  tbody.innerHTML = '';
  for (const m of state.maengel) {
    const tr = document.createElement('tr');
    tr.dataset.id = m.id;
    tr.innerHTML = `
      <td><input data-f="nr" type="number" value="${m.nr||''}" style="width:60px" /></td>
      <td><input data-f="raumname" value="${esc(m.raumname)}" /></td>
      <td><input data-f="zimmer"   value="${esc(m.zimmer)}" /></td>
      <td><input data-f="bett"     value="${esc(m.bett)}" style="width:60px" /></td>
      <td><input data-f="geraetetyp" value="${esc(m.geraetetyp)}" /></td>
      <td><input data-f="pruefdatum" type="date" value="${m.pruefdatum||''}" /></td>
      <td><input data-f="mangelbeschreibung" value="${esc(m.mangelbeschreibung)}" /></td>
      <td><input data-f="sofortmassnahme" value="${esc(m.sofortmassnahme)}" /></td>
      <td>
        <select data-f="prioritaet">
          <option value="H" ${m.prioritaet==='H'?'selected':''}>H</option>
          <option value="M" ${m.prioritaet==='M'?'selected':''}>M</option>
          <option value="N" ${m.prioritaet==='N'?'selected':''}>N</option>
        </select>
      </td>
      <td><input data-f="verantwortlich" value="${esc(m.verantwortlich)}" /></td>
      <td><input data-f="erledigt_am" type="date" value="${m.erledigt_am||''}" /></td>
      <td><button class="btn small danger" data-del>Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
}

$('#maengel-body').addEventListener('change', async (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  const fld = e.target.dataset.f;
  if (!fld) return;
  const val = e.target.value || null;
  const { error } = await sb.from('maengel').update({ [fld]: val }).eq('id', id);
  if (error) toast('Fehler: ' + error.message);
  const idx = state.maengel.findIndex(m => m.id === id);
  if (idx >= 0) state.maengel[idx][fld] = val;
});

$('#maengel-body').addEventListener('click', async (e) => {
  if (!e.target.matches('[data-del]')) return;
  const row = e.target.closest('tr[data-id]');
  const id = Number(row.dataset.id);
  if (!confirm('Mangel wirklich löschen?')) return;
  const { error } = await sb.from('maengel').delete().eq('id', id);
  if (error) { toast(error.message); return; }
  await loadMaengel();
});

/* ------------------------------------------------------------------ *
 *  Export: XLSX und Drucken
 * ------------------------------------------------------------------ */
$('#btn-print').addEventListener('click', () => window.print());

$('#btn-export-xlsx').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();

  const d = state.deckblatt || {};
  const deck = [
    ['Prüfprotokoll Notrufsystem - DIN VDE 0834'],
    [],
    ['Krankenhaus / Einrichtung', d.krankenhaus || ''],
    ['Station / Bereich',         d.station || ''],
    ['Anlage / System',           d.anlage || ''],
    ['Verantwortl. Techniker',    d.verantwortlicher || ''],
    ['Prüfdatum von',             d.pruefdatum_von || ''],
    ['Prüfdatum bis',             d.pruefdatum_bis || ''],
    ['Prüfer',                    d.pruefer || ''],
    ['Qualifikation / Firma',     d.qualifikation || ''],
    ['Prüfauftrag-Nr.',           d.auftrag_nr || ''],
    ['Nächste Prüfung fällig',    d.naechste_pruefung || ''],
    ['Bemerkung',                 d.bemerkung || ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deck), 'Deckblatt');

  const pHeader = ['Nr.','Raumname','Zimmer','Bett','SW-Version',
    'Sichtprüfung','Befestigung','Rufauslösung','Opt. Anzeige','Quittierung',
    'Gesamtergebnis','Bemerkung','Geprüft von','Datum'];
  const pRows = state.geraete.map(g => [
    g.nr, g.raumname,
    g.zimmer || '',
    g.bett   || '',
    g.sw_version,
    g.sichtpruefung, g.befestigung, g.rufausloesung, g.opt_anzeige, g.quittierung,
    g.gesamt_ergebnis, g.bemerkung, g.geprueft_von, g.geprueft_am
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pHeader, ...pRows]), 'Prüfliste');

  const mHeader = ['Nr.','Raumname','Zimmer','Bett','Gerätetyp','Prüfdatum','Mangelbeschreibung','Sofortmaßnahme','Priorität','Verantwortlich','Erledigt am'];
  const mRows = state.maengel.map(m => [
    m.nr, m.raumname,
    m.zimmer || '',
    m.bett   || '',
    m.geraetetyp, m.pruefdatum, m.mangelbeschreibung, m.sofortmassnahme, m.prioritaet, m.verantwortlich, m.erledigt_am
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([mHeader, ...mRows]), 'Mängelliste');

  const name = 'Pruefprotokoll_' + (d.krankenhaus || 'Notrufsystem').replace(/\s+/g,'_') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
  XLSX.writeFile(wb, name);
  toast('Excel-Datei heruntergeladen.');
});

/* ------------------------------------------------------------------ *
 *  Start
 * ------------------------------------------------------------------ */
(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) afterLogin(session.user);
  else show('#view-login');
})();
