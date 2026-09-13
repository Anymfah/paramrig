import { createContext, useContext } from 'react'
import type { DomainModule } from './types'
export const DomainContext = createContext<DomainModule | null>(null)
export const useDomain = () => useContext(DomainContext)
