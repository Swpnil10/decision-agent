import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os
import ssl

PORT = 8090
ssl_context = ssl._create_unverified_context()

class DecisionAgentHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version')
        self.end_headers()

    def do_POST(self):
        try:
            clean_path = self.path.split('?')[0].rstrip('/')
            if clean_path in ['/api/chat', 'api/chat']:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                
                payload = json.loads(post_data.decode('utf-8'))
                provider = payload.get('provider', 'nvidia')
                api_key = payload.get('apiKey', '')
                model = payload.get('model', '')
                system_prompt = payload.get('system', '')
                user_msg = payload.get('userMsg', '')

                if provider == 'nvidia':
                    target_url = "https://integrate.api.nvidia.com/v1/chat/completions"
                    req_headers = {
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                        "User-Agent": "Mozilla/5.0"
                    }
                    body_data = {
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_msg}
                        ],
                        "temperature": 0.2,
                        "max_tokens": 1500
                    }
                else: # anthropic
                    target_url = "https://api.anthropic.com/v1/messages"
                    req_headers = {
                        "Content-Type": "application/json",
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "User-Agent": "Mozilla/5.0"
                    }
                    body_data = {
                        "model": model,
                        "max_tokens": 1500,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": user_msg}]
                    }

                req = urllib.request.Request(
                    target_url,
                    data=json.dumps(body_data).encode('utf-8'),
                    headers=req_headers,
                    method='POST'
                )

                try:
                    with urllib.request.urlopen(req, context=ssl_context) as resp:
                        resp_data = resp.read()
                        res_json = json.loads(resp_data.decode('utf-8'))
                        self._send_json({"success": True, "data": res_json})
                except urllib.error.HTTPError as e:
                    err_body = e.read().decode('utf-8')
                    err_msg = err_body
                    try:
                        parsed_err = json.loads(err_body)
                        err_msg = parsed_err.get('message') or parsed_err.get('error', {}).get('message') or err_body
                    except Exception:
                        pass
                    self._send_json({"success": False, "error": f"{provider.upper()} API Error ({e.code}): {err_msg}"})
                except Exception as e:
                    self._send_json({"success": False, "error": f"Connection error to {provider}: {str(e)}"})
            else:
                self._send_json({"success": False, "error": "Not Found"})
        except Exception as ex:
            self._send_json({"success": False, "error": f"Server processing error: {str(ex)}"})

    def _send_json(self, data_dict):
        body = json.dumps(data_dict).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version')
        self.end_headers()
        self.wfile.write(body)
        try:
            self.wfile.flush()
        except Exception:
            pass

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DecisionAgentHandler) as httpd:
        httpd.serve_forever()
