import { useEffect,useId,useState } from 'react'
import { FieldReset } from './FieldReset'

export function TextController({label,value,onChange,multiline=false,maxLength=10000,validate,defaultValue}:{label:string;value:string;onChange:(v:string)=>void;multiline?:boolean;maxLength?:number;validate?:(v:string)=>string|null;defaultValue?:string}) {
  const [draft,setDraft]=useState(value),[error,setError]=useState('')
  const id=useId()
  useEffect(()=>{setDraft(value);setError('')},[value])
  const commit=(next:string)=>{const issue=validate?.(next);if(issue){setError(issue);return}setError('');if(next!==value)onChange(next)}
  const props={id,value:draft,maxLength,'aria-invalid':Boolean(error),'aria-describedby':error?`${id}-error`:undefined,className:'text-field__input',spellCheck:false,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{setDraft(e.target.value);setError('')},onBlur:()=>commit(draft),onKeyDown:(e:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();e.currentTarget.value=value;setDraft(value);setError('')}if(e.key==='Enter'&&!e.nativeEvent.isComposing&&(!multiline||e.metaKey||e.ctrlKey)){e.preventDefault();commit(draft)}}}
  return <div className="control control--field">
    <label htmlFor={id} className="text-field" data-multiline={multiline||undefined} data-invalid={error?'':undefined}>
      <span id={`${id}-label`} className="text-field__label">{label}</span>
      {defaultValue!==undefined&&value!==defaultValue?<FieldReset label={label} defaultLabel={defaultValue?`“${defaultValue.length>24?defaultValue.slice(0,24)+'…':defaultValue}”`:'empty'} onReset={()=>onChange(defaultValue)}/>:null}
      {multiline?<textarea {...props} aria-labelledby={`${id}-label`} rows={3}/>:<input {...props} aria-labelledby={`${id}-label`} type="text"/>}
    </label>
    {error?<p id={`${id}-error`} className="field__error" role="alert">{error}</p>:null}
  </div>
}
