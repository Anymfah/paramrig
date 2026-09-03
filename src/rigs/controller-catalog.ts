import type { ParameterDef,NumberParam,RigManifest } from './types'
import { defaultCurve } from '@/state/values'

const base=(id:string,label:string,group:string)=>({id,label,group})
const number=(id:string,label:string,group:string,extra:Partial<NumberParam>={}):NumberParam=>({kind:'number',...base(id,label,group),min:0,max:100,step:1,defaultValue:50,...extra})
const vector=(id:string,label:string,group:string,axes:string[],view:'fields'|'xy'|'dimensions'|'direction'|'rotation'|'anchor'='fields',min=-1,max=1,defaultValue=axes.map(()=>0)):Extract<ParameterDef,{kind:'vector'}>=>({kind:'vector',...base(id,label,group),axes,view,min,max,step:0.01,defaultValue})
const select=(id:string,label:string,group:string,options:string[]):ParameterDef=>({kind:'select',...base(id,label,group),options:options.map(value=>({value,label:value})),defaultValue:options[0]!})
const namedOptions=(values:string[])=>values.map(value=>({value,label:value.charAt(0).toUpperCase()+value.slice(1)}))
const group=(id:string,label:string,category:string,fields:ParameterDef[]):ParameterDef=>({kind:'group',...base(id,label,category),fields,defaultValue:Object.fromEntries(fields.map(p=>[p.id,p.defaultValue]))})
const color=(id:string,label:string,category:string,value='#b8c5b2',alpha=false,channels=true):ParameterDef=>({kind:'color',...base(id,label,category),defaultValue:value,alpha,channels})
const points=(id:string,label:string,category:string,view:'curve'|'ramp'|'path'='curve'):Extract<ParameterDef,{kind:'points'}>=>({kind:'points',...base(id,label,category),view,defaultValue:[{x:0,y:0},{x:0.35,y:0.8},{x:0.7,y:0.45},{x:1,y:1}]})
const font=():ParameterDef=>({kind:'select',...base('family','Font family','type'),view:'font',defaultValue:'Public Sans',options:[{value:'Public Sans',label:'Public Sans'},{value:'Georgia',label:'Georgia'},{value:'monospace',label:'Monospace'}]})
const shadow=group('shadow','Shadow','appearance',[vector('offset','Offset','appearance',['X','Y'],'xy',-48,48,[8,12]),number('blur','Blur','appearance',{max:80,defaultValue:24,unit:'px'}),number('spread','Spread','appearance',{min:-24,max:48,defaultValue:0,unit:'px'}),color('color','Color','appearance','#20202066',true,false)])
const typography=group('typography','Typography','type',[font(),number('size','Size','type',{min:8,max:160,defaultValue:48,unit:'px'}),number('weight','Weight','type',{min:100,max:900,step:100,defaultValue:600}),number('leading','Line height','type',{min:0.8,max:3,step:0.05,defaultValue:1.2}),number('tracking','Letter spacing','type',{min:-0.1,max:0.5,step:0.01,defaultValue:0,unit:'em'}),select('align','Alignment','type',['Left','Center','Right','Justify']),select('case','Case','type',['Original','Uppercase','Lowercase','Capitalize'])])

export const controllerCategories = [
  {id:'numbers',label:'Numbers',defaultOpen:true}, {id:'spatial',label:'Position & dimensions',defaultOpen:false}, {id:'appearance',label:'Color & appearance',defaultOpen:false},
  {id:'choices',label:'Choices',defaultOpen:false}, {id:'type',label:'Text & typography',defaultOpen:false}, {id:'curves',label:'Curves & profiles',defaultOpen:false},
  {id:'resources',label:'Resources',defaultOpen:false}, {id:'instruments',label:'Scene instruments',defaultOpen:false}, {id:'actions',label:'Actions',defaultOpen:false}, {id:'collections',label:'Collections',defaultOpen:false}, {id:'motion',label:'Value sources & animation',defaultOpen:false},
]

