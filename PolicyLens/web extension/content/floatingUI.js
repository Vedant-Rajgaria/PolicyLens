/**
 * PolicyLens — Floating In-Page Widget (Content Script)
 * Award-Winning Typography: Outfit + Plus Jakarta Sans
 * Clean UI (No Star Emoji, No Pill Tag) + Morphing Animation
 * Designed by Vedant & Darsh
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
    // STYLES (Outfit + Plus Jakarta Sans + Morphing Animations)
    // ============================================================

    const style = document.createElement("style");
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        /* --- Floating Interactive Logo Launcher (NO WHITE CIRCLE) --- */
        #launcher {
            position: fixed;
            right: 26px;
            bottom: 26px;
            width: 60px;
            height: 60px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            cursor: grab;
            z-index: 2147483647;
            touch-action: none;
            padding: 0;
            outline: none;
            user-select: none;
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), filter 0.25s ease, opacity 0.2s ease;
            filter: drop-shadow(0 8px 18px rgba(37, 99, 235, 0.45)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.2));
            animation: launcherFloat 4s ease-in-out infinite alternate;
        }

        @keyframes launcherFloat {
            0% { transform: translateY(0px); }
            100% { transform: translateY(-4px); }
        }

        #launcher:hover {
            transform: scale(1.15) rotate(3deg) translateY(-2px);
            filter: drop-shadow(0 14px 28px rgba(37, 99, 235, 0.65)) drop-shadow(0 4px 12px rgba(230, 58, 45, 0.35));
        }

        #launcher:active {
            transform: scale(0.94) rotate(-2deg);
            filter: drop-shadow(0 4px 10px rgba(37, 99, 235, 0.5));
        }

        #launcher.dragging {
            cursor: grabbing;
            transition: none;
            animation: none;
            transform: scale(1.08);
        }

        .launcher-logo-wrap {
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        }

        .launcher-logo-wrap svg {
            width: 100%;
            height: 100%;
            display: block;
            overflow: visible;
        }

        /* --- Floating Panel Window --- */
        #panel {
            position: fixed;
            right: 24px;
            bottom: 24px;
            width: 450px;
            max-height: 88vh;
            display: none;
            flex-direction: column;
            overflow: visible;
            background: transparent;
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 2147483647;
            perspective: 1000px;
        }

        #panel.open {
            display: flex;
        }

        /* --- Outer Container with Decorative Shapes --- */
        .widget-outer-container {
            position: relative;
            width: 450px;
            padding: 27px 35px;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            overflow: visible;
        }

        /* --- LOGO DISASSEMBLY / CORNER RIBBON MORPHING ANIMATIONS --- */
        .decorative-ribbon {
            position: absolute;
            pointer-events: none;
            z-index: 1;
            will-change: transform, opacity;
            transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease;
        }

        /* Top-Left Red Ribbon */
        .ribbon-red {
            top: 15px;
            left: 20px;
            width: 46px;
            height: 98px;
            background: #E63A2D;
            border-radius: 24px 0 0 24px;
            box-shadow: inset 0 4px 4px rgba(0, 0, 0, 0.25);
        }

        /* Top-Right Blue Ribbon */
        .ribbon-blue {
            top: 15px;
            right: 15px;
            width: 80px;
            height: 90px;
            background: #2E6CF6;
            border-radius: 0 40px 40px 0;
        }

        /* Bottom-Left Green Ribbon */
        .ribbon-green {
            bottom: 12px;
            left: 12px;
            width: 85px;
            height: 48px;
            background: #3AAA4D;
            border-radius: 0 0 0 28px;
        }

        /* Bottom-Right Yellow Ribbon */
        .ribbon-yellow {
            bottom: 12px;
            right: 25px;
            width: 32px;
            height: 70px;
            background: #FCBD08;
            border-radius: 0 16px 16px 0;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.25);
        }

        /* Expanding & Morphing State */
        #panel.open .ribbon-blue {
            animation: morphRibbonBlue 0.48s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        #panel.open .ribbon-red {
            animation: morphRibbonRed 0.48s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        #panel.open .ribbon-green {
            animation: morphRibbonGreen 0.48s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        #panel.open .ribbon-yellow {
            animation: morphRibbonYellow 0.48s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes morphRibbonBlue {
            0% { transform: translate(-140px, 120px) scale(0.35) rotate(-15deg); opacity: 0.5; }
            100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes morphRibbonRed {
            0% { transform: translate(140px, 100px) scale(0.35) rotate(15deg); opacity: 0.5; }
            100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes morphRibbonGreen {
            0% { transform: translate(140px, -110px) scale(0.35) rotate(-10deg); opacity: 0.5; }
            100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes morphRibbonYellow {
            0% { transform: translate(-140px, -110px) scale(0.35) rotate(10deg); opacity: 0.5; }
            100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
        }

        /* Closing State: Pull Ribbons Back to Center */
        #panel.closing .ribbon-blue {
            transform: translate(-140px, 120px) scale(0.35) rotate(-15deg);
            opacity: 0;
        }
        #panel.closing .ribbon-red {
            transform: translate(140px, 100px) scale(0.35) rotate(15deg);
            opacity: 0;
        }
        #panel.closing .ribbon-green {
            transform: translate(140px, -110px) scale(0.35) rotate(-10deg);
            opacity: 0;
        }
        #panel.closing .ribbon-yellow {
            transform: translate(-140px, -110px) scale(0.35) rotate(10deg);
            opacity: 0;
        }

        /* --- Main PolicyLens Card --- */
        .policylens-card {
            position: relative;
            z-index: 10;
            width: 380px;
            max-height: calc(88vh - 54px);
            background-color: #E2ECFE;
            border-radius: 24px;
            padding: 20px 20px 18px 20px;
            box-shadow: 0 26px 52px -12px rgba(0, 0, 0, 0.42), 0 4px 14px rgba(37, 99, 235, 0.16);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: rgba(107, 114, 128, 0.4) transparent;
            will-change: transform, opacity;
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
        }

        #panel.open .policylens-card {
            animation: cardOpenMorph 0.44s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        #panel.closing .policylens-card {
            transform: scale(0.85);
            opacity: 0;
        }

        @keyframes cardOpenMorph {
            0% { opacity: 0; transform: scale(0.84) translateY(12px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
        }

        .policylens-card::-webkit-scrollbar {
            width: 5px;
        }

        .policylens-card::-webkit-scrollbar-thumb {
            background: rgba(107, 114, 128, 0.4);
            border-radius: 10px;
        }

        /* --- Aesthetic Info Toast (Designed by Vedant & Darsh - Clean No-Emoji) --- */
        .info-toast {
            position: absolute;
            top: 14px;
            left: 14px;
            right: 14px;
            z-index: 100;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: 14px;
            border: 1px solid rgba(255, 255, 255, 0.85);
            box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.28), 0 4px 14px rgba(37, 99, 235, 0.2);
            padding: 14px 16px;
            animation: toastSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .info-toast.hidden {
            display: none !important;
        }

        @keyframes toastSlideDown {
            from { opacity: 0; transform: translateY(-12px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .info-toast-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }

        .info-toast-title {
            font-family: 'Outfit', sans-serif;
            font-size: 13.5px;
            font-weight: 700;
            color: #111827;
            letter-spacing: -0.02em;
            flex: 1;
        }

        .info-toast-close {
            background: transparent;
            border: none;
            font-size: 18px;
            line-height: 1;
            color: #6B7280;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            transition: color 0.15s ease, background 0.15s ease;
        }

        .info-toast-close:hover {
            color: #111827;
            background: rgba(0, 0, 0, 0.05);
        }

        .info-toast-msg {
            font-size: 11.5px;
            font-weight: 500;
            color: #374151;
            line-height: 1.45;
            margin-bottom: 6px;
        }

        .info-toast-credits {
            font-size: 10.5px;
            color: #6B7280;
            border-top: 1px solid rgba(0, 0, 0, 0.06);
            padding-top: 6px;
        }

        .info-toast-credits strong {
            color: #2563EB;
            font-weight: 700;
        }

        /* Header */
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 14px;
            cursor: grab;
            touch-action: none;
            user-select: none;
        }

        .card-header.dragging {
            cursor: grabbing;
        }

        .header-titles {
            display: flex;
            flex-direction: column;
            gap: 1px;
            pointer-events: none;
        }

        .card-title {
            font-family: 'Outfit', sans-serif;
            font-size: 23px;
            font-weight: 800;
            color: #111827;
            line-height: 1.15;
            letter-spacing: -0.04em;
        }

        .card-subtitle {
            font-size: 12px;
            font-weight: 500;
            color: #6B7280;
            line-height: 1.35;
            letter-spacing: -0.01em;
        }

        /* Window Control Dots */
        .window-controls {
            display: flex;
            align-items: center;
            gap: 6px;
            padding-top: 4px;
        }

        .dot {
            width: 15px;
            height: 15px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            padding: 0;
            outline: none;
            transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease, filter 0.18s ease;
        }

        .dot:hover {
            transform: scale(1.22);
            opacity: 0.95;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
        }

        .dot:active {
            transform: scale(0.95);
        }

        .dot-close { background-color: #E63A2D; }
        .dot-minimize { background-color: #FCBD08; }
        .dot-expand { background-color: #3AAA4D; }

        /* Current Page Box (Clean box without pill) */
        .page-info {
            background-color: #FFFFFF;
            border-radius: 10px;
            padding: 10px 12px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
            margin-bottom: 14px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .page-info-header {
            display: flex;
            align-items: center;
            justify-content: flex-start;
        }

        .label {
            font-family: 'Outfit', sans-serif;
            font-size: 9.5px;
            font-weight: 700;
            color: #6B7280;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .page-name-text {
            font-size: 10px;
            font-weight: 500;
            color: #111827;
            line-height: 1.35;
            letter-spacing: -0.01em;
            word-break: break-word;
        }

        /* Primary Analyze Button — Bold, Solid, Robust */
        #analyze {
            width: 100% !important;
            height: 42px !important;
            min-height: 42px !important;
            padding: 0 16px !important;
            background-color: #2563EB;
            color: #FFFFFF;
            border: none;
            border-radius: 9px;
            font-family: 'Outfit', sans-serif;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: -0.02em;
            line-height: 42px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.32);
            transition: background-color 0.2s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
            outline: none;
            flex-shrink: 0;
        }

        #analyze:hover {
            background-color: #1D4ED8;
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.44);
            transform: translateY(-1px);
        }

        #analyze:active {
            background-color: #1E40AF;
            transform: translateY(1px) scale(0.99);
        }

        #analyze:disabled {
            opacity: 0.75;
            cursor: not-allowed;
            transform: none;
        }

        /* Status Line */
        #status {
            text-align: center;
            font-size: 11.2px;
            font-weight: 500;
            color: #6B7280;
            line-height: 1.35;
            letter-spacing: -0.01em;
            margin-top: 10px;
        }

        /* Results Container */
        #results {
            display: none;
            margin-top: 14px;
            flex-direction: column;
            gap: 12px;
            animation: resultsFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        #results.visible {
            display: flex;
        }

        @keyframes resultsFadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .results-heading {
            font-family: 'Outfit', sans-serif;
            font-size: 22px;
            font-weight: 800;
            color: #111827;
            line-height: 1.2;
            letter-spacing: -0.035em;
        }

        #cards {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .policy-card {
            background-color: #E3ECFF;
            border-radius: 10px;
            padding: 12px 14px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: transform 0.18s ease, box-shadow 0.18s ease;
        }

        .policy-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(37, 99, 235, 0.08);
        }

        .card-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-title {
            font-family: 'Outfit', sans-serif;
            font-size: 14.5px;
            font-weight: 700;
            color: #111827;
            letter-spacing: -0.02em;
        }

        /* Pill Badges */
        .badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-family: 'Outfit', sans-serif;
            font-size: 8.5px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 70px;
            line-height: 1.2;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .badge-safe {
            background-color: #C4FECE;
            color: #166534;
        }

        .badge-attention {
            background-color: #FFDEA3;
            color: #9A3412;
        }

        .badge-danger {
            background-color: #FEE2E2;
            color: #991B1B;
        }

        .card-text {
            font-size: 11px;
            font-weight: 500;
            color: #374151;
            line-height: 1.48;
            letter-spacing: -0.01em;
            text-align: justify;
        }

        .card-note {
            font-size: 10px;
            color: #9CA3AF;
            font-style: italic;
            margin-top: 4px;
        }

        /* Warnings Section */
        .warning {
            background-color: #FFF7ED;
            border: 1px solid #FED7AA;
            border-radius: 10px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .warning-title {
            font-family: 'Outfit', sans-serif;
            font-size: 13.5px;
            font-weight: 700;
            color: #9A3412;
            letter-spacing: -0.02em;
            line-height: 1.3;
        }

        #warnings {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .warning-item {
            font-size: 11px;
            font-weight: 500;
            color: #431407;
            line-height: 1.45;
            letter-spacing: -0.01em;
            position: relative;
            padding-left: 14px;
        }

        .warning-item::before {
            content: "•";
            position: absolute;
            left: 2px;
            color: #EA580C;
            font-weight: bold;
        }

        .empty {
            padding: 15px;
            border: 1px dashed rgba(107, 114, 128, 0.3);
            border-radius: 9px;
            text-align: center;
            font-size: 11px;
            color: #6B7280;
        }
    `;
    shadow.appendChild(style);

    // ============================================================
    // LAUNCHER (Floating button with Pure Vector Logo — NO WHITE CIRCLE)
    // ============================================================

    const launcher = document.createElement("button");
    launcher.id = "launcher";
    launcher.setAttribute("aria-label", "Open PolicyLens");
    launcher.innerHTML = `
        <div class="launcher-logo-wrap">
            <svg width="48" height="48" viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg">
                <!-- Blue Ribbon Top-Right -->
                <path d="M20.3604 10.0302C26.3707 10.0252 82.3794 10.0194 107.547 10.0109C137.208 9.95437 149.948 14.3681 151.588 14.9138C170.86 21.4342 185.349 33.0976 193.387 48.391C198.9 62.9277 199.455 69.4441 199.413 76.1406C199.387 83.0161 198.944 88.5221 197.25 94.1226C192.311 110.37 180.911 124.114 164.858 132.405C151.1 138.891 138.297 141.729 122.155 141.729V102.92C129.338 101.885 138.182 99.5486 148.479 89.2451C152.367 82.6865 152.958 74.6481 150.336 67.6934C146.556 60.1137 140.141 53.6436 130.644 50.1379C124.625 48.1797 112.636 46.9582 110.1 46.9474H20.3604C10.0446 34.1037 10.1299 24.9448 10.171 19.7502C10.2553 16.264 13.8674 11.2625 20.3604 10.0302Z" fill="#2E6CF6"/>
                <!-- Red Ribbon Top-Left -->
                <path d="M128.534 81.5513L127.66 209.687C120.14 209.687 108.411 209.763 94.5786 203.156L93.242 202.295C87.7532 198.468 84.0505 192.272 82.8247 186.597C82.6429 184.302 82.6759 177.648 82.7028 166.23C82.7453 150.992 82.7726 133.983 82.8247 116.739C74.2733 116.891 67.1197 118.186 64.3766 124.787C64.3617 136.949 64.3121 153.188 64.2922 168.993C64.2562 182.087 64.218 201.186 64.2159 203.031C59.6436 208.769 49.5195 209.59 42.4554 209.596C28.2954 209.64 20.7548 208.509 17.2722 199.891C17.2407 182.973 17.2149 142.755 17.1876 108.449C17.1291 99.269 19.2503 92.1903 27.4019 85.303C34.3933 79.9664 41.9448 78.2851 51.3653 78.3126H121.034C124.33 78.5807 126.409 79.5662 128.534 81.5513Z" fill="#E63A2D"/>
                <!-- Green Ribbon Bottom-Left -->
                <path d="M127.712 168.789C131.359 172.455 135.017 173.634 140.36 173.696H171.159C185.819 173.717 196.919 173.714 207.686 176.033C210.449 178.436 209.945 189.921 210 200.703C207.03 208.116 200.467 209.873 184.832 209.911C163.228 209.928 134.186 209.975 118.629 209.99C106.869 210.066 99.6743 208.269 92.9686 203.459C87.712 199.753 83.1357 192.592 83.1357 191.04C97.0812 191.581 108.701 188.453 110.476 187.735C118.111 184.437 123.479 179.093 126.342 172.613C126.851 170.759 127.272 169.482 127.712 168.789Z" fill="#3AAA4D"/>
                <!-- Yellow Ribbon Bottom-Right -->
                <path d="M127.376 112.203H128.029C128.141 138.103 128.215 155.102 128.252 164.31C128.236 172.779 124.445 179.226 118.602 184.293C114.538 187.325 104.522 190.858 102.698 191.483C93.3799 191.99 88.5153 191.975 82.9728 191.375C81.5212 187.678 81.5185 180.353 81.5449 166.869C81.5874 151.63 81.6147 134.621 81.6668 117.378C87.6958 117.325 96.8228 117.229 103.861 117.159C110.656 117.089 116.879 117.025 118.966 117.004C121.908 116.779 123.596 116.279 125.581 114.532C126.714 113.315 127.376 112.203 127.376 112.203Z" fill="#FCBD08"/>
            </svg>
        </div>
    `;

    // ============================================================
    // FLOATING PANEL (Exact Figma UI Components + Info Toast)
    // ============================================================

    const panel = document.createElement("div");
    panel.id = "panel";
    panel.innerHTML = `
        <div class="widget-outer-container">
            <!-- Disassembled Corner Ribbons -->
            <div class="decorative-ribbon ribbon-blue"></div>
            <div class="decorative-ribbon ribbon-red"></div>
            <div class="decorative-ribbon ribbon-green"></div>
            <div class="decorative-ribbon ribbon-yellow"></div>

            <!-- Main Card -->
            <div class="policylens-card">
                <!-- Aesthetic Info Toast (Clean Note - Star emoji removed) -->
                <div class="info-toast hidden" id="info-toast">
                    <div class="info-toast-header">
                        <span class="info-toast-title">PolicyLens Note</span>
                        <button class="info-toast-close" id="info-toast-close" type="button" aria-label="Close Note">&times;</button>
                    </div>
                    <p class="info-toast-msg">This button is for aesthetic purposes only.</p>
                    <p class="info-toast-credits">Designed by <strong>Vedant &amp; Darsh</strong>.</p>
                </div>

                <!-- Header -->
                <div class="card-header" id="header">
                    <div class="header-titles">
                        <div class="card-title">PolicyLens</div>
                        <div class="card-subtitle">Know what you're agreeing to.</div>
                    </div>
                    <div class="window-controls">
                        <button class="dot dot-close" id="close" title="Close PolicyLens" type="button"></button>
                        <button class="dot dot-minimize" id="minimize" title="Minimize PolicyLens" type="button"></button>
                        <button class="dot dot-expand" id="info-btn" title="Aesthetic Info" type="button"></button>
                    </div>
                </div>

                <!-- Page Info (Clean without pill badge) -->
                <div class="page-info">
                    <div class="page-info-header">
                        <span class="label">CURRENT PAGE</span>
                    </div>
                    <div class="page-name-text" id="page-name">Loading page...</div>
                </div>

                <!-- Analyze Button -->
                <button id="analyze" type="button">Analyze with PolicyLens</button>

                <!-- Status -->
                <div id="status">Ready to analyze this page.</div>

                <!-- Results -->
                <div id="results">
                    <div class="results-heading">Policy Summary</div>
                    <div id="cards"></div>

                    <div class="warning" id="warning" style="display:none;">
                        <div class="warning-title">⚠️ Things you should know</div>
                        <div id="warnings"></div>
                    </div>
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
    const results = shadow.querySelector("#results");
    const cardsEl = shadow.querySelector("#cards");
    const warningBox = shadow.querySelector("#warning");
    const warningsEl = shadow.querySelector("#warnings");
    const infoBtn = shadow.querySelector("#info-btn");
    const infoToast = shadow.querySelector("#info-toast");
    const infoToastClose = shadow.querySelector("#info-toast-close");

    pageName.textContent = document.title || window.location.hostname;

    // ============================================================
    // INFO TOAST HANDLERS (Designed by Vedant & Darsh)
    // ============================================================

    infoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        infoToast.classList.remove("hidden");
    });

    infoToastClose.addEventListener("click", (e) => {
        e.stopPropagation();
        infoToast.classList.add("hidden");
    });

    // ============================================================
    // DRAGGABLE & VIEWPORT CLAMPING
    // ============================================================

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
            if (e.target.closest(".dot") || e.target.closest(".info-toast")) return;

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
            try { handle.releasePointerCapture(e.pointerId); } catch (_) {}

            if (!moved && typeof onClick === "function") onClick(e);
            moved = false;
        }

        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
    }

    // ============================================================
    // SMOOTH LOGO MORPHING OPEN / CLOSE / MINIMIZE
    // ============================================================

    let isTransitioning = false;

    function openPanel() {
        if (isTransitioning) return;
        isTransitioning = true;

        const launcherRect = launcher.getBoundingClientRect();
        const width = 450;

        let left = launcherRect.right - width;
        left = Math.min(Math.max(8, left), window.innerWidth - width - 8);

        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(8, launcherRect.top - 460)}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        panel.classList.remove("closing");
        panel.classList.add("open");

        launcher.style.opacity = "0";
        launcher.style.pointerEvents = "none";

        setTimeout(() => {
            launcher.style.display = "none";
            isTransitioning = false;
            fitPanelToViewport(panel);
        }, 320);
    }

    function closePanelSmoothly(destroyEntirely = false) {
        if (isTransitioning) return;
        isTransitioning = true;

        panel.classList.add("closing");

        if (!destroyEntirely) {
            launcher.style.display = "flex";
            setTimeout(() => {
                launcher.style.opacity = "1";
                launcher.style.pointerEvents = "auto";
            }, 50);
        }

        setTimeout(() => {
            panel.classList.remove("open");
            panel.classList.remove("closing");
            isTransitioning = false;
            if (destroyEntirely) {
                root.remove();
            }
        }, 380);
    }

    window.addEventListener("resize", () => {
        if (panel.classList.contains("open")) fitPanelToViewport(panel);
    });

    makeDraggable(launcher, launcher, { onClick: openPanel, draggingClass: "dragging" });
    makeDraggable(header, panel, { draggingClass: "dragging" });

    // Red Dot: Close extension completely
    shadow.querySelector("#close").addEventListener("click", () => {
        closePanelSmoothly(true);
    });

    // Yellow Dot: Minimize extension back to floating logo
    shadow.querySelector("#minimize").addEventListener("click", () => {
        closePanelSmoothly(false);
    });

    // ============================================================
    // PIPELINE & AI EXTRACTION
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
            .replace(/\\b\\w/g, (c) => c.toUpperCase());
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

            startLoadingAnimation(status);
            const backendResult = await window.PolicyLensBackend.sendAnalysis(payload);
            stopLoadingAnimation();

            if (backendResult.sent) {
                payload.ai = backendResult.data;
            } else {
                payload.aiError = backendResult.error || "Backend unavailable";
            }

            renderResults(payload);
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
            <span class="badge ${badgeClass}">&lt;${escapeHtml(card.badgeText || badgeClass.toUpperCase())}/&gt;</span>
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
            <span class="badge ${confident ? "badge-safe" : "badge-attention"}">&lt;${confident ? "Relevant" : "Check"}/&gt;</span>
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
})();S