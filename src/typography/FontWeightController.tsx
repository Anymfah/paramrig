import type { NumberControllerProps } from '@/ui/NumberController'
import { NumberController } from '@/ui/NumberController'
import { SelectField } from '@/ui/SelectField'
import { fontCapabilities, supportedWeight } from '@/typography/capabilities'

export function FontWeightController({ font, ...props }: NumberControllerProps & { font: unknown }) {
  const capabilities = fontCapabilities(font)
  const axis = capabilities.axes.find(axis => axis.tag === 'wght')
  const value = supportedWeight(font, props.value)
  if (axis) return <NumberController {...props} value={value} param={{ ...props.param, view: 'bar', min: axis.min, max: axis.max, step: 1, defaultValue: supportedWeight(font, props.param.defaultValue) }} />
  return <>
    <SelectField label={props.param.label} value={String(value)} disabled={!!props.driven || capabilities.weights.length < 2}
      options={capabilities.weights.map(weight => ({ value: String(weight), label: String(weight) }))}
      onChange={next => props.onChange(Number(next))} presentation="menu" />
    {!capabilities.verified ? <p className="field__hint">System font weights cannot be verified. Import the font file to expose its weights and axes.</p> : null}
  </>
}
