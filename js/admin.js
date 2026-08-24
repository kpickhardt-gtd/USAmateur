/* ============================================================
   Oak Hill Marshal Guide — Admin, two formally separate stages

   STAGE 1  Hole images
            Work on the live satellite map: place the tee and green pins,
            check the framing, then Capture -> a .jpg you commit to
            images/holes/. Or Upload an image you already have (official
            course artwork, a drawing) and mark its tee and green.
            Output: hole.image = { src, width, height, tee, green }

   STAGE 2  Marshal stations
            Works ONLY on hole.image. It never touches lat/lng, and stores
            stations as (t along the axis, offsetYards across it). Swap the
            image, re-mark tee/green, and every station still lands right.

   The stages share nothing but the image record, which is the point.
   ============================================================ */

const DRAFT_KEY = 'oakhill_admin_draft_v3';
const IMAGE_DIR = 'images/holes';

let state;
let stage = 1;
let currentCourse = 'east';
let currentHoleNum = 1;

/* --- stage 1 (satellite) --- */
let geoMap = null;
let geoLayers = null;          // {line, tee, green}
let placing = null;            // 'tee' | 'green' | null
let suppressRotateCapture = false;

/* --- stage 2 (image) --- */
let imgMap = null;
let imgOverlay = null;
let imgEndpoints = null;
let spotLayers = [];
let previewMode = 'wide';
let markEndpoint = null;       // 'tee' | 'green' while re-marking on an image

/* Object URLs for images captured this session but not yet committed to
   disk, so stage 2 works immediately without a round-trip through git. */
const pendingImages = Object.create(null);

function courseObj() { return state[currentCourse]; }
function hole() { return courseObj().holes.find(h => h.number === currentHoleNum); }
function holeKey(course, n) { return `${course}-${String(n).padStart(2, '0')}`; }

/* Where stage 2 and the marshal page should load the image from. */
function imageDisplaySrc(h) {
  const key = holeKey(currentCourse, h.number);
  return pendingImages[key] || (h.image && h.image.src) || null;
}

/* ---------- persistence ---------- */

function loadState() {
  let draft = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch (e) { draft = null; }
  if (draft && draft.east && draft.west) return { data: draft, fromDraft: true };
  return { data: JSON.parse(JSON.stringify(HOLES_DATA)), fromDraft: false };
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* full/blocked */ }
}

function setStatus(msg) {
  const el = document.getElementById('admin-status');
  if (el) el.textContent = msg || '';
}

function markDirty(msg) {
  saveDraft();
  if (msg) setStatus(msg);
  renderProgress();
}

function dataStats(d) {
  let images = 0, signed = 0, spots = 0;
  ['east', 'west'].forEach(k => {
    ((d[k] && d[k].holes) || []).forEach(h => {
      if (h.imageReady) images++;
      if (h.spotsDone) signed++;
      spots += (h.marshals || []).length;
    });
  });
  return { images, signed, spots };
}

function sameStats(a, b) {
  return a.images === b.images && a.signed === b.signed && a.spots === b.spots;
}

function checkDraftConflict() {
  const banner = document.getElementById('draft-conflict');
  if (!banner) return;
  const d = dataStats(state), f = dataStats(HOLES_DATA);
  if (sameStats(d, f)) { banner.hidden = true; return; }
  const fmt = s => `${s.images} image${s.images === 1 ? '' : 's'} · ${s.spots} station${s.spots === 1 ? '' : 's'}`;
  document.getElementById('draft-conflict-text').innerHTML =
    `Unexported edits in this browser (<strong>${fmt(d)}</strong>) don't match `
    + `<code>js/holes-data.js</code> on disk (<strong>${fmt(f)}</strong>). `
    + `The browser copy is in use — load the file instead if it's the newer one.`;
  banner.hidden = false;
}

function useFileInstead() {
  if (!window.confirm('Discard the edits stored in this browser and load js/holes-data.js?')) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  state = JSON.parse(JSON.stringify(HOLES_DATA));
  migrateState();
  populateHoleSelect();
  loadHole();
  renderProgress();
  checkDraftConflict();
  setStatus('Loaded js/holes-data.js.');
}

/* Bring older drafts up to the split schema, including converting any
   lat/lng marshal spots into axis coordinates. */
