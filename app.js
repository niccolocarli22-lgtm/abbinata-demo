// --- DATABASE (IndexedDB) ---
const dbName = 'AbbinataDB';
const storeName = 'closet';
let closet = [];
let history = [];
let currentSuggestion = null;
let aiEngines = { removal: null, classifier: null, config: {} };
let performanceMode = localStorage.getItem('abbinata_eco') === 'true';
let userPin = localStorage.getItem('abbinata_pin') || null;
let currentInputPin = "";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
            if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'date' });
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// Storage Helpers
async function saveCloset() {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    closet.forEach(item => store.put(item));
}

async function saveHistory() {
    const db = await openDB();
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    history.forEach(item => store.put(item));
}

// PIN & Security Functions
function pressKey(num) {
    if (currentInputPin.length >= 4) return;
    currentInputPin += num;
    updatePinDots();
    if (currentInputPin.length === 4) {
        setTimeout(verifyPin, 300);
    }
}

function updatePinDots() {
    const dots = document.querySelectorAll('.dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < currentInputPin.length);
    });
}

function verifyPin() {
    if (!userPin) {
        const setupPin = currentInputPin;
        const bday = prompt("Imposta Data Nascita (GGMMYYYY) per il recupero:");
        if (bday && bday.length === 8) {
            localStorage.setItem('abbinata_pin', setupPin);
            localStorage.setItem('abbinata_bday', bday);
            userPin = setupPin;
            unlockApp();
        } else {
            alert("Compleanno non valido (usa formato GGMMYYYY). Riprova.");
            currentInputPin = "";
            updatePinDots();
        }
    } else if (currentInputPin === userPin) {
        unlockApp();
    } else {
        document.getElementById('lock-msg').innerText = "PIN Errato. Riprova.";
        document.getElementById('lock-msg').style.color = "var(--accent-red)";
        currentInputPin = "";
        setTimeout(() => {
            document.getElementById('lock-msg').innerText = "Benvenuto, sblocca Abbinata";
            document.getElementById('lock-msg').style.color = "var(--text-main)";
            updatePinDots();
        }, 1000);
    }
}

function resetPin() {
    currentInputPin = "";
    updatePinDots();
}

function recoverPin() {
    const bday = prompt("Inserisci la data di nascita (GGMMYYYY):");
    const savedBday = localStorage.getItem('abbinata_bday');
    if (bday === savedBday) {
        const newPin = prompt("Nuovo PIN a 4 cifre:");
        if (newPin && newPin.length === 4) {
            localStorage.setItem('abbinata_pin', newPin);
            userPin = newPin;
            alert("PIN Aggiornato!");
            unlockApp();
        }
    } else {
        alert("Data errata.");
    }
}

function unlockApp() {
    document.getElementById('lock-screen').classList.add('hidden');
    appInit();
}

// Global App Initialization
async function appInit() {
    await openDB();
    await loadData();
    
    document.getElementById('eco-toggle').checked = performanceMode;
    updateEcoUI();
    
    if (!performanceMode) {
        initAIEngines();
    }
    
    renderCloset();
    generateOutfit();
    checkLaundryStatus();
    
    setTimeout(() => {
        const splash = document.getElementById('splash');
        if (splash) splash.style.display = 'none';
    }, 500);
}

async function loadData() {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const all = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });
    closet = all;
    
    const htx = db.transaction('history', 'readonly');
    const hstore = htx.objectStore('history');
    history = await new Promise(res => {
        const hreq = hstore.getAll();
        hreq.onsuccess = () => res(hreq.result);
    });

    closet.forEach(i => { if(!i.status) i.status = 'disponibile'; });
}

// Performance Mode
function toggleEcoMode() {
    performanceMode = document.getElementById('eco-toggle').checked;
    localStorage.setItem('abbinata_eco', performanceMode);
    updateEcoUI();
    if (!performanceMode) {
        showToast("IA Vision Pro in caricamento...");
        initAIEngines();
    } else {
        showToast("Modalità Eco: Risparmio Batteria");
    }
}

function updateEcoUI() {
    const badge = document.getElementById('eco-status');
    if (badge) {
        badge.innerText = performanceMode ? "ON" : "OFF";
        badge.style.borderColor = performanceMode ? "var(--accent-green)" : "var(--text-dim)";
    }
}

