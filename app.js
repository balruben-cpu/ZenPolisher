const GITHUB_USER = "balruben-cpu";
const GITHUB_REPO = "Zen_Data";
const GITHUB_BRANCH = "main";
const LANG = "en"; // Hardcoded for now, can be selectable later

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
const elApp = document.getElementById("app");
const elLoading = document.getElementById("loading");

// Init
function init() {
    elToken.value = currentToken;
    if (currentToken) {
        // Attempt to load
        fetchPack();
    } else {
        showStatus("Please enter your GitHub Token to start.");
    }

    // Bind Inputs used for navigation
    elLevelId.addEventListener('change', (e) => jumpToLevel(parseInt(e.target.value)));
}

// --- GitHub API ---

async function fetchPack() {
    if (!currentToken) {
        showStatus("Missing Token!");
        return;
    }

    showLoading(true);
    showStatus("Fetching from GitHub...");

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${LANG}/pack_1.json?ref=${GITHUB_BRANCH}`;

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

        // Decode Content (Base64)
        // Note: content can have newlines
        const cleanContent = data.content.replace(/\n/g, "");
        const jsonString = atob(cleanContent);

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

    showLoading(true);
    showStatus("Syncing to GitHub...");

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${LANG}/pack_1.json`;

    // Prepare Content
    // We typically want to save just the array if that's how it's stored, 
    // but the Unity tool wraps it in a wrapper internally but might save it differently.
    // Unity tool: SaveLocal() -> JsonUtility.ToJson(m_CurrentPack) -> writes to file.
    // So it SAVES the wrapper `{"Levels": [...]}`.

    const contentStr = JSON.stringify(currentPack, null, 2);
    const contentBase64 = btoa(unescape(encodeURIComponent(contentStr))); // Unicode safe b64

    const body = {
        message: `Update ${LANG}/pack_1.json via Web Polisher`,
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
