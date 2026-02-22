from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass
class CollectorClient:
    base_url: str
    token: str | None = None
    timeout: int = 30

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if extra:
            headers.update(extra)
        return headers

    def _request(self, method: str, path: str, *, json_data: Any | None = None, headers: dict[str, str] | None = None) -> Any:
        response = requests.request(
            method,
            f"{self.base_url}{path}",
            json=json_data,
            headers=self._headers(headers),
            timeout=self.timeout,
        )
        if not response.ok:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return response.json()
        return response.content

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/v1/healthz")

    def ready(self) -> dict[str, Any]:
        return self._request("GET", "/v1/readyz")

    def create_job(self, payload: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self._request("POST", "/v1/jobs", json_data=payload, headers=headers)

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/jobs/{job_id}")

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/jobs/{job_id}/cancel")

    def list_artifacts(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/jobs/{job_id}/artifacts")

    def get_artifact(self, artifact_id: str, download_token: str | None = None) -> bytes:
        suffix = f"?downloadToken={download_token}" if download_token else ""
        result = self._request("GET", f"/v1/artifacts/{artifact_id}{suffix}")
        if isinstance(result, bytes):
            return result
        raise RuntimeError("Expected bytes response")

    def extract(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/v1/extract", json_data=payload)

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        engine: str = "duckduckgo",
        safe_search: str = "moderate",
        locale: str = "us-en",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/v1/search",
            json_data={
                "query": query,
                "limit": limit,
                "engine": engine,
                "safeSearch": safe_search,
                "locale": locale,
            },
        )

    def crawl(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/v1/crawl", json_data=payload)

    def get_crawl(self, crawl_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/crawl/{crawl_id}")

    def list_recipes(self) -> dict[str, Any]:
        return self._request("GET", "/v1/recipes")

    def validate_recipe(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/v1/recipes/validate", json_data={"recipe": recipe})

    def upload_recipe(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/v1/recipes", json_data=recipe)
