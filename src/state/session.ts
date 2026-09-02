import type {
  AnimTrack,
  AnimationDef,
  ExportDocument,
  ParamValue,
  ParameterDef,
  RigManifest,
  Snapshot,
  StoredDraft,
  Keyframe,
  KeyframeRef,
  LoopRange,
} from '@/rigs/types'
import {
  changedKeys,
  cloneValue,
  cloneValues,
  interpolateNumber,
  recordsEqual,
  upsertKeyframe,
} from '@/state/values'

import { normalizeValue, normalizeValueSource } from '@/state/parameter-values'
import { drivenValues } from '@/state/drivers'
import type { ValueSource } from '@/rigs/extended-types'

export type CompareMode = 'original' | 'current'

export type SessionSnapshot = {
  values: Record<string, ParamValue>
  valueSources: Record<string, ValueSource>
  snapshots: Snapshot[]
  compare: CompareMode
  activeSnapshotId: string | null
  playhead: number
  playing: boolean
  loop: boolean
  duration: number
  fps: number
  tracks: AnimTrack[]
  gesture: boolean
  loopRange: LoopRange | null
  notice: string
}

type Listener = () => void

type HistoryEntry = {
  label: string
  values: Record<string, ParamValue>
  valueSources: Record<string, ValueSource>
  tracks: AnimTrack[]
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  loop: boolean
  loopRange: LoopRange | null
  duration: number
}

function withKeyIds(tracks: AnimTrack[]): AnimTrack[] {
  return tracks.map(track => ({ ...track, keyframes: track.keyframes.map((frame, index) => ({
    ...frame, id: frame.id ?? `${track.paramId}-${index}-${frame.time}`,
  })) }))
}

function comparableTracks(tracks: AnimTrack[]): string {
  return JSON.stringify(tracks.map(track => ({ ...track,
    keyframes: track.keyframes.map(frame => ({ time: frame.time, value: frame.value, easing: frame.easing })),
  })))
}

function defaultsFrom(parameters: ParameterDef[]): Record<string, ParamValue> {
  const next: Record<string, ParamValue> = {}
  for (const param of parameters) next[param.id] = cloneValue(param.defaultValue)
  return next
}

function defaultSourcesFrom(parameters: ParameterDef[]): Record<string, ValueSource> {
  return Object.fromEntries(parameters.flatMap(param => param.kind === 'number' ? [[param.id, structuredClone(param.defaultSource ?? { mode: 'local' })]] : []))
}

function sanitizeValueSources(parameters: ParameterDef[], incoming: Record<string, ValueSource> | undefined): Record<string, ValueSource> {
  const next = defaultSourcesFrom(parameters)
  if (!incoming || typeof incoming !== 'object') return next
  for (const param of parameters) if (param.kind === 'number' && incoming[param.id] !== undefined) next[param.id] = normalizeValueSource(param, incoming[param.id])
  return next
}

function sanitizeValues(
  parameters: ParameterDef[],
  incoming: Record<string, ParamValue> | undefined,
): Record<string, ParamValue> {
  const defaults = defaultsFrom(parameters)
  if (!incoming || typeof incoming !== 'object') return defaults
  const next = { ...defaults }
  for (const param of parameters) {
    const value = incoming[param.id]
    if (value === undefined) continue
    next[param.id] = normalizeValue(param, value)
  }
  return next
}

export class RigSession {
  readonly rigId: string
  readonly name: string
  readonly parameters: ParameterDef[]
  readonly defaults: Record<string, ParamValue>
  private values: Record<string, ParamValue>
  private valueSources: Record<string, ValueSource>
  private snapshots: Snapshot[]
  private compare: CompareMode
  private activeSnapshotId: string | null
  private playhead: number
  private playing: boolean
  private loop: boolean
  private duration: number
  private fps: number
  private tracks: AnimTrack[]
  private readonly initialDuration: number
  private readonly initialTracks: AnimTrack[]
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private gestureStart: HistoryEntry | null = null
  private listeners = new Set<Listener>()
  private clockListeners = new Set<Listener>()
  private revision = 0
  private raf = 0
  private lastTick = 0
  private gestureDepth = 0
  private loopRange: LoopRange | null = null
  private notice = ''
  private historyTrimmed = false

