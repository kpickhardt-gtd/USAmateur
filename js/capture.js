/* ============================================================
   Stage 1 — capture a hole image from satellite tiles

   Given the tee and green as lat/lng, this composites the satellite tiles
   into a single landscape image with the hole running left-to-right, and
   reports where the tee and green ended up on that image.

   It does the projection itself rather than screenshotting the DOM, so the
   output is deterministic and independent of screen size or scroll position.

   Nothing here is required at marshal time — it only produces the image
   files. Replace the images by hand later and the rest of the app is
   unaffected.
   ============================================================ */

const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 19;      // Esri World Imagery native limit
const CAPTURE_QUALITY = 0.85;

/* Satellite imagery runs out of detail around zoom 19 (~0.3 m/pixel). A short
   par 3 stretched across 2048px would need far finer imagery than exists, so
   rather than emit a blurry upscale we shrink the output image instead. The
   FRAMING is unchanged (tee still at 8%, green at 92%, centred) -- there are
   simply fewer pixels, which is the honest result. */
const MAX_UPSCALE = 1.5;
const MIN_CAPTURE_WIDTH = 1024;

function tileUrl(template, z, x, y) {
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function loadTile(url) {
  return new Promise(resolve => {
    const img = new Image();
    // Required so the tiles can be written into a canvas we then export.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ ok: true, img });
    img.onerror = () => resolve({ ok: false, url });
    img.src = url;
  });
}

/* Work out the zoom, scale and rotation needed to draw the hole across the
   output image. Pure maths -- no network, so it's cheap to unit-test.

   Runs at most twice: if the first pass would upscale the imagery beyond
   MAX_UPSCALE, the output dimensions shrink and it recomputes. */
function captureGeometry(opts) {
  const first = captureGeometryPass(opts);
  if (first.scale <= MAX_UPSCALE) return first;

  const shrink = MAX_UPSCALE / first.scale;
  const w = Math.max(MIN_CAPTURE_WIDTH, Math.round(opts.width * shrink));
  const h = Math.round(w * opts.height / opts.width);
  const second = captureGeometryPass(Object.assign({}, opts, { width: w, height: h }));
  second.downsized = { from: [opts.width, opts.height], to: [w, h] };
  return second;
}

function captureGeometryPass(opts) {
  const W = opts.width, H = opts.height;
  const padFrac = opts.padFrac;
  const zoomNudge = opts.zoomNudge || 0;
  const bearingNudge = opts.bearingNudge || 0;

  // How long the tee->green axis should be, in output pixels.
  const desiredAxisPx = W * (1 - 2 * padFrac) * Math.pow(2, zoomNudge);

  // Axis length at zoom 0, to pick a tile zoom with enough real resolution.
  const t0 = lngLatToWorldPx(opts.tee.lat, opts.tee.lng, 0);
  const g0 = lngLatToWorldPx(opts.green.lat, opts.green.lng, 0);
  const axis0 = Math.hypot(g0.x - t0.x, g0.y - t0.y);

  // Prefer downscaling over upscaling: round the zoom UP.
  let zoom = Math.ceil(Math.log2(desiredAxisPx / axis0));
  zoom = Math.max(0, Math.min(MAX_TILE_ZOOM, zoom));

  const tee = lngLatToWorldPx(opts.tee.lat, opts.tee.lng, zoom);
  const green = lngLatToWorldPx(opts.green.lat, opts.green.lng, zoom);
  const axisPx = Math.hypot(green.x - tee.x, green.y - tee.y);
  const scale = desiredAxisPx / axisPx;

  // Rotate so the axis points along +x, then apply the manual nudge.
  const axisAngle = Math.atan2(green.y - tee.y, green.x - tee.x);
  const theta = -axisAngle + (bearingNudge * Math.PI / 180);

  const mid = { x: (tee.x + green.x) / 2, y: (tee.y + green.y) / 2 };

  // Forward transform: world pixel -> output pixel.
  const cos = Math.cos(theta), sin = Math.sin(theta);
  function toOutput(p) {
    const dx = (p.x - mid.x) * scale, dy = (p.y - mid.y) * scale;
    return { x: W / 2 + dx * cos - dy * sin, y: H / 2 + dx * sin + dy * cos };
  }
  // Inverse: output pixel -> world pixel (used to find which tiles we need).
  function toWorld(p) {
    const dx = p.x - W / 2, dy = p.y - H / 2;
    const rx = dx * cos + dy * sin, ry = -dx * sin + dy * cos;
    return { x: mid.x + rx / scale, y: mid.y + ry / scale };
  }

  // Bounding box of the output rectangle back in world space.
  const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }].map(toWorld);
  const minX = Math.min(...corners.map(c => c.x));
  const maxX = Math.max(...corners.map(c => c.x));
  const minY = Math.min(...corners.map(c => c.y));
  const maxY = Math.max(...corners.map(c => c.y));

  const nTiles = Math.pow(2, zoom);
  const range = {
    x0: Math.floor(minX / TILE_SIZE), x1: Math.floor(maxX / TILE_SIZE),
    y0: Math.floor(minY / TILE_SIZE), y1: Math.floor(maxY / TILE_SIZE)
  };

  return {
    width: W, height: H, zoom, scale, theta, mid, nTiles, range,
    toOutput, toWorld,
    teeOut: toOutput(tee), greenOut: toOutput(green),
    lengthYards: metersToYards(geoDistanceMeters(opts.tee, opts.green)),
    downsized: null
  };
}

