const analyzeButton = document.querySelector("#analyze-btn");
const results = document.querySelector("#results");
const pageName = document.querySelector("#page-name");
const siteBadge = document.querySelector("#site-badge");
const status = document.querySelector("#status");


// ==================================================
// SITE LABELS
// ==================================================

const SITE_LABELS = {
    amazon: "🛒 Amazon — optimized extraction",
    flipkart: "🛒 Flipkart — optimized extraction",
    generic: "🌐 Generic page — standard extraction"
};


// ==================================================
// GET CURRENT TAB
// ==================================================

async function getCurrentTab() {

    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tabs || tabs.length === 0) {
        throw new Error("No active tab found.");
    }

    return tabs[0];
}


// ==================================================
// LOAD PAGE INFORMATION
// ==================================================

function detectSiteFromUrl(url) {

    if (!url) return "generic";

    if (url.includes("amazon.")) return "amazon";
    if (url.includes("flipkart.")) return "flipkart";

    return "generic";
}


function showSiteBadge(site) {

    siteBadge.textContent =
        SITE_LABELS[site] || SITE_LABELS.generic;

    siteBadge.classList.remove("hidden");
}


async function loadPageInfo() {

    try {

        const tab = await getCurrentTab();

        pageName.textContent =
            tab.title || "Unknown page";

        showSiteBadge(
            detectSiteFromUrl(tab.url)
        );

        console.log(
            "[PolicyLens] Current tab:",
            tab
        );

    } catch (error) {

        console.error(
            "[PolicyLens] Page information error:",
            error
        );

        pageName.textContent =
            "Unable to identify page";
    }
}


// ==================================================
// ANALYZE PAGE
// ==================================================

function resetAnalyzeButton() {

    analyzeButton.textContent =
        "Analyze with PolicyLens";

    analyzeButton.disabled = false;
}


async function analyzePage() {

    try {

        analyzeButton.textContent =
            "Analyzing...";

        analyzeButton.disabled = true;

        status.textContent =
            "Scanning webpage...";


        const tab = await getCurrentTab();


        console.log(
            "[PolicyLens] Sending request to tab:",
            tab.id
        );


        status.textContent =
            "Sending to PolicyLens backend for analysis...";


        chrome.tabs.sendMessage(
            tab.id,
            {
                action: "analyzePage"
            },
            function (response) {

                if (chrome.runtime.lastError) {

                    console.error(
                        "[PolicyLens] Connection error:",
                        chrome.runtime.lastError.message
                    );

                    status.textContent =
                        "Could not connect to page.";

                    resetAnalyzeButton();

                    return;
                }


                console.log(
                    "[PolicyLens] Response received from content script."
                );


                if (!response) {

                    status.textContent =
                        "No response from page.";

                    resetAnalyzeButton();

                    return;
                }


                if (response.success === false) {

                    console.error(
                        "[PolicyLens] Extraction failed:",
                        response.error
                    );

                    status.textContent =
                        "Extraction failed.";

                    resetAnalyzeButton();

                    return;
                }


                // ==========================================
                // SUCCESS
                // ==========================================

                console.log(
                    "[PolicyLens] Extraction successful."
                );


                analyzeButton.textContent =
                    "Analyze again";

                analyzeButton.disabled = false;


                results.classList.remove("hidden");


                if (response.data.page?.site) {
                    showSiteBadge(response.data.page.site);
                }


                renderSummary(
                    response.data.policySections
                );

                renderPolicySections(
                    response.data.policySections
                );

                renderLinks(
                    response.data.links
                );

                renderStats(
                    response.data,
                    response.stats
                );

                showRawOutput(
                    response.data
                );

                renderAiResults(response);

            }
        );

    } catch (error) {

        console.error(
            "[PolicyLens] Analyze error:",
            error
        );

        status.textContent =
            "Something went wrong.";

        resetAnalyzeButton();
    }
}


// ==================================================
// RENDER AI RESULTS (from backend /analyze -> Gemini)
// ==================================================

function renderAiResults(response) {

    const data =
        response.data || {};


    if (response.ai && response.ai.cards) {

        status.textContent =
            "✓ AI analysis complete";

        renderPolicySections(
            response.ai.cards
        );

        renderWarningsFromAi(
            response.ai.warnings
        );

        return;
    }


    console.warn(
        "[PolicyLens] AI analysis unavailable:",
        response.aiError
    );

    status.textContent = response.aiError
        ? `✓ Extraction complete — AI analysis unavailable (${response.aiError})`
        : "✓ Extraction complete — AI analysis unavailable";

    renderWarnings(
        data.policySections
    );
}