  constructor(manifest: RigManifest, stored?: StoredDraft | null) {
    this.rigId = manifest.id
    this.name = manifest.name
    this.parameters = manifest.parameters
    this.defaults = defaultsFrom(manifest.parameters)
    this.values = sanitizeValues(manifest.parameters, stored?.values)
    this.valueSources = sanitizeValueSources(manifest.parameters, stored?.valueSources)
    this.snapshots = Array.isArray(stored?.snapshots) ? stored.snapshots.map((item) => structuredClone(item)) : []
    this.compare = stored?.compare === 'original' ? 'original' : 'current'
    this.activeSnapshotId = stored?.activeSnapshotId ?? this.snapshots[0]?.id ?? null
    this.playhead = typeof stored?.playhead === 'number' ? stored.playhead : 0
    this.playing = false
    this.loop = stored?.loop ?? manifest.animation?.loop ?? true
    this.duration = typeof stored?.duration === 'number' && Number.isFinite(stored.duration) && stored.duration >= 0.1 && stored.duration <= 3600 ? stored.duration : manifest.animation?.duration ?? 8
    this.fps = manifest.animation?.fps ?? 30
    this.initialDuration = manifest.animation?.duration ?? 8
    this.initialTracks = withKeyIds(structuredClone(manifest.animation?.tracks ?? []))
    this.tracks = withKeyIds(structuredClone(stored?.tracks ?? this.initialTracks))
    const range = stored?.loopRange
    if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end <= this.duration && range.end > range.start) this.loopRange = range
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeClock = (listener: Listener): (() => void) => {
    this.clockListeners.add(listener)
    return () => this.clockListeners.delete(listener)
  }

  playheadTime(): number {
    return this.playhead
  }

  displayPlayhead(): number {
    return Math.round(this.playhead * this.fps) / this.fps
  }

  isPlaying(): boolean {
    return this.playing
  }

  isLoop(): boolean {
    return this.loop
  }

  durationTime(): number {
    return this.duration
  }

  isGesturing(): boolean {
    return this.gestureStart !== null
  }

  trackFor(paramId: string): AnimTrack | undefined {
    return this.tracks.find((track) => track.paramId === paramId)
  }

  storedValue(id: string): ParamValue | undefined {
    return this.values[id]
  }

  sourceFor(id: string): ValueSource | undefined {
    return this.valueSources[id] ? structuredClone(this.valueSources[id]) : undefined
  }

  liveNumber(id: string, fallback = 0): number {
    const hasDrivers = Object.values(this.valueSources).some(source => source.mode !== 'local' && source.mode !== 'animation')
    const track = this.trackFor(id)
    if (!hasDrivers && track) return interpolateNumber(track,this.playhead,this.duration,false)
    const value = hasDrivers ? this.viewValues()[id] : this.values[id]
    return typeof value === 'number' ? value : fallback
  }

  previewNumber(id: string, fallback = 0): number {
    if (this.compare === 'original') {
      const value = this.previewValues()[id]
      return typeof value === 'number' ? value : fallback
    }
    return this.liveNumber(id, fallback)
  }

  getSnapshot = (): SessionSnapshot => ({
    values: this.viewValues(),
    valueSources: structuredClone(this.valueSources),
    snapshots: this.snapshots,
    compare: this.compare,
    activeSnapshotId: this.activeSnapshotId,
    playhead: this.playhead,
    playing: this.playing,
    loop: this.loop,
    duration: this.duration,
    fps: this.fps,
    tracks: this.tracks,
    gesture: this.gestureStart !== null,
    loopRange: this.loopRange,
    notice: this.notice,
  })

  getRevision(): number {
    return this.revision
  }

  storedValues(): Record<string, ParamValue> {
    return cloneValues(this.values)
  }