function migrateState() {
  ['east', 'west'].forEach(key => {
    const course = state[key];
    if (!course || !course.holes) return;
    course.holes.forEach(h => {
      if (!h.source) {
        // v2 stored tee/green at the top level as lat/lng
        h.source = {
          kind: 'satellite',
          tee: h.tee || null,
          green: h.green || null,
          bearingNudge: num(h.bearingNudge, 0),
          zoomNudge: num(h.zoomNudge, 0)
        };
      }
      delete h.tee; delete h.green; delete h.bearingNudge; delete h.zoomNudge;
      if (!('image' in h)) h.image = null;
      if (typeof h.imageReady !== 'boolean') h.imageReady = !!h.image;
      if (typeof h.spotsDone !== 'boolean') h.spotsDone = false;
      if (typeof h.lengthYards !== 'number' && holeHasSource(h)) {
        h.lengthYards = metersToYards(geoDistanceMeters(h.source.tee, h.source.green));
      }
      if (!Array.isArray(h.marshals)) h.marshals = [];
      h.marshals = h.marshals.map(s => {
        if (typeof s.t === 'number') {
          if (typeof s.radiusYards !== 'number') {
            s.radiusYards = typeof s.radius === 'number'
              ? metersToYards(s.radius) : DEFAULT_RADIUS_YARDS;
          }
          delete s.radius;
          if (typeof s.offsetYards !== 'number') s.offsetYards = 0;
          return s;
        }
        // legacy lat/lng spot -> axis coords, if we have the geometry
        if (typeof s.lat === 'number' && holeHasSource(h) && h.lengthYards) {
          const conv = latLngSpotToAxis(h, s);
          return {
            t: conv.t, offsetYards: conv.offsetYards,
            radiusYards: typeof s.radius === 'number' ? metersToYards(s.radius) : DEFAULT_RADIUS_YARDS,
            label: s.label || ''
          };
        }
        return { t: 0.5, offsetYards: 0, radiusYards: DEFAULT_RADIUS_YARDS, label: s.label || '' };
      });
    });
  });
}

/* Project a lat/lng marshal spot onto the hole axis (migration only). */
function latLngSpotToAxis(h, s) {
  const z = 20;
  const t = lngLatToWorldPx(h.source.tee.lat, h.source.tee.lng, z);
  const g = lngLatToWorldPx(h.source.green.lat, h.source.green.lng, z);
  const p = lngLatToWorldPx(s.lat, s.lng, z);
  const ax = { x: g.x - t.x, y: g.y - t.y };
  const len = Math.hypot(ax.x, ax.y) || 1;
  const u = { x: ax.x / len, y: ax.y / len };
  const n = { x: -u.y, y: u.x };
  const d = { x: p.x - t.x, y: p.y - t.y };
  const along = d.x * u.x + d.y * u.y;
  const across = d.x * n.x + d.y * n.y;
  return {
    t: along / len,
    offsetYards: across / len * h.lengthYards
  };
}

/* ---------- boot ---------- */

