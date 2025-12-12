import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// PDF.js worker already set in HTML

// --- CONFIGURATION ---
// Paste your API Key here to avoid entering it every time
const API_KEY = "AIzaSyAYc3lb7WWYUeXqrewEn3c9XUmHQiv5xo0";

// Globals
let genAI = null;
let model = null;
let embeddingModel = null;
let vectorStore = []; // { text: string, embedding: Array<number> }
let fullPdfText = "";
let chatHistory = [];
let quizData = null;

// DOM Elements
const elements = {
    apiKeyInput: document.getElementById('api-key'),
    pdfInput: document.getElementById('pdf-upload'),
    fileName: document.getElementById('file-name'),
    appMode: document.getElementById('app-mode'),
    statusContainer: document.getElementById('status-container'),
    statusText: document.getElementById('status-text'),
    toast: document.getElementById('toast'),

    // Modes
    modeChat: document.getElementById('mode-chat'),
    modeSummary: document.getElementById('mode-summary'),
    modeExam: document.getElementById('mode-exam'),

    // Chat
    chatHistory: document.getElementById('chat-history'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),

    // Summary
    summaryHistory: document.getElementById('summary-history'),
    summaryInput: document.getElementById('summary-input'),
    summaryBtn: document.getElementById('summary-btn'),

    // Exam
    examTopic: document.getElementById('exam-topic'),
    generateExamBtn: document.getElementById('generate-exam-btn'),
    quizContainer: document.getElementById('quiz-container'),
    quizResults: document.getElementById('quiz-results'),

    // Mobile
    sidebar: document.querySelector('.sidebar'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    sidebarOverlay: document.getElementById('sidebar-overlay')
};

// --- Initialization & Event Listeners ---

elements.apiKeyInput.addEventListener('change', (e) => initializeGemini(e.target.value.trim()));

elements.pdfInput.addEventListener('change', handleFileUpload);
elements.appMode.addEventListener('change', switchMode);
elements.sendBtn.addEventListener('click', handleChatMessage);
elements.chatInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleChatMessage());
elements.summaryBtn.addEventListener('click', handleSummaryRequest);
elements.summaryInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleSummaryRequest());
elements.generateExamBtn.addEventListener('click', generateQuiz);

// Mobile Listeners
// Mobile Listeners
elements.mobileMenuBtn.addEventListener('click', toggleSidebar);
elements.sidebarOverlay.addEventListener('click', toggleSidebar);

// Check for hardcoded key on load
// Check for hardcoded key on load
if (API_KEY && API_KEY !== "PASTE_YOUR_API_KEY_HERE" && API_KEY !== "YOUR_API_KEY_HERE") {
    // Hide the input since we have a key
    elements.apiKeyInput.closest('.input-group').style.display = 'none';
    initializeGemini(API_KEY);
} else {
    console.warn("No API Key hardcoded. Waiting for user input.");
}

// --- Core Functions ---

function initializeGemini(key) {
    if (!key) return;
    try {
        genAI = new GoogleGenerativeAI(key);
        // Use gemini-1.5-flash
        model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        });
        embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        showToast("Gemini API Connected!", "success");
    } catch (error) {
        showToast(`Connection Error: ${error.message}`, "error");
        console.error(error);
    }
}

function showToast(message, type = "info") {
    elements.toast.textContent = message;
    elements.toast.className = `toast show ${type}`;
    setTimeout(() => {
        elements.toast.className = "toast";
    }, 3000);
}

function updateStatus(text, show = true) {
    elements.statusText.textContent = text;
    elements.statusContainer.classList.toggle('hidden', !show);
}

function toggleSidebar() {
    elements.sidebar.classList.toggle('open');
    elements.sidebarOverlay.classList.toggle('active');
}

function switchMode(e) {
    const mode = e.target.value;
    document.querySelectorAll('.mode-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`mode-${mode}`).classList.add('active');

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        toggleSidebar();
    }
}