// AI Engine Loading
async function initAIEngines() {
    if (aiEngines.removal) return;
    try {
        console.log("Loading AI Vision...");
        
        // MobileNet for classification
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet');
        aiEngines.classifier = await mobilenet.load({version: 1, alpha: 0.25});
        
        // Background removal
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const aiModel = isIOS ? 'small' : 'medium';
        const src = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
        const module = await import(src);
        aiEngines.removal = module.removeBackground;
        aiEngines.config = { model: aiModel };
        
        console.log("AI Ready.");
    } catch (e) {
        console.error("AI Init Error:", e);
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
}

// --- CLOSET LOGIC ---
function renderCloset(items = closet) {
    const container = document.getElementById('clothes-grid');
    if (!container) return;
    container.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div'); card.className = 'item-card';
        card.innerHTML = `<img src="${item.image}" class="item-img"><div class="item-info"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><span class="status-tag status-${item.status}">${item.status==='disponibile'?'pulito':item.status}</span><span style="font-size:0.65rem;color:var(--text-dim);">Usi: ${item.wear_count||0}</span></div><div style="display:flex;gap:0.4rem;margin-top:1rem;"><button class="nav-btn" onclick="updateStatus(${item.id}, 'disponibile')"><i data-lucide="sparkles" size="14"></i></button><button class="nav-btn" onclick="updateStatus(${item.id}, 'sporco')"><i data-lucide="droplets" size="14"></i></button><button class="nav-btn" onclick="deleteItem(${item.id})" style="color:var(--accent-red);margin-left:auto;"><i data-lucide="trash-2" size="14"></i></button></div></div>`;
        container.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
}

function updateStatus(id, status) {
    closet = closet.map(i => i.id === id ? {...i, status, wear_count: status === 'disponibile' ? 0 : i.wear_count} : i);
    saveCloset();
    renderCloset();
    checkLaundryStatus();
}

function deleteItem(id) {
    if (confirm('Eliminare questo capo?')) {
        closet = closet.filter(i => i.id !== id);
        saveCloset();
        renderCloset();
        checkLaundryStatus();
    }
}

function filterCloset() {
    const query = document.getElementById('closet-search').value.toLowerCase();
    const filtered = closet.filter(item => 
        item.category.toLowerCase().includes(query) || 
        (item.color && item.color.toLowerCase().includes(query))
    );
    renderCloset(filtered);
}

// Laundry Control
function checkLaundryStatus() {
    const counts = { top: 0, bottom: 0 };
    closet.forEach(i => {
        if (i.status === 'disponibile' && counts[i.category] !== undefined) {
            counts[i.category]++;
        }
    });
    const alertEl = document.getElementById('laundry-alert');
    if (alertEl) alertEl.style.display = (counts.top < 2 || counts.bottom < 2) ? 'flex' : 'none';
}

// --- UPLOAD & AI PROCESSING ---
let pendingImage = null;

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            showToast("Compressione...");
            pendingImage = await compressImage(e.target.result, 800);
            document.getElementById('preview-img').src = pendingImage;
            document.getElementById('upload-form').style.display = 'block';
            document.querySelector('.upload-zone').style.display = 'none';
            
            if (!performanceMode) {
                showToast("Analisi IA...");
                await detectImageDetails(pendingImage);
            }
        };
        reader.readAsDataURL(file);
    }
}

async function compressImage(dataUrl, maxWidth = 800) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(maxWidth / img.width, 1);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = dataUrl;
    });
}

async function processAI() {
    if (!pendingImage || performanceMode || !aiEngines.removal) return;
    const btn = document.getElementById('ai-btn');
    btn.disabled = true;
    btn.innerText = "✨ Sto rimuovendo lo sfondo...";

    try {
        const resultBlob = await aiEngines.removal(pendingImage, {
            ...aiEngines.config,
            progress: (p) => btn.innerText = `✨ IA: ${Math.round(p * 100)}%...`
        });
        const reader = new FileReader();
        reader.onload = async (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            btn.innerText = "✅ Fatto!";
            await detectImageDetails(pendingImage);
        };
        reader.readAsDataURL(resultBlob);
    } catch (e) {
        showToast("Errore IA Sfondo.");
        btn.disabled = false;
        btn.innerText = "✨ Riprova";
    }
}

async function detectImageDetails(imgSrc) {
    const img = new Image();
    img.src = imgSrc;
    await new Promise(r => img.onload = r);
    const color = extractDominantColor(img);
    document.getElementById('item-color').value = color;
    if (aiEngines.classifier) {
        const predictions = await aiEngines.classifier.classify(img);
        document.getElementById('item-category').value = mapClassToCategory(predictions[0].className);
    }
}

