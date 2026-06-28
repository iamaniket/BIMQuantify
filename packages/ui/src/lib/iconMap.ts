/**
 * Icon map — the single source of truth for every icon the app uses.
 *
 * Re-exports Phosphor icons under their legacy Lucide names so that
 * consumer packages (`portal`, `web`, `brand`) never import from
 * `@phosphor-icons/react` directly.
 *
 * Source names use Phosphor's non-deprecated `*Icon` exports (the bare
 * `Pulse`/`ArrowLeft`/… names are `@deprecated` in 2.1.x). The consumer-facing
 * alias on the right of `as` is unchanged, so importers are untouched.
 *
 * To add an icon: find it on https://phosphoricons.com, add a re-export here
 * using its `<Name>Icon` export.
 * To swap the underlying library: change only this file.
 */

/* ── A ──────────────────────────────────────────────────────────── */
export { PulseIcon as Activity } from '@phosphor-icons/react';
export { WarningCircleIcon as AlertCircle } from '@phosphor-icons/react';
export { WarningIcon as AlertTriangle } from '@phosphor-icons/react';
export { ArrowLeftIcon as ArrowLeft } from '@phosphor-icons/react';
export { ArrowRightIcon as ArrowRight } from '@phosphor-icons/react';
export { ArrowUpIcon as ArrowUp } from '@phosphor-icons/react';
export { ArrowDownIcon as ArrowDown } from '@phosphor-icons/react';
export { ArrowSquareOutIcon as ExternalLink } from '@phosphor-icons/react';
export { ArrowCounterClockwiseIcon as RotateCcw } from '@phosphor-icons/react';
export { ArrowClockwiseIcon as RotateCw } from '@phosphor-icons/react';
export { ArrowsClockwiseIcon as RefreshCw } from '@phosphor-icons/react';
export { ArrowsOutCardinalIcon as Move } from '@phosphor-icons/react';
export { TrophyIcon as Award } from '@phosphor-icons/react';

/* ── B ──────────────────────────────────────────────────────────── */
export { BellIcon as Bell } from '@phosphor-icons/react';
export { BlueprintIcon as Blueprint } from '@phosphor-icons/react';
export { BookOpenTextIcon as BookOpen } from '@phosphor-icons/react';
export { BoundingBoxIcon as BoundingBox } from '@phosphor-icons/react';
export { CubeIcon as Box } from '@phosphor-icons/react';
export { PackageIcon as Boxes } from '@phosphor-icons/react';
export { BuildingsIcon as Building2 } from '@phosphor-icons/react';
export { BuildingIcon as Building } from '@phosphor-icons/react';

