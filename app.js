// --- DATABASE (IndexedDB) ---
// Sostituiamo localStorage (5MB) con IndexedDB (GB) per caricamenti illimitati
const dbName = 'AbbinataDB';
const storeName = 'closet';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
            if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'date' });
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveToDB(store, data) {
    const db = await openDB();
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    // Se è un array (closet), svuota e riscrivi per semplicità, o aggiorna per ID
    if (Array.isArray(data)) {
        s.clear();
        data.forEach(item => s.put(item));
    } else {
        s.put(data);
    }
    return new Promise((resolve) => tx.oncomplete = resolve);
}

async function loadFromDB(store) {
    const db = await openDB();
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    return new Promise((resolve) => {
        const request = s.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

// State
let closet = [];
let history = [];
let currentTheme = localStorage.getItem('abbinata_theme') || 'dark';
let currentSuggestion = null;

// AI Engines
let aiEngines = {
    removal: null,
    classifier: null,
    isLoaded: false,
    error: null
};

document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Load data from IndexedDB
    closet = await loadFromDB(storeName);
    const historyData = await loadFromDB('history');
    history = historyData.length > 0 ? historyData : [];

    updateDashboardCounts();
    renderCloset();
    updateWeather();
    updateThemeIcon();
    
    // Start resilient AI loading
    initAIEngines();
});

async function initAIEngines() {
    const statusEl = document.getElementById('ai-status');
    const updateStatus = (text, done = false, isError = false) => {
        if (statusEl) {
            statusEl.innerHTML = done ? `🟢 AI Pronta` : `<div class="dot-pulse" style="${isError ? 'background: red;' : ''}"></div> 🤖 ${text}`;
            if (done) setTimeout(() => statusEl.style.opacity = '0.5', 3000);
        }
    };

    try {
        updateStatus("Caricamento Visione...");
        
        // Load TensorFlow and MobileNet
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet');
        aiEngines.classifier = await mobilenet.load({version: 1, alpha: 0.25});
        
        updateStatus("Caricamento Rimozione Sfondo...");
        
        // Check for SharedArrayBuffer (often needed for full performance, though not strictly for all versions of the lib)
        if (!window.crossOriginIsolated && !navigator.serviceWorker) {
            console.warn("L'ambiente non è completamente isolato. Il caricamento AI potrebbe essere più lento o fallire su Safari/Firefox.");
        }

        // Nuova URL ultra-stabile 1.7.0 (Supporta ESM nativo su browser moderni)
        const src = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
        try {
            const module = await import(src);
            aiEngines.removal = module.removeBackground;
        } catch (e) {
            console.warn("Modulo ESM non supportato diretto, provo fallback...");
            // Se fallisce import dinamico, non c'è molto altro da fare via CDN puro senza asset locali
            throw new Error("L'IA di rimozione sfondo richiede un browser moderno (Safari 16+, Chrome 105+).");
        }

        aiEngines.isLoaded = true;
        updateStatus("AI Pronta", true);
    } catch (e) {
        aiEngines.error = e.message;
        console.error("AI Error:", e);
        updateStatus("⚠️ AI Parziale: " + e.message.substring(0, 20), false, true);
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
}

// Storage Helpers (indexedDB wrapper)
async function saveCloset() { await saveToDB(storeName, closet); }
async function saveHistory() { await saveToDB('history', history); }

// Navigation & Theme
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('abbinata_theme', currentTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('data-lucide', currentTheme === 'light' ? 'sun' : 'moon');
        if (window.lucide) lucide.createIcons();
    }
}

function switchSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');
    const btn = document.querySelector(`[data-section="${sectionId}"]`);
    if (btn) btn.classList.add('active');
}

// --- AI CORE FEATURES (ROBUST) ---

async function detectImageDetails(imgSrc) {
    const img = new Image();
    img.src = imgSrc;
    await new Promise(r => img.onload = r);

    // 1. Smart Color Detection (Subject-Centric)
    const color = extractDominantColor(img);
    document.getElementById('item-color').value = color;

    // 2. Category Detection
    if (aiEngines.classifier) {
        try {
            const predictions = await aiEngines.classifier.classify(img);
            const topCategory = mapClassToCategory(predictions[0].className);
            document.getElementById('item-category').value = topCategory;
        } catch (e) { console.warn("Classification error:", e); }
    }
}