function extractDominantColor(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 50; canvas.height = 50;
    ctx.drawImage(img, 10, 10, 30, 30, 0, 0, 50, 50);
    const data = ctx.getImageData(0, 0, 50, 50).data;
    let r=0, g=0, b=0, count=0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] > 128) { r += data[i]; g += data[i+1]; b += data[i+2]; count++; }
    }
    if (count === 0) return "#8b5cf6";
    const toHex = (c) => Math.round(c/count).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mapClassToCategory(className) {
    const name = className.toLowerCase();
    if (name.includes('shirt') || name.includes('top') || name.includes('t-shirt')) return 'top';
    if (name.includes('pant') || name.includes('jean') || name.includes('trouser')) return 'bottom';
    if (name.includes('shoe') || name.includes('sneaker')) return 'shoes';
    return 'accessory';
}

function saveNewItem() {
    const category = document.getElementById('item-category').value;
    const color = document.getElementById('item-color').value;
    closet.push({ id: Date.now(), image: pendingImage, category, color, status: 'disponibile', wear_count: 0 });
    saveCloset();
    pendingImage = null;
    document.getElementById('upload-form').style.display = 'none';
    document.querySelector('.upload-zone').style.display = 'block';
    renderCloset();
    checkLaundryStatus();
    switchSection('armadio');
}

// --- OUTFIT LOGIC ---
async function updateWeather() {
    try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=45.9&longitude=12.4&current=temperature_2m,weather_code');
        const data = await res.json();
        const temp = Math.round(data.current.temperature_2m);
        document.getElementById('weather-temp').innerText = `${temp}°C`;
        document.getElementById('weather-desc').innerText = "Cordignano, TV";
        return temp;
    } catch(e) { return 20; }
}

async function generateOutfit() {
    await updateWeather();
    const available = closet.filter(i => i.status === 'disponibile');
    const tops = available.filter(i => i.category === 'top');
    const bottoms = available.filter(i => i.category === 'bottom');
    if (tops.length === 0 || bottoms.length === 0) {
        document.getElementById('suggestion-container').innerHTML = `<p style="color:var(--text-dim);">Aggiungi vestiti puliti!</p>`;
        return;
    }
    const t = tops[Math.floor(Math.random() * tops.length)];
    const b = bottoms[Math.floor(Math.random() * bottoms.length)];
    currentSuggestion = [t, b];
    document.getElementById('suggestion-container').innerHTML = `
        <div class="item-card" style="width:120px; border:2px solid ${t.color}"><img src="${t.image}" style="width:100%"></div>
        <div class="item-card" style="width:120px; border:2px solid ${b.color}"><img src="${b.image}" style="width:100%"></div>
    `;
    document.getElementById('btn-worn').style.display = 'inline-block';
}

function markAsWorn() {
    if (!currentSuggestion) return;
    currentSuggestion.forEach(item => {
        const c = closet.find(i => i.id === item.id);
        if (c) {
            c.status = 'sporco';
            c.wear_count = (c.wear_count || 0) + 1;
        }
    });
    saveCloset();
    renderCloset();
    checkLaundryStatus();
    generateOutfit();
    showToast("Indossato!");
}

// --- UTILS ---
function switchSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function ntc(hex) {
    const colors = {'#ff0000':'rosso','#00ff00':'verde','#0000ff':'blu','#ffffff':'bianco','#000000':'nero'};
    return colors[hex.toLowerCase()] || 'colorato';
}

function openMagicModal() {
    if (!currentSuggestion) return;
    openModal('magic-modal');
    const container = document.getElementById('magic-model-container');
    container.innerHTML = '<div class="dot-pulse"></div>';
    
    const top = currentSuggestion.find(i => i.category === 'top');
    const bottom = currentSuggestion.find(i => i.category === 'bottom');
    const prompt = `A professional catalog fashion photo of a male model wearing a ${ntc(top.color)} shirt and ${ntc(bottom.color)} trousers, clean studio background, Zara style.`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=1000&nologo=true&seed=${Date.now()}`;
    
    const img = new Image();
    img.onload = () => container.innerHTML = `<img src="${url}" style="width:100%; border-radius:12px;">`;
    img.src = url;
}

function showToast(m) {
    const t = document.createElement('div');
    t.style = "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:10px 20px; border-radius:10px; z-index:2000; animation: fadeIn 0.3s;";
    t.innerText = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

// Security Check on start
window.addEventListener('load', () => {
    if (!userPin) {
        document.getElementById('lock-screen').classList.remove('hidden');
    }
});
