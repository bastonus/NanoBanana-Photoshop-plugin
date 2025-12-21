const { app, imaging, core } = require('photoshop');
// storage is already defined in auth.js so we do not import it since we're on global scope
const { generateImageGoogle, fetchAvailableModels } = require('./googleAiSdk.js');

// Helper to get API key
async function getApiKey() {
    const localStorage = storage.secureStorage;
    const key = await localStorage.getItem('googleAiApiKey');
    if (!key) {
        const keyUint8 = await localStorage.getItem('astriaApiKey'); // Fallback check? No, strictly use new key
        // Actually user might still have old key, but we want the new one.
        return null;
    }
    return String.fromCharCode.apply(null, key);
}

async function initializeModels() {
    const select = document.getElementById('model-select');
    if (!select) return;

    // Try to fetch latest models if we have a key
    const apiKey = await getApiKey();
    if (apiKey) {
        await fetchAvailableModels(apiKey);
    }

    if (!window.GOOGLE_MODELS) return;

    // Clear existing options
    select.innerHTML = '';
    // Populate from GOOGLE_MODELS
    console.log("Populating models:", Object.keys(window.GOOGLE_MODELS));
    Object.keys(window.GOOGLE_MODELS).forEach((name, index) => {
        const opt = document.createElement('sp-menu-item');
        opt.value = name;
        opt.textContent = name;
        // Default to Nano Banana Pro or similar if available
        if (name.includes('Nano Banana Pro') || name.includes('Gemini 3 Pro') || (index === 0 && !select.value)) opt.selected = true;
        select.appendChild(opt);
    });
}

