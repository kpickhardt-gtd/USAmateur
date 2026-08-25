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
let geoLayer = null;

/* Which imagery source stage 1 is drawing from. Remembered per browser: it's
   a working preference, not part of the hole data, and captures record the
   source they used so the data stays self-describing. */
const IMAGERY_KEY = 'oakhill_imagery_source_v1';
let imagerySourceKey = (function () {
  try { return localStorage.getItem(IMAGERY_KEY) || DEFAULT_IMAGERY; }
  catch (e) { return DEFAULT_IMAGERY; }
})();

/* Deepest zoom captures may use.

   WHY THIS IS A CONTROL AND NOT JUST A PROBE
   ------------------------------------------
   Automatic detection has already been wrong once here, and when it is wrong
   the failure is expensive: every captured hole comes back as a picture of
   "Map data not available". A heuristic guarding that needs an override that
   doesn't depend on the heuristic being right.

   'auto' probes, and is the better answer when it works. A number pins the
   ceiling regardless of what detection thinks -- 19 is the level this tool used
   for its whole life before the ceiling was raised, so it is the known-good
   fallback if anything about the automatic path misbehaves. */
const ZOOM_CAP_KEY = 'oakhill_zoom_cap_v1';
let zoomCapKey = (function () {
  try { return localStorage.getItem(ZOOM_CAP_KEY) || 'auto'; }
  catch (e) { return 'auto'; }
})();

const ZOOM_CAPS = [
  { value: 'auto', label: 'Automatic — use the deepest imagery found' },
  { value: '21', label: 'Zoom 21 — sharpest, only where coverage is very good' },
  { value: '20', label: 'Zoom 20' },
  { value: '19', label: 'Zoom 19 — safe everywhere' },
  { value: '18', label: 'Zoom 18 — coarse, for poor coverage' }
];

/* Output size for captures. The thing that actually governs sharpness. */
const CAPTURE_SIZE_KEY = 'oakhill_capture_size_v1';
let captureSizeKey = (function () {
  try { return localStorage.getItem(CAPTURE_SIZE_KEY) || DEFAULT_CAPTURE_SIZE; }
  catch (e) { return DEFAULT_CAPTURE_SIZE; }
})();
let geoLayers = null;          // {line, tee, green}
let placing = null;            // 'tee' | 'green' | null
let suppressRotateCapture = false;

/* --- stage 2 (image) --- */
let imgMap = null;
let imgOverlay = null;
let imgEndpoints = null;
let imgCompass = null;
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
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    // Stamped alongside, so a later conflict can say which side is newer
    // instead of asking you to work it out from two counts.
    localStorage.setItem(DRAFT_TIME_KEY, String(Date.now()));
  } catch (e) { /* full/blocked */ }
}

/* ============================================================
   PENDING IMAGE BYTES — kept in IndexedDB

   THE TRAP THIS CLOSES
   --------------------
   Capturing or uploading an image put the record straight into the hole data
   (which persists in localStorage) but kept the FILE only as an in-memory
   blob URL. Those two have very different lifetimes. Reload the page and the
   data still confidently says "hole 1 uses images/holes/east-01.png" while the
   only copy of east-01.png that ever existed has been garbage-collected. The
   page then reports the file as unreachable and advises checking capitalisation
   — of a file that was never committed and no longer exists anywhere.

   Image bytes are far too big for localStorage (a 2048x1152 JPEG is ~400KB,
   and base64 inflates it by a third, against a ~5MB quota for the whole
   origin). IndexedDB stores Blobs natively with a much larger quota, so the
   bytes now live there until the commit that publishes them succeeds.

   Everything here degrades quietly: if IndexedDB is unavailable (private
   browsing, an old browser), the tool behaves exactly as it did before rather
   than refusing to work. What it must never do is throw during start-up.
   ============================================================ */

const IMG_DB_NAME = 'oakhill-admin';
const IMG_DB_STORE = 'pending-images';

function imgDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMG_DB_STORE)) db.createObjectStore(IMG_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

function imgDbTx(mode, fn) {
  return imgDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_DB_STORE, mode);
    const store = tx.objectStore(IMG_DB_STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  }));
}

async function imgDbPut(key, rec) {
  try { await imgDbTx('readwrite', s => s.put(rec, key)); }
  catch (e) { if (window.console) console.warn('[admin] could not persist image bytes:', e); }
}

async function imgDbDelete(key) {
  try { await imgDbTx('readwrite', s => s.delete(key)); } catch (e) { /* ignore */ }
}

async function imgDbAll() {
  try {
    const db = await imgDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IMG_DB_STORE, 'readonly');
      const store = tx.objectStore(IMG_DB_STORE);
      const out = {};
      const cur = store.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve(out); return; }
        out[c.key] = c.value;
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  } catch (e) { return {}; }
}

/* A note of which image files were made in THIS browser and have not yet been
   committed. It outlives the blob URLs and even the IndexedDB record, so if
   the bytes are ever lost we can still tell the difference between "this file
   was never published" and "this file is published but the path is wrong" --
   two problems whose advice is completely different. */
