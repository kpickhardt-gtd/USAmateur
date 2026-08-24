/* ============================================================
   Oak Hill Marshal Guide — shared core

   THE TWO STAGES ARE FORMALLY SEPARATE
   ------------------------------------
   Stage 1  produces a hole IMAGE plus two facts about it: where the tee
            and the green sit on that image (as fractions of its size).
            Today the images are captured from satellite; later they can be
            official course artwork instead. Nothing downstream cares.

   Stage 2  places marshal stations in HOLE-AXIS coordinates:
              t            0 = tee, 1 = green (may go outside 0..1)
              offsetYards  perpendicular distance from the centre line,
                           positive = right when looking tee -> green
              radiusYards  size of the highlight circle
            These are image-independent. Swap in a different image, re-mark
            its tee and green, and every station lands correctly with no
            re-work. That is the whole point of the split.

   So a hole record looks like:
     lengthYards  real hole length, used to turn yards into pixels
     image        { src, width, height, tee:{x,y}, green:{x,y} }   <- stage 1
     source       { kind:'satellite', tee/green latlng, nudges }   <- provenance
     marshals     [ { t, offsetYards, radiusYards, label } ]       <- stage 2
   ============================================================ */

const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

/* Screen width at or above which the hole is shown running left-to-right.
   Below it the image is rotated so the hole runs bottom-to-top. */
const WIDE_LAYOUT_MIN_PX = 700;

/* Capture defaults (stage 1). 16:9 rotates to 9:16, which fills a phone. */
const CAPTURE_WIDTH = 2048;
const CAPTURE_HEIGHT = 1152;
const CAPTURE_PAD_FRAC = 0.08;   // tee sits 8% in from the left edge

const DEFAULT_RADIUS_YARDS = 13;

/* ---------- small helpers ---------- */

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getCourseKey() {
  return getParam('course') === 'west' ? 'west' : 'east';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function layoutMode() {
  return window.innerWidth >= WIDE_LAYOUT_MIN_PX ? 'wide' : 'narrow';
}

function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), ms);
  };
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/* ---------- geography (stage 1 only) ---------- */