const selectedFiles = [];
// ... (Keep existing file selection logic for now if relevant for input images) ...
function renderSelectedFiles() {
    const container = document.getElementById('selected-files');
    const files = window.selectedFiles || [];
    if (!files.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = files
        .map((file, index) => (
            `<div class="file-item">
        <sp-button
          variant="primary"
          treatment="outline"
          quiet
          size="S"
          aria-label="Remove ${file.name}"
          data-action="remove"
          data-index="${index}">🗑️</sp-button>
        <sp-body class="file-name">${file.name}</sp-body>
      </div>`
        ))
        .join('');

    container.onclick = (e) => {
        const btn = e.target.closest('sp-button[data-action="remove"]');
        if (!btn) return;
        const i = parseInt(btn.getAttribute('data-index'), 10);
        const arr = (window.selectedFiles || []).slice();
        if (!Number.isNaN(i)) {
            arr.splice(i, 1);
            window.selectedFiles = arr;
            renderSelectedFiles();
        }
    };
}

document.getElementById('reference-images').addEventListener('click', async () => {
    const files = await storage.localFileSystem.getFileForOpening({
        types: storage.fileTypes.images,
        allowMultiple: true
    });
    window.selectedFiles = files;
    renderSelectedFiles();
});

// Helper: Convert Base64 to ArrayBuffer for Photoshop
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function getImageDataFromBase64(base64Data, sourceBounds) {
    let tempFile = null;
    let newDoc = null;

    try {
        const arrayBuffer = base64ToArrayBuffer(base64Data);

        const tempFolder = await storage.localFileSystem.getTemporaryFolder();
        tempFile = await tempFolder.createFile("tempImage.png", { overwrite: true });

        await tempFile.write(arrayBuffer, { format: storage.formats.binary });

        newDoc = await app.open(tempFile);
        if (!newDoc) {
            throw new Error("Photoshop failed to open the generated image.");
        }

        // Safety check for document mode
        if (newDoc.mode !== "RGB") {
            // Attempt to convert or just warn? For temp doc, we can probably try to use it.
            // But let's assume open created it correctly from png.
        }

        const firstLayer = newDoc.layers[0];

        // Fit image logic: "Cover" or "Contain" instead of stretch?
        // Current logic was: resize exact.
        // IMPROVEMENT: Maintain aspect ratio?
        // For now, sticking to resize to fill selection as per original, but user might want 'Cover'.
        // Let's implement a simple cover resize.

        // Calculate aspect ratios
        const targetWidth = sourceBounds.right - sourceBounds.left;
        const targetHeight = sourceBounds.bottom - sourceBounds.top;

        await newDoc.resizeImage(targetWidth, targetHeight); // Still stretching for now to match behavior, can improve later.

        const imgObj = await imaging.getPixels({
            layerID: firstLayer.id,
            applyAlpha: true,
        });
        return imgObj.imageData;
    } finally {
        if (newDoc) {
            await newDoc.closeWithoutSaving();
        }
        if (tempFile) {
            try {
                await tempFile.delete();
            } catch (delErr) {
                console.warn("Could not delete temporary file.", delErr);
            }
        }
    }
}

async function getSelectedFilesBlobs() {
    if (!window.selectedFiles || !window.selectedFiles.length) {
        return null;
    }
    const out = [];
    for (const file of window.selectedFiles) {
        const arrayBuffer = await file.read({ format: storage.formats.binary });
        const contentType = file.name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
        out.push(new Blob([arrayBuffer], { type: contentType }));
    }
    return out;
};

async function pasteBackImages(base64Images, sourceBounds, channelName) {
    const { batchPlay } = require('photoshop').action;

    // We need to preserve selection if we are pasting multiple images, 
    // because creating a mask usually deselects.
    // However, saving complex selection is hard. 
    // Let's just try to apply mask. 
    // If the user generates multiple, they get multiple layers. 
    // We'll trust Photoshop behavior for now or just mask the first one?
    // Actually, let's just loop.

    for (const b64 of base64Images) {
        const responseImageData = await getImageDataFromBase64(b64, sourceBounds);
        const newLayer = await app.activeDocument.layers.add();
        newLayer.name = "Generated Image " + new Date().toLocaleTimeString();
        await imaging.putPixels({
            imageData: responseImageData,
            targetBounds: sourceBounds,
            layerID: newLayer.id,
        });

        // Apply Mask & Restore Selection
        try {
            const actions = [];

            if (channelName) {
                // 1. Load Selection from Backup Channel (Reliable)
                actions.push({
                    _obj: "set",
                    _target: { _ref: "selection" },
                    to: { _ref: "channel", _name: channelName }
                });
            }

            // 2. Make Mask from Selection
            actions.push({
                _obj: "make",
                new: { _class: "channel" },
                at: { _ref: "channel", _enum: "channel", _value: "mask" },
                using: { _enum: "userMaskEnabled", _value: "revealSelection" }
            });

            if (channelName) {
                // 3. Restore Selection AGAIN (Mask consumes it, so we bring it back)
                actions.push({
                    _obj: "set",
                    _target: { _ref: "selection" },
                    to: { _ref: "channel", _name: channelName }
                });
            }

            await batchPlay(actions, {});

        } catch (e) {
            console.warn("Masking/Selection restoration failed:", e);
        }
    }
}

// 1. Capture Context (Modal)
// 1. Capture Context (Modal)
async function captureContext(executionContext, upscaleFactor = 1, useLayerOnly = false) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error("API Key not found. Please log in first.");
    }

    // Save history state to restore exactly (maintaining selection and clean layers)
    const initialHistoryState = app.activeDocument.activeHistoryState;

    // We get selection *before* doing any history messing, although getting selection doesn't change history.
    // However, if we restore history, we must be sure we have what we need.
    // getSelection returns bounds and data. Data we dispose. Bounds we keep.
    let { imageData: selectionImageData, sourceBounds: selectSourceBounds } = await imaging.getSelection({});
    if (!selectionImageData) {
        throw new Error('Please select an area to edit');
    }
    selectionImageData.dispose();

    let finalImageData;

    try {
        if (upscaleFactor > 1) {
            // --- Upscale Logic ---
            const { batchPlay } = require('photoshop').action;
            const originalActiveLayer = app.activeDocument.activeLayers[0];

            // 1. Copy (Merged or Single Layer) & Paste
            const copyCommand = useLayerOnly ? "copy" : "copyMerged";

            await batchPlay([
                { _obj: copyCommand },
                { _obj: "paste" }
            ], {});

            const tempLayer = app.activeDocument.activeLayers[0];

            // 2. Scale
            // Verify new layer created (simple check)
            if (tempLayer.id !== originalActiveLayer?.id) {
                await batchPlay([
                    {
                        _obj: "transform",
                        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                        freeTransformCenterState: { _obj: "quadCenterState", horizontal: { _enum: "horizontalLocation", _value: "center" }, vertical: { _enum: "verticalLocation", _value: "center" } },
                        width: { _unit: "percentUnit", _value: upscaleFactor * 100 },
                        height: { _unit: "percentUnit", _value: upscaleFactor * 100 },
                        linked: true
                    }
                ], {});

                // 3. Capture pixels
                const upscaledPixels = await imaging.getPixels({
                    layerID: tempLayer.id,
                    applyAlpha: true
                });
                finalImageData = upscaledPixels.imageData;
            } else {
                // Fallback (Normal capture logic, respecting layer preference)
                let params = { applyAlpha: true, sourceBounds: selectSourceBounds };
                if (useLayerOnly && originalActiveLayer) {
                    params.layerID = originalActiveLayer.id;
                }
                const px = await imaging.getPixels(params);
                finalImageData = px.imageData;
            }
        } else {
            // --- Normal Logic ---
            let pixelParams = { applyAlpha: true, sourceBounds: selectSourceBounds };

            if (useLayerOnly) {
                const activeLayer = app.activeDocument.activeLayers[0];
                if (activeLayer) {
                    pixelParams.layerID = activeLayer.id;
                }
            }

            const pixels = await imaging.getPixels(pixelParams);
            finalImageData = pixels.imageData;
        }

        const encodedImage = await imaging.encodeImageData({ "imageData": finalImageData });
        const uint8 = Uint8Array.from(encodedImage);
        const imageBlob = new Blob([uint8], { type: 'image/jpeg' });

        return {
            apiKey,
            imageBlob,
            sourceBounds: selectSourceBounds, // Always return original selection bounds for pasting
            selectionEmpty: false,
            upscaleFactor // Pass this along for the paste phase
        };

    } finally {
        if (finalImageData) {
            finalImageData.dispose();
        }
        // CRITICAL: Restore History State
        // This reverts the 'paste' (and deselect), restoring the original selection and removing temp layers.
        app.activeDocument.activeHistoryState = initialHistoryState;
    }
}

