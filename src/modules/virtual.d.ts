declare module 'virtual:paramrig-modules' {
  export const requiredModules: Record<string, import('./types').ModuleId>
  export const catalog: import('./types').ProjectMetadata[]
  export const loaders: Partial<Record<import('./types').ModuleId, () => Promise<import('./types').DomainModule>>>
}
