from http.server import BaseHTTPRequestHandler
import json
import os
import psycopg2

# Simple in-memory store for rate limiting (Note: clear on cold boot)
# Format: { "ip_address": { "count": int, "reset_time": float } }
rate_limit_store = {}

def get_db_connection():
    return psycopg2.connect(os.environ['POSTGRES_URL'])

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS survey_responses (
                id SERIAL PRIMARY KEY,
                ip_address TEXT,
                device_type TEXT,
                os_type TEXT,
                plugged_in_percent INT,
                run_on_battery BOOLEAN,
                download_speed INT,
                upload_speed INT,
                data_cap INT,
                proxy_consent BOOLEAN,
                resources TEXT[],
                cpu_model TEXT,
                cpu_cores INT,
                cpu_allocated INT,
                gpu_model TEXT,
                gpu_percent INT,
                storage_total INT,
                storage_allocated INT,
                email TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Add cpu_model column if table already exists without it
        cur.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'survey_responses' AND column_name = 'cpu_model'
                ) THEN
                    ALTER TABLE survey_responses ADD COLUMN cpu_model TEXT;
                END IF;
            END $$;
        ''')
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"DB Init Error: {e}")

# Try to init table on cold boot
# Note: In serverless, this might run on every cold start, which is fine for "IF NOT EXISTS"
init_db()

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

            # 5. Log Data (Insert into DB)
            print(f"SURVEY SUBMISSION from {ip}:")
            print(json.dumps(data, indent=2))

            try:
                conn = get_db_connection()
                cur = conn.cursor()
                cur.execute('''
                    INSERT INTO survey_responses (
                        ip_address, device_type, os_type, plugged_in_percent, run_on_battery,
                        download_speed, upload_speed, data_cap, proxy_consent,
                        resources, cpu_model, cpu_cores, cpu_allocated, gpu_model, gpu_percent,
                        storage_total, storage_allocated, email
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                ''', (
                    ip,
                    data.get('deviceType'),
                    data.get('osType'),
                    int(data.get('pluggedInPercent', 100)),
                    data.get('runOnBattery', False),
                    int(data.get('networkSpeedDown') or 0),
                    int(data.get('networkSpeedUp') or 0),
                    int(data.get('dataCap', 0)),
                    data.get('proxyConsent', 'off') == 'on',
                    data.get('resources', []),
                    data.get('cpuModel', ''),
                    int(data.get('cpuCores') or 0),
                    int(data.get('cpuAllocated') or 0),
                    data.get('gpuModel', ''),
                    int(data.get('gpuPercent', 50)),
                    int(data.get('storageTotal') or 0),
                    int(data.get('storageAllocated') or 0),
                    data.get('email', '')
                ))
                conn.commit()
                cur.close()
                conn.close()
            except Exception as e:
                print(f"DB Insert Error: {e}")
                # We typically don't fail the user request if logging fails, but for this survey, maybe we should?
                # For now, let's log and proceed, but maybe signal error if critical.
                # Actually, if DB fails, we probably shouldn't say "Success".
                # Let's re-raise to hit the 500 handler.
                raise e

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
