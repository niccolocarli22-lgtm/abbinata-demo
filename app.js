// Initialization and State
const DEMO_ASSETS = [
    { id: 1, category: 'top', color: '#ffffff', image: './assets/white_tee.png', status: 'disponibile', wear_count: 0 },
    { id: 2, category: 'bottom', color: '#1e3a8a', image: './assets/blue_jeans.png', status: 'disponibile', wear_count: 0 },
    { id: 3, category: 'shoes', color: '#d1d5db', image: './assets/sneakers.png', status: 'disponibile', wear_count: 0 },
    { id: 4, category: 'accessory', color: '#000000', image: './assets/watch.png', status: 'disponibile', wear_count: 0 }
];

// Configurable Laundry Limits
const LAUNDRY_LIMITS = {
    top: 2,
    bottom: 4,
    outerwear: 10,
    shoes: 100,
    accessory: 1000
};

let closet = JSON.parse(localStorage.getItem('abbinata_closet')) || [];
let history = JSON.parse(localStorage.getItem('abbinata_history')) || [];

if (closet.length === 0) {
    closet = DEMO_ASSETS;
    saveCloset();
}

let currentTheme = localStorage.getItem('abbinata_theme') || 'dark';
let currentSuggestion = null;

// AI Background Removal Engine (Late-loaded)
let removeBackground = null;

document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateDashboardCounts();
    renderCloset();
    updateWeather();
    updateThemeIcon();
    
    // Load AI module if possible
    loadAI();
});

async function loadAI() {
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@latest/dist/index.js');
        removeBackground = module.removeBackground;
        console.log("AI Background Removal Loaded");
    } catch (e) {
        console.warn("AI Module load failed", e);
    }
}

// Storage Helpers
function saveCloset() { localStorage.setItem('abbinata_closet', JSON.stringify(closet)); }
function saveHistory() { localStorage.setItem('abbinata_history', JSON.stringify(history)); }

// Theme Logic
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

// Navigation
function switchSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');
    
    const btn = document.querySelector(`[data-section="${sectionId}"]`);
    if (btn) btn.classList.add('active');
}

// AI BG Removal Tool
async function processAI() {
    if (!pendingImage) return;
    if (!removeBackground) {
        showToast("L'AI sta ancora caricando... Riprova tra pochi secondi.");
        return;
    }

    const btn = document.getElementById('ai-btn');
    const originalText = btn.innerText;
    btn.innerText = "✨ Elaborazione AI...";
    btn.disabled = true;

    try {
        const resultBlob = await removeBackground(pendingImage);
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            btn.innerText = "✅ Sfondo rimosso!";
            btn.style.background = "var(--accent-green)";
        };
        reader.readAsDataURL(resultBlob);
    } catch (e) {
        showToast("Errore durante l'elaborazione AI.");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// Image Upload
let pendingImage = null;

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingImage = e.target.result;
            document.getElementById('preview-img').src = pendingImage;
            document.getElementById('upload-form').style.display = 'block';
            document.querySelector('.upload-zone').style.display = 'none';
            
            // Show AI button
            const aiBtn = document.getElementById('ai-btn');
            if (aiBtn) {
                aiBtn.style.display = 'inline-block';
                aiBtn.innerText = "✨ Rimuovi Sfondo con AI";
                aiBtn.disabled = false;
                aiBtn.style.background = "var(--primary)";
            }
        };
        reader.readAsDataURL(file);
    }
}

function saveNewItem() {
    const category = document.getElementById('item-category').value;
    const color = document.getElementById('item-color').value;
    
    const newItem = {
        id: Date.now(),
        image: pendingImage,
        category: category,
        color: color,
        status: 'disponibile',
        wear_count: 0
    };
    
    closet.push(newItem);
    saveCloset();
    
    // Reset Form
    pendingImage = null;
    document.getElementById('upload-form').style.display = 'none';
    document.querySelector('.upload-zone').style.display = 'block';
    
    renderCloset();
    updateDashboardCounts();
    switchSection('armadio');
    showToast('Capo aggiunto!');
}

// Laundry & History Logic
function markAsWorn() {
    if (!currentSuggestion) return;
    
    const today = new Date().toISOString().split('T')[0];
    
    // Update wear counts
    currentSuggestion.forEach(item => {
        const closetItem = closet.find(i => i.id === item.id);
        if (closetItem) {
            closetItem.wear_count = (closetItem.wear_count || 0) + 1;
            
            // Check threshold
            const limit = LAUNDRY_LIMITS[closetItem.category] || 3;
            if (closetItem.wear_count >= limit) {
                closetItem.status = 'sporco';
                showToast(`${closetItem.category} spostato in lavanderia!`);
            }
        }
    });

    // Save to history
    history.push({
        date: today,
        ids: currentSuggestion.map(i => i.id)
    });

    saveCloset();
    saveHistory();
    
    document.getElementById('btn-worn').style.display = 'none';
    showToast("Outfit registrato in cronologia!");
    renderCloset();
    updateDashboardCounts();
}