function initAdmin() {
  const loaded = loadState();
  state = loaded.data;
  migrateState();
  previewMode = layoutMode();

  document.getElementById('admin-course').addEventListener('change', e => {
    currentCourse = e.target.value;
    currentHoleNum = courseObj().holes[0].number;
    populateHoleSelect();
    loadHole();
  });
  document.getElementById('admin-hole').addEventListener('change', e => {
    currentHoleNum = parseInt(e.target.value, 10);
    loadHole();
  });
  document.getElementById('admin-prev-hole').addEventListener('click', () => stepHole(-1));
  document.getElementById('admin-next-hole').addEventListener('click', () => stepHole(1));

  document.getElementById('stage-1-tab').addEventListener('click', () => setStage(1));
  document.getElementById('stage-2-tab').addEventListener('click', () => setStage(2));

  // stage 1
  document.getElementById('place-tee').addEventListener('click', () => setPlacing('tee'));
  document.getElementById('place-green').addEventListener('click', () => setPlacing('green'));
  document.getElementById('clear-endpoints').addEventListener('click', clearEndpoints);
  document.getElementById('capture-hole').addEventListener('click', captureCurrentHole);
  document.getElementById('upload-image').addEventListener('change', uploadImage);
  document.getElementById('image-ready-toggle').addEventListener('change', onImageReadyToggle);
  document.querySelectorAll('[data-rotate]').forEach(b =>
    b.addEventListener('click', () => rotateBy(parseFloat(b.dataset.rotate))));
  document.querySelectorAll('[data-zoom]').forEach(b =>
    b.addEventListener('click', () => zoomBy(parseFloat(b.dataset.zoom))));
  document.getElementById('reset-framing').addEventListener('click', resetFraming);

  // stage 2
  document.querySelectorAll('[data-preview]').forEach(b =>
    b.addEventListener('click', () => setPreview(b.dataset.preview)));
  document.getElementById('add-spot').addEventListener('click', addSpotAtCentre);
  document.getElementById('mark-tee').addEventListener('click', () => setMarkEndpoint('tee'));
  document.getElementById('mark-green').addEventListener('click', () => setMarkEndpoint('green'));
  document.getElementById('spots-done-toggle').addEventListener('change', onSpotsDoneToggle);

  // export / import
  document.getElementById('export-hole').addEventListener('click', exportHole);
  document.getElementById('export-all').addEventListener('click', exportAll);
  document.getElementById('import-file').addEventListener('change', importFiles);
  document.getElementById('admin-reset').addEventListener('click', resetToOriginal);
  document.getElementById('use-file-instead').addEventListener('click', useFileInstead);
  document.getElementById('dismiss-conflict').addEventListener('click', () => {
    document.getElementById('draft-conflict').hidden = true;
  });

  setStatus(loaded.fromDraft
    ? 'Restored your in-progress edits from this browser.'
    : 'Starting from the data file on disk.');

  populateHoleSelect();
  initGeoMap();
  setStage(1);
  loadHole();
  renderProgress();
  if (loaded.fromDraft) checkDraftConflict();

  window.addEventListener('resize', debounce(() => {
    if (geoMap) geoMap.invalidateSize();
    if (imgMap) imgMap.invalidateSize();
  }, 200));
}

/* ---------- selection / stages ---------- */

function populateHoleSelect() {
  const sel = document.getElementById('admin-hole');
  sel.innerHTML = courseObj().holes.map(h => {
    const flag = h.spotsDone ? ' ✓✓' : (h.imageReady ? ' ✓' : '');
    return `<option value="${h.number}">Hole ${h.number}${flag}</option>`;
  }).join('');
  sel.value = currentHoleNum;
}

function stepHole(d) {
  const holes = courseObj().holes;
  const i = holes.findIndex(h => h.number === currentHoleNum);
  const nxt = holes[i + d];
  if (!nxt) return;
  currentHoleNum = nxt.number;
  document.getElementById('admin-hole').value = currentHoleNum;
  loadHole();
}

function setStage(s) {
  stage = s;
  placing = null;
  markEndpoint = null;
  document.getElementById('stage-1-tab').classList.toggle('is-active', s === 1);
  document.getElementById('stage-2-tab').classList.toggle('is-active', s === 2);
  document.getElementById('stage-1-panel').hidden = s !== 1;
  document.getElementById('stage-2-panel').hidden = s !== 2;
  document.getElementById('geo-wrap').hidden = s !== 1;
  document.getElementById('img-wrap').hidden = s !== 2;
  loadHole();
}

function loadHole() {
  if (stage === 1) {
    drawGeo();
    frameGeo();
    if (geoMap) geoMap.invalidateSize();
  } else {
    buildImageStage();
  }
  refreshUi();
}

/* ============================================================
   STAGE 1 — satellite, tee/green, capture
   ============================================================ */

function initGeoMap() {
  geoMap = L.map('geo-map', {
    center: [43.1123, -77.5305], zoom: 16,
    rotate: true, bearing: 0, rotateControl: false,
    touchRotate: true, shiftKeyRotate: true,
    zoomSnap: 0, zoomDelta: 0.25, wheelPxPerZoomLevel: 140, zoomControl: false
  });
  L.control.zoom({ position: 'topleft' }).addTo(geoMap);
  addSatelliteLayer(geoMap);
  geoMap.on('click', onGeoClick);
  geoMap.on('rotateend', () => {
    if (suppressRotateCapture) return;
    const h = hole();
    if (!holeHasSource(h)) return;
    h.source.bearingNudge = normalizeDeg(geoMap.getBearing() - autoGeoBearing(h));
    updateGeoReadout();
    markDirty();
  });
}

/* Bearing that lays the hole out left-to-right on the satellite map, so what
   you see matches what a capture will produce. */
function autoGeoBearing(h) {
  return 90 - geoBearing(h.source.tee, h.source.green);
}

function normalizeDeg(d) {
  return Math.round((((d + 180) % 360 + 360) % 360 - 180) * 10) / 10;
}

