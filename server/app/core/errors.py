class DomainError(Exception):
    """Business error with a stable machine-readable code (mapped to HTTP by the API layer)."""

    status_code = 400

    def __init__(self, code: str, message: str | None = None, status_code: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code
        if status_code is not None:
            self.status_code = status_code


class NotFound(DomainError):
    status_code = 404


class Forbidden(DomainError):
    status_code = 403


class Conflict(DomainError):
    status_code = 409


class Unauthorized(DomainError):
    status_code = 401
