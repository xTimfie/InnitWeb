const color1 = [90, 160, 255];
const color2 = [0, 255, 0];

const COOLDOWN_MS = 3000;
let rebuildTimer = null;
let cooldownStart = null;
let cooldownRAF = null;
let rebuildPending = false;
let lookalikesCache = null;

let panelMode = "connections";

const distanceSymbols = ["A", "1", "2", "3", "5"];

const toggleDistanceBtn = document.getElementById("toggle-distance");
const cooldownBar = document.getElementById("cooldown-bar");
const overlay = document.getElementById("loading-overlay");
const statusText = document.getElementById("status-text");
const showAllCheckbox = document.getElementById("show-all-players");
const searchInput = document.getElementById('search');
const mutualDiv = document.getElementById("mutual-section");
const nonMutualDiv = document.getElementById("nonmutual-section");
const connectionLists = document.getElementById("connection-lists");
const togglePanelBtn = document.getElementById("toggle-panel");
const profileViewer = document.getElementById("profile-viewer");

    const PHYSICS_FAST = {
    enabled: true,
    stabilization: false,
    barnesHut: {
        gravitationalConstant: -9000000,
        centralGravity: 0.05,
        springLength: 500,
        springConstant: 0.08,
        damping: 0.75,
        avoidOverlap: 1.5
    }
};

const PHYSICS_SLOW = {
    enabled: true,
    stabilization: false,
    barnesHut: {
        gravitationalConstant: -2500000,
        centralGravity: 0.02,
        springLength: 600,
        springConstant: 0.04,
        damping: 0.92,
        avoidOverlap: 1.5
    }
};

let grayVisible = true;
const minConnectionWeights = [1, 3, 5, 10, 20];
let currentWeightModeIndex = 2;
const minConnectionDistance = [Infinity, 1, 2, 3, 5];
let currentDistanceModeIndex = 0;
let currentNode = null;
let nodesMap, mergedEdges, nodes, visNodes, visEdges, network, nodeDegrees;
const urlParams = new URLSearchParams(window.location.search);
let showAll = urlParams.get("all") === "1";
showAllCheckbox.checked = showAll;

showAllCheckbox.addEventListener("change", () => {
    const newUrl = new URL(window.location.href);
    if (showAllCheckbox.checked) newUrl.searchParams.set("all", "1");
    else newUrl.searchParams.delete("all");
    window.location.href = newUrl.toString();
});

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
document.body.appendChild(tooltip);

function attachTooltip(el, text) {
    el.addEventListener("mouseenter", e => {
        tooltip.textContent = text;
        tooltip.style.opacity = "1";
    });
    el.addEventListener("mousemove", e => {
        tooltip.style.left = e.clientX + 12 + "px";
        tooltip.style.top = e.clientY + 12 + "px";
    });
    el.addEventListener("mouseleave", () => {
        tooltip.style.opacity = "0";
    });
}

attachTooltip(toggleDistanceBtn,
    "Limit graph to players within N connection hops of the selected player");

attachTooltip(document.getElementById("toggle-weight"),
    "Hide connections with fewer total mentions");

attachTooltip(document.getElementById("toggle-gray"),
    "Toggle non-mutual (one-way) connections");

attachTooltip(togglePanelBtn,
    "Switch between connection list and detailed profile");

attachTooltip(showAllCheckbox,
    "Include isolated players with no connections");




