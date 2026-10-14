const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8090;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (req.method === 'POST' && (urlPath === '/api/chat' || urlPath === '/api/chat/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const provider = payload.provider || 'nvidia';
        const apiKey = payload.apiKey || '';
        const model = payload.model || '';
        const system = payload.system || '';
        const userMsg = payload.userMsg || '';

        console.log(`[Proxy] Provider: ${provider}, Model: ${model}`);

        let targetUrl, headers, postData;

        if (provider === 'nvidia') {
          targetUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
          headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0'
          };
          postData = JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMsg }
            ],
            temperature: 0.2,
            max_tokens: 1500
          });
        } else {
          targetUrl = 'https://api.anthropic.com/v1/messages';
          headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'User-Agent': 'Mozilla/5.0'
          };
          postData = JSON.stringify({
            model: model,
            max_tokens: 1500,
            system: system,
            messages: [{ role: 'user', content: userMsg }]
          });
        }

        const urlObj = new URL(targetUrl);
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'POST',
          timeout: 120000, // 2 minute socket timeout
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let respData = '';
          proxyRes.on('data', chunk => { respData += chunk; });
          proxyRes.on('end', () => {
            if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
              try {
                const parsed = JSON.parse(respData);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: parsed }));
              } catch (e) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to parse upstream JSON' }));
              }
            } else if (proxyRes.statusCode === 504) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: `NVIDIA NIM Server Gateway Timeout (504). The selected model (${model}) is currently busy on NVIDIA cloud. Please select 'nvidia/llama-3.1-nemotron-70b-instruct' or 'meta/llama-3.1-8b-instruct' in API Settings.`
              }));
            } else {
              let errMsg = respData;
              try {
                const parsed = JSON.parse(respData);
                errMsg = parsed.message || parsed.error?.message || respData;
              } catch (e) {}
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: `${provider.toUpperCase()} API Error (${proxyRes.statusCode}): ${errMsg}` }));
            }
          });
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: `Request timed out waiting for ${provider.toUpperCase()} API. Please try a faster model like 'nvidia/llama-3.1-nemotron-70b-instruct' or 'meta/llama-3.1-8b-instruct'.`
          }));
        });

        proxyReq.on('error', (err) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Connection error to ${provider}: ${err.message}` }));
        });

        proxyReq.write(postData);
        proxyReq.end();
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Payload error: ${err.message}` }));
      }
    });
    return;
  }

  // Serve static files
  let filename = urlPath === '/' ? 'decision-agent.html' : urlPath.substring(1);
  const filePath = path.join(__dirname, filename);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      const ext = path.extname(filePath);
      let contentType = 'text/html';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.js') contentType = 'text/javascript';
      if (ext === '.json') contentType = 'application/json';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Decision Agent Server running at http://127.0.0.1:${PORT}/decision-agent.html`);
});
