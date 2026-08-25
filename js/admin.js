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
const IMAGE_DIR = IMAGE_BASE.replace(/\/$/, '');

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

/* Images made this session that aren't in the repo yet.
   { url, blob, path } -- the blob is what gets committed; the url lets stage 2
   show it immediately without waiting for a round-trip through GitHub. */
const pendingImages = Object.create(null);

/* Set when anything changes; cleared on a successful save. */
let unsavedChanges = false;

function courseObj() { return state[currentCourse]; }
function hole() { return courseObj().holes.find(h => h.number === currentHoleNum); }
function holeKey(course, n) { return `${course}-${String(n).padStart(2, '0')}`; }

/* Where stage 2 and the marshal page should load the image from. */
function imageDisplaySrc(h) {
  const key = holeKey(currentCourse, h.number);
  // A capture made this session is still a blob; otherwise resolve the
  // committed file path for whichever folder layout this build uses.
  const pending = pendingImages[key];
  return (pending && pending.url) || (h.image && h.image.src ? resolveImageSrc(h.image.src) : null);
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
  unsavedChanges = true;
  updateSyncUi();
  scheduleAutoSave();
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
      if (!Array.isArray(h.source.shots)) h.source.shots = [];
      if (!('image' in h)) h.image = null;
      if (h.image && !Array.isArray(h.image.shots)) h.image.shots = [];
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
        // Can't be converted -- no geometry to project it against. DROP it
        // rather than inventing a position: a fabricated station in the middle
        // of the hole looks like real data and would send a marshal to the
        // wrong place. The old placeholder rows land here, which is why holes
        // that were never worked on come through clean.
        return null;
      }).filter(Boolean);
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
  document.getElementById('place-shot').addEventListener('click', () => setPlacing('shot'));
  document.getElementById('remove-shot').addEventListener('click', removeLastShot);
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

  const stampEl = document.getElementById('build-stamp');
  if (stampEl) stampEl.textContent = BUILD_STAMP;

  setStatus(loaded.fromDraft
    ? 'Restored your in-progress edits from this browser.'
    : 'Starting from the data file on disk.');

  initGitHubSync();
  populateHoleSelect();
  initGeoMap();
  setStage(1);
  loadHole();
  renderProgress();
  if (loaded.fromDraft) checkDraftConflict();
  checkImagesReachable();   // async; updates the badge when it finishes

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

/* Draw whatever pins exist -- deliberately NOT waiting for a complete
   tee+green pair, so a pin appears the instant you place it. */
function drawGeo() {
  if (geoLayers) {
    [geoLayers.line, geoLayers.tee, geoLayers.green]
      .concat(geoLayers.shots || [])
      .forEach(l => l && geoMap.removeLayer(l));
    geoLayers = null;
  }
  const h = hole();
  const src = h.source || {};
  if (!src.tee && !src.green && !(src.shots || []).length) return;

  const ll = p => [p.lat, p.lng];
  const shots = src.shots || [];

  // The centre line follows tee -> S1 -> S2 -> green
  const linePts = []
    .concat(src.tee ? [ll(src.tee)] : [])
    .concat(shots.map(ll))
    .concat(src.green ? [ll(src.green)] : []);

  const line = linePts.length > 1
    ? L.polyline(linePts, { color: '#F6F3EA', weight: 2, opacity: 0.55,
                            dashArray: '6 8', interactive: false }).addTo(geoMap)
    : null;

  function redrawLine() {
    if (!line) return;
    const pts = []
      .concat(geoLayers.tee ? [geoLayers.tee.getLatLng()] : [])
      .concat((geoLayers.shots || []).map(m => m.getLatLng()))
      .concat(geoLayers.green ? [geoLayers.green.getLatLng()] : []);
    line.setLatLngs(pts);
  }

  const tee = src.tee
    ? L.marker(ll(src.tee), { icon: teeIcon(), draggable: true, zIndexOffset: 400 }).addTo(geoMap)
    : null;
  const green = src.green
    ? L.marker(ll(src.green), { icon: greenIcon(), draggable: true, zIndexOffset: 400 }).addTo(geoMap)
    : null;
  const shotMarkers = shots.map((p, i) =>
    L.marker(ll(p), { icon: shotIcon(i), draggable: true, zIndexOffset: 380 }).addTo(geoMap));

  geoLayers = { line, tee, green, shots: shotMarkers };

  [['tee', tee], ['green', green]].forEach(([which, m]) => {
    if (!m) return;
    m.on('drag', redrawLine);
    m.on('dragend', () => {
      const p = m.getLatLng();
      hole().source[which] = { lat: p.lat, lng: p.lng };
      recomputeLength(); updateGeoReadout();
      markDirty(`Moved the ${which} pin.`);
    });
  });

  shotMarkers.forEach((m, i) => {
    m.on('drag', redrawLine);
    m.on('dragend', () => {
      const p = m.getLatLng();
      hole().source.shots[i] = { lat: p.lat, lng: p.lng };
      recomputeLength(); updateGeoReadout();
      markDirty(`Moved shot point S${i + 1}.`);
    });
  });
}