// 2. Paste Phase (Modal)
async function pastePhase(executionContext, results, sourceBounds, upscaleFactor = 1) {
    if (!results) return;

    const { batchPlay } = require('photoshop').action;
    const channelName = "NanoBanana_Temp_" + Date.now();

    try {
        // 1. Save Selection to Channel (Backup)
        // This ensures we have a robust copy of the selection regardless of paste/mask operations
        try {
            await batchPlay([
                {
                    _obj: "duplicate",
                    _target: [{ _ref: "channel", _enum: "channel", _value: "selection" }],
                    name: channelName
                }
            ], {});
            console.log("Selection saved to channel:", channelName);
        } catch (e) {
            console.warn("Failed to backup selection to channel:", e);
        }

        if (typeof results === 'string') {
            await core.showAlert("AI Response: " + results);
        } else if (Array.isArray(results)) {
            await pasteBackImages(results, sourceBounds, channelName);
        }

    } finally {
        // Cleanup: Delete the temporary channel
        try {
            await batchPlay([
                {
                    _obj: "delete",
                    _target: [{ _ref: "channel", _name: channelName }]
                }
            ], {});
        } catch (e) {
            // Channel might not exist if creation failed, ignore
        }
    }
}


// UI Event Listener
const presetManager = require('./presets.js');

