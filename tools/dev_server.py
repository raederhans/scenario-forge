import http.server
import os
import socketserver
import webbrowser
import sys

# Define the range of ports to try
PORT_START = 8000
PORT_END = 8010
BIND_ADDRESS = "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Optional: Silence default logging to keep console clean, or keep it.
        pass


def resolve_open_path():
    cli_path = sys.argv[1].strip() if len(sys.argv) > 1 and sys.argv[1] else ""
    env_path = os.environ.get("MAPCREATOR_OPEN_PATH", "").strip()
    raw_path = cli_path or env_path or "/"
    if not raw_path.startswith("/"):
        raw_path = f"/{raw_path}"
    return raw_path


def start_server(open_path="/"):
    for port in range(PORT_START, PORT_END + 1):
        try:
            # Attempt to create the server
            # allow_reuse_address=False on Windows helps avoid some zombie socket issues,
            # but binding to a new port is the safest bet.
            httpd = socketserver.TCPServer((BIND_ADDRESS, port), Handler)

            base_url = f"http://{BIND_ADDRESS}:{port}"
            open_url = f"{base_url}{open_path}"
            print(f"[INFO] Success! Server started at {base_url}")
            print(f"[INFO] Opening browser at {open_url}")
            print(f"[INFO] (If the browser doesn't open, please visit the URL manually)")

            # Open browser
            webbrowser.open(open_url)

            # Start serving
            httpd.serve_forever()
            return  # Exit function after server stops (though serve_forever usually blocks)

        except OSError as e:
            # WinError 10048 is "Address already in use"
            if e.errno == 10048 or "Address already in use" in str(e) or "通常每个套接字地址" in str(e):
                print(f"[WARN] Port {port} is busy. Trying {port + 1}...")
                continue
            else:
                # Some other error occurred
                print(f"[ERROR] Unexpected error on port {port}: {e}")
                raise e

    print(f"[FATAL] Could not find any open port between {PORT_START} and {PORT_END}.")
    sys.exit(1)


if __name__ == "__main__":
    start_server(resolve_open_path())
