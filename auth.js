const { shell } = require('uxp');
const { storage } = require('uxp');
const secureStore = storage.secureStorage;

LOCAL_STORAGE_API_KEY = 'googleAiApiKey'
async function initializeAuth() {
  let apiKey = await secureStore.getItem(LOCAL_STORAGE_API_KEY);
  const hasKey = !!apiKey;
  document.getElementById('auth').classList.toggle('hidden', hasKey);
  document.getElementById('signout').classList.toggle('hidden', !hasKey); // Actually this button is in main, so if main is hidden, it's hidden. But wait, signout is the Change Key button.
  document.getElementById('main').classList.toggle('hidden', !hasKey);

  // Reset Cancel button visibility (always hidden on init unless manually triggered)
  document.getElementById('cancel-auth').style.display = 'none';
}

async function signout() {
  console.log("Change Key clicked. Switching view...");
  // "Change Key" clicked. Do NOT delete yet. Just show UI.
  document.getElementById('main').classList.add('hidden');
  document.getElementById('auth').classList.remove('hidden');

  // Show Cancel button because we have a key (implied by being able to click signout)
  const cancelBtn = document.getElementById('cancel-auth');
  if (cancelBtn) {
    console.log("Showing Cancel button");
    cancelBtn.style.display = 'inline-block'; // Try inline-block for sp-button
    cancelBtn.classList.remove('hidden'); // Just in case
  } else {
    console.error("Cancel button not found!");
  }

  // Optional: Pre-fill input? No, security.
  document.getElementById('api-key-input').value = '';
}

async function cancelAuth() {
  // User decided not to change key. Restore main view.
  await initializeAuth();
}

async function submitAuth() {
  const apiKey = document.getElementById('api-key-input').value;
  if (apiKey) {
    await secureStore.setItem(LOCAL_STORAGE_API_KEY, apiKey);
    initializeAuth();
  }
}
// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeAuth();

  const signoutBtn = document.getElementById('signout');
  if (signoutBtn) signoutBtn.addEventListener('click', signout);

  const cancelBtn = document.getElementById('cancel-auth');
  if (cancelBtn) cancelBtn.addEventListener('click', cancelAuth);

  // document.getElementById('api-key-form').addEventListener('submit', submitAuth)
  const submitBtn = document.getElementById('submit-auth');
  if (submitBtn) submitBtn.addEventListener('click', submitAuth);

  const openAstriaBtn = document.getElementById('open-astria');
  if (openAstriaBtn) {
    openAstriaBtn.addEventListener('click', function (e) {
      e.preventDefault();
      shell.openExternal("https://aistudio.google.com/app/apikey");
    });
  }
});
