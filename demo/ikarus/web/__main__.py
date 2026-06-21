"""Launch the Ikarus web UI: python -m ikarus.web [--host H] [--port P]"""
import argparse
import uvicorn
from ikarus.web.server import autodetect_provider, create_app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ikarus.web")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    provider = autodetect_provider()  # use LM Studio automatically if it's running
    note = "" if provider != "mock" else "  (mock — inicia LM Studio o elige un proveedor en la UI)"
    print(f"[ikarus.web] chat/live provider: {provider}{note}")
    uvicorn.run(create_app(), host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv[1:]))
