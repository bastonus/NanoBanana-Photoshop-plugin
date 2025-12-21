const { storage, core } = require('photoshop');

async function getApiKey() {
  const localStorage = storage.secureStorage;
  const key = await localStorage.getItem('googleAiApiKey');
  return key ? String.fromCharCode.apply(null, key) : null;
}

async function saveApiKey(key) {
  if (!key) return;
  const localStorage = storage.secureStorage;
  await localStorage.setItem('googleAiApiKey', key);
}

// Simple Signout (Changes View to Auth, but doesn't delete key yet)
function signout() {
  console.log("Change Key clicked. Switching view...");
  const mainSection = document.getElementById('main');
  const authSection = document.getElementById('auth');
  const footerApi = document.getElementById('api-management-section');

  // Existing key controls (New feature)
  const existingControls = document.getElementById('existing-key-controls');

  // Toggle Views
  if (mainSection) mainSection.classList.add('hidden');
  if (footerApi) footerApi.classList.add('hidden');
  if (authSection) authSection.classList.remove('hidden');

  // Show "Use Saved Key" button because we are coming from a signed-in state
  if (existingControls) {
    existingControls.classList.remove('hidden');
  }
}

async function restoreMainView() {
  // Just re-run initialization essentially, or manually toggle
  // Reloading is safest to ensure state is clean
  location.reload();
}

// Init Auth UI
window.addEventListener('DOMContentLoaded', async () => {
  const apiKey = await getApiKey();
  const hasKey = !!apiKey;

  const authSection = document.getElementById('auth');
  const mainSection = document.getElementById('main');
  const footerApi = document.getElementById('api-management-section');

  // Elements
  const apiKeyInput = document.getElementById('api-key-input');
  const submitBtn = document.getElementById('submit-auth');
  const signoutBtn = document.getElementById('signout');
  const openAstriaBtn = document.getElementById('open-astria');

  // New Feature Elements
  const existingControls = document.getElementById('existing-key-controls');
  const useExistingBtn = document.getElementById('use-existing-key');

  if (hasKey) {
    // Logged In
    if (authSection) authSection.classList.add('hidden');
    if (mainSection) mainSection.classList.remove('hidden');
    if (footerApi) footerApi.classList.remove('hidden');
  } else {
    // Logged Out
    if (authSection) authSection.classList.remove('hidden');
    if (mainSection) mainSection.classList.add('hidden');
    if (footerApi) footerApi.classList.add('hidden');
  }

  // Default existing controls to hidden on load (unless we trigger signout)
  if (existingControls) existingControls.classList.add('hidden');


  // Handlers
  if (submitBtn) {
    submitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const key = apiKeyInput.value.trim();
      if (key) {
        await saveApiKey(key);
        location.reload();
      } else {
        core.showAlert("Please enter a valid API Key");
      }
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', signout);
  }

  // Use Saved Key Handler
  if (useExistingBtn) {
    useExistingBtn.addEventListener('click', () => {
      restoreMainView();
    });
  }

  if (openAstriaBtn) {
    openAstriaBtn.addEventListener('click', () => {
      require('uxp').shell.openExternal("https://aistudio.google.com/app/apikey");
    });
  }
});
