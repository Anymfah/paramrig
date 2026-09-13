import type { ResourceValue } from '@/rigs/extended-types'

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('paramrig.resources.v1',1)
    request.onupgradeneeded=()=>request.result.createObjectStore('assets')
    request.onerror=()=>reject(new Error('Local resource storage is unavailable'))
    request.onsuccess=()=>resolve(request.result)
  })
}
export function acceptsResource(file:Pick<File,'name'|'type'>,accept:string):boolean {
  return accept.split(',').some(raw=>{const a=raw.trim().toLowerCase();return a.startsWith('.')?file.name.toLowerCase().endsWith(a):a.endsWith('/*')?file.type.startsWith(a.slice(0,-1)):file.type===a})
}
export async function saveResource(file:File,accept:string,maxMB=25):Promise<ResourceValue> {
  if(!acceptsResource(file,accept))throw new Error(`Choose a supported file: ${accept}`)
  if(file.size>maxMB*1024*1024)throw new Error(`The file must be smaller than ${maxMB} MB`)
  const db=await database(),id=crypto.randomUUID()
  try { await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Resource could not be saved. Check available storage.'));tx.onabort=()=>reject(new Error('Resource storage was interrupted'))}) }
  finally {db.close()}
  return {id,name:file.name,mime:file.type,size:file.size}
}
export async function loadResource(id:string):Promise<Blob|null> {
  const db=await database()
  try { return await new Promise((resolve,reject)=>{const request=db.transaction('assets').objectStore('assets').get(id);request.onsuccess=()=>resolve(request.result instanceof Blob?request.result:null);request.onerror=()=>reject(new Error('Resource could not be read'))}) }
  finally {db.close()}
}

/** Persist an already identified asset, including its decoding metadata. */
export async function storeResource(id: string, blob: Blob): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite')
      tx.objectStore('assets').put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(new Error('Resource could not be saved. Check available storage.'))
      tx.onabort = () => reject(new Error('Resource storage was interrupted.'))
    })
  } finally { db.close() }
}