// --- PDF Processing ---

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    elements.fileName.textContent = file.name;
    if (!genAI) {
        showToast("Please enter Gemini API Key first!", "error");
        return;
    }

    try {
        updateStatus("Reading PDF...");
        const arrayBuffer = await file.arrayBuffer();

        // 1. Extract Text
        // Convert ArrayBuffer to Uint8Array for PDF.js
        const uint8Array = new Uint8Array(arrayBuffer);
        const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(" ") + " ";
        }
        fullPdfText = text;

        // 2. Chunk Text
        updateStatus("Chunking document...");
        const chunks = recursiveCharacterTextSplitter(text, 1000, 200);

        // 3. Generate Embeddings
        updateStatus(`Generating embeddings for ${chunks.length} chunks...`);
        vectorStore = [];

        // Process in batches to avoid rate limits
        const batchSize = 10;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            await Promise.all(batch.map(async (chunk) => {
                try {
                    const result = await embeddingModel.embedContent(chunk);
                    const embedding = result.embedding.values;
                    vectorStore.push({ text: chunk, embedding });
                } catch (err) {
                    console.error("Embedding error:", err);
                }
            }));
            updateStatus(`Embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks...`);
        }

        updateStatus("Ready!", false);
        showToast("PDF Processed Successfully!", "success");

        // Reset chat/quiz
        elements.chatHistory.innerHTML = '<div class="welcome-message"><i class="fa-solid fa-robot"></i><p>Document ready. Ask away!</p></div>';

    } catch (error) {
        console.error(error);
        updateStatus("Error", false);
        showToast(`Failed to process PDF: ${error.message}`, "error");
    }
}

// Simple Recursive Character Splitter Logic (Simplified)
function recursiveCharacterTextSplitter(text, chunkSize, overlap) {
    const chunks = [];
    let startIndex = 0;
    while (startIndex < text.length) {
        let endIndex = startIndex + chunkSize;
        if (endIndex < text.length) {
            // Try to find a space to break at
            const lastSpace = text.lastIndexOf(" ", endIndex);
            if (lastSpace > startIndex) {
                endIndex = lastSpace;
            }
        }
        chunks.push(text.substring(startIndex, endIndex));
        startIndex = endIndex - overlap;
        if (startIndex < 0) startIndex = 0; // Safety
    }
    return chunks;
}