document.getElementById('prompt-submit').addEventListener('click', async (event) => {
    const spinner = document.getElementById('spinner');

    try {
        // A. Gather Inputs from UI (Non-modal)
        const modelName = document.getElementById('model-select').value;
        let prompt_text = document.getElementById('prompt-input').value;

        const useForeground = document.getElementById('use-foreground')?.checked === true;
        if (useForeground) {
            prompt_text += ' #' + app.foregroundColor.rgb.hexValue;
        }

        // Append Active Presets
        const activePresets = presetManager.getAll().filter(p => p.active);
        activePresets.forEach(p => {
            prompt_text += p.content; // Append content directly
        });

        const numImagesEl = document.getElementById('variations-value'); // Now sp-number-field
        const numImages = parseInt(numImagesEl?.value || '1', 10) || 1;

        const referenceBlobs = await getSelectedFilesBlobs();

        const upscaleEl = document.getElementById('upscale-value'); // Now sp-number-field
        const upscaleFactor = parseFloat(upscaleEl?.value || '1') || 1;

        const useLayerOnly = document.getElementById('use-layer-only')?.checked === true;

        // B. Capture Context from Photoshop (Blocking)
        let contextData;
        try {
            contextData = await core.executeAsModal(
                (executionContext) => captureContext(executionContext, upscaleFactor, useLayerOnly),
                { commandName: "Preparing Generation..." }
            );
        } catch (e) {
            const errStr = e.message || String(e);
            if (errStr.includes('select an area')) {
                core.showAlert(e.message || e);
            } else {
                console.error(e);
            }
            return; // Stop if capture failed
        }

        if (!contextData) return;

        // C. Show Loading & Generate (Non-Blocking)
        const btn = document.getElementById('prompt-submit');
        const splitContainer = document.querySelector('.split-btn-container'); // Get container for animation

        if (btn) {
            // btn.disabled = true; // User requested clickable
            btn.innerHTML = `<span class="btn-text">Generating...</span> <sp-progress-circle id="spinner" size="s" indeterminate style="margin-left: 8px;"></sp-progress-circle>`;
        }
        if (splitContainer) splitContainer.classList.add('loading');

        const options = {
            num_images: numImages,
            input_image_blob: contextData.imageBlob,
            input_images: referenceBlobs
        };

        let results;
        try {
            results = await generateImageGoogle(contextData.apiKey, modelName, prompt_text, options);
            console.log("Google AI Results:", results);
        } catch (e) {
            console.error("Generation failed:", e);
            core.showAlert("Generation failed: " + e.message);
            return;
        } finally {
            if (btn) {
                // btn.disabled = false;
                btn.innerHTML = `<span class="btn-text">Generate</span> <sp-progress-circle id="spinner" size="s" indeterminate style="display:none; margin-left: 8px;"></sp-progress-circle>`;
            }
            if (splitContainer) splitContainer.classList.remove('loading');
        }

        // D. Paste Results (Blocking)
        if (results) {
            await core.executeAsModal(
                (ctx) => pastePhase(ctx, results, contextData.sourceBounds),
                { commandName: "Pasting Images..." }
            );
        } else {
            core.showAlert("No content returned from AI.");
        }

    } catch (e) {
        console.error(e);
        core.showAlert(e?.message || 'An unexpected error occurred.');
        const btn = document.getElementById('prompt-submit');
        if (btn) {
            // btn.disabled = false;
            btn.innerHTML = `<span class="btn-text">Generate</span> <sp-progress-circle id="spinner" size="s" indeterminate style="display:none; margin-left: 8px;"></sp-progress-circle>`;
        }
    }
});

// Preset UI Logic
async function initPresetsUI() {
    await presetManager.load();
    renderPresetList();

    // Toggle Add Preset Form
    const toggleAdd = document.getElementById('btn-add-new-preset');
    const addSection = document.getElementById('add-preset-section');
    const presetWrapper = document.getElementById('preset-content-wrapper');
    const presetChevronIcon = document.getElementById('preset-chevron');

    if (toggleAdd && addSection) {
        toggleAdd.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent header toggle

            // If section is collapsed, expand it first
            if (presetWrapper && presetWrapper.classList.contains('hidden')) {
                presetWrapper.classList.remove('hidden');
                if (presetChevronIcon) presetChevronIcon.classList.add('chevron-open');
            }

            addSection.classList.toggle('hidden');
            // If we just opened it, focus the name field? 
            if (!addSection.classList.contains('hidden')) {
                setTimeout(() => document.getElementById('new-preset-name')?.focus(), 50);
            }
        });
    }

    // Toggle Presets Section
    const presetHeaderToggle = document.getElementById('preset-header-toggle');
    const presetContentWrapper = document.getElementById('preset-content-wrapper');
    const presetChevron = document.getElementById('preset-chevron');

    if (presetHeaderToggle && presetContentWrapper && presetChevron) {
        presetHeaderToggle.addEventListener('click', () => {
            console.log("Preset header clicked"); // DEBUG
            presetContentWrapper.classList.toggle('hidden');
            presetChevron.classList.toggle('chevron-open');
            console.log("Preset toggle end, class list:", presetChevron.classList); // DEBUG
        });

        // Initialize: Set chevron to open position if content is visible
        if (!presetContentWrapper.classList.contains('hidden')) {
            presetChevron.classList.add('chevron-open');
        }
    }

    // Toggle Context Section
    const contextHeader = document.getElementById('context-header-toggle');
    const contextWrapper = document.getElementById('context-content-wrapper');
    const contextChevron = document.getElementById('context-chevron');

    if (contextHeader && contextWrapper && contextChevron) {
        contextHeader.addEventListener('click', () => {
            contextWrapper.classList.toggle('hidden');
            contextChevron.classList.toggle('chevron-open');
        });

        // Initialize
        if (!contextWrapper.classList.contains('hidden')) {
            contextChevron.classList.add('chevron-open');
        }
    }

    const addBtn = document.getElementById('add-preset-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const namePx = document.getElementById('new-preset-name');
            const contentPx = document.getElementById('new-preset-content');
            if (namePx.value && contentPx.value) {
                presetManager.add(namePx.value, contentPx.value);
                namePx.value = '';
                contentPx.value = '';
                renderPresetList();
                // Optionally hide form again
                if (addSection) addSection.classList.add('hidden');
            }
        });
    }
}

