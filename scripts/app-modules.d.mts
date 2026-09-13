import type { Plugin } from 'vite'
export const allModules: string[]
export function selectModules(value?: string): string[]
export function appModulesPlugin(): Plugin
