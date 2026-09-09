#!/usr/bin/env node
/**
 * Yjs collaboration hub.
 *
 * Deliberately a separate service from the API: it is stateful and long-lived, which is
 * the opposite of what the Cloud Run config for the API assumes (min-instances=0, no
 * session affinity, request timeouts). Deploy this with min-instances=1 and session
 * affinity on, or the sockets drop and two people land on different instances.
 *
 * Durable storage stays in Firestore via the app's normal save path — this process only
 * relays and holds the in-memory document while at least one client is connected.
 *
 * Access is decided by the API, which knows project ownership, and asserted here as a
 * JWT signed with the shared JWT_SECRET. The token names the room it admits, so a token
 * for one project cannot open another. This process needs no database connection.
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = process.env.PORT || 1234;
const ALLOWED = (process.env.COLLAB_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Refusing to start: an unauthenticated hub lets '
    + 'anyone who learns a project id read and edit that document.');
  process.exit(1);
}

/**
 * The room is the path y-websocket puts after the host, e.g. /project:abc123.
 * Returns the verified room name, or null if the request should be refused.
 */
function authorize(req) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return null;
  }
  const room = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const token = url.searchParams.get('token');
  if (!room || !token) return null;

  try {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    // A valid token for a different document must not open this one.
    return claims.room === room ? room : null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', rooms: wss.clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', setupWSConnection);

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!authorize(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, () => {
  console.log(`collab hub listening on :${PORT}`);
});