function renderPresetList() {
    const container = document.getElementById('preset-list');
    if (!container) return;
    container.innerHTML = '';
    const presets = presetManager.getAll();
    presets.forEach(p => {
        // Create Row Container
        const row = document.createElement('div');
        row.className = 'preset-item';

        // Main Row (Checkbox + Actions)
        const mainRow = document.createElement('div');
        mainRow.className = 'preset-row-main';

        const cbContainer = document.createElement('div');
        cbContainer.className = 'preset-checkbox-container';

        const cb = document.createElement('sp-checkbox');
        cb.textContent = p.name;
        cb.checked = p.active;
        cb.addEventListener('change', (e) => {
            presetManager.toggleActive(p.id, e.target.checked);
        });
        cbContainer.appendChild(cb);

        const actions = document.createElement('div');
        actions.className = 'preset-actions';

        // Edit Button (SVG)
        const editBtn = document.createElement('sp-action-button');
        editBtn.quiet = true;
        editBtn.size = "S";
        editBtn.innerHTML = '<svg slot="icon" viewBox="0 0 18 18" width="12" height="12"><path d="M16.5,5.5L12.5,1.5c-0.7-0.7-1.8-0.7-2.5,0L1,10.5v6h6l9-9C17.2,7.3,17.2,6.2,16.5,5.5z M6.2,15H2.5v-3.7L10,3.8L13.7,7.5L6.2,15z" fill="currentColor"/></svg>';

        // Delete Button (SVG)
        const delBtn = document.createElement('sp-action-button');
        delBtn.quiet = true;
        delBtn.size = "S";
        delBtn.innerHTML = '<svg slot="icon" viewBox="0 0 18 18" width="12" height="12"><path d="M15,3h-3.5c-0.3-1.7-1.7-3-3.5-3S4.8,1.3,4.5,3H1v2h2l1.1,11.2c0.1,1,1,1.8,2,1.8h5.9c1,0,1.9-0.8,2-1.8L15,5h2V3z M8,1c1.1,0,2,0.9,2,2H6C6,1.9,6.9,1,8,1z M12.9,16c-0.1,0.5-0.5,0.8-1,0.8H6.1c-0.5,0-0.9-0.4-1-0.8L4.1,5h9.9L12.9,16z" fill="currentColor"/></svg>';

        delBtn.addEventListener('click', () => {
            presetManager.delete(p.id);
            renderPresetList();
        });

        actions.append(editBtn, delBtn);
        mainRow.append(cbContainer, actions);
        row.appendChild(mainRow);

        // Edit Panel (Hidden primarily)
        const editPanel = document.createElement('div');
        editPanel.className = 'preset-edit-panel flex-col'; // Match container class
        Object.assign(editPanel.style, {
            display: 'none',
            // gap: '8px', // handled by freeform if you had a class
        });
        editPanel.classList.add('mt-s', 'gap-xs'); // Use classes

        const editName = document.createElement('sp-textfield');
        editName.value = p.name;
        editName.placeholder = "Name";
        editName.className = "w-full"; // Match class
        // editName.style.width = "100%"; // w-full handles this usually, but let's be safe if w-full isn't enough
        editName.style.width = "100%";

        const editContent = document.createElement('sp-textarea');
        editContent.value = p.content;
        editContent.placeholder = "Content...";
        Object.assign(editContent.style, {
            height: "60px",
            fontFamily: "adobe-clean"
        });
        editContent.className = "w-full mt-xs";

        const btnContainer = document.createElement('div');
        btnContainer.className = "flex-row";
        btnContainer.style.justifyContent = "flex-end";

        const saveEditBtn = document.createElement('sp-button');
        saveEditBtn.variant = "cta"; // Match create button variant
        saveEditBtn.innerText = "Save"; // Match create button text
        saveEditBtn.size = "s";

        saveEditBtn.addEventListener('click', () => {
            presetManager.update(p.id, { name: editName.value, content: editContent.value });
            renderPresetList();
        });

        btnContainer.appendChild(saveEditBtn);
        editPanel.append(editName, editContent, btnContainer);
        row.appendChild(editPanel);

        editBtn.addEventListener('click', () => {
            editPanel.style.display = editPanel.style.display === 'none' ? 'flex' : 'none';
        });

        container.appendChild(row);
    });
}


