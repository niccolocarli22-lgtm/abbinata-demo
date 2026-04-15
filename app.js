// Initialization and State
let closet = JSON.parse(localStorage.getItem('abbinata_closet')) || [];
let history = JSON.parse(localStorage.getItem('abbinata_history')) || [];

// Configurable Laundry Limits
const LAUNDRY_LIMITS = { top: 2, bottom: 4, outerwear: 10, shoes: 100, accessory: 1000 };

let currentTheme = localStorage.getItem('abbinata_theme') || 'dark';
let currentSuggestion = null;

// AI Engines
let aiEngines = {
    removal: null,
    classifier: null,
    isLoaded: false,
    error: null
};

document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.setAttribute('data-theme', currentTheme);
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

        const sources = [
            'https://cdn.jsdelivr.net/npm/@imgly/background-removal@latest/dist/index.js',
            'https://unpkg.com/@imgly/background-removal@latest/dist/index.js'
        ];
        
        for (const src of sources) {
            try {
                const module = await import(src);
                aiEngines.removal = module.removeBackground;
                break;
            } catch (e) { console.warn(`Fallback: ${src} fallito`); }
        }

        if (!aiEngines.removal) throw new Error("Impossibile caricare il modulo di rimozione sfondo.");

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

// Storage Helpers
function saveCloset() { localStorage.setItem('abbinata_closet', JSON.stringify(closet)); }
function saveHistory() { localStorage.setItem('abbinata_history', JSON.stringify(history)); }

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

async function processAI() {
    if (!pendingImage) return;
    
    if (!aiEngines.removal) {
        const errorMsg = aiEngines.error ? `Errore caricamento: ${aiEngines.error}` : "AI non ancora pronta. Attendi qualche secondo.";
        showToast(errorMsg);
        return;
    }

    const btn = document.getElementById('ai-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "✨ Elaborazione AI...";

    try {
        console.log("Inizio rimozione sfondo...");
        const resultBlob = await aiEngines.removal(pendingImage, {
            progress: (p) => {
                const percent = Math.round(p * 100);
                btn.innerText = `✨ AI: ${percent}%...`;
            }
        });
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            btn.innerText = "✅ Sfondo rimosso!";
            btn.style.background = "var(--accent-green)";
            
            // Re-detect details with transparent background
            showToast("Ricalcolo colore soggetto...");
            await detectImageDetails(pendingImage);
        };
        reader.readAsDataURL(resultBlob);
    } catch (e) {
        console.error("AI Background Removal Error:", e);
        showToast(`Errore AI: ${e.message.substring(0, 30)}...`);
        btn.disabled = false;
        btn.innerText = "✨ Riprova Rimozione";
        btn.style.background = "var(--primary)";
    }
}

// Image Upload
let pendingImage = null;

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        // If file too large (>5MB), warn user for Safari compatibility
        if (file.size > 5 * 1024 * 1024 && !window.chrome) {
            showToast("Attenzione: foto molto grande. Se Safari si blocca, prova una foto più piccola.");
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            document.getElementById('upload-form').style.display = 'block';
            document.querySelector('.upload-zone').style.display = 'none';
            
            showToast("Analisi soggetto...");
            await detectImageDetails(pendingImage);
            
            const aiBtn = document.getElementById('ai-btn');
            if (aiBtn) {
                aiBtn.style.display = 'inline-block';
                aiBtn.innerText = "✨ Rimuovi Sfondo con AI";
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
}

function exportBackup() { const blob = new Blob([JSON.stringify({closet, history, theme:currentTheme}, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `abbinata_backup.json`; a.click(); }
function importBackup(event) { const reader = new FileReader(); reader.onload = (e) => { try { const d = JSON.parse(e.target.result); if(d.closet) { closet=d.closet; history=d.history||[]; saveCloset(); saveHistory(); location.reload(); }} catch(err) { showToast("Errore backup."); } }; reader.readAsText(event.target.files[0]); }
function resetApp() { if(confirm("Sei sicuro?")) { localStorage.clear(); location.reload(); }}

function showToast(m) {
    const t = document.createElement('div');
    t.style = "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:10px 20px; border-radius:10px; z-index:1000; box-shadow: 0 4px 12px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease-out;";
    t.innerText = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
