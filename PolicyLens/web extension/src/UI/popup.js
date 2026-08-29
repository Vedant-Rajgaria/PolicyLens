const analyzeButton = document.querySelector("#analyze-btn");
const results = document.querySelector("#results");
const pageNameEl = document.querySelector("#page-name");
const cardsContainer = document.querySelector("#cards-container");
const warningList = document.querySelector("#warning-list");

// Show current page title as soon as popup opens
async function showPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageNameEl.textContent = tab.title;
  return tab;
}

function renderCard({ label, badgeText, badgeType, detail }) {
  const card = document.createElement("div");
  card.className = "policy-card";
  card.innerHTML = `
    <div class="card-top">
      <strong>${label}</strong>
      <span class="badge ${badgeType}">${badgeText}</span>
    </div>
    <p>${detail}</p>
  `;
  cardsContainer.appendChild(card);
}

function renderResults(data) {
  cardsContainer.innerHTML = "";
  warningList.innerHTML = "";

  data.cards.forEach(renderCard);

  data.warnings.forEach((warning) => {
    const li = document.createElement("li");
    li.textContent = warning;
    warningList.appendChild(li);
  });

  results.classList.remove("hidden");
}

analyzeButton.addEventListener("click", async () => {
  analyzeButton.disabled = true;
  analyzeButton.innerText = "Analyzing...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Grab visible page text to send for analysis
    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 5000),
    });

    const res = await fetch("http://localhost:8000/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title, text: pageText }),
    });

    if (!res.ok) throw new Error(`Backend returned ${res.status}`);

    const data = await res.json();
    renderResults(data);
    analyzeButton.innerText = "Analysis Complete";
  } catch (err) {
    analyzeButton.innerText = "Error — try again";
    console.error(err);
  } finally {
    analyzeButton.disabled = false;
  }
});

showPageInfo();