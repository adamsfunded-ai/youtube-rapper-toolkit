(function () {
  "use strict";

  /* ===================================================================
     YouTube Rapper Toolkit v1.4.0
     1. Sort by Recently Added (Watch Later page)
     2. Beat Looper — persistent loop state, never resets your in-point
     3. One-click MP3 download via local server (no third-party sites)
     =================================================================== */

  const SORT_BTN_ID = "yt-wl-sort-btn";
  const LOOP_PANEL_ID = "yt-beat-loop-panel";
  const DL_ROW_ID = "yt-mp3-download-row";

  // ─── DOWNLOAD SERVER CONFIG ───────────────────────────────────────
  // The download server runs locally on your machine. YouTube blocks
  // cloud/datacenter IPs, so local is the only reliable way.
  // Just run: cd server && npm start
  const LOCAL_SERVER = "http://127.0.0.1:3456";

  // ─── State ────────────────────────────────────────────────────────
  let loopEnabled = false;
  let loopStart = 0;
  let loopEnd = 0;
  let videoDuration = 0;
  let loopCheckInterval = null;
  let playerRef = null;
  let loopBoundHandler = null;
  let loopEndedHandler = null;

  // Key/BPM detection state — persists across row rebuilds for the same video
  let detectedKey = "";
  let detectedBpm = "";
  let detectedForVideoId = null;

  // ─── Helpers ──────────────────────────────────────────────────────
  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function parseTimeInput(str) {
    const parts = str.split(":").map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
  }

  function getPlayer() {
    if (playerRef && playerRef.isConnected) return playerRef;
    const el = document.querySelector("video.html5-main-video") ||
               document.querySelector("video");
    if (el) playerRef = el;
    return el;
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  function isWatchLaterPage() {
    return window.location.href.includes("list=WL");
  }

  function isVideoPage() {
    return window.location.pathname === "/watch";
  }

  function showFeedback(message) {
    const existing = document.getElementById("yt-wl-sort-feedback");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "yt-wl-sort-feedback";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // =====================================================================
  //  LOOP STATE PERSISTENCE — saves to localStorage per video ID
  // =====================================================================

  function getStorageKey() {
    const vid = getVideoId();
    return vid ? "yt-rapper-loop-" + vid : null;
  }

  function saveLoopState() {
    const key = getStorageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        loopStart: loopStart,
        loopEnd: loopEnd,
        loopEnabled: loopEnabled,
        savedAt: Date.now(),
      }));
    } catch (e) { /* quota exceeded — ignore */ }
  }

  function loadLoopState() {
    const key = getStorageKey();
    if (!key) return false;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      // Only restore if saved within the last 7 days
      if (Date.now() - data.savedAt > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return false;
      }
      if (typeof data.loopStart === "number") loopStart = data.loopStart;
      if (typeof data.loopEnd === "number") loopEnd = data.loopEnd;
      if (typeof data.loopEnabled === "boolean" && data.loopEnabled) {
        // We'll re-enable loop after the panel is built
        return true;
      }
    } catch (e) { /* parse error — ignore */ }
    return false;
  }

  function clearOldLoopStates() {
    // Cleanup loop states older than 7 days to prevent localStorage bloat
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("yt-rapper-loop-")) {
          const raw = localStorage.getItem(key);
          try {
            const data = JSON.parse(raw);
            if (Date.now() - data.savedAt > 7 * 24 * 60 * 60 * 1000) {
              keysToRemove.push(key);
            }
          } catch (e) { keysToRemove.push(key); }
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  // Run cleanup once on load
  clearOldLoopStates();

  // ─── SORT FEATURE (Watch Later page) ─────────────────────────────
  function clickSortByRecentlyAdded() {
    const sortMenuButton =
      document.querySelector("yt-sort-filter-sub-menu-renderer yt-dropdown-menu tp-yt-paper-menu-button") ||
      document.querySelector("yt-sort-filter-sub-menu-renderer #button") ||
      document.querySelector("yt-chip-cloud-chip-renderer:not([selected])");

    if (!sortMenuButton) {
      const sortButtons = document.querySelectorAll(
        "yt-sort-filter-sub-menu-renderer tp-yt-paper-menu-button #button, " +
        "yt-sort-filter-sub-menu-renderer .dropdown-trigger"
      );
      if (sortButtons.length > 0) {
        sortButtons[0].click();
        setTimeout(selectNewestOption, 400);
        return;
      }
      showFeedback("Sort menu not found.");
      return;
    }
    sortMenuButton.click();
    setTimeout(selectNewestOption, 400);
  }

  function selectNewestOption() {
    const menuItems = document.querySelectorAll(
      "tp-yt-paper-listbox a, tp-yt-paper-listbox tp-yt-paper-item, " +
      "ytd-menu-service-item-renderer, tp-yt-paper-listbox .item"
    );
    let clicked = false;
    for (const item of menuItems) {
      const text = (item.textContent || "").trim().toLowerCase();
      if (text.includes("date added (newest)") || text.includes("recently added") ||
          text.includes("newest first") || text.includes("date added")) {
        item.click();
        clicked = true;
        showFeedback("Sorted by recently added!");
        break;
      }
    }
    if (!clicked) {
      if (menuItems.length >= 2) { menuItems[1].click(); showFeedback("Sort option selected."); }
      else if (menuItems.length === 1) { menuItems[0].click(); showFeedback("Sort option selected."); }
      else { showFeedback("Could not find sort options."); }
    }
  }

  function injectSortButton() {
    if (document.getElementById(SORT_BTN_ID)) return;
    const headerActions =
      document.querySelector("ytd-playlist-header-renderer #top-level-buttons-computed") ||
      document.querySelector("ytd-playlist-header-renderer .metadata-action-bar") ||
      document.querySelector("ytd-playlist-header-renderer #owner-text")?.parentElement ||
      document.querySelector("#page-header .metadata-text-wrapper") ||
      document.querySelector("ytd-playlist-header-renderer");
    if (!headerActions) return;

    const btn = document.createElement("button");
    btn.id = SORT_BTN_ID;
    btn.type = "button";
    btn.textContent = "Sort: Recently Added";
    btn.title = "Sort Watch Later by most recently added";
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); clickSortByRecentlyAdded(); });
    headerActions.appendChild(btn);
  }

  // =====================================================================
  //  BEAT LOOPER — with persistent state + fixed loop enforcement
  // =====================================================================

  function buildLoopPanel() {
    if (document.getElementById(LOOP_PANEL_ID)) return;

    const player = getPlayer();
    if (!player) return;

    videoDuration = player.duration;
    if (!videoDuration || isNaN(videoDuration) || videoDuration === Infinity) {
      player.addEventListener("loadedmetadata", () => {
        videoDuration = player.duration;
        if (videoDuration && !isNaN(videoDuration)) buildLoopPanel();
      }, { once: true });
      player.addEventListener("durationchange", () => {
        videoDuration = player.duration;
        if (videoDuration && !isNaN(videoDuration)) buildLoopPanel();
      }, { once: true });
      return;
    }

    // Load saved state, or default to full video
    loopStart = 0;
    loopEnd = videoDuration;
    loopEnabled = false;
    const shouldReEnableLoop = loadLoopState();
    // Clamp loaded values to current video duration
    if (loopStart > videoDuration) loopStart = 0;
    if (loopEnd > videoDuration || loopEnd <= loopStart) loopEnd = videoDuration;

    const panel = document.createElement("div");
    panel.id = LOOP_PANEL_ID;

    // Header
    const header = document.createElement("div");
    header.className = "loop-header";
    const titleEl = document.createElement("div");
    titleEl.className = "loop-title";
    const loopIcon = document.createElement("span");
    loopIcon.className = "loop-icon";
    loopIcon.textContent = "\uD83D\uDD01";
    titleEl.appendChild(loopIcon);
    titleEl.appendChild(document.createTextNode(" BEAT LOOPER"));
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "loop-toggle-btn";
    toggleBtn.id = "loop-toggle-btn";
    toggleBtn.textContent = "OFF";
    toggleBtn.title = "Toggle loop on/off (Keyboard: L)";
    toggleBtn.addEventListener("click", () => toggleLoop());
    header.appendChild(titleEl);
    header.appendChild(toggleBtn);

    // Time row
    const timeRow = document.createElement("div");
    timeRow.className = "loop-time-row";

    // Start group
    const startGroup = document.createElement("div");
    startGroup.className = "loop-time-group";
    const startLabel = document.createElement("label");
    startLabel.textContent = "START";
    startLabel.className = "loop-label";
    const startInput = document.createElement("input");
    startInput.type = "text";
    startInput.id = "loop-start-input";
    startInput.className = "loop-time-input";
    startInput.value = formatTime(loopStart);
    startInput.title = "Type start time (e.g. 0:23)";
    const startSetBtn = document.createElement("button");
    startSetBtn.className = "loop-set-btn";
    startSetBtn.textContent = "SET";
    startSetBtn.title = "Set loop start to current video time";
    startSetBtn.addEventListener("click", () => { const p = getPlayer(); if (p) setLoopStart(p.currentTime); });
    const startNudge = document.createElement("div");
    startNudge.className = "loop-nudge";
    const startMinus = document.createElement("button");
    startMinus.className = "loop-nudge-btn";
    startMinus.textContent = "- 0.5s";
    startMinus.addEventListener("click", () => setLoopStart(Math.max(0, loopStart - 0.5)));
    const startPlus = document.createElement("button");
    startPlus.className = "loop-nudge-btn";
    startPlus.textContent = "+ 0.5s";
    startPlus.addEventListener("click", () => setLoopStart(Math.min(loopEnd - 1, loopStart + 0.5)));
    startNudge.appendChild(startMinus);
    startNudge.appendChild(startPlus);
    startGroup.appendChild(startLabel);
    startGroup.appendChild(startInput);
    startGroup.appendChild(startSetBtn);
    startGroup.appendChild(startNudge);

    // End group
    const endGroup = document.createElement("div");
    endGroup.className = "loop-time-group";
    const endLabel = document.createElement("label");
    endLabel.textContent = "END";
    endLabel.className = "loop-label";
    const endInput = document.createElement("input");
    endInput.type = "text";
    endInput.id = "loop-end-input";
    endInput.className = "loop-time-input";
    endInput.value = formatTime(loopEnd);
    endInput.title = "Type end time (e.g. 1:40)";
    const endSetBtn = document.createElement("button");
    endSetBtn.className = "loop-set-btn";
    endSetBtn.textContent = "SET";
    endSetBtn.title = "Set loop end to current video time";
    endSetBtn.addEventListener("click", () => { const p = getPlayer(); if (p) setLoopEnd(p.currentTime); });
    const endNudge = document.createElement("div");
    endNudge.className = "loop-nudge";
    const endMinus = document.createElement("button");
    endMinus.className = "loop-nudge-btn";
    endMinus.textContent = "- 0.5s";
    endMinus.addEventListener("click", () => setLoopEnd(Math.max(loopStart + 1, loopEnd - 0.5)));
    const endPlus = document.createElement("button");
    endPlus.className = "loop-nudge-btn";
    endPlus.textContent = "+ 0.5s";
    endPlus.addEventListener("click", () => setLoopEnd(Math.min(videoDuration, loopEnd + 0.5)));
    endNudge.appendChild(endMinus);
    endNudge.appendChild(endPlus);
    endGroup.appendChild(endLabel);
    endGroup.appendChild(endInput);
    endGroup.appendChild(endSetBtn);
    endGroup.appendChild(endNudge);

    // Duration display
    const durGroup = document.createElement("div");
    durGroup.className = "loop-time-group loop-dur-group";
    const durLabel = document.createElement("label");
    durLabel.textContent = "LOOP LENGTH";
    durLabel.className = "loop-label";
    const durDisplay = document.createElement("div");
    durDisplay.id = "loop-duration-display";
    durDisplay.className = "loop-duration-val";
    durDisplay.textContent = formatTime(loopEnd - loopStart);
    durGroup.appendChild(durLabel);
    durGroup.appendChild(durDisplay);

    timeRow.appendChild(startGroup);
    timeRow.appendChild(endGroup);
    timeRow.appendChild(durGroup);

    // Slider
    const sliderSection = document.createElement("div");
    sliderSection.className = "loop-slider-section";
    const sliderLabels = document.createElement("div");
    sliderLabels.className = "loop-slider-labels";
    const sliderLabelStart = document.createElement("span");
    sliderLabelStart.textContent = "0:00";
    const sliderLabelEnd = document.createElement("span");
    sliderLabelEnd.id = "loop-slider-label-end";
    sliderLabelEnd.textContent = formatTime(videoDuration);
    sliderLabels.appendChild(sliderLabelStart);
    sliderLabels.appendChild(sliderLabelEnd);

    const sliderTrack = document.createElement("div");
    sliderTrack.className = "loop-slider-track";
    sliderTrack.id = "loop-slider-track";
    const sliderFill = document.createElement("div");
    sliderFill.className = "loop-slider-fill";
    sliderFill.id = "loop-slider-fill";
    const playhead = document.createElement("div");
    playhead.className = "loop-playhead";
    playhead.id = "loop-playhead";
    const handleStart = document.createElement("div");
    handleStart.className = "loop-handle loop-handle-start";
    handleStart.id = "loop-handle-start";
    handleStart.title = "Drag to set loop start";
    const handleEnd = document.createElement("div");
    handleEnd.className = "loop-handle loop-handle-end";
    handleEnd.id = "loop-handle-end";
    handleEnd.title = "Drag to set loop end";

    sliderTrack.appendChild(sliderFill);
    sliderTrack.appendChild(playhead);
    sliderTrack.appendChild(handleStart);
    sliderTrack.appendChild(handleEnd);
    sliderSection.appendChild(sliderLabels);
    sliderSection.appendChild(sliderTrack);

    // Presets
    const presetsRow = document.createElement("div");
    presetsRow.className = "loop-presets-row";
    const presetsLabel = document.createElement("span");
    presetsLabel.className = "loop-presets-label";
    presetsLabel.textContent = "Quick:";
    presetsRow.appendChild(presetsLabel);
    const presets = [
      { label: "Intro (0:00 - 0:15)", start: 0, end: 15 },
      { label: "Verse 1 (0:15 - 1:00)", start: 15, end: 60 },
      { label: "Hook (1:00 - 1:30)", start: 60, end: 90 },
      { label: "Full Beat", start: 0, end: null },
    ];
    for (const p of presets) {
      const pbtn = document.createElement("button");
      pbtn.className = "loop-preset-btn";
      pbtn.textContent = p.label;
      pbtn.addEventListener("click", () => {
        setLoopStart(p.start);
        setLoopEnd(p.end !== null ? Math.min(p.end, videoDuration) : videoDuration);
        if (!loopEnabled) toggleLoop();
      });
      presetsRow.appendChild(pbtn);
    }

    // Action row
    const actionRow = document.createElement("div");
    actionRow.className = "loop-action-row";
    const jumpBtn = document.createElement("button");
    jumpBtn.className = "loop-jump-btn";
    jumpBtn.textContent = "Jump to Loop Start";
    jumpBtn.addEventListener("click", () => { const p = getPlayer(); if (p) p.currentTime = loopStart; });
    const resetBtn = document.createElement("button");
    resetBtn.className = "loop-reset-btn";
    resetBtn.textContent = "Reset Loop";
    resetBtn.addEventListener("click", () => {
      setLoopStart(0);
      setLoopEnd(videoDuration);
      if (loopEnabled) toggleLoop();
    });
    actionRow.appendChild(jumpBtn);
    actionRow.appendChild(resetBtn);

    // Hint
    const hint = document.createElement("div");
    hint.className = "loop-hint";
    function addKey(parent, key) {
      const b = document.createElement("b");
      b.textContent = key;
      parent.appendChild(b);
    }
    hint.appendChild(document.createTextNode("Keyboard: "));
    addKey(hint, "L"); hint.appendChild(document.createTextNode(" = toggle loop  |  "));
    addKey(hint, "["); hint.appendChild(document.createTextNode(" = set start  |  "));
    addKey(hint, "]"); hint.appendChild(document.createTextNode(" = set end  |  "));
    addKey(hint, "\\"); hint.appendChild(document.createTextNode(" = jump to start"));

    // Collapse
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "loop-collapse-btn";
    collapseBtn.id = "loop-collapse-btn";
    collapseBtn.textContent = "\u25B2 BEAT LOOPER";
    let collapsed = false;
    const panelBody = document.createElement("div");
    panelBody.className = "loop-panel-body";
    panelBody.id = "loop-panel-body";
    collapseBtn.addEventListener("click", () => {
      collapsed = !collapsed;
      panelBody.style.display = collapsed ? "none" : "block";
      collapseBtn.textContent = collapsed ? "\u25BC BEAT LOOPER" : "\u25B2 BEAT LOOPER";
    });

    // Assemble
    panelBody.appendChild(header);
    panelBody.appendChild(timeRow);
    panelBody.appendChild(sliderSection);
    panelBody.appendChild(presetsRow);
    panelBody.appendChild(actionRow);
    panelBody.appendChild(hint);
    panel.appendChild(collapseBtn);
    panel.appendChild(panelBody);

    // Order: [download row] → [loop panel] → [ytd-watch-metadata]
    // Loop panel goes after the download row, before the metadata.
    insertUIElement(panel, "loop");

    // Wire up inputs
    startInput.addEventListener("change", () => {
      const t = parseTimeInput(startInput.value);
      if (t !== null && t >= 0 && t < loopEnd) setLoopStart(t);
      else startInput.value = formatTime(loopStart);
    });
    endInput.addEventListener("change", () => {
      const t = parseTimeInput(endInput.value);
      if (t !== null && t > loopStart && t <= videoDuration) setLoopEnd(t);
      else endInput.value = formatTime(loopEnd);
    });

    // Wire up slider drag
    setupSliderDrag(handleStart, "start");
    setupSliderDrag(handleEnd, "end");
    sliderTrack.addEventListener("click", (e) => {
      if (e.target.classList.contains("loop-handle")) return;
      const rect = sliderTrack.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = pct * videoDuration;
      if (Math.abs(time - loopStart) < Math.abs(time - loopEnd)) {
        setLoopStart(Math.min(time, loopEnd - 1));
      } else {
        setLoopEnd(Math.max(time, loopStart + 1));
      }
    });

    updateSliderVisuals();
    startPlayheadTracker();

    // Re-enable loop if it was saved as ON
    if (shouldReEnableLoop) {
      toggleLoop();
    }
  }

  function setupSliderDrag(handle, which) {
    let dragging = false;
    function onMouseDown(e) {
      e.preventDefault();
      dragging = true;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }
    function onMouseMove(e) {
      if (!dragging) return;
      const track = document.getElementById("loop-slider-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = pct * videoDuration;
      if (which === "start") setLoopStart(Math.min(time, loopEnd - 1));
      else setLoopEnd(Math.max(time, loopStart + 1));
    }
    function onMouseUp() {
      dragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    handle.addEventListener("mousedown", onMouseDown);
  }

  function setLoopStart(t) {
    loopStart = Math.max(0, Math.min(t, videoDuration));
    const input = document.getElementById("loop-start-input");
    if (input) input.value = formatTime(loopStart);
    updateSliderVisuals();
    updateDurationDisplay();
    saveLoopState();
  }

  function setLoopEnd(t) {
    loopEnd = Math.max(0, Math.min(t, videoDuration));
    const input = document.getElementById("loop-end-input");
    if (input) input.value = formatTime(loopEnd);
    updateSliderVisuals();
    updateDurationDisplay();
    saveLoopState();
  }

  function updateDurationDisplay() {
    const el = document.getElementById("loop-duration-display");
    if (el) el.textContent = formatTime(loopEnd - loopStart);
  }

  function updateSliderVisuals() {
    if (!videoDuration) return;
    const fill = document.getElementById("loop-slider-fill");
    const hStart = document.getElementById("loop-handle-start");
    const hEnd = document.getElementById("loop-handle-end");
    if (!fill || !hStart || !hEnd) return;
    const startPct = (loopStart / videoDuration) * 100;
    const endPct = (loopEnd / videoDuration) * 100;
    fill.style.left = startPct + "%";
    fill.style.width = (endPct - startPct) + "%";
    hStart.style.left = startPct + "%";
    hEnd.style.left = endPct + "%";
  }

  function startPlayheadTracker() {
    setInterval(() => {
      const p = getPlayer();
      const ph = document.getElementById("loop-playhead");
      if (!p || !ph || !videoDuration) return;
      const pct = (p.currentTime / videoDuration) * 100;
      ph.style.left = pct + "%";
    }, 100);
  }

  // =====================================================================
  //  LOOP ENFORCEMENT — FIXED: never touches loopStart or loopEnd
  //  Only job: if time >= loopEnd, seek to loopStart. That's it.
  // =====================================================================

  function toggleLoop() {
    loopEnabled = !loopEnabled;
    const btn = document.getElementById("loop-toggle-btn");
    if (btn) {
      btn.textContent = loopEnabled ? "ON" : "OFF";
      btn.classList.toggle("active", loopEnabled);
    }
    const panel = document.getElementById(LOOP_PANEL_ID);
    if (panel) panel.classList.toggle("loop-active", loopEnabled);

    if (loopEnabled) {
      startLoopEnforcement();
      const p = getPlayer();
      if (p) {
        if (p.currentTime < loopStart || p.currentTime >= loopEnd) {
          p.currentTime = loopStart;
        }
        if (p.paused || p.ended) p.play().catch(() => {});
      }
      showFeedback("Loop ON: " + formatTime(loopStart) + " \u2192 " + formatTime(loopEnd));
    } else {
      stopLoopEnforcement();
      showFeedback("Loop OFF");
    }
    saveLoopState();
  }

  function enforceLoop() {
    if (!loopEnabled) return;
    const p = getPlayer();
    if (!p) return;

    // Lock video to the loop section — if outside bounds, snap back
    if (p.currentTime >= loopEnd - 0.08) {
      p.currentTime = loopStart;
      if (p.paused) p.play().catch(() => {});
    } else if (p.currentTime < loopStart - 0.3) {
      // User scrubbed/skipped before the loop start — snap to loop start
      p.currentTime = loopStart;
    }
  }

  function onVideoEnded() {
    if (!loopEnabled) return;
    const p = getPlayer();
    if (!p) return;
    p.currentTime = loopStart;
    p.play().catch(() => {});
  }

  function startLoopEnforcement() {
    stopLoopEnforcement();
    const p = getPlayer();
    if (!p) return;

    loopBoundHandler = enforceLoop;
    p.addEventListener("timeupdate", loopBoundHandler);
    loopCheckInterval = setInterval(enforceLoop, 30);
    loopEndedHandler = onVideoEnded;
    p.addEventListener("ended", loopEndedHandler);
  }

  function stopLoopEnforcement() {
    if (loopCheckInterval) {
      clearInterval(loopCheckInterval);
      loopCheckInterval = null;
    }
    const p = getPlayer();
    if (p) {
      if (loopBoundHandler) {
        p.removeEventListener("timeupdate", loopBoundHandler);
      }
      if (loopEndedHandler) {
        p.removeEventListener("ended", loopEndedHandler);
      }
    }
    loopBoundHandler = null;
    loopEndedHandler = null;
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (!document.getElementById(LOOP_PANEL_ID)) return;
    const p = getPlayer();
    if (!p) return;

    switch (e.key.toLowerCase()) {
      case "l":
        toggleLoop();
        e.preventDefault();
        break;
      case "[":
        setLoopStart(p.currentTime);
        showFeedback("Loop start: " + formatTime(p.currentTime));
        e.preventDefault();
        break;
      case "]":
        setLoopEnd(p.currentTime);
        showFeedback("Loop end: " + formatTime(p.currentTime));
        e.preventDefault();
        break;
      case "\\":
        p.currentTime = loopStart;
        showFeedback("Jumped to loop start");
        e.preventDefault();
        break;
    }
  });

  // =====================================================================
  //  MP3 DOWNLOAD — one-click via local server, no third-party sites
  // =====================================================================

  // ─── Key & BPM detection from video title/description ─────────

  // Track whether this is the initial page load (not an SPA navigation)
  let isInitialPageLoad = true;

  function getDescriptionText() {
    // Method 1 (BEST): Read YouTube's internal data via wrappedJSObject (Firefox only)
    // This always has the current video's description, even before the DOM renders it.
    try {
      const flexy = document.querySelector("ytd-watch-flexy");
      if (flexy && flexy.wrappedJSObject) {
        const data = flexy.wrappedJSObject;
        // Try playerResponse path
        const desc =
          data?.playerResponse?.videoDetails?.shortDescription ||
          data?.response?.engagementPanels?.find?.(p =>
            p?.engagementPanelSectionListRenderer?.content?.structuredDescriptionContentRenderer
          )?.engagementPanelSectionListRenderer?.content?.structuredDescriptionContentRenderer?.items?.find?.(i =>
            i?.expandableVideoDescriptionBodyRenderer
          )?.expandableVideoDescriptionBodyRenderer?.descriptionBodyText?.content ||
          "";
        if (typeof desc === "string" && desc.length > 10) return desc;
      }
    } catch (e) { /* wrappedJSObject not available or data shape changed */ }

    // Method 2: Try YouTube's page data manager
    try {
      const mgr = document.querySelector("ytd-page-manager");
      if (mgr && mgr.wrappedJSObject) {
        const pageData = mgr.wrappedJSObject?.getCurrentData?.();
        const desc = pageData?.playerResponse?.videoDetails?.shortDescription || "";
        if (typeof desc === "string" && desc.length > 10) return desc;
      }
    } catch (e) { /* ignore */ }

    // Method 3: DOM selectors — works when description is already rendered/expanded
    // IMPORTANT: avoid bare "#description" which matches an SVG <g> element!
    const selectors = [
      "#description-inner",
      "ytd-structured-description-content-renderer",
      "ytd-text-inline-expander",
      "#description-inline-expander",
      "ytd-expandable-video-description-body-renderer",
      "ytd-watch-metadata #description",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = el.textContent || "";
        if (txt.trim().length > 20) return txt;
      }
    }

    // Method 4: Parse from <script> tags — only on fresh page load (stale after SPA nav)
    if (isInitialPageLoad) {
      try {
        const scripts = document.querySelectorAll("script");
        for (const s of scripts) {
          const src = s.textContent;
          if (!src || !src.includes("shortDescription")) continue;
          const match = src.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (match && match[1].length > 10) {
            return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          }
        }
      } catch (e) { /* ignore */ }
    }

    return "";
  }

  function detectKeyBPM() {
    const titleEl = document.querySelector("yt-formatted-string.ytd-watch-metadata, h1.ytd-watch-metadata, h1.title");
    const titleText = titleEl?.textContent || "";
    const descText = getDescriptionText();
    const text = (titleText + " " + descText).replace(/\n/g, " ");

    return parseKeyBPM(text);
  }

  function parseKeyBPM(text) {

    let key = "";
    let bpm = "";

    // Key detection — "Key: D Minor", "Key: Gm", "C Minor", "F# minor", "Ebm", "Am", "Gmaj"
    const keyMatch = text.match(
      /\bkey\s*[:\-]?\s*([A-G][#b]?)\s*(minor|major|min|maj)\b/i
    ) || text.match(
      /\bkey\s*[:\-]?\s*([A-G][#b]?)(m|maj)?\b/i
    ) || text.match(
      /\b([A-G][#b]?)\s+(minor|major|min|maj)\b/i
    ) || text.match(
      /\b([A-G][#b]?)(m|maj)\b/
    );

    if (keyMatch) {
      const note = keyMatch[1].charAt(0).toUpperCase() + keyMatch[1].slice(1);
      let quality = (keyMatch[2] || "").toLowerCase();
      if (quality === "m" || quality === "min" || quality === "minor") quality = "Minor";
      else if (quality === "maj" || quality === "major") quality = "Major";
      else if (!quality) quality = "";
      key = note + (quality ? " " + quality : "");
    }

    // BPM detection — "BPM: 123", "140 BPM", "140bpm", "Tempo: 140"
    const bpmMatch = text.match(/\bbpm\s*[:\-]?\s*(\d{2,3})\b/i)
      || text.match(/\b(\d{2,3})\s*bpm\b/i)
      || text.match(/\btempo\s*[:\-]?\s*(\d{2,3})\b/i);

    if (bpmMatch) {
      const val = parseInt(bpmMatch[1], 10);
      if (val >= 50 && val <= 300) bpm = String(val);
    }

    return { key, bpm };
  }

  async function isServerOnline() {
    try {
      const resp = await browser.runtime.sendMessage({ type: "health" });
      return resp && resp.online;
    } catch (e) { return false; }
  }

  // Guaranteed order: [download row] → [loop panel] → [ytd-watch-metadata / rest]
  // No matter which element builds first, this keeps them in the right order.
  function insertUIElement(el, role) {
    const below = document.querySelector("#below");
    if (!below) {
      const fb =
        document.querySelector("ytd-watch-flexy #primary-inner") ||
        document.querySelector("ytd-watch-flexy #primary") ||
        document.querySelector("#content");
      if (fb) fb.insertBefore(el, fb.firstChild);
      else document.body.appendChild(el);
      return;
    }

    if (role === "download") {
      // Download row is ALWAYS the very first custom element.
      // Insert before: loop panel if it exists, else before watchMeta, else firstChild.
      const loopPanel = document.getElementById(LOOP_PANEL_ID);
      const watchMeta = below.querySelector(":scope > ytd-watch-metadata");
      const ref = loopPanel || watchMeta || below.firstChild;
      below.insertBefore(el, ref);
    } else {
      // Loop panel goes AFTER download row, BEFORE watchMeta.
      const dlRow = document.getElementById(DL_ROW_ID);
      const watchMeta = below.querySelector(":scope > ytd-watch-metadata");
      if (dlRow && dlRow.nextSibling) {
        below.insertBefore(el, dlRow.nextSibling);
      } else if (watchMeta) {
        below.insertBefore(el, watchMeta);
      } else {
        below.insertBefore(el, below.firstChild);
      }
    }
  }

  function buildDownloadRow() {
    if (document.getElementById(DL_ROW_ID)) return;
    if (!isVideoPage()) return;

    const videoId = getVideoId();
    if (!videoId) return;

    const row = document.createElement("div");
    row.id = DL_ROW_ID;

    // Main download button
    const dlBtn = document.createElement("button");
    dlBtn.id = "yt-mp3-download-btn";
    dlBtn.type = "button";
    const dlIcon = document.createElement("span");
    dlIcon.className = "dl-icon";
    dlIcon.textContent = "\u2B07";
    dlBtn.appendChild(dlIcon);
    dlBtn.appendChild(document.createTextNode(" Download MP3"));
    dlBtn.title = "Download this video as audio — one click, straight to your PC";

    // Status text
    const statusEl = document.createElement("span");
    statusEl.id = "yt-mp3-dl-status";
    statusEl.className = "dl-status";

    // Server status indicator
    const serverDot = document.createElement("span");
    serverDot.id = "yt-mp3-server-dot";
    serverDot.className = "dl-server-dot";

    const serverLabel = document.createElement("span");
    serverLabel.id = "yt-mp3-server-label";
    serverLabel.className = "dl-server-label";
    serverLabel.textContent = "Checking server...";

    // Check server on load
    isServerOnline().then((online) => {
      if (online) {
        serverDot.className = "dl-server-dot online";
        serverLabel.textContent = "Local server";
      } else {
        serverDot.className = "dl-server-dot offline";
        serverLabel.textContent = "";
        const offLink = document.createElement("a");
        offLink.href = "https://github.com/adamsfunded-ai/youtube-rapper-toolkit#mp3-download-setup-required-for-download-feature";
        offLink.target = "_blank";
        offLink.title = "Click for setup instructions";
        offLink.textContent = "Server offline";
        offLink.style.cssText = "color:inherit;text-decoration:underline dotted;opacity:0.8;";
        serverLabel.appendChild(offLink);
      }
    });

    dlBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const vid = getVideoId();
      if (!vid) { statusEl.textContent = "No video ID found."; return; }

      const online = await isServerOnline();
      if (!online) {
        statusEl.textContent = "Server offline \u2014 ";
        const setupLink = document.createElement("a");
        setupLink.href = "https://github.com/adamsfunded-ai/youtube-rapper-toolkit#mp3-download-setup-required-for-download-feature";
        setupLink.target = "_blank";
        setupLink.textContent = "Setup instructions";
        setupLink.style.cssText = "color:#ff9500;text-decoration:underline;";
        statusEl.appendChild(setupLink);
        serverDot.className = "dl-server-dot offline";
        serverLabel.textContent = "Server offline";
        return;
      }

      serverDot.className = "dl-server-dot online";
      serverLabel.textContent = "Local server";

      dlBtn.classList.add("loading");
      dlBtn.disabled = true;
      statusEl.textContent = "Downloading... (this may take a moment)";

      try {
        // Grab title, channel, key, BPM from the page for the filename
        const pageTitle = document.querySelector("yt-formatted-string.ytd-watch-metadata, h1.ytd-watch-metadata")?.textContent?.trim() || "";
        const pageChannel = document.querySelector("#channel-name yt-formatted-string a, ytd-channel-name yt-formatted-string a")?.textContent?.trim() || "";
        const { key, bpm } = detectKeyBPM();

        const result = await browser.runtime.sendMessage({ type: "download", videoId: vid, title: pageTitle, channel: pageChannel, key, bpm });

        if (result.error) {
          statusEl.textContent = "Error: " + result.error;
          dlBtn.classList.remove("loading");
          dlBtn.disabled = false;
          return;
        }

        statusEl.textContent = "Saved to Downloads: " + result.filename;
        dlBtn.classList.remove("loading");
        dlBtn.disabled = false;
        setTimeout(() => { statusEl.textContent = ""; }, 5000);

      } catch (err) {
        statusEl.textContent = "Error: " + err.message;
        dlBtn.classList.remove("loading");
        dlBtn.disabled = false;
      }
    });

    // Key/BPM display in the middle
    const keyBpmEl = document.createElement("span");
    keyBpmEl.id = "yt-mp3-keybpm";
    keyBpmEl.className = "dl-keybpm";
    keyBpmEl.style.display = "none";

    // Show cached key/BPM instantly if already detected for this video
    if (detectedForVideoId === videoId && (detectedKey || detectedBpm)) {
      const parts = [detectedKey, detectedBpm ? detectedBpm + " BPM" : ""].filter(Boolean);
      keyBpmEl.textContent = parts.join("  |  ");
      keyBpmEl.style.display = "";
    }

    // Assemble
    row.appendChild(dlBtn);
    row.appendChild(statusEl);
    row.appendChild(keyBpmEl);

    const serverInfo = document.createElement("div");
    serverInfo.className = "dl-server-info";
    serverInfo.appendChild(serverDot);
    serverInfo.appendChild(serverLabel);
    row.appendChild(serverInfo);

    // Order: [download row] → [loop panel] → [ytd-watch-metadata]
    // Download row is ALWAYS first under the player.
    insertUIElement(row, "download");
  }

  function removeDownloadRow() {
    const row = document.getElementById(DL_ROW_ID);
    if (row) row.remove();
  }

  // ─── Cleanup ──────────────────────────────────────────────────────
  function removeLoopPanel() {
    // Save state BEFORE removing
    if (document.getElementById(LOOP_PANEL_ID)) {
      saveLoopState();
    }
    const panel = document.getElementById(LOOP_PANEL_ID);
    if (panel) panel.remove();
    stopLoopEnforcement();
    // Do NOT reset loopStart/loopEnd/loopEnabled here — they're saved
    playerRef = null;
    videoDuration = 0;
  }

  function removeSortButton() {
    const btn = document.getElementById(SORT_BTN_ID);
    if (btn) btn.remove();
  }

  // ─── Navigation handling ──────────────────────────────────────────
  function checkPage() {
    if (isWatchLaterPage()) {
      setTimeout(injectSortButton, 1000);
    } else {
      removeSortButton();
    }

    if (isVideoPage()) {
      setTimeout(() => {
        buildLoopPanel();
        buildDownloadRow();
      }, 1500);
      setTimeout(() => {
        if (!document.getElementById(LOOP_PANEL_ID)) buildLoopPanel();
        if (!document.getElementById(DL_ROW_ID)) buildDownloadRow();
      }, 4000);
    } else {
      removeLoopPanel();
      removeDownloadRow();
    }
  }

  // REMOVED the old onVideoChange that was resetting loopStart/loopEnd.
  // Now handled by buildLoopPanel which loads from localStorage.

  // YouTube SPA navigation
  window.addEventListener("yt-navigate-finish", () => {
    // After the first navigation, script tags are stale — don't trust them
    isInitialPageLoad = false;
    // Save before navigating away
    saveLoopState();
    playerRef = null;
    checkPage();
  });

  let lastUrl = window.location.href;
  let lastVideoId = getVideoId();
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      saveLoopState();
      lastUrl = window.location.href;
      const newVideoId = getVideoId();
      const videoChanged = newVideoId !== lastVideoId;
      lastVideoId = newVideoId;
      playerRef = null;

      // After any URL change, script tags are stale
      isInitialPageLoad = false;

      if (videoChanged) {
        // Remove old panels so they rebuild fresh for the new video
        const oldLoop = document.getElementById(LOOP_PANEL_ID);
        if (oldLoop) { oldLoop.remove(); stopLoopEnforcement(); }
        const oldDl = document.getElementById(DL_ROW_ID);
        if (oldDl) oldDl.remove();
        videoDuration = 0;
        // Reset key/BPM detection for the new video
        detectedKey = "";
        detectedBpm = "";
        detectedForVideoId = null;
      }
      checkPage();
    }
  });
  urlObserver.observe(document.querySelector("title") || document.head, {
    childList: true, subtree: true, characterData: true,
  });

  // Save state before the user leaves the page entirely
  window.addEventListener("beforeunload", () => {
    saveLoopState();
  });

  // Save periodically while looping (in case of crash/force close)
  setInterval(() => {
    if (loopEnabled) saveLoopState();
  }, 5000);

  // Re-inject our UI if YouTube re-renders and destroys our elements
  setInterval(() => {
    if (isVideoPage()) {
      if (!document.getElementById(DL_ROW_ID)) buildDownloadRow();
      if (!document.getElementById(LOOP_PANEL_ID)) buildLoopPanel();
    }
  }, 3000);

  // ─── Global Key/BPM detection loop ─────────────────────────────
  // Runs independently of the download row lifecycle. Parses key/BPM
  // from YouTube's internal data and keeps the badge updated.
  setInterval(() => {
    if (!isVideoPage()) return;
    const vid = getVideoId();
    if (!vid) return;

    // Already detected for this video — just make sure the badge shows it
    if (detectedForVideoId === vid && (detectedKey || detectedBpm)) {
      const el = document.getElementById("yt-mp3-keybpm");
      if (el && !el.textContent) {
        const parts = [detectedKey, detectedBpm ? detectedBpm + " BPM" : ""].filter(Boolean);
        el.textContent = parts.join("  |  ");
        el.style.display = "";
      }
      return;
    }

    // Try to detect from page data
    const { key, bpm } = detectKeyBPM();
    if (key || bpm) {
      detectedKey = key;
      detectedBpm = bpm;
      detectedForVideoId = vid;
      const el = document.getElementById("yt-mp3-keybpm");
      if (el) {
        const parts = [key, bpm ? bpm + " BPM" : ""].filter(Boolean);
        el.textContent = parts.join("  |  ");
        el.style.display = "";
      }
    }
  }, 2000);

  // Initial
  checkPage();
})();