/* Playing length along tee -> shot points -> green. */
function recomputeLength() {
  const h = hole();
  if (!holeHasSource(h)) return;
  const pts = [h.source.tee].concat(h.source.shots || []).concat([h.source.green]);
  let m = 0;
  for (let i = 0; i < pts.length - 1; i++) m += geoDistanceMeters(pts[i], pts[i + 1]);
  h.lengthYards = metersToYards(m);
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
  const nShots = (h.source.shots || []).length;
  el.textContent = `Hole runs ${geoBearing(h.source.tee, h.source.green).toFixed(1)}° · `
    + `${Math.round(h.lengthYards)} yd along the fairway`
    + (nShots ? ` (${nShots} shot point${nShots > 1 ? 's' : ''})` : ' (straight)')
    + ` · rotation nudge ${num(h.source.bearingNudge, 0).toFixed(1)}° · `
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
  if (!h.source) h.source = { kind: 'satellite', tee: null, green: null, shots: [], bearingNudge: 0, zoomNudge: 0 };
  if (!Array.isArray(h.source.shots)) h.source.shots = [];

  const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
  let msg;

  if (placing === 'shot') {
    h.source.shots.push(pt);
    msg = `Shot point S${h.source.shots.length} placed.`;
    placing = null;
  } else {
    const done = placing;
    h.source[done] = pt;
    // Chain tee -> green, but the marker for the tee is drawn immediately
    // below either way, so you can see it landed.
    placing = (done === 'tee' && !h.source.green) ? 'green' : null;
    msg = placing ? 'Tee placed — now click the top of the green.'
                  : `${done === 'tee' ? 'Tee' : 'Green'} placed.`;
  }

  recomputeLength();
  drawGeo();                       // renders the new pin right away
  if (holeHasSource(h)) frameGeo();
  refreshUi();
  markDirty(msg);
}

function clearEndpoints() {
  if (!window.confirm('Clear the tee, green and any shot points for this hole?')) return;
  const h = hole();
  h.source = { kind: 'satellite', tee: null, green: null, shots: [], bearingNudge: 0, zoomNudge: 0 };
  drawGeo(); frameGeo(); refreshUi(); populateHoleSelect();
  markDirty('Tee and green cleared.');
}

