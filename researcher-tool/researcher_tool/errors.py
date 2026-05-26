from __future__ import annotations


class ResearcherToolError(Exception):
    code = "internal_error"

    def __init__(self, message: str, *, data: dict | None = None):
        super().__init__(message)
        self.message = message
        self.data = data or {}


class ValidationError(ResearcherToolError):
    code = "invalid_params"


class NotFoundError(ResearcherToolError):
    code = "not_found"


class ConfigurationError(ResearcherToolError):
    code = "configuration_error"


class RetrievalFailure(ResearcherToolError):
    code = "retrieval_error"


class StoreError(ResearcherToolError):
    code = "store_error"

