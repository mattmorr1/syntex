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
 * ponytail: no auth on the socket yet. Room names are project ids, so anyone who learns
 * one can join. Gate it with a signed token before this is exposed to real users.
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = process.env.PORT || 1234;
const ALLOWED = (process.env.COLLAB_ALLOWED_ORIGINS || '').split(',').filter(Boolean);

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
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, () => {
  console.log(`collab hub listening on :${PORT}`);
});