/* Composite the tiles and hand back a JPEG blob plus the image metadata
   that stage 2 needs. */
async function captureHoleImage(opts) {
  const geo = captureGeometry({
    tee: opts.tee, green: opts.green,
    width: opts.width || CAPTURE_WIDTH,
    height: opts.height || CAPTURE_HEIGHT,
    padFrac: opts.padFrac === undefined ? CAPTURE_PAD_FRAC : opts.padFrac,
    zoomNudge: opts.zoomNudge, bearingNudge: opts.bearingNudge
  });

  const canvas = document.createElement('canvas');
  canvas.width = geo.width;
  canvas.height = geo.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a4a3f';
  ctx.fillRect(0, 0, geo.width, geo.height);

  // Gather every tile the output rectangle touches.
  const jobs = [];
  for (let ty = geo.range.y0; ty <= geo.range.y1; ty++) {
    for (let tx = geo.range.x0; tx <= geo.range.x1; tx++) {
      if (ty < 0 || ty >= geo.nTiles) continue;
      const wrapped = ((tx % geo.nTiles) + geo.nTiles) % geo.nTiles;
      jobs.push({ tx, ty, url: tileUrl(opts.tileUrl || SATELLITE_TILE_URL, geo.zoom, wrapped, ty) });
    }
  }
  if (jobs.length > 400) {
    throw new Error(`Capture would need ${jobs.length} tiles — check the tee and green pins.`);
  }

  const results = await Promise.all(jobs.map(j => loadTile(j.url).then(r => ({ ...j, ...r }))));

  ctx.save();
  ctx.translate(geo.width / 2, geo.height / 2);
  ctx.rotate(geo.theta);
  ctx.scale(geo.scale, geo.scale);
  ctx.translate(-geo.mid.x, -geo.mid.y);
  ctx.imageSmoothingQuality = 'high';
  let loaded = 0, failed = 0;
  results.forEach(r => {
    if (!r.ok) { failed++; return; }
    loaded++;
    // +1px overdraw kills hairline seams between tiles after scaling.
    ctx.drawImage(r.img, r.tx * TILE_SIZE, r.ty * TILE_SIZE, TILE_SIZE + 1, TILE_SIZE + 1);
  });
  ctx.restore();

  // Exporting throws if any tile came from a server that didn't allow it.
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned nothing')),
                    'image/jpeg', CAPTURE_QUALITY);
    });
  } catch (err) {
    const e = new Error(
      'The satellite tiles could not be written into an image because the tile '
      + 'server did not send permission (CORS). Capture is blocked — but you can '
      + 'still use "Upload an image" to supply the hole image yourself.');
    e.cause = err;
    e.corsBlocked = true;
    throw e;
  }

  return {
    blob,
    tilesLoaded: loaded,
    tilesFailed: failed,
    zoom: geo.zoom,
    scale: geo.scale,
    downsized: geo.downsized,
    lengthYards: geo.lengthYards,
    image: {
      width: geo.width,
      height: geo.height,
      tee:   { x: geo.teeOut.x / geo.width,   y: geo.teeOut.y / geo.height },
      green: { x: geo.greenOut.x / geo.width, y: geo.greenOut.y / geo.height }
    }
  };
}
