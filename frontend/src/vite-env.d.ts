/// <reference types="vite/client" />

// edcore.main is the editor API plus its contributions; monaco-editor ships no
// declarations for it, so monacoSetup casts it to the documented API type.
declare module 'monaco-editor/esm/vs/editor/edcore.main.js';
