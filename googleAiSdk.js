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

async function fetchAvailableModels(apiKey) {
    try {
        const response = await fetch(`${BASE_URL}models?key=${apiKey}`);
        if (!response.ok) return null;
        const data = await response.json();
        if (data.models) {
            const models = {};
            data.models.forEach(m => {
                const name = m.name.toLowerCase();
                // Filter for Image Generation models only
                // Whitelist: 'imagen', '-image-' (covers gemini-*-image-*)
                if (name.includes('imagen') || name.includes('-image-')) {
                    // key is display name, value is resource name (models/...)
                    let displayName = m.displayName || m.name.split('/').pop();
                    models[displayName] = m.name;
                }
            });
            // Update global and local map
            MODEL_IDS = { ...MODEL_IDS, ...models };
            window.GOOGLE_MODELS = MODEL_IDS;
            return models;
        }
    } catch (e) {
        console.warn("Failed to fetch models:", e);
    }
    return null;
}

async function generateImageGoogle(apiKey, modelName, prompt, options = {}) {
    const modelId = MODEL_IDS[modelName] || window.GOOGLE_MODELS[modelName] || modelName;

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
}

async function generateGemini(apiKey, modelId, prompt, options) {
    const url = `${BASE_URL}${modelId}:generateContent?key=${apiKey}`;
    const targetCount = options.num_images || 1;

    // Helper to make a single request (candidateCount = 1)
    const generateSingle = async () => {
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
            console.error(`Gemini Single Request Error (${response.status}): ${errorText}`);
            return null;
        }

        const data = await response.json();

        if (data.candidates && data.candidates.length > 0) {
            const parts = data.candidates[0].content.parts;
            for (const part of parts) {
                const inlineData = part.inline_data || part.inlineData;
                if (inlineData && inlineData.data) {
                    return { type: 'image', data: inlineData.data };
                }
            }
            if (parts[0].text) return { type: 'text', data: parts[0].text };
        }
        return null;
    };

    // Run parallel requests
    console.log(`Starting ${targetCount} parallel generations...`);
    const promises = Array.from({ length: targetCount }, () => generateSingle());
    const results = await Promise.all(promises);

    // Aggregate results
    const images = [];
    let textFallback = null;

    results.forEach(res => {
        if (!res) return;
        if (res.type === 'image') images.push(res.data);
        if (res.type === 'text') textFallback = res.data;
    });

    console.log(`Aggregated ${images.length} images from ${targetCount} requests.`);

    if (images.length > 0) return images;
    return textFallback;
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