/**
 * Extracts dominant color focusing on the subject.
 * If image has transparency, analyzes only non-transparent pixels.
 * If opaque, samples the central 60% of the image.
 */
function extractDominantColor(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 100; // Sample grid
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    
    const imageData = ctx.getImageData(0, 0, size, size).data;
    let r=0, g=0, b=0, count=0;

    // Check if we have transparency (post-AI removal)
    let hasAlpha = false;
    for (let i = 3; i < imageData.length; i += 4) {
        if (imageData[i] < 255) { hasAlpha = true; break; }
    }

    const margin = hasAlpha ? 0 : 20; // 20% margin if opaque to focus on center
    
    for (let y = margin; y < size - margin; y++) {
        for (let x = margin; x < size - margin; x++) {
            const i = (y * size + x) * 4;
            const alpha = imageData[i+3];
            
            // If transparent, ignore
            if (alpha < 128) continue;

            r += imageData[i];
            g += imageData[i+1];
            b += imageData[i+2];
            count++;
        }
    }

    if (count === 0) return "#8b5cf6"; // Default fallback
    
    const toHex = (c) => Math.round(c/count).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mapClassToCategory(className) {
    const name = className.toLowerCase();
    if (name.includes('shirt') || name.includes('t-shirt') || name.includes('jersey') || name.includes('cardigan') || name.includes('sweater') || name.includes('poncho')) return 'top';
    if (name.includes('jean') || name.includes('trouser') || name.includes('skirt') || name.includes('short') || name.includes('pant')) return 'bottom';
    if (name.includes('shoe') || name.includes('sneaker') || name.includes('boot') || name.includes('sandal') || name.includes('clog')) return 'shoes';
    if (name.includes('jacket') || name.includes('coat') || name.includes('overcoat') || name.includes('parka')) return 'outerwear';
    return 'accessory';
}

// --- UTILS: Compressione Immagini ---
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
            resolve(canvas.toDataURL('image/jpeg', 0.8)); // 0.8 quality = perfect balance
        };
        img.src = dataUrl;
    });
}

async function processAI() {
    if (!pendingImage) return;
    
    if (!aiEngines.removal) {
        const errorMsg = aiEngines.error ? `Errore IA: ${aiEngines.error}` : "IA in fase di avvio. Attendi un istante.";
        showToast(errorMsg);
        return;
    }

    const btn = document.getElementById('ai-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "✨ Sto rimuovendo lo sfondo...";

    try {
        // Passiamo l'immagine compressa all'IA per evitare crash di memoria
        const resultBlob = await aiEngines.removal(pendingImage, {
            model: 'medium', // Bilanciato per smartphone
            progress: (p) => {
                const percent = Math.round(p * 100);
                btn.innerText = `✨ IA: ${percent}%...`;
            }
        });
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            btn.innerText = "✅ Fatto!";
            btn.style.background = "var(--accent-green)";
            
            showToast("Ricalcolo colore vestito...");
            await detectImageDetails(pendingImage);
        };
        reader.readAsDataURL(resultBlob);
    } catch (e) {
        console.error("AI Error:", e);
        showToast(`IA fallita: ${e.message.substring(0, 30)}...`);
        btn.disabled = false;
        btn.innerText = "✨ Riprova";
        btn.style.background = "var(--primary)";
    }
}

// Image Upload
let pendingImage = null;

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            // COMPRESSIONE IMMEDIATA: Riduce il peso di 10x prima di ogni altra operazione
            showToast("Inizializzazione...");
            pendingImage = await compressImage(e.target.result, 800);
            
            document.getElementById('preview-img').src = pendingImage;
            document.getElementById('upload-form').style.display = 'block';
            document.querySelector('.upload-zone').style.display = 'none';
            
            showToast("Analisi vestito...");
            await detectImageDetails(pendingImage);
            
            const aiBtn = document.getElementById('ai-btn');
            if (aiBtn) {
                aiBtn.style.display = 'inline-block';
                aiBtn.innerText = "✨ Rimuovi Sfondo";
                aiBtn.disabled = !aiEngines.removal;
                aiBtn.style.background = "var(--primary)";
            }
        };
        reader.readAsDataURL(file);
    }
}

