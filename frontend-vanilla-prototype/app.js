'use strict';

/* ============================================================
   Состояние и работа с API
   ============================================================ */

const state = {
  baseUrl: localStorage.getItem('netdoc.baseUrl') || 'http://localhost:8000',
  token: localStorage.getItem('netdoc.token') || null,
  me: null,
  tags: [],
  deviceTypes: [],
  vlans: [],
  templates: [],  // шаблоны устройств, с вложенными interfaces
  devices: [],    // устройства спецификации оборудования, с вложенными interfaces (+ connected_to)
  links: [],
  linkTemplates: [],
};

class ApiError extends Error {}

async function api(path, { method = 'GET', body, auth = true, form = false } = {}) {
  const headers = {};
  if (auth && state.token) headers['Authorization'] = `Bearer ${state.token}`;
  let payload = body;
  if (body !== undefined && !form) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(state.baseUrl + path, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError(`Не удалось подключиться к ${state.baseUrl} (${e.message})`);
  }
  if (res.status === 204) return null;
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const detail = (data && data.detail) ? data.detail : res.statusText;
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

/* Пустая строка из формы -> null, чтобы не ловить ошибки INET/MACADDR на бэкенде */
function nn(v) {
  if (v === undefined) return null;
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' ? null : t;
}
function nnInt(v) { const s = nn(v); return s === null ? null : parseInt(s, 10); }
function nnFloat(v) { const s = nn(v); return s === null ? null : parseFloat(s); }

function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showToast(msg, isErr = false) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function withBusyHandling(fn) {
  try { await fn(); }
  catch (e) { showToast(e.message || String(e), true); throw e; }
}

/* ============================================================
   Модальное окно
   ============================================================ */

function openModal(title, bodyHtml) {
  el('modal-title').textContent = title;
  el('modal-body').innerHTML = bodyHtml;
  el('modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  el('modal-backdrop').classList.add('hidden');
  el('modal-body').innerHTML = '';
}
el('modal-close').addEventListener('click', closeModal);
el('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });

/* ============================================================
   Вход / выход
   ============================================================ */

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';
  state.baseUrl = el('api-base').value.trim().replace(/\/$/, '');
  const username = el('login-username').value.trim();
  const password = el('login-password').value;

  try {
    const params = new URLSearchParams();
    params.set('username', username);
    params.set('password', password);
    const tokenResp = await api('/auth/login', { method: 'POST', body: params, form: true, auth: false });
    state.token = tokenResp.access_token;
    localStorage.setItem('netdoc.baseUrl', state.baseUrl);
    localStorage.setItem('netdoc.token', state.token);
    await enterApp();
  } catch (err) {
    el('login-error').textContent = err.message;
  }
});

el('logout-btn').addEventListener('click', () => {
  state.token = null;
  localStorage.removeItem('netdoc.token');
  el('app').classList.add('hidden');
  el('login-screen').classList.remove('hidden');
});

async function tryAutoLogin() {
  if (!state.token) return;
  try {
    await enterApp();
  } catch {
    state.token = null;
    localStorage.removeItem('netdoc.token');
  }
}

async function enterApp() {
  state.me = await api('/auth/me');
  el('login-screen').classList.add('hidden');
  el('app').classList.remove('hidden');
  el('whoami').textContent = `${state.me.full_name} (${state.me.role})`;
  el('nav-users').style.display = state.me.role === 'admin' ? '' : 'none';
  await loadAll();
  switchTab(document.querySelector('#nav button.active')?.dataset.tab || 'devices');
}

/* ============================================================
   Навигация по вкладкам
   ============================================================ */

document.querySelectorAll('#nav button').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
  const renderers = {
    devices: renderDevicesTab, templates: renderTemplatesTab, links: renderLinksTab,
    topology: renderTopologyTab, tags: renderTagsTab, vlans: renderVlansTab, users: renderUsersTab,
    search: () => {},
  };
  (renderers[tab] || (() => {}))();
}

/* ============================================================
   Загрузка справочных данных
   ============================================================ */

async function loadAll() {
  await withBusyHandling(async () => {
    [state.tags, state.deviceTypes, state.vlans, state.templates, state.devices, state.links, state.linkTemplates] = await Promise.all([
      api('/tags'), api('/device-types'), api('/vlans'), api('/device-templates'), api('/devices'), api('/links'), api('/link-templates'),
    ]);
    fillTagSelects();
    fillTypeSelect();
  });
}

/* Плоский список тегов в порядке дерева (родитель, потом его дети —
   глубина depth для отступа), только для организации отображения. */
