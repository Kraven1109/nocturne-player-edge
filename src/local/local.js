import {
  onSettingsChanged,
  readSettings,
  writeSettings,
} from '../lib/settings.js';
import { createSession } from '../content/session.js';

const PERSIST_DELAY_MS = 400;

const fileInput = document.getElementById('file-input');
const reopenButton = document.getElementById('reopen');
const statusLine = document.getElementById('status');
const stageBox = document.getElementById('stage-box');
const video = document.getElementById('video');

let currentUrl = null;
let session = null;
let settings = null;
let persistTimer = null;
let loadSeq = 0;

const persist = (patch) => {
  settings = { ...settings, ...patch };
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeSettings(patch);
  }, PERSIST_DELAY_MS);
};

const revokeCurrentUrl = () => {
  if (currentUrl === null) return;
  URL.revokeObjectURL(currentUrl);
  currentUrl = null;
};

const launchSession = async () => {
  if (session !== null || video.videoWidth === 0) return;
  if (settings === null) settings = await readSettings();
  session = createSession(video, {
    settings,
    onPersist: persist,
    onExit: () => {
      session = null;
    },
  });
  await session.enter();
};

const clearMedia = () => {
  if (session !== null) {
    session.exit();
    session = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
  revokeCurrentUrl();
  stageBox.hidden = true;
  reopenButton.hidden = true;
};

const openFile = (file) => {
  loadSeq += 1;
  const seq = loadSeq;
  clearMedia();

  const objectUrl = URL.createObjectURL(file);
  currentUrl = objectUrl;
  statusLine.textContent = `Loading ${file.name}…`;

  let onLoaded = null;
  let onError = null;

  const cleanListeners = () => {
    video.removeEventListener('loadedmetadata', onLoaded);
    video.removeEventListener('error', onError);
  };

  onLoaded = () => {
    cleanListeners();
    if (seq !== loadSeq) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      clearMedia();
      statusLine.textContent = 'Audio-only files are not supported.';
      return;
    }
    stageBox.hidden = false;
    reopenButton.hidden = false;
    statusLine.textContent = file.name;
    launchSession().catch((error) => {
      console.error('Nocturne: failed to launch local player', error);
    });
  };

  onError = () => {
    cleanListeners();
    if (seq !== loadSeq) return;
    clearMedia();
    statusLine.textContent = 'Could not play this video format in Edge.';
  };

  video.addEventListener('loadedmetadata', onLoaded);
  video.addEventListener('error', onError);
  video.src = objectUrl;
};

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) openFile(file);
});

reopenButton.addEventListener('click', () => {
  launchSession().catch((error) => {
    console.error('Nocturne: failed to reopen local player', error);
  });
});

window.addEventListener('pagehide', clearMedia);

const init = async () => {
  settings = await readSettings();
  onSettingsChanged((next) => {
    settings = next;
  });
};

init().catch((error) => {
  console.error('Nocturne: local player initialization failed', error);
});