// --- Laundry/History/Render Logic remain unchanged but optimized ---
function saveNewItem() {
    const category = document.getElementById('item-category').value;
    const color = document.getElementById('item-color').value;
    closet.push({ id: Date.now(), image: pendingImage, category, color, status: 'disponibile', wear_count: 0 });
    saveCloset();
    pendingImage = null;
    document.getElementById('upload-form').style.display = 'none';
    document.querySelector('.upload-zone').style.display = 'block';
    renderCloset(); updateDashboardCounts(); switchSection('armadio');
}

function markAsWorn() {
    if (!currentSuggestion) return;
    const today = new Date().toISOString().split('T')[0];
    currentSuggestion.forEach(item => {
        const closetItem = closet.find(i => i.id === item.id);
        if (closetItem) {
            closetItem.wear_count = (closetItem.wear_count || 0) + 1;
            const limit = LAUNDRY_LIMITS[closetItem.category] || 3;
            if (closetItem.wear_count >= limit) closetItem.status = 'sporco';
        }
    });
    history.push({ date: today, ids: currentSuggestion.map(i => i.id) });
    saveCloset(); saveHistory();
    document.getElementById('btn-worn').style.display = 'none';
    showToast("Outfit registrato!");
    renderCloset(); updateDashboardCounts();
}

function renderCloset() {
    const container = document.getElementById('clothes-grid');
    if (!container) return;
    container.innerHTML = '';
    const activeFilter = document.querySelector('.filter-chip.active')?.innerText.toLowerCase() || 'tutti';
    const filterKey = activeFilter === 'puliti' ? 'disponibile' : (activeFilter === 'tutti' ? '' : activeFilter);
    const filtered = closet.filter(item => !filterKey || item.status === filterKey);
    filtered.forEach(item => {
        const card = document.createElement('div'); card.className = 'item-card';
        card.innerHTML = `<img src="${item.image}" class="item-img"><div class="item-info"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><span class="status-tag status-${item.status}">${item.status==='disponibile'?'pulito':item.status}</span><span style="font-size:0.65rem;color:var(--text-dim);">Usi: ${item.wear_count||0}</span></div><div style="display:flex;gap:0.4rem;margin-top:1rem;"><button class="nav-btn" onclick="updateStatus(${item.id}, 'disponibile')"><i data-lucide="sparkles" size="14"></i></button><button class="nav-btn" onclick="updateStatus(${item.id}, 'sporco')"><i data-lucide="droplets" size="14"></i></button><button class="nav-btn" onclick="deleteItem(${item.id})" style="color:var(--accent-red);margin-left:auto;"><i data-lucide="trash-2" size="14"></i></button></div></div>`;
        container.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
}

function updateStatus(id, status) {
    closet = closet.map(i => i.id === id ? {...i, status, wear_count: status === 'disponibile' ? 0 : i.wear_count} : i);
    saveCloset(); renderCloset(); updateDashboardCounts();
}

function deleteItem(id) { if (confirm('Eliminare?')) { closet = closet.filter(i => i.id !== id); saveCloset(); renderCloset(); updateDashboardCounts(); } }

function filterCloset(status) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.innerText.toLowerCase().includes(status === 'disponibile' ? 'puliti' : status)));
    renderCloset();
}

function updateDashboardCounts() {
    document.getElementById('count-available').innerText = closet.filter(i => i.status === 'disponibile').length;
    document.getElementById('count-dirty').innerText = closet.filter(i => i.status === 'sporco').length;
    document.getElementById('count-wash').innerText = closet.filter(i => i.status === 'lavaggio').length;
}

// Weather / Backup
async function updateWeather() {
    try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=45.9416&longitude=12.4172&current=temperature_2m,weather_code');
        const data = await res.json();
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        let icon = code > 50 ? 'cloud-rain' : (code > 3 ? 'cloud' : 'sun');
        document.getElementById('weather-info').innerHTML = `<i data-lucide="${icon}" size="48" style="margin-bottom:1rem;color:var(--secondary);"></i><div style="font-size:2.2rem;font-weight:800;">${temp}°C</div><div style="color:var(--text-dim);">Cordignano, TV</div>`;
        lucide.createIcons(); return temp;
    } catch(e) { return 20; }
}