function drawGeo() {
  if (geoLayers) {
    [geoLayers.line, geoLayers.tee, geoLayers.green].forEach(l => l && geoMap.removeLayer(l));
    geoLayers = null;
  }
  const h = hole();
  if (!holeHasSource(h)) return;

  const teeLL = [h.source.tee.lat, h.source.tee.lng];
  const greenLL = [h.source.green.lat, h.source.green.lng];
  const line = L.polyline([teeLL, greenLL], {
    color: '#F6F3EA', weight: 2, opacity: 0.55, dashArray: '6 8', interactive: false
  }).addTo(geoMap);
  const tee = L.marker(teeLL, { icon: teeIcon(), draggable: true, zIndexOffset: 400 }).addTo(geoMap);
  const green = L.marker(greenLL, { icon: greenIcon(), draggable: true, zIndexOffset: 400 }).addTo(geoMap);

  [['tee', tee], ['green', green]].forEach(([which, m]) => {
    m.on('drag', () => line.setLatLngs([tee.getLatLng(), green.getLatLng()]));
    m.on('dragend', () => {
      const ll = m.getLatLng();
      hole().source[which] = { lat: ll.lat, lng: ll.lng };
      recomputeLength();
      updateGeoReadout();
      markDirty(`Moved the ${which} pin.`);
    });
  });
  geoLayers = { line, tee, green };
}

function recomputeLength() {
  const h = hole();
  if (holeHasSource(h)) {
    h.lengthYards = metersToYards(geoDistanceMeters(h.source.tee, h.source.green));
  }
}

function frameGeo() {
  const h = hole();
  suppressRotateCapture = true;
  if (holeHasSource(h)) {
    geoMap.setBearing(autoGeoBearing(h) + num(h.source.bearingNudge, 0));
    geoMap.fitBounds(
      L.latLngBounds([h.source.tee.lat, h.source.tee.lng], [h.source.green.lat, h.source.green.lng]),
      { padding: L.point(90, 70), animate: false });
    const zn = num(h.source.zoomNudge, 0);
    if (zn) geoMap.setZoom(geoMap.getZoom() + zn, { animate: false });
  } else {
    geoMap.setBearing(0);
    geoMap.setView([43.1123, -77.5305], 16, { animate: false });
  }
  setTimeout(() => { suppressRotateCapture = false; }, 0);
  updateGeoReadout();
}

function updateGeoReadout() {
  const el = document.getElementById('geo-readout');
  if (!el || !geoMap) return;
  const h = hole();
  if (!holeHasSource(h)) {
    el.textContent = `Bearing ${num(geoMap.getBearing(), 0).toFixed(1)}° · `
      + `zoom ${num(geoMap.getZoom(), 16).toFixed(2)} · tee/green not placed`;
    return;
  }
  el.textContent = `Hole runs ${geoBearing(h.source.tee, h.source.green).toFixed(1)}° · `
    + `${Math.round(h.lengthYards)} yd · rotation nudge ${num(h.source.bearingNudge, 0).toFixed(1)}° · `
    + `zoom nudge ${num(h.source.zoomNudge, 0).toFixed(2)}`;
}

function setPlacing(which) {
  placing = placing === which ? null : which;
  refreshUi();
  setStatus(placing ? `Click the map to place the ${placing === 'tee' ? 'tee box' : 'green'} pin.` : '');
}

function onGeoClick(e) {
  if (!placing) return;
  const h = hole();
  if (!h.source) h.source = { kind: 'satellite', tee: null, green: null, bearingNudge: 0, zoomNudge: 0 };
  h.source[placing] = { lat: e.latlng.lat, lng: e.latlng.lng };
  const done = placing;
  placing = (done === 'tee' && !h.source.green) ? 'green' : null;
  recomputeLength();
  drawGeo();
  if (holeHasSource(h)) frameGeo();
  refreshUi();
  markDirty(placing ? 'Tee placed. Now click the top of the green.' : `${done === 'tee' ? 'Tee' : 'Green'} placed.`);
}

function clearEndpoints() {
  if (!window.confirm('Clear the tee and green pins for this hole?')) return;
  const h = hole();
  h.source = { kind: 'satellite', tee: null, green: null, bearingNudge: 0, zoomNudge: 0 };
  drawGeo(); frameGeo(); refreshUi(); populateHoleSelect();
  markDirty('Tee and green cleared.');
}

