import type {
  AnimTrack,
  AnimationDef,
  ExportDocument,
  ParamValue,
  ParameterDef,
  RigManifest,
  Snapshot,
  StoredDraft,
} from '@/rigs/types'
import {
  changedKeys,
  cloneValue,
  cloneValues,
  interpolateNumber,
  recordsEqual,
  upsertKeyframe,
} from '@/state/values'

export type CompareMode = 'original' | 'current'

export type SessionSnapshot = {
  values: Record<string, ParamValue>
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
}

type Listener = () => void

type HistoryEntry = {
  values: Record<string, ParamValue>
  tracks: AnimTrack[]
}

function defaultsFrom(parameters: ParameterDef[]): Record<string, ParamValue> {
  const next: Record<string, ParamValue> = {}
  for (const param of parameters) next[param.id] = cloneValue(param.defaultValue)
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
    if (param.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      next[param.id] = value
    } else if (param.kind === 'color' && typeof value === 'string') {
      next[param.id] = value
    } else if (param.kind === 'select' && typeof value === 'string') {
      next[param.id] = value
    } else if (param.kind === 'switch' && typeof value === 'boolean') {
      next[param.id] = value
    } else if (param.kind === 'curve' && value && typeof value === 'object' && !Array.isArray(value)) {
      next[param.id] = cloneValue(value)
    } else if (param.kind === 'gradient' && Array.isArray(value)) {
      next[param.id] = cloneValue(value)
    }
  }
  return next
}

export class RigSession {
  readonly rigId: string
  readonly name: string
  readonly parameters: ParameterDef[]
  readonly defaults: Record<string, ParamValue>
  private values: Record<string, ParamValue>
  private snapshots: Snapshot[]
  private compare: CompareMode
  private activeSnapshotId: string | null
  private playhead: number
  private playing: boolean
  private loop: boolean
  private duration: number
  private fps: number
  private tracks: AnimTrack[]
  private readonly initialTracks: AnimTrack[]
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private gestureStart: HistoryEntry | null = null
  private listeners = new Set<Listener>()
  private clockListeners = new Set<Listener>()
  private revision = 0
  private raf = 0
  private lastTick = 0