fetch("./data/graph_optimized.json").then(r => r.json()).then(async data => {

    nodesMap = new Map();
    data.nodes.forEach(n => { 
        if (n.uuid) nodesMap.set(n.uuid, { id: n.uuid, label: n.username || n.uuid }); 
    });

    const rawEdges = [];
    data.edges.forEach(e => { 
        if (e.from_user_id && e.to_user_id) rawEdges.push({ from: e.from_user_id, to: e.to_user_id, weight: Number(e.total_mentions || 1) }); 
    });

    const edgeMap = new Map();
    rawEdges.forEach(e => {
        const key = [e.from, e.to].sort().join("|");
        if (!edgeMap.has(key)) edgeMap.set(key, { s: e.from < e.to ? e.from : e.to, t: e.from < e.to ? e.to : e.from, w1:0, w2:0 });
        const entry = edgeMap.get(key);
        if (e.from === entry.s) entry.w1 += e.weight; else entry.w2 += e.weight;
    });

    mergedEdges = [];
    const connectedIds = new Set();
    edgeMap.forEach(e => {
        if (e.w1 + e.w2 > 0) {
            mergedEdges.push({ s:e.s, t:e.t, w1:e.w1, w2:e.w2, w:e.w1+e.w2, mutual:e.w1>0 && e.w2>0 });
            connectedIds.add(e.s); connectedIds.add(e.t);
        }
    });

    nodes = showAll ? [...nodesMap.values()] : [...nodesMap.values()].filter(n => connectedIds.has(n.id));
    nodeDegrees = {};
    mergedEdges.forEach(e => { nodeDegrees[e.s]=(nodeDegrees[e.s]||0)+1; nodeDegrees[e.t]=(nodeDegrees[e.t]||0)+1; });
    visNodes = new vis.DataSet([]);
    visEdges = new vis.DataSet([]);
    const DEFAULT_SKIN_PATH = "./data/skins/.default/steve_1.png";
    const faceCache = new Map();
    let defaultFaceDataUrl = null;

    function skinUrl(uuid) {
        return `./data/skins/${uuid}.png`;
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }

    function faceDataUrlFromSkinImage(img) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;

        // Minecraft skin layout (64x64):
        // Base head/face: (8,8) size 8x8
        // Hat/overlay:    (40,8) size 8x8
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
        return canvas.toDataURL("image/png");
    }

    async function ensureDefaultFace() {
        if (defaultFaceDataUrl) return defaultFaceDataUrl;
        try {
            const img = await loadImage(DEFAULT_SKIN_PATH);
            defaultFaceDataUrl = faceDataUrlFromSkinImage(img);
        } catch {
            // Tiny transparent PNG as a last-resort fallback
            defaultFaceDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5G9eQAAAAASUVORK5CYII=";
        }
        return defaultFaceDataUrl;
    }

    function getFaceDataUrl(uuid) {
        if (faceCache.has(uuid)) return faceCache.get(uuid);
        const promise = (async () => {
            const fallback = await ensureDefaultFace();
            try {
                const img = await loadImage(skinUrl(uuid));
                return faceDataUrlFromSkinImage(img);
            } catch {
                return fallback;
            }
        })();
        faceCache.set(uuid, promise);
        return promise;
    }

    function interpolateColor(fraction, minColor, maxColor) {
        fraction = Math.max(0, Math.min(1, fraction));
        const r = Math.round(minColor[0] + fraction * (maxColor[0]-minColor[0]));
        const g = Math.round(minColor[1] + fraction * (maxColor[1]-minColor[1]));
        const b = Math.round(minColor[2] + fraction * (maxColor[2]-minColor[2]));
        return `rgb(${r},${g},${b})`;
    }
    const EDGE_COLOR_CONFIG = {
        minColor: color1,
        maxColor: color2,
        maxMentions: 100
    };

    network = new vis.Network(document.getElementById('network'), { nodes: visNodes, edges: visEdges }, {
        nodes: { shape: 'dot', scaling: { min: 5, max: 25 } },
        edges: { smooth: { type: 'continuous' } },
        interaction: { selectConnectedEdges: false }
    });

    async function buildNetworkProgressively(nodesArr, edgesArr) {
        const placeholderFace = await ensureDefaultFace();
        let overlayHidden = false;
        const minWeight = minConnectionWeights[currentWeightModeIndex];
        const filteredEdges = edgesArr.filter(e => (e.mutual || grayVisible) && (e.w1 + e.w2) >= minWeight);
        const connectedIds = new Set();
        filteredEdges.forEach(e => { connectedIds.add(e.s); connectedIds.add(e.t); });
        const filteredNodes = nodesArr.filter(n => connectedIds.has(n.id));
        network.setOptions({ physics: PHYSICS_FAST });
        const NODE_BATCHES = 10;
        const nodeBatchSize = Math.ceil(filteredNodes.length / NODE_BATCHES);
        for (let i=0;i<filteredNodes.length;i+=nodeBatchSize){
            const batch = filteredNodes.slice(i,i+nodeBatchSize);
            const nodeItems = batch.map(n=>({
                id: n.id, label: n.label, shape:'circularImage', image: placeholderFace,
                brokenImage: placeholderFace,
                font:{ face:'Minecraft', size:14, color:"#FFF" }, value:10, shadow:false
            }));
            visNodes.add(nodeItems);
            if (!overlayHidden && visNodes.length >= 50){
                overlayHidden = true;
                overlay.style.transition = "opacity 0.5s";
                overlay.style.opacity = 0;
                setTimeout(()=>overlay.style.display="none",500);
            }
            updateStatus();
            await new Promise(r=>setTimeout(r,0));
        }
        const EDGE_BATCH_SIZE=10;
        for (let i=0;i<filteredEdges.length;i+=EDGE_BATCH_SIZE){
            const batch = filteredEdges.slice(i,i+EDGE_BATCH_SIZE);
            const edgeItems = [];
            for (const e of batch){
                const id=`${e.s}-${e.t}`;
                if (visEdges.get(id)) continue;
                const degreeSum = (nodeDegrees[e.s]||1)+(nodeDegrees[e.t]||1);
                const color = e.mutual
                    ? interpolateColor(Math.min(1, Math.sqrt((e.w1*e.w2)/(EDGE_COLOR_CONFIG.maxMentions**2))),
                        EDGE_COLOR_CONFIG.minColor, EDGE_COLOR_CONFIG.maxColor)
                    : "rgb(192,192,192)";
                edgeItems.push({id, from:e.s, to:e.t, width:1, color, w1:e.w1, w2:e.w2, mutual:e.mutual,
                                length:150+degreeSum*15, smooth:false, shadow:false});
            }
            if(edgeItems.length) visEdges.add(edgeItems);
            updateStatus();
            await new Promise(r=>setTimeout(r,0));
        }
        network.setOptions({ physics: PHYSICS_SLOW });
        await setAvatars(filteredNodes);
    }

    async function setAvatars(nodesArr) {
        const placeholderFace = await ensureDefaultFace();
        const BATCH_SIZE = 20;
        for (let i = 0; i < nodesArr.length; i += BATCH_SIZE) {
            const slice = nodesArr.slice(i, i + BATCH_SIZE);
            const batch = await Promise.all(slice.map(async n => ({
                id: n.id,
                image: await getFaceDataUrl(n.id),
                brokenImage: placeholderFace
            })));
            visNodes.update(batch);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    async function rebuildNetwork() {
        visNodes.clear(); visEdges.clear();
        let filteredNodes = nodes;
        let filteredEdges = mergedEdges;
        if (currentNode && minConnectionDistance[currentDistanceModeIndex] !== Infinity) {
            const maxDist = minConnectionDistance[currentDistanceModeIndex];
            const { nodes: filteredNodesByDist, edges: filteredEdgesByDist } = filterNodesByDistance(currentNode, maxDist);
            filteredNodes = filteredNodesByDist;
            filteredEdges = filteredEdgesByDist;
        }
        await buildNetworkProgressively(filteredNodes, filteredEdges);
    }

        function animateCooldown() {
        const now = performance.now();
        const elapsed = now - cooldownStart;
        const progress = Math.min(elapsed / COOLDOWN_MS, 1);
        cooldownBar.style.width = `${progress * 100}%`;
        if (progress < 1) {
            cooldownRAF = requestAnimationFrame(animateCooldown);
        }
    }

    function renderSection(div, title, edges, nodeId){
        if(!edges.length){
            div.innerHTML = `<b>${title}</b><br><i><span style="color: gray;">No connections</span></i>`; return;
        }
        const list = edges.map(e=>{ const other = e.from===nodeId?e.to:e.from; return {label:visNodes.get(other)?.label||other,id:other,weight:e.w1+e.w2};})
                          .sort((a,b)=>b.weight-a.weight);
        div.innerHTML = `<b>${title}</b><br>` + list.map(c=>`<div class="connection-item" data-id="${c.id}">${c.label}</div>`).join("");
        div.querySelectorAll(".connection-item").forEach(el=>{
            el.addEventListener("click", async ()=>{
                selectPlayer(el.dataset.id);
            });
        });
    }

    async function scheduleRebuild() {
        rebuildPending = true;
        if (cooldownRAF) cancelAnimationFrame(cooldownRAF) ;
        cooldownBar.style.width = "0%";
        cooldownStart = performance.now();
        animateCooldown();
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(async () => {
            await rebuildNetwork();
            rebuildPending = false;
            cooldownBar.style.width = "100%";
        }, COOLDOWN_MS);
    }


    function showConnections(nodeId){
        connectionLists.classList.remove("hidden");
        const edges = visEdges.get({filter:e=>e.from===nodeId||e.to===nodeId});
        renderSection(mutualDiv,"Mutual Connections:",edges.filter(e=>e.mutual),nodeId);
        if(grayVisible){
            nonMutualDiv.classList.remove("hidden");
            renderSection(nonMutualDiv,"Non-Mutual Connections:",edges.filter(e=>!e.mutual),nodeId);
        } else nonMutualDiv.classList.add("hidden");
    }

    async function showProfile(nodeId) {
        const node = nodesMap.get(nodeId);
        if (!node) return;
        const profile = document.getElementById("profile-content");
        profile.innerHTML = `<div style="text-align:center;">Loading details...</div>`;
        try {
            const response = await fetch("./data/graph.json");
            const data = await response.json();
            const detailedNode = data.nodes.find(n => n.uuid === nodeId);
            const edgesForNode = data.edges.filter(e => e.from_user_id === nodeId || e.to_user_id === nodeId);
            const playtimeHours = detailedNode?.total_playtime_secs
                ? (detailedNode.total_playtime_secs / 3600).toFixed(1) + "h"
                : "N/A";
            let lastSeen = "Unknown";
            if (detailedNode?.last_join_time) {
                const lastDate = new Date(detailedNode.last_join_time);
                const diffMs = Date.now() - lastDate.getTime();
                const diffH = Math.floor(diffMs / (1000*60*60));
                lastSeen = diffH < 1 ? "Just now" : `${diffH} hours ago`;
            }
            const topConnections = edgesForNode
                .sort((a,b) => (b.total_mentions||0) - (a.total_mentions||0))
                .slice(0,5)
                .map(e => {
                    const otherId = e.from_user_id === nodeId ? e.to_user_id : e.from_user_id;
                    const otherNode = nodesMap.get(otherId);
                    return `${otherNode?.label || otherId} ~ (${e.total_mentions || 0} mentions)`;
                });
            profile.innerHTML = `
                <div style="text-align:center; margin-bottom:12px;">
                    <img
                        src="${skinUrl(node.id)}"
                        onerror="this.onerror=null;this.src='${DEFAULT_SKIN_PATH}';"
                        style="width:120px; image-rendering:pixelated;"
                    />
                </div>
                <div><b>Username:</b> ${node.label}</div>
                <div><b>UUID:</b> ${node.id}</div>
                <hr>
                <div><b>Total Joins:</b> ${detailedNode?.total_joins ?? "N/A"}</div>
                <div><b>Last Seen:</b> ${lastSeen}</div>
                <div><b>Playtime:</b> ${playtimeHours}</div>
                <div><b>Kills:</b> ${detailedNode?.total_kills ?? 0}</div>
                <div><b>Deaths:</b> ${detailedNode?.total_deaths ?? 0}</div>
                <div><b>K/D:</b> ${detailedNode ? ((detailedNode.total_kills || 0)/(detailedNode.total_deaths||1)).toFixed(2) : "N/A"}</div>
                <div><b>Messages:</b> ${detailedNode?.total_messages ?? 0}</div>
                <hr>
                <div><b>Top Connections:</b><br>${topConnections.join("<br>") || "None"}</div>
                <hr>
                <div id="lookalikes-section"></div>
            `;
            renderLookalikes(nodeId);
        } catch (err) {
            profile.innerHTML = `<div style="color:red;">Failed to load profile details</div>`;
            console.error(err);
        }
    }

    async function renderLookalikes(nodeId) {
        const section = document.getElementById("lookalikes-section");
        section.innerHTML = `<b>Lookalikes</b><br><i style="color:gray;">Loading...</i>`;
        try {
            if (!lookalikesCache) {
                const res = await fetch("./data/lookalikes.json");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                lookalikesCache = await res.json();
            }
            const list = lookalikesCache[nodeId];
            if (!list || !list.length) {
                section.innerHTML = `<b>Lookalikes</b><br><i style="color:gray;">None found</i>`;
                return;
            }
            section.innerHTML =
                `<b>Lookalikes</b><br>` +
                list.slice(0, 5).map(l => `
                    <div class="connection-item lookalike-item" data-id="${l.uuid}">
                        ${l.username}
                        <span style="color:gray;">(${l.similarity.toFixed(1)}%)</span>
                    </div>
                `).join("");
            section.querySelectorAll(".lookalike-item").forEach(el => {
                el.addEventListener("click", () => selectPlayer(el.dataset.id));
            });
        } catch (e) {
            section.innerHTML =
                `<b>Lookalikes</b><br><span style="color:red;">Failed to load: ${e}</span>`;
            console.error("Failed to fetch lookalikes.json:", e);
        }
    }



    function filterNodesByDistance(anchorId, maxDist) {
        if (!anchorId || maxDist === Infinity) return { nodes: nodes, edges: mergedEdges };
        const levelMap = new Map([[anchorId, 0]]);
        const queue = [anchorId];
        while (queue.length) {
            const nodeId = queue.shift();
            const currentLevel = levelMap.get(nodeId);
            if (currentLevel >= maxDist) continue;
            mergedEdges.forEach(e => {
                const neighbor = (e.s === nodeId) ? e.t : (e.t === nodeId ? e.s : null);
                if (!neighbor) return;
                if (!levelMap.has(neighbor)) {
                    levelMap.set(neighbor, currentLevel + 1);
                    queue.push(neighbor);
                }
            });
        }
        const visited = new Set(levelMap.keys());
        const filteredNodes = nodes.filter(n => visited.has(n.id));
        const filteredEdges = mergedEdges.filter(e => visited.has(e.s) && visited.has(e.t));
        return { nodes: filteredNodes, edges: filteredEdges };
    }

    async function selectPlayer(nodeId){
        currentNode=nodeId;
        searchInput.value = nodesMap.get(nodeId)?.label || nodeId;
        if(minConnectionDistance[currentDistanceModeIndex]!==Infinity){
            await scheduleRebuild();
        }
        if (panelMode === "connections") {
            showConnections(nodeId);
        } else {
            showProfile(nodeId);
        }
        network.focus(nodeId,{scale:3,animation:{duration:500,easingFunction:'easeInOutQuad'}});
    }


    const index = {};
    nodes.forEach(n=>index[n.label.toLowerCase()]=n.id);
    searchInput.addEventListener("input", async () => {
        const name = searchInput.value.trim().toLowerCase();
        const id = index[name];
        if (!id) return;
        currentNode = id;
        if (minConnectionDistance[currentDistanceModeIndex] !== Infinity) {
            await scheduleRebuild();
        }
        if (panelMode === "connections") {
            showConnections(id);
        } else {
            showProfile(id);
        }
        network.focus(id, {
            scale: 3,
            animation: {
                duration: 500,
                easingFunction: "easeInOutQuad"
            }
        });
    });

    toggleDistanceBtn.addEventListener("click", async () => {
        currentDistanceModeIndex =
            (currentDistanceModeIndex + 1) % minConnectionDistance.length;
        toggleDistanceBtn.textContent =
            distanceSymbols[currentDistanceModeIndex];
        if (currentNode) {
            await scheduleRebuild();
        }
    });

    network.on("selectNode", params=>{
        if(minConnectionDistance[currentDistanceModeIndex]!==Infinity){
            selectPlayer(params.nodes[0]);
        } else {
            currentNode=params.nodes[0];
            searchInput.value = visNodes.get(currentNode)?.label || currentNode;
            if (panelMode === "connections") {
                showConnections(currentNode);
            } else {
                showProfile(currentNode);
            }
        }
    });
    network.on("deselectNode",()=>{ currentNode=null; connectionLists.classList.add("hidden"); });

    document.getElementById("toggle-gray").addEventListener("click",async ()=>{
        grayVisible=!grayVisible;
        document.getElementById("toggle-gray").textContent = grayVisible?"->":"<-->";
        await scheduleRebuild();
    });

    document.getElementById("toggle-weight").addEventListener("click",async ()=>{
        currentWeightModeIndex = (currentWeightModeIndex+1)%minConnectionWeights.length;
        const symbols=["I","III","V","X","XX"];
        document.getElementById("toggle-weight").textContent = symbols[currentWeightModeIndex];
        await scheduleRebuild();
    });

    togglePanelBtn.addEventListener("click", () => {
        if (panelMode === "connections") {
            panelMode = "profile";
            togglePanelBtn.textContent = "#";
            connectionLists.classList.add("hidden");
            profileViewer.classList.remove("hidden");
            if (currentNode) showProfile(currentNode);
        } else {
            panelMode = "connections";
            togglePanelBtn.textContent = "=";
            profileViewer.classList.add("hidden");
            connectionLists.classList.remove("hidden");
            if (currentNode) showConnections(currentNode);
        }
    });

    function updateStatus(){
        const visibleNodes = visNodes.get().length;
        const visibleEdges = visEdges.get({filter:e=>!e.hidden}).length;
        statusText.textContent=`Players: ${visibleNodes} | Connections: ${visibleEdges}`;
    }

    await buildNetworkProgressively(nodes, mergedEdges);
});