  viewValues(playhead = this.playhead): Record<string, ParamValue> {
    const next = cloneValues(this.values)
    for (const track of this.tracks) {
      next[track.paramId] = interpolateNumber(track, playhead, this.duration, false)
    }
    for (const param of this.parameters) if (param.kind === 'number') {
      if (param.role === 'playhead') next[param.id] = playhead
      if (param.role === 'duration') next[param.id] = this.duration
    }
    return drivenValues(this.parameters, next, this.valueSources, playhead).values
  }

  driverErrors(): Record<string,string> {
    return drivenValues(this.parameters, this.values, this.valueSources, this.playhead).errors
  }

  previewValues(): Record<string, ParamValue> {
    if (this.compare === 'original') {
      const values = this.baselineValues()
      for (const track of this.baselineTracks()) values[track.paramId] = interpolateNumber(track, this.playhead, this.duration, false)
      return drivenValues(this.parameters, values, this.valueSources, this.playhead).values
    }
    return this.viewValues()
  }

  baselineValues(): Record<string, ParamValue> {
    const snapshot = this.snapshots.find((item) => item.id === this.activeSnapshotId)
    return snapshot ? sanitizeValues(this.parameters,snapshot.values) : cloneValues(this.defaults)
  }

  baselineTracks(): AnimTrack[] {
    const snapshot = this.snapshots.find((item) => item.id === this.activeSnapshotId)
    if (snapshot?.tracks) return structuredClone(snapshot.tracks)
    return structuredClone(this.initialTracks)
  }

  beginGesture(label = 'Adjust parameters'): void {
    if (this.gestureDepth++ > 0) return
    this.setPlaying(false)
    this.compare = 'current'
    this.gestureStart = this.capture(label)
    this.emit()
  }

  endGesture(): void {
    if (!this.gestureStart || --this.gestureDepth > 0) return
    if (!this.sameAs(this.gestureStart)) {
      this.pushPast(this.gestureStart)
      this.future = []
      this.notice = this.gestureStart.label
    }
    this.gestureStart = null
    this.gestureDepth = 0
    this.emit()
  }

  cancelGesture(): void {
    if (!this.gestureStart) return
    this.restoreEntry(this.gestureStart)
    this.gestureStart = null
    this.gestureDepth = 0
    this.notice = 'Adjustment cancelled'
    this.emit()
  }

  resetParams(ids: string[]): void {
    const unique = [...new Set(ids)].filter(id => this.parameters.some(param => param.id === id))
    if (!unique.length) return
    this.beginGesture(unique.length === 1 ? `Reset ${this.labelFor(unique[0]!)}` : 'Reset section')
    for (const id of unique) this.resetParam(id)
    this.endGesture()
  }

