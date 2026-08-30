/**
 * PolicyLens — floating in-page widget (content script)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE OLD "ANALYZE" BUTTON DID NOTHING:
 *
 * This script runs as a content script, injected straight into the page —
 * it already has full DOM access. But the old Analyze handler asked the
 * BACKGROUND SERVICE WORKER to do the work instead, via:
 *
 *     chrome.runtime.sendMessage({ action: "analyzeLocal" }, ...)
 *     chrome.runtime.sendMessage({ action: "getSiteContext" }, ...)
 *
 * background.js has no DOM access at all, and per this project's own
 * architecture it only understands ONE message shape:
 *
 *     { type: "POLICYLENS_ANALYZE", payload }   →  relays a fetch() to
 *                                                   http://localhost:8000/analyze
 *
 * "analyzeLocal" and "getSiteContext" match nothing, so nothing ever
 * responds — the popup box version only worked because THAT flow
 * (index.js) does extraction locally and only messages the background
 * worker with the correct shape once it already has the data.
 *
 * FIX: do the extraction right here (this file has DOM access), and only
 * use messaging for the one thing that legitimately needs to leave the
 * page — the backend call — via the already-correct backendClient.js
 * helper (window.PolicyLensBackend.sendAnalysis).
 *
 * REQUIRES this manifest.json load order (content_scripts.js), same as
 * index.js needs — floatingUI.js just needs to come after these globals
 * are defined:
 *
 *   "content/policyVocabulary.js",
 *   "content/siteAdapters.js",
 *   "content/extractor.js",
 *   "content/cleaner.js",
 *   "content/detector.js",
 *   "content/backendClient.js",
 *   "content/floatingUI.js"
 * ─────────────────────────────────────────────────────────────────────────
 */

