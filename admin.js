/* ============================================================
   Oak Hill Marshal Guide — Admin: hole/marshal spot editor
   Not linked from marshal-facing pages. Reach it directly at
   admin.html. Lets you pan/zoom the real satellite imagery,
   drop a highlighted circle for each marshal spot, drag it into
   place, and download an updated holes-data.js to commit.

   Edits are auto-backed-up to this browser's localStorage as you
   work (so a closed tab doesn't lose your progress), but the only
   way changes reach the live site is the Download button.
   ============================================================ */

const DRAFT_KEY = 'oakhill_admin_draft_v1';
const DEFAULT_RADIUS = 12;

let state;         // working copy of HOLES_DATA (possibly restored from a draft)
let map;
let currentCourse = 'east';
let currentHoleNum = 1;
let spotLayers = []; // [{ marker, circle }] in sync with currentHole().marshals

function currentHole() {
  return state[currentCourse].holes.find(h => h.number === currentHoleNum);
}

function loadState() {
  let draft = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch (e) {
    draft = null;
  }
  if (draft && draft.east && draft.west) {
    return { data: draft, fromDraft: true };
  }
  return { data: JSON.parse(JSON.stringify(HOLES_DATA)), fromDraft: false };
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch (e) {
    /* localStorage unavailable (private mode, etc.) -- edits still work,
       just won't survive a reload until downloaded */
  }
}

function markDirty() {
  saveDraft();
  const note = document.getElementById('admin-draft-note');
  if (note) note.textContent = "Unsaved edits in this browser — click Download when you're done to save them into the site.";
}

function initAdmin() {
  const loaded = loadState();
  state = loaded.data;

  const note = document.getElementById('admin-draft-note');
  if (note) {
    note.textContent = loaded.fromDraft
      ? 'Restored unsaved edits from this browser. Download to save them, or Reset to discard and start from the file on disk.'
      : 'No unsaved edits yet in this browser.';
  }

  populateCourseSelect();
  populateHoleSelect();

  document.getElementById('admin-course').addEventListener('change', onCourseChange);
  document.getElementById('admin-hole').addEventListener('change', onHoleChange);
  document.getElementById('admin-prev-hole').addEventListener('click', () => stepHole(-1));
  document.getElementById('admin-next-hole').addEventListener('click', () => stepHole(1));
  document.getElementById('admin-set-center').addEventListener('click', setCenterFromView);
  document.getElementById('admin-add-spot').addEventListener('click', () => addSpot(map.getCenter()));
  document.getElementById('admin-download').addEventListener('click', downloadData);
  document.getElementById('admin-reset').addEventListener('click', resetToOriginal);

  initMap();
  loadHoleIntoMap();
}

function populateCourseSelect() {
  const sel = document.getElementById('admin-course');
  sel.value = currentCourse;
}

function populateHoleSelect() {
  const sel = document.getElementById('admin-hole');
  sel.innerHTML = state[currentCourse].holes
    .map(h => `<option value="${h.number}">Hole ${h.number}</option>`)
    .join('');
  sel.value = currentHoleNum;
}

function onCourseChange(e) {
  currentCourse = e.target.value;
  currentHoleNum = state[currentCourse].holes[0].number;
  populateHoleSelect();
  loadHoleIntoMap();
}

function onHoleChange(e) {
  currentHoleNum = parseInt(e.target.value, 10);
  loadHoleIntoMap();
}

function stepHole(delta) {
  const holes = state[currentCourse].holes;
  const idx = holes.findIndex(h => h.number === currentHoleNum);
  const next = holes[idx + delta];
  if (next) {
    currentHoleNum = next.number;
    document.getElementById('admin-hole').value = currentHoleNum;
    loadHoleIntoMap();
  }
}

function initMap() {
  map = L.map('map');
  L.tileLayer(SATELLITE_TILE_URL, {
    maxZoom: 21,
    attribution: SATELLITE_ATTRIBUTION
  }).addTo(map);
  map.on('click', (e) => addSpot(e.latlng));
}

function loadHoleIntoMap() {
  const hole = currentHole();
  map.setView(hole.center, hole.zoom || 18);
  updateHoleMeta();
  redrawSpots();
}

function updateHoleMeta() {
  const hole = currentHole();
  const meta = document.getElementById('admin-hole-meta');
  if (meta) {
    meta.textContent = `Center: ${hole.center[0].toFixed(5)}, ${hole.center[1].toFixed(5)} · Zoom ${hole.zoom || 18}`;
  }
}

