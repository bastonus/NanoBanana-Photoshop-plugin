const { storage } = require('uxp');
const { generateChatGoogle } = require('./googleAiSdk.js');
const { core } = require('photoshop');

// State
let chats = [];
let activeChatId = null;
let currentEncodedImage = null; // Stored as Base64 string for API
let pendingImagePreview = null; // Object URL or Base64 for preview
let chatSearchTerm = ''; // Search filter

const SYSTEM_INSTRUCTION = `You are Nano Banana's expert AI assistant for Adobe Photoshop. Your primary goal is to help the user create amazing generative AI images.

RULES:
1. When the user asks for an image idea, description, or refinement, provide a highly detailed, creative English prompt.
2. **IMPORTANT**: When you provide a prompt that the user can use for generation, you MUST enclose it in a Markdown code block with the language labeled 'prompt'.
   Example:
   \`\`\`prompt
   A majestic lion with golden wings standing on a mountain peak at sunrise, cinematic lighting, 8k resolution, photorealistic.
   \`\`\`
3. Do not assume you can generate images yourself directly in the chat. You help CREATE the prompts.
4. Be concise, professional, and helpful. 
5. If the user upload an image, describe it or use it as context for prompts.
`;

async function initChat() {
    console.log("Initializing Chat Mode...");
    loadChats();
    setupEventListeners();
    populateChatModels();

    const lastTab = localStorage.getItem('nanobanana_activeTab');
    if (lastTab) switchView(lastTab);

    if (chats.length === 0) {
        createNewChat();
    } else {
        renderChatList();
        const savedChatId = localStorage.getItem('nanobanana_activeChatId');
        const targetChat = chats.find(c => c.id === savedChatId);
        selectChat(targetChat ? savedChatId : chats[0].id);
    }
}

function setupEventListeners() {
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.target));
    });

    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) newChatBtn.addEventListener('click', () => createNewChat());

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = (chatInput.scrollHeight) + 'px';
            if (chatInput.value === '') chatInput.style.height = '40px';
        });
        chatInput.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.code === 'Enter') && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                chatInput.style.height = '40px';
            }
        });
    }

    // Attach Image Button
    const attachBtn = document.getElementById('chat-attach-btn');
    if (attachBtn) {
        attachBtn.addEventListener('click', async () => {
            await handleImageAttachment();
        });
    }

    // Paste Support for Images
    if (chatInput) {
        chatInput.addEventListener('paste', async (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    await processAttachedImage(blob);
                    return;
                }
            }
        });
    }

    // Model Picker Sync
    const picker = document.getElementById('chat-model-picker');
    if (picker) {
        picker.addEventListener('change', (e) => {
            const val = e.target.value;
            updateModelDisplay(val);
            localStorage.setItem('nanobanana_refineModel', val);

            // Sync with Refine
            const refinePicker = document.getElementById('refine-prompt-picker');
            if (refinePicker) {
                refinePicker.value = val;
                updateRefineDisplay(val);
            }

            if (activeChatId) {
                const chat = chats.find(c => c.id === activeChatId);
                if (chat) chat.model = val;
                saveChats();
            }
        });
    }

    // Search Listener
    const searchInput = document.getElementById('chat-history-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            chatSearchTerm = e.target.value.toLowerCase();
            renderChatList();
        });
    }
}

// --- Image Handling ---

async function handleImageAttachment() {
    try {
        const file = await storage.localFileSystem.getFileForOpening({
            types: ["jpg", "jpeg", "png", "webp"],
            allowMultiple: false
        });
        if (!file) return;

        // Read file as ArrayBuffer then Blob
        const data = await file.read({ format: storage.formats.binary });
        const blob = new Blob([data], { type: 'image/jpeg' }); // Assume JPEG for simplicity or sniff type
        await processAttachedImage(blob);

    } catch (e) {
        console.warn("Attachment failed:", e);
    }
}