function geoBearing(a, b) {
  const R = Math.PI / 180;
  const dLng = (b.lng - a.lng) * R;
  const lat1 = a.lat * R, lat2 = b.lat * R;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function geoDistanceMeters(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function metersToYards(m) { return m * 1.09361; }

/* Web Mercator world-pixel projection at a given tile zoom. */
function lngLatToWorldPx(lat, lng, zoom) {
  const size = 256 * Math.pow(2, zoom);
  const x = (lng + 180) / 360 * size;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size;
  return { x, y };
}

/* ---------- stage readiness ---------- */

function holeHasSource(hole) {
  const s = hole && hole.source;
  return !!(s && s.tee && s.green &&
            typeof s.tee.lat === 'number' && typeof s.green.lat === 'number');
}

function holeHasImage(hole) {
  const i = hole && hole.image;
  return !!(i && i.src && i.width && i.height && i.tee && i.green);
}

/* ---------- hole-axis <-> image-pixel transforms ----------
   The only bridge between stage 1 and stage 2. Everything marshal-related
   goes through here, which is why changing the image is cheap. */

function holeAxis(hole) {
  if (!holeHasImage(hole)) return null;
  const { width: W, height: H, tee, green } = hole.image;
  const t = { x: tee.x * W, y: tee.y * H };
  const g = { x: green.x * W, y: green.y * H };
  const dx = g.x - t.x, dy = g.y - t.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return null;
  const u = { x: dx / len, y: dy / len };          // tee -> green
  const n = { x: -u.y, y: u.x };                   // right side, image y grows down
  return { tee: t, green: g, u, n, len };
}

/* Yards per image pixel along the axis. */
function yardsPerPixel(hole) {
  const ax = holeAxis(hole);
  const yds = num(hole.lengthYards, 0);
  if (!ax || !yds) return null;
  return yds / ax.len;
}

/* (t, offsetYards) -> image pixel {x,y} */
function axisToImagePoint(hole, t, offsetYards) {
  const ax = holeAxis(hole);
  const ypp = yardsPerPixel(hole);
  if (!ax || !ypp) return null;
  const offPx = (offsetYards || 0) / ypp;
  return {
    x: ax.tee.x + ax.u.x * t * ax.len + ax.n.x * offPx,
    y: ax.tee.y + ax.u.y * t * ax.len + ax.n.y * offPx
  };
}

/* image pixel {x,y} -> (t, offsetYards) */
function imagePointToAxis(hole, px, py) {
  const ax = holeAxis(hole);
  const ypp = yardsPerPixel(hole);
  if (!ax || !ypp) return null;
  const dx = px - ax.tee.x, dy = py - ax.tee.y;
  return {
    t: (dx * ax.u.x + dy * ax.u.y) / ax.len,
    offsetYards: (dx * ax.n.x + dy * ax.n.y) * ypp
  };
}

function yardsToPixels(hole, yards) {
  const ypp = yardsPerPixel(hole);
  return ypp ? yards / ypp : 0;
}

/* ---------- Leaflet on a static image (CRS.Simple) ----------
   Image pixel space has y growing DOWN; CRS.Simple has y growing UP, so
   latitude is flipped against the image height. */

function imgToLatLng(hole, px, py) {
  return L.latLng(hole.image.height - py, px);
}

function latLngToImg(hole, latlng) {
  return { x: latlng.lng, y: hole.image.height - latlng.lat };
}

function imageBounds(hole) {
  return L.latLngBounds([[0, 0], [hole.image.height, hole.image.width]]);
}

/* Bearing that puts the hole in the requested layout. The image is already
   captured tee-left/green-right, so wide needs no rotation and narrow needs
   a quarter turn to stand the hole up. */
function layoutBearing(mode) {
  return mode === 'wide' ? 0 : -90;
}

function mapLibraryMissing(containerId) {
  const haveLeaflet = typeof L !== 'undefined';
  const haveRotate = haveLeaflet && typeof L.Map.prototype.setBearing === 'function';
  if (haveLeaflet && haveRotate) return false;
  const el = document.getElementById(containerId);
  if (el) {
    el.classList.add('map-message');
    el.innerHTML = '<div class="map-message__inner">'
      + '<strong>Map library didn\'t load.</strong>'
      + '<span>The <code>vendor/leaflet/</code> folder is missing or wasn\'t kept '
      + 'next to this page. Make sure the whole site folder stays together.</span>'
      + '</div>';
  }
  return true;
}

/* Live satellite tiles. Used ONLY by stage 1 of the admin tool, to author the
   hole images. The marshal-facing pages never load a tile. */
function addSatelliteLayer(map) {
  const layer = L.tileLayer(SATELLITE_TILE_URL, {
    maxZoom: 21,
    maxNativeZoom: 19,
    crossOrigin: 'anonymous',   // required so captures can be exported
    attribution: SATELLITE_ATTRIBUTION
  });

  let warned = false;
  layer.on('tileerror', () => {
    if (warned) return;
    warned = true;
    const note = document.createElement('div');
    note.className = 'map-offline-note';
    note.textContent = "Satellite imagery couldn't load — stage 1 needs an internet "
      + "connection to Esri's tile server.";
    map.getContainer().appendChild(note);
  });

  layer.addTo(map);
  return layer;
}

/* A pan/zoom surface showing one hole image. No tile server involved. */
function createImageMap(containerId, opts) {
  return L.map(containerId, Object.assign({
    crs: L.CRS.Simple,
    rotate: true,
    bearing: 0,
    rotateControl: false,
    touchRotate: false,
    shiftKeyRotate: false,
    zoomSnap: 0,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 140,
    zoomControl: false,
    attributionControl: false,
    minZoom: -6,
    maxZoom: 4,
    center: [0, 0],
    zoom: 0
  }, opts || {}));
}

function setHoleImage(map, hole, existing) {
  const bounds = imageBounds(hole);
  if (existing) map.removeLayer(existing);
  const layer = L.imageOverlay(hole.image.src, bounds).addTo(map);
  return layer;
}

function frameImage(map, hole, mode, padding) {
  map.setBearing(layoutBearing(mode));
  map.fitBounds(imageBounds(hole), {
    padding: L.point(padding || 6, padding || 6),
    animate: false
  });
}

/* ---------- markers ---------- */

function teeIcon() {
  return L.divIcon({
    className: 'hole-endpoint',
    html: '<span class="hole-endpoint__mark hole-endpoint__mark--tee">T</span>',
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function greenIcon() {
  return L.divIcon({
    className: 'hole-endpoint',
    html: '<span class="hole-endpoint__mark hole-endpoint__mark--green">G</span>',
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function marshalIcon(index) {
  return L.divIcon({
    className: 'marshal-pin',
    html: `<span class="marshal-pin__num">${index + 1}</span>`,
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function spotPopupHtml(index, spot) {
  const bits = [];
  if (spot.label) bits.push(escapeHtml(spot.label));
  return `<strong>Station ${index + 1}</strong>${bits.length ? '<br>' + bits.join('<br>') : ''}`;
}

/* Tee/green markers + centre line, drawn from the IMAGE's own tee/green. */
function addHoleEndpoints(map, hole, opts) {
  opts = opts || {};
  if (!holeHasImage(hole)) return null;
  const ax = holeAxis(hole);
  const teeLL = imgToLatLng(hole, ax.tee.x, ax.tee.y);
  const greenLL = imgToLatLng(hole, ax.green.x, ax.green.y);

  const line = L.polyline([teeLL, greenLL], {
    color: '#F6F3EA', weight: 2, opacity: 0.5,
    dashArray: '8 10', interactive: false
  }).addTo(map);

  const tee = L.marker(teeLL, {
    icon: teeIcon(), draggable: !!opts.draggable, zIndexOffset: 400
  }).addTo(map);
  const green = L.marker(greenLL, {
    icon: greenIcon(), draggable: !!opts.draggable, zIndexOffset: 400
  }).addTo(map);

  if (opts.labels !== false) {
    tee.bindPopup('<strong>Tee box</strong>');
    green.bindPopup('<strong>Green</strong>');
  }
  return { line, tee, green };
}

/* A marshal station, positioned from its axis coordinates. */
function addMarshalSpot(map, hole, spot, index, opts) {
  opts = opts || {};
  const p = axisToImagePoint(hole, spot.t, spot.offsetYards);
  if (!p) return null;
  const ll = imgToLatLng(hole, p.x, p.y);
  const radiusPx = yardsToPixels(hole, num(spot.radiusYards, DEFAULT_RADIUS_YARDS));

  // In CRS.Simple, circle radius is in map units, which here are image pixels.
  const circle = L.circle(ll, {
    radius: radiusPx,
    color: '#C0392B', weight: 2,
    fillColor: '#C0392B', fillOpacity: 0.28
  }).addTo(map);

  const marker = L.marker(ll, {
    icon: marshalIcon(index), draggable: !!opts.draggable, zIndexOffset: 500
  }).addTo(map);

  const html = spotPopupHtml(index, spot);
  circle.bindPopup(html);
  marker.bindPopup(html);
  return { circle, marker };
}

/* ============================================================
   course.html
   ============================================================ */
function renderCoursePage() {
  const courseKey = getCourseKey();
  const course = HOLES_DATA[courseKey];
  document.body.classList.toggle('theme-west', courseKey === 'west');

  const titleEl = document.getElementById('course-title');
  if (titleEl) titleEl.textContent = course.name;

  /* Three distinct states, so setup progress is visible rather than every
     unfinished hole reading the same "Pending". A hole with an image but no
     stations means stage 1 landed and stage 2 is still to do -- that is very
     different from a hole with no image at all. */
  let withImage = 0, withStations = 0;

  const grid = document.getElementById('hole-grid');
  if (grid) {
    grid.innerHTML = course.holes.map(h => {
      const hasImage = holeHasImage(h);
      const nStations = (h.marshals || []).length;
      if (hasImage) withImage++;
      if (hasImage && nStations) withStations++;

      let cls = '', label = 'Pending';
      if (hasImage && nStations) { label = 'Hole'; }
      else if (hasImage) { cls = ' hole-tile--no-stations'; label = 'No spots'; }
      else { cls = ' hole-tile--pending'; }

      return `
      <a class="hole-tile${cls}"
         href="hole.html?course=${courseKey}&hole=${h.number}" role="listitem">
        <span class="hole-tile__number">${h.number}</span>
        <span class="hole-tile__label">${label}</span>
      </a>`;
    }).join('');
  }

  /* Setup summary. Only shown while something is incomplete -- once every
     hole is done it disappears and marshals never see it. */
  const summary = document.getElementById('grid-summary');
  if (summary) {
    const total = course.holes.length;
    if (withStations === total) {
      summary.hidden = true;
    } else {
      summary.hidden = false;
      summary.innerHTML =
        `<strong>Setup in progress:</strong> ${withImage} of ${total} holes have an image, `
        + `${withStations} of ${total} also have marshal stations.`
        + (withImage && !withStations
            ? ' Stage 1 is loaded — stage 2 (placing stations) is still to do.'
            : '')
        + (!withImage
            ? ' No hole images are loaded yet.'
            : '');
    }
  }
}

/* ============================================================
   hole.html — marshal-facing view, image only
   ============================================================ */
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
  if (parEl) {
    const bits = [];
    if (hole.par) bits.push('Par ' + hole.par);
    if (hole.lengthYards) bits.push(Math.round(hole.lengthYards) + ' yd');
    parEl.textContent = bits.join(' · ');
  }

  const spots = hole.marshals || [];
  const list = document.getElementById('marshal-list');
  if (list) {
    list.innerHTML = spots.length
      ? spots.map((s, i) => {
          const side = s.offsetYards > 2 ? 'right' : (s.offsetYards < -2 ? 'left' : 'centre');
          const along = Math.round(num(s.t, 0) * num(hole.lengthYards, 0));
          const meta = hole.lengthYards
            ? `${along} yd from tee · ${side} of centre` : '';
          return `
          <li class="marshal-list__item">
            <span class="marshal-list__num">${i + 1}</span>
            <span class="marshal-list__desc">${escapeHtml(s.label || 'Marshal spot')}
              ${meta ? `<span class="marshal-list__meta">${meta}</span>` : ''}</span>
          </li>`;
        }).join('')
      : '<li class="marshal-list__item marshal-list__item--empty">'
        + 'No marshal stations have been set for this hole yet.</li>';
  }

  const idx = course.holes.findIndex(h => h.number === hole.number);
  const prev = course.holes[idx - 1], next = course.holes[idx + 1];
  const pager = document.getElementById('hole-pager');
  if (pager) {
    pager.innerHTML = `
      ${prev ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${prev.number}">&larr; Hole ${prev.number}</a>` : '<span></span>'}
      <a class="pager-btn pager-btn--all" href="course.html?course=${courseKey}">All holes</a>
      ${next ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${next.number}">Hole ${next.number} &rarr;</a>` : '<span></span>'}
    `;
  }

  const missing = document.getElementById('hole-no-image');
  if (!holeHasImage(hole)) {
    if (missing) missing.hidden = false;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.hidden = true;
    const rc = document.getElementById('hole-recenter');
    if (rc) rc.hidden = true;
    return;
  }
  if (missing) missing.hidden = true;

  if (mapLibraryMissing('map')) return;

  const map = createImageMap('map');
  window.holeMap = map;   // handle for debugging in the console
  L.control.zoom({ position: 'topleft' }).addTo(map);

  setHoleImage(map, hole);
  addHoleEndpoints(map, hole);
  spots.forEach((spot, i) => addMarshalSpot(map, hole, spot, i));

  function frame() { frameImage(map, hole, layoutMode()); }
  frame();

  const recenter = document.getElementById('hole-recenter');
  if (recenter) {
    recenter.addEventListener('click', () => { map.invalidateSize(); frame(); });
  }

  let lastMode = layoutMode();
  const onResize = debounce(() => {
    map.invalidateSize();
    const mode = layoutMode();
    if (mode !== lastMode) { lastMode = mode; frame(); }
  }, 200);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}
