// edcore.main = the editor API *plus* its contributions, minus Monaco's bundled
// languages. The API alone is not enough: inline completions and the suggest widget are
// contributions, so importing editor.api leaves you able to *register* providers that
// nothing ever calls. LaTeX here is a custom Monarch grammar, so the language packs
// (html/json/typescript and their workers) stay out of the bundle.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import type * as MonacoApi from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

/**
 * Serve Monaco from our own bundle instead of the default jsdelivr CDN.
 *
 * Two reasons: the editor is the app, so a blocked or slow CDN took the whole product
 * down; and y-monaco constructs Ranges from the `monaco-editor` package, which must be
 * the *same* instance the editor was built from or collaborative edits bind to a
 * different class identity.
 */
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

// edcore.main ships no .d.ts; its runtime shape is the documented editor API.
const monacoApi = monaco as unknown as typeof MonacoApi;

loader.config({ monaco: monacoApi });

export { monacoApi as monaco };
