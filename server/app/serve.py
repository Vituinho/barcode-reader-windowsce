"""Production entry point: python -m app.serve

Binds 0.0.0.0 and the PORT environment variable (set by Railway), without relying on
shell variable expansion in the start command.
"""
import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        # Behind Railway's edge proxy: take client IP/scheme from X-Forwarded-* headers.
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