function removeLastShot() {
  const h = hole();
  const shots = (h.source && h.source.shots) || [];
  if (!shots.length) { setStatus('No shot points to remove.'); return; }
  const n = shots.length;
  shots.pop();
  recomputeLength();
  drawGeo();
  if (holeHasSource(h)) frameGeo();
  refreshUi();
  markDirty(`Removed shot point S${n}.`);
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
      shots: h.source.shots || [],
      bearingNudge: num(h.source.bearingNudge, 0),
      zoomNudge: num(h.source.zoomNudge, 0)
    });

    const key = holeKey(currentCourse, h.number);
    const filename = `${key}.jpg`;
    h.lengthYards = res.lengthYards;
    h.image = {
      src: IMAGE_BASE + filename,
      width: res.image.width, height: res.image.height,
      tee: res.image.tee, green: res.image.green,
      shots: res.image.shots || []
    };
    h.imageReady = false;   // becomes true when you sign it off

    if (pendingImages[key]) URL.revokeObjectURL(pendingImages[key].url);
    pendingImages[key] = {
      url: URL.createObjectURL(res.blob),
      blob: res.blob,
      path: h.image.src
    };
    // Only fall back to a download when there's no GitHub save configured.
    if (!ghReady()) downloadBlob(res.blob, filename);

    const extra = [];
    if (res.tilesFailed) extra.push(`${res.tilesFailed} tile(s) failed to load`);
    if (res.downsized) extra.push(`sized ${res.image.width}×${res.image.height} to stay at native imagery detail`);
    if (res.zoomedOutToFit) extra.push(`zoomed out ${res.zoomedOutToFit}× so the dogleg fits`);
    setStatus(`Captured ${filename}${extra.length ? ' — ' + extra.join('; ') : ''}. `
      + `Save it into ${IMAGE_DIR || 'the site folder'} in the repo.`);
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
    const keepShots = (h.image && h.image.shots) || [];
    h.image = {
      src: IMAGE_BASE + key + ext,
      width: probe.naturalWidth, height: probe.naturalHeight,
      // Carry the old marks over as a starting point; otherwise assume the
      // standard framing and let them be dragged.
      tee: keepTee ? h.image.tee : { x: CAPTURE_PAD_FRAC, y: 0.5 },
      green: keepTee ? h.image.green : { x: 1 - CAPTURE_PAD_FRAC, y: 0.5 },
      shots: keepShots
    };
    h.imageReady = false;
    if (pendingImages[key]) URL.revokeObjectURL(pendingImages[key].url);
    pendingImages[key] = { url, blob: file, path: h.image.src };
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
      .concat(imgEndpoints.shots || [])
      .forEach(l => l && imgMap.removeLayer(l));
    imgEndpoints = null;
  }
  spotLayers.forEach(s => { imgMap.removeLayer(s.marker); imgMap.removeLayer(s.circle); });
  spotLayers = [];

  imgEndpoints = addHoleEndpoints(imgMap, h, { draggable: true, labels: false });
  if (imgEndpoints) {
    bindEndpointDrag(imgEndpoints.tee, 'tee');
    bindEndpointDrag(imgEndpoints.green, 'green');
    (imgEndpoints.shots || []).forEach((m, i) => bindShotDrag(m, i));
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
function redrawImageLine() {
  if (!imgEndpoints || !imgEndpoints.line) return;
  imgEndpoints.line.setLatLngs([imgEndpoints.tee.getLatLng()]
    .concat((imgEndpoints.shots || []).map(m => m.getLatLng()))
    .concat([imgEndpoints.green.getLatLng()]));
}

/* Dragging a shot point reshapes the fairway path, so stations measured along
   it move with it -- same principle as re-marking the tee or green. */
function bindShotDrag(marker, i) {
  marker.on('drag', redrawImageLine);
  marker.on('dragend', () => {
    const h = hole();
    const p = latLngToImg(h, marker.getLatLng());
    h.image.shots[i] = { x: p.x / h.image.width, y: p.y / h.image.height };
    drawImageLayers();
    markDirty(`Moved S${i + 1} on the image — stations followed the path.`);
  });
}

function bindEndpointDrag(marker, which) {
  marker.on('drag', redrawImageLine);
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

  const nShots = ((h.source && h.source.shots) || []).length;
  const ps = document.getElementById('place-shot');
  ps.textContent = `Add shot point S${nShots + 1}`;
  ps.classList.toggle('is-active', placing === 'shot');
  document.getElementById('remove-shot').disabled = !nShots;
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
  downloadText('holes-data.js', buildDataFileText(), 'text/javascript');
  setStatus('Exported holes-data.js — replace js/holes-data.js and commit it, '
    + 'along with any new images in ' + (IMAGE_DIR || 'the site folder') + '.');
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

/* ============================================================
   GitHub sync — the automatic save path
   ============================================================ */

let autoSaveTimer = null;
let saveInFlight = false;
let lastDataSha = null;          // remote sha of holes-data.js as we last knew it

/* Where the data file lives IN THE REPO. Derived from this page's own script
   tag rather than hardcoded, because the folder build loads
   "js/holes-data.js" and the flat build loads "holes-data.js" -- and a
   hardcoded guess silently writes to a path the live site never reads. */
const DATA_PATH = (function () {
  const el = document.querySelector('script[src$="holes-data.js"]');
  const src = el ? el.getAttribute('src') : 'js/holes-data.js';
  return src.replace(/^\.?\//, '').split('?')[0];
})();
const AUTO_SAVE_DELAY = 8000;    // quiet period before an automatic commit

function ghCfgFromForm() {
  const cfg = ghLoadConfig();
  return {
    owner: document.getElementById('gh-owner').value.trim() || cfg.owner,
    repo: document.getElementById('gh-repo').value.trim() || cfg.repo,
    branch: document.getElementById('gh-branch').value.trim() || cfg.branch || 'main',
    autoSave: document.getElementById('gh-autosave').checked
  };
}

/* Enough configured to attempt a save? */
function ghReady() {
  const cfg = ghLoadConfig();
  return !!(cfg.owner && cfg.repo && ghGetToken());
}

function initGitHubSync() {
  const cfg = ghLoadConfig();
  document.getElementById('gh-owner').value = cfg.owner;
  document.getElementById('gh-repo').value = cfg.repo;
  document.getElementById('gh-branch').value = cfg.branch;
  document.getElementById('gh-autosave').checked = cfg.autoSave;
  document.getElementById('gh-token').value = ghGetToken();
  document.getElementById('gh-remember').checked = ghTokenRemembered();

  ['gh-owner', 'gh-repo', 'gh-branch'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => {
      ghSaveConfig(ghCfgFromForm()); updateSyncUi();
    }));

  document.getElementById('gh-autosave').addEventListener('change', () => {
    ghSaveConfig(ghCfgFromForm());
    setSyncStatus(document.getElementById('gh-autosave').checked
      ? 'Auto-save on — changes commit themselves a few seconds after you stop editing.'
      : 'Auto-save off — use Save to GitHub when you\'re ready.');
    updateSyncUi();
  });

  document.getElementById('gh-token').addEventListener('change', e => {
    ghSetToken(e.target.value.trim(), document.getElementById('gh-remember').checked);
    updateSyncUi();
  });
  document.getElementById('gh-remember').addEventListener('change', e => {
    ghSetToken(document.getElementById('gh-token').value.trim(), e.target.checked);
  });
  document.getElementById('gh-forget').addEventListener('click', () => {
    ghForgetToken();
    document.getElementById('gh-token').value = '';
    document.getElementById('gh-remember').checked = false;
    setSyncStatus('Token cleared from this browser.');
    updateSyncUi();
  });

  document.getElementById('gh-test').addEventListener('click', testGitHub);
  document.getElementById('gh-dryrun').addEventListener('click', showWhatWillBeSaved);
  document.getElementById('gh-save').addEventListener('click', () => saveToGitHub(false));

  // Don't let a closed tab lose work that hasn't been committed.
  window.addEventListener('beforeunload', e => {
    if (!unsavedChanges || !ghReady()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  updateSyncUi();
}

function setSyncStatus(msg, kind) {
  const el = document.getElementById('gh-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'admin-status gh-status' + (kind ? ' gh-status--' + kind : '');
}

function pendingImageList() {
  return Object.keys(pendingImages)
    .map(k => pendingImages[k])
    .filter(p => p && p.blob && p.path);
}

function updateSyncUi() {
  const badge = document.getElementById('gh-unsaved');
  if (!badge) return;
  const nImages = pendingImageList().length;
  const ready = ghReady();

  // Shown ahead of everything else: if the deployed build disagrees with the
  // data about where images live, nothing else about this panel matters.
  const warn = imageWarningText();
  if (warn) {
    badge.textContent = warn;
    badge.className = 'gh-unsaved gh-unsaved--warn';
    document.getElementById('gh-save').disabled = !ready || saveInFlight;
    document.getElementById('gh-test').disabled = !ghGetToken() || saveInFlight;
    return;
  }

  document.getElementById('gh-save').disabled = !ready || saveInFlight;
  document.getElementById('gh-test').disabled = !ghGetToken() || saveInFlight;

  if (!ready) {
    badge.textContent = 'Not connected — fill in the repository and token to save automatically.';
    badge.className = 'gh-unsaved';
    return;
  }
  if (saveInFlight) { badge.textContent = 'Saving…'; badge.className = 'gh-unsaved gh-unsaved--busy'; return; }

  if (unsavedChanges || nImages) {
    badge.textContent = 'Unsaved changes'
      + (nImages ? ` · ${nImages} image${nImages === 1 ? '' : 's'} not yet in the repo` : '');
    badge.className = 'gh-unsaved gh-unsaved--dirty';
  } else {
    badge.textContent = 'Everything is saved to GitHub.';
    badge.className = 'gh-unsaved gh-unsaved--clean';
  }
}

/* True while the "your browser copy doesn't match the file" banner is up. */
function draftConflictUnresolved() {
  const b = document.getElementById('draft-conflict');
  return !!(b && !b.hidden);
}

function scheduleAutoSave() {
  const cfg = ghLoadConfig();
  if (!cfg.autoSave || !ghReady()) return;

  // Never let an automatic save quietly push a stale browser draft over good
  // data in the repo. The banner has to be dealt with first -- either load the
  // file, or explicitly choose to keep the browser copy.
  if (draftConflictUnresolved()) {
    setSyncStatus('Auto-save paused: your browser copy doesn\'t match the '
      + 'repository. Resolve the notice at the top before saving.', 'bad');
    return;
  }

  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveToGitHub(true), AUTO_SAVE_DELAY);
}

async function testGitHub() {
  const cfg = ghCfgFromForm();
  ghSaveConfig(cfg);
  setSyncStatus('Checking…');
  try {
    const r = await ghTestConnection(cfg);
    if (!r.branchOk) { setSyncStatus(r.branchMsg + ' Check the branch name.', 'bad'); return; }
    if (!r.canPush) {
      setSyncStatus(`Connected to ${r.repoFullName}, but this token can't write to it. `
        + 'Give it "Contents: Read and write" for this repository.', 'bad');
      return;
    }
    setSyncStatus(`Connected to ${r.repoFullName} (${r.private ? 'private' : 'public'}) `
      + `on ${cfg.branch}, with write access. Saving will work.`, 'good');
    updateSyncUi();
  } catch (err) {
    setSyncStatus(err.message, 'bad');
  }
}

/* Which directory the existing hole records already use for images, or null
   if nothing has an image yet. The DATA is the authority on where images
   live -- if this build disagrees with it, the wrong build is deployed. */
function imageDirInData() {
  let dir = null;
  ['east', 'west'].forEach(k => ((state[k] && state[k].holes) || []).forEach(h => {
    if (dir === null && h.image && h.image.src) {
      const i = h.image.src.lastIndexOf('/');
      dir = i >= 0 ? h.image.src.slice(0, i + 1) : '';
    }
  }));
  return dir;
}

/* Whether the hole images this data references actually LOAD from where this
   build looks for them.

   An earlier version of this compared stored path strings against IMAGE_BASE,
   which raised false alarms: resolveImageSrc() already normalises a stored
   path, so data written by the other layout displays perfectly well. The only
   thing that genuinely matters is whether the file is reachable, so that is
   what gets checked -- no proxy, no guessing. */
let imageReachability = { checked: false, broken: [], probed: 0 };

function probeImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src + (src.includes('?') ? '&' : '?') + 'probe=' + Date.now();
  });
}

async function checkImagesReachable() {
  const refs = [];
  ['east', 'west'].forEach(k => ((state[k] && state[k].holes) || []).forEach(h => {
    // Images still pending in this session are blobs -- always fine.
    const key = holeKey(k, h.number);
    if (h.image && h.image.src && !pendingImages[key]) {
      refs.push({ course: k, n: h.number, resolved: resolveImageSrc(h.image.src), stored: h.image.src });
    }
  }));

  // A handful is enough to tell a layout problem from a one-off missing file.
  const sample = refs.slice(0, 4);
  const broken = [];
  for (const r of sample) {
    if (!(await probeImage(r.resolved))) broken.push(r);
  }
  imageReachability = { checked: true, broken, probed: sample.length };
  updateSyncUi();
}

function imageWarningText() {
  const r = imageReachability;
  if (!r.checked || !r.broken.length) return '';
  const b = r.broken[0];
  const allBroken = r.broken.length === r.probed;

  let msg = (allBroken && r.probed > 1
      ? 'None of the hole images load. '
      : `Hole ${b.n} image doesn't load. `)
    + `This page looks for it at "${b.resolved}"`
    + (b.stored !== b.resolved ? ` (the data stores it as "${b.stored}")` : '')
    + '. ';

  // Everything failing points at the files being somewhere else entirely,
  // rather than one bad filename.
  if (allBroken) {
    msg += 'If the .jpg files are in the repository root while this build expects '
         + `"${IMAGE_BASE || 'the root'}", either the wrong build is deployed or the `
         + 'files need moving — re-capturing a hole writes it to the right place. ';
  }
  msg += 'Otherwise check the file was committed, and that its name matches exactly, '
       + 'including capitals.';
  return msg;
}

/* Exactly what a save would write, without writing it. The paths are the
   thing worth checking: a wrong one commits successfully but to a file the
   live site never reads. */
function showWhatWillBeSaved() {
  const cfg = ghCfgFromForm();
  const images = pendingImageList();
  const dataDir = imageDirInData();
  const lines = [`build ${BUILD_STAMP}`,
                 `${cfg.owner || '?'}/${cfg.repo || '?'} on ${cfg.branch || '?'}`,
                 '', 'Files this save would write:',
                 `  ${DATA_PATH}   (${buildDataFileText().length.toLocaleString()} bytes)`];
  images.forEach(p => lines.push(`  ${p.path}   (${Math.round(p.blob.size / 1024)} KB)`));
  if (!images.length) lines.push('  (no new images pending)');
  lines.push('',
    `This page loads data from : ${DATA_PATH}`,
    `This build saves images to: ${IMAGE_BASE || '(repository root)'}`,
    `Your data stores images in: ${dataDir === null ? '(none yet)' : (dataDir || '(repository root)')}`,
    '',
    'The data path lines must match, and so must the two image lines.');
  const warn = imageWarningText();
  if (warn) lines.push('', '*** ' + warn + ' ***');
  setSyncStatus(lines.join('\n'));
  const el = document.getElementById('gh-status');
  if (el) el.classList.add('gh-status--pre');
}

/* Commit the data file plus any images that aren't in the repo yet. */
async function saveToGitHub(isAuto) {
  if (saveInFlight) return;
  const cfg = ghCfgFromForm();
  if (!cfg.owner || !cfg.repo) { setSyncStatus('Set the repository owner and name first.', 'bad'); return; }
  if (!ghGetToken()) { setSyncStatus('Enter an access token first.', 'bad'); return; }

  // Same guard for a manual save, but here you're allowed to override.
  if (draftConflictUnresolved()) {
    const go = window.confirm(
      'Your browser copy of the hole data does not match js/holes-data.js in the '
      + 'repository (see the notice at the top of the page).\n\n'
      + 'Saving now overwrites the repository with what is on this screen. '
      + 'If the repository copy is the newer one, cancel and use '
      + '"Load the file instead".\n\nSave anyway?');
    if (!go) { setSyncStatus('Save cancelled — the repository copy was left alone.', 'bad'); return; }
  }

  clearTimeout(autoSaveTimer);
  saveInFlight = true;
  updateSyncUi();
  ghSaveConfig(cfg);

  try {
    // Notice if something else changed the data file since we last synced.
    const remoteSha = await ghFileSha(cfg, DATA_PATH);
    if (lastDataSha && remoteSha && remoteSha !== lastDataSha) {
      const go = window.confirm(
        'js/holes-data.js has changed in the repository since this page loaded '
        + '(edited elsewhere, or from another browser).\n\n'
        + 'Saving now replaces it with what is on this screen. Continue?');
      if (!go) {
        setSyncStatus('Save cancelled — the repository copy was left alone.', 'bad');
        return;
      }
    }

    const images = pendingImageList();
    const files = [{ path: DATA_PATH, text: buildDataFileText() }]
      .concat(images.map(p => ({ path: p.path, blob: p.blob })));

    const stats = dataStats(state);
    const msg = `Marshal guide: ${stats.images} hole images, ${stats.spots} stations`
      + (images.length ? ` (+${images.length} image file${images.length === 1 ? '' : 's'})` : '')
      + (isAuto ? ' [auto-save]' : '');

    const res = await ghCommitFiles(cfg, files, msg, m => setSyncStatus(m));

    // Committed images are no longer pending.
    images.forEach(p => {
      Object.keys(pendingImages).forEach(k => {
        if (pendingImages[k] === p) {
          URL.revokeObjectURL(p.url);
          delete pendingImages[k];
        }
      });
    });

    lastDataSha = await ghFileSha(cfg, DATA_PATH);
    unsavedChanges = false;
    setSyncStatus(`Saved as ${res.shortSha} — ${res.files.length} file`
      + `${res.files.length === 1 ? '' : 's'}`
      + (res.attempts > 1
          ? ` (the branch had moved, so it was rebuilt on the newer commit)`
          : '')
      + '. GitHub Pages usually redeploys within a minute.', 'good');
  } catch (err) {
    setSyncStatus('Not saved: ' + err.message, 'bad');
  } finally {
    saveInFlight = false;
    updateSyncUi();
  }
}

/* The exact text written to js/holes-data.js -- shared by the download button
   and the GitHub save so the two can never drift apart. */
function buildDataFileText() {
  return '// Hole images and marshal stations.\n'
    + '// Saved from admin.html on ' + new Date().toISOString() + '\n'
    + 'const HOLES_DATA = ' + JSON.stringify(state, null, 2) + ';\n';
}