const LOCAL_IMAGES_KEY = 'oakhill_local_images_v1';

function localImages() {
  try { return JSON.parse(localStorage.getItem(LOCAL_IMAGES_KEY) || '{}'); }
  catch (e) { return {}; }
}

function noteLocalImage(key, path) {
  try {
    const m = localImages(); m[key] = path;
    localStorage.setItem(LOCAL_IMAGES_KEY, JSON.stringify(m));
  } catch (e) { /* storage unavailable */ }
}

function forgetLocalImage(key) {
  try {
    const m = localImages(); delete m[key];
    localStorage.setItem(LOCAL_IMAGES_KEY, JSON.stringify(m));
  } catch (e) { /* storage unavailable */ }
}

/* Record a pending image both in memory and on disk, so a reload keeps it. */
function setPendingImage(key, blob, path, name) {
  noteLocalImage(key, path);
  if (pendingImages[key]) URL.revokeObjectURL(pendingImages[key].url);
  pendingImages[key] = { url: URL.createObjectURL(blob), blob, path, name: name || null };
  imgDbPut(key, { blob, path, name: name || null });
}

function clearPendingImage(key) {
  const p = pendingImages[key];
  if (p) URL.revokeObjectURL(p.url);
  delete pendingImages[key];
  imgDbDelete(key);
  forgetLocalImage(key);      // it's in the repo now
}

/* Bring back anything that was captured or uploaded but never committed. */
async function restorePendingImages() {
  const saved = await imgDbAll();
  const keys = Object.keys(saved);
  if (!keys.length) return 0;

  let restored = 0;
  keys.forEach(key => {
    const rec = saved[key];
    if (!rec || !rec.blob || !rec.path) return;
    // Only restore where the data still refers to this image; otherwise it's
    // a leftover from a hole that has since been recaptured or cleared.
    if (!stateReferencesPath(rec.path)) { imgDbDelete(key); return; }
    if (pendingImages[key]) return;
    pendingImages[key] = {
      url: URL.createObjectURL(rec.blob), blob: rec.blob,
      path: rec.path, name: rec.name || null
    };
    restored++;
  });
  return restored;
}