// --- RAG & Vector Search ---

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieveContext(query) {
    if (vectorStore.length === 0) return "";

    // Embed query
    const result = await embeddingModel.embedContent(query);
    const queryEmbedding = result.embedding.values;

    // Calculate similarities
    const similarities = vectorStore.map(doc => ({
        text: doc.text,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort and get top 5
    similarities.sort((a, b) => b.score - a.score);
    return similarities.slice(0, 5).map(s => s.text).join("\n\n---\n\n");
}

// --- Chat Logic ---

async function handleChatMessage() {
    const prompt = elements.chatInput.value.trim();
    if (!prompt) return;
    if (!model) { showToast("Set API Key first!", "error"); return; }
    if (vectorStore.length === 0) { showToast("Upload PDF first!", "error"); return; }

    appendMessage(prompt, 'user', elements.chatHistory);
    elements.chatInput.value = '';

    const loadingId = appendLoading('assistant', elements.chatHistory);

    try {
        const context = await retrieveContext(prompt);
        console.log("Retrieved Context:", context); // Debugging

        const systemPrompt = `You are an expert assistant. Use the DOCUMENT CONTEXT strictly to answer. If the answer is not in context, say 'I don't know'.
        
        CONTEXT:
        ${context}`;

        // Using generateContent for single RAG turn (simplest equivalent to Python logic)
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: systemPrompt
        });

        const response = result.response.text();

        removeLoading(loadingId, elements.chatHistory);
        appendMessage(response, 'assistant', elements.chatHistory);

    } catch (error) {
        removeLoading(loadingId, elements.chatHistory);
        console.error("Chat Error:", error);
        showToast(`API Error: ${error.message || error}`, "error");
    }
}

async function handleSummaryRequest() {
    const prompt = elements.summaryInput.value.trim();
    if (!prompt) return;

    appendMessage(`Summary Request: ${prompt}`, 'user', elements.summaryHistory);
    elements.summaryInput.value = '';

    const loadingId = appendLoading('assistant', elements.summaryHistory);

    try {
        const context = await retrieveContext(prompt);
        const instructions = "You are an expert summarizer. Synthesize the provided context into 1-2 cohesive paragraphs based on the user's request. No bullet points.";

        const result = await model.generateContent([
            instructions,
            `CONTEXT:\n${context}\n\nREQUEST: ${prompt}`
        ]);

        removeLoading(loadingId, elements.summaryHistory);
        appendMessage(result.response.text(), 'assistant', elements.summaryHistory);

    } catch (error) {
        removeLoading(loadingId, elements.summaryHistory);
        showToast("Error generating summary", "error");
    }
}

// --- UI Helpers ---

function appendMessage(text, role, container) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = role === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = marked.parse(text); // Use marked to render markdown

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble); // Reverse order is handled by CSS row-reverse

    if (role === 'user') {
        msgDiv.innerHTML = ''; // Reset to ensure correct order
        msgDiv.appendChild(avatar); // Actually CSS handles order, but let's stick to DOM order
        msgDiv.appendChild(bubble);
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function appendLoading(role, container) {
    const id = "loading-" + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = `
        <div class="avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="bubble"><i class="fa-solid fa-ellipsis fa-bounce"></i></div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeLoading(id, container) {
    const el = document.getElementById(id);
    if (el) container.removeChild(el);
}

// --- Exam Mode ---

async function generateQuiz() {
    const topic = elements.examTopic.value.trim();
    if (!topic || !vectorStore.length) {
        showToast("Enter a topic and ensure PDF is uploaded", "error");
        return;
    }

    elements.generateExamBtn.disabled = true;
    elements.generateExamBtn.textContent = "Generating...";
    elements.quizContainer.innerHTML = '';
    elements.quizResults.classList.add('hidden');
    elements.quizContainer.classList.remove('hidden');

    try {
        const context = await retrieveContext(topic);
        const prompt = `
        You are an expert examiner. Generate exactly 5 multiple-choice questions based on the context provided.
        Format the output as a JSON object with this exact schema:
        {
            "questions": [
                {
                    "question": "Question text",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correct_answer": "Exact text of correct option"
                }
            ]
        }
        
        Context: ${context}
        Topic: ${topic}
        `;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const jsonText = result.response.text();
        quizData = JSON.parse(jsonText).questions;

        renderQuiz(quizData);

    } catch (error) {
        console.error(error);
        showToast("Failed to generate quiz", "error");
    } finally {
        elements.generateExamBtn.disabled = false;
        elements.generateExamBtn.textContent = "✨ Generate Quiz";
    }
}

function renderQuiz(questions) {
    elements.quizContainer.innerHTML = '';
    const form = document.createElement('form');

    questions.forEach((q, index) => {
        const qDiv = document.createElement('div');
        qDiv.className = 'quiz-question';

        const title = document.createElement('h3');
        title.textContent = `${index + 1}. ${q.question}`;
        qDiv.appendChild(title);

        const optionsGrid = document.createElement('div');
        optionsGrid.className = 'options-grid';

        q.options.forEach(opt => {
            const label = document.createElement('label');
            label.className = 'option-label';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `q${index}`;
            radio.value = opt;

            const span = document.createElement('span');
            span.textContent = opt;

            label.appendChild(radio);
            label.appendChild(span);
            optionsGrid.appendChild(label);
        });

        qDiv.appendChild(optionsGrid);
        form.appendChild(qDiv);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'submit-exam-btn';
    submitBtn.textContent = '🎯 Submit Exam';

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        gradeQuiz(new FormData(form));
    });

    form.appendChild(submitBtn);
    elements.quizContainer.appendChild(form);
}

function gradeQuiz(formData) {
    let score = 0;
    const questionsDivs = document.querySelectorAll('.quiz-question');

    quizData.forEach((q, index) => {
        const userAns = formData.get(`q${index}`);
        const qDiv = questionsDivs[index];
        const labels = qDiv.querySelectorAll('.option-label');

        labels.forEach(label => {
            const val = label.querySelector('input').value;
            label.classList.remove('correct', 'incorrect');

            if (val === q.correct_answer) {
                label.classList.add('correct');
            } else if (val === userAns && val !== q.correct_answer) {
                label.classList.add('incorrect');
            }
        });

        if (userAns === q.correct_answer) score++;
    });

    elements.quizResults.innerHTML = `
        <h3>Your Grade: ${score} / 5</h3>
        <p>${getFeedback(score)}</p>
    `;
    elements.quizResults.classList.remove('hidden');
    showToast(`You scored ${score}/5`, "success");
    // Scroll to results
    elements.quizResults.scrollIntoView({ behavior: 'smooth' });
}

function getFeedback(score) {
    if (score === 5) return "🎉 Perfect score! Outstanding understanding!";
    if (score >= 4) return "🌟 Great job! You have a solid understanding.";
    if (score >= 3) return "👍 Good effort! Review the material to improve.";
    return "📖 Keep studying! Focus on key concepts.";
}