async function processAttachedImage(blob) {
    // 1. Convert to Base64 for API
    currentEncodedImage = await blobToBase64(blob);

    // 2. Create Preview
    const previewContainer = document.getElementById('chat-image-preview');
    previewContainer.innerHTML = '';
    previewContainer.classList.remove('hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';

    // Create local URL for display
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    img.className = 'preview-thumb-img';

    const removeBtn = document.createElement('div');
    removeBtn.className = 'preview-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
        clearAttachment();
    };

    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    previewContainer.appendChild(wrapper);
}

function clearAttachment() {
    currentEncodedImage = null;
    const preview = document.getElementById('chat-image-preview');
    preview.innerHTML = '';
    preview.classList.add('hidden');
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result;
            // Remove Data URL prefix "data:image/xxx;base64,"
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// --- Message Logic ---

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();

    if (!text && !currentEncodedImage) return;

    if (!activeChatId) {
        if (chats.length > 0) activeChatId = chats[0].id;
        else createNewChat();
    }

    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;

    input.value = '';

    // Construct Message
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    if (currentEncodedImage) {
        userMsg.image = currentEncodedImage;
        // Optimization: Don't save large images to LS if possible, but for now we do.
        // Limit: clear old ones?
    }

    chat.messages.push(userMsg);
    appendMessageBubble(userMsg); // Pass object now
    saveChats();

    // Auto-Title on first exchange
    if (chat.messages.length <= 2) {
        updateChatTitleSmart(chat.id, text);
    }

    const imageToSend = currentEncodedImage;
    clearAttachment(); // Clear UI state immediately

    // Trigger generation
    triggerGeneration(chat);
}

// Helper to reliably get model
function getActiveModel(chat) {
    const picker = document.getElementById('chat-model-picker');
    const globalModel = localStorage.getItem('nanobanana_refineModel');
    let model = (picker && picker.value) ? picker.value : (globalModel || chat.model);

    // Sanitation
    if (!model || model.includes(' ') || model === "undefined") {
        return "models/gemini-1.5-pro-latest";
    }
    return model;
}

// Auto Title Feature
async function updateChatTitleSmart(chatId, userText) {
    if (!userText || userText.length < 5) return;
    try {
        // Background fire-and-forget
        const apiKey = await getApiKey();
        if (!apiKey) return;

        const prompt = `Summarize this chat message into a short 3-5 word title: "${userText}"`;
        const response = await generateChatGoogle(apiKey, "models/gemini-1.5-flash-latest", [{ role: 'user', parts: [{ text: prompt }] }]);

        if (response) {
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
                chat.title = response.replace(/"/g, '').trim();
                saveChats();
                renderChatList();
            }
        }
    } catch (e) {
        // Silent fail
        console.warn("Auto-title failed", e);
    }
}


