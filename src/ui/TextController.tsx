import { useEffect,useId,useState } from 'react'

export function TextController({label,value,onChange,multiline=false,maxLength=10000,validate}:{label:string;value:string;onChange:(v:string)=>void;multiline?:boolean;maxLength?:number;validate?:(v:string)=>string|null}) {
  const [draft,setDraft]=useState(value),[error,setError]=useState('')
  const id=useId()
  useEffect(()=>{setDraft(value);setError('')},[value])
  const commit=(next:string)=>{const issue=validate?.(next);if(issue){setError(issue);return}setError('');if(next!==value)onChange(next)}
  const props={id,value:draft,maxLength,'aria-invalid':Boolean(error),'aria-describedby':error?`${id}-error`:undefined,className:'text-field__input',spellCheck:false,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{setDraft(e.target.value);setError('')},onBlur:()=>commit(draft),onKeyDown:(e:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();e.currentTarget.value=value;setDraft(value);setError('')}if(e.key==='Enter'&&!e.nativeEvent.isComposing&&(!multiline||e.metaKey||e.ctrlKey)){e.preventDefault();commit(draft)}}}
  return <div className="control control--field">
    <label className="text-field" data-multiline={multiline||undefined} data-invalid={error?'':undefined}>
      <span className="text-field__label">{label}</span>
      {multiline?<textarea {...props} rows={3}/>:<input {...props} type="text"/>}
    </label>
    {error?<p id={`${id}-error`} className="field__error" role="alert">{error}</p>:null}
  </div>
}
