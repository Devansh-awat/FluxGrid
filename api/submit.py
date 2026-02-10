from http.server import BaseHTTPRequestHandler
import json
import time

# Simple in-memory store for rate limiting (Note: clear on cold boot)
# Format: { "ip_address": { "count": int, "reset_time": float } }
rate_limit_store = {}

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # 1. Get IP address
            ip = self.headers.get('x-forwarded-for', self.client_address[0])
            
            # 2. Rate Limiting Logic (3 submissions per IP)
            if ip in rate_limit_store:
                entry = rate_limit_store[ip]
                if entry['count'] >= 3:
                     self._send_response(429, {"error": "Rate limit exceeded. Max 3 submissions per IP."})
                     return
                entry['count'] += 1
            else:
                rate_limit_store[ip] = {"count": 1}

            # 3. Parse Request Body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            # 4. Basic Validation (Relaxed for survey)
            # Just ensure we received *something*
            if not data:
                self._send_response(400, {"error": "Empty submission."})
                return

            # 5. Log Data (Simulating DB insert)
            print(f"SURVEY SUBMISSION from {ip}:")
            print(json.dumps(data, indent=2))

            # 6. Success Response
            self._send_response(200, {
                "message": "Survey recorded successfully!",
                "data": data
            })

        except Exception as e:
            self._send_response(500, {"error": str(e)})

    def do_GET(self):
        try:
            # 1. Get IP address
            ip = self.headers.get('x-forwarded-for', self.client_address[0])
            
            # 2. Check Rate Limit
            if ip in rate_limit_store:
                entry = rate_limit_store[ip]
                if entry['count'] >= 3:
                     self._send_response(429, {"error": "Rate limit exceeded."})
                     return
            
            # 3. OK
            self._send_response(200, {"message": "OK", "count": rate_limit_store.get(ip, {}).get('count', 0)})
        except Exception as e:
            self._send_response(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _send_response(self, status, data):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
