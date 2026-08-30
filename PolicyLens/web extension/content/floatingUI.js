(() => {

    "use strict";

    // Prevent duplicate launcher
    if (
        document.getElementById(
            "policylens-floating-root"
        )
    ) {
        return;
    }


    // ============================================================
    // ROOT + SHADOW DOM
    // ============================================================

    const root =
        document.createElement("div");

    root.id =
        "policylens-floating-root";


    const shadow =
        root.attachShadow({
            mode: "open"
        });


    // ============================================================
    // STYLE
    // ============================================================

    const style =
        document.createElement("style");


    style.textContent = `

        * {
            box-sizing: border-box;
        }


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

            box-shadow:
                0 4px 14px rgba(60,64,67,.20),
                0 2px 5px rgba(60,64,67,.12);

            cursor: pointer;

            z-index: 2147483647;

            transition:
                transform .18s ease,
                box-shadow .18s ease;
        }


        #launcher:hover {

            transform: scale(1.06);

            box-shadow:
                0 7px 20px rgba(60,64,67,.24),
                0 3px 8px rgba(60,64,67,.14);
        }


        .launcher-logo {

            width: 30px;
            height: 30px;

            display: flex;
            align-items: center;
            justify-content: center;

            border-radius: 9px;

            background: #f1f3f4;

            font-size: 17px;
        }


        /* ========================================================
           PANEL
           ======================================================== */

        #panel {

            position: fixed;

            right: 24px;
            bottom: 24px;

            width: 360px;

            max-height: 640px;

            display: none;

            flex-direction: column;

            overflow: hidden;

            border:
                1px solid #dadce0;

            border-radius: 18px;

            background: #ffffff;

            color: #202124;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Arial,
                sans-serif;

            box-shadow:
                0 10px 35px rgba(60,64,67,.22),
                0 3px 10px rgba(60,64,67,.14);

            z-index: 2147483647;

            transition:
                width .2s ease,
                max-height .2s ease;
        }


        #panel.open {

            display: flex;
        }


        /* ========================================================
           HEADER
           ======================================================== */

        .header {

            height: 58px;

            min-height: 58px;

            display: flex;

            align-items: center;

            justify-content: space-between;

            padding:
                0 12px 0 15px;

            border-bottom:
                1px solid #eeeeee;

            cursor: default;
        }


        .brand {

            display: flex;

            align-items: center;

            gap: 9px;
        }


        .logo {

            width: 32px;
            height: 32px;

            display: flex;

            align-items: center;
            justify-content: center;

            border-radius: 9px;

            background: #f1f3f4;

            font-size: 17px;
        }


        .brand-name {

            font-size: 15px;

            font-weight: 700;

            letter-spacing: -.2px;
        }


        .header-actions {

            display: flex;

            gap: 3px;
        }


        .header-btn {

            width: 30px;
            height: 30px;

            display: flex;

            align-items: center;
            justify-content: center;

            border: none;

            border-radius: 50%;

            background: transparent;

            color: #5f6368;

            font-size: 17px;

            cursor: pointer;
        }


        .header-btn:hover {

            background: #f1f3f4;
        }


        /* ========================================================
           BODY
           ======================================================== */

        .body {

            padding: 16px;

            overflow-y: auto;
        }


        .label {

            display: block;

            margin-bottom: 5px;

            font-size: 9px;

            font-weight: 700;

            letter-spacing: 1px;

            color: #80868b;
        }


        .page-name {

            margin-bottom: 9px;

            font-size: 13px;

            font-weight: 600;

            line-height: 1.4;

            color: #202124;

            word-break: break-word;
        }


        .category {

            display: inline-flex;

            padding:
                5px 9px;

            margin-bottom: 14px;

            border-radius: 999px;

            background: #f1f3f4;

            color: #5f6368;

            font-size: 10px;

            font-weight: 600;
        }


        /* ========================================================
           ANALYZE BUTTON
           ======================================================== */

        #analyze {

            width: 100%;

            height: 42px;

            border: none;

            border-radius: 9px;

            background: #1a73e8;

            color: #ffffff;

            font-size: 13px;

            font-weight: 600;

            cursor: pointer;
        }


        #analyze:hover {

            background: #1769d1;
        }


        #analyze:disabled {

            opacity: .65;

            cursor: default;
        }


        /* ========================================================
           STATUS
           ======================================================== */

        .status {

            min-height: 20px;

            margin-top: 8px;

            text-align: center;

            font-size: 10px;

            line-height: 1.4;

            color: #80868b;
        }


        /* ========================================================
           RESULTS
           ======================================================== */

        #results {

            display: none;

            margin-top: 15px;

            padding-top: 15px;

            border-top:
                1px solid #eeeeee;
        }


        #results.visible {

            display: block;
        }


        .results-title {

            margin-bottom: 10px;

            font-size: 16px;

            font-weight: 700;

            letter-spacing: -.2px;
        }


        /* ========================================================
           POLICY CARD
           ======================================================== */

        .policy-card {

            margin-bottom: 8px;

            padding: 11px;

            border:
                1px solid #e0e3e7;

            border-radius: 10px;

            background: #ffffff;
        }


        .card-title {

            margin-bottom: 6px;

            font-size: 12px;

            font-weight: 700;

            color: #202124;
        }


        .card-text {

            margin-bottom: 5px;

            font-size: 11px;

            line-height: 1.45;

            color: #5f6368;
        }


        .card-text:last-child {

            margin-bottom: 0;
        }


        /* ========================================================
           WARNING
           ======================================================== */

        .warning {

            margin-top: 10px;

            padding: 11px;

            border:
                1px solid #f6e7a9;

            border-radius: 10px;

            background: #fff8e1;
        }


        .warning-title {

            margin-bottom: 6px;

            font-size: 11px;

            font-weight: 700;

            color: #5f4b00;
        }


        .warning-item {

            margin-bottom: 4px;

            font-size: 10px;

            line-height: 1.4;

            color: #665c32;
        }


        .warning-item:last-child {

            margin-bottom: 0;
        }


        /* ========================================================
           NO RESULTS
           ======================================================== */

        .empty {

            padding: 15px;

            border:
                1px dashed #dadce0;

            border-radius: 9px;

            text-align: center;

            font-size: 10px;

            color: #80868b;
        }


        /* ========================================================
           SCROLLBAR
           ======================================================== */

        .body::-webkit-scrollbar {

            width: 5px;
        }


        .body::-webkit-scrollbar-thumb {

            background: #dadce0;

            border-radius: 10px;
        }

    `;


    shadow.appendChild(style);


    // ============================================================
    // LAUNCHER
    // ============================================================

    const launcher =
        document.createElement("button");

    launcher.id =
        "launcher";

    launcher.setAttribute(
        "aria-label",
        "Open PolicyLens"
    );


    launcher.innerHTML = `
        <div class="launcher-logo">
            🛡️
        </div>
    `;


    // ============================================================
    // PANEL
    // ============================================================

    const panel =
        document.createElement("div");

    panel.id =
        "panel";


    panel.innerHTML = `

        <div class="header">

            <div class="brand">

                <div class="logo">
                    🛡️
                </div>

                <div class="brand-name">
                    PolicyLens
                </div>

            </div>


            <div class="header-actions">

                <button
                    class="header-btn"
                    id="minimize"
                    title="Minimize"
                >
                    −
                </button>


                <button
                    class="header-btn"
                    id="close"
                    title="Close"
                >
                    ×
                </button>

            </div>

        </div>


        <div class="body">

            <span class="label">
                CURRENT PAGE
            </span>


            <div
                class="page-name"
                id="page-name"
            >
                Loading page...
            </div>


            <div
                class="category"
                id="category"
            >
                Detecting...
            </div>


            <button
                id="analyze"
                type="button"
            >
                Analyze with PolicyLens
            </button>


            <div
                class="status"
                id="status"
            >
                Ready to analyze this page.
            </div>


            <div
                id="results"
            >

                <div class="results-title">
                    Policy Summary
                </div>


                <div id="cards">
                </div>


                <div
                    class="warning"
                    id="warning"
                    style="display:none;"
                >

                    <div class="warning-title">
                        ⚠️ Things you should know
                    </div>


                    <div id="warnings">
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

    const analyzeButton =
        shadow.querySelector("#analyze");

    const status =
        shadow.querySelector("#status");

    const pageName =
        shadow.querySelector("#page-name");

    const category =
        shadow.querySelector("#category");

    const results =
        shadow.querySelector("#results");

    const cards =
        shadow.querySelector("#cards");

    const warning =
        shadow.querySelector("#warning");

    const warnings =
        shadow.querySelector("#warnings");


    // ============================================================
    // PAGE INFORMATION
    // ============================================================

    pageName.textContent =
        document.title ||
        window.location.hostname;


    // ============================================================
    // GET SITE CONTEXT
    // ============================================================

    chrome.runtime.sendMessage(
        {
            action:
                "getSiteContext"
        },
        response => {

            if (
                chrome.runtime.lastError
            ) {
                return;
            }


            if (
                response &&
                response.success &&
                response.data
            ) {

                const data =
                    response.data;


                pageName.textContent =
                    data.title ||
                    document.title ||
                    window.location.hostname;


                category.textContent =
                    data.category ||
                    "General Page";
            }
        }
    );


    // ============================================================
    // OPEN PANEL
    // ============================================================

    launcher.addEventListener(
        "click",
        () => {

            launcher.style.display =
                "none";

            panel.classList.add(
                "open"
            );
        }
    );


    // ============================================================
    // CLOSE PANEL
    // ============================================================

    shadow
        .querySelector("#close")
        .addEventListener(
            "click",
            () => {

                panel.classList.remove(
                    "open"
                );

                launcher.style.display =
                    "flex";
            }
        );


    // ============================================================
    // MINIMIZE
    // ============================================================

    shadow
        .querySelector("#minimize")
        .addEventListener(
            "click",
            () => {

                panel.classList.remove(
                    "open"
                );

                launcher.style.display =
                    "flex";
            }
        );


    // ============================================================
    // ANALYZE
    // ============================================================

    analyzeButton.addEventListener(
        "click",
        () => {

            analyzeButton.disabled =
                true;

            analyzeButton.textContent =
                "Analyzing...";

            status.textContent =
                "Scanning webpage...";


            chrome.runtime.sendMessage(
                {
                    action:
                        "analyzeLocal"
                },
                response => {

                    if (
                        chrome.runtime.lastError
                    ) {

                        status.textContent =
                            "Could not connect to page.";

                        analyzeButton.disabled =
                            false;

                        analyzeButton.textContent =
                            "Analyze with PolicyLens";

                        return;
                    }


                    if (
                        !response ||
                        !response.success
                    ) {

                        status.textContent =
                            response?.error ||
                            "Analysis failed.";

                        analyzeButton.disabled =
                            false;

                        analyzeButton.textContent =
                            "Analyze with PolicyLens";

                        return;
                    }


                    renderResults(
                        response.data
                    );


                    status.textContent =
                        "✓ Analysis complete";

                    analyzeButton.disabled =
                        false;

                    analyzeButton.textContent =
                        "Analyze again";
                }
            );
        }
    );


    // ============================================================
    // RENDER RESULTS
    // ============================================================

    function renderResults(data) {

        results.classList.add(
            "visible"
        );


        cards.innerHTML =
            "";


        const sections =
            data.sections ||
            data.policySections ||
            [];


        if (!sections.length) {

            cards.innerHTML = `
                <div class="empty">
                    No clear policy information
                    was found on this page.
                </div>
            `;

        } else {

            sections.forEach(
                section => {

                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "policy-card";


                    const title =
                        document.createElement(
                            "div"
                        );


                    title.className =
                        "card-title";


                    title.textContent =
                        section.title ||
                        section.key ||
                        "Policy";


                    card.appendChild(
                        title
                    );


                    const statements =
                        section.statements ||
                        [];


                    statements.forEach(
                        statement => {

                            const text =
                                document.createElement(
                                    "div"
                                );


                            text.className =
                                "card-text";


                            text.textContent =
                                typeof statement ===
                                "string"
                                    ? statement
                                    : (
                                        statement.text ||
                                        ""
                                    );


                            if (
                                text.textContent
                            ) {

                                card.appendChild(
                                    text
                                );
                            }

                        }
                    );


                    cards.appendChild(
                        card
                    );

                }
            );
        }


        // ========================================================
        // WARNINGS
        // ========================================================

        const warningList =
            data.warnings || [];


        if (
            warningList.length
        ) {

            warning.style.display =
                "block";


            warnings.innerHTML =
                "";


            warningList.forEach(
                item => {

                    const element =
                        document.createElement(
                            "div"
                        );


                    element.className =
                        "warning-item";


                    element.textContent =
                        typeof item ===
                        "string"
                            ? item
                            : (
                                item.text ||
                                item.message ||
                                ""
                            );


                    warnings.appendChild(
                        element
                    );

                }
            );

        } else {

            warning.style.display =
                "none";
        }
    }


})();