function rotateBy(d) {
  const h = hole();
  if (holeHasSource(h)) {
    h.source.bearingNudge = normalizeDeg(num(h.source.bearingNudge, 0) + d);
    frameGeo(); markDirty();
  } else {
    suppressRotateCapture = true;
    geoMap.setBearing(geoMap.getBearing() + d);
    setTimeout(() => { suppressRotateCapture = false; }, 0);
    updateGeoReadout();
  }
}

function zoomBy(d) {
  const h = hole();
  if (holeHasSource(h)) {
    h.source.zoomNudge = Math.round((num(h.source.zoomNudge, 0) + d) * 100) / 100;
    frameGeo(); markDirty();
  } else {
    geoMap.setZoom(geoMap.getZoom() + d, { animate: false });
    updateGeoReadout();
  }
}

function resetFraming() {
  const h = hole();
  if (!h.source) return;
  h.source.bearingNudge = 0;
  h.source.zoomNudge = 0;
  frameGeo();
  markDirty('Framing reset.');
}

/* Capture the current hole to a JPEG and record where tee/green landed. */
async function captureCurrentHole() {
  const h = hole();
  if (!holeHasSource(h)) { setStatus('Place the tee and green pins first.'); return; }

  const btn = document.getElementById('capture-hole');
  btn.disabled = true;
  setStatus('Capturing satellite imagery…');
  try {
    const res = await captureHoleImage({
      tee: h.source.tee, green: h.source.green,
      bearingNudge: num(h.source.bearingNudge, 0),
      zoomNudge: num(h.source.zoomNudge, 0)
    });

    const key = holeKey(currentCourse, h.number);
    const filename = `${key}.jpg`;
    h.lengthYards = res.lengthYards;
    h.image = {
      src: `${IMAGE_DIR}/${filename}`,
      width: res.image.width, height: res.image.height,
      tee: res.image.tee, green: res.image.green
    };
    h.imageReady = false;   // becomes true when you sign it off

    if (pendingImages[key]) URL.revokeObjectURL(pendingImages[key]);
    pendingImages[key] = URL.createObjectURL(res.blob);

    downloadBlob(res.blob, filename);

    const extra = [];
    if (res.tilesFailed) extra.push(`${res.tilesFailed} tile(s) failed to load`);
    if (res.downsized) extra.push(`sized ${res.image.width}×${res.image.height} to stay at native imagery detail`);
    setStatus(`Captured ${filename}${extra.length ? ' — ' + extra.join('; ') : ''}. `
      + `Save it into ${IMAGE_DIR}/ in the repo.`);
    markDirty();
    refreshUi();
  } catch (err) {
    setStatus(err.corsBlocked ? err.message : 'Capture failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

/* Supply an image yourself — the path for official course artwork later. */
function uploadImage(e) {
  const file = (e.target.files || [])[0];
  if (!file) return;
  const h = hole();
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    const key = holeKey(currentCourse, h.number);
    const ext = (file.name.match(/\.(jpe?g|png|webp)$/i) || ['.jpg'])[0].toLowerCase();
    const keepTee = h.image && h.image.tee;
    h.image = {
      src: `${IMAGE_DIR}/${key}${ext}`,
      width: probe.naturalWidth, height: probe.naturalHeight,
      // Carry the old marks over as a starting point; otherwise assume the
      // standard framing and let them be dragged.
      tee: keepTee ? h.image.tee : { x: CAPTURE_PAD_FRAC, y: 0.5 },
      green: keepTee ? h.image.green : { x: 1 - CAPTURE_PAD_FRAC, y: 0.5 }
    };
    h.imageReady = false;
    if (pendingImages[key]) URL.revokeObjectURL(pendingImages[key]);
    pendingImages[key] = url;
    markDirty(`Loaded ${file.name} (${probe.naturalWidth}×${probe.naturalHeight}). `
      + `Save it as ${h.image.src}, then check the T and G marks in stage 2.`);
    refreshUi();
    e.target.value = '';
  };
  probe.onerror = () => {
    setStatus("That file couldn't be read as an image.");
    URL.revokeObjectURL(url);
    e.target.value = '';
  };
  probe.src = url;
}

function onImageReadyToggle(e) {
  const h = hole();
  if (e.target.checked && !holeHasImage(h)) {
    e.target.checked = false;
    setStatus('Capture or upload an image for this hole first.');
    return;
  }
  h.imageReady = e.target.checked;
  populateHoleSelect();
  markDirty(h.imageReady ? `Hole ${h.number} image signed off.` : 'Sign-off cleared.');
}

/* ============================================================
   STAGE 2 — marshal stations on the image
   ============================================================ */

function buildImageStage() {
  const h = hole();
  const src = imageDisplaySrc(h);
  const has = holeHasImage(h) && src;

  document.getElementById('stage-2-warning').hidden = !!has;
  document.getElementById('stage-2-body').hidden = !has;
  if (!has) return;

  // Rebuild the map from scratch: image size differs per hole.
  if (imgMap) { imgMap.remove(); imgMap = null; }
  imgOverlay = null; imgEndpoints = null; spotLayers = [];

  imgMap = createImageMap('img-map');
  L.control.zoom({ position: 'topleft' }).addTo(imgMap);

  const displayHole = imageHoleForDisplay(h, src);
  imgOverlay = L.imageOverlay(src, imageBounds(displayHole)).addTo(imgMap);
  imgMap.on('click', onImageClick);

  drawImageLayers();
  frameImageStage();
}

/* hole() but with the image src swapped for the local blob when the file
   isn't committed yet. */
function imageHoleForDisplay(h, src) {
  return Object.assign({}, h, { image: Object.assign({}, h.image, { src }) });
}

function frameImageStage() {
  const h = hole();
  if (!imgMap || !holeHasImage(h)) return;
  frameImage(imgMap, h, previewMode, 8);
}

function setPreview(mode) {
  previewMode = mode;
  document.querySelectorAll('[data-preview]').forEach(b =>
    b.classList.toggle('is-active', b.dataset.preview === mode));
  const wrap = document.getElementById('img-wrap');
  if (wrap) wrap.classList.toggle('map-frame--narrow', mode === 'narrow');
  if (imgMap) { imgMap.invalidateSize(); frameImageStage(); }
}

function drawImageLayers() {
  const h = hole();
  if (!imgMap || !holeHasImage(h)) return;

  if (imgEndpoints) {
    [imgEndpoints.line, imgEndpoints.tee, imgEndpoints.green]
      .forEach(l => l && imgMap.removeLayer(l));
    imgEndpoints = null;
  }
  spotLayers.forEach(s => { imgMap.removeLayer(s.marker); imgMap.removeLayer(s.circle); });
  spotLayers = [];

  imgEndpoints = addHoleEndpoints(imgMap, h, { draggable: true, labels: false });
  if (imgEndpoints) {
    bindEndpointDrag(imgEndpoints.tee, 'tee');
    bindEndpointDrag(imgEndpoints.green, 'green');
  }

  (h.marshals || []).forEach((spot, i) => {
    const layers = addMarshalSpot(imgMap, h, spot, i, { draggable: true });
    if (!layers) return;
    layers.marker.on('drag', ev => layers.circle.setLatLng(ev.target.getLatLng()));
    layers.marker.on('dragend', ev => {
      const p = latLngToImg(h, ev.target.getLatLng());
      const ax = imagePointToAxis(h, p.x, p.y);
      spot.t = ax.t;
      spot.offsetYards = ax.offsetYards;
      renderSpotList();
      markDirty('Moved a station.');
    });
    spotLayers.push(layers);
  });

  renderSpotList();
}

/* Dragging the T or G on the image re-defines the axis. Every station keeps
   its (t, offsetYards) and so moves with it -- this is what makes swapping
   an image cheap. */
function bindEndpointDrag(marker, which) {
  marker.on('drag', () => {
    if (imgEndpoints) {
      imgEndpoints.line.setLatLngs([
        imgEndpoints.tee.getLatLng(), imgEndpoints.green.getLatLng()
      ]);
    }
  });
  marker.on('dragend', () => {
    const h = hole();
    const p = latLngToImg(h, marker.getLatLng());
    h.image[which] = { x: p.x / h.image.width, y: p.y / h.image.height };
    drawImageLayers();
    markDirty(`Re-marked the ${which} on the image — stations moved with it.`);
  });
}

function setMarkEndpoint(which) {
  markEndpoint = markEndpoint === which ? null : which;
  refreshUi();
  setStatus(markEndpoint
    ? `Click the image to set the ${markEndpoint === 'tee' ? 'tee' : 'green'} position.`
    : '');
}

function onImageClick(e) {
  const h = hole();
  if (!holeHasImage(h)) return;
  const p = latLngToImg(h, e.latlng);

  if (markEndpoint) {
    h.image[markEndpoint] = { x: p.x / h.image.width, y: p.y / h.image.height };
    const which = markEndpoint;
    markEndpoint = null;
    drawImageLayers();
    refreshUi();
    markDirty(`Set the ${which} on the image — stations moved with it.`);
    return;
  }

  const ax = imagePointToAxis(h, p.x, p.y);
  if (!ax) return;
  h.marshals.push({
    t: ax.t, offsetYards: ax.offsetYards,
    radiusYards: DEFAULT_RADIUS_YARDS,
    label: `Marshal spot ${h.marshals.length + 1}`
  });
  drawImageLayers();
  markDirty('Station added.');
}

function addSpotAtCentre() {
  const h = hole();
  if (!holeHasImage(h)) return;
  h.marshals.push({
    t: 0.5, offsetYards: 0,
    radiusYards: DEFAULT_RADIUS_YARDS,
    label: `Marshal spot ${h.marshals.length + 1}`
  });
  drawImageLayers();
  markDirty('Station added at the centre of the hole.');
}

function removeSpot(i) {
  hole().marshals.splice(i, 1);
  drawImageLayers();
  markDirty('Station removed.');
}

function renderSpotList() {
  const list = document.getElementById('spot-list');
  if (!list) return;
  const h = hole();
  const spots = h.marshals || [];

  if (!spots.length) {
    list.innerHTML = '<li class="marshal-list__item marshal-list__item--empty">'
      + 'No stations yet — click the image to add one.</li>';
    return;
  }

  list.innerHTML = spots.map((s, i) => {
    const along = Math.round(num(s.t, 0) * num(h.lengthYards, 0));
    const off = Math.round(num(s.offsetYards, 0));
    const side = off > 0 ? `${off} yd right` : (off < 0 ? `${-off} yd left` : 'on centre');
    return `
    <li class="marshal-list__item admin-spot-row">
      <span class="marshal-list__num">${i + 1}</span>
      <div class="admin-spot-fields">
        <input type="text" class="admin-spot-label" value="${escapeHtml(s.label || '')}"
               data-idx="${i}" aria-label="Station ${i + 1} description">
        <div class="admin-spot-radius">
          <span class="admin-spot-pos">${along} yd from tee · ${side}</span>
          <button type="button" class="admin-radius-btn" data-idx="${i}" data-delta="-2"
                  aria-label="Shrink highlight">&minus;</button>
          <span>${Math.round(num(s.radiusYards, DEFAULT_RADIUS_YARDS))} yd</span>
          <button type="button" class="admin-radius-btn" data-idx="${i}" data-delta="2"
                  aria-label="Grow highlight">+</button>
        </div>
      </div>
      <button type="button" class="admin-spot-remove" data-idx="${i}"
              aria-label="Remove station ${i + 1}">&times;</button>
    </li>`;
  }).join('');

  list.querySelectorAll('.admin-spot-label').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = +e.target.dataset.idx;
      const spot = hole().marshals[i];
      spot.label = e.target.value;
      const html = spotPopupHtml(i, spot);
      if (spotLayers[i]) {
        spotLayers[i].circle.bindPopup(html);
        spotLayers[i].marker.bindPopup(html);
      }
      markDirty();
    });
  });

  list.querySelectorAll('.admin-radius-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.currentTarget.dataset.idx;
      const d = +e.currentTarget.dataset.delta;
      const h2 = hole();
      const spot = h2.marshals[i];
      spot.radiusYards = Math.max(2, num(spot.radiusYards, DEFAULT_RADIUS_YARDS) + d);
      if (spotLayers[i]) spotLayers[i].circle.setRadius(yardsToPixels(h2, spot.radiusYards));
      renderSpotList();
      markDirty();
    });
  });

  list.querySelectorAll('.admin-spot-remove').forEach(btn => {
    btn.addEventListener('click', e => removeSpot(+e.currentTarget.dataset.idx));
  });
}