function flattenTagsOrdered() {
  const byParent = new Map();
  state.tags.forEach(t => {
    const key = t.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  });
  const out = [];
  function walk(parentId, depth) {
    const children = (byParent.get(parentId) || []).sort((a, b) => a.name.localeCompare(b.name));
    for (const t of children) {
      out.push({ tag: t, depth });
      walk(t.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

function fillTagSelects() {
  const opts = flattenTagsOrdered()
    .map(({ tag, depth }) => `<option value="${tag.id}">${'—'.repeat(depth)} ${esc(tag.name)}</option>`)
    .join('');
  el('dev-filter-tag').innerHTML = '<option value="">Все теги</option>' + opts;
  el('topo-filter-tag').innerHTML = '<option value="">Все теги</option>' + opts;
}
function fillTypeSelect() {
  el('dev-filter-type').innerHTML = '<option value="">Все типы</option>' +
    state.deviceTypes.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}

function tagById(id) { return state.tags.find(t => t.id === id); }
function tagPath(id) {
  const parts = [];
  let t = tagById(id);
  while (t) {
    parts.unshift(t.name);
    t = t.parent_id ? tagById(t.parent_id) : null;
  }
  return parts.join(' / ');
}
function typeName(id) { return state.deviceTypes.find(t => t.id === id)?.name || '—'; }
function templateById(id) { return state.templates.find(t => t.id === id); }
function typeNameForTemplate(tpl) { return tpl ? typeName(tpl.device_type_id) : '—'; }
function typeNameForDevice(d) { return typeNameForTemplate(templateById(d.template_id)); }
function templateNameForDevice(d) { return templateById(d.template_id)?.name || '—'; }
function linkTemplateById(id) { return state.linkTemplates.find(t => t.id === id); }

/* Плоский список свободных портов по всем устройствам — для выпадающих
   списков "подключить к..." */
function freeInterfaceEntries() {
  const out = [];
  for (const d of state.devices) {
    for (const i of (d.interfaces || [])) {
      if (!i.connected_to) out.push({ device: d, iface: i });
    }
  }
  return out;
}

/* карта интерфейс -> {device, iface}, собирается из уже загруженных устройств */
function buildIfaceMap() {
  const map = new Map();
  for (const d of state.devices) {
    for (const i of (d.interfaces || [])) map.set(i.id, { device: d, iface: i });
  }
  return map;
}

/* ============================================================
   Вкладка «Устройства»
   ============================================================ */

el('dev-filter-tag').addEventListener('change', renderDevicesTab);
el('dev-filter-type').addEventListener('change', renderDevicesTab);
el('dev-add-btn').addEventListener('click', () => openDeviceForm());

function renderDevicesTab() {
  const tagId = el('dev-filter-tag').value;
  const typeId = el('dev-filter-type').value;
  let list = state.devices;
  if (tagId) list = list.filter(d => (d.tags || []).some(t => String(t.id) === tagId));
  if (typeId) list = list.filter(d => String(templateById(d.template_id)?.device_type_id) === typeId);
  list = [...list].sort((a, b) => a.code.localeCompare(b.code));

  const freeEntries = freeInterfaceEntries();
  el('devices-list').innerHTML = list.map(d => deviceCardHtml(d, freeEntries)).join('') ||
    '<p class="muted">Нет устройств по выбранным фильтрам.</p>';

  list.forEach(d => {
    const card = document.getElementById(`dcard-${d.id}`);
    card.querySelector('.device-card-header').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      card.classList.toggle('open');
    });
    card.querySelector('.js-edit').addEventListener('click', () => openDeviceForm(d));
    card.querySelector('.js-delete').addEventListener('click', () => deleteDevice(d));
    card.querySelector('.js-add-iface').addEventListener('click', () => addInterfaceRow(d));
    card.querySelector('.js-bulk-ports').addEventListener('click', () => bulkAddPorts(d));
    card.querySelectorAll('.js-iface-save').forEach(b =>
      b.addEventListener('click', () => saveInterfaceRow(d, parseInt(b.dataset.id, 10))));
    card.querySelectorAll('.js-iface-delete').forEach(b =>
      b.addEventListener('click', () => deleteInterface(d, parseInt(b.dataset.id, 10))));
    card.querySelectorAll('.js-iface-connect').forEach(b =>
      b.addEventListener('click', () => connectPort(d, parseInt(b.dataset.id, 10))));
    card.querySelectorAll('.js-iface-disconnect').forEach(b =>
      b.addEventListener('click', () => disconnectPort(d, parseInt(b.dataset.link, 10))));
  });
}

/* Группирует свободные порты по устройству (optgroup), чтобы список
   "подключить к..." читался как устройство -> порт, а не плоской кашей.
   Уже подключённые порты сюда не попадают вовсе — freeEntries строится
   только из портов без connected_to. */
function connectTargetOptionsHtml(excludeIfaceId, freeEntries) {
  const byDevice = new Map();
  for (const e of freeEntries) {
    if (e.iface.id === excludeIfaceId) continue;
    if (!byDevice.has(e.device.id)) byDevice.set(e.device.id, { device: e.device, entries: [] });
    byDevice.get(e.device.id).entries.push(e);
  }
  return [...byDevice.values()]
    .sort((a, b) => a.device.code.localeCompare(b.device.code))
    .map(({ device, entries }) => {
      const label = device.name ? `${device.code} — ${device.name}` : device.code;
      const opts = entries
        .sort((a, b) => (a.iface.port_number ?? 9999) - (b.iface.port_number ?? 9999))
        .map(e => `<option value="${e.iface.id}">${esc(e.iface.label)}</option>`)
        .join('');
      return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
    })
    .join('');
}

function connectionCellHtml(i, freeEntries) {
  if (i.connected_to) {
    const c = i.connected_to;
    return `
      <span class="conn-info">→ ${esc(c.device_code)} · ${esc(c.interface_label)}</span>
      <button class="small-btn danger js-iface-disconnect" data-link="${c.link_id}">Отключить</button>`;
  }
  return `
    <select class="if-connect-target">
      <option value="">— свободен —</option>
      ${connectTargetOptionsHtml(i.id, freeEntries)}
    </select>
    <button class="small-btn js-iface-connect" data-id="${i.id}">Подключить</button>`;
}

function deviceCardHtml(d, freeEntries) {
  const ifaces = [...(d.interfaces || [])].sort((a, b) =>
    (a.port_number ?? 9999) - (b.port_number ?? 9999) || a.label.localeCompare(b.label));

  const rows = ifaces.map(i => `
    <tr>
      <td><input class="if-label" value="${esc(i.label)}" style="width:70px"></td>
      <td><input class="if-port" type="number" value="${i.port_number ?? ''}" style="width:55px"></td>
      <td><select class="if-porttype">
        <option value="">—</option>
        ${['access', 'trunk', 'uplink'].map(s => `<option value="${s}" ${s === i.port_type ? 'selected' : ''}>${s}</option>`).join('')}
      </select></td>
      <td><select class="if-vlan">
        <option value="">—</option>
        ${state.vlans.map(v => `<option value="${v.id}" ${v.id === i.vlan_id ? 'selected' : ''}>${v.vlan_number} ${esc(v.name || '')}</option>`).join('')}
      </select></td>
      <td><input class="if-ip" value="${esc(i.ip || '')}" style="width:100px" placeholder="IP"></td>
      <td><input class="if-mac" value="${esc(i.mac || '')}" style="width:110px" placeholder="MAC"></td>
      <td><input class="if-notes" value="${esc(i.notes || '')}" style="width:90px" placeholder="заметка"></td>
      <td class="conn-cell">${connectionCellHtml(i, freeEntries)}</td>
      <td>
        <button class="small-btn js-iface-save" data-id="${i.id}">✓</button>
        <button class="small-btn danger js-iface-delete" data-id="${i.id}">✕</button>
      </td>
    </tr>`).join('');

  const displayName = d.name || templateNameForDevice(d);

  return `
  <div class="device-card" id="dcard-${d.id}">
    <div class="device-card-header">
      <div class="info">
        <span class="code">${esc(d.code)}</span>
        <span class="name">${esc(displayName)}</span>
        <span class="tag">${esc(typeNameForDevice(d))}</span>
        ${d.name ? `<span class="tag">${esc(templateNameForDevice(d))}</span>` : ''}
        ${d.management_ip ? `<span class="tag">${esc(d.management_ip)}</span>` : ''}
        <span class="tag">${ifaces.length} порт(ов)</span>
        ${(d.tags || []).map(t => `<span class="tag-badge" title="${esc(tagPath(t.id))}">${t.color ? `<span class="dot" style="background:${esc(t.color)}"></span>` : ''}${esc(t.name)}</span>`).join('')}
      </div>
      <div class="device-card-actions">
        <button class="small-btn js-edit">Изменить</button>
        <button class="small-btn danger js-delete">Удалить</button>
      </div>
    </div>
    <div class="device-card-body">
      ${d.location ? `<p class="muted small">Расположение: ${esc(d.location)}</p>` : ''}
      ${d.notes ? `<p class="muted small">${esc(d.notes)}</p>` : ''}
      <table class="iface-table">
        <thead><tr>
          <th>Порт</th><th>№</th><th>Тип</th><th>VLAN</th>
          <th>IP</th><th>MAC</th><th>Заметка</th><th>Подключение</th><th></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="muted">Портов ещё нет</td></tr>'}</tbody>
      </table>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="small-btn js-add-iface">+ Порт</button>
        <input type="number" min="1" max="96" value="24" class="bulk-count" style="width:60px">
        <button class="small-btn js-bulk-ports">Сгенерировать N портов</button>
      </div>
    </div>
  </div>`;
}

function readIfacePayloadFromRow(tr) {
  return {
    label: tr.querySelector('.if-label').value.trim(),
    port_number: nnInt(tr.querySelector('.if-port').value),
    port_type: nn(tr.querySelector('.if-porttype').value),
    vlan_id: nnInt(tr.querySelector('.if-vlan').value),
    ip: nn(tr.querySelector('.if-ip').value),
    mac: nn(tr.querySelector('.if-mac').value),
    notes: nn(tr.querySelector('.if-notes').value),
  };
}

async function saveInterfaceRow(device, ifaceId) {
  const btn = document.querySelector(`.js-iface-save[data-id="${ifaceId}"]`);
  const tr = btn.closest('tr');
  await withBusyHandling(async () => {
    await api(`/interfaces/${ifaceId}`, { method: 'PATCH', body: readIfacePayloadFromRow(tr) });
    showToast('Порт сохранён');
    await loadAll(); renderDevicesTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

async function deleteInterface(device, ifaceId) {
  if (!confirm('Удалить порт? Связанная связь (если есть) тоже будет удалена.')) return;
  await withBusyHandling(async () => {
    await api(`/interfaces/${ifaceId}`, { method: 'DELETE' });
    showToast('Порт удалён');
    await loadAll(); renderDevicesTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

async function addInterfaceRow(device) {
  await withBusyHandling(async () => {
    const n = (device.interfaces || []).length + 1;
    await api(`/devices/${device.id}/interfaces`, { method: 'POST', body: { label: `Порт ${n}`, port_number: n } });
    showToast('Порт добавлен');
    await loadAll(); renderDevicesTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

async function bulkAddPorts(device) {
  const card = document.getElementById(`dcard-${device.id}`);
  const count = parseInt(card.querySelector('.bulk-count').value, 10) || 0;
  if (count <= 0) return;
  if (!confirm(`Создать ${count} портов ("Порт 1".."Порт ${count}")?`)) return;
  await withBusyHandling(async () => {
    const start = (device.interfaces || []).length + 1;
    for (let i = start; i < start + count; i++) {
      await api(`/devices/${device.id}/interfaces`, { method: 'POST', body: { label: `Порт ${i}`, port_number: i } });
    }
    showToast(`Добавлено портов: ${count}`);
    await loadAll(); renderDevicesTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

/* "Подключить к..." прямо у порта — сразу создаёт связь, без отдельной формы. */
async function connectPort(device, ifaceId) {
  const btn = document.querySelector(`.js-iface-connect[data-id="${ifaceId}"]`);
  const select = btn.previousElementSibling;
  const targetId = parseInt(select.value, 10);
  if (!targetId) return showToast('Выберите порт для подключения', true);
  await withBusyHandling(async () => {
    await api('/links', { method: 'POST', body: { interface_a_id: ifaceId, interface_b_id: targetId } });
    showToast('Связь создана');
    await loadAll(); renderDevicesTab(); renderLinksTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

async function disconnectPort(device, linkId) {
  if (!confirm('Удалить связь?')) return;
  await withBusyHandling(async () => {
    await api(`/links/${linkId}`, { method: 'DELETE' });
    showToast('Связь удалена');
    await loadAll(); renderDevicesTab(); renderLinksTab();
    document.getElementById(`dcard-${device.id}`)?.classList.add('open');
  });
}

function tagCheckboxListHtml(selectedIds) {
  const selected = new Set(selectedIds || []);
  const rows = flattenTagsOrdered().map(({ tag, depth }) => `
    <label><input type="checkbox" class="f-tag-check" value="${tag.id}" ${selected.has(tag.id) ? 'checked' : ''}>
      ${'—'.repeat(depth)} ${esc(tag.name)}</label>`).join('');
  return rows || '<p class="muted small">Тегов ещё нет — можно завести во вкладке «Теги».</p>';
}

function openDeviceForm(device) {
  const isEdit = !!device;
  const roleOpts = ['', 'core', 'distribution', 'access'].map(r =>
    `<option value="${r}" ${device?.role === r ? 'selected' : ''}>${r || '—'}</option>`).join('');
  const templateOpts = [...state.templates].sort((a, b) => a.name.localeCompare(b.name)).map(t =>
    `<option value="${t.id}">${esc(t.name)} (${esc(typeName(t.device_type_id))}, ${(t.interfaces || []).length} порт.)</option>`).join('');

  openModal(isEdit ? `Устройство: ${device.code}` : 'Новое устройство', `
    <form id="device-form">
      ${!isEdit ? `
      <label>Шаблон устройства <select id="f-template" required>
        <option value="">— выбрать —</option>${templateOpts}
      </select></label>
      <p class="muted small">Нет нужного шаблона? Сначала заведите его во вкладке «Шаблоны».</p>` : `
      <p class="muted small">Шаблон: ${esc(templateNameForDevice(device))} (после создания не меняется)</p>`}
      <label>Название <input id="f-name" value="${esc(device?.name || '')}" placeholder="необязательно"></label>
      <div class="field-row">
        <label>IP управления <input id="f-mgmt-ip" value="${esc(device?.management_ip || '')}"></label>
        <label>Роль <select id="f-role">${roleOpts}</select></label>
      </div>
      <label>Расположение <input id="f-location" value="${esc(device?.location || '')}" placeholder="цех / шкаф"></label>
      <label>Заметки <textarea id="f-notes" rows="2">${esc(device?.notes || '')}</textarea></label>
      <label>Теги
        <div class="tag-picker">${tagCheckboxListHtml((device?.tags || []).map(t => t.id))}</div>
      </label>
      <div class="modal-actions">
        <button type="submit" class="primary">${isEdit ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>`);

  el('device-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tagIds = [...document.querySelectorAll('.f-tag-check:checked')].map(c => parseInt(c.value, 10));
    const body = {
      name: nn(el('f-name').value),
      management_ip: nn(el('f-mgmt-ip').value),
      location: nn(el('f-location').value),
      role: nn(el('f-role').value),
      notes: nn(el('f-notes').value),
    };
    await withBusyHandling(async () => {
      if (isEdit) {
        await api(`/devices/${device.id}`, { method: 'PATCH', body });
        await api(`/devices/${device.id}/tags`, { method: 'PUT', body: { tag_ids: tagIds } });
      } else {
        const templateId = parseInt(el('f-template').value, 10);
        if (!templateId) { showToast('Выберите шаблон устройства', true); return; }
        body.template_id = templateId;
        body.tag_ids = tagIds;
        await api('/devices', { method: 'POST', body });
      }
      showToast(isEdit ? 'Устройство обновлено' : 'Устройство создано');
      closeModal();
      await loadAll(); renderDevicesTab();
    });
  });
}

async function deleteDevice(device) {
  if (!confirm(`Удалить устройство "${device.code}" вместе со всеми его портами и связями?`)) return;
  await withBusyHandling(async () => {
    await api(`/devices/${device.id}`, { method: 'DELETE' });
    showToast('Устройство удалено');
    await loadAll(); renderDevicesTab(); renderLinksTab();
  });
}

/* ============================================================
   Вкладка «Шаблоны устройств»
   ============================================================ */

el('type-add-btn').addEventListener('click', () => {
  openModal('Новый тип устройства', `
    <form id="type-form">
      <label>Название <input id="f-type-name" required placeholder="напр. Медиаконвертер"></label>
      <label>Префикс кода <input id="f-type-prefix" required maxlength="8" placeholder="напр. MC"></label>
      <p class="muted small">Префикс используется для автогенерации кода устройства: MC-0001, MC-0002...</p>
      <div class="modal-actions"><button type="submit" class="primary">Создать</button></div>
    </form>`);
  el('type-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusyHandling(async () => {
      await api('/device-types', { method: 'POST', body: {
        name: el('f-type-name').value.trim(),
        code_prefix: el('f-type-prefix').value.trim().toUpperCase(),
      }});
      showToast('Тип устройства создан');
      closeModal();
      await loadAll(); renderTemplatesTab();
    });
  });
});

el('template-add-btn').addEventListener('click', () => openTemplateForm());

function renderTemplatesTab() {
  el('types-body').innerHTML = state.deviceTypes.map(t => `
    <tr><td>${esc(t.name)}</td><td>${esc(t.code_prefix)}</td>
    <td><button class="small-btn danger js-type-delete" data-id="${t.id}">Удалить</button></td></tr>`).join('') ||
    '<tr><td colspan="3" class="muted">Типов ещё нет</td></tr>';
  el('types-body').querySelectorAll('.js-type-delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить тип устройства?')) return;
    await withBusyHandling(async () => {
      await api(`/device-types/${b.dataset.id}`, { method: 'DELETE' });
      showToast('Тип удалён');
      await loadAll(); renderTemplatesTab();
    });
  }));

  const list = [...state.templates].sort((a, b) => a.name.localeCompare(b.name));
  el('templates-list').innerHTML = list.map(templateCardHtml).join('') ||
    '<p class="muted">Шаблонов ещё нет — начните с добавления хотя бы одного.</p>';

  list.forEach(t => {
    const card = document.getElementById(`tcard-${t.id}`);
    card.querySelector('.device-card-header').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      card.classList.toggle('open');
    });
    card.querySelector('.js-tpl-edit').addEventListener('click', () => openTemplateForm(t));
    card.querySelector('.js-tpl-delete').addEventListener('click', () => deleteTemplate(t));
  });
}

/* Карточка шаблона — только просмотр (название, порты). Всё редактирование,
   включая порты, находится внутри модалки «Изменить». */
function templateCardHtml(t) {
  const ifaces = [...(t.interfaces || [])].sort((a, b) => (a.port_number ?? 9999) - (b.port_number ?? 9999));
  const rows = ifaces.map(i => `
    <tr><td>${esc(i.label)}</td><td>${i.port_number ?? '—'}</td><td>${esc(i.port_type || '—')}</td></tr>`).join('');

  return `
  <div class="device-card" id="tcard-${t.id}">
    <div class="device-card-header">
      <div class="info">
        <span class="code">${esc(t.name)}</span>
        ${t.manufacturer ? `<span class="name">${esc(t.manufacturer)}</span>` : ''}
        <span class="tag">${esc(typeName(t.device_type_id))}</span>
        <span class="tag">${ifaces.length} порт(ов)</span>
      </div>
      <div class="device-card-actions">
        <button class="small-btn js-tpl-edit">Изменить</button>
        <button class="small-btn danger js-tpl-delete">Удалить</button>
      </div>
    </div>
    <div class="device-card-body">
      ${t.notes ? `<p class="muted small">${esc(t.notes)}</p>` : ''}
      <table class="iface-table">
        <thead><tr><th>Порт</th><th>№</th><th>Тип</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">Портов ещё нет</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

async function deleteTemplate(template) {
  if (!confirm(`Удалить шаблон "${template.name}"?`)) return;
  await withBusyHandling(async () => {
    await api(`/device-templates/${template.id}`, { method: 'DELETE' });
    showToast('Шаблон удалён');
    await loadAll(); renderTemplatesTab();
  });
}

/* Форма шаблона устройства — создание и редактирование в одном месте.
   Порты редактируются прямо тут (по просьбе — не в отдельной карточке):
   в режиме создания копятся в черновике и уходят одним запросом при
   сабмите; в режиме редактирования каждое изменение сразу летит на бэкенд.
   Таблица портов перерисовывается точечно (только её <tbody>), поэтому
   остальные поля формы никогда не сбрасываются. */
function openTemplateForm(template) {
  const isEdit = !!template;
  let draftIfaces = [];
  let draftSeq = 0;
  let liveIfaces = isEdit ? [...(template.interfaces || [])] : [];

  function currentIfaces() { return isEdit ? liveIfaces : draftIfaces; }
  function keyOf(f) { return isEdit ? f.id : f._key; }

  function portsTableBodyHtml() {
    const ifaces = [...currentIfaces()].sort((a, b) => (a.port_number ?? 9999) - (b.port_number ?? 9999));
    return ifaces.map(f => `
      <tr><td>${esc(f.label)}</td><td>${f.port_number ?? '—'}</td><td>${esc(f.port_type || '—')}</td>
      <td><button type="button" class="small-btn danger js-port-remove" data-key="${keyOf(f)}">✕</button></td></tr>`
    ).join('') || '<tr><td colspan="4" class="muted">Портов ещё нет</td></tr>';
  }

  function refreshPortsTable() {
    el('draft-ifaces-body').innerHTML = portsTableBodyHtml();
  }

  async function refreshLiveIfaces() {
    await loadAll();
    liveIfaces = templateById(template.id)?.interfaces || [];
    refreshPortsTable();
  }

  async function handleAddPort() {
    const label = el('f-draft-label').value.trim();
    if (!label) return;
    if (currentIfaces().some(f => f.label === label)) { showToast('Порт с таким названием уже есть', true); return; }
    const port_type = nn(el('f-draft-porttype').value);
    if (isEdit) {
      await withBusyHandling(async () => {
        await api(`/device-templates/${template.id}/interfaces`, {
          method: 'POST', body: { label, port_number: liveIfaces.length + 1, port_type },
        });
        await refreshLiveIfaces();
      });
    } else {
      draftIfaces.push({ _key: ++draftSeq, label, port_number: draftIfaces.length + 1, port_type });
      refreshPortsTable();
    }
    el('f-draft-label').value = '';
  }

  async function handleGenerate() {
    const n = parseInt(el('f-draft-count').value, 10) || 0;
    if (n <= 0) return;
    const start = currentIfaces().length;
    if (isEdit) {
      await withBusyHandling(async () => {
        for (let i = 1; i <= n; i++) {
          await api(`/device-templates/${template.id}/interfaces`, {
            method: 'POST', body: { label: `Порт ${start + i}`, port_number: start + i },
          });
        }
        await refreshLiveIfaces();
        showToast(`Добавлено портов: ${n}`);
      });
    } else {
      for (let i = 1; i <= n; i++) draftIfaces.push({ _key: ++draftSeq, label: `Порт ${start + i}`, port_number: start + i, port_type: null });
      refreshPortsTable();
    }
  }

  async function handleRemovePort(key) {
    if (isEdit) {
      if (!confirm('Удалить порт из шаблона? На уже созданных устройствах его порты не изменятся.')) return;
      await withBusyHandling(async () => {
        await api(`/device-templates/${template.id}/interfaces/${key}`, { method: 'DELETE' });
        await refreshLiveIfaces();
      });
    } else {
      draftIfaces = draftIfaces.filter(f => f._key !== key);
      refreshPortsTable();
    }
  }

  const typeOpts = state.deviceTypes.map(t =>
    `<option value="${t.id}" ${(template?.device_type_id ?? '') === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  openModal(isEdit ? `Шаблон: ${template.name}` : 'Новый шаблон устройства', `
    <form id="template-form">
      <div class="field-row">
        <label>Название <input id="f-tpl-name" value="${esc(template?.name || '')}" required placeholder="напр. Cisco Catalyst 2960-24TT"></label>
        <label>Тип устройства <select id="f-tpl-type" required>${typeOpts}</select></label>
      </div>
      <label>Производитель <input id="f-tpl-manufacturer" value="${esc(template?.manufacturer || '')}"></label>
      <label>Заметки <textarea id="f-tpl-notes" rows="2">${esc(template?.notes || '')}</textarea></label>

      <div style="margin-top:12px;">
        <p class="muted small">Порты шаблона${isEdit ? ' — изменения сохраняются сразу' : ''}:</p>
        <table class="iface-table">
          <thead><tr><th>Порт</th><th>№</th><th>Тип</th><th></th></tr></thead>
          <tbody id="draft-ifaces-body">${portsTableBodyHtml()}</tbody>
        </table>
        <div class="field-row">
          <input id="f-draft-label" placeholder="Название порта" style="flex:2">
          <select id="f-draft-porttype" style="flex:1">
            <option value="">тип —</option>
            <option value="access">access</option>
            <option value="trunk">trunk</option>
            <option value="uplink">uplink</option>
          </select>
          <button type="button" id="draft-add-btn" class="small-btn">+ Добавить</button>
        </div>
        <div class="field-row" style="align-items:center;">
          <input id="f-draft-count" type="number" min="1" max="96" value="24" style="width:70px">
          <button type="button" id="draft-generate-btn" class="small-btn">Сгенерировать N портов «Порт 1..N»</button>
        </div>
      </div>

      <div class="modal-actions">
        <button type="submit" class="primary">${isEdit ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>`);

  // Enter в полях черновика порта добавляет/генерирует порт, а не сабмитит
  // всю форму шаблона (иначе форма закрывалась на середине заполнения).
  el('f-draft-label').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddPort(); }
  });
  el('f-draft-count').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleGenerate(); }
  });
  el('draft-add-btn').addEventListener('click', handleAddPort);
  el('draft-generate-btn').addEventListener('click', handleGenerate);
  // делегирование: таблица портов перерисовывается только своим <tbody>,
  // остальные поля формы (название, тип, производитель...) не трогаются
  el('draft-ifaces-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.js-port-remove');
    if (!btn) return;
    handleRemovePort(isEdit ? parseInt(btn.dataset.key, 10) : parseInt(btn.dataset.key, 10));
  });

  el('template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: el('f-tpl-name').value.trim(),
      device_type_id: parseInt(el('f-tpl-type').value, 10),
      manufacturer: nn(el('f-tpl-manufacturer').value),
      notes: nn(el('f-tpl-notes').value),
    };
    await withBusyHandling(async () => {
      if (isEdit) {
        await api(`/device-templates/${template.id}`, { method: 'PATCH', body });
      } else {
        body.interfaces = draftIfaces.map(({ label, port_number, port_type }) => ({ label, port_number, port_type }));
        await api('/device-templates', { method: 'POST', body });
      }
      showToast(isEdit ? 'Шаблон обновлён' : 'Шаблон создан');
      closeModal();
      await loadAll(); renderTemplatesTab();
    });
  });
}

