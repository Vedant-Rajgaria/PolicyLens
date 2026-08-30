// ============================================================
// PolicyLens Demo - Content Script
// Browser-side extraction pipeline
//
// Flow:
//
// extractor.js
//      ↓
// cleaner.js
//      ↓
// detector.js
//      ↓
// structured result → sent to backend (backendClient.js)
//
// Extracted/processed data is handed off to the backend instead of being
// printed to the console. Backend connectivity isn't configured yet — see
// backendClient.js — so the send is fire-and-forget and never blocks the
// popup UI, which still renders from the local result either way.
// ============================================================


console.log(
    "[PolicyLens Demo] index.js loaded!"
);


// ============================================================
// MAIN POLICYLENS OBJECT
// ============================================================

const PolicyLens = (() => {


    // --------------------------------------------------------
    // Run complete extraction pipeline
    // --------------------------------------------------------

    function runExtraction() {

        console.log(
            "[PolicyLens Demo] Starting extraction..."
        );


        // STEP 1
        // Extract raw information from live DOM

        const raw =
            PolicyLensExtractor.extractPage();


        console.log(
            "[PolicyLens Demo] Raw extraction complete."
        );


        // STEP 2
        // Clean and normalize

        const cleaned =
            PolicyLensCleaner.clean(raw);


        console.log(
            "[PolicyLens Demo] Cleaning complete."
        );


        // STEP 3
        // Detect policy information

        const detected =
            PolicyLensDetector.detect(cleaned);


        console.log(
            "[PolicyLens Demo] Policy detection complete."
        );


        return detected;
    }


    // --------------------------------------------------------
    // Extraction statistics
    // --------------------------------------------------------

    function getExtractionStats(result) {

        if (!result) {

            return {

                textBlocks: 0,
                headings: 0,
                lists: 0,
                tables: 0,
                policySections: 0,
                links: 0,
                interactiveElements: 0

            };
        }


        return {

            textBlocks:
                result.content?.blocks?.length || 0,

            headings:
                result.content?.headings?.length || 0,

            lists:
                result.content?.lists?.length || 0,

            tables:
                result.content?.tables?.length || 0,

            policySections:
                result.policySections?.length || 0,

            links:
                result.links?.length || 0,

            interactiveElements:
                result.interactiveElements?.length || 0

        };
    }


    // --------------------------------------------------------
    // Analyze page
    // --------------------------------------------------------

    function analyzePage() {

        try {

            console.log(
                "[PolicyLens Demo] Analyzing page..."
            );


            const result =
                runExtraction();


            const stats =
                getExtractionStats(result);


            console.log(
                "[PolicyLens Demo] Extraction completed."
            );


            const payload = {

                success: true,

                data: result,

                stats: stats

            };


            // Send the extracted + processed data to the backend instead
            // of printing it. Fire-and-forget: the popup still renders
            // from `payload` locally and doesn't wait on the network
            // call, since backend connectivity isn't set up yet.
            PolicyLensBackend.sendAnalysis(payload).then(sendResult => {

                if (!sendResult.sent) {

                    console.log(
                        "[PolicyLens Demo] Backend not reachable yet — analysis kept local only."
                    );
                }
            });


            return payload;

        } catch (error) {

            console.error(
                "[PolicyLens Demo] Extraction failed:",
                error
            );


            return {

                success: false,

                error:
                    error?.message ||
                    String(error)

            };
        }
    }


    // --------------------------------------------------------
    // Public API
    // --------------------------------------------------------

    return {

        runExtraction,

        analyzePage,

        getExtractionStats

    };

})();


// ============================================================
// EXPOSE TO CONTENT-SCRIPT WINDOW
// ============================================================

window.PolicyLens = PolicyLens;


console.log(
    "[PolicyLens Demo] PolicyLens object:",
    typeof window.PolicyLens
);


// ============================================================
// CHROME MESSAGE LISTENER
// ============================================================
//
// popup.js sends:
//
// {
//     action: "analyzePage"
// }
//
// This listener:
//
// 1. Receives the request
// 2. Runs extractor
// 3. Runs cleaner
// 4. Runs detector
// 5. Sends the structured result to the backend (backendClient.js)
// 6. Sends the structured result back to the popup for display
// ============================================================

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {


        console.log(
            "[PolicyLens Demo] Message received:",
            message
        );


        // ----------------------------------------------------
        // Only respond to analyzePage
        // ----------------------------------------------------

        if (
            !message ||
            message.action !== "analyzePage"
        ) {

            return;
        }


        // ----------------------------------------------------
        // Run extraction
        // ----------------------------------------------------

        try {

            console.log(
                "[PolicyLens Demo] Running extraction..."
            );


            const result =
                PolicyLens.analyzePage();


            console.log(
                "[PolicyLens Demo] Sending result to popup."
            );


            sendResponse(result);

        } catch (error) {

            console.error(
                "[PolicyLens Demo] Message processing error:",
                error
            );


            sendResponse({

                success: false,

                error:
                    error?.message ||
                    String(error)

            });

        }


        return true;

    }
);