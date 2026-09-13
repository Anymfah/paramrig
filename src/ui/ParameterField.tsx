import { ParameterControl, type ParameterControlProps } from '@/controls/ParameterControl'
import { useDomain } from '@/modules/context'
import { loadResource, saveResource } from '@/state/resources'
const resources = { load: loadResource, save: saveResource }
export type ParameterFieldProps = ParameterControlProps
export function ParameterField(props: ParameterFieldProps) {
  const domain = useDomain()
  return <ParameterControl registry={domain?.controls} resources={resources} {...props}/>
}