function stateReferencesPath(path) {
  const want = String(path).split('/').pop().toLowerCase();
  return ['east', 'west'].some(k => ((state[k] && state[k].holes) || []).some(h =>
    h.image && h.image.src && h.image.src.split('/').pop().toLowerCase() === want));
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

/* ============================================================
   DRAFT vs FILE

   This banner was firing constantly, and it was mostly wrong. Three separate
   reasons, all worth fixing rather than papering over:

   1. It compared unlike things. `state` has been through migrateState; the
      file's contents had not. Migration is not neutral -- it removes leftover
      placeholder stations, fills in missing lengths, defaults imageReady --
      so the two sides differed BY CONSTRUCTION and the banner appeared even
      when the draft and the file were the same data. Both sides are now
      normalised the same way before being compared.

   2. It compared COUNTS. Counting images and stations is a weak proxy: two
      genuinely different data sets can have identical counts, and identical
      data can count differently after normalisation. Now it compares an exact
      fingerprint of the content that matters.

   3. It never re-baselined after a save. `HOLES_DATA` is whatever the page
      loaded; the moment you save, that snapshot is stale by definition, so
      every later check compared the draft against content we had ourselves
      just replaced -- which also kept auto-save permanently paused. A
      successful save now updates the baseline.
   ============================================================ */

/* The file's contents as this page loaded them, replaced whenever we
   successfully write the file ourselves. */
let fileBaseline = null;

function normalisedCopy(d) {
  const c = JSON.parse(JSON.stringify(d || {}));
  try { migrateData(c, false); } catch (e) { /* compare what we can */ }
  return c;
}

/* Everything that would make two data sets meaningfully different, and
   nothing that wouldn't. Coordinates are rounded so floating-point noise from
   migration can't register as a change. */
function dataFingerprint(d) {
  const c = normalisedCopy(d);
  const r = (n, p) => (typeof n === 'number' && isFinite(n) ? n.toFixed(p) : '-');
  const pt = p => p ? `${r(p.x, 6)}:${r(p.y, 6)}` : '-';
  const parts = [];

  ['east', 'west'].forEach(k => (((c[k] && c[k].holes) || [])).forEach(h => {
    parts.push([
      k, h.number,
      h.image ? [h.image.src, h.image.width, h.image.height,
                 pt(h.image.tee), pt(h.image.green),
                 (h.image.shots || []).map(pt).join('|')].join(',') : '-',
      h.imageReady ? 1 : 0,
      h.spotsDone ? 1 : 0,
      r(h.lengthYards, 2),
      (h.marshals || []).map(s =>
        [r(s.t, 6), r(s.offsetYards, 3), r(s.radiusYards, 3), s.label || ''].join('/')).join('|')
    ].join('~'));
  }));

  // FNV-1a: short, stable, and good enough to tell two documents apart.
  let hash = 0x811c9dc5;
  const str = parts.join(';');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

const DRAFT_TIME_KEY = 'oakhill_draft_saved_at_v1';

function draftSavedAt() {
  try { return parseInt(localStorage.getItem(DRAFT_TIME_KEY) || '0', 10) || 0; }
  catch (e) { return 0; }
}

function fileSavedAt(d) {
  const t = d && d.savedAt ? Date.parse(d.savedAt) : 0;
  return isFinite(t) ? t : 0;
}

function checkDraftConflict() {
  const banner = document.getElementById('draft-conflict');
  if (!banner) return;
  const base = fileBaseline || HOLES_DATA;

  if (dataFingerprint(state) === dataFingerprint(base)) {
    banner.hidden = true;
    return;
  }

  const fmt = s => `${s.images} image${s.images === 1 ? '' : 's'} · ${s.spots} station${s.spots === 1 ? '' : 's'}`;
  const d = dataStats(normalisedCopy(state)), f = dataStats(normalisedCopy(base));

  /* Which is newer is the only question that matters, and it used to be left
     entirely to the reader. Both sides now carry a timestamp where they can. */
  const dt = draftSavedAt(), ft = fileSavedAt(base);
  let verdict;
  if (dt && ft) {
    verdict = dt > ft
      ? `<strong>The browser copy is newer</strong> (edited ${describeAge(dt)}; the file was saved ${describeAge(ft)}). Keeping it is almost certainly right.`
      : `<strong>The file is newer</strong> (saved ${describeAge(ft)}; this browser was last edited ${describeAge(dt)}) — most likely edited from another browser or tab. Loading the file is almost certainly right.`;
  } else {
    verdict = 'Which is newer can\'t be determined — this browser copy predates '
      + 'the change that started recording edit times.';
  }

  document.getElementById('draft-conflict-text').innerHTML =
    `Edits in this browser (<strong>${fmt(d)}</strong>) don't match `
    + `<code>${DATA_PATH}</code> (<strong>${fmt(f)}</strong>). ${verdict}`;
  banner.hidden = false;
}

function describeAge(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/* THE ONES THE SWEEP CAN'T PROVE
   ------------------------------
   A hole that DOES have an image could legitimately carry a station you
   placed, so the provenance argument used in migrateState doesn't apply and
   nothing here is deleted automatically.

   What is left is a fingerprint rather than a proof. The shipped placeholders
   all had `radius: 12` in METRES, which converts to 13.123… yards; a station
   placed by hand starts at exactly 13 (DEFAULT_RADIUS_YARDS) and the nudge
   buttons only ever add or subtract whole yards. A lone, unsigned station
   carrying that fractional radius is therefore almost certainly a leftover --
   but "almost certainly" is not good enough to delete someone's work, so
   these are listed and you decide. */
const LEGACY_RADIUS_YARDS = metersToYards(12);

function looksLikeLegacyPlaceholder(s) {
  return Math.abs(num(s.radiusYards, 0) - LEGACY_RADIUS_YARDS) < 1e-6;
}

function suspectPlaceholders() {
  const hits = [];
  ['east', 'west'].forEach(k => ((state[k] && state[k].holes) || []).forEach(h => {
    if (h.spotsDone) return;                       // you signed it off; it's real
    if (h.marshals.length !== 1) return;           // you've been working on it
    if (!looksLikeLegacyPlaceholder(h.marshals[0])) return;
    hits.push({ course: k, number: h.number });
  }));
  return hits;
}

function reportPlaceholders() {
  const banner = document.getElementById('placeholder-notice');
  if (!banner) return;
  const suspects = suspectPlaceholders();

  if (!placeholdersRemoved && !suspects.length && !lengthsAssumed.length) {
    banner.hidden = true; return;
  }

  const parts = [];
  if (lengthsAssumed.length) {
    parts.push(`<strong>${lengthsAssumed.length} hole`
      + `${lengthsAssumed.length === 1 ? '' : 's'} had no recorded length</strong> `
      + `(hole${lengthsAssumed.length === 1 ? ' ' : 's '}${lengthsAssumed.join(', ')}), `
      + `so their marshal circles couldn't be drawn at all. A typical length for `
      + `the par has been filled in and the stations now show. Positions along `
      + `the fairway are exact; the sideways offsets and circle sizes are scaled `
      + `from that estimate — set the tee and green on the satellite map to make `
      + `them exact.`);
  }
  if (placeholdersRemoved) {
    parts.push(`Removed <strong>${placeholdersRemoved}</strong> leftover placeholder `
      + `station${placeholdersRemoved === 1 ? '' : 's'} from holes with no image — `
      + `those can't have been placed by hand, so the holes are clean again. `
      + `Save to GitHub to make that stick.`);
  }
  if (suspects.length) {
    const names = suspects.map(s => `${s.course === 'east' ? 'East' : 'West'} ${s.number}`).join(', ');
    parts.push(`<span class="placeholder-notice__ask">${suspects.length} hole`
      + `${suspects.length === 1 ? ' has' : 's have'} a single unsigned station that looks like `
      + `the same leftover (${names}). These holes have images, so it could be one you placed — `
      + `your call.</span>`);
  }

  document.getElementById('placeholder-notice-text').innerHTML = parts.join('<br>');
  document.getElementById('placeholder-remove').hidden = !suspects.length;
  banner.hidden = false;
}

function removeSuspectPlaceholders() {
  const suspects = suspectPlaceholders();
  if (!suspects.length) return;
  suspects.forEach(s => {
    const h = state[s.course].holes.find(x => x.number === s.number);
    if (h) { h.marshals = []; h.spotsDone = false; }
  });
  placeholdersRemoved = 0;
  reportPlaceholders();
  populateHoleSelect();
  loadHole();
  renderProgress();
  markDirty(`Removed ${suspects.length} leftover station${suspects.length === 1 ? '' : 's'}.`);
}

function useFileInstead() {
  if (!window.confirm(`Discard the edits stored in this browser and load ${DATA_PATH}?`)) return;
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_TIME_KEY);
  } catch (e) { /* ignore */ }
  state = JSON.parse(JSON.stringify(HOLES_DATA));
  fileBaseline = JSON.parse(JSON.stringify(HOLES_DATA));
  migrateState();
  populateHoleSelect();
  loadHole();
  renderProgress();
  checkDraftConflict();
  setStatus('Loaded ' + DATA_PATH + '.');
}

/* Stations removed by the sweep in migrateState, so start-up can say so out
   loud instead of quietly changing the data underneath you. */
let placeholdersRemoved = 0;

/* Holes given an assumed length because nothing recorded a real one. Their
   stations now draw correctly, but the sideways offsets and circle sizes are
   scaled from a guess, so it's worth saying so. */
let lengthsAssumed = [];

/* Bring older drafts up to the split schema, including converting any
   lat/lng marshal spots into axis coordinates. */
function migrateState() {
  migrateData(state, true);
}

/* The same normalisation, applied to any dataset rather than only the global
   one. It has to be callable on a COPY of the file's contents, because that is
   the only way to compare the browser draft against the file honestly: the
   draft has been migrated and the raw file has not, so comparing the two
   directly reports differences that migration itself introduced.

   `report` is false for those throwaway copies -- migrating a copy to compare
   it must not tell the user that placeholders were removed or lengths
   assumed, since nothing they can see was changed. */
function migrateData(data, report) {
  if (report) { placeholdersRemoved = 0; lengthsAssumed = []; }
  let removed = 0;
  ['east', 'west'].forEach(key => {
    const course = data[key];
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
      // Fills the length in from satellite coordinates where they exist, and
      // falls back to a typical length for the par where they don't. Without
      // this, a hole built from an uploaded image has no scale and every one
      // of its stations is silently undrawable.
      if (ensureHoleLength(h) && holeHasImage(h) && report) lengthsAssumed.push(h.number);
      if (!Array.isArray(h.marshals)) h.marshals = [];
      const cameFromLatLng = new Set();   // stations this pass converted
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
          const out = {
            t: conv.t, offsetYards: conv.offsetYards,
            radiusYards: typeof s.radius === 'number' ? metersToYards(s.radius) : DEFAULT_RADIUS_YARDS,
            label: s.label || ''
          };
          cameFromLatLng.add(out);
          return out;
        }
        // Can't be converted -- no geometry to project it against. DROP it
        // rather than inventing a position: a fabricated station in the middle
        // of the hole looks like real data and would send a marshal to the
        // wrong place.
        return null;
      }).filter(Boolean);

      /* THE PLACEHOLDER SWEEP
         ---------------------
         Blocking the fabrication path above was not enough, and it is worth
         being precise about why. The original data shipped one placeholder
         station per hole WITH a lat/lng on it (the clubhouse, roughly). That
         made it convertible, so it went down the branch above and came out as
         a perfectly well-formed axis station — indistinguishable, afterwards,
         from one that was placed deliberately. Every one of the 36 survived.

         What separates them is not their shape but their provenance: a real
         station can only be created in stage 2, and both ways of creating one
         are gated on the hole having an image. So a station on an image-less
         hole cannot have been placed by hand.

         That argument alone would justify emptying every image-less hole, and
         the first version of this did. It is too sharp an instrument. It rests
         on the current UI never clearing an image once set — true today, but
         the whole point of the two-stage split is that images can be REPLACED,
         and the day "re-capture this hole" clears the image first, that broad
         sweep would silently delete real marshal work. A migration that can
         destroy data on a future refactor is a bad trade for tidiness.

         So the drop needs a second, positive reason to believe a station is a
         leftover: either this pass just converted it from lat/lng (only the
         shipped data was ever in that form), or it carries the fingerprint of
         one that an earlier pass converted. A well-formed modern station on an
         image-less hole is left alone — it shouldn't be possible, and if it
         ever becomes possible it will be somebody's real work. */
      if (!holeHasImage(h) && h.marshals.length) {
        const before = h.marshals.length;
        h.marshals = h.marshals.filter(s =>
          !cameFromLatLng.has(s) && !looksLikeLegacyPlaceholder(s));
        removed += before - h.marshals.length;
        if (!h.marshals.length) h.spotsDone = false;
      }
    });
  });
  if (report) placeholdersRemoved = removed;
  return removed;
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