/* ============================================================
   Вкладка «Связи»
   ============================================================ */

el('link-template-add-btn').addEventListener('click', () => openLinkTemplateForm());

function renderLinkTemplatesTab() {
  const list = [...state.linkTemplates].sort((a, b) => a.name.localeCompare(b.name));
  el('link-templates-body').innerHTML = list.map(t => `
    <tr>
      <td>${esc(t.name)}</td>
      <td>${esc(t.media_type)}</td>
      <td>${esc(t.cable_category || '—')}</td>
      <td><span class="color-swatch" style="background:${esc(t.color)}"></span>${esc(t.color)}</td>
      <td>${esc(t.line_style)}</td>
      <td>
        <button class="small-btn js-lt-edit" data-id="${t.id}">Изменить</button>
        <button class="small-btn danger js-lt-delete" data-id="${t.id}">Удалить</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Шаблонов связи ещё нет</td></tr>';

  el('link-templates-body').querySelectorAll('.js-lt-edit').forEach(b =>
    b.addEventListener('click', () => openLinkTemplateForm(state.linkTemplates.find(t => t.id === parseInt(b.dataset.id, 10)))));
  el('link-templates-body').querySelectorAll('.js-lt-delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить шаблон связи? У существующих связей с этим шаблоном он просто снимется, сами связи останутся.')) return;
    await withBusyHandling(async () => {
      await api(`/link-templates/${b.dataset.id}`, { method: 'DELETE' });
      showToast('Шаблон связи удалён');
      await loadAll(); renderLinksTab();
    });
  }));
}

function openLinkTemplateForm(template) {
  const isEdit = !!template;
  openModal(isEdit ? `Шаблон связи: ${template.name}` : 'Новый шаблон связи', `
    <form id="lt-form">
      <label>Название <input id="f-lt-name" value="${esc(template?.name || '')}" required placeholder="напр. Медь Cat6"></label>
      <div class="field-row">
        <label>Среда <select id="f-lt-media" required>
          ${['copper', 'fiber', 'wireless', 'dac', 'other'].map(m => `<option value="${m}" ${(template?.media_type || 'copper') === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></label>
        <label>Категория кабеля <input id="f-lt-cable" value="${esc(template?.cable_category || '')}" placeholder="cat6 / OM4..."></label>
      </div>
      <div class="field-row">
        <label>Цвет на топологии <input id="f-lt-color" type="color" value="${template?.color || '#888888'}"></label>
        <label>Стиль линии <select id="f-lt-style">
          ${['solid', 'dashed', 'dotted'].map(s => `<option value="${s}" ${(template?.line_style || 'solid') === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></label>
      </div>
      <div class="modal-actions">
        <button type="submit" class="primary">${isEdit ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>`);

  el('lt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: el('f-lt-name').value.trim(),
      media_type: el('f-lt-media').value,
      cable_category: nn(el('f-lt-cable').value),
      color: el('f-lt-color').value,
      line_style: el('f-lt-style').value,
    };
    await withBusyHandling(async () => {
      if (isEdit) await api(`/link-templates/${template.id}`, { method: 'PATCH', body });
      else await api('/link-templates', { method: 'POST', body });
      showToast(isEdit ? 'Шаблон связи обновлён' : 'Шаблон связи создан');
      closeModal();
      await loadAll(); renderLinksTab();
    });
  });
}

function renderLinksTab() {
  renderLinkTemplatesTab();
  const ifaceMap = buildIfaceMap();
  el('links-body').innerHTML = state.links.map(l => {
    const a = ifaceMap.get(l.interface_a_id), b = ifaceMap.get(l.interface_b_id);
    const lt = l.template_id ? linkTemplateById(l.template_id) : null;
    return `<tr>
      <td>${esc(a?.device.code || '?')}</td><td>${esc(a?.iface.label || '?')}</td>
      <td>${esc(b?.device.code || '?')}</td><td>${esc(b?.iface.label || '?')}</td>
      <td>${lt ? `<span class="color-swatch" style="background:${esc(lt.color)}"></span>${esc(lt.name)}` : '<span class="muted">— без шаблона —</span>'}</td>
      <td>${esc(l.connector_type || '—')}</td>
      <td>${l.length_m ?? '—'}</td>
      <td>${esc(l.source)}</td>
      <td>${l.confirmed ? '✓' : '⚠'}</td>
      <td>
        <button class="small-btn js-link-edit" data-id="${l.id}">✎</button>
        <button class="small-btn danger js-link-delete" data-id="${l.id}">✕</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" class="muted">Связей ещё нет</td></tr>';

  el('links-body').querySelectorAll('.js-link-edit').forEach(b =>
    b.addEventListener('click', () => openLinkEditForm(state.links.find(l => l.id === parseInt(b.dataset.id, 10)))));
  el('links-body').querySelectorAll('.js-link-delete').forEach(b =>
    b.addEventListener('click', () => deleteLink(parseInt(b.dataset.id, 10))));
}

function openLinkEditForm(link) {
  const templateOpts = [...state.linkTemplates].sort((a, b) => a.name.localeCompare(b.name)).map(t =>
    `<option value="${t.id}" ${link.template_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  openModal('Изменить связь', `
    <form id="link-form">
      <label>Шаблон связи <select id="f-link-template">
        <option value="">— без шаблона —</option>${templateOpts}
      </select></label>
      <div class="field-row">
        <label>Разъём <input id="f-connector" value="${esc(link.connector_type || '')}" placeholder="RJ45 / LC..."></label>
        <label>Длина, м <input id="f-length" type="number" step="0.1" value="${link.length_m ?? ''}"></label>
      </div>
      <div class="field-row">
        <label>Скорость, Мбит/с <input id="f-speed" type="number" value="${link.speed_mbps ?? ''}"></label>
        <label>Подтверждена <select id="f-confirmed">
          <option value="true" ${link.confirmed !== false ? 'selected' : ''}>да</option>
          <option value="false" ${link.confirmed === false ? 'selected' : ''}>нет</option>
        </select></label>
      </div>
      <label>Заметки <textarea id="f-link-notes" rows="2">${esc(link.notes || '')}</textarea></label>
      <div class="modal-actions">
        <button type="submit" class="primary">Сохранить</button>
      </div>
    </form>`);

  el('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      template_id: nnInt(el('f-link-template').value),
      connector_type: nn(el('f-connector').value),
      length_m: nnFloat(el('f-length').value),
      speed_mbps: nnInt(el('f-speed').value),
      confirmed: el('f-confirmed').value === 'true',
      notes: nn(el('f-link-notes').value),
    };
    await withBusyHandling(async () => {
      await api(`/links/${link.id}`, { method: 'PATCH', body });
      showToast('Связь обновлена');
      closeModal();
      await loadAll(); renderLinksTab();
    });
  });
}

async function deleteLink(id) {
  if (!confirm('Удалить связь? Оба порта снова станут свободными.')) return;
  await withBusyHandling(async () => {
    await api(`/links/${id}`, { method: 'DELETE' });
    showToast('Связь удалена');
    await loadAll(); renderLinksTab();
  });
}

/* ============================================================
   Вкладка «Топология»

   Строится полностью из уже загруженных state.devices/state.links/
   state.linkTemplates (без отдельного запроса к /topology) — так проще
   переиспользовать connected_to и шаблоны связей, которые уже есть в
   памяти. Раскладка — пружинная модель (repulsion между узлами + spring
   вдоль связей), никакие координаты не сохраняются, каждый показ считает
   заново. Узел рисуется как прямоугольник с портами по нижнему краю;
   связь идёт от конкретного порта до конкретного порта.
   ============================================================ */

el('topo-filter-tag').addEventListener('change', renderTopologyTab);

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* Простая force-directed раскладка: отталкивание между всеми узлами,
   пружина вдоль edgePairs (пары объектов-узлов), лёгкое центрирование. */
function computeForceLayout(nodes, edgePairs, width, height) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2, cy = height / 2;
  const r0 = Math.min(cx, cy) * 0.6 || 100;
  nodes.forEach((node, i) => {
    const angle = (i / n) * 2 * Math.PI;
    node.x = cx + r0 * Math.cos(angle);
    node.y = cy + r0 * Math.sin(angle);
    node.vx = 0; node.vy = 0;
  });

  const idealLen = 170, repulsion = 12000, iterations = 300;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist2 = 1; }
        const dist = Math.sqrt(dist2);
        const force = repulsion / dist2;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    for (const [a, b] of edgePairs) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLen) * 0.02;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.002;
      node.vy += (cy - node.y) * 0.002;
      node.vx *= 0.82; node.vy *= 0.82;
      node.x += node.vx; node.y += node.vy;
    }
  }
}

/* ---------- Zoom / pan ---------- */
const topoView = { scale: 1, tx: 0, ty: 0 };

function applyTopoTransform() {
  const vp = el('topo-viewport');
  if (vp) vp.setAttribute('transform', `translate(${topoView.tx},${topoView.ty}) scale(${topoView.scale})`);
}

el('topo-zoom-in').addEventListener('click', () => { topoView.scale = Math.min(3, topoView.scale * 1.25); applyTopoTransform(); });
el('topo-zoom-out').addEventListener('click', () => { topoView.scale = Math.max(0.2, topoView.scale / 1.25); applyTopoTransform(); });
el('topo-zoom-reset').addEventListener('click', () => { topoView.scale = 1; topoView.tx = 0; topoView.ty = 0; applyTopoTransform(); });

(function setupTopoPanZoom() {
  const svg = el('topo-svg');
  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    topoView.scale = Math.min(3, Math.max(0.2, topoView.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    applyTopoTransform();
  }, { passive: false });
  svg.addEventListener('mousedown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    svg.classList.add('grabbing');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    topoView.tx += e.clientX - lastX;
    topoView.ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyTopoTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.classList.remove('grabbing'); });
})();

const LINE_DASH = { solid: null, dashed: '7 5', dotted: '2 4' };

async function renderTopologyTab() {
  const tagId = el('topo-filter-tag').value;
  const svg = el('topo-svg');
  svg.innerHTML = '';

  let devices = state.devices;
  if (tagId) devices = devices.filter(d => (d.tags || []).some(t => String(t.id) === tagId));
  if (devices.length === 0) { showToast('Нет устройств для отображения', false); return; }

  const width = svg.clientWidth || 900, height = 640;

  const ifaceToNode = new Map();   // iface_id -> node
  const ifaceLabel = new Map();    // iface_id -> label
  const nodes = devices.map(d => {
    const ifaces = [...(d.interfaces || [])].sort((a, b) => (a.port_number ?? 9999) - (b.port_number ?? 9999));
    const portSpacing = 16;
    const node = {
      id: d.id, device: d, ifaces, portSpacing,
      w: Math.max(100, ifaces.length * portSpacing + 24), h: 50,
      x: 0, y: 0, vx: 0, vy: 0,
    };
    ifaces.forEach(i => { ifaceToNode.set(i.id, node); ifaceLabel.set(i.id, i.label); });
    return node;
  });

  const links = state.links.filter(l => ifaceToNode.has(l.interface_a_id) && ifaceToNode.has(l.interface_b_id));
  const edgePairs = links
    .map(l => [ifaceToNode.get(l.interface_a_id), ifaceToNode.get(l.interface_b_id)])
    .filter(([a, b]) => a && b && a !== b);

  computeForceLayout(nodes, edgePairs, width, height);

  // Порт сидит ровно на нижней границе корпуса устройства (наполовину
  // внутри, наполовину снаружи — как штырёк), а не внутри непрозрачного
  // прямоугольника: иначе связь визуально утыкается в стенку раньше, чем
  // доходит до самого порта.
  const ifacePos = new Map();
  nodes.forEach(nd => {
    nd.ifaces.forEach((iface, k) => {
      ifacePos.set(iface.id, { x: nd.x - nd.w / 2 + 16 + k * nd.portSpacing, y: nd.y + nd.h / 2 });
    });
  });

  topoView.scale = 1; topoView.tx = 0; topoView.ty = 0;
  const viewport = svgEl('g', { id: 'topo-viewport' });

  const edgesG = svgEl('g');
  links.forEach(link => {
    const a = ifacePos.get(link.interface_a_id), b = ifacePos.get(link.interface_b_id);
    if (!a || !b) return;
    const lt = link.template_id ? linkTemplateById(link.template_id) : null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 22 };
    const path = svgEl('path', {
      d: `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`,
      class: 'edge' + (link.confirmed ? '' : ' unconfirmed'),
      stroke: lt?.color || '#9aa1ab',
    });
    const dash = LINE_DASH[lt?.line_style || 'solid'];
    if (dash) path.setAttribute('stroke-dasharray', dash);
    const devA = ifaceToNode.get(link.interface_a_id).device, devB = ifaceToNode.get(link.interface_b_id).device;
    const title = svgEl('title');
    title.textContent = `${devA.code} · ${ifaceLabel.get(link.interface_a_id)} ↔ ${devB.code} · ${ifaceLabel.get(link.interface_b_id)}` +
      (lt ? ` — ${lt.name}` : '') + (link.confirmed ? '' : ' (не подтверждено)');
    path.appendChild(title);
    edgesG.appendChild(path);
  });
  // связи добавляются в SVG позже узлов (см. ниже) — поверх непрозрачных
  // прямоугольников устройств, иначе линии визуально "прячутся" под ними

  const nodesG = svgEl('g');
  nodes.forEach(nd => {
    const g = svgEl('g', { class: 'node', transform: `translate(${nd.x - nd.w / 2},${nd.y - nd.h / 2})` });
    g.appendChild(svgEl('rect', { class: 'node-box', width: nd.w, height: nd.h, rx: 6 }));
    const title = svgEl('text', { class: 'node-title', x: 8, y: 16 });
    title.textContent = nd.device.code;
    g.appendChild(title);
    const sub = svgEl('text', { class: 'node-sub', x: 8, y: 28 });
    sub.textContent = truncate(nd.device.name || templateNameForDevice(nd.device), Math.floor(nd.w / 6));
    g.appendChild(sub);
    nd.ifaces.forEach((iface, k) => {
      const rect = svgEl('rect', {
        class: 'port ' + (iface.connected_to ? 'connected' : 'free'),
        x: 16 + k * nd.portSpacing - 5, y: nd.h - 5, width: 10, height: 10, rx: 2,
      });
      const t = svgEl('title');
      t.textContent = iface.label + (iface.connected_to
        ? ` → ${iface.connected_to.device_code} · ${iface.connected_to.interface_label}`
        : ' — свободен');
      rect.appendChild(t);
      g.appendChild(rect);
    });
    const nodeTitle = svgEl('title');
    nodeTitle.textContent = `${nd.device.code} — ${nd.device.name || templateNameForDevice(nd.device)} (${typeNameForDevice(nd.device)})`;
    g.appendChild(nodeTitle);
    nodesG.appendChild(g);
  });
  viewport.appendChild(nodesG);
  viewport.appendChild(edgesG);

  svg.appendChild(viewport);
  applyTopoTransform();
}

/* ============================================================
   Вкладка «Поиск»
   ============================================================ */

let searchTimer;
el('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});

async function runSearch() {
  const q = el('search-input').value.trim();
  if (!q) { el('search-body').innerHTML = ''; return; }
  await withBusyHandling(async () => {
    const results = await api(`/search?query=${encodeURIComponent(q)}`);
    el('search-body').innerHTML = results.map(r => `
      <tr><td>${esc(r.device_code)}${r.device_name ? ' — ' + esc(r.device_name) : ''}</td><td>${esc(r.interface_label)}</td>
      <td>${esc(r.ip || '—')}</td><td>${esc(r.mac || '—')}</td></tr>`).join('') ||
      '<tr><td colspan="4" class="muted">Ничего не найдено</td></tr>';
  });
}

/* ============================================================
   Вкладка «Теги»
   ============================================================ */

el('tag-add-btn').addEventListener('click', () => openTagForm());

function renderTagsTab() {
  const list = flattenTagsOrdered();
  el('tags-body').innerHTML = list.map(({ tag, depth }) => `
    <tr class="tag-tree-row">
      <td>${'—'.repeat(depth)} ${tag.color ? `<span class="color-swatch" style="background:${esc(tag.color)}"></span>` : ''}${esc(tag.name)}</td>
      <td>
        <button class="small-btn js-tag-edit" data-id="${tag.id}">Изменить</button>
        <button class="small-btn danger js-tag-delete" data-id="${tag.id}">Удалить</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="2" class="muted">Тегов ещё нет</td></tr>';

  el('tags-body').querySelectorAll('.js-tag-edit').forEach(b =>
    b.addEventListener('click', () => openTagForm(tagById(parseInt(b.dataset.id, 10)))));
  el('tags-body').querySelectorAll('.js-tag-delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить тег? Дочерние теги удалятся вместе с ним, у устройств он просто снимется.')) return;
    await withBusyHandling(async () => {
      await api(`/tags/${b.dataset.id}`, { method: 'DELETE' });
      showToast('Тег удалён');
      await loadAll(); renderTagsTab();
    });
  }));
}

function openTagForm(tag) {
  const isEdit = !!tag;
  const parentOpts = flattenTagsOrdered()
    .filter(({ tag: t }) => !isEdit || t.id !== tag.id)  // тег не может быть родителем самому себе
    .map(({ tag: t, depth }) => `<option value="${t.id}" ${tag?.parent_id === t.id ? 'selected' : ''}>${'—'.repeat(depth)} ${esc(t.name)}</option>`)
    .join('');

  openModal(isEdit ? `Тег: ${tag.name}` : 'Новый тег', `
    <form id="tag-form">
      <label>Название <input id="f-tag-name" value="${esc(tag?.name || '')}" required></label>
      <label>Родительский тег <select id="f-tag-parent"><option value="">— нет, верхний уровень —</option>${parentOpts}</select></label>
      <label>Цвет <input id="f-tag-color" type="color" value="${tag?.color || '#94a3b8'}"></label>
      <div class="modal-actions">
        <button type="submit" class="primary">${isEdit ? 'Сохранить' : 'Создать'}</button>
      </div>
    </form>`);

  el('tag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: el('f-tag-name').value.trim(),
      parent_id: nnInt(el('f-tag-parent').value),
      color: el('f-tag-color').value,
    };
    await withBusyHandling(async () => {
      if (isEdit) await api(`/tags/${tag.id}`, { method: 'PATCH', body });
      else await api('/tags', { method: 'POST', body });
      showToast(isEdit ? 'Тег обновлён' : 'Тег создан');
      closeModal();
      await loadAll(); renderTagsTab();
    });
  });
}

