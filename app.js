/* ============================================================
   Oak Hill Marshal Guide — page rendering logic
   Reads HOLES_DATA (js/holes-data.js) and fills in course.html
   and hole.html. Rarely needs changes -- edit holes-data.js
   instead, or use admin.html to edit spots visually.
   ============================================================ */

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getCourseKey() {
  return getParam('course') === 'west' ? 'west' : 'east';
}

const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

function addSatelliteLayer(map) {
  return L.tileLayer(SATELLITE_TILE_URL, {
    maxZoom: 21,
    attribution: SATELLITE_ATTRIBUTION
  }).addTo(map);
}

function popupHtml(index, label) {
  return `<strong>Station ${index + 1}</strong><br>${label || ''}`;
}

function addMarshalSpot(map, spot, index) {
  const radius = spot.radius || 12;
  const circle = L.circle([spot.lat, spot.lng], {
    radius,
    color: '#C0392B',
    weight: 2,
    fillColor: '#C0392B',
    fillOpacity: 0.28
  }).addTo(map);

  const icon = L.divIcon({
    className: 'marshal-pin',
    html: `<span class="marshal-pin__num">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(map);

  const html = popupHtml(index, spot.label);
  circle.bindPopup(html);
  marker.bindPopup(html);

  return { circle, marker };
}

/* ---------- course.html ---------- */
function renderCoursePage() {
  const courseKey = getCourseKey();
  const course = HOLES_DATA[courseKey];
  document.body.classList.toggle('theme-west', courseKey === 'west');

  const titleEl = document.getElementById('course-title');
  if (titleEl) titleEl.textContent = course.name;

  const grid = document.getElementById('hole-grid');
  if (grid) {
    grid.innerHTML = course.holes.map(h => `
      <a class="hole-tile" href="hole.html?course=${courseKey}&hole=${h.number}" role="listitem">
        <span class="hole-tile__number">${h.number}</span>
        <span class="hole-tile__label">Hole</span>
      </a>`).join('');
  }
}

/* ---------- hole.html ---------- */
function renderHolePage() {
  const courseKey = getCourseKey();
  const holeNum = parseInt(getParam('hole'), 10) || 1;
  const course = HOLES_DATA[courseKey];
  const hole = course.holes.find(h => h.number === holeNum) || course.holes[0];

  document.body.classList.toggle('theme-west', courseKey === 'west');

  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = `course.html?course=${courseKey}`;

  const eyebrow = document.getElementById('hole-eyebrow');
  if (eyebrow) eyebrow.textContent = course.name;

  const title = document.getElementById('hole-title');
  if (title) title.textContent = `Hole ${hole.number}`;

  const parEl = document.getElementById('hole-par');
  if (parEl) parEl.textContent = hole.par ? `Par ${hole.par}` : '';

  const list = document.getElementById('marshal-list');
  if (list) {
    list.innerHTML = hole.marshals.map((s, i) => `
      <li class="marshal-list__item">
        <span class="marshal-list__num">${i + 1}</span>
        <span class="marshal-list__desc">${s.label || 'Marshal spot'}</span>
      </li>`).join('');
  }

  const idx = course.holes.findIndex(h => h.number === hole.number);
  const prev = course.holes[idx - 1];
  const next = course.holes[idx + 1];
  const pager = document.getElementById('hole-pager');
  if (pager) {
    pager.innerHTML = `
      ${prev ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${prev.number}">&larr; Hole ${prev.number}</a>` : '<span></span>'}
      <a class="pager-btn pager-btn--all" href="course.html?course=${courseKey}">All holes</a>
      ${next ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${next.number}">Hole ${next.number} &rarr;</a>` : '<span></span>'}
    `;
  }

  const map = L.map('map').setView(hole.center, hole.zoom || 18);
  addSatelliteLayer(map);
  hole.marshals.forEach((spot, i) => addMarshalSpot(map, spot, i));
}
