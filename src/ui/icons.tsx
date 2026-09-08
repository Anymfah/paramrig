import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Activity,
  AudioWaveform,
  Save,
  ArrowRight,
  Dices,
  GripVertical,
  Link2,
  Hand,
  ZoomIn,
  Ruler,
  Spline,
  Box,
  Camera,
  ClipboardPaste,
  Trash2,
  Type,
  Frame,
  Command,
  Crosshair,
  Minus as LineGlyph,
  Star,
  Scissors,
  Maximize,
  SquareDashed,
  Repeat2,
  SkipBack,
  MoreHorizontal,
  EyeOff,
  Eye,
  Circle,
  MousePointer2,
  Square,
  BringToFront,
  SendToBack,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Code,
  Copy,
  Diamond,
  Download,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  ListRestart,
  Maximize2,
  Menu,
  Minus,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Pause,
  Pencil,
  Pentagon,
  Play,
  Plus,
  Pipette,
  Redo2,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react'

export type IconProps = LucideProps

function glyph(Icon: LucideIcon) {
  function Glyph(props: LucideProps) {
    return <Icon aria-hidden size={16} strokeWidth={1.5} {...props} />
  }
  Glyph.displayName = Icon.displayName
  return Glyph
}

export const IconPipette = glyph(Pipette)
export const IconGrid = glyph(LayoutGrid)
export const IconDiamond = glyph(Diamond)
export const IconCube = glyph(Box)
export const IconWave = glyph(AudioWaveform)
export const IconSave = glyph(Save)
export const IconSliders = glyph(SlidersHorizontal)
export const IconCode = glyph(Code)
export const IconSearch = glyph(Search)
export const IconArrowRight = glyph(ArrowRight)
export const IconUndo = glyph(Undo2)
export const IconRedo = glyph(Redo2)
export const IconPlay = glyph(Play)
export const IconPause = glyph(Pause)
export const IconPencil = glyph(Pencil)
export const IconCheck = glyph(Check)
export const IconClose = glyph(X)
export const IconChevron = glyph(ChevronDown)
export const IconChevronUp = glyph(ChevronUp)
export const IconChevronRight = glyph(ChevronRight)
export const IconFolder = glyph(Folder)
export const IconFolderOpen = glyph(FolderOpen)
export const IconMenu = glyph(Menu)
export const IconExpand = glyph(Maximize2)
export const IconMinus = glyph(Minus)
export const IconPlus = glyph(Plus)
export const IconReset = glyph(RotateCcw)
export const IconResetSection = glyph(ListRestart)
export const IconDownload = glyph(Download)
export const IconCopy = glyph(Copy)
export const IconKeyframe = glyph(Diamond)
export const IconDoc = glyph(FileText)
export const IconGear = glyph(Settings)
export const IconPanel = glyph(PanelRight)
export const IconPanelLeft = glyph(PanelLeft)
export const IconPanelLeftClose = glyph(PanelLeftClose)
export const IconSnapshot = glyph(Camera)
export const IconText = glyph(Type)
export const IconFrame = glyph(Frame)
export const IconCommand = glyph(Command)
export const IconScreenPick = glyph(Crosshair)
export const IconLine = glyph(LineGlyph)
export const IconPolygon = glyph(Pentagon)
export const IconStar = glyph(Star)
export const IconScissors = glyph(Scissors)
export const IconScale = glyph(Maximize)
export const IconHand = glyph(Hand)
export const IconZoomTool = glyph(ZoomIn)
export const IconRuler = glyph(Ruler)
export const IconWidth = glyph(Spline)
export const IconMask = glyph(SquareDashed)

export const IconPaste = glyph(ClipboardPaste)
export const IconTrash = glyph(Trash2)
export const IconLoop = glyph(Repeat2)
export const IconStart = glyph(SkipBack)
export const IconMore = glyph(MoreHorizontal)
export const IconEyeOff = glyph(EyeOff)
export const IconEye = glyph(Eye)
export const IconEllipse = glyph(Circle)
export const IconSelect = glyph(MousePointer2)
export function IconTransformSelect(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 3.5 16.5 11l-5.1 1.2L8.5 17Z" />
      <path d="M15 17.5h6M18 14.5v6" />
    </svg>
  )
}
export const IconRectangle = glyph(Square)
export const IconBringForward = glyph(BringToFront)
export const IconSendBackward = glyph(SendToBack)

export function IconPen(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 19 7-7 3 3-7 7-3-3Z" />
      <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5Z" />
      <path d="m2 2 7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  )
}

