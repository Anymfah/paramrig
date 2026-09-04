import { createContext, useContext } from 'react'

/**
 * The quick favourites, reachable from any menu entry without threading a callback through each.
 *
 * Blender lets a person right-click anything in a menu and put it on the Q menu. That gesture has
 * to work on every entry of every menu, which is exactly the kind of thing a context is for: the
 * page provides one, `SceneMenu` reads it, and a menu rendered anywhere else — a test, a preview —
 * simply has no favourite gesture rather than a broken one.
 */
export type SceneFavoritesValue = {
  has: (id: string) => boolean
  toggle: (id: string) => void
}

export const SceneFavoritesContext = createContext<SceneFavoritesValue | null>(null)

export function useSceneFavorites(): SceneFavoritesValue | null {
  return useContext(SceneFavoritesContext)
}
