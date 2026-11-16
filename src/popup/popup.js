import {
  isHostEnabled,
  readSettings,
  resetSettings,
  setHostEnabled,
} from '../lib/settings.js';
import { clearIntroStore } from '../lib/introstore.js';

const hostLabel = document.getElementById('site-host');
const enabledToggle = document.getElementById('site-enabled');
const statusLine = document.getElementById('status');
const resetButton = document.getElementById('reset');

const readActiveTab = async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs.length > 0 ? tabs[0] : null;
};

const readHost = (tab) => {
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { key: url.host, label: url.host };
    }
    if (url.protocol === 'file:') {
      return { key: 'file:', label: 'Local files (file://)' };
    }
    return null;
  } catch (error) {
    console.error('Nocturne: unreadable tab url', error);
    return null;
  }
};

const describeVideo = async (tab, host) => {
  if (!tab) return 'No page to inspect.';
  try {
    const state = await browser.tabs.sendMessage(tab.id, {
      type: 'query-state',
    });
    if (state?.videoCount > 0) {
      const plural = state.videoCount === 1 ? 'video' : 'videos';
      return `${state.videoCount} ${plural} detected on this page.`;
    }
    return 'No video detected on this page yet.';
  } catch {
    if (host?.key === 'file:') {
      return 'Not active — allow file URLs in edge://extensions.';
    }
    return 'Not active on this page.';
  }
};

const render = async () => {
  const tab = await readActiveTab();
  const host = readHost(tab);
  const settings = await readSettings();

  if (host === null) {
    hostLabel.textContent = 'unsupported page';
    enabledToggle.checked = false;
    enabledToggle.disabled = true;
  } else {
    hostLabel.textContent = host.label;
    enabledToggle.checked = isHostEnabled(settings, host.key);
    enabledToggle.disabled = false;
    enabledToggle.onchange = () =>
      setHostEnabled(host.key, enabledToggle.checked);
  }

  statusLine.textContent = await describeVideo(tab, host);
};

// A reset forgets the learned openings too: it is the one button that puts
// the add-on back the way it was installed.
resetButton.addEventListener('click', async () => {
  await resetSettings();
  await clearIntroStore();
  await render();
  statusLine.textContent = 'Settings and learned intros reset.';
});

render();