// ==================================================
// RENDER SUMMARY LINE
// ==================================================

function renderSummary(policySections) {

    const summaryLine =
        document.querySelector("#summary-line");

    if (!summaryLine) {
        return;
    }

    const count =
        policySections ? policySections.length : 0;

    if (count === 0) {

        summaryLine.textContent =
            "No policy topics detected on this page.";

        return;
    }

    const categoryNames = policySections
        .map(section => formatCategory(section.category))
        .join(", ");

    summaryLine.textContent =
        `${count} policy topic${count === 1 ? "" : "s"} found: ${categoryNames}`;
}


// ==================================================
// RENDER POLICY CARDS
// ==================================================

function renderPolicySections(sections) {

    const container =
        document.querySelector("#cards-container");


    container.innerHTML = "";


    if (
        !sections ||
        sections.length === 0
    ) {

        const message =
            document.createElement("p");

        message.textContent =
            "No policy-related information detected on this page.";

        message.style.fontSize = "13px";
        message.style.color = "#6b7280";

        container.appendChild(message);

        return;
    }


    sections.forEach(section => {

        const isAiCard =
            typeof section.label === "string";

        const card =
            document.createElement("div");

        card.className =
            "policy-card";


        const top =
            document.createElement("div");

        top.className =
            "card-top";


        const title =
            document.createElement("strong");

        title.textContent = isAiCard
            ? section.label
            : formatCategory(section.category);


        const badge =
            document.createElement("span");

        badge.className =
            "badge";


        if (isAiCard) {

            const badgeType =
                section.badgeType || "attention";

            badge.classList.add(badgeType);

            badge.textContent =
                section.badgeText || badgeType.toUpperCase();

        } else if (section.confidence >= 0.6) {

            badge.classList.add("safe");

            badge.textContent =
                "RELEVANT";

        } else {

            badge.classList.add("attention");

            badge.textContent =
                "CHECK";
        }


        top.appendChild(title);
        top.appendChild(badge);


        card.appendChild(top);


        if (isAiCard) {

            const paragraph =
                document.createElement("p");

            paragraph.textContent =
                section.detail || "";

            card.appendChild(paragraph);

        } else {

            (section.blocks || []).forEach(blockText => {

                const paragraph =
                    document.createElement("p");

                paragraph.textContent =
                    blockText;

                card.appendChild(paragraph);

            });


            if (section.omittedCount > 0) {

                const moreNote =
                    document.createElement("p");

                moreNote.className =
                    "more-note";

                moreNote.textContent =
                    `+${section.omittedCount} more statement${section.omittedCount === 1 ? "" : "s"} on this page (lower confidence)`;

                card.appendChild(moreNote);
            }
        }


        container.appendChild(card);

    });
}


// ==================================================
// RENDER WARNINGS — AI-GENERATED
// ==================================================

function renderWarningsFromAi(warnings) {

    const warningList =
        document.querySelector("#warning-list");


    warningList.innerHTML = "";


    if (
        !warnings ||
        warnings.length === 0
    ) {

        const li =
            document.createElement("li");

        li.textContent =
            "No specific policy conditions were detected.";

        warningList.appendChild(li);

        return;
    }


    const MAX_WARNINGS = 8;


    warnings.slice(0, MAX_WARNINGS).forEach(text => {

        const li =
            document.createElement("li");

        li.textContent =
            text;

        warningList.appendChild(li);
    });


    if (warnings.length > MAX_WARNINGS) {

        const li =
            document.createElement("li");

        li.style.fontStyle = "italic";
        li.style.color = "#9ca3af";

        li.textContent =
            `+${warnings.length - MAX_WARNINGS} more condition${warnings.length - MAX_WARNINGS === 1 ? "" : "s"} — see the category cards above.`;

        warningList.appendChild(li);
    }
}


// ==================================================
// RENDER WARNINGS — LOCAL KEYWORD FALLBACK
// ==================================================