/* WHY THIS EXISTS
   ---------------
   Three separate times now, one exception thrown early in start-up has taken
   the whole admin page down with it, and every time the symptom was something
   that looked unrelated: clicks doing nothing, blank repository fields, "lost
   the GPS map". A single try/catch around the lot would have made it one
   symptom instead of three, but it would still have been silent.

   So start-up is broken into named steps. A step that throws is caught, named
   in a banner you can actually read, and the remaining steps still run — a
   broken GitHub panel no longer costs you the satellite map. */
const bootFailures = [];

function bootStep(name, fn) {
  try {
    fn();
    return true;
  } catch (err) {
    bootFailures.push({ name, err });
    if (window.console) console.error(`[admin] start-up step "${name}" failed:`, err);
    return false;
  }
}

function showBootFailures() {
  if (!bootFailures.length) return;
  const el = document.getElementById('boot-error');
  const list = bootFailures
    .map(f => `${f.name}: ${f.err && f.err.message ? f.err.message : String(f.err)}`)
    .join(' · ');
  if (el) {
    el.innerHTML = '<strong>Part of this page failed to start.</strong> '
      + 'The rest still works, but tell Claude exactly what this says:<br><code></code>';
    el.querySelector('code').textContent = list;
    el.hidden = false;
  }
}

