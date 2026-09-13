import { useEffect, useRef, useState } from 'react'
import type { ParamValue } from '@/rigs/types'
import { VectorFontPicker } from '@/vector/VectorFontPicker'
import { fontValueFamily, fontValueFont } from '@/vector/fontValue'
import { ensureFont } from '@/vector/fontLoader'
import type { VectorFont } from '@/vector/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { enrichFont } from '@/vector/fontMetadata'
import { NumberController } from '@/ui/NumberController'
import type { GestureProps } from '@/ui/controller-gesture'
import { IconChevron } from '@/ui/icons'

export function FontLibraryController({ label, value, onChange, fonts = [], ...gesture }: GestureProps & {
  label: string; value: ParamValue; onChange: (value: ParamValue) => void; fonts?: VectorFont[]
}) {
  const font = fontValueFont(value)
  const axes = font?.axes?.filter(axis => axis.tag !== 'wght') ?? []
  const library = font ? [...fonts.filter(item => item.family !== font.family), font] : fonts
  const [message, setMessage] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const select = async (next: VectorFont) => {
    const ticket = ++request.current
    setMessage(`Loading ${next.family}…`)
    try { next = await enrichFont(next) }
    catch {
      if (ticket === request.current) setMessage(`${next.family} could not be read. Import a valid font file.`)
      return
    }
    if (ticket !== request.current) return
    const loaded = await ensureFont(next)
    if (ticket !== request.current) return
    if (!loaded) { setMessage(`${next.family} could not be loaded. Check your connection or import the font file.`); return }
    onChange({ ...next })
    setMessage('')
  }
  return <>
    <VectorFontPicker label={label} value={fontValueFamily(value) ?? 'Public Sans'} fonts={library}
      onPick={(family, source) => {
        if (source === 'app' || source === 'system') { request.current++; setMessage(''); onChange(family) }
        else void select(library.find(item => item.family === family) ?? { family, source: 'google', weights: [400] })
      }} onImport={next => void select(next)} />
    {message ? <StatusMessage>{message}</StatusMessage> : null}
    {font && axes.length ? <details key={font.family} className="font-axes" aria-label={`${label} variable axes`}><summary>Variable axes <IconChevron /></summary><div className="font-axes__controls">{axes.map(axis => <NumberController key={axis.tag}
      param={{ kind: 'number', id: `${label}-${axis.tag}`, group: 'typography', label: `${axis.name} (${axis.tag})`, min: axis.min, max: axis.max, step: (axis.max - axis.min) < 10 ? 0.01 : 0.1, defaultValue: axis.default }}
      value={font.variations?.[axis.tag] ?? axis.default}
      onChange={next => onChange({ ...font, variations: { ...font.variations, [axis.tag]: next } })} {...gesture} />)}</div></details> : null}
  </>
}
