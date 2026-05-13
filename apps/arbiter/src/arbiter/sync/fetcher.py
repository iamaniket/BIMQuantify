"""Fetch article text from wetten.overheid.nl."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_TIMEOUT = 30.0


@dataclass(frozen=True)
class ArticleContent:
    url: str
    text: str
    text_hash: str


async def fetch_article(source_url: str) -> ArticleContent | None:
    """Fetch and extract article text from a wetten.overheid.nl URL.

    Returns None if the page cannot be fetched or parsed.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(source_url, headers={"Accept": "text/html"})
            resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Failed to fetch %s", source_url)
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    article_el = (
        soup.select_one(".artikel")
        or soup.select_one(".wet-artikel")
        or soup.select_one("#content .lid")
        or soup.select_one("#inhoud")
    )
    if article_el is None:
        logger.warning("Could not locate article content in %s", source_url)
        return None

    text = article_el.get_text(separator="\n", strip=True)
    text_hash = hashlib.sha256(text.encode()).hexdigest()
    return ArticleContent(url=source_url, text=text, text_hash=text_hash)