// -----------------------------------------------------------
// Updated Logic for standard Spectrum sp-number-field
// -----------------------------------------------------------
// No need for initNumberInputs() anymore since sp-number-field handles itself.
// We just need to ensure we read the values correctly in the submit handler.

function initPersistentUISettings() {
    const useFgCb = document.getElementById('use-foreground');
    const useLayerCb = document.getElementById('use-layer-only');

    // Load saved states
    if (useFgCb) {
        const savedFg = localStorage.getItem('nanobanana_useForeground');
        if (savedFg !== null) {
            useFgCb.checked = (savedFg === 'true');
        }
        useFgCb.addEventListener('change', (e) => {
            localStorage.setItem('nanobanana_useForeground', e.target.checked);
        });
    }

    if (useLayerCb) {
        const savedLayer = localStorage.getItem('nanobanana_useLayerOnly');
        if (savedLayer !== null) {
            useLayerCb.checked = (savedLayer === 'true');
        }
        useLayerCb.addEventListener('change', (e) => {
            localStorage.setItem('nanobanana_useLayerOnly', e.target.checked);
        });
    }
}

// -----------------------------------------------------------
// Spinner Logic
// -----------------------------------------------------------
function initSpinnerControls() {
    // 1. Button Controls (Click)
    const btns = document.querySelectorAll('.spin-btn, .split-spin-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = btn.getAttribute('data-target');
            const step = parseFloat(btn.getAttribute('data-step') || '1');
            const min = parseFloat(btn.getAttribute('data-min') || '-9999');
            const max = parseFloat(btn.getAttribute('data-max') || '9999');

            const input = document.getElementById(targetId);
            if (!input) return;

            let currentVal = parseFloat(input.value);
            if (isNaN(currentVal)) currentVal = 0; // Default fallback

            let newVal = currentVal;
            if (btn.classList.contains('up')) {
                newVal += step;
            } else {
                newVal -= step;
            }

            // Clamp
            if (newVal < min) newVal = min;
            if (newVal > max) newVal = max;

            // Handle floats (avoid precision errors like 1.5000000001)
            newVal = Math.round(newVal * 100) / 100;

            input.value = String(newVal);
        });
    });

    // 2. Keyboard Support (Arrow Keys)
    const inputs = document.querySelectorAll('sp-textfield[type="number"], #variations-value');
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault(); // Prevent native cursor move / default increment

                let step = 1;
                let min = 1;
                let max = 9999;

                // Specific constraints based on ID
                if (input.id === 'variations-value') {
                    max = 8;
                } else if (input.id === 'upscale-value') {
                    step = 0.5;
                    max = 4;
                }

                let currentVal = parseFloat(input.value);
                if (isNaN(currentVal)) currentVal = 0;

                let newVal = currentVal;
                if (e.key === 'ArrowUp') newVal += step;
                else newVal -= step;

                // Clamp
                if (newVal < min) newVal = min;
                if (newVal > max) newVal = max;

                // Handle floats
                newVal = Math.round(newVal * 100) / 100;

                input.value = String(newVal);
            }
        });
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initializeModels();
    renderSelectedFiles();
    initPresetsUI();
    initPersistentUISettings();
    initSpinnerControls();
});
