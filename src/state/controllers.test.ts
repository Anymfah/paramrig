import { describe, expect, it } from 'vitest'
import { controllerDefinitions, controllerExamples, controllerManifest } from '@/rigs/controller-catalog'
import { RigSession } from './session'
import { normalizeValue } from './parameter-values'
import { evaluateExpression } from './expression'
import { drivenValues, mixValues, sampleModulation } from './drivers'
import { acceptsResource } from './resources'
import type { ParameterDef } from '@/rigs/types'
import { isGradient } from './values'

const definition=(id:string)=>controllerDefinitions.find(p=>p.id===id)!
describe('controller value contracts',()=>{
  it('keeps the public catalog focused and every declaration internally coherent',()=>{
    expect(controllerExamples).toHaveLength(66)
    expect(controllerExamples.every(p=>!p.hidden)).toBe(true)
    expect(new Set(controllerDefinitions.map(p=>p.id)).size).toBe(controllerDefinitions.length)
    expect(controllerDefinitions.filter(p=>p.kind==='resource')).toHaveLength(2)
    expect(controllerExamples.filter(p=>p.kind==='points').map(p=>p.id)).toEqual(['opacityRamp','curve','path'])
    expect(controllerExamples.filter(p=>p.kind==='radial').map(p=>p.id)).toEqual(['radial'])
    const ids=new Set(controllerDefinitions.map(p=>p.id))
    const inspect=(p:ParameterDef,path=p.id):string[]=>{
      const errors:string[]=[]
      if(!p.id||!p.label||!p.group)errors.push(`${path}: missing identity`)
      if(p.kind==='number'){
        if(!(p.min<p.max)||!(p.step>0)||p.defaultValue<p.min||p.defaultValue>p.max)errors.push(`${path}: invalid numeric bounds`)
        if(p.scale==='log'&&p.min<=0)errors.push(`${path}: logarithmic minimum must be positive`)
        if(p.stops?.some((v,i,a)=>v<p.min||v>p.max||(i>0&&v<=a[i-1]!)))errors.push(`${path}: invalid stops`)
        if(p.units?.some(unit=>!unit.value||!unit.label||!(unit.factor>0)||unit.step!==undefined&&!(unit.step>0)))errors.push(`${path}: invalid display unit`)
        if(p.units&&new Set(p.units.map(unit=>unit.value)).size!==p.units.length)errors.push(`${path}: duplicate display unit`)
        if(p.defaultSource?.mode==='parameter'||p.defaultSource?.mode==='macro'||p.defaultSource?.mode==='blend')if(p.defaultSource.source&&!ids.has(p.defaultSource.source))errors.push(`${path}: unknown value source`)
      }
      if(p.kind==='vector'&&p.axes.length!==p.defaultValue.length)errors.push(`${path}: vector arity mismatch`)
      if((p.kind==='select'||p.kind==='multiselect'||p.kind==='preset')&&new Set(p.options.map(o=>o.value)).size!==p.options.length)errors.push(`${path}: duplicate option`)
      if(p.kind==='group'){
        if(new Set(p.fields.map(f=>f.id)).size!==p.fields.length)errors.push(`${path}: duplicate child`)
        p.fields.forEach(child=>errors.push(...inspect(child,`${path}.${child.id}`)))
      }
      if(p.kind==='list')errors.push(...inspect(p.item,`${path}[]`))
      if(p.kind==='resource'&&!p.accept.trim())errors.push(`${path}: missing accepted formats`)
      if(p.kind==='action'){
        for(const target of p.targets??[])if(!ids.has(target))errors.push(`${path}: unknown action target`)
        for(const target of Object.keys(p.values??{}))if(!ids.has(target))errors.push(`${path}: unknown action value`)
      }
      if(p.kind==='preset')for(const option of p.options)for(const target of Object.keys(option.values))if(!ids.has(target))errors.push(`${path}: unknown preset target`)
      return errors
    }
    expect(controllerDefinitions.flatMap(p=>inspect(p))).toEqual([])
  })
  it('validates and restores every catalog default without dropping composite data',()=>{
    for(const p of controllerDefinitions) expect(normalizeValue(p,p.defaultValue),p.id).toEqual(p.defaultValue)
    const first=new RigSession(controllerManifest)
    first.setValue('position',[0.25,-0.5])
    first.setValue('range',[80,20])
    first.setValue('title','Restored text')
    first.setValue('resource_image',{id:'local-asset',name:'photo.png',mime:'image/png',size:12})
    const restored=new RigSession(controllerManifest,first.toDraft())
    expect(restored.storedValues()).toEqual(first.storedValues())
    expect(restored.storedValue('range')).toEqual([20,80])
  })
  it('rejects malformed vectors, gradients, resources and non-finite values',()=>{
    expect(normalizeValue(definition('vector3'),[1,2])).toEqual([0,0,0])
    expect(normalizeValue(definition('range'),[Infinity,20])).toEqual([20,80])
    expect(normalizeValue(definition('resource_image'),{name:'bad'})).toBeNull()
    expect(normalizeValue(definition('gradient'),[{t:NaN,color:'red'}])).toEqual(definition('gradient').defaultValue)
    expect(normalizeValue(definition('multiple'),['surface','bogus','surface'])).toEqual(['surface'])
    expect(isGradient([0,1])).toBe(false)
    expect(isGradient(definition('gradient').defaultValue)).toBe(true)
    expect(normalizeValue(definition('radial'),[{name:'Broken'}])).toEqual(definition('radial').defaultValue)
  })
  it('records a whole composite gesture once and preserves redo after cancellation',()=>{
    const s=new RigSession(controllerManifest)
    s.beginGesture('Move position');s.setValue('position',[0.1,0.2]);s.setValue('position',[0.3,0.4]);s.endGesture()
    expect(s.history().labels).toEqual(['Session start','Move position'])
    s.undo();expect(s.storedValue('position')).toEqual([0,0])
    s.beginGesture();s.setValue('position',[1,1]);s.cancelGesture()
    expect(s.canRedo()).toBe(true);s.redo();expect(s.storedValue('position')).toEqual([0.3,0.4])
  })
  it('restores resources and lists through snapshots',()=>{
    const s=new RigSession(controllerManifest)
    s.setValue('values',[3,6,9]);const snapshot=s.captureSnapshot('Three layers')
    s.setValue('values',[]);s.restoreSnapshot(snapshot.id)
    expect(s.storedValue('values')).toEqual([3,6,9]);s.undo();expect(s.storedValue('values')).toEqual([])
  })
  it('drops obsolete values when an older snapshot is restored after catalog consolidation',()=>{
    const s=new RigSession(controllerManifest)
    const snapshot=s.captureSnapshot('Before consolidation')
    snapshot.values={...snapshot.values,obsoleteController:42}
    s.restoreSnapshot(snapshot.id)
    expect(s.storedValues()).not.toHaveProperty('obsoleteController')
  })
})
describe('drivers and actions',()=>{
  it('evaluates safe arithmetic and rejects executable syntax',()=>{
    expect(evaluateExpression('clamp(amount * 2 + sin(pi / 2), 0, 100)',id=>id==='amount'?12:0)).toBe(25)
    for(const expression of ['globalThis.alert(1)','constructor(1)','1 / 0','1; 2','[1]','sin('])expect(()=>evaluateExpression(expression,()=>0)).toThrow()
  })
  it('drives values from time without overwriting stored values or filling history',()=>{
    const s=new RigSession(controllerManifest)
    s.setPlayhead(0.5)
    expect(s.liveNumber('driven')).toBeCloseTo(40)
    expect(s.storedValue('driven')).toBe(0)
    expect(s.canUndo()).toBe(false)
    s.setValue('macro',0.8);expect(s.liveNumber('macroOutput')).toBe(80)
    s.undo();expect(s.liveNumber('macroOutput')).toBe(50)
  })
  it('reports circular links instead of hanging or generating NaN',()=>{
    const p:ParameterDef[]=[
      {kind:'number',id:'a',label:'A',group:'g',min:0,max:100,step:1,defaultValue:1},
      {kind:'number',id:'b',label:'B',group:'g',min:0,max:100,step:1,defaultValue:2},
    ]
    const result=drivenValues(p,{a:1,b:2},{a:{mode:'expression',expression:'b'},b:{mode:'expression',expression:'a'}},0)
    expect(Object.values(result.errors)).toContain('Circular parameter link')
    expect(result.values.a).toBe(1);expect(result.values.b).toBe(2)
  })
  it('resolves parameter bindings without overwriting local values',()=>{
    const p:ParameterDef[]=[
      {kind:'number',id:'source',label:'Source',group:'g',min:0,max:100,step:1,defaultValue:10},
      {kind:'number',id:'target',label:'Target',group:'g',min:0,max:100,step:1,defaultValue:20},
    ]
    expect(drivenValues(p,{source:42,target:20},{target:{mode:'parameter',source:'source'}},0).values.target).toBe(42)
    expect(drivenValues(p,{source:42,target:20},{target:{mode:'local'}},0).values.target).toBe(20)
  })
  it('reports invalid binding sources and preserves the target value',()=>{
    const p:ParameterDef[]=[
      {kind:'number',id:'target',label:'Target',group:'g',min:0,max:100,step:1,defaultValue:20},
    ]
    const result=drivenValues(p,{target:20},{target:{mode:'parameter'}},0)
    expect(result.values.target).toBe(20)
    expect(result.errors.target).toBe('Choose a numeric source parameter')
  })
  it('resolves every value source mode without stacking drivers',()=>{
    const p:ParameterDef[]=[
      {kind:'number',id:'input',label:'Input',group:'g',min:0,max:1,step:0.01,defaultValue:0.25},
      {kind:'number',id:'target',label:'Target',group:'g',min:0,max:100,step:1,defaultValue:10},
    ]
    const values={input:0.25,target:10}
    expect(drivenValues(p,values,{target:{mode:'local'}},0).values.target).toBe(10)
    expect(drivenValues(p,values,{target:{mode:'parameter',source:'input'}},0).values.target).toBe(0.25)
    expect(drivenValues(p,values,{target:{mode:'expression',expression:'input * 100'}},0).values.target).toBe(25)
    expect(drivenValues(p,values,{target:{mode:'animation'}},0).values.target).toBe(10)
    expect(drivenValues(p,values,{target:{mode:'macro',source:'input',min:20,max:80}},0).values.target).toBe(35)
    expect(drivenValues(p,values,{target:{mode:'modulation',shape:'sine',rate:1,phase:0,amplitude:20,offset:30,attack:0.5,hold:1,release:0.5,seed:0}},0.25).values.target).toBe(50)
    expect(drivenValues(p,values,{target:{mode:'blend',source:'input',from:20,to:80}},0).values.target).toBe(35)
  })
  it('persists value sources through drafts and snapshots',()=>{
    const s=new RigSession(controllerManifest)
    s.setValueSource('driven',{mode:'expression',expression:'amount * 2'})
    const snapshot=s.captureSnapshot('Expression source')
    const restored=new RigSession(controllerManifest,s.toDraft())
    expect(restored.sourceFor('driven')).toEqual({mode:'expression',expression:'amount * 2'})
    s.setValueSource('driven',{mode:'local'})
    s.restoreSnapshot(snapshot.id)
    expect(s.sourceFor('driven')).toEqual({mode:'expression',expression:'amount * 2'})
  })
  it('applies a preset and undo as one transaction',()=>{
    const s=new RigSession(controllerManifest)
    s.applyPreset('preset','bold')
    expect(s.storedValue('amount')).toBe(85)
    expect(s.history().labels).toEqual(['Session start','Apply Bold'])
    s.undo();expect(s.storedValue('amount')).toBe(50)
  })
  it('runs declared actions and only randomizes allowed numeric targets',()=>{
    const s=new RigSession(controllerManifest)
    s.runAction('action');expect(s.storedValue('amount')).toBe(65)
    s.undo();expect(s.storedValue('amount')).toBe(50)
    s.runAction('trigger');expect(s.storedValue('trigger')).toBe(1)
    s.undo();expect(s.storedValue('trigger')).toBe(0)
    s.runAction('randomize')
    expect(Number(s.storedValue('amount'))).toBeGreaterThanOrEqual(0)
    expect(Number(s.storedValue('amount'))).toBeLessThanOrEqual(100)
    expect(Number.isInteger(s.storedValue('seed'))).toBe(true)
    s.undo();expect(s.storedValue('amount')).toBe(50)
  })
  it('keeps a driven parameter local value while its source controls output',()=>{
    const s=new RigSession(controllerManifest)
    s.setValue('driven',99)
    expect(s.storedValue('driven')).toBe(99)
    expect(s.liveNumber('driven')).not.toBe(99)
    s.setValueSource('driven',{mode:'local'})
    expect(s.liveNumber('driven')).toBe(99)
  })
  it('interpolates colors and composite values for preset blending',()=>{
    expect(mixValues([0,2],[10,6],0.5)).toEqual([5,4])
    expect(mixValues('#000000','#ffffff',0.5)).toBe('#808080ff')
    const s=new RigSession(controllerManifest);s.setValue('morph',0.5)
    expect(s.liveNumber('blended')).toBe(55)
  })
  it('has deterministic noise and a finite envelope',()=>{
    const noise={enabled:true,mode:'noise',rate:0.5,phase:0,amplitude:40,offset:0,attack:0.5,hold:1,release:1,seed:4817}
    expect(sampleModulation(noise,0.34)).toBe(sampleModulation(noise,0.34))
    const envelope={...noise,mode:'envelope'}
    expect(sampleModulation(envelope,0)).toBe(0)
    expect(sampleModulation(envelope,0.5)).toBe(40)
    expect(sampleModulation(envelope,10)).toBe(0)
  })
  it('rescales animation duration with undo and draft restoration',()=>{
    const s=new RigSession(controllerManifest)
    s.setPlayhead(4);s.setValue('duration',16)
    expect(s.durationTime()).toBe(16);expect(s.trackFor('angle')!.keyframes.at(-1)!.time).toBe(16)
    expect(new RigSession(controllerManifest,s.toDraft()).durationTime()).toBe(16)
    s.undo();expect(s.durationTime()).toBe(8);expect(s.trackFor('angle')!.keyframes.at(-1)!.time).toBe(8)
    s.setValue('time',2);expect(s.playheadTime()).toBe(2)
  })
  it('checks file extension and MIME type before storing local resources',()=>{
    expect(acceptsResource({name:'Font.WOFF2',type:''},'.woff,.woff2')).toBe(true)
    expect(acceptsResource({name:'image.png',type:'image/png'},'image/*')).toBe(true)
    expect(acceptsResource({name:'script.js',type:'text/javascript'},'.svg,image/png')).toBe(false)
  })
})
