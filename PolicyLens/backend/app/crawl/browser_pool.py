"""
Owns a single shared headless Chromium instance for the lifetime of the
backend process. Individual crawls get their own isolated BrowserContext
(cheap, ~milliseconds) rather than a new Browser process (expensive,
~seconds and real memory) — this is what makes concurrent crawling
scalable instead of spawning a browser per page.

Started/stopped via FastAPI's lifespan hook in main.py so it's created
once at startup and cleanly torn down at shutdown, not per-request.
"""

import asyncio
import logging
from typing import Optional

from playwright.async_api import Browser, Playwright, async_playwright

logger = logging.getLogger(__name__)

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 PolicyLensDiscoveryBot/1.0"
)


class BrowserPool:
    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        async with self._lock:
            if self._browser is not None:
                return
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            logger.info("PolicyLens discovery: headless browser started.")

    async def stop(self) -> None:
        async with self._lock:
            if self._browser is not None:
                await self._browser.close()
                self._browser = None
            if self._playwright is not None:
                await self._playwright.stop()
                self._playwright = None
            logger.info("PolicyLens discovery: headless browser stopped.")

    async def new_context(self):
        if self._browser is None:
            await self.start()
        assert self._browser is not None
        return await self._browser.new_context(
            java_script_enabled=True,
            ignore_https_errors=False,
            user_agent=_USER_AGENT,
        )


browser_pool = BrowserPool()