function appendMessageBubble(msgOrRole, contentIfOld, animate = true) {
    // Adapter for old signature: appendMessageBubble('user', 'text')
    let msg = msgOrRole;
    if (typeof msgOrRole === 'string') {
        msg = { role: msgOrRole, content: contentIfOld };
    }

    const container = document.getElementById('chat-messages-container');
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role === 'user' ? 'message-user' : 'message-ai'}`;

    // Image Display?
    if (msg.image) {
        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${msg.image}`;
        img.style.maxWidth = "200px";
        img.style.borderRadius = "8px";
        img.style.marginBottom = "8px";
        img.style.display = "block";
        bubble.appendChild(img);
    }

    // Content Parser
    if (msg.role === 'model') {
        const parts = msg.content.split(/(```prompt[\s\S]*?```)/g);
        parts.forEach(part => {
            if (part.startsWith('```prompt')) {
                const promptText = part.replace(/^```prompt\s*/, '').replace(/```$/, '').trim();
                const card = createPromptCard(promptText);
                bubble.appendChild(card);
            } else {
                if (part.trim()) {
                    const span = document.createElement('div');
                    span.style.whiteSpace = 'pre-wrap';
                    span.textContent = part;
                    bubble.appendChild(span);
                }
            }
        });
    } else {
        const textNode = document.createElement('div');
        textNode.style.whiteSpace = 'pre-wrap';
        textNode.textContent = msg.content;
        bubble.appendChild(textNode);
    }

    // --- Message Actions Toolbar ---
    const toolbar = document.createElement('div');
    toolbar.className = 'message-actions-toolbar';

    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = "Copy Text";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(msg.content);
        // Toast?
    };
    toolbar.appendChild(copyBtn);

    // Regenerate (AI Only + Last Message Only)
    // Actually, simple "Regenerate" just re-sends history up to this point?
    // Let's keep it simple: "Regenerate" only on the VERY LAST AI message.
    // Check if this is the last message of the ACTIVE chat
    // For now, render it, but logic needs context. We don't have index here easily unless passed.
    // Let's just add it for all AI messages, but if clicked, it removes this and all subsequent, then regenerates.
    if (msg.role === 'model') {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'msg-action-btn';
        regenBtn.title = "Regenerate response";
        regenBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;
        regenBtn.onclick = (e) => {
            e.stopPropagation();
            regenerateFromMessage(msg);
        };
        toolbar.appendChild(regenBtn);
    }

    bubble.appendChild(toolbar);
    container.appendChild(bubble);
    if (animate) scrollToBottom();
}

function createPromptCard(text) {
    const card = document.createElement('div');
    card.className = 'prompt-action-card';

    const label = document.createElement('span');
    label.className = 'prompt-card-label';
    label.textContent = "Suggested Prompt";

    const textDisplay = document.createElement('div');
    textDisplay.className = 'prompt-text-display';
    textDisplay.textContent = text;

    const btn = document.createElement('sp-button');
    btn.textContent = "Use this prompt";
    btn.variant = "cta";
    btn.size = "s";
    btn.className = "use-prompt-btn w-full";
    btn.onclick = () => usePrompt(text);

    card.appendChild(label);
    card.appendChild(textDisplay);
    card.appendChild(btn);
    return card;
}

function regenerateFromMessage(msgObject) {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;

    // Find index
    const index = chat.messages.indexOf(msgObject);
    if (index === -1) return;

    // Remove this message and everything after it
    // Logic: If user clicked Regen on AI message, we remove it, and re-run response for the User message before it.
    // If it was the first message? (AI welcome?), can't regen.
    // Usually User Message is index-1.

    chat.messages = chat.messages.slice(0, index);
    saveChats();

    // Re-render immediately to show state
    renderMessages(chat.messages);

    // Trigger Send (which picks up from history)
    // But `sendMessage` reads from input. We need `generateResponseForChat`
    // Refactor `sendMessage`? Or just hack it:
    // We already have the logic inside `sendMessage` but it's coupled to input.
    // Let's create a shared `processChatResponse(chat)` function.
    // For now, duplicate standard generation logic to ensure stability.

    triggerGeneration(chat);
}

async function triggerGeneration(chat) {
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'message-bubble message-ai';
    loadingBubble.innerHTML = '<sp-progress-circle indeterminate size="s"></sp-progress-circle>';
    document.getElementById('chat-messages-container').appendChild(loadingBubble);
    loadingBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

    try {
        const apiKey = await getApiKey();
        if (!apiKey) throw new Error("API Key missing");

        const apiHistory = chat.messages.map(m => {
            const parts = [];
            if (m.content) parts.push({ text: m.content });
            if (m.image) {
                parts.push({
                    inline_data: { mime_type: "image/jpeg", data: m.image }
                });
            }
            return { role: m.role, parts: parts };
        });

        let selectedModel = getActiveModel(chat);

        const responseText = await generateChatGoogle(apiKey, selectedModel, apiHistory, SYSTEM_INSTRUCTION);

        loadingBubble.remove();
        const aiMsg = { role: 'model', content: responseText, timestamp: Date.now() };
        chat.messages.push(aiMsg);
        appendMessageBubble(aiMsg);
        saveChats();

    } catch (e) {
        loadingBubble.remove();
        console.error("Regen Error", e);
        const errBubble = document.createElement('div');
        errBubble.className = 'message-bubble message-ai';
        errBubble.style.border = "1px solid red";
        errBubble.textContent = "Error: " + e.message;
        document.getElementById('chat-messages-container').appendChild(errBubble);
    }
}