/* Every global this page needs, and which file supplies it. A missing file --
   the usual result of uploading through the GitHub web UI and losing a folder
   -- otherwise shows up as a baffling behaviour rather than a plain message.

   Each entry probes with `typeof`, NOT window[name]. A top-level `const` (how
   HOLES_DATA, IMAGE_BASE and the capture constants are all declared) creates a
   lexical binding that never becomes a property of window, so a window lookup
   reports perfectly healthy files as missing -- which is exactly what the
   first draft of this check did, condemning the whole page. */
const REQUIRED_GLOBALS = [
  ['vendor/leaflet/leaflet.js', () => typeof L !== 'undefined'],
  ['vendor/leaflet/leaflet-rotate.js', () => typeof L !== 'undefined' && !!L.Map.prototype.setBearing],
  ['js/holes-data.js', () => typeof HOLES_DATA !== 'undefined'],
  ['js/app.js', () => typeof resolveImageSrc === 'function'],
  ['js/capture.js', () => typeof captureHoleImage === 'function'],
  ['js/github-sync.js', () => typeof ghLoadConfig === 'function']
];

function missingScripts() {
  return REQUIRED_GLOBALS.filter(([, present]) => {
    try { return !present(); } catch (e) { return true; }
  }).map(([file]) => file);
}

