const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/';

// Fallback/Default models if listing fails
let MODEL_IDS = {
    "Nano Banana Pro": "models/gemini-3-pro-image-preview",
    "Nano Banana": "models/gemini-2.5-flash-image",
    "Imagen 3": "models/imagen-3.0-generate-001",
    "Imagen 3 Fast": "models/imagen-3.0-fast-generate-001",
};

// Expose for main.js to populate dropdown
window.GOOGLE_MODELS = MODEL_IDS;
window.GOOGLE_TEXT_MODELS = {
    "Gemini 2.0 Flash": "models/gemini-2.0-flash-exp",
    "Gemini 1.5 Pro": "models/gemini-1.5-pro-latest",
    "Gemini 1.5 Flash": "models/gemini-1.5-flash-latest",
};

async function fetchAvailableModels(apiKey) {
    try {
        const response = await fetch(`${BASE_URL}models?key=${apiKey}`);
        if (!response.ok) return null;
        const data = await response.json();
        if (data.models) {
            const models = {};
            const textModels = {};
            data.models.forEach(m => {
                const name = m.name.toLowerCase();
                // Filter for Image Generation models only
                // Whitelist: 'imagen', '-image-' (covers gemini-*-image-*)
                if (name.includes('imagen') || name.includes('-image-')) {
                    // key is display name, value is resource name (models/...)
                    let displayName = m.displayName || m.name.split('/').pop();
                    models[displayName] = m.name;
                } else if (name.includes('gemini') && !name.includes('vision')) {
                    // Text models (approximate filter, excludes vision-only if any)
                    let displayName = m.displayName || m.name.split('/').pop();
                    // Prefer cleaner names
                    displayName = displayName.replace('models/', '');
                    textModels[displayName] = m.name;
                }
            });
            // Update global and local map
            MODEL_IDS = { ...MODEL_IDS, ...models };
            window.GOOGLE_MODELS = MODEL_IDS;
            window.GOOGLE_TEXT_MODELS = { ...window.GOOGLE_TEXT_MODELS, ...textModels };
            return { image: models, text: window.GOOGLE_TEXT_MODELS };
        }
    } catch (e) {
        console.warn("Failed to fetch models:", e);
    }
    return null;
}

async function generateImageGoogle(apiKey, modelName, prompt, options = {}) {
    // Look up model ID from all available model maps
    const modelId = MODEL_IDS[modelName]
        || window.GOOGLE_MODELS[modelName]
        || window.GOOGLE_TEXT_MODELS[modelName]
        || modelName;

    // Distinguish between Image Generation (Imagen) and Text/Multimodal (Gemini)
    // This helps if we need different endpoints.
    // For now, assuming standard Imagen endpoint for "Imagen" models and generateContent for "Gemini"

    if (modelId.includes('imagen')) {
        return generateImagen(apiKey, modelId, prompt, options);
    } else {
        // Gemini typically generates text, but if user wants image output from Gemini,
        // it usually means describing an image or using a tool.
        // However, if the user thinks "Gemini" generates images directly like generic SD,
        // they might be referring to the integration.
        // For this SDK, we'll assume Gemini calls are for text-to-text or image-analysis
        // UNLESS the user explicitly wants image generation.
        // Given the previous plugin was for Image Generation (Flux), let's assume they want Imagen for generation.
        // If they select "Gemini", maybe they want to refine the prompt?
        // Let's implement generateContent for Gemini for now.
        return generateGemini(apiKey, modelId, prompt, options);
    }
}