/* ============================================================
   Вкладка «VLAN»
   ============================================================ */

el('vlan-add-btn').addEventListener('click', () => {
  openModal('Новый VLAN', `
    <form id="vlan-form">
      <div class="field-row">
        <label>Номер <input id="f-vlan-num" type="number" required></label>
        <label>Название <input id="f-vlan-name"></label>
      </div>
      <div class="field-row">
        <label>Подсеть <input id="f-vlan-subnet" placeholder="10.10.20.0/24"></label>
        <label>Шлюз <input id="f-vlan-gateway" placeholder="10.10.20.1"></label>
      </div>
      <label>DHCP-диапазон <input id="f-vlan-dhcp"></label>
      <label>Заметки <textarea id="f-vlan-notes" rows="2"></textarea></label>
      <div class="modal-actions"><button type="submit" class="primary">Создать</button></div>
    </form>`);
  el('vlan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusyHandling(async () => {
      await api('/vlans', { method: 'POST', body: {
        vlan_number: parseInt(el('f-vlan-num').value, 10),
        name: nn(el('f-vlan-name').value),
        subnet: nn(el('f-vlan-subnet').value),
        gateway: nn(el('f-vlan-gateway').value),
        dhcp_range: nn(el('f-vlan-dhcp').value),
        notes: nn(el('f-vlan-notes').value),
      }});
      showToast('VLAN создан');
      closeModal();
      await loadAll(); renderVlansTab();
    });
  });
});