  constructor(manifest: RigManifest, stored?: StoredDraft | null) {
    this.rigId = manifest.id
    this.name = manifest.name
    this.parameters = manifest.parameters
    this.defaults = defaultsFrom(manifest.parameters)
    this.values = sanitizeValues(manifest.parameters, stored?.values)
    this.snapshots = Array.isArray(stored?.snapshots) ? stored.snapshots.map((item) => structuredClone(item)) : []
    this.compare = stored?.compare === 'original' ? 'original' : 'current'
    this.activeSnapshotId = stored?.activeSnapshotId ?? this.snapshots[0]?.id ?? null
    this.playhead = typeof stored?.playhead === 'number' ? stored.playhead : 0
    this.playing = false
    this.loop = stored?.loop ?? manifest.animation?.loop ?? true
    this.duration = manifest.animation?.duration ?? 8
    this.fps = manifest.animation?.fps ?? 30
    this.initialTracks = structuredClone(manifest.animation?.tracks ?? [])
    this.tracks = structuredClone(stored?.tracks ?? this.initialTracks)
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

  liveNumber(id: string, fallback = 0): number {
    const track = this.trackFor(id)
    if (track) return interpolateNumber(track, this.playhead, this.duration, this.loop)
    const value = this.values[id]
    return typeof value === 'number' ? value : fallback
  }

  previewNumber(id: string, fallback = 0): number {
    if (this.compare === 'original') {
      const value = this.baselineValues()[id]
      return typeof value === 'number' ? value : fallback
    }
    return this.liveNumber(id, fallback)
  }

  getSnapshot = (): SessionSnapshot => ({
    values: this.viewValues(),
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
      next[track.paramId] = interpolateNumber(track, playhead, this.duration, this.loop)
    }
    return next
  }

  previewValues(): Record<string, ParamValue> {
    if (this.compare === 'original') return this.baselineValues()
    return this.viewValues()
  }

  baselineValues(): Record<string, ParamValue> {
    const snapshot = this.snapshots.find((item) => item.id === this.activeSnapshotId)
    return snapshot ? cloneValues(snapshot.values) : cloneValues(this.defaults)
  }

  baselineTracks(): AnimTrack[] {
    const snapshot = this.snapshots.find((item) => item.id === this.activeSnapshotId)
    if (snapshot?.tracks) return structuredClone(snapshot.tracks)
    return structuredClone(this.initialTracks)
  }

  beginGesture(): void {
    if (this.gestureStart) return
    this.gestureStart = this.capture()
    this.emit()
  }

  endGesture(): void {
    if (!this.gestureStart) return
    if (!this.sameAs(this.gestureStart)) {
      this.past.push(this.gestureStart)
      this.future = []
    }
    this.gestureStart = null
    this.emit()
  }

  setValue(id: string, value: ParamValue): void {
    const param = this.parameters.find((item) => item.id === id)
    if (!param) return
    const track = this.tracks.find((item) => item.paramId === id)
    if (track && typeof value === 'number') {
      this.replaceTracks(this.tracks.map((item) => (item.paramId === id ? upsertKeyframe(item, this.playhead, value) : item)))
      return
    }
    if (this.gestureStart) {
      this.values = { ...this.values, [id]: cloneValue(value) }
      this.emit()
      return
    }
    this.commit({ ...this.values, [id]: cloneValue(value) })
  }

  resetParam(id: string): void {
    const param = this.parameters.find((item) => item.id === id)
    if (!param) return
    this.setValue(id, param.defaultValue)
  }

  resetAll(): void {
    this.commit(cloneValues(this.defaults))
  }

  undo(): void {
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(this.capture())
    this.values = previous.values
    this.tracks = previous.tracks
    this.emit()
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.capture())
    this.values = next.values
    this.tracks = next.tracks
    this.emit()
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  captureSnapshot(name: string): Snapshot {
    const snapshot: Snapshot = {
      id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: new Date().toISOString(),
      values: cloneValues(this.values),
      tracks: structuredClone(this.tracks),
    }
    this.snapshots = [...this.snapshots, snapshot]
    this.activeSnapshotId = snapshot.id
    this.emit()
    return snapshot
  }

  restoreSnapshot(id: string): void {
    const snapshot = this.snapshots.find((item) => item.id === id)
    if (!snapshot) return
    this.activeSnapshotId = id
    this.past.push(this.capture())
    this.future = []
    this.values = cloneValues(snapshot.values)
    if (snapshot.tracks) this.tracks = structuredClone(snapshot.tracks)
    this.emit()
  }

  setCompare(mode: CompareMode): void {
    if (this.compare === mode) return
    this.compare = mode
    this.emit()
  }

  setPlayhead(time: number, fromPlayback = false): void {
    const wrapped = this.loop
      ? ((time % this.duration) + this.duration) % this.duration
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

  setLoop(loop: boolean): void {
    this.loop = loop
    this.emit()
  }

  setTrackInterpolation(paramId: string, interpolation: AnimTrack['interpolation']): void {
    this.replaceTracks(this.tracks.map((track) => (track.paramId === paramId ? { ...track, interpolation } : track)))
  }

  changedSinceBaseline(): string[] {
    const keys = changedKeys(this.values, this.baselineValues())
    const baseline = this.baselineTracks()
    for (const track of this.tracks) {
      const origin = baseline.find((item) => item.paramId === track.paramId)
      if (JSON.stringify(track) !== JSON.stringify(origin) && !keys.includes(track.paramId)) {
        keys.push(track.paramId)
      }
    }
    return keys
  }

  toExport(): ExportDocument {
    const animation = this.tracks.length
      ? {
          duration: this.duration,
          fps: this.fps,
          loop: this.loop,
          playhead: this.playhead,
          tracks: structuredClone(this.tracks),
        }
      : undefined
    return {
      version: 1,
      rigId: this.rigId,
      name: this.name,
      exportedAt: new Date().toISOString(),
      values: this.viewValues(),
      ...(animation ? { animation } : {}),
    }
  }

  toDraft(): StoredDraft {
    return {
      version: 1,
      rigId: this.rigId,
      values: cloneValues(this.values),
      snapshots: structuredClone(this.snapshots),
      compare: this.compare,
      activeSnapshotId: this.activeSnapshotId,
      playhead: this.playhead,
      loop: this.loop,
      tracks: structuredClone(this.tracks),
    }
  }

  private capture(): HistoryEntry {
    return { values: cloneValues(this.values), tracks: structuredClone(this.tracks) }
  }

  private sameAs(entry: HistoryEntry): boolean {
    return recordsEqual(entry.values, this.values) && JSON.stringify(entry.tracks) === JSON.stringify(this.tracks)
  }

  private replaceTracks(tracks: AnimTrack[]): void {
    if (this.gestureStart) {
      this.tracks = tracks
      this.emit()
      return
    }
    if (JSON.stringify(this.tracks) === JSON.stringify(tracks)) return
    this.past.push(this.capture())
    this.future = []
    this.tracks = tracks
    this.emit()
  }

  private commit(next: Record<string, ParamValue>): void {
    if (recordsEqual(this.values, next)) return
    this.past.push(this.capture())
    this.future = []
    this.values = next
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
      if (!this.loop && next >= this.duration) {
        this.playhead = this.duration
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