(() => {
    "use strict";

    // Prevent duplicate injection
    if (document.getElementById("policylens-floating-root")) return;

    const REQUIRED_GLOBALS = [
        "PolicyLensExtractor",
        "PolicyLensCleaner",
        "PolicyLensDetector",
        "PolicyLensBackend"
    ];

    function getMissingGlobals() {
        return REQUIRED_GLOBALS.filter((name) => !window[name]);
    }

    // ============================================================
    // ROOT + SHADOW DOM
    // ============================================================

    const root = document.createElement("div");
    root.id = "policylens-floating-root";

    const shadow = root.attachShadow({ mode: "open" });

    // ============================================================
    // STYLE
    // ============================================================

    const style = document.createElement("style");
    style.textContent = `
        * { box-sizing: border-box; }

        #launcher {
            position: fixed;
            right: 24px;
            bottom: 24px;
            width: 52px;
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            border: 1px solid #dadce0;
            background: #ffffff;
            box-shadow: 0 4px 14px rgba(60,64,67,.20), 0 2px 5px rgba(60,64,67,.12);
            cursor: grab;
            z-index: 2147483647;
            touch-action: none;
            transition: transform .18s ease, box-shadow .18s ease;
        }

        #launcher:hover {
            transform: scale(1.06);
            box-shadow: 0 7px 20px rgba(60,64,67,.24), 0 3px 8px rgba(60,64,67,.14);
        }

        #launcher.dragging {
            cursor: grabbing;
            transition: none;
            transform: none;
        }

        .launcher-logo {
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 9px; background: #f1f3f4; font-size: 17px;
            pointer-events: none;
        }

        .launcher-logo img, .logo img {
            display: block;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }

        #panel {
            position: fixed;
            right: 24px;
            bottom: 24px;
            width: 360px;
            max-height: 640px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #dadce0;
            border-radius: 18px;
            background: #ffffff;
            color: #202124;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            box-shadow: 0 10px 35px rgba(60,64,67,.22), 0 3px 10px rgba(60,64,67,.14);
            z-index: 2147483647;
        }

        #panel.open { display: flex; }

        .header {
            height: 58px; min-height: 58px;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 12px 0 15px;
            border-bottom: 1px solid #eeeeee;
            cursor: grab;
            touch-action: none;
        }

        .header.dragging { cursor: grabbing; }

        .brand { display: flex; align-items: center; gap: 9px; pointer-events: none; }

        .logo {
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 9px; background: #f1f3f4; font-size: 17px;
        }

        .brand-name { font-size: 15px; font-weight: 700; letter-spacing: -.2px; }

        .header-actions { display: flex; gap: 3px; }

        .header-btn {
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            border: none; border-radius: 50%; background: transparent;
            color: #5f6368; font-size: 17px; cursor: pointer;
        }

        .header-btn:hover { background: #f1f3f4; }

        .body { padding: 16px; overflow-y: auto; }

        .label {
            display: block; margin-bottom: 5px;
            font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #80868b;
        }

        .page-name {
            margin-bottom: 9px; font-size: 13px; font-weight: 600;
            line-height: 1.4; color: #202124; word-break: break-word;
        }

        .category {
            display: inline-flex; padding: 5px 9px; margin-bottom: 14px;
            border-radius: 999px; background: #f1f3f4; color: #5f6368;
            font-size: 10px; font-weight: 600;
        }

        #analyze {
            width: 100%; height: 42px; border: none; border-radius: 9px;
            background: #1a73e8; color: #ffffff; font-size: 13px; font-weight: 600;
            cursor: pointer;
        }

        #analyze:hover { background: #1769d1; }
        #analyze:disabled { opacity: .65; cursor: default; }

        .status {
            min-height: 20px; margin-top: 8px; text-align: center;
            font-size: 10px; line-height: 1.4; color: #80868b;
        }

        #results { display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eeeeee; }
        #results.visible { display: block; }

        .results-title { margin-bottom: 10px; font-size: 16px; font-weight: 700; letter-spacing: -.2px; }

        .policy-card {
            margin-bottom: 8px; padding: 11px;
            border: 1px solid #e0e3e7; border-radius: 10px; background: #ffffff;
        }

        .card-title-row {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin-bottom: 6px;
        }

        .card-title { font-size: 12px; font-weight: 700; color: #202124; }

        .badge {
            flex-shrink: 0; padding: 3px 8px; border-radius: 999px;
            font-size: 9px; font-weight: 700; letter-spacing: .3px;
        }

        .badge-danger { background: #fce8e6; color: #c5221f; }
        .badge-attention { background: #fef7e0; color: #b06000; }
        .badge-safe { background: #e6f4ea; color: #137333; }

        .card-text { margin-bottom: 5px; font-size: 11px; line-height: 1.45; color: #5f6368; }
        .card-text:last-child { margin-bottom: 0; }
        .card-note { font-size: 10px; color: #9aa0a6; margin-top: 4px; }

        .warning {
            margin-top: 10px; padding: 11px;
            border: 1px solid #f6e7a9; border-radius: 10px; background: #fff8e1;
        }

        .warning-title { margin-bottom: 6px; font-size: 11px; font-weight: 700; color: #5f4b00; }
        .warning-item { margin-bottom: 4px; font-size: 10px; line-height: 1.4; color: #665c32; }
        .warning-item:last-child { margin-bottom: 0; }

        .empty {
            padding: 15px; border: 1px dashed #dadce0; border-radius: 9px;
            text-align: center; font-size: 10px; color: #80868b;
        }

        .body::-webkit-scrollbar { width: 5px; }
        .body::-webkit-scrollbar-thumb { background: #dadce0; border-radius: 10px; }
    `;
    shadow.appendChild(style);

    // ============================================================
    // LAUNCHER
    // ============================================================

    // chrome.runtime.getURL() turns an extension-relative path into a full
    // chrome-extension://<id>/... URL — the only kind of URL a content
    // script running inside someone else's page (this file) is allowed to
    // load extension-packaged files from. A plain relative path here would
    // resolve against the HOST PAGE's origin instead and 404. The file must
    // also be listed under "web_accessible_resources" in manifest.json, or
    // the browser blocks the load even with the correct URL.
    const LOGO_URL = chrome.runtime.getURL("content/assets/LogoV1.svg");

    const launcher = document.createElement("button");
    launcher.id = "launcher";
    launcher.setAttribute("aria-label", "Open PolicyLens");
    launcher.innerHTML = `<div class="launcher-logo"><img src="${LOGO_URL}" alt="" width="26" height="26"></div>`;

    // ============================================================
    // PANEL
    // ============================================================

    const panel = document.createElement("div");
    panel.id = "panel";
    panel.innerHTML = `
        <div class="header" id="header">
            <div class="brand">
                <div class="logo"><img src="${LOGO_URL}" alt="" width="20" height="20"></div>
                <div class="brand-name">PolicyLens</div>
            </div>
            <div class="header-actions">
                <button class="header-btn" id="minimize" title="Minimize">−</button>
                <button class="header-btn" id="close" title="Close">×</button>
            </div>
        </div>
        <div class="body">
            <span class="label">CURRENT PAGE</span>
            <div class="page-name" id="page-name">Loading page...</div>
            <div class="category" id="category">General Page</div>
            <button id="analyze" type="button">Analyze with PolicyLens</button>
            <div class="status" id="status">Ready to analyze this page.</div>
            <div id="results">
                <div class="results-title">Policy Summary</div>
                <div id="cards"></div>
                <div class="warning" id="warning" style="display:none;">
                    <div class="warning-title">⚠️ Things you should know</div>
                    <div id="warnings"></div>
                </div>
            </div>
        </div>
    `;

    shadow.appendChild(launcher);
    shadow.appendChild(panel);
    document.documentElement.appendChild(root);

    // ============================================================
    // ELEMENT REFERENCES
    // ============================================================

    const header = shadow.querySelector("#header");
    const analyzeButton = shadow.querySelector("#analyze");
    const status = shadow.querySelector("#status");
    const pageName = shadow.querySelector("#page-name");
    const category = shadow.querySelector("#category");
    const results = shadow.querySelector("#results");
    const cardsEl = shadow.querySelector("#cards");
    const warningBox = shadow.querySelector("#warning");
    const warningsEl = shadow.querySelector("#warnings");

    pageName.textContent = document.title || window.location.hostname;

    // ============================================================
    // DRAG-TO-REPOSITION
    // ============================================================
    //
    // Makes `target` movable by dragging `handle`. Converts target from its
    // CSS right/bottom anchoring to left/top pixel coordinates on first
    // drag, and clamps it to stay fully on-screen. If the pointer never
    // moves past `dragThreshold`, it's treated as a plain click and
    // `onClick` fires instead — so the launcher still opens on tap.

    // Keeps `el` fully inside the viewport without disturbing a position the
    // user deliberately dragged to — it only nudges top/left back on-screen
    // when the element's current size would otherwise overflow. Called after
    // opening the panel and again whenever its content changes height (e.g.
    // once analysis results render in), since #results expanding can push
    // the panel's bottom edge past the bottom of the window.
    function fitPanelToViewport(el, padding = 8) {
        const rect = el.getBoundingClientRect();
        let top = rect.top;
        let left = rect.left;

        const maxTop = window.innerHeight - rect.height - padding;
        const maxLeft = window.innerWidth - rect.width - padding;

        if (top > maxTop) top = Math.max(padding, maxTop);
        if (top < padding) top = padding;
        if (left > maxLeft) left = Math.max(padding, maxLeft);
        if (left < padding) left = padding;

        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
    }

    function makeDraggable(handle, target, { onClick, dragThreshold = 6, draggingClass } = {}) {
        let dragging = false;
        let moved = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        handle.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest(".header-btn")) return; // let close/minimize work normally

            const rect = target.getBoundingClientRect();
            target.style.left = `${rect.left}px`;
            target.style.top = `${rect.top}px`;
            target.style.right = "auto";
            target.style.bottom = "auto";

            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            dragging = true;
            moved = false;

            handle.setPointerCapture(e.pointerId);
            if (draggingClass) {
                handle.classList.add(draggingClass);
                target.classList.add(draggingClass);
            }
        });

        handle.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!moved && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
                moved = true;
            }
            if (!moved) return;

            const rect = target.getBoundingClientRect();
            const maxLeft = Math.max(4, window.innerWidth - rect.width - 4);
            const maxTop = Math.max(4, window.innerHeight - rect.height - 4);
            const newLeft = Math.min(Math.max(4, startLeft + dx), maxLeft);
            const newTop = Math.min(Math.max(4, startTop + dy), maxTop);

            target.style.left = `${newLeft}px`;
            target.style.top = `${newTop}px`;
        });

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            if (draggingClass) {
                handle.classList.remove(draggingClass);
                target.classList.remove(draggingClass);
            }
            try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }

            if (!moved && typeof onClick === "function") onClick(e);
            moved = false;
        }

        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
    }

    function openPanel() {
        const launcherRect = launcher.getBoundingClientRect();
        const width = 360;

        let left = launcherRect.right - width;
        left = Math.min(Math.max(8, left), window.innerWidth - width - 8);

        // Provisional position above the launcher; corrected once we know
        // the panel's real rendered height.
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(8, launcherRect.top - 400)}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        launcher.style.display = "none";
        panel.classList.add("open");

        requestAnimationFrame(() => {
            const panelRect = panel.getBoundingClientRect();
            let top = launcherRect.top - panelRect.height - 12;
            if (top < 8) {
                top = Math.min(launcherRect.bottom + 12, window.innerHeight - panelRect.height - 8);
            }
            panel.style.top = `${Math.max(8, top)}px`;
            fitPanelToViewport(panel);
        });
    }

    // If the panel is open and its content resizes (e.g. results render in)
    // or the window itself resizes, pull it back on-screen if needed.
    window.addEventListener("resize", () => {
        if (panel.classList.contains("open")) fitPanelToViewport(panel);
    });

    function closePanel() {
        panel.classList.remove("open");
        launcher.style.display = "flex";
    }

    makeDraggable(launcher, launcher, { onClick: openPanel, draggingClass: "dragging" });
    makeDraggable(header, panel, { draggingClass: "dragging" });

    shadow.querySelector("#close").addEventListener("click", closePanel);
    shadow.querySelector("#minimize").addEventListener("click", closePanel);

    // ============================================================
    // ANALYZE — runs the extraction pipeline locally (this script
    // already has DOM access), then sends the result to the backend
    // through the existing, correctly-wired backendClient.js helper.
    // ============================================================

    function buildStats(detected) {
        return {
            textBlocks: detected?.content?.blocks?.length || 0,
            headings: detected?.content?.headings?.length || 0,
            lists: detected?.content?.lists?.length || 0,
            tables: detected?.content?.tables?.length || 0,
            policySections: detected?.policySections?.length || 0,
            links: detected?.links?.length || 0,
            interactiveElements: detected?.interactiveElements?.length || 0
        };
    }

    // ============================================================
    // "THINKING" STATUS ANIMATION
    //
    // The backend step (Gemini call) is the slow part — often several
    // seconds. Rather than a single static "Contacting AI..." string,
    // cycle through a few phrases with an animated ellipsis, similar to
    // a streaming "thinking" indicator, so it's clear something is still
    // happening rather than the UI having stalled.
    // ============================================================

    const ANALYSIS_LOADING_PHRASES = [
        "Reviewing terms with PolicyLens AI",
        "Checking return & refund clauses",
        "Cross-checking conditions",
        "Weighing the fine print",
        "Almost there"
    ];

    let loadingPhraseTimer = null;
    let loadingDotsTimer = null;

    function startLoadingAnimation(el, phrases = ANALYSIS_LOADING_PHRASES) {
        stopLoadingAnimation();
        let phraseIndex = 0;
        let dots = 0;

        const render = () => {
            el.textContent = phrases[phraseIndex] + ".".repeat(dots);
        };

        render();
        loadingDotsTimer = setInterval(() => {
            dots = (dots + 1) % 4;
            render();
        }, 450);
        loadingPhraseTimer = setInterval(() => {
            phraseIndex = (phraseIndex + 1) % phrases.length;
            dots = 0;
            render();
        }, 2200);
    }

    function stopLoadingAnimation() {
        if (loadingPhraseTimer) clearInterval(loadingPhraseTimer);
        if (loadingDotsTimer) clearInterval(loadingDotsTimer);
        loadingPhraseTimer = null;
        loadingDotsTimer = null;
    }

    function formatCategory(raw) {
        if (!raw) return "Policy";
        return String(raw)
            .toLowerCase()
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    analyzeButton.addEventListener("click", async () => {
        const missing = getMissingGlobals();
        if (missing.length) {
            status.textContent = `Setup error — missing: ${missing.join(", ")}. Check manifest.json script order.`;
            return;
        }

        analyzeButton.disabled = true;
        analyzeButton.textContent = "Analyzing...";
        status.textContent = "Scanning webpage...";
        results.classList.remove("visible");

        try {
            const raw = window.PolicyLensExtractor.extractPage();
            const cleaned = window.PolicyLensCleaner.clean(raw);
            const detected = window.PolicyLensDetector.detect(cleaned);
            const stats = buildStats(detected);
            const payload = { success: true, data: detected, stats };

            const topSection = detected?.policySections?.[0];
            category.textContent = topSection ? formatCategory(topSection.category) : "General Page";

            startLoadingAnimation(status);
            const backendResult = await window.PolicyLensBackend.sendAnalysis(payload);
            stopLoadingAnimation();

            if (backendResult.sent) {
                payload.ai = backendResult.data;
            } else {
                payload.aiError = backendResult.error || "Backend unavailable";
            }

            renderResults(payload);
            // Results just expanded the panel's content height — make sure
            // it's still fully on-screen (wait a frame so layout settles).
            requestAnimationFrame(() => fitPanelToViewport(panel));

            status.textContent = payload.ai
                ? "✓ AI analysis complete"
                : `✓ Extraction complete — AI analysis unavailable${payload.aiError ? ` (${payload.aiError})` : ""}`;
            analyzeButton.textContent = "Analyze again";
        } catch (error) {
            console.error("[PolicyLens] Analysis failed:", error);
            status.textContent = `Something went wrong: ${error?.message || error}`;
            analyzeButton.textContent = "Analyze with PolicyLens";
        } finally {
            stopLoadingAnimation();
            analyzeButton.disabled = false;
        }
    });

    // ============================================================
    // RENDER RESULTS
    //
    // Dual-mode, matching the popup.js fix in the reference doc: reads
    // `payload.ai` / `payload.aiError` at the TOP level (siblings of
    // `payload.data`) — not nested inside `payload.data`.
    // ============================================================

    function renderResults(payload) {
        results.classList.add("visible");
        cardsEl.innerHTML = "";

        if (payload.ai && Array.isArray(payload.ai.cards) && payload.ai.cards.length) {
            payload.ai.cards.forEach((card) => cardsEl.appendChild(renderAiCard(card)));
            showWarnings(payload.ai.warnings || []);
            return;
        }

        const sections = payload.data?.policySections || [];
        if (!sections.length) {
            cardsEl.innerHTML = `<div class="empty">No clear policy information was found on this page.</div>`;
        } else {
            sections.forEach((section) => cardsEl.appendChild(renderLocalCard(section)));
        }
        showWarnings(deriveLocalWarnings(sections));
    }

    function renderAiCard(card) {
        const el = document.createElement("div");
        el.className = "policy-card";

        const badgeClass =
            card.badgeType === "danger" ? "badge-danger" :
            card.badgeType === "safe" ? "badge-safe" : "badge-attention";

        const row = document.createElement("div");
        row.className = "card-title-row";
        row.innerHTML = `
            <span class="card-title">${escapeHtml(card.label || "Policy")}</span>
            <span class="badge ${badgeClass}">${escapeHtml(card.badgeText || "")}</span>
        `;
        el.appendChild(row);

        if (card.detail) {
            const text = document.createElement("div");
            text.className = "card-text";
            text.textContent = card.detail;
            el.appendChild(text);
        }
        return el;
    }

    function renderLocalCard(section) {
        const el = document.createElement("div");
        el.className = "policy-card";

        const confident = (section.confidence || 0) >= 0.6;
        const row = document.createElement("div");
        row.className = "card-title-row";
        row.innerHTML = `
            <span class="card-title">${escapeHtml(formatCategory(section.category))}</span>
            <span class="badge ${confident ? "badge-safe" : "badge-attention"}">${confident ? "RELEVANT" : "CHECK"}</span>
        `;
        el.appendChild(row);

        (section.blocks || []).forEach((block) => {
            const text = document.createElement("div");
            text.className = "card-text";
            text.textContent = typeof block === "string" ? block : (block?.text || "");
            if (text.textContent) el.appendChild(text);
        });

        if (section.omittedCount) {
            const note = document.createElement("div");
            note.className = "card-note";
            note.textContent = `+${section.omittedCount} more not shown`;
            el.appendChild(note);
        }
        return el;
    }

    function deriveLocalWarnings(sections) {
        const indicators = window.CONDITION_INDICATORS || [];
        if (!indicators.length) return [];
        const found = [];
        sections.forEach((section) => {
            (section.blocks || []).forEach((block) => {
                const text = typeof block === "string" ? block : (block?.text || "");
                const lower = text.toLowerCase();
                if (indicators.some((ind) => lower.includes(ind))) {
                    found.push(text.length > 140 ? `${text.slice(0, 140)}…` : text);
                }
            });
        });
        return found.slice(0, 8);
    }

    function showWarnings(list) {
        if (!list || !list.length) {
            warningBox.style.display = "none";
            return;
        }
        warningBox.style.display = "block";
        warningsEl.innerHTML = "";
        list.forEach((item) => {
            const el = document.createElement("div");
            el.className = "warning-item";
            el.textContent = typeof item === "string" ? item : (item.text || item.message || "");
            warningsEl.appendChild(el);
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
})();