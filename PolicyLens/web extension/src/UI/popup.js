const analyzeButton = document.querySelector("#analyze-btn");
const results = document.querySelector("#results");

analyzeButton.addEventListener("click", () => {
    results.classList.remove("hidden");

    analyzeButton.innerText = "Analysis Complete";

});