/* ============================================================
   Save straight to GitHub from the admin page

   Replaces the download-then-upload loop: the admin commits
   js/holes-data.js plus any new hole images directly to the repo, and
   GitHub Pages redeploys itself a minute later.

   WHY THIS SHAPE
   --------------
   The marshal pages stay exactly as they are: plain static files with no
   API call at page load. That is deliberate -- on a crowded course, a page
   that needs a live service is a page that fails. Only the admin talks to
   GitHub, and only while you're setting things up.

   Everything is committed in ONE commit via the Git data API (blobs -> tree
   -> commit -> move the branch ref) rather than one commit per file, so 36
   images and the data file land together and the history stays readable.

   THE TOKEN
   ---------
   A fine-grained personal access token with **Contents: Read and write** on
   this one repository. It is held in your browser only -- never written into
   any file this tool exports, and never committed. Treat it like a password:
   anyone who has it can write to the repo.
   ============================================================ */

const GH_CFG_KEY = 'oakhill_gh_config_v1';   // owner/repo/branch (not secret)
const GH_TOKEN_KEY = 'oakhill_gh_token_v1';  // the token, kept separately

/* Overridable so the commit sequence can be tested against a stand-in
   server. Left alone it talks to the real GitHub. */
let GH_API_BASE = 'https://api.github.com';
function ghSetApiBase(url) { GH_API_BASE = url.replace(/\/$/, ''); }

/* ---------- configuration ---------- */

/* On a Pages URL like https://user.github.io/oak-hill-marshals/ we can work
   out the repo without being told. */
function ghGuessRepo() {
  const host = location.hostname || '';
  const m = host.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const owner = m[1];
  const seg = location.pathname.split('/').filter(Boolean);
  // A project site lives under /repo/; a user site is the repo itself.
  return { owner, repo: seg.length ? seg[0] : `${owner}.github.io` };
}

function ghLoadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(GH_CFG_KEY) || '{}'); } catch (e) { saved = {}; }
  const guess = ghGuessRepo() || {};
  return {
    owner: saved.owner || guess.owner || '',
    repo: saved.repo || guess.repo || '',
    branch: saved.branch || 'main',
    autoSave: saved.autoSave !== false
  };
}

function ghSaveConfig(cfg) {
  try {
    localStorage.setItem(GH_CFG_KEY, JSON.stringify({
      owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, autoSave: cfg.autoSave
    }));
  } catch (e) { /* storage unavailable */ }
}

/* The token lives in sessionStorage by default so closing the tab forgets it.
   "Remember on this device" promotes it to localStorage. */
function ghGetToken() {
  try {
    return sessionStorage.getItem(GH_TOKEN_KEY) || localStorage.getItem(GH_TOKEN_KEY) || '';
  } catch (e) { return ''; }
}

function ghSetToken(token, remember) {
  try {
    sessionStorage.removeItem(GH_TOKEN_KEY);
    localStorage.removeItem(GH_TOKEN_KEY);
    if (!token) return;
    (remember ? localStorage : sessionStorage).setItem(GH_TOKEN_KEY, token);
  } catch (e) { /* storage unavailable */ }
}

function ghTokenRemembered() {
  try { return !!localStorage.getItem(GH_TOKEN_KEY); } catch (e) { return false; }
}

function ghForgetToken() { ghSetToken('', false); }

/* ---------- API plumbing ---------- */

async function ghApi(path, opts) {
  opts = opts || {};
  const token = ghGetToken();
  if (!token) throw ghError('no-token', 'No access token has been entered yet.');

  let res;
  try {
    res = await fetch(GH_API_BASE + path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch (err) {
    // fetch only rejects for network/CORS failures, never for HTTP errors
    throw ghError('network',
      'Could not reach GitHub. Check your internet connection, and any network '
      + 'that might block api.github.com.', err);
  }

  if (res.status === 404 && opts.allow404) return null;

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (e) { /* not JSON */ }
    if (res.status === 401) {
      throw ghError('bad-token', 'GitHub rejected the token (401). It may be wrong, '
        + 'expired, or revoked.', detail);
    }
    if (res.status === 403) {
      throw ghError('forbidden', 'GitHub refused the request (403). The token most '
        + 'likely lacks "Contents: Read and write" on this repository.', detail);
    }
    if (res.status === 404) {
      throw ghError('not-found', 'Repository or branch not found (404). Check the '
        + 'owner, repository name and branch — and that the token grants access to it.', detail);
    }
    if (res.status === 409) {
      throw ghError('conflict', 'The branch moved while saving (409). Try saving again.', detail);
    }
    throw ghError('http-' + res.status, `GitHub returned ${res.status}. ${detail}`, detail);
  }

  return res.status === 204 ? null : res.json();
}

function ghError(code, message, detail) {
  const e = new Error(message);
  e.code = code;
  e.detail = detail;
  return e;
}

/* ---------- connection test ---------- */

/* Answers the only question that matters before you rely on this: can this
   browser actually write to that repo with that token? */
async function ghTestConnection(cfg) {
  const repo = await ghApi(`/repos/${cfg.owner}/${cfg.repo}`);
  const perms = repo.permissions || {};
  const canPush = perms.push === true || perms.admin === true;

  let branchOk = true, branchMsg = '';
  try {
    await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`);
  } catch (err) {
    branchOk = false;
    branchMsg = `Branch "${cfg.branch}" not found.`;
  }

  return {
    repoFullName: repo.full_name,
    private: !!repo.private,
    canPush,
    branchOk,
    branchMsg,
    ok: canPush && branchOk
  };
}

/* ---------- committing ---------- */

function ghB64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Chunked: fromCharCode(...wholeArray) blows the stack on large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function ghB64FromText(text) {
  // Handles non-ASCII (hole labels may contain anything) before base64.
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

async function ghBlobFor(cfg, file) {
  const content = file.blob
    ? ghB64FromArrayBuffer(await file.blob.arrayBuffer())
    : ghB64FromText(file.text);
  const res = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
    method: 'POST',
    body: { content, encoding: 'base64' }
  });
  return { path: file.path, sha: res.sha };
}

/* Current sha of a file in the repo, or null if it isn't there yet.
   Used to notice that something else changed the data file since we loaded. */
async function ghFileSha(cfg, path) {
  const res = await ghApi(
    `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`,
    { allow404: true });
  return res && res.sha ? res.sha : null;
}

/* Commit every file in one go. Returns { commitSha, url, files }. */
async function ghCommitFiles(cfg, files, message, onProgress) {
  const step = (msg) => { if (onProgress) onProgress(msg); };

  step('Reading the branch…');
  const ref = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`);
  const headSha = ref.object.sha;

  const headCommit = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits/${headSha}`);
  const baseTree = headCommit.tree.sha;

  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    step(`Uploading ${i + 1} of ${files.length}: ${files[i].path}`);
    blobs.push(await ghBlobFor(cfg, files[i]));
  }

  step('Building the commit…');
  const tree = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: baseTree,
      tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha }))
    }
  });

  const commit = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [headSha] }
  });

  step('Moving the branch…');
  await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${cfg.branch}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false }
  });

  return {
    commitSha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    files: files.map(f => f.path)
  };
}
