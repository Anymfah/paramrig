/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

declare module '*.svg?raw' {
  const content: string
  export default content
}

/** File System Access API entry points, absent from the DOM lib. */
type FilePickerAcceptType = { description?: string; accept: Record<string, string[]> }
type SaveFilePickerOptions = { suggestedName?: string; types?: FilePickerAcceptType[]; id?: string; excludeAcceptAllOption?: boolean }
type OpenFilePickerOptions = { types?: FilePickerAcceptType[]; id?: string; multiple?: boolean; excludeAcceptAllOption?: boolean }

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
}

interface FileSystemFileHandle {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
}