function renderVlansTab() {
  el('vlans-body').innerHTML = state.vlans.map(v => `
    <tr><td>${v.vlan_number}</td><td>${esc(v.name || '—')}</td>
    <td>${esc(v.subnet || '—')}</td><td>${esc(v.gateway || '—')}</td>
    <td><button class="small-btn danger js-vlan-delete" data-id="${v.id}">Удалить</button></td></tr>`).join('') ||
    '<tr><td colspan="5" class="muted">VLAN ещё не заведены</td></tr>';
  el('vlans-body').querySelectorAll('.js-vlan-delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить VLAN?')) return;
    await withBusyHandling(async () => {
      await api(`/vlans/${b.dataset.id}`, { method: 'DELETE' });
      showToast('VLAN удалён');
      await loadAll(); renderVlansTab();
    });
  }));
}

/* ============================================================
   Вкладка «Пользователи» (только admin)
   ============================================================ */

el('user-add-btn').addEventListener('click', () => {
  openModal('Новый пользователь', `
    <form id="user-form">
      <label>Имя <input id="f-user-name" required></label>
      <label>Логин <input id="f-user-username" required></label>
      <label>Пароль <input id="f-user-password" type="password" required></label>
      <label>Роль <select id="f-user-role">
        <option value="viewer">viewer</option>
        <option value="editor">editor</option>
        <option value="admin">admin</option>
      </select></label>
      <div class="modal-actions"><button type="submit" class="primary">Создать</button></div>
    </form>`);
  el('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusyHandling(async () => {
      await api('/auth/users', { method: 'POST', body: {
        full_name: el('f-user-name').value.trim(),
        username: el('f-user-username').value.trim(),
        password: el('f-user-password').value,
        role: el('f-user-role').value,
      }});
      showToast('Пользователь создан');
      closeModal();
      renderUsersTab();
    });
  });
});

async function renderUsersTab() {
  if (state.me?.role !== 'admin') return;
  await withBusyHandling(async () => {
    const users = await api('/auth/users');
    el('users-body').innerHTML = users.map(u => `
      <tr><td>${esc(u.full_name)}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td>
      <td>${new Date(u.created_at).toLocaleString('ru-RU')}</td></tr>`).join('');
  });
}

/* ============================================================
   Старт
   ============================================================ */

el('api-base').value = state.baseUrl;
tryAutoLogin();