  setValue(id: string, value: ParamValue): void {
    const param = this.parameters.find(item => item.id === id)
    if (!param) return
    if (param.kind === 'number' && param.readOnly) return
    if (param.kind === 'number' && param.role === 'playhead') { if (typeof value === 'number') this.setPlayhead(value); return }
    if (param.kind === 'number' && param.role === 'duration') { if (typeof value === 'number' && Number.isFinite(value)) this.setDuration(normalizeValue(param,value) as number); return }
    if (param.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return
    value = normalizeValue(param, value)
    this.edit(`Change ${param.label}`, () => {
      const track = this.trackFor(id)
      if (track && typeof value === 'number') {
        const next = upsertKeyframe(track, this.playhead, value, 0.5 / this.fps)
        next.keyframes = next.keyframes.map(frame => ({ ...frame, id: frame.id ?? crypto.randomUUID() }))
        this.tracks = this.tracks.map(item => item.paramId === id ? next : item)
      } else {
        this.values = { ...this.values, [id]: cloneValue(value) }
      }
      if (param.kind === 'select' && param.appliesToTracks && (value === 'linear' || value === 'step')) {
        const interpolation = value
        this.tracks = this.tracks.map(track => ({ ...track, interpolation,
          keyframes: track.keyframes.map(frame => ({ ...frame, easing: undefined })),
        }))
      }
    })
  }

  setValueSource(id: string, source: ValueSource): void {
    const param = this.parameters.find(item => item.id === id)
    if (param?.kind !== 'number' || param.readOnly || param.role) return
    const next = normalizeValueSource(param, source)
    this.edit(`Change ${param.label} value source`, () => {
      this.valueSources = { ...this.valueSources, [id]: next }
    })
  }

  runAction(id: string): void {
    const param = this.parameters.find(p=>p.id===id)
    if (param?.kind !== 'action') return
    this.beginGesture(param.label)
    try {
      if (param.action === 'reset') this.resetParams(param.targets ?? this.parameters.filter(p=>p.kind!=='action').map(p=>p.id))
      if (param.action === 'randomize') {
        for (const p of this.parameters) if (p.kind==='number' && param.targets?.includes(p.id)) {
          const steps=Math.floor((p.max-p.min)/p.step)
          this.setValue(p.id,p.min+Math.floor(Math.random()*(steps+1))*p.step)
        }
      }
      if (param.action === 'set') for (const [key,value] of Object.entries(param.values ?? {})) this.setValue(key,value)
      if (param.action === 'trigger') this.setValue(id,Number(this.values[id] ?? 0)+1)
    } finally { this.endGesture() }
  }

  applyPreset(id: string, choice: string): void {
    const param=this.parameters.find(p=>p.id===id)
    if (param?.kind!=='preset') return
    const preset=param.options.find(p=>p.value===choice)
    if (!preset) return
    this.beginGesture(`Apply ${preset.label}`)
    try { this.setValue(id,choice); for (const [key,value] of Object.entries(preset.values)) this.setValue(key,value) }
    finally { this.endGesture() }
  }

  isParamModified(id: string): boolean {
    const param = this.parameters.find(item => item.id === id)
    if (!param) return false
    if (param.kind === 'number' && param.role === 'duration') return this.duration !== this.initialDuration
    if (param.kind === 'number' && param.role === 'playhead') return this.playhead !== param.defaultValue
    return JSON.stringify(this.values[id]) !== JSON.stringify(param.defaultValue) ||
      JSON.stringify(this.valueSources[id]) !== JSON.stringify(param.kind === 'number' ? param.defaultSource ?? { mode: 'local' } : undefined) ||
      comparableTracks(this.tracks.filter(track => track.paramId === id)) !==
      comparableTracks(this.initialTracks.filter(track => track.paramId === id))
  }

  resetParam(id: string): void {
    const param = this.parameters.find(item => item.id === id)
    if (!param) return
    if (param.kind === 'number' && param.role === 'duration') { this.setDuration(Number(param.defaultValue)); return }
    if (param.kind === 'number' && param.role === 'playhead') { this.setPlayhead(Number(param.defaultValue)); return }
    if (param.kind === 'select' && param.appliesToTracks) { this.setValue(id, param.defaultValue); return }
    this.edit(`Reset ${param.label}`, () => {
      this.values = { ...this.values, [id]: cloneValue(param.defaultValue) }
      if (param.kind === 'number') this.valueSources = { ...this.valueSources, [id]: structuredClone(param.defaultSource ?? { mode: 'local' }) }
      const original = this.initialTracks.find(track => track.paramId === id)
      const exists = this.tracks.some(track => track.paramId === id)
      this.tracks = this.tracks.flatMap(track => track.paramId !== id ? [track] : original ? [structuredClone(original)] : [])
      if (original && !exists) this.tracks.push(structuredClone(original))
    })
  }

  resetAll(): void {
    this.edit('Reset all parameters', () => {
      this.duration = this.initialDuration
      this.playhead = Math.min(this.playhead,this.duration)
      this.loopRange = null
      this.values = cloneValues(this.defaults)
      this.valueSources = defaultSourcesFrom(this.parameters)
      this.tracks = structuredClone(this.initialTracks)
    })
  }

  undo(): void {
    if (this.gestureStart) return
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(this.capture(previous.label))
    this.restoreEntry(previous)
    this.notice = `Undid: ${previous.label}`
    this.emit()
  }

  redo(): void {
    if (this.gestureStart) return
    const next = this.future.pop()
    if (!next) return
    this.pushPast(this.capture(next.label))
    this.restoreEntry(next)
    this.notice = `Redid: ${next.label}`
    this.emit()
  }

  canUndo(): boolean { return !this.gestureStart && this.past.length > 0 }
  canRedo(): boolean { return !this.gestureStart && this.future.length > 0 }
  undoLabel(): string { return this.past.at(-1)?.label ?? '' }
  redoLabel(): string { return this.future.at(-1)?.label ?? '' }

  history(): { labels: string[]; index: number } {
    return { labels: [this.historyTrimmed ? 'Earlier state' : 'Session start', ...this.past.map(entry => entry.label), ...[...this.future].reverse().map(entry => entry.label)], index: this.past.length }
  }

  goToHistory(index: number): void {
    if (this.gestureStart || !Number.isInteger(index) || index < 0 || index > this.past.length + this.future.length) return
    while (this.past.length > index) this.undo()
    while (this.past.length < index) this.redo()
  }

  captureSnapshot(name: string): Snapshot {
    const snapshot: Snapshot = {
      id: crypto.randomUUID(), name: name.trim() || 'Untitled snapshot', createdAt: new Date().toISOString(),
      values: cloneValues(this.values), valueSources: structuredClone(this.valueSources), tracks: structuredClone(this.tracks), loop: this.loop, loopRange: this.loopRange, duration: this.duration,
    }
    this.edit(`Capture ${snapshot.name}`, () => {
      this.snapshots = [...this.snapshots, snapshot]
      this.activeSnapshotId = snapshot.id
    })
    return snapshot
  }

  renameSnapshot(id: string, name: string): void {
    if (!name.trim()) return
    this.edit('Rename snapshot', () => { this.snapshots = this.snapshots.map(item => item.id === id ? { ...item, name: name.trim() } : item) })
  }

  removeSnapshot(id: string): void {
    this.edit('Remove snapshot', () => {
      this.snapshots = this.snapshots.filter(item => item.id !== id)
      if (this.activeSnapshotId === id) this.activeSnapshotId = null
    })
  }

  baselineName(): string {
    return this.snapshots.find(item => item.id === this.activeSnapshotId)?.name ?? 'Initial values'
  }

  restoreSnapshot(id: string): void {
    const snapshot = this.snapshots.find(item => item.id === id)
    if (!snapshot) return
    this.edit(`Restore ${snapshot.name}`, () => {
      this.activeSnapshotId = id
      this.values = sanitizeValues(this.parameters,snapshot.values)
      this.valueSources = sanitizeValueSources(this.parameters, snapshot.valueSources)
      this.tracks = withKeyIds(structuredClone(snapshot.tracks ?? this.initialTracks))
      this.loop = snapshot.loop ?? this.loop
      this.loopRange = snapshot.loopRange ?? null
      this.duration = snapshot.duration ?? this.duration
    })
  }

  addKeyframe(paramId: string, time = this.playhead, value?: number): KeyframeRef | null {
    const param = this.parameters.find(item => item.id === paramId)
    if (param?.kind !== 'number' || param.readOnly || param.role) return null
    const at = this.snapTime(time)
    const source = this.trackFor(paramId)
    const sampled = value ?? (source ? interpolateNumber(source, at, this.duration, false) : this.liveNumber(paramId))
    if (!Number.isFinite(at) || !Number.isFinite(sampled)) return null
    const existing = source?.keyframes.find(frame => Math.abs(frame.time - at) < 0.5 / this.fps)
    const id = existing?.id ?? crypto.randomUUID()
    this.edit(`Add ${param.label} keyframe`, () => {
      const track = this.trackFor(paramId) ?? { paramId, interpolation: 'linear' as const, keyframes: [] }
      const next = { ...track, keyframes: [...track.keyframes.filter(frame => frame.id !== id), { ...existing, id, time: at, value: Math.min(param.max, Math.max(param.min, sampled)) }].sort((a,b) => a.time-b.time) }
      this.tracks = source ? this.tracks.map(item => item.paramId === paramId ? next : item) : [...this.tracks, next]
    })
    return { paramId, id }
  }

  updateKeyframe(ref: KeyframeRef, patch: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>): void {
    this.edit(`Edit ${this.labelFor(ref.paramId)} keyframe`, () => {
      this.tracks = this.tracks.map(track => {
        if (track.paramId !== ref.paramId) return track
        const time = patch.time === undefined ? undefined : this.snapTime(patch.time)
        if (time !== undefined && track.keyframes.some(frame => frame.id !== ref.id && Math.abs(frame.time-time) < 0.5/this.fps)) return track
        const param = this.parameters.find(item => item.id === ref.paramId)
        const value = patch.value === undefined || param?.kind !== 'number' ? patch.value : Math.min(param.max, Math.max(param.min, patch.value))
        if ((value !== undefined && !Number.isFinite(value)) || (time !== undefined && !Number.isFinite(time))) return track
        return { ...track, keyframes: track.keyframes.map(frame => frame.id === ref.id ? { ...frame, ...patch, ...(time === undefined ? {} : { time }), ...(value === undefined ? {} : { value }) } : frame).sort((a,b)=>a.time-b.time) }
      })
    })
  }

  moveKeyframes(refs: KeyframeRef[], delta: number): void {
    const source = this.gestureStart?.tracks ?? this.tracks
    const selected = source.flatMap(track => track.keyframes.filter(frame => refs.some(ref => ref.paramId === track.paramId && ref.id === frame.id)))
    if (!selected.length || !Number.isFinite(delta)) return
    const offset = Math.round(Math.max(-Math.min(...selected.map(frame=>frame.time)), Math.min(this.duration - Math.max(...selected.map(frame=>frame.time)), delta)) * this.fps) / this.fps
    const next = source.map(track => ({ ...track, keyframes: track.keyframes.map(frame => refs.some(ref=>ref.paramId===track.paramId && ref.id===frame.id) ? { ...frame, time: this.snapTime(frame.time+offset) } : frame).sort((a,b)=>a.time-b.time) }))
    if (next.some(track=>track.keyframes.some((frame,i)=>i > 0 && Math.abs(frame.time-track.keyframes[i-1]!.time) < 0.5/this.fps))) return
    this.edit('Move keyframes', () => { this.tracks = next })
  }

  deleteKeyframes(refs: KeyframeRef[]): void {
    this.edit('Delete keyframes', () => {
      const live = this.viewValues()
      this.tracks = this.tracks.flatMap(track => {
        const keyframes = track.keyframes.filter(frame => !refs.some(ref=>ref.paramId===track.paramId && ref.id===frame.id))
        if (!keyframes.length) { this.values = { ...this.values, [track.paramId]: live[track.paramId]! }; return [] }
        return [{ ...track, keyframes }]
      })
    })
  }

  pasteKeyframes(items: { paramId: string; frame: Keyframe }[]): KeyframeRef[] {
    if (!items.length) return []
    const first = Math.min(...items.map(item=>item.frame.time))
    const last = Math.max(...items.map(item=>item.frame.time))
    const start = Math.min(this.playhead, this.duration - (last-first))
    const refs: KeyframeRef[] = []
    this.beginGesture('Paste keyframes')
    for (const item of items) {
      const ref = this.addKeyframe(item.paramId, start + item.frame.time-first, item.frame.value)
      if (ref) { this.updateKeyframe(ref, { easing: item.frame.easing }); refs.push(ref) }
    }
    this.endGesture()
    return refs
  }

  snapTime(time: number): number { return Math.round(Math.min(this.duration, Math.max(0, time)) * this.fps) / this.fps }
  labelFor(id: string): string { return this.parameters.find(param=>param.id===id)?.label ?? id }

  setCompare(mode: CompareMode): void {
    if (this.compare === mode) return
    this.compare = mode
    this.emit()
  }

  setPlayhead(time: number, fromPlayback = false): void {
    if (!Number.isFinite(time)) return
    const start = this.loopRange?.start ?? 0
    const end = this.loopRange?.end ?? this.duration
    const wrapped = fromPlayback && this.loop && time >= end
      ? start + ((time - start) % (end - start) + end - start) % (end - start)
      : Math.min(Math.max(time, 0), this.duration)
    const snapped = Math.round(wrapped * this.fps) / this.fps
    const shownBefore = this.displayPlayhead()
    this.playhead = fromPlayback ? wrapped : snapped
    if (fromPlayback) {
      if (this.displayPlayhead() !== shownBefore) this.emitClock()
      return
    }
    this.playing = false
    this.stopClock()
    this.emit()
  }

  setPlaying(playing: boolean): void {
    if (playing) {
      if (this.gestureStart) return
      const end = this.loopRange?.end ?? this.duration
      if (this.playhead >= end || this.playhead < (this.loopRange?.start ?? 0)) this.playhead = this.loopRange?.start ?? 0
      const started = !this.playing
      this.playing = true
      if (!this.raf) this.startClock()
      if (started) this.emit()
      return
    }
    if (!this.playing && !this.raf) return
    this.playing = false
    this.stopClock()
    this.emit()
  }

  setDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 3600 || seconds === this.duration) return
    this.edit('Change duration', () => {
      const ratio=seconds/this.duration
      this.tracks=this.tracks.map(track=>({...track,keyframes:track.keyframes.map(key=>({...key,time:key.time*ratio}))}))
      if(this.loopRange)this.loopRange={start:this.loopRange.start*ratio,end:this.loopRange.end*ratio}
      this.playhead*=ratio
      this.duration=seconds
    })
  }

  setLoop(loop: boolean): void {
    this.edit(loop ? 'Enable loop' : 'Disable loop', () => { this.loop = loop })
  }

  setLoopRange(range: LoopRange | null): void {
    if (range && (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > this.duration || range.end - range.start < 1 / this.fps)) return
    this.edit(range ? 'Change playback range' : 'Clear playback range', () => { this.loopRange = range })
  }

  setTrackInterpolation(paramId: string, interpolation: AnimTrack['interpolation']): void {
    this.edit('Change interpolation', () => { this.tracks = this.tracks.map(track => track.paramId === paramId ? { ...track, interpolation } : track) })
  }

  changedSinceBaseline(): string[] {
    const keys = changedKeys(this.values, this.baselineValues())
    const baseline = this.baselineTracks()
    for (const track of this.tracks) {
      const origin = baseline.find((item) => item.paramId === track.paramId)
      if (comparableTracks([track]) !== comparableTracks(origin ? [origin] : []) && !keys.includes(track.paramId)) {
        keys.push(track.paramId)
      }
    }
    for (const track of baseline) if (!this.trackFor(track.paramId) && !keys.includes(track.paramId)) keys.push(track.paramId)
    return keys
  }

  toExport(): ExportDocument {
    const animation = this.tracks.length || this.parameters.some(p => p.kind === 'number' && p.role)
      ? {
          duration: this.duration,
          fps: this.fps,
          loop: this.loop,
          playhead: this.playhead,
          tracks: structuredClone(this.tracks),
          loopRange: this.loopRange,
        }
      : undefined
    return {
      version: 1,
      rigId: this.rigId,
      name: this.name,
      exportedAt: new Date().toISOString(),
      values: this.viewValues(),
      valueSources: structuredClone(this.valueSources),
      ...(animation ? { animation } : {}),
    }
  }

  toDraft(): StoredDraft {
    return {
      version: 1,
      rigId: this.rigId,
      values: cloneValues(this.values),
      valueSources: structuredClone(this.valueSources),
      snapshots: structuredClone(this.snapshots),
      compare: this.compare,
      activeSnapshotId: this.activeSnapshotId,
      playhead: this.playhead,
      loop: this.loop,
      tracks: structuredClone(this.tracks),
      loopRange: this.loopRange,
      duration: this.duration,
    }
  }

  private capture(label = ''): HistoryEntry {
    return { label, values: cloneValues(this.values), valueSources: structuredClone(this.valueSources), tracks: structuredClone(this.tracks), snapshots: structuredClone(this.snapshots), activeSnapshotId: this.activeSnapshotId, loop: this.loop, loopRange: this.loopRange ? { ...this.loopRange } : null, duration: this.duration }
  }

  private sameAs(entry: HistoryEntry): boolean {
    return recordsEqual(entry.values, this.values) && JSON.stringify(entry.valueSources) === JSON.stringify(this.valueSources) && JSON.stringify(entry.tracks) === JSON.stringify(this.tracks) &&
      JSON.stringify(entry.snapshots) === JSON.stringify(this.snapshots) && entry.activeSnapshotId === this.activeSnapshotId &&
      entry.duration === this.duration && entry.loop === this.loop && JSON.stringify(entry.loopRange) === JSON.stringify(this.loopRange)
  }

  private restoreEntry(entry: HistoryEntry): void {
    this.playing = false
    this.stopClock()
    this.values = cloneValues(entry.values)
    this.valueSources = structuredClone(entry.valueSources)
    this.tracks = structuredClone(entry.tracks)
    this.snapshots = structuredClone(entry.snapshots)
    this.activeSnapshotId = entry.activeSnapshotId
    this.loop = entry.loop
    this.duration = entry.duration
    this.playhead = Math.min(this.playhead, this.duration)
    this.loopRange = entry.loopRange
    this.compare = 'current'
  }

  private pushPast(entry: HistoryEntry): void {
    this.past.push(entry)
    if (this.past.length > 100) { this.past.shift(); this.historyTrimmed = true }
  }

  private edit(label: string, apply: () => void): void {
    this.playing = false
    this.stopClock()
    this.compare = 'current'
    const before = this.gestureStart ? null : this.capture(label)
    apply()
    if (before && !this.sameAs(before)) {
      this.pushPast(before)
      this.future = []
      this.notice = label
    }
    this.emit()
  }

  private startClock(): void {
    this.stopClock()
    this.lastTick = performance.now()
    const tick = (now: number) => {
      if (!this.playing) return
      const delta = (now - this.lastTick) / 1000
      this.lastTick = now
      const next = this.playhead + delta
      if (!this.loop && next >= (this.loopRange?.end ?? this.duration)) {
        this.playhead = this.loopRange?.end ?? this.duration
        this.playing = false
        this.stopClock()
        this.emit()
        return
      }
      try {
        this.setPlayhead(next, true)
      } finally {
        if (this.playing) this.raf = requestAnimationFrame(tick)
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopClock(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private emitClock(): void {
    for (const listener of this.clockListeners) listener()
  }

  private emit(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
    this.emitClock()
  }
}

export function animationFrom(def: AnimationDef | undefined): Pick<SessionSnapshot, 'duration' | 'fps' | 'loop' | 'tracks'> {
  return {
    duration: def?.duration ?? 8,
    fps: def?.fps ?? 30,
    loop: def?.loop ?? true,
    tracks: structuredClone(def?.tracks ?? []),
  }
}

/** One sentence for a field whose value comes from a source rather than the hand. */
export function describeValueSource(source: ValueSource | undefined, parameters: ParameterDef[]): string | undefined {
  if (!source || source.mode === 'local') return undefined
  const name = (id?: string) => parameters.find((item) => item.id === id)?.label ?? id ?? 'a parameter'
  switch (source.mode) {
    case 'parameter': return `Follows ${name(source.source)}`
    case 'expression': return source.expression ? `Expression: ${source.expression}` : 'Driven by an expression'
    case 'animation': return 'Follows its timeline track'
    case 'macro': return `Macro from ${name(source.source)} · ${source.min} to ${source.max}`
    case 'modulation': return `Modulated · ${source.shape} at ${source.rate} Hz`
    case 'blend': return `Blend of ${name(source.source)} · ${source.from} to ${source.to}`
  }
}
