/**
 * The library's "Recent" list is one list for every editor; the store itself lives in
 * `src/editor/fileHandles.ts`. This module keeps the names the vector editor already uses.
 */
export {
  forgetProject,
  getProjectHandle,
  listRecentProjects,
  rememberProject,
  supportsFileSystemAccess,
  type RecentProject,
} from '@/editor/fileHandles'