// --- UI Helpers ---
function updateModelDisplay(val) {
    const display = document.getElementById('chat-model-name-display');
    if (display) {
        let name = val.replace('models/', '');
        if (name.length > 20) name = name.substring(0, 18) + '...';
        display.textContent = name;
    }
}
function updateRefineDisplay(val) {
    const refineDisplay = document.getElementById('refine-model-name-display');
    if (refineDisplay) {
        let rName = val.replace('models/', '');
        if (rName.includes('Gemini 3 Pro')) rName = 'Gemini 3 Pro';
        else if (rName.includes('1.5 Pro')) rName = '1.5 Pro';
        else if (rName.includes('1.5 Flash')) rName = '1.5 Flash';
        refineDisplay.textContent = rName;
    }
}

function switchView(viewId) {
    // Update Tabs
    document.querySelectorAll('.tab-item').forEach(t => {
        t.classList.toggle('active', t.dataset.target === viewId);
    });

    // Update Views
    document.getElementById('generator-view').classList.add('hidden');
    document.getElementById('chat-view').classList.add('hidden');

    // Manage Main Visibility logic from original index.html
    const mainSection = document.getElementById('main');
    if (mainSection.classList.contains('hidden')) {
        mainSection.classList.remove('hidden');
    }

    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.remove('hidden');

    // Save state
    localStorage.setItem('nanobanana_activeTab', viewId);

    // Sync models on switch
    if (viewId === 'chat-view') {
        const savedRefineModel = localStorage.getItem('nanobanana_refineModel');
        const picker = document.getElementById('chat-model-picker');
        if (savedRefineModel && picker && picker.value !== savedRefineModel) {
            picker.value = savedRefineModel;
            // Update display
            const display = document.getElementById('chat-model-name-display');
            if (display) {
                let name = savedRefineModel.replace('models/', '');
                if (name.length > 20) name = name.substring(0, 18) + '...';
                display.textContent = name;
            }
        }
        scrollToBottom();
    }
}

function loadChats() {
    // Use window.localStorage (Synchronous)
    const saved = localStorage.getItem('nanobanana_chats');
    if (saved) {
        try {
            // Check if it's the broken "[object Promise]" string
            if (saved === "[object Promise]") {
                console.warn("Detected corrupted chat history, resetting.");
                chats = [];
            } else {
                chats = JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to parse chats", e);
            chats = [];
        }
    }
}

function saveChats() {
    // Limit history size
    localStorage.setItem('nanobanana_chats', JSON.stringify(chats.slice(0, 10))); // Keep last 10 chats
}

function createNewChat() {
    const globalModel = localStorage.getItem('nanobanana_refineModel');
    const newChat = {
        id: Date.now().toString(),
        title: "New Chat",
        messages: [],
        model: globalModel || "models/gemini-1.5-pro-latest"
    };
    chats.unshift(newChat);
    renderChatList();
    selectChat(newChat.id);
    saveChats();
}

function deleteChat(chatId) {
    chats = chats.filter(c => c.id !== chatId);
    saveChats();
    renderChatList();
    if (chats.length === 0) {
        createNewChat();
    } else {
        selectChat(chats[0].id);
    }
}

function selectChat(chatId) {
    console.log("Selecting chat:", chatId);
    activeChatId = chatId;
    localStorage.setItem('nanobanana_activeChatId', chatId);

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        console.error("Chat not found for ID:", chatId);
        return;
    }

    // Update UI
    renderChatList();
    renderMessages(chat.messages);

    // Sync UI
    const globalModel = localStorage.getItem('nanobanana_refineModel');
    const picker = document.getElementById('chat-model-picker');

    if (picker) {
        if (globalModel) {
            picker.value = globalModel;
            const display = document.getElementById('chat-model-name-display');
            if (display) {
                let name = globalModel.replace('models/', '');
                if (name.length > 20) name = name.substring(0, 18) + '...';
                display.textContent = name;
            }
        } else if (chat.model) {
            picker.value = chat.model;
            // Update global to match?
            localStorage.setItem('nanobanana_refineModel', chat.model);
        }
    }
}