function onSpotsDoneToggle(e) {
  const h = hole();
  if (e.target.checked && !(h.marshals || []).length) {
    e.target.checked = false;
    setStatus('Add at least one station first.');
    return;
  }
  h.spotsDone = e.target.checked;
  populateHoleSelect();
  markDirty(h.spotsDone ? `Hole ${h.number} stations signed off.` : 'Sign-off cleared.');
}

/* ---------- shared UI ---------- */

function refreshUi() {
  const h = hole();
  const hasSource = holeHasSource(h);
  const hasImage = holeHasImage(h);

  // stage 1
  const pt = document.getElementById('place-tee');
  const pg = document.getElementById('place-green');
  pt.textContent = (h.source && h.source.tee) ? 'Move tee pin' : 'Place tee pin';
  pg.textContent = (h.source && h.source.green) ? 'Move green pin' : 'Place green pin';
  pt.classList.toggle('is-active', placing === 'tee');
  pg.classList.toggle('is-active', placing === 'green');
  document.getElementById('capture-hole').disabled = !hasSource;
  document.getElementById('image-ready-toggle').checked = !!h.imageReady;

  const info = document.getElementById('image-info');
  if (info) {
    info.textContent = hasImage
      ? `${h.image.src} · ${h.image.width}×${h.image.height}`
      : 'No image yet for this hole.';
  }

  // stage 2
  document.getElementById('spots-done-toggle').checked = !!h.spotsDone;
  document.getElementById('mark-tee').classList.toggle('is-active', markEndpoint === 'tee');
  document.getElementById('mark-green').classList.toggle('is-active', markEndpoint === 'green');
  document.getElementById('export-hole').disabled = !hasImage;

  updateGeoReadout();
  if (stage === 2) renderSpotList();
}