function redrawSpots() {
  spotLayers.forEach(sl => {
    map.removeLayer(sl.marker);
    map.removeLayer(sl.circle);
  });
  spotLayers = [];
  currentHole().marshals.forEach((spot, i) => addSpotLayers(spot, i));
  renderSpotList();
}

function spotPopupHtml(index, label) {
  return `<strong>Station ${index + 1}</strong><br>${label || ''}`;
}

function addSpotLayers(spot, i) {
  const radius = spot.radius || DEFAULT_RADIUS;
  const circle = L.circle([spot.lat, spot.lng], {
    radius,
    color: '#C0392B',
    weight: 2,
    fillColor: '#C0392B',
    fillOpacity: 0.28
  }).addTo(map);

  const icon = L.divIcon({
    className: 'marshal-pin',
    html: `<span class="marshal-pin__num">${i + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  const marker = L.marker([spot.lat, spot.lng], { icon, draggable: true }).addTo(map);

  const html = spotPopupHtml(i, spot.label);
  circle.bindPopup(html);
  marker.bindPopup(html);

  marker.on('drag', (e) => {
    circle.setLatLng(e.target.getLatLng());
  });
  marker.on('dragend', (e) => {
    const ll = e.target.getLatLng();
    spot.lat = ll.lat;
    spot.lng = ll.lng;
    markDirty();
  });

  spotLayers.push({ marker, circle });
}

function addSpot(latlng) {
  const hole = currentHole();
  hole.marshals.push({
    lat: latlng.lat,
    lng: latlng.lng,
    label: `Marshal spot ${hole.marshals.length + 1}`,
    radius: DEFAULT_RADIUS
  });
  redrawSpots();
  markDirty();
}

function removeSpot(index) {
  currentHole().marshals.splice(index, 1);
  redrawSpots();
  markDirty();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderSpotList() {
  const hole = currentHole();
  const list = document.getElementById('admin-spot-list');
  list.innerHTML = hole.marshals.map((spot, i) => `
    <li class="marshal-list__item admin-spot-row">
      <span class="marshal-list__num">${i + 1}</span>
      <div class="admin-spot-fields">
        <input type="text" class="admin-spot-label" value="${escapeHtml(spot.label || '')}" data-idx="${i}" aria-label="Spot ${i + 1} label">
        <div class="admin-spot-radius">
          <button type="button" class="admin-radius-btn" data-idx="${i}" data-delta="-2" aria-label="Shrink highlight">&minus;</button>
          <span>${spot.radius || DEFAULT_RADIUS} m highlight</span>
          <button type="button" class="admin-radius-btn" data-idx="${i}" data-delta="2" aria-label="Grow highlight">+</button>
        </div>
      </div>
      <button type="button" class="admin-spot-remove" data-idx="${i}" aria-label="Remove spot ${i + 1}">&times;</button>
    </li>
  `).join('');

  list.querySelectorAll('.admin-spot-label').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const spot = currentHole().marshals[idx];
      spot.label = e.target.value;
      const html = spotPopupHtml(idx, spot.label);
      spotLayers[idx].circle.bindPopup(html);
      spotLayers[idx].marker.bindPopup(html);
      markDirty();
    });
  });

  list.querySelectorAll('.admin-radius-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const delta = parseInt(e.target.dataset.delta, 10);
      const spot = currentHole().marshals[idx];
      spot.radius = Math.max(2, (spot.radius || DEFAULT_RADIUS) + delta);
      spotLayers[idx].circle.setRadius(spot.radius);
      renderSpotList();
      markDirty();
    });
  });

  list.querySelectorAll('.admin-spot-remove').forEach(btn => {
    btn.addEventListener('click', (e) => removeSpot(parseInt(e.target.dataset.idx, 10)));
  });
}

function setCenterFromView() {
  const hole = currentHole();
  const c = map.getCenter();
  hole.center = [c.lat, c.lng];
  hole.zoom = map.getZoom();
  updateHoleMeta();
  markDirty();
}

function resetToOriginal() {
  if (!window.confirm('Discard all unsaved edits in this browser and reload the original file data?')) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  state = JSON.parse(JSON.stringify(HOLES_DATA));
  populateHoleSelect();
  loadHoleIntoMap();
  const note = document.getElementById('admin-draft-note');
  if (note) note.textContent = 'Reset to the original holes-data.js contents.';
}

function downloadData() {
  const content = '// Hole coordinates and marshal spot data.\n'
    + '// Generated by admin.html on ' + new Date().toISOString() + '\n'
    + 'const HOLES_DATA = ' + JSON.stringify(state, null, 2) + ';\n';
  const blob = new Blob([content], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'holes-data.js';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