// Rendering
function renderCloset() {
    const container = document.getElementById('clothes-grid');
    if (!container) return;
    container.innerHTML = '';
    
    const activeFilterChip = document.querySelector('.filter-chip.active');
    let currentFilter = activeFilterChip ? activeFilterChip.innerText.toLowerCase() : 'tutti';
    if (currentFilter === 'tutti') currentFilter = '';
    else if (currentFilter === 'puliti') currentFilter = 'disponibile';

    const filtered = closet.filter(item => !currentFilter || item.status === currentFilter);

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.innerHTML = `
            <img src="${item.image}" class="item-img">
            <div class="item-info">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <span class="status-tag status-${item.status}">${item.status === 'disponibile' ? 'pulito' : item.status}</span>
                    <span style="font-size: 0.65rem; color: var(--text-dim);">Usi: ${item.wear_count || 0}</span>
                </div>
                <div style="display: flex; gap: 0.4rem; margin-top: 1rem;">
                    <button class="nav-btn" onclick="updateStatus(${item.id}, 'disponibile')" title="Pulisci"><i data-lucide="sparkles" size="14"></i></button>
                    <button class="nav-btn" onclick="updateStatus(${item.id}, 'sporco')" title="Sporco"><i data-lucide="droplets" size="14"></i></button>
                    <button class="nav-btn" onclick="deleteItem(${item.id})" style="color: var(--accent-red); margin-left: auto;"><i data-lucide="trash-2" size="14"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
}

function updateStatus(id, status) {
    closet = closet.map(i => {
        if (i.id === id) {
            const newCount = status === 'disponibile' ? 0 : i.wear_count;
            return {...i, status, wear_count: newCount};
        }
        return i;
    });
    saveCloset();
    renderCloset();
    updateDashboardCounts();
}

function deleteItem(id) {
    if (confirm('Eliminare questo capo?')) {
        closet = closet.filter(i => i.id !== id);
        saveCloset();
        renderCloset();
        updateDashboardCounts();
    }
}

function filterCloset(status) {
    document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.toggle('active', c.innerText.toLowerCase().includes(status === 'disponibile' ? 'puliti' : status));
    });
    renderCloset();
}

function updateDashboardCounts() {
    document.getElementById('count-available').innerText = closet.filter(i => i.status === 'disponibile').length;
    document.getElementById('count-dirty').innerText = closet.filter(i => i.status === 'sporco').length;
    document.getElementById('count-wash').innerText = closet.filter(i => i.status === 'lavaggio').length;
}

// Weather (Cordignano)
async function updateWeather() {
    try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=45.9416&longitude=12.4172&current=temperature_2m,weather_code');
        const data = await res.json();
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        
        let icon = 'sun';
        if (code > 3) icon = 'cloud';
        if (code > 50) icon = 'cloud-rain';
        
        document.getElementById('weather-info').innerHTML = `
            <i data-lucide="${icon}" size="48" style="margin-bottom: 1rem; color: var(--secondary);"></i>
            <div style="font-size: 2.2rem; font-weight: 800;">${temp}°C</div>
            <div style="color: var(--text-dim); font-weight: 500;">Cordignano, TV</div>
        `;
        if (window.lucide) lucide.createIcons();
        return temp;
    } catch (e) {
        return 20;
    }
}

// Matching Intelligence
async function generateOutfit() {
    const temp = await updateWeather();
    const available = closet.filter(i => i.status === 'disponibile');
    
    // Exclusion logic (History)
    const recentIds = history.slice(-2).flatMap(h => h.ids);
    const filteredAvailable = available.filter(i => !recentIds.includes(i.id));
    
    const candidates = filteredAvailable.length > 5 ? filteredAvailable : available;

    const tops = candidates.filter(i => i.category === 'top');
    const bottoms = candidates.filter(i => i.category === 'bottom');
    const shoes = candidates.filter(i => i.category === 'shoes');
    const acc = candidates.filter(i => i.category === 'accessory');

    if (tops.length === 0 || bottoms.length === 0) {
        document.getElementById('suggestion-container').innerHTML = `<p style="padding: 2rem; color: var(--text-dim);">Aggiungi altri capi puliti!</p>`;
        return;
    }

    const t = tops[Math.floor(Math.random() * tops.length)];
    const b = bottoms[Math.floor(Math.random() * bottoms.length)];
    const s = shoes.length > 0 ? shoes[Math.floor(Math.random() * shoes.length)] : null;
    const a = acc.length > 0 ? acc[Math.floor(Math.random() * acc.length)] : null;

    currentSuggestion = [t, b];
    if (s) currentSuggestion.push(s);
    if (a) currentSuggestion.push(a);

    document.getElementById('suggestion-container').innerHTML = `
        <div style="display: flex; gap: 1rem; margin-top: 1rem; overflow-x: auto; padding: 0.5rem 0;">
            <div class="match-item"><img src="${t.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${t.color}"></div>
            <div class="match-item"><img src="${b.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${b.color}"></div>
            ${s ? `<div class="match-item"><img src="${s.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${s.color}"></div>` : ''}
            ${a ? `<div class="match-item"><img src="${a.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${a.color}"></div>` : ''}
        </div>
    `;
    
    document.getElementById('btn-worn').style.display = 'inline-block';
}

// Backup Functions
function exportBackup() {
    const data = {
        closet: closet,
        history: history,
        theme: currentTheme,
        timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `abbinata_backup_${new Date().toLocaleDateString()}.json`;
    a.click();
}

function importBackup(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.closet) {
                    closet = data.closet;
                    history = data.history || [];
                    saveCloset();
                    saveHistory();
                    location.reload();
                }
            } catch (err) {
                showToast("File di backup non valido.");
            }
        };
        reader.readAsText(file);
    }
}

function resetApp() {
    if (confirm("Sei sicuro? Tutti i dati verranno persi.")) {
        localStorage.clear();
        location.reload();
    }
}

function showToast(m) {
    const t = document.createElement('div');
    t.className = "glass-card";
    t.style = "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:10px 20px; border-radius:10px; z-index:1000; animation: fadeIn 0.3s ease-out;";
    t.innerText = m;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
