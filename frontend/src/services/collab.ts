import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * Transport seam.
 *
 * The CRDT layer above this is identical whichever transport wins, so the choice is
 * confined to this file. y-websocket is the default because it is the only option that
 * can be stood up without a third-party account; a managed provider (Liveblocks,
 * PartyKit) swaps the constructor here and nothing else.
 *
 * ponytail: no reconnect/backoff tuning beyond y-websocket's own — revisit if sessions
 * prove flaky in practice rather than in theory.
 */
const COLLAB_URL = import.meta.env.VITE_COLLAB_URL || '';

export const collabEnabled = Boolean(COLLAB_URL);

export interface CollabSession {
  doc: Y.Doc;
  provider: WebsocketProvider;
  /** Y.Text for one file within the project document. */
  text: (fileName: string) => Y.Text;
  destroy: () => void;
}

export interface Collaborator {
  clientId: number;
  name: string;
  color: string;
}

// Distinct, legible on both editor themes; picked by client id so a user keeps a colour.
const CURSOR_COLORS = [
  '#7c3aed', '#0891b2', '#d97706', '#15803d', '#be123c', '#4f46e5',
];

export function cursorColor(clientId: number): string {
  return CURSOR_COLORS[Math.abs(clientId) % CURSOR_COLORS.length];
}

/**
 * Join the collaborative session for a project. One Y.Doc per project; each file is a
 * Y.Text inside it, so switching tabs does not tear down the connection.
 */
export function joinProject(projectId: string, user: { name: string }): CollabSession | null {
  if (!collabEnabled) return null;

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(COLLAB_URL, `project:${projectId}`, doc);

  provider.awareness.setLocalStateField('user', {
    name: user.name,
    color: cursorColor(doc.clientID),
  });

  return {
    doc,
    provider,
    text: (fileName: string) => doc.getText(`file:${fileName}`),
    destroy: () => {
      provider.awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
    },
  };
}

/** Everyone currently in the document, excluding this client. */
export function peers(provider: WebsocketProvider): Collaborator[] {
  const out: Collaborator[] = [];
  provider.awareness.getStates().forEach((state: any, clientId: number) => {
    if (clientId === provider.awareness.clientID) return;
    out.push({
      clientId,
      name: state?.user?.name || 'Someone',
      color: state?.user?.color || cursorColor(clientId),
    });
  });
  return out;
}
