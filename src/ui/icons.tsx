import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  ArrowRight,
  Box,
  Camera,
  Check,
  ChevronDown,
  Code,
  Copy,
  Diamond,
  Download,
  FileText,
  LayoutGrid,
  Menu,
  Minus,
  PanelRight,
  Pause,
  Play,
  Plus,
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

export const IconGrid = glyph(LayoutGrid)
export const IconDiamond = glyph(Diamond)
export const IconCube = glyph(Box)
export const IconSliders = glyph(SlidersHorizontal)
export const IconCode = glyph(Code)
export const IconSearch = glyph(Search)
export const IconArrowRight = glyph(ArrowRight)
export const IconUndo = glyph(Undo2)
export const IconRedo = glyph(Redo2)
export const IconPlay = glyph(Play)
export const IconPause = glyph(Pause)
export const IconCheck = glyph(Check)
export const IconClose = glyph(X)
export const IconChevron = glyph(ChevronDown)
export const IconMenu = glyph(Menu)
export const IconMinus = glyph(Minus)
export const IconPlus = glyph(Plus)
export const IconReset = glyph(RotateCcw)
export const IconDownload = glyph(Download)
export const IconCopy = glyph(Copy)
export const IconKeyframe = glyph(Diamond)
export const IconDoc = glyph(FileText)
export const IconGear = glyph(Settings)
export const IconPanel = glyph(PanelRight)
export const IconSnapshot = glyph(Camera)
