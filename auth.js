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
  // document.getElementById('cancel-auth').style.display = 'none'; // Removed
  const signoutBtn = document.getElementById('signout');
  if (signoutBtn) signoutBtn.textContent = 'Change';
}

async function signout() {
  const btn = document.getElementById('signout');
  const authSection = document.getElementById('auth');
  const mainSection = document.getElementById('main');

  // Check if we are currently editing (Auth section is visible)
  const isEditing = !authSection.classList.contains('hidden');

  if (isEditing) {
    // "Keep this key" clicked -> Act as Cancel
    // Just re-initialize to restore state from storage
    await initializeAuth();
  } else {
    // "Change" clicked -> Act as Switch to Edit Mode
    console.log("Change Key clicked. Switching view...");
    mainSection.classList.add('hidden');
    authSection.classList.remove('hidden');
    btn.textContent = "Keep this key";

    // Clear input for new key entry
    document.getElementById('api-key-input').value = '';
  }
}

// async function cancelAuth() { ... } // Removed

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

  // const cancelBtn = document.getElementById('cancel-auth');
  // if (cancelBtn) cancelBtn.addEventListener('click', cancelAuth);

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
