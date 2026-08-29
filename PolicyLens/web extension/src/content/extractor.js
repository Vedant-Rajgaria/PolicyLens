function extractPageData() {

    const data = {
        url: window.location.href,
        title: document.title,
        headings: [],
        text: document.body.innerText,
        links: []
    };

    // Extract headings
    const headingElements = document.querySelectorAll("h1, h2, h3");

    headingElements.forEach((heading) => {
        data.headings.push(heading.innerText.trim());
    });


    // Extract links
    const linkElements = document.querySelectorAll("a");

    linkElements.forEach((link) => {

        const text = link.innerText.trim();
        const url = link.href;

        if (text && url) {
            data.links.push({
                text: text,
                url: url
            });
        }

    });

    return data;
}