export function IconNode(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 19c2-9 8-13 14-14" />
      <rect x="3" y="17" width="4" height="4" />
      <rect x="17" y="3" width="4" height="4" />
      <path d="M9 9.5 14.5 4" />
      <circle cx="8.5" cy="10" r="1.25" />
      <circle cx="15" cy="3.5" r="1.25" />
    </svg>
  )
}

export function IconNone(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m6.5 17.5 11-11" />
    </svg>
  )
}

export function IconLock(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function IconUnlock(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </svg>
  )
}

export function IconGroup(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
      <circle cx="15" cy="15" r="3" />
    </svg>
  )
}

export function IconUngroup(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <circle cx="16.5" cy="16.5" r="4.5" />
      <path d="m13 11 2 2" strokeDasharray="1.5 2" />
    </svg>
  )
}

export function IconAlignLeft(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="12" height="4" rx="1" />
      <rect x="7" y="14" width="7" height="4" rx="1" />
    </svg>
  )
}

export function IconAlignCenterH(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v3M12 10v4M12 18v3" />
      <rect x="5" y="6" width="14" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="4" rx="1" />
    </svg>
  )
}

export function IconAlignRight(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 3v18" />
      <rect x="5" y="6" width="12" height="4" rx="1" />
      <rect x="10" y="14" width="7" height="4" rx="1" />
    </svg>
  )
}

export function IconAlignTop(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="12" rx="1" />
      <rect x="14" y="7" width="4" height="7" rx="1" />
    </svg>
  )
}

export function IconAlignCenterV(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12h3M10 12h4M18 12h3" />
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="8" width="4" height="8" rx="1" />
    </svg>
  )
}

export function IconAlignBottom(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 20h18" />
      <rect x="6" y="5" width="4" height="12" rx="1" />
      <rect x="14" y="10" width="4" height="7" rx="1" />
    </svg>
  )
}

export function IconDistributeH(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 4v16M21 4v16" />
      <rect x="7" y="8" width="3" height="8" rx="1" />
      <rect x="14" y="8" width="3" height="8" rx="1" />
    </svg>
  )
}

export function IconDistributeV(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 3h16M4 21h16" />
      <rect x="8" y="7" width="8" height="3" rx="1" />
      <rect x="8" y="14" width="8" height="3" rx="1" />
    </svg>
  )
}

export function IconPath(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 18c0-8 5-12 16-12" />
      <rect x="2" y="16" width="4" height="4" />
      <rect x="18" y="4" width="4" height="4" />
    </svg>
  )
}

export function IconFolderLayer(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <rect x="11" y="11" width="10" height="10" rx="1.5" />
    </svg>
  )
}

export function IconPencilTool(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 20c3-1 4-2 5-4l9-9a2.1 2.1 0 0 0-3-3l-9 9c-2 1-3 2-4 5Z" />
      <path d="m13.5 6.5 4 4" />
      <path d="M4 20c2-6 6-9 11-13" strokeDasharray="1 2.5" opacity="0.6" />
    </svg>
  )
}

export function IconLasso(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 22a5 5 0 0 1-2-4" />
      <path d="M7 16.93c.96.43 1.96.74 2.99.91" />
      <path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8a7.19 7.19 0 0 1-.33 2" />
      <path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M14.33 22h-.09a.35.35 0 0 1-.24-.32v-10a.34.34 0 0 1 .33-.34c.08 0 .15.03.21.08l7.34 6a.33.33 0 0 1-.21.59h-4.49l-2.57 3.85a.35.35 0 0 1-.28.14z" />
    </svg>
  )
}

export function IconFlipH(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M9 7 4 12l5 5V7Z" />
      <path d="m15 7 5 5-5 5V7Z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  )
}

export function IconFlipV(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12h18" strokeDasharray="2 2" />
      <path d="M7 9l5-5 5 5H7Z" />
      <path d="m7 15 5 5 5-5H7Z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  )
}

export function IconRotate90(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  )
}

export function IconImport(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M12 4v11" />
      <path d="m7 10 5-5 5 5" />
    </svg>
  )
}

export function IconBucket(props: LucideProps) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
      <path d="m5 2 5 5" />
      <path d="M2 13h15" />
      <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
    </svg>
  )
}

export function IconDice(props: LucideProps) {
  return <Dices aria-hidden size={16} strokeWidth={1.5} {...props} />
}
export function IconLink(props: LucideProps) {
  return <Link2 aria-hidden size={16} strokeWidth={1.5} {...props} />
}
export function IconDriven(props: LucideProps) {
  return <Activity aria-hidden size={14} strokeWidth={1.75} {...props} />
}
export function IconGrip(props: LucideProps) {
  return <GripVertical aria-hidden size={16} strokeWidth={1.5} {...props} />
}