async function generateOutfit() {
    const temp = await updateWeather();
    const available = closet.filter(i => i.status === 'disponibile');
    const recentIds = history.slice(-2).flatMap(h => h.ids);
    const filteredAvailable = available.filter(i => !recentIds.includes(i.id));
    const candidates = filteredAvailable.length > 5 ? filteredAvailable : available;
    const tops = candidates.filter(i => i.category === 'top');
    const bottoms = candidates.filter(i => i.category === 'bottom');
    const shoes = candidates.filter(i => i.category === 'shoes');
    const acc = candidates.filter(i => i.category === 'accessory');
    if (tops.length === 0 || bottoms.length === 0) { document.getElementById('suggestion-container').innerHTML = `<p style="padding:2rem;color:var(--text-dim);">Aggiungi vestiti!</p>`; return; }
    const t = tops[Math.floor(Math.random() * tops.length)];
    const b = bottoms[Math.floor(Math.random() * bottoms.length)];
    const s = shoes[Math.floor(Math.random() * shoes.length)] || null;
    const a = acc[Math.floor(Math.random() * acc.length)] || null;
    currentSuggestion = [t, b]; if (s) currentSuggestion.push(s); if (a) currentSuggestion.push(a);
    document.getElementById('suggestion-container').innerHTML = `<div style="display:flex;gap:1rem;margin-top:1rem;overflow-x:auto;padding:0.5rem 0;"><div class="match-item"><img src="${t.image}" style="width:100px;height:120px;object-fit:cover;border-radius:12px;border:2px solid ${t.color}"></div><div class="match-item"><img src="${b.image}" style="width:100px;height:120px;object-fit:cover;border-radius:12px;border:2px solid ${b.color}"></div>${s?`<div class="match-item"><img src="${s.image}" style="width:100px;height:120px;object-fit:cover;border-radius:12px;border:2px solid ${s.color}"></div>`:''}${a?`<div class="match-item"><img src="${a.image}" style="width:100px;height:120px;object-fit:cover;border-radius:12px;border:2px solid ${a.color}"></div>`:''}</div>`;
    document.getElementById('btn-worn').style.display = 'inline-block';
    document.getElementById('btn-magic').style.display = 'inline-block';
}

function exportBackup() { const blob = new Blob([JSON.stringify({closet, history, theme:currentTheme}, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `abbinata_backup.json`; a.click(); }
function importBackup(event) { const reader = new FileReader(); reader.onload = (e) => { try { const d = JSON.parse(e.target.result); if(d.closet) { closet=d.closet; history=d.history||[]; saveCloset(); saveHistory(); location.reload(); }} catch(err) { showToast("Errore backup."); } }; reader.readAsText(event.target.files[0]); }
function resetApp() { if(confirm("Sei sicuro?")) { localStorage.clear(); location.reload(); }}

function openMagicModal() {
    if (!currentSuggestion) return;
    const modal = document.getElementById('magic-modal');
    modal.classList.add('active');
    
    const container = document.getElementById('magic-model-container');
    const desc = document.getElementById('magic-description');
    container.innerHTML = '<div class="dot-pulse"></div>';
    desc.innerText = "L'IA sta creando il tuo look ideale basato sui tuoi capi...";

    setTimeout(() => {
        // Simuliamo la generazione basata sulle categorie/colori dell'outfit attuale
        const types = currentSuggestion.map(i => i.category).join(' & ');
        container.innerHTML = `<img src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80" style="width:100%; border-radius:12px; animation: fadeIn 0.5s ease-out;">`;
        desc.innerText = `Ecco un look ispirato ai tuoi ${types}. Uno stile fresco e moderno per la giornata di oggi!`;
    }, 2000);
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showToast(m) {
    const t = document.createElement('div');
    t.style = "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:10px 20px; border-radius:10px; z-index:1000; box-shadow: 0 4px 12px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease-out;";
    t.innerText = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
