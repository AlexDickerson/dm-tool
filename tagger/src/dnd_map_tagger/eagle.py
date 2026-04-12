"""Thin client for Eagle's local HTTP API.

Eagle listens on http://localhost:41595 by default, with no authentication
(trust model: whatever can reach localhost). See:
  https://api.eagle.cool/item/add-from-path
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import requests


class EagleClient:
    def __init__(self, base_url: str = "http://localhost:41595", timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ---- Health ------------------------------------------------------------

    def is_running(self) -> bool:
        try:
            r = requests.get(f"{self.base_url}/api/application/info", timeout=self.timeout)
            return r.status_code == 200 and r.json().get("status") == "success"
        except requests.RequestException:
            return False

    # ---- Items -------------------------------------------------------------

    def add_from_path(
        self,
        *,
        path: Path,
        name: str,
        tags: list[str],
        annotation: str,
        folder_id: Optional[str] = None,
        website: Optional[str] = None,
    ) -> dict:
        body: dict = {
            "path": str(path),
            "name": name,
            "tags": tags,
            "annotation": annotation,
        }
        if folder_id:
            body["folderId"] = folder_id
        if website:
            body["website"] = website
        r = requests.post(
            f"{self.base_url}/api/item/addFromPath",
            json=body,
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()
