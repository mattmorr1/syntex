import { create } from 'zustand';

export interface ProjectFile {
  name: string;
  content: string;
  type: 'tex' | 'bib' | 'cls' | 'sty' | 'png' | 'jpg' | 'pdf';
}

export interface Project {
  id: string;
  name: string;
  files: ProjectFile[];
  mainFile: string;
  theme: string;
  customTheme?: string;
  createdAt: string;
  updatedAt: string;
}

interface EditorState {
  currentProject: Project | null;
  activeFile: string | null;
  pdfUrl: string | null;
  isCompiling: boolean;
  compileError: string | null;
  unsavedChanges: boolean;
  
  setProject: (project: Project | null) => void;
  setActiveFile: (fileName: string | null) => void;
  updateFileContent: (fileName: string, content: string) => void;
  setProjectName: (name: string) => void;
  setPdfUrl: (url: string | null) => void;
  setCompiling: (isCompiling: boolean) => void;
  setCompileError: (error: string | null) => void;
  setUnsavedChanges: (unsaved: boolean) => void;
  addFile: (file: ProjectFile) => void;
  removeFile: (fileName: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentProject: null,
  activeFile: null,
  pdfUrl: null,
  isCompiling: false,
  compileError: null,
  unsavedChanges: false,

  setProject: (project) => set({ 
    currentProject: project, 
    activeFile: project?.mainFile || null,
    unsavedChanges: false 
  }),
  
  setActiveFile: (fileName) => set({ activeFile: fileName }),
  
  updateFileContent: (fileName, content) => set((state) => {
    if (!state.currentProject) return state;
    const files = state.currentProject.files.map((f) =>
      f.name === fileName ? { ...f, content } : f
    );
    return {
      currentProject: { ...state.currentProject, files },
      unsavedChanges: true,
    };
  }),
  
  setProjectName: (name) => set((state) => {
    if (!state.currentProject) return state;
    return {
      currentProject: { ...state.currentProject, name },
    };
  }),
  
  setPdfUrl: (url) => set({ pdfUrl: url }),
  setCompiling: (isCompiling) => set({ isCompiling }),
  setCompileError: (error) => set({ compileError: error }),
  setUnsavedChanges: (unsaved) => set({ unsavedChanges: unsaved }),
  
  addFile: (file) => set((state) => {
    if (!state.currentProject) return state;
    return {
      currentProject: {
        ...state.currentProject,
        files: [...state.currentProject.files, file],
      },
      unsavedChanges: true,
    };
  }),
  
  removeFile: (fileName) => set((state) => {
    if (!state.currentProject) return state;
    return {
      currentProject: {
        ...state.currentProject,
        files: state.currentProject.files.filter((f) => f.name !== fileName),
      },
      activeFile: state.activeFile === fileName ? state.currentProject.mainFile : state.activeFile,
      unsavedChanges: true,
    };
  }),
}));