export const controllerDefinitions:ParameterDef[]=[
  number('exact','Exact value','numbers',{view:'field',step:0.01,defaultValue:32,unit:'px',units:[{value:'px',label:'Pixels',factor:1},{value:'rem',label:'Rem',factor:16,step:0.01}]}),
  number('count','Number stepper','numbers',{view:'stepper',min:1,max:24,defaultValue:6}),
  number('amount','Number bar','numbers',{step:0.01,defaultValue:50,unit:'%'}),
  number('balance','Bipolar bar','numbers',{view:'bar',min:-100,defaultValue:0,defaultSource:{mode:'parameter',source:'amount'}}),
  number('frequency','Logarithmic scale','numbers',{min:20,max:20000,scale:'log',defaultValue:440,unit:'Hz'}),
  number('steps','Stepped scale','numbers',{min:1,max:16,stops:[1,2,4,8,16],defaultValue:4}),
  number('knob','Rotary knob','numbers',{view:'knob',defaultValue:40}),
  number('angle','Circular angle','numbers',{min:0,max:360,unit:'°',view:'angle',defaultValue:45}),
  {kind:'range',...base('range','Minimum / maximum','numbers'),min:0,max:100,step:1,defaultValue:[20,80]},
  number('seed','Random seed','numbers',{max:99999,defaultValue:4817,view:'seed'}),
  vector('vector2','Vector 2D','spatial',['X','Y']),
  vector('position','XY pad','spatial',['X','Y'],'xy'),
  vector('vector3','Vector 3D','spatial',['X','Y','Z']),
  vector('dimensions','Dimensions 2D','spatial',['Width','Height'],'dimensions',1,1024,[320,180]),
  vector('dimensions3','Dimensions 3D','spatial',['Width','Height','Depth'],'dimensions',0.01,10,[1,1,1]),
  group('direction2','Direction 2D','spatial',[number('angle','Angle','spatial',{max:360,unit:'°',view:'angle',defaultValue:45}),number('strength','Strength','spatial',{max:1,step:0.01,defaultValue:0.5})]),
  group('direction3','Direction 3D','spatial',[number('azimuth','Azimuth','spatial',{max:360,unit:'°',view:'angle',defaultValue:45}),number('elevation','Elevation','spatial',{min:-90,max:90,unit:'°',defaultValue:30})]),
  vector('rotation','Rotation 3D','spatial',['X','Y','Z'],'rotation',-180,180),
  vector('anchor','Anchor / pivot','spatial',['X','Y'],'anchor',0,1,[0.5,0.5]),
  group('transform','Transform','spatial',[vector('position','Position','spatial',['X','Y','Z']),vector('rotation','Rotation','spatial',['X','Y','Z'],'rotation',-180,180),vector('scale','Scale','spatial',['X','Y','Z'],'dimensions',0.01,10,[1,1,1])]),
  color('ink','Color & channels','appearance'),color('rgba','Color with opacity','appearance','#b8c5b299',true),
  {kind:'palette',...base('palette','Color palette','appearance'),defaultValue:['#b8c5b2','#797f8b','#d6b89c']},
  {kind:'gradient',...base('gradient','Color gradient','appearance'),defaultValue:[{t:0,color:'#343c37'},{t:0.5,color:'#b8c5b2'},{t:1,color:'#e7e6df'}]},
  points('opacityRamp','Opacity ramp','appearance','ramp'),
  group('gradientGeometry','Gradient geometry','appearance',[select('type','Geometry','appearance',['Linear','Radial','Conic']),number('angle','Angle','appearance',{max:360,view:'angle',unit:'°',defaultValue:90}),vector('center','Center','appearance',['X','Y'],'xy',0,1,[0.5,0.5]),number('radius','Radius','appearance',{min:1,max:100,defaultValue:50,unit:'%'})]),
  group('hdr','HDR color','appearance',[color('color','Color','appearance','#b8c5b2',false,false),number('intensity','Intensity','appearance',{min:0.01,max:100,step:0.01,scale:'log',defaultValue:1})]),
  {kind:'select',...base('material','Material preset','appearance'),view:'visual',defaultValue:'matte',options:[{value:'matte',label:'Matte',preview:'#8c918a'},{value:'metal',label:'Metal',preview:'linear-gradient(120deg,#444,#ddd,#666)'},{value:'glass',label:'Glass',preview:'linear-gradient(135deg,#b8cbd877,#ffffff33)'}]},
  {kind:'switch',...base('switch','Switch','choices'),defaultValue:true},select('segments','Segmented choice','choices',['Fill','Stroke']),select('select','Dropdown','choices',['Linear','Ease in','Ease out','Ease in-out','Hold']),
  select('triState','Tri-state choice','choices',['On','Off','Inherit']),
  {kind:'select',...base('search','Searchable choice','choices'),view:'search',defaultValue:'circle',options:namedOptions(['circle','square','triangle','hexagon','star','line'])},
  {kind:'multiselect',...base('multiple','Multiple choice','choices'),defaultValue:['surface'],options:namedOptions(['surface','outline','shadow','texture'])},
  {kind:'select',...base('object','Object reference','choices'),view:'search',defaultValue:'planet',options:namedOptions(['planet','clouds','light','camera'])},
  {kind:'text',...base('title','Text','type'),defaultValue:'Make it move.'},
  {kind:'text',...base('paragraph','Multiline text','type'),defaultValue:'A local instrument for shaping visuals.\nChange a value, then undo it.',multiline:true},
  typography,
  group('fontAxes','Variable font axes','type',[number('wght','Weight (wght)','type',{min:100,max:900,defaultValue:500}),number('wdth','Width (wdth)','type',{min:50,max:200,defaultValue:100}),number('slnt','Slant (slnt)','type',{min:-15,max:0,defaultValue:0,unit:'°'})]),
  {kind:'curve',...base('bezier','Cubic Bézier','curves'),defaultValue:defaultCurve()},
  points('curve','Ramp / falloff profile','curves'),points('path','Editable 2D path','curves','path'),
  {kind:'radial',...base('radial','Radial profile','curves'),zones:[
    {label:'Surface',start:0,end:0.12},{label:'Body',start:0.12,end:0.4},{label:'Mid',start:0.4,end:0.65},{label:'Edge',start:0.65,end:0.88},{label:'Fade',start:0.88,end:1},
  ],defaultValue:[
    {name:'Shell',color:'#d6b89c',enabled:true,points:[{x:0.08,y:0.92},{x:0.42,y:0.7},{x:0.72,y:0.35},{x:0.94,y:0.05}]},
    {name:'Veil',color:'#c45c48',enabled:true,points:[{x:0.1,y:0.65},{x:0.45,y:0.5},{x:0.78,y:0.22},{x:0.96,y:0.02}]},
    {name:'Halo',color:'#e7c070',enabled:true,points:[{x:0.15,y:0.45},{x:0.5,y:0.55},{x:0.82,y:0.4},{x:0.97,y:0.08}]},
  ]},
  {kind:'resource',...base('resource_image','Image / texture / SVG','resources'),view:'image',accept:'image/png,image/jpeg,image/webp,image/avif,image/svg+xml,.svg',defaultValue:null,maxMB:25},
  {kind:'resource',...base('resource_model','Font / model / environment','resources'),view:'model',accept:'.woff,.woff2,.ttf,.otf,.glb,.gltf,.hdr,.exr',defaultValue:null,maxMB:25},
  {kind:'preset',...base('preset','Parameter preset','resources'),defaultValue:'calm',options:[{value:'calm',label:'Calm',values:{amount:25,angle:0,ink:'#b8c5b2'}},{value:'bold',label:'Bold',values:{amount:85,angle:90,ink:'#d6b89c'}}]},
  {kind:'gizmo2d',...base('gizmo2d','2D transform gizmo','instruments'),defaultValue:{position:[0,0],size:[1,1],rotation:0}},
  {kind:'gizmo3d',...base('gizmo3d','3D transform gizmo','instruments'),defaultValue:{position:[0,0,0],rotation:[-20,30,0],scale:[1,1,1],mode:'translate'}},
  {kind:'textureFrame',...base('textureFrame','Texture frame','instruments'),defaultValue:{rect:[0.15,0.15,0.85,0.85],rotation:0}},
  {kind:'camera',...base('camera','Camera rig','instruments'),defaultValue:{azimuth:30,elevation:20,distance:6,fov:45}},
  {kind:'action',...base('action','Apply composition','actions'),action:'set',values:{amount:65,angle:30},defaultValue:0},
  {kind:'action',...base('trigger','Trigger impulse','actions'),action:'trigger',defaultValue:0},
  {kind:'action',...base('randomize','Randomize allowed values','actions'),action:'randomize',targets:['amount','angle','seed'],defaultValue:0},
  {kind:'action',...base('reset','Reset numeric group','actions'),action:'reset',targets:['amount','angle','seed'],defaultValue:0},
  {kind:'list',...base('values','Value list','collections'),item:number('item','Value','collections',{view:'field'}),defaultValue:[25,50,75]},
  {kind:'list',...base('layers','Repeatable layers','collections'),item:group('layer','Layer','collections',[{kind:'text',...base('name','Name','collections'),defaultValue:'Layer'},color('color','Color','collections','#b8c5b2',false,false),number('opacity','Opacity','collections',{max:1,step:0.01,defaultValue:1})]),defaultValue:[{name:'Base',color:'#b8c5b2',opacity:1}]},
  {...vector('spacing','Linked sides / corners','collections',['Top','Right','Bottom','Left'],'dimensions',0,128,[16,16,16,16]),linkLabel:'Link all values'},
  shadow,group('stroke','Stroke','collections',[number('width','Width','collections',{max:24,defaultValue:2,unit:'px'}),color('color','Color','collections','#b8c5b2',false,false),{kind:'list',...base('dash','Dash pattern','collections'),item:number('length','Length','collections',{min:1,max:64,defaultValue:8,view:'field'}),defaultValue:[8,4]}]),
  number('duration','Duration','motion',{min:0.1,max:60,step:0.1,defaultValue:8,unit:'s',role:'duration'}),number('time','Time position','motion',{min:0,max:8,step:1/30,defaultValue:0,unit:'s',role:'playhead'}),
  number('driven','Modulated value','motion',{min:-100,max:100,defaultValue:0,defaultSource:{mode:'modulation',shape:'sine',rate:0.5,phase:0,amplitude:40,offset:0,attack:0.5,hold:1,release:1,seed:4817}}),
  number('macro','Macro','motion',{min:0,max:1,step:0.01,defaultValue:0.5}),
  number('macroOutput','Macro output','motion',{defaultValue:0,readOnly:true,hidden:true,defaultSource:{mode:'macro',source:'macro',min:0,max:100}}),
  number('linked','Expression value source','motion',{min:-100,max:100,defaultValue:0,defaultSource:{mode:'expression',expression:'amount * 0.5 + sin(t) * 10'}}),
  number('morph','Blend amount','motion',{min:0,max:1,step:0.01,defaultValue:0}),
  number('blended','Blended output','motion',{defaultValue:25,defaultSource:{mode:'blend',source:'morph',from:25,to:85}}),
]

export const controllerExamples=controllerDefinitions.filter(parameter=>!parameter.hidden)

export const controllerManifest:RigManifest={
  id:'controller-lab',name:'Controller lab',summary:'All controller families in one live session',description:'Explore parameter types, reusable instruments, local resources and animation. Every edit shares the same undo history.',
  renderer:'html',rendererLabel:'HTML / CSS',collection:'examples',title:'Examples/HTML',sourceFile:'src/rigs/controller-catalog.ts',tags:['controllers','playground','parameters'],
  groups:controllerCategories,parameters:controllerDefinitions,
  animation:{duration:8,fps:30,loop:true,tracks:[{paramId:'angle',interpolation:'linear',keyframes:[{time:0,value:0},{time:8,value:360}]}]},
}
