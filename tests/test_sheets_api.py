import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from sheets_api import ShopAPI, ShopAPIError


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        payload = ({"ok": True, "data": request} if request.get("secret") == "secret"
                   else {"ok": False, "error": "Unauthorised request."})
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_hold_and_claim_payloads(self):
        api = ShopAPI(self.url, "secret")
        hold = asyncio.run(api.hold_card("SAN-1", "123"))
        claim = asyncio.run(api.add_claim_item(card_id="SAN-2", telegram_user_id="123"))
        self.assertEqual(hold["action"], "hold_card")
        self.assertEqual(claim["action"], "add_claim_item")

    def test_rejects_wrong_secret(self):
        with self.assertRaisesRegex(ShopAPIError, "Unauthorised"):
            asyncio.run(ShopAPI(self.url, "wrong").list_sets())


if __name__ == "__main__":
    unittest.main()
