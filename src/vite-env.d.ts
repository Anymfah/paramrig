/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

declare module '*.svg?raw' {
  const content: string
  export default content
}