async function generateImagen(apiKey, modelId, prompt, options) {
    const url = `${BASE_URL}${modelId}:predict?key=${apiKey}`;

    // Construct payload for Imagen
    // Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/imagen-api
    const payload = {
        instances: [
            {
                prompt: prompt
            }
        ],
        parameters: {
            sampleCount: options.num_images || 1,
            // aspectRatio: "1:1" // Optional
        }
    };

    if (options.input_image_blob) {
        // If we have an input image (sketch/edit), Imagen supports it but payload structure varies (edit vs generate).
        // For simplification, we'll stick to text-to-image unless input_image is handled.
        // This is a placeholder for basic txt2img.
    }

    // Wrap Imagen call with retry logic
    const attemptImagenCall = async () => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google AI API Error(${response.status}): ${errorText} `);
        }

        const data = await response.json();

        // Parse result. Imagen usually returns base64 bytes.
        // Structure: { predictions: [ { bytesBase64Encoded: "..." } ] }
        if (data.predictions && data.predictions.length > 0) {
            return data.predictions.map(pred => pred.bytesBase64Encoded || pred);
        }
        throw new Error("No predictions returned from Google AI.");
    };

    // Use retry logic for Imagen as well
    try {
        return await retryWithBackoff(attemptImagenCall, 3, 1000);
    } catch (error) {
        console.error("Imagen generation failed after retries:", error.message);
        throw error;
    }
}

// Helper: Retry with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, attempt);
                console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

async function generateGemini(apiKey, modelId, prompt, options) {
    const url = `${BASE_URL}${modelId}:generateContent?key=${apiKey}`;
    const targetCount = options.num_images || 1;
    const onProgress = options.onProgress || (() => { });

    // Helper to make a single request with retry (candidateCount = 1)
    const generateSingleWithRetry = async (index) => {
        const attemptGeneration = async () => {
            const payload = {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    candidateCount: 1
                }
            };

            // Add image input if present (for image editing/analysis)
            if (options.input_image_blob) {
                // Convert blob to base64
                const base64Data = await blobToBase64(options.input_image_blob);
                payload.contents[0].parts.push({
                    inline_data: {
                        mime_type: options.input_image_blob.type,
                        data: base64Data
                    }
                });
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`Gemini API Error (${response.status}): ${errorText}`);
                error.status = response.status;
                throw error;
            }

            const data = await response.json();

            if (data.candidates && data.candidates.length > 0) {
                const parts = data.candidates[0].content.parts;
                for (const part of parts) {
                    const inlineData = part.inline_data || part.inlineData;
                    if (inlineData && inlineData.data) {
                        return { type: 'image', data: inlineData.data, index };
                    }
                }
                if (parts[0].text) return { type: 'text', data: parts[0].text, index };
            }
            throw new Error('No valid response from Gemini API');
        };

        try {
            const result = await retryWithBackoff(attemptGeneration, 3, 1000);
            onProgress(index + 1, targetCount, 'success');
            return result;
        } catch (error) {
            console.error(`Failed to generate image ${index + 1}/${targetCount}:`, error.message);
            onProgress(index + 1, targetCount, 'error', error);
            return { type: 'error', error, index };
        }
    };

    // Run parallel requests with Promise.allSettled for partial success
    console.log(`Starting ${targetCount} parallel generations with retry logic...`);
    const promises = Array.from({ length: targetCount }, (_, i) => generateSingleWithRetry(i));
    const results = await Promise.allSettled(promises);

    // Aggregate results
    const images = [];
    const errors = [];
    let textFallback = null;

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            const res = result.value;
            if (res.type === 'image') {
                images.push(res.data);
            } else if (res.type === 'text') {
                textFallback = res.data;
            } else if (res.type === 'error') {
                errors.push({ index, error: res.error });
            }
        } else {
            // Promise was rejected (shouldn't happen with our error handling, but just in case)
            errors.push({ index, error: result.reason });
        }
    });

    console.log(`Generation complete: ${images.length} successful, ${errors.length} failed out of ${targetCount} total.`);

    // Handle partial success
    if (images.length > 0) {
        if (errors.length > 0) {
            console.warn(`Partial success: ${images.length}/${targetCount} images generated. ${errors.length} failed.`);
            // Attach metadata about partial success
            images._partialSuccess = true;
            images._successCount = images.length;
            images._totalCount = targetCount;
            images._failureCount = errors.length;
        }
        return images;
    }

    // Complete failure
    if (textFallback) return textFallback;

    // Throw error with details about all failures
    const errorMsg = errors.length > 0
        ? `All ${targetCount} generation attempts failed. First error: ${errors[0].error.message}`
        : `No content generated from ${targetCount} attempts.`;
    throw new Error(errorMsg);
}

function blobToBase64(blob) {
    return blob.arrayBuffer().then(buffer => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    });
}

module.exports = {
    generateImageGoogle,
    fetchAvailableModels,
    MODEL_IDS
};