function renderProgress() {
  const el = document.getElementById('admin-progress');
  if (!el) return;
  el.innerHTML = ['east', 'west'].map(k => {
    const holes = state[k].holes;
    return `<span class="admin-progress__row"><strong>${state[k].name}</strong>
      images ${holes.filter(h => h.imageReady).length}/${holes.length} ·
      stations ${holes.filter(h => h.spotsDone).length}/${holes.length}</span>`;
  }).join('');
  populateHoleSelect();
}

/* ---------- export / import ---------- */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(filename, text, mime) {
  downloadBlob(new Blob([text], { type: mime || 'application/json' }), filename);
}

function exportHole() {
  const h = hole();
  downloadText(`hole-${holeKey(currentCourse, h.number)}.json`, JSON.stringify({
    format: 'oak-hill-marshal-hole',
    version: 3,
    course: currentCourse,
    courseName: courseObj().name,
    hole: JSON.parse(JSON.stringify(h))
  }, null, 2));
  setStatus(`Exported hole-${holeKey(currentCourse, h.number)}.json`);
}

function exportAll() {
  downloadText('holes-data.js',
    '// Hole images and marshal stations.\n'
    + '// Exported from admin.html on ' + new Date().toISOString() + '\n'
    + '// Replace js/holes-data.js with this file and commit it.\n'
    + 'const HOLES_DATA = ' + JSON.stringify(state, null, 2) + ';\n',
    'text/javascript');
  setStatus('Exported holes-data.js — replace js/holes-data.js and commit it, '
    + 'along with any new images in ' + IMAGE_DIR + '/.');
}

function importFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  let merged = 0;
  const problems = [];

  Promise.all(files.map(file => file.text().then(txt => {
    let payload;
    try { payload = JSON.parse(txt); }
    catch (err) { problems.push(`${file.name}: not valid JSON`); return; }

    if (payload && payload.east && payload.west) {
      state = payload; merged++; return;
    }
    if (!payload || payload.format !== 'oak-hill-marshal-hole' || !payload.hole) {
      problems.push(`${file.name}: not a hole export`); return;
    }
    const ck = payload.course === 'west' ? 'west' : 'east';
    const holes = state[ck].holes;
    const i = holes.findIndex(x => x.number === payload.hole.number);
    if (i < 0) { problems.push(`${file.name}: hole ${payload.hole.number} not found`); return; }
    holes[i] = payload.hole;
    merged++;
  }))).then(() => {
    migrateState();
    populateHoleSelect();
    loadHole();
    renderProgress();
    saveDraft();
    setStatus(`Imported ${merged} file${merged === 1 ? '' : 's'}.`
      + (problems.length ? ' Skipped: ' + problems.join('; ') : ''));
    e.target.value = '';
  });
}

function resetToOriginal() {
  if (!window.confirm('Discard all edits stored in this browser and reload the data file on disk?')) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
  state = JSON.parse(JSON.stringify(HOLES_DATA));
  migrateState();
  populateHoleSelect();
  loadHole();
  renderProgress();
  checkDraftConflict();
  setStatus('Reset to the data file on disk.');
}
