// Initialization and State
const DEMO_ASSETS = [
    { id: 1, category: 'top', color: '#ffffff', image: './assets/white_tee.png', status: 'disponibile' },
    { id: 2, category: 'bottom', color: '#1e3a8a', image: './assets/blue_jeans.png', status: 'disponibile' },
    { id: 3, category: 'shoes', color: '#d1d5db', image: './assets/sneakers.png', status: 'disponibile' },
    { id: 4, category: 'accessory', color: '#000000', image: './assets/watch.png', status: 'disponibile' }
];

let closet = JSON.parse(localStorage.getItem('abbinata_closet'));
if (!closet || closet.length === 0) {
    closet = DEMO_ASSETS;
    localStorage.setItem('abbinata_closet', JSON.stringify(closet));
}

let currentTheme = localStorage.getItem('abbinata_theme') || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);

document.addEventListener('DOMContentLoaded', () => {
    updateDashboardCounts();
    renderCloset();
    updateWeather();
    updateThemeIcon();
    
    // Initial Outfit Suggestion
    setTimeout(generateOutfit, 500);
});

// Theme Logic
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('abbinata_theme', currentTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (currentTheme === 'light') {
        icon.setAttribute('data-lucide', 'sun');
    } else {
        icon.setAttribute('data-lucide', 'moon');
    }
    if (window.lucide) lucide.createIcons();
}

// Navigation
function switchSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');
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
        status: 'disponibile'
    };
    
    closet.push(newItem);
    localStorage.setItem('abbinata_closet', JSON.stringify(closet));
    
    // Reset
    pendingImage = null;
    document.getElementById('upload-form').style.display = 'none';
    document.querySelector('.upload-zone').style.display = 'block';
    
    renderCloset();
    updateDashboardCounts();
    switchSection('armadio');
    showToast('Capo salvato!');
}

// Rendering
function renderCloset() {
    const container = document.getElementById('clothes-grid');
    container.innerHTML = '';
    
    let currentFilter = document.querySelector('.filter-chip.active').innerText.toLowerCase();
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
                    <div style="width: 14px; height: 14px; border-radius: 50%; background: ${item.color}; border: 1px solid rgba(0,0,0,0.1);"></div>
                </div>
                <div style="display: flex; gap: 0.4rem; margin-top: 1rem;">
                    <button class="nav-btn" onclick="updateStatus(${item.id}, 'disponibile')" style="padding: 5px;"><i data-lucide="sparkles" size="14"></i></button>
                    <button class="nav-btn" onclick="updateStatus(${item.id}, 'sporco')" style="padding: 5px;"><i data-lucide="droplets" size="14"></i></button>
                    <button class="nav-btn" onclick="updateStatus(${item.id}, 'lavaggio')" style="padding: 5px;"><i data-lucide="refresh-cw" size="14"></i></button>
                    <button class="nav-btn" onclick="deleteItem(${item.id})" style="padding: 5px; color: var(--accent-red); margin-left: auto;"><i data-lucide="trash-2" size="14"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
}

function updateStatus(id, status) {
    closet = closet.map(i => i.id === id ? {...i, status} : i);
    localStorage.setItem('abbinata_closet', JSON.stringify(closet));
    renderCloset();
    updateDashboardCounts();
}

function deleteItem(id) {
    if (confirm('Eliminare questo capo?')) {
        closet = closet.filter(i => i.id !== id);
        localStorage.setItem('abbinata_closet', JSON.stringify(closet));
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

// Matching
async function generateOutfit() {
    const temp = await updateWeather();
    const available = closet.filter(i => i.status === 'disponibile');
    
    const tops = available.filter(i => i.category === 'top');
    const bottoms = available.filter(i => i.category === 'bottom');
    const shoes = available.filter(i => i.category === 'shoes');
    const acc = available.filter(i => i.category === 'accessory');

    if (tops.length === 0 || bottoms.length === 0) {
        document.getElementById('suggestion-container').innerHTML = `<p style="padding: 2rem; color: var(--text-dim);">Aggiungi altri capi puliti per i suggerimenti!</p>`;
        return;
    }

    const t = tops[Math.floor(Math.random() * tops.length)];
    const b = bottoms[Math.floor(Math.random() * bottoms.length)];
    const s = shoes.length > 0 ? shoes[Math.floor(Math.random() * shoes.length)] : null;
    const a = acc.length > 0 ? acc[Math.floor(Math.random() * acc.length)] : null;

    document.getElementById('suggestion-container').innerHTML = `
        <div style="display: flex; gap: 1rem; margin-top: 1rem; overflow-x: auto; padding: 0.5rem 0;">
            <div class="match-item"><img src="${t.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${t.color}"></div>
            <div class="match-item"><img src="${b.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${b.color}"></div>
            ${s ? `<div class="match-item"><img src="${s.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${s.color}"></div>` : ''}
            ${a ? `<div class="match-item"><img src="${a.image}" style="width: 100px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid ${a.color}"></div>` : ''}
        </div>
        <div style="margin-top: 1rem; font-size: 0.85rem; border-left: 3px solid var(--primary); padding-left: 1rem;">
            Outfit suggerito per i ${temp}°C di Cordignano.
        </div>
    `;
}

function showToast(m) {
    const t = document.createElement('div');
    t.style = "position:fixed; bottom:20px; right:20px; background:var(--primary); color:white; padding:10px 20px; border-radius:10px; z-index:1000;";
    t.innerText = m;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
}