function renderWarnings(policySections) {

    const warningList =
        document.querySelector("#warning-list");


    warningList.innerHTML = "";


    if (
        !policySections ||
        policySections.length === 0
    ) {

        const li =
            document.createElement("li");

        li.textContent =
            "No specific policy conditions were detected.";

        warningList.appendChild(li);

        return;
    }


    const MAX_WARNINGS = 8;

    const conditionWords = [
        "only",
        "unless",
        "except",
        "must",
        "required",
        "not eligible",
        "excluded",
        "non-refundable",
        "non-returnable",
        "subject to",
        "within",
        "before",
        "after"
    ];

    const seenText = new Set();
    const warnings = [];


    policySections.forEach(section => {

        (section.blocks || []).forEach(text => {

            const lower =
                text.toLowerCase();

            const hasCondition =
                conditionWords.some(
                    word => lower.includes(word)
                );

            if (hasCondition && !seenText.has(lower)) {

                seenText.add(lower);
                warnings.push(text);
            }

        });

    });


    if (warnings.length === 0) {

        const li =
            document.createElement("li");

        li.textContent =
            "No obvious restrictions or conditions detected.";

        warningList.appendChild(li);

        return;
    }


    warnings.slice(0, MAX_WARNINGS).forEach(text => {

        const li =
            document.createElement("li");

        li.textContent =
            text;

        warningList.appendChild(li);
    });


    if (warnings.length > MAX_WARNINGS) {

        const li =
            document.createElement("li");

        li.style.fontStyle = "italic";
        li.style.color = "#9ca3af";

        li.textContent =
            `+${warnings.length - MAX_WARNINGS} more condition${warnings.length - MAX_WARNINGS === 1 ? "" : "s"} — see the category cards above.`;

        warningList.appendChild(li);
    }
}


// ==================================================
// RENDER POLICY LINKS
// ==================================================

function renderLinks(links) {

    const container =
        document.querySelector("#links-container");


    container.innerHTML = "";


    if (
        !links ||
        links.length === 0
    ) {

        const message =
            document.createElement("p");

        message.textContent =
            "No relevant policy links detected.";

        message.style.fontSize = "12px";
        message.style.color = "#6b7280";

        container.appendChild(message);

        return;
    }


    links.forEach(link => {

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "policy-link";


        const anchor =
            document.createElement("a");

        anchor.textContent =
            link.text || link.url;

        anchor.href =
            link.url;

        anchor.target =
            "_blank";

        anchor.rel =
            "noopener noreferrer";


        wrapper.appendChild(anchor);

        container.appendChild(wrapper);

    });
}


// ==================================================
// RENDER EXTRACTION STATS
// ==================================================

function renderStats(data, stats) {

    const statsContainer =
        document.querySelector("#stats");


    if (!statsContainer) {
        return;
    }


    const content =
        data.content || {};


    statsContainer.innerHTML = `
        <div>Text blocks: ${content.blocks?.length || 0}</div>
        <div>Headings: ${content.headings?.length || 0}</div>
        <div>Lists: ${content.lists?.length || 0}</div>
        <div>Tables: ${content.tables?.length || 0}</div>
        <div>Policy sections: ${data.policySections?.length || 0}</div>
        <div>Relevant links: ${data.links?.length || 0}</div>
        <div>Interactive elements: ${data.interactiveElements?.length || 0}</div>
    `;
}


// ==================================================
// RAW JSON OUTPUT
// ==================================================

function showRawOutput(data) {

    const output =
        document.querySelector("#raw-output");


    if (!output) {
        return;
    }


    try {

        output.textContent =
            JSON.stringify(
                data,
                null,
                2
            );

    } catch (error) {

        console.error(
            "[PolicyLens] Could not display raw data:",
            error
        );

        output.textContent =
            "Unable to display extraction result.";
    }
}


// ==================================================
// FORMAT CATEGORY
// ==================================================

function formatCategory(category) {

    if (!category) {
        return "Policy";
    }


    return category
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/ \w/g, char =>
            char.toUpperCase()
        );
}


// ==================================================
// BUTTON
// ==================================================

analyzeButton.addEventListener(
    "click",
    analyzePage
);


// ==================================================
// INITIALIZE
// ==================================================

loadPageInfo();


// ==================================================
// WINDOW CONTROLS & INFO TOAST (Designed by Vedant & Darsh)
// ==================================================

const dotClose = document.querySelector("#dot-close");
const dotMinimize = document.querySelector("#dot-minimize");
const dotInfo = document.querySelector("#dot-info");
const infoToast = document.querySelector("#info-toast");
const infoToastClose = document.querySelector("#info-toast-close");

if (dotClose) {
    dotClose.addEventListener("click", () => {
        window.close();
    });
}

if (dotMinimize) {
    dotMinimize.addEventListener("click", () => {
        window.close();
    });
}

if (dotInfo && infoToast) {
    dotInfo.addEventListener("click", () => {
        infoToast.classList.remove("hidden");
    });
}

if (infoToastClose && infoToast) {
    infoToastClose.addEventListener("click", () => {
        infoToast.classList.add("hidden");
    });
}S