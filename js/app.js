// Boot orchestration and screen routing.
//
// CONFIG-1, CONFIG-4
// AUTH-1, AUTH-4, AUTH-5, AUTH-6
// READ-3, READ-4
// LIFECYCLE-1, LIFECYCLE-3, LIFECYCLE-4

import { loadConfig } from "./config-check.js";
import * as auth from "./auth.js";
import * as drive from "./drive.js";
import * as state from "./state.js";
import * as ui from "./ui.js";

let bootCompleted = false;

async function boot() {
  const cfgResult = loadConfig();
  if (!cfgResult.ok) {
    ui.renderConfigError(cfgResult); // CONFIG-1, CONFIG-4
    return;
  }
  const config = cfgResult.cfg;

  drive.configure({
    getAccessToken: () => auth.getStoredToken(), // AUTH-3 / AUTH-4
    fileId: config.DATA_FILE_ID,
    refreshSilently: () => auth.requestTokenSilently(), // AUTH-5 silent refresh
  });

  // Re-render whenever state changes.
  state.subscribe(render);

  // Cover the blank gap during auth.init — especially the OAuth callback
  // exchange (returning from Google) which is a network round trip.
  ui.renderLoading();

  await auth.init({ config, onTokenChange: render });

  bootCompleted = true;

  if (auth.getStoredToken()) {
    // AUTH-4: stored token → skip the connect screen, go straight to load.
    await tryLoad();
  } else {
    render(); // AUTH-1
  }
}

async function tryLoad() {
  ui.renderLoading(); // LIFECYCLE-1
  try {
    await state.initialLoad();
    // Successful load: state has emitted; render() has fired via subscribe.
  } catch (e) {
    if (e.kind === "fileNotAccessible") {
      // First-run case: signed in, but the app hasn't been granted drive.file
      // access to the data file yet. Show the Picker.
      ui.renderPickerPrompt(handlePickerPrompt);
    }
    // Auth and parse/transport errors are surfaced via state-driven render().
  }
}

async function handlePickerPrompt() {
  try {
    const pickedId = await auth.pickFile();
    const config = window.tvrecs_config;
    if (pickedId !== config.DATA_FILE_ID) {
      // User picked a different file. Surface clearly.
      ui.renderFetchError(
        new Error(
          `You picked a file with ID ${pickedId}, but DATA_FILE_ID in config.js is ${config.DATA_FILE_ID}. Pick the right file or update config.js.`,
        ),
        handlePickerPrompt,
      );
      return;
    }
    await tryLoad();
  } catch (e) {
    ui.renderFetchError(e, handlePickerPrompt);
  }
}

async function handleConnect() {
  try {
    await auth.requestToken(); // AUTH-2
    await tryLoad();
  } catch (e) {
    ui.renderFetchError(e, handleConnect);
  }
}

function handleSignOut() {
  // AUTH-6: clears the stored token and returns to the connect screen.
  auth.clearToken();
  state.reset();
  render();
}

async function handleRefresh() {
  // LIFECYCLE-4: manual refresh.
  try {
    await state.refresh();
  } catch (_e) {
    // state-driven render() handles auth and fetch errors.
  }
}

function render() {
  if (!bootCompleted) return;
  const s = state.getState();

  if (s.authError) {
    auth.clearToken(); // AUTH-5: clear stored token on auth error
    ui.renderReconnect(async () => {
      state.clearAuthError();
      await handleConnect();
    });
    return;
  }

  if (!auth.getStoredToken()) {
    ui.renderConnect(handleConnect); // AUTH-1
    return;
  }

  if (s.fetchError) {
    ui.renderFetchError(s.fetchError, async () => { // READ-3, READ-4
      state.clearFetchError();
      await tryLoad();
    });
    return;
  }

  if (!s.data) {
    ui.renderLoading(); // LIFECYCLE-1
    return;
  }

  ui.renderMain({
    state: s,
    onSignOut: handleSignOut,   // AUTH-6
    onRefresh: handleRefresh,   // LIFECYCLE-4
  });
  // LIFECYCLE-3: no polling/timer is started anywhere. Re-fetch happens only
  // on initialLoad, on a successful write (via runJob → performWriteOnce →
  // updates internal.data), and via handleRefresh.
}

boot().catch((e) => {
  console.error("Boot failed:", e);
  ui.renderFetchError(e, () => location.reload());
});
