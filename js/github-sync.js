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
    let detail = '', body = null;
    try {
      body = await res.json();
      detail = body.message || '';
      // 422 replies carry the actual reason in errors[]; without it the
      // message alone ("Validation Failed") tells you nothing useful.
      if (Array.isArray(body.errors) && body.errors.length) {
        detail += ' — ' + body.errors.map(e =>
          [e.resource, e.field, e.code, e.message].filter(Boolean).join(' ')).join('; ');
      }
    } catch (e) { /* not JSON */ }
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
    if (res.status === 422) {
      // Most common causes, in the order they actually happen.
      let hint = '';
      if (/fast forward/i.test(detail)) {
        // By the time this surfaces, the rebase-and-retry has already run out
        // of attempts, so "try again" is not the useful advice.
        hint = ' The branch kept moving while saving, through several retries. '
             + 'That usually means another admin tab is auto-saving at the same '
             + 'time — close the other tab, then save again.';
      } else if (/tree|path|blob/i.test(detail)) {
        hint = ' A file path in the commit was rejected. Use "Show what will be saved" '
             + 'to see the exact paths being sent.';
      }
      throw ghError('unprocessable',
        `GitHub rejected the commit (422). ${detail}${hint}`, detail);
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
    await ghHead(cfg);
  } catch (err) {
    branchOk = false;
    branchMsg = `Branch "${cfg.branch}" not found.`;
  }

  /* A protected branch is the one failure the old test could not see: the
     token is valid, it has write access, the branch exists -- and every direct
     push is still rejected, with the same "not a fast forward" 422 you'd get
     from a race. Worth knowing BEFORE spending a save on it. */
  let branchProtected = false;
  if (branchOk) {
    try {
      const br = await ghApi(
        `/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`,
        { allow404: true });
      branchProtected = !!(br && br.protected);
    } catch (e) { /* not fatal -- the save will report it if it matters */ }
  }

  return {
    repoFullName: repo.full_name,
    private: !!repo.private,
    canPush,
    branchOk,
    branchMsg,
    branchProtected,
    ok: canPush && branchOk && !branchProtected
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

function ghSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Overridable so tests don't have to sit through the real backoff. */
let GH_RETRY_DELAYS = [700, 1600, 3200, 6000];
function ghSetRetryDelays(arr) { GH_RETRY_DELAYS = arr.slice(); }

function ghIsNotFastForward(err) {
  return /fast.?forward/i.test((err && err.detail || '') + ' ' + (err && err.message || ''));
}

/* Read the branch head.

   The /git/ref/ endpoint matches by PREFIX: asking for "heads/main" on a repo
   that also has "main-backup" can come back as an array of refs. Taking
   .object.sha off an array is a TypeError, and the old code did exactly that,
   so guard it and insist on an exact match. */
async function ghHead(cfg) {
  const ref = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`);
  const want = `refs/heads/${cfg.branch}`;
  const hit = Array.isArray(ref) ? ref.find(r => r.ref === want) : ref;
  if (!hit || !hit.object || !hit.object.sha) {
    throw ghError('not-found',
      `Branch "${cfg.branch}" was not found in ${cfg.owner}/${cfg.repo}. `
      + 'Check the branch name — GitHub repositories use "main" or "master".');
  }
  return hit.object.sha;
}

/* Are all these files already in the repo with exactly these bytes?
   Blob shas are content hashes, so this is an exact comparison, and it lets a
   redundant save (auto-save firing on a no-op change) skip the commit
   entirely rather than churn the branch. */
async function ghAlreadyCommitted(cfg, blobs) {
  for (const b of blobs) {
    const sha = await ghFileSha(cfg, b.path);
    if (sha !== b.sha) return false;
  }
  return true;
}

/* Commit every file in one go.

   THE 422 PROBLEM
   ---------------
   The ref update is rejected with 422 "Update is not a fast forward" in two
   quite different situations, and the earlier version of this treated them as
   one, which is why retrying never helped:

   1. The branch genuinely moved -- another tab auto-saved, or someone
      committed on github.com. The head we built on is stale, so the fix is to
      re-read the head and rebuild the commit on top of it. Nothing is lost:
      whatever the other push added stays, and our files are re-applied over it.

   2. Nothing moved at all. The Git database API is eventually consistent, and
      the replica handling the ref update has not yet seen the commit we just
      created a few hundred milliseconds earlier. It cannot prove the new
      commit descends from the current head, so it refuses. Building a *brand
      new* commit and immediately retrying -- what the old code did -- restarts
      that clock every time, which is exactly how you burn through four
      attempts in a couple of seconds and still fail.

   So: on rejection, re-read the head. If it is unchanged, this is case 2 --
   wait, and retry the ref update with the SAME commit, giving it time to
   propagate. Only if the head has actually moved do we rebuild.

   Blobs are content-addressed, so they are uploaded once and reused
   throughout. */
async function ghCommitFiles(cfg, files, message, onProgress) {
  const step = (msg) => { if (onProgress) onProgress(msg); };
  const MAX_REBASES = 4;

  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    step(`Uploading ${i + 1} of ${files.length}: ${files[i].path}`);
    blobs.push(await ghBlobFor(cfg, files[i]));
  }

  let waited = 0;   // total ms spent waiting on propagation, for the report

  for (let rebase = 1; rebase <= MAX_REBASES; rebase++) {
    step(rebase === 1
      ? 'Building the commit…'
      : `The branch moved — rebuilding on the latest commit (${rebase} of ${MAX_REBASES})…`);

    let headSha = await ghHead(cfg);
    const headCommit = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits/${headSha}`);

    const tree = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
      method: 'POST',
      body: {
        base_tree: headCommit.tree.sha,
        tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha }))
      }
    });

    const commit = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha] }
    });

    // Try to move the branch onto this commit, tolerating propagation lag.
    let moved = false;
    for (let t = 0; t <= GH_RETRY_DELAYS.length; t++) {
      try {
        step(t === 0 ? 'Moving the branch…'
                     : `Waiting for GitHub to catch up (${t} of ${GH_RETRY_DELAYS.length})…`);
        await ghApi(`/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${cfg.branch}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false }
        });
        return {
          commitSha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          files: files.map(f => f.path),
          rebases: rebase,
          waitedMs: waited,
          verified: false
        };
      } catch (err) {
        if (!ghIsNotFastForward(err)) throw err;
        if (t === GH_RETRY_DELAYS.length) break;    // give up waiting; try a rebase

        await ghSleep(GH_RETRY_DELAYS[t]);
        waited += GH_RETRY_DELAYS[t];

        const now = await ghHead(cfg);
        if (now === commit.sha) {
          // The update actually landed; the error reply beat the write.
          return {
            commitSha: commit.sha,
            shortSha: commit.sha.slice(0, 7),
            files: files.map(f => f.path),
            rebases: rebase, waitedMs: waited, verified: true
          };
        }
        if (now !== headSha) { moved = true; break; }   // genuine race -> rebase
        // else: head unchanged, so this is propagation lag -- loop and retry
        // the SAME commit rather than building another one.
      }
    }

    if (!moved && rebase === MAX_REBASES) break;
    if (!moved) {
      // Waiting didn't help and the head never moved. A rebase won't change
      // anything either, so don't burn the remaining attempts on it.
      break;
    }
  }

  // Last resort before reporting failure: did the content land anyway? A ref
  // update that times out on our side may still have been applied.
  step('Checking whether it landed anyway…');
  try {
    if (await ghAlreadyCommitted(cfg, blobs)) {
      return {
        commitSha: null, shortSha: '(already present)',
        files: files.map(f => f.path),
        rebases: 0, waitedMs: waited, verified: true
      };
    }
  } catch (e) { /* fall through to the error below */ }

  throw ghError('unprocessable',
    'GitHub would not move the branch (422 "not a fast forward"), and kept '
    + 'refusing after ' + Math.round(waited / 1000) + 's of retries even though '
    + 'the branch never moved. Nothing was lost — the files are still on this '
    + 'screen. This is usually GitHub\'s Git API lagging behind itself; waiting '
    + 'a minute and saving again normally clears it. If it persists, check that '
    + `"${cfg.branch}" is not a protected branch (Settings → Branches): a branch `
    + 'rule that requires pull requests or status checks rejects direct pushes '
    + 'with this same message.');
}
