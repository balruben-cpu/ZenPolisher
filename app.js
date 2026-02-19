const GITHUB_USER = "balruben-cpu";
const GITHUB_REPO = "Zen_Data";
const GITHUB_BRANCH = "main";
let LANG = localStorage.getItem("ZenLang") || "en";

// State
let currentToken = localStorage.getItem("ZenGithubToken") || "";
let currentLevelId = 1;
let currentPack = { Levels: [] };
let packSha = ""; // Required for updating file on GitHub

// DOM Elements
const elStatus = document.getElementById("status-bar");
const elLevelId = document.getElementById("level-id");
const elCategory = document.getElementById("category");
const elSubcategory = document.getElementById("subcategory");
const elWordsContainer = document.getElementById("words-container");
const elToken = document.getElementById("github-token");
const elLang = document.getElementById("lang-select");
const elPack = document.getElementById("pack-select");
const elApp = document.getElementById("app");
const elLoading = document.getElementById("loading");

// Init
function init() {
    elToken.value = currentToken;
    elLang.value = LANG;

    if (currentToken) {
        // Load Manifest first, then Pack
        fetchManifest();
    } else {
        showStatus("Please enter your GitHub Token to start.");
    }

    // Bind Inputs used for navigation
    elLevelId.addEventListener('change', (e) => jumpToLevel(parseInt(e.target.value)));
}

window.changeLang = () => {
    LANG = elLang.value;
    localStorage.setItem("ZenLang", LANG);
    // Reset data
    currentPack = { Levels: [] };
    renderLevel(); // Clear UI
    if (currentToken) fetchManifest();
};

window.changePack = () => {
    // Pack changed
    if (currentToken) fetchPack();
};

// --- GitHub API ---

// --- UTF-8 Safe Base64 Helpers ---

function uint8ArrayToBase64(uint8Array) {
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function b64DecodeUnicode(str) {
    try {
        const bytes = base64ToUint8Array(str.replace(/\s/g, ""));
        return new TextDecoder().decode(bytes);
    } catch (e) {
        console.error("Decoding error:", e);
        return "";
    }
}

function b64EncodeUnicode(str) {
    const bytes = new TextEncoder().encode(str);
    return uint8ArrayToBase64(bytes);
}

async function fetchManifest() {
    if (!currentToken) return;

    showStatus("Fetching Manifest...");
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${LANG}/manifest.json?ref=${GITHUB_BRANCH}`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `token ${currentToken}` } });
        if (!response.ok) {
            // Fallback if manifest doesn't exist
            console.warn("Manifest not found, defaulting to pack_1.json");
            populatePackSelect(["pack_1.json"]);
            fetchPack();
            return;
        }

        const data = await response.json();
        const content = b64DecodeUnicode(data.content.replace(/\n/g, ""));
        const manifest = JSON.parse(content);

        populatePackSelect(manifest.Packs || ["pack_1.json"]);
        fetchPack(); // Load first pack

    } catch (e) {
        console.error(e);
        // Fallback
        populatePackSelect(["pack_1.json"]);
        fetchPack();
    }
}

function populatePackSelect(packs) {
    elPack.innerHTML = "";
    packs.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p.replace(".json", "").replace("_", " ").toUpperCase();
        elPack.appendChild(opt);
    });
}

async function fetchPack() {
    let packName = elPack.value || "pack_1.json";

    if (!currentToken) {
        showStatus("Missing Token!");
        return;
    }

    showLoading(true);
    showStatus(`Fetching ${packName}...`);

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${LANG}/${packName}?ref=${GITHUB_BRANCH}`;

    try {
        const response = await fetch(url, {
            headers: {
                "Authorization": `token ${currentToken}`,
                "Accept": "application/vnd.github.v3+json"
            }
        });

        if (!response.ok) throw new Error(`GitHub Error: ${response.status}`);

        const data = await response.json();
        packSha = data.sha;

        // Decode Content (Base64) - UTF-8 Safe
        const cleanContent = data.content.replace(/\n/g, "");
        const jsonString = b64DecodeUnicode(cleanContent);

        // Parse
        // The file might be a bare array or wrapped object.
        // ZenLevelPolisher.cs handles both. Let's assume bare array for now but check.
        // Wait, ZenLevelPolisher logic: if (json[0] != '{') json = "{\"Levels\":" + json + "}";
        // So strict JSON might be `[...]`.

        try {
            let parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed)) {
                currentPack = { Levels: parsed };
            } else {
                currentPack = parsed;
            }
        } catch (e) {
            // Fallback for wrapped fix if needed, but let's assume valid JSON for now.
            throw new Error("Failed to parse JSON content.");
        }

        currentPack.Levels.sort((a, b) => a.level_id - b.level_id);

        renderLevel();
        showStatus("Loaded Pack 1 (EN)");
    } catch (e) {
        showStatus(`Error: ${e.message}`);
        console.error(e);
    } finally {
        showLoading(false);
    }
}

