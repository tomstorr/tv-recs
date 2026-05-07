// Drive read/write. Errors are classified so callers can route them:
//   kind="auth"               401/403 -> AUTH-5
//   kind="fileNotAccessible"  404     -> Picker prompt (drive.file deviation)
//   kind="parse"              JSON parse failure -> READ-4
//   kind="transport"          everything else      -> READ-3 / WRITE-5

const READ_URL = (id) => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
const WRITE_URL = (id) => `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`;

let getToken = () => null;
let getFileId = () => null;

export function configure({ getAccessToken, fileId }) {
  getToken = getAccessToken;
  getFileId = () => fileId;
}

function classify(resp, body) {
  if (resp.status === 401 || resp.status === 403) {
    const e = new Error(`Drive auth error: HTTP ${resp.status}`);
    e.kind = "auth"; // AUTH-5
    e.status = resp.status;
    e.body = body;
    return e;
  }
  if (resp.status === 404) {
    const e = new Error("Drive file not accessible (HTTP 404). The app may not have been granted drive.file access to this file yet.");
    e.kind = "fileNotAccessible";
    e.status = 404;
    e.body = body;
    return e;
  }
  const e = new Error(`Drive request failed: HTTP ${resp.status}`);
  e.kind = "transport";
  e.status = resp.status;
  e.body = body;
  return e;
}

function ensureToken() {
  const token = getToken();
  if (!token) {
    const e = new Error("No access token");
    e.kind = "auth";
    throw e;
  }
  return token;
}

// READ-1
export async function readFile() {
  const token = ensureToken();
  let resp;
  try {
    resp = await fetch(READ_URL(getFileId()), {
      headers: { Authorization: `Bearer ${token}` }, // READ-1
    });
  } catch (networkError) {
    const e = new Error(`Drive read failed: ${networkError.message}`); // READ-3
    e.kind = "transport";
    e.cause = networkError;
    throw e;
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw classify(resp, text); // READ-3 / AUTH-5 / fileNotAccessible
  }
  try {
    return JSON.parse(text);
  } catch (parseError) {
    const e = new Error(`Drive file is not valid JSON: ${parseError.message}`); // READ-4
    e.kind = "parse";
    e.cause = parseError;
    throw e;
  }
}

// WRITE-2
export async function writeFile(data) {
  const token = ensureToken();
  const body = JSON.stringify(data); // WRITE-3: full updated JSON in the body
  let resp;
  try {
    resp = await fetch(WRITE_URL(getFileId()), {
      method: "PATCH", // WRITE-2
      headers: {
        Authorization: `Bearer ${token}`, // WRITE-2
        "Content-Type": "application/json", // WRITE-2
      },
      body, // WRITE-3
    });
  } catch (networkError) {
    const e = new Error(`Drive write failed: ${networkError.message}`); // WRITE-5
    e.kind = "transport";
    e.cause = networkError;
    throw e;
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw classify(resp, text); // WRITE-5 / AUTH-5
  }
  // The PATCH response is file metadata (id, name) — not the body we sent.
  // The caller treats `data` (the post-mutation, tasteProfile-verified copy)
  // as the new canonical state. WRITE-6.
  return data;
}