/* ── C ──────────────────────────────────────────────────────────── */
export { CalendarBlankIcon as CalendarClock } from '@phosphor-icons/react';
export { CalendarIcon as CalendarDays } from '@phosphor-icons/react';
export { CameraIcon as Camera } from '@phosphor-icons/react';
export { CaretDownIcon } from '@phosphor-icons/react';
export { CaretDownIcon as ChevronDown } from '@phosphor-icons/react';
export { CaretLeftIcon as ChevronLeft } from '@phosphor-icons/react';
export { CaretRightIcon as ChevronRight } from '@phosphor-icons/react';
export { CaretUpIcon as ChevronUp } from '@phosphor-icons/react';
export { CaretDoubleUpIcon as ChevronsUp } from '@phosphor-icons/react';
export { CaretDoubleDownIcon as ChevronsDown } from '@phosphor-icons/react';
export { CaretDoubleLeftIcon as ChevronsLeft } from '@phosphor-icons/react';
export { CaretDoubleRightIcon as ChevronsRight } from '@phosphor-icons/react';
export { CheckIcon as Check } from '@phosphor-icons/react';
export { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react';
export { CheckCircleIcon as CheckCircle2 } from '@phosphor-icons/react';
export { ClipboardTextIcon as ClipboardCheck } from '@phosphor-icons/react';
export { ClockIcon as Clock } from '@phosphor-icons/react';
export { CloudArrowUpIcon as UploadCloud } from '@phosphor-icons/react';
export { ColumnsIcon as Columns3 } from '@phosphor-icons/react';
export { CopyIcon as Copy } from '@phosphor-icons/react';
export { CrosshairIcon as Crosshair } from '@phosphor-icons/react';
export { CursorIcon as MousePointer2 } from '@phosphor-icons/react';

/* ── D ──────────────────────────────────────────────────────────── */
export { CompassIcon as DraftingCompass } from '@phosphor-icons/react';
export { DotsThreeIcon as MoreHorizontal } from '@phosphor-icons/react';
export { DotsThreeVerticalIcon as MoreVertical } from '@phosphor-icons/react';
export { DownloadIcon as Download } from '@phosphor-icons/react';

/* ── E ──────────────────────────────────────────────────────────── */
export { EraserIcon as Eraser } from '@phosphor-icons/react';
export { EnvelopeIcon as Mail } from '@phosphor-icons/react';
export { EyeIcon as Eye } from '@phosphor-icons/react';
export { EyeSlashIcon as EyeOff } from '@phosphor-icons/react';

/* ── F ──────────────────────────────────────────────────────────── */
export { FileAudioIcon as FileAudio } from '@phosphor-icons/react';
export { FileDashedIcon as FileDashed } from '@phosphor-icons/react';
export { CertificateIcon as FileBadge } from '@phosphor-icons/react';
export { FileTextIcon as FileSignature } from '@phosphor-icons/react';
export { FileTextIcon as FileText } from '@phosphor-icons/react';
export { FileArrowUpIcon as FileUp } from '@phosphor-icons/react';
export { FileVideoIcon as FileVideo } from '@phosphor-icons/react';
export { FlagIcon as Flag } from '@phosphor-icons/react';
export { ArrowsDownUpIcon as FlipVertical } from '@phosphor-icons/react';
export { FrameCornersIcon as FrameCorners } from '@phosphor-icons/react';
export { KanbanIcon as FolderKanban } from '@phosphor-icons/react';
export { FolderOpenIcon as FolderOpen } from '@phosphor-icons/react';
export { FootprintsIcon as Footprints } from '@phosphor-icons/react';
export { FunnelIcon as ListFilter } from '@phosphor-icons/react';

/* ── G ──────────────────────────────────────────────────────────── */
export { EyeglassesIcon as Glasses } from '@phosphor-icons/react';
export { GlobeHemisphereWestIcon as Globe2 } from '@phosphor-icons/react';
export { GraduationCapIcon as GraduationCap } from '@phosphor-icons/react';
export { GearIcon as Settings } from '@phosphor-icons/react';

/* ── H ──────────────────────────────────────────────────────────── */
export { HammerIcon as Hammer } from '@phosphor-icons/react';
export { HashIcon as Hash } from '@phosphor-icons/react';
export { QuestionIcon as HelpCircle } from '@phosphor-icons/react';
export { HouseIcon as Home } from '@phosphor-icons/react';
export { HouseIcon as House } from '@phosphor-icons/react';

/* ── I ──────────────────────────────────────────────────────────── */
export { ImageIcon as Image } from '@phosphor-icons/react';
export { ImageSquareIcon as ImagePlus } from '@phosphor-icons/react';
export { TrayIcon as Inbox } from '@phosphor-icons/react';
export { InfoIcon as Info } from '@phosphor-icons/react';

/* ── K ──────────────────────────────────────────────────────────── */
export { KeyIcon as Key } from '@phosphor-icons/react';

/* ── L ──────────────────────────────────────────────────────────── */
export { StackIcon } from '@phosphor-icons/react';
export { StackIcon as Layers } from '@phosphor-icons/react';
export { SquaresFourIcon as LayoutGrid } from '@phosphor-icons/react';
export { BooksIcon as Library } from '@phosphor-icons/react';
export { LinkIcon as Link2 } from '@phosphor-icons/react';
export { LinkIcon } from '@phosphor-icons/react';
export { LinkBreakIcon as Unlink } from '@phosphor-icons/react';
export { TreeStructureIcon as ListTree } from '@phosphor-icons/react';
export { SpinnerGapIcon as Loader2 } from '@phosphor-icons/react';
export { LockIcon as Lock } from '@phosphor-icons/react';
export { SignOutIcon as LogOut } from '@phosphor-icons/react';

/* ── M ──────────────────────────────────────────────────────────── */
export { MagnifyingGlassIcon as Search } from '@phosphor-icons/react';
export { MagnifyingGlassMinusIcon as MagnifyingGlassMinus } from '@phosphor-icons/react';
export { MagnifyingGlassPlusIcon as MagnifyingGlassPlus } from '@phosphor-icons/react';
export { MapPinIcon as MapPin } from '@phosphor-icons/react';
export { MapTrifoldIcon as Map } from '@phosphor-icons/react';
export { ListIcon as Menu } from '@phosphor-icons/react';
export { ChatCircleIcon as MessageSquare } from '@phosphor-icons/react';
export { MicrophoneIcon as Mic } from '@phosphor-icons/react';
export { MinusIcon as Minus } from '@phosphor-icons/react';
export { MonitorIcon as Monitor } from '@phosphor-icons/react';
export { MoonIcon as Moon } from '@phosphor-icons/react';

/* ── N ──────────────────────────────────────────────────────────── */
export { NoteIcon as StickyNote } from '@phosphor-icons/react';

/* ── O ──────────────────────────────────────────────────────────── */
export { PlanetIcon as Orbit } from '@phosphor-icons/react';

/* ── P ──────────────────────────────────────────────────────────── */
export { PaperclipIcon as Paperclip } from '@phosphor-icons/react';
export { PauseIcon as Pause } from '@phosphor-icons/react';
export { PenNibIcon as PenLine } from '@phosphor-icons/react';
export { PencilSimpleIcon as Pencil } from '@phosphor-icons/react';
export { PlayIcon as Play } from '@phosphor-icons/react';
export { PlusIcon as Plus } from '@phosphor-icons/react';

/* ── R ──────────────────────────────────────────────────────────── */
export { RulerIcon as Ruler } from '@phosphor-icons/react';

/* ── S ──────────────────────────────────────────────────────────── */
export { ScalesIcon as Scale } from '@phosphor-icons/react';
export { ScanIcon as Scan } from '@phosphor-icons/react';
export { ShareNetworkIcon as Share2 } from '@phosphor-icons/react';
export { ShieldIcon as Shield } from '@phosphor-icons/react';
export { ShieldCheckIcon as ShieldCheck } from '@phosphor-icons/react';
export { SlidersHorizontalIcon as SlidersHorizontal } from '@phosphor-icons/react';
export { DeviceMobileIcon as Smartphone } from '@phosphor-icons/react';
export { SparkleIcon as Sparkles } from '@phosphor-icons/react';
export { SquareIcon as Square } from '@phosphor-icons/react';
export { SquareSplitHorizontalIcon as SquareSplitHorizontal } from '@phosphor-icons/react';
export { SunIcon as Sun } from '@phosphor-icons/react';

/* ── T ──────────────────────────────────────────────────────────── */
export { TableIcon as Table2 } from '@phosphor-icons/react';
export { TrashIcon as Trash2 } from '@phosphor-icons/react';
export { TruckIcon as Truck } from '@phosphor-icons/react';

/* ── U ──────────────────────────────────────────────────────────── */
export { UploadIcon as Upload } from '@phosphor-icons/react';
export { UserIcon as User } from '@phosphor-icons/react';
export { UserGearIcon as UserCog } from '@phosphor-icons/react';
export { UserPlusIcon as UserPlus } from '@phosphor-icons/react';
export { UserCircleIcon as UserRound } from '@phosphor-icons/react';
export { UsersIcon as Users } from '@phosphor-icons/react';

/* ── X ──────────────────────────────────────────────────────────── */
export { XIcon as X } from '@phosphor-icons/react';
export { XCircleIcon as XCircle } from '@phosphor-icons/react';

/* ── Type re-exports ────────────────────────────────────────────── */
export type { Icon as AppIcon, IconWeight } from '@phosphor-icons/react';
