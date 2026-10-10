"""No-install Python 3 fallback for the prebuilt Particle Bloom release."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from functools import partial
import os, sys, threading, webbrowser
from urllib.parse import unquote, urlsplit
ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.js': 'text/javascript'}
    def translate_path(self, path):
        if any(part.startswith('.') for part in unquote(urlsplit(path).path).replace('\\', '/').split('/')):
            return str(ROOT / '__forbidden__')
        candidate = Path(super().translate_path(path)).resolve()
        return str(candidate if candidate == ROOT or ROOT in candidate.parents else ROOT / '__forbidden__')
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
if __name__ == '__main__':
    try:
        port = int(os.environ.get('PORT', '4173'))
        if not 1024 <= port <= 65535: raise ValueError()
    except ValueError:
        sys.exit('PORT must be an integer from 1024 to 65535.')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(ROOT)))
    except OSError as error:
        sys.exit(f'Cannot start local server: {error}. Close another server or set PORT to another number.')
    url = f'http://127.0.0.1:{port}/'
    print(f'Particle Bloom is ready: {url}\nKeep this window open. Press Ctrl+C to stop.\nCamera frames stay in your browser.')
    if '--no-open' not in sys.argv:
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