function renderChatList() {
    const container = document.getElementById('chat-history-list');
    container.innerHTML = '';

    const visibleChats = chats.filter(c => {
        if (!chatSearchTerm) return true;
        return (c.title || "").toLowerCase().includes(chatSearchTerm);
    });

    visibleChats.forEach(chat => {
        const el = document.createElement('div');
        el.className = `chat-list-item ${chat.id === activeChatId ? 'active' : ''}`;
        el.title = chat.title;

        // Container for text
        const textSpan = document.createElement('span');
        textSpan.className = 'chat-item-title';
        textSpan.textContent = chat.title || "New Chat";

        // Delete Button
        const delBtn = document.createElement('div');
        delBtn.className = 'chat-item-delete';
        delBtn.innerHTML = '×';
        delBtn.title = 'Delete Chat';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            // confirm() is not available in UXP, so we delete directly for now
            deleteChat(chat.id);
        };

        el.appendChild(textSpan);
        el.appendChild(delBtn);

        el.addEventListener('click', () => selectChat(chat.id));
        container.appendChild(el);
    });
}

function renderMessages(messages) {
    const container = document.getElementById('chat-messages-container');
    container.innerHTML = '';

    if (messages.length === 0) {
        const welcome = document.createElement('div');
        welcome.className = 'history-empty-state';
        welcome.textContent = "Start discussing your image ideas...";
        container.appendChild(welcome);
        return;
    }

    messages.forEach(msg => {
        appendMessageBubble(msg.role, msg.content, false);
    });
    scrollToBottom();
}



function scrollToBottom() {
    const container = document.getElementById('chat-messages-container');
    container.scrollTop = container.scrollHeight;
}

function usePrompt(text) {
    switchView('generator-view');
    const input = document.getElementById('prompt-input');
    if (input) {
        input.value = text;
        input.focus();
    }
}



async function getApiKey() {
    const localStorage = storage.secureStorage;
    const key = await localStorage.getItem('googleAiApiKey');
    return key ? String.fromCharCode.apply(null, key) : null;
}

function populateChatModels() {
    const select = document.getElementById('chat-model-menu');
    if (!select) return;

    const textModels = window.GOOGLE_TEXT_MODELS || {};
    if (Object.keys(textModels).length === 0) {
        textModels["Gemini 1.5 Pro"] = "models/gemini-1.5-pro-latest";
        textModels["Gemini 1.5 Flash"] = "models/gemini-1.5-flash-latest";
    }

    select.innerHTML = '';
    Object.keys(textModels).forEach(name => {
        const item = document.createElement('sp-menu-item');
        item.textContent = name;
        item.value = textModels[name];
        select.appendChild(item);
    });

    // Set default selection from Global Sync
    const savedRefineModel = localStorage.getItem('nanobanana_refineModel');
    const picker = document.getElementById('chat-model-picker');
    if (picker) {
        // Prefer saved refine model, else default
        picker.value = savedRefineModel || "models/gemini-1.5-pro-latest";

        const display = document.getElementById('chat-model-name-display');
        if (display) {
            let val = picker.value;
            let foundName = Object.keys(textModels).find(key => textModels[key] === val);
            let name = foundName || val.replace('models/', '');
            display.textContent = name;
        }
    }
}

module.exports = { initChat, populateChatModels };