async function syncToGitHub() {
    if (!currentToken) return;

    let packName = elPack.value || "pack_1.json";

    showLoading(true);
    showStatus(`Syncing ${packName} to GitHub...`);

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${LANG}/${packName}`;

    // Check if we have the SHA for THIS pack? 
    // fetchPack() sets packSha. Assuming we just loaded it.

    // Prepare Content
    // We typically want to save just the array if that's how it's stored, 
    // but the Unity tool wraps it in a wrapper internally but might save it differently.
    // Unity tool: SaveLocal() -> JsonUtility.ToJson(m_CurrentPack) -> writes to file.
    // So it SAVES the wrapper `{"Levels": [...]}`.

    const contentStr = JSON.stringify(currentPack, null, 2);
    const contentBase64 = b64EncodeUnicode(contentStr);

    const body = {
        message: `Update ${LANG}/${packName} via Web Polisher`,
        content: contentBase64,
        sha: packSha,
        branch: GITHUB_BRANCH
    };

    try {
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `token ${currentToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error(`Push Failed: ${response.status}`);

        const data = await response.json();
        packSha = data.content.sha; // Update SHA for next write

        showStatus("Pack Synced Successfully!");

        // Update Version
        await updateVersion();

    } catch (e) {
        showStatus(`Sync Error: ${e.message}`);
    } finally {
        showLoading(false);
    }
}

async function updateVersion() {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/version.txt`;

    try {
        // 1. Get SHA
        const getRes = await fetch(url + `?ref=${GITHUB_BRANCH}`, {
            headers: { "Authorization": `token ${currentToken}` }
        });
        const getData = await getRes.json();

        // 2. Increment
        let ver = 1;
        if (getRes.ok) {
            const content = atob(getData.content.replace(/\n/g, ""));
            ver = parseInt(content) + 1;
        }

        // 3. Put
        const body = {
            message: `Update version to ${ver}`,
            content: btoa(ver.toString()),
            sha: getData.sha,
            branch: GITHUB_BRANCH
        };

        await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `token ${currentToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        showStatus(`Version bump to ${ver} Complete`);

    } catch (e) {
        console.error("Version update failed", e);
    }
}

// --- UI Logic ---

function renderLevel() {
    // Find Level
    let level = currentPack.Levels.find(l => l.level_id === currentLevelId);

    if (!level) {
        // Option to create?
        elCategory.value = "";
        elSubcategory.value = "";
        elWordsContainer.innerHTML = "<p>Level not found. <button onclick='createLevel()'>Create Level</button></p>";
        elLevelId.value = currentLevelId;
        return;
    }

    elLevelId.value = currentLevelId;
    elCategory.value = level.category || "";
    elSubcategory.value = level.subcategory || "";

    // Render Words
    elWordsContainer.innerHTML = "";
    if (level.puzzles) {
        level.puzzles.forEach((p, index) => {
            const card = document.createElement("div");
            card.className = "word-card";
            card.innerHTML = `
                <div class="word-header">
                    <strong>Word ${index + 1}</strong>
                    <button class="danger" onclick="removeWord(${index})">X</button>
                </div>
                <div class="field-group">
                    <input type="text" value="${p.word}" onchange="updateWord(${index}, 'word', this.value)" placeholder="WORD">
                </div>
                <div class="field-group">
                    <label>Riddle</label>
                    <input type="text" value="${p.riddle}" onchange="updateWord(${index}, 'riddle', this.value)">
                </div>
                <div class="field-group">
                    <label>Hard Riddle</label>
                    <input type="text" value="${p.riddle_hard || ''}" onchange="updateWord(${index}, 'riddle_hard', this.value)">
                </div>
            `;
            elWordsContainer.appendChild(card);
        });
    }

    // Add Button
    const addBtn = document.createElement("div");
    addBtn.innerHTML = `<button class="primary" style="width:100%" onclick="addWord()">+ Add Word</button>`;
    elWordsContainer.appendChild(addBtn);
}

// --- Data Modification ---

window.saveMeta = () => {
    let level = currentPack.Levels.find(l => l.level_id === currentLevelId);
    if (level) {
        level.category = elCategory.value;
        level.subcategory = elSubcategory.value;
    }
}

window.updateWord = (index, field, value) => {
    let level = currentPack.Levels.find(l => l.level_id === currentLevelId);
    if (level && level.puzzles[index]) {
        if (field === 'word') value = value.toUpperCase();
        level.puzzles[index][field] = value;
    }
};

window.addWord = () => {
    let level = currentPack.Levels.find(l => l.level_id === currentLevelId);
    if (level) {
        if (!level.puzzles) level.puzzles = [];
        level.puzzles.push({ word: "NEW", riddle: "", riddle_hard: "" });
        renderLevel();
    }
};

window.removeWord = (index) => {
    let level = currentPack.Levels.find(l => l.level_id === currentLevelId);
    if (level && confirm("Delete this word?")) {
        level.puzzles.splice(index, 1);
        renderLevel();
    }
};

window.createLevel = () => {
    if (!currentPack.Levels) currentPack.Levels = [];
    currentPack.Levels.push({
        level_id: currentLevelId,
        category: "New",
        subcategory: "New",
        grid_size: 25,
        puzzles: []
    });
    currentPack.Levels.sort((a, b) => a.level_id - b.level_id);
    renderLevel();
};

window.jumpToLevel = (id) => {
    if (id < 1) id = 1;
    currentLevelId = id;
    renderLevel();
};

window.navLevel = (delta) => {
    jumpToLevel(currentLevelId + delta);
};

window.saveToken = () => {
    const val = elToken.value.trim();
    if (val) {
        localStorage.setItem("ZenGithubToken", val);
        currentToken = val;
        showStatus("Token Saved");
        fetchPack();
    }
};

window.forcePull = () => {
    fetchPack();
};

window.pushToGithub = () => {
    syncToGitHub();
};

// --- Utils ---

function showStatus(msg) {
    elStatus.textContent = msg;
    elStatus.style.opacity = 1;
    setTimeout(() => { elStatus.style.opacity = 0.7; }, 3000);
}

function showLoading(active) {
    elLoading.style.display = active ? "flex" : "none";
}

// Start
init();