function initAdmin() {
  const missing = missingScripts();
  if (missing.length) {
    const el = document.getElementById('boot-error');
    if (el) {
      el.innerHTML = '<strong>This page is missing files it needs.</strong> '
        + 'Nothing on it will work until they are uploaded. Missing: <code></code>';
      el.querySelector('code').textContent = missing.join(', ');
      el.hidden = false;
    }
    return;
  }

  const loaded = loadState();
  state = loaded.data;
  bootStep('migrating saved data', migrateState);
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

  const imgSel = document.getElementById('imagery-source');
  if (imgSel) {
    imgSel.innerHTML = Object.keys(IMAGERY_SOURCES).map(k =>
      `<option value="${k}">${escapeHtml(IMAGERY_SOURCES[k].label)}</option>`).join('');
    imgSel.value = imagerySourceKey;
    imgSel.addEventListener('change', e => setImagerySource(e.target.value));
  }

  const capSel = document.getElementById('zoom-cap');
  if (capSel) {
    capSel.innerHTML = ZOOM_CAPS.map(z =>
      `<option value="${z.value}">${escapeHtml(z.label)}</option>`).join('');
    capSel.value = zoomCapKey;
    capSel.addEventListener('change', e => {
      zoomCapKey = e.target.value;
      try { localStorage.setItem(ZOOM_CAP_KEY, zoomCapKey); } catch (err) { /* ignore */ }
      reportImageryDetail();
      setStatus(zoomCapKey === 'auto'
        ? 'Maximum zoom: automatic. Existing images are unchanged — re-capture to use it.'
        : `Maximum zoom pinned to ${zoomCapKey}. Existing images are unchanged — `
          + 're-capture a hole to use it.');
    });
  }

  const sizeSel = document.getElementById('capture-size');
  if (sizeSel) {
    sizeSel.innerHTML = Object.keys(CAPTURE_SIZES).map(k =>
      `<option value="${k}">${escapeHtml(CAPTURE_SIZES[k].label)}</option>`).join('');
    sizeSel.value = captureSizeKey;
    sizeSel.addEventListener('change', e => {
      captureSizeKey = e.target.value;
      try { localStorage.setItem(CAPTURE_SIZE_KEY, captureSizeKey); } catch (err) { /* ignore */ }
      refreshUi();
      setStatus(`Capture size: ${captureSize(captureSizeKey).label}. `
        + 'Existing images are unchanged — re-capture a hole to use it.');
    });
  }

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
  document.getElementById('placeholder-remove').addEventListener('click', removeSuspectPlaceholders);
  document.getElementById('placeholder-dismiss').addEventListener('click', () => {
    document.getElementById('placeholder-notice').hidden = true;
  });

  const stampEl = document.getElementById('build-stamp');
  if (stampEl) stampEl.textContent = BUILD_STAMP;

  setStatus(loaded.fromDraft
    ? 'Restored your in-progress edits from this browser.'
    : 'Starting from the data file on disk.');

  // Independent steps, in the order that matters least-to-most for recovery:
  // if the GitHub panel is broken you can still map holes, and if the
  // satellite map is broken you can still save what you already have.
  bootStep('GitHub panel', initGitHubSync);
  bootStep('hole list', populateHoleSelect);
  bootStep('satellite map', initGeoMap);
  bootStep('opening stage 1', () => { setStage(1); loadHole(); });
  bootStep('progress bar', renderProgress);
  bootStep('placeholder sweep', reportPlaceholders);
  if (loaded.fromDraft) bootStep('draft check', checkDraftConflict);
  showBootFailures();

  /* Restore uncommitted image bytes, THEN check reachability -- in that order,
     or a restored image gets reported as missing. */
  restorePendingImages()
    .then(n => {
      if (n) {
        refreshUi();
        updateSyncUi();
        setStatus(`Restored ${n} image${n === 1 ? '' : 's'} captured or uploaded `
          + 'earlier and not yet saved to GitHub.');
      }
    })
    .catch(() => { /* falls back to the old in-memory-only behaviour */ })
    .then(() => checkImagesReachable());

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
  geoLayer = addSatelliteLayer(geoMap, imagerySourceKey);
  reportImageryDetail();
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

/* Switch imagery source, keeping the view and every pin exactly where it is. */
function setImagerySource(key) {
  imagerySourceKey = key;
  try { localStorage.setItem(IMAGERY_KEY, key); } catch (e) { /* ignore */ }
  if (geoMap) geoLayer = setSatelliteSource(geoMap, geoLayer, key);
  const src = imagerySource(key);
  setStatus(`Imagery: ${src.label}. ${src.note}`);
  reportImageryDetail();
  refreshUi();
}

/* Say how much real detail this source has HERE, rather than leaving you to
   judge sharpness by eye. The declared ceiling is only a ceiling; coverage
   varies place to place, so it is probed. */
async function reportImageryDetail() {
  const el = document.getElementById('imagery-detail');
  if (!el) return;
  const key = imagerySourceKey;
  const c = geoMap ? geoMap.getCenter() : { lat: 43.1123, lng: -77.5305 };
  el.textContent = 'Checking available detail…';
  try {
    const probed = await probeMaxZoom(key, c.lat, c.lng);
    if (key !== imagerySourceKey) return;     // switched while we were asking
    const z = zoomCapKey === 'auto' ? probed : Math.min(probed, parseInt(zoomCapKey, 10));

    /* Hold the LIVE map to the same limit. Otherwise zooming past coverage
       fills the screen with "Map data not available" tiles, which look like a
       broken app rather than the edge of the imagery. Leaflet upscales the
       deepest real level instead, which is blurry but honest. */
    if (geoLayer && geoLayer.options.maxNativeZoom !== z) {
      geoLayer.options.maxNativeZoom = z;
      geoLayer.redraw();
    }

    // Ground resolution at the equator, corrected for latitude.
    const mPerPx = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, z);
    const cm = mPerPx * 100;
    el.textContent = `Captures will use zoom ${z}, about `
      + (cm < 100 ? `${cm.toFixed(0)} cm` : `${(cm / 100).toFixed(1)} m`)
      + ' per pixel'
      + (zoomCapKey === 'auto'
          ? ` (deepest imagery found here: ${probed}).`
          : ` (pinned; deepest found here: ${probed}).`);
  } catch (e) {
    el.textContent = '';
  }
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
  const src = imagerySource(imagerySourceKey);
  setStatus(`Capturing from ${src.label}…`);
  try {
    // Ask for the deepest zoom this source actually serves at this hole, not a
    // hardcoded guess -- that guess was costing most of the available detail.
    const maxZoom = zoomCapKey === 'auto'
      ? await probeMaxZoom(imagerySourceKey, h.source.tee.lat, h.source.tee.lng)
      : parseInt(zoomCapKey, 10);
    const size = captureSize(captureSizeKey);
    const res = await captureHoleImage({
      tee: h.source.tee, green: h.source.green,
      shots: h.source.shots || [],
      bearingNudge: num(h.source.bearingNudge, 0),
      zoomNudge: num(h.source.zoomNudge, 0),
      tileUrl: src.url,
      width: size.width, height: size.height,
      maxZoom
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
    // Record which imagery this came from, so the data explains itself later.
    h.source.imagery = imagerySourceKey;
    h.source.capturedZoom = res.zoom || maxZoom;

    setPendingImage(key, res.blob, h.image.src, filename);
    // Only fall back to a download when there's no GitHub save configured.
    if (!ghReady()) downloadBlob(res.blob, filename);

    const extra = [];
    if (res.tilesFailed) extra.push(`${res.tilesFailed} tile(s) failed to load`);
    if (res.steppedDown) {
      extra.push(`dropped ${res.steppedDown} zoom level${res.steppedDown === 1 ? '' : 's'} `
        + 'because the imagery runs out above this one');
    }
    if (res.downsized) extra.push(`sized ${res.image.width}×${res.image.height} to stay at native imagery detail`);
    if (res.zoomedOutToFit) extra.push(`zoomed out ${res.zoomedOutToFit}× so the dogleg fits`);
    // The real numbers, because "is this sharper?" should not be a guess.
    extra.push(`zoom ${res.zoom}, ${Math.round(res.blob.size / 1024)} KB`);
    /* The blank-tile count is always reported, not just on failure. Detection
       here has been wrong before; a number on screen is what makes that
       checkable instead of something you discover in a downloaded file. */
    if (res.coverageWarning) {
      setStatus(`Captured ${filename}, but ${res.tilesBlank} of ${res.tilesLoaded} `
        + `imagery tiles came back as "Map data not available" — even at zoom `
        + `${res.zoom}. Set "Maximum zoom" to 19, try another imagery source, or `
        + 'upload an image for this hole.');
    } else {
      setStatus(`Captured ${filename} at ${res.image.width}×${res.image.height} `
        + `from ${src.label} — ${extra.join('; ')}`
        + (res.tilesBlank ? `; ${res.tilesBlank} of ${res.tilesLoaded} tiles blank` : '')
        + '.');
    }
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
    // An uploaded image carries no measurement, and without a length every
    // station on this hole becomes undrawable. Work one out now rather than
    // leaving a hole whose marshals silently refuse to appear.
    ensureHoleLength(h);
    // `name` is kept so the confirmation can still say WHICH file you chose
    // after a refresh -- the file input has already been cleared by then.
    // The bytes go to IndexedDB in the same breath, so a reload before the
    // commit no longer leaves the data pointing at a file that never existed.
    URL.revokeObjectURL(url);
    setPendingImage(key, file, h.image.src, file.name);
    /* WHY THIS DOES MORE THAN LOAD THE FILE
       -------------------------------------
       The upload always worked; it just looked like it hadn't. Stage 1 shows
       the SATELLITE map, so a freshly uploaded image changes nothing you can
       see, and the last line here used to be `e.target.value = ''` -- which
       resets the control to "No file chosen" and erases the only remaining
       evidence that anything happened. Choose a file, watch it say no file
       chosen, conclude it's broken. Reasonable conclusion; wrong.

       Clearing the input still has to happen, or picking the SAME file again
       fires no change event and re-uploading becomes impossible. So instead of
       relying on that control to report state, the state is shown properly:
       a persistent line naming the file, and a jump to stage 2, where the
       image you just uploaded is actually on screen. */
    showUploadState(h, file, probe.naturalWidth, probe.naturalHeight);
    e.target.value = '';
    markDirty(`Loaded ${file.name} (${probe.naturalWidth}×${probe.naturalHeight}). `
      + `It will be saved as ${h.image.src}. Check the T and G marks below.`);
    setStage(2);          // where the image is visible -- also calls refreshUi
  };
  probe.onerror = () => {
    setStatus(`"${file.name}" couldn't be read as an image. `
      + 'Use a .jpg, .png or .webp file.');
    URL.revokeObjectURL(url);
    e.target.value = '';
  };
  probe.src = url;
}

/* A durable record of what was uploaded, since the file input can't keep one.
   Cleared when the hole changes and rebuilt by refreshUi for whatever hole is
   selected, so it always describes the hole you're looking at. */
function showUploadState(h, file, w, ht) {
  const el = document.getElementById('upload-state');
  if (!el) return;
  if (!h || !holeHasImage(h)) { el.hidden = true; el.textContent = ''; return; }
  const key = holeKey(currentCourse, h.number);
  const pend = pendingImages[key];
  const name = (file && file.name) || (pend && pend.name) || null;

  if (pend) {
    el.innerHTML = '<strong>Loaded' + (name ? ' ' + escapeHtml(name) : '') + '</strong> — '
      + `${w || h.image.width}×${ht || h.image.height}. `
      + `Not in the repository yet; it saves as <code>${escapeHtml(h.image.src)}</code>.`;
  } else {
    el.innerHTML = `<strong>This hole already has an image</strong> — `
      + `<code>${escapeHtml(h.image.src)}</code> (${h.image.width}×${h.image.height}). `
      + 'Uploading replaces it; the marshal stations stay where they are.';
  }
  el.hidden = false;
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
  if (imgCompass) imgCompass.apply();   // frameImage changes the bearing
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

  // Shown here too, so the needle can be checked against the satellite view in
  // stage 1 before 36 holes are published with it.
  if (imgCompass) { imgCompass.el.remove(); imgCompass = null; }
  imgCompass = addCompass(imgMap, h);

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
  showUploadState(h, null);

  const noteEl = document.getElementById('imagery-note');
  if (noteEl) noteEl.textContent = imagerySource(imagerySourceKey).note;
  const sizeNote = document.getElementById('capture-size-note');
  if (sizeNote) sizeNote.textContent = captureSize(captureSizeKey).note;

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

  /* Saved on every keystroke, not just on blur. "change" only fires when the
     field loses focus, so typing the repository name and then closing the tab
     -- or the page erroring before you clicked elsewhere -- lost it. */
  ['gh-owner', 'gh-repo', 'gh-branch'].forEach(id =>
    ['input', 'change'].forEach(ev =>
      document.getElementById(id).addEventListener(ev, () => {
        ghSaveConfig(ghCfgFromForm()); updateSyncUi();
      })));

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
    if (r.branchProtected) {
      // Everything above passes and pushes are still refused -- with the same
      // 422 a race produces, which is why this is worth saying plainly.
      setSyncStatus(`Connected to ${r.repoFullName} with write access, but the `
        + `"${cfg.branch}" branch is PROTECTED. A protection rule blocks direct `
        + 'pushes, so saving will fail with "not a fast forward" no matter how '
        + 'many times you retry. Remove the rule under Settings → Branches, or '
        + 'save to an unprotected branch.', 'bad');
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

/* probeImage lives in app.js. This used to be a second copy of it here, which
   overrode that one for every caller because admin.js loads later. */

async function checkImagesReachable() {
  const refs = [];
  const local = localImages();
  ['east', 'west'].forEach(k => ((state[k] && state[k].holes) || []).forEach(h => {
    // Images still pending in this session are blobs -- always fine.
    const key = holeKey(k, h.number);
    if (h.image && h.image.src && !pendingImages[key]) {
      refs.push({ course: k, n: h.number, key,
        resolved: resolveImageSrc(h.image.src), stored: h.image.src,
        // Made here, never published, and the bytes are gone: not a path
        // problem at all, and no amount of checking capitals will help.
        orphan: !!local[key] });
    }
  }));

  // A handful is enough to tell a layout problem from a one-off missing file.
  const sample = refs.slice(0, 4);
  const broken = [];
  for (const r of sample) {
    // bust: the point is to re-check a file that may have just been committed.
    if (!(await probeImage(r.resolved, true))) broken.push(r);
  }
  imageReachability = { checked: true, broken, probed: sample.length };
  updateSyncUi();
}

function imageWarningText() {
  const r = imageReachability;
  if (!r.checked || !r.broken.length) return '';
  const b = r.broken[0];
  const allBroken = r.broken.length === r.probed;

  /* The orphan case first, because it is the one where the standard advice is
     actively misleading. The file was captured or uploaded in this browser and
     never committed, so it does not exist in the repository, on this machine,
     or anywhere else. Checking the spelling of a file that was never published
     just wastes time. */
  const orphans = r.broken.filter(x => x.orphan);
  if (orphans.length) {
    const names = orphans.map(o => `${o.course === 'east' ? 'East' : 'West'} ${o.n}`).join(', ');
    return `${orphans.length} hole image${orphans.length === 1 ? ' was' : 's were'} `
      + `created here but never saved to GitHub (${names}), and the file `
      + `${orphans.length === 1 ? 'itself is' : 'themselves are'} gone — closing the `
      + `tab before saving discards the picture, though the hole data kept `
      + `pointing at it. Nothing is wrong with the name or the path. `
      + `Upload or re-capture ${orphans.length === 1 ? 'that hole' : 'those holes'}, `
      + `and this time Save to GitHub before leaving the page.`;
  }

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

    // Committed images are no longer pending -- drop them from memory AND
    // from IndexedDB, since the repository is now the copy of record.
    images.forEach(p => {
      Object.keys(pendingImages).forEach(k => {
        if (pendingImages[k] === p) clearPendingImage(k);
      });
    });

    lastDataSha = await ghFileSha(cfg, DATA_PATH);
    unsavedChanges = false;

    /* The file now holds exactly what is on screen, so the baseline this page
       loaded is stale. Without this the conflict banner reappears against
       content we just wrote ourselves, and auto-save stays paused for the rest
       of the session. */
    fileBaseline = JSON.parse(JSON.stringify(state));
    fileBaseline.savedAt = new Date().toISOString();
    checkDraftConflict();
    const notes = [];
    if (res.rebases > 1) notes.push('the branch had moved, so it was rebuilt on the newer commit');
    if (res.waitedMs) notes.push(`GitHub took ${Math.round(res.waitedMs / 1000)}s to catch up`);
    setSyncStatus(`Saved as ${res.shortSha} — ${res.files.length} file`
      + `${res.files.length === 1 ? '' : 's'}`
      + (notes.length ? ` (${notes.join('; ')})` : '')
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
  const stamped = Object.assign({}, state, { savedAt: new Date().toISOString() });
  return '// Hole images and marshal stations.\n'
    + '// Saved from admin.html on ' + stamped.savedAt + '\n'
    + '//\n'
    + '// savedAt is read back by the admin so it can tell whether this file or\n'
    + '// a browser draft is the newer one, rather than making you guess.\n'
    + 'const HOLES_DATA = ' + JSON.stringify(stamped, null, 2) + ';\n';
}
