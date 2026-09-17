import * as Y from 'yjs';
import { api } from './api';

/**
 * Transport seam.
 *
 * The CRDT layer above this is identical whichever transport wins, so the choice is
 * confined to this file. This relay polls the API instead of holding a socket: the room
 * lives in Firestore, which keeps the service scaling to zero between sessions where a
 * stateful hub would need an always-on instance. The cost is latency, not correctness —
 * Yjs updates are commutative and idempotent, so a slow or repeated delivery converges.
 *
 * ponytail: fixed two-speed cadence rather than real backpressure. Revisit if sessions
 * get big enough that a second of staleness is actually felt.
 */

const ACTIVE_MS = 1000;
const IDLE_MS = 5000;
const SNAPSHOT_AFTER = 100;

export const collabEnabled = true;

export interface Collaborator {
  clientId: number;
  uid?: string;
  name: string;
  color: string;
}

export interface CollabSession {
  doc: Y.Doc;
  /** Y.Text for one file within the project document. */
  text: (fileName: string) => Y.Text;
  /** Subscribe to the peer list; returns an unsubscribe. */
  onPeers: (cb: (peers: Collaborator[]) => void) => () => void;
  destroy: () => void;
}

// Distinct, legible on both editor themes; picked by client id so a user keeps a colour.
const CURSOR_COLORS = [
  '#7c3aed', '#0891b2', '#d97706', '#15803d', '#be123c', '#4f46e5',
];

export function cursorColor(clientId: number): string {
  return CURSOR_COLORS[Math.abs(clientId) % CURSOR_COLORS.length];
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Join the collaborative session for a project. One Y.Doc per project; each file is a
 * Y.Text inside it, so switching tabs does not tear down the session.
 *
 * `seed` is called when this client opens an empty room and must plant the current file
 * contents. Only ever one client is told to seed — the server decides that inside the
 * same transaction that claims the room, so two simultaneous joiners cannot both plant
 * the text and double it.
 */
export function joinProject(
  projectId: string,
  user: { name: string },
  seed: (doc: Y.Doc) => void,
): CollabSession {
  const doc = new Y.Doc();
  const clientId = doc.clientID;
  const presence = { name: user.name, color: cursorColor(clientId) };
  const subscribers = new Set<(peers: Collaborator[]) => void>();

  let since = 0;
  let outbound: Uint8Array[] = [];
  let applying = false;
  let stopped = false;
  let peers = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Local edits queue for the next round trip; remote ones must not echo straight back.
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (!applying && origin !== 'remote') outbound.push(update);
  };
  doc.on('update', onUpdate);

  const tick = async () => {
    if (stopped) return;
    const sending = outbound;
    outbound = [];
    try {
      const res = await api.collabSync(projectId, {
        client_id: clientId,
        since,
        update: sending.length ? toB64(Y.mergeUpdates(sending)) : null,
        presence,
      });
      since = res.now;
      applying = true;
      try {
        if (res.snapshot) Y.applyUpdate(doc, fromB64(res.snapshot), 'remote');
        for (const u of res.updates) Y.applyUpdate(doc, fromB64(u), 'remote');
      } finally {
        applying = false;
      }
      if (res.seed) seed(doc);

      // One row per person, not per document instance: clientID is regenerated on every
      // mount, so tabs and remounts of the same account would each show as a collaborator.
      const byUser = new Map<string, Collaborator>();
      for (const p of res.peers || []) {
        const key = p.uid || String(p.clientId);
        if (!byUser.has(key)) {
          byUser.set(key, {
            clientId: p.clientId,
            uid: p.uid,
            name: p.name || 'Someone',
            color: p.color || cursorColor(p.clientId),
          });
        }
      }
      const seen = [...byUser.values()];
      peers = seen.length;
      subscribers.forEach((cb) => cb(seen));

      if (res.pending > SNAPSHOT_AFTER) {
        await api.collabSnapshot(projectId, {
          snapshot: toB64(Y.encodeStateAsUpdate(doc)),
          up_to: res.now,
        });
      }
    } catch {
      // A failed round trip loses nothing: unsent updates go back on the queue and the
      // next tick retries from the same `since`.
      outbound = sending.concat(outbound);
    }
    if (!stopped) timer = setTimeout(tick, peers || outbound.length ? ACTIVE_MS : IDLE_MS);
  };
  tick();

  return {
    doc,
    text: (fileName: string) => doc.getText(`file:${fileName}`),
    onPeers: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    destroy: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      doc.off('update', onUpdate);
      subscribers.clear();
      // Best-effort: keepalive lets this outlive the unload. If it never lands, presence
      // still expires on its own — the leave only makes that immediate.
      api.collabSync(projectId, {
        client_id: clientId, since, update: null, presence, leave: true,
      }).catch(() => {});
      doc.destroy();
    },
  };
}
