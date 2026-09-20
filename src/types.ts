export type PlatformTarget = 'darwin' | 'win32' | 'linux';
export type SortMode = 'natural_path' | 'alphabetic_path' | 'name_only' | 'folder_then_name';

export type RenameRule =
  | NewNameRule
  | CustomRule
  | FindReplaceRule
  | PrefixSuffixRule
  | CaseTransformRule
  | TrimTextRule
  | RemoveTextRule
  | SequenceInsertRule
  | LetterSequenceInsertRule
  | DateTimeRule
  | ExtensionHandlingRule;

export interface BaseRule {
  id: string;
  enabled: boolean;
  label?: string;
}

export interface NewNameRule extends BaseRule {
  type: 'new_name';
  template: string;
  reverseSequence?: boolean;
}

export interface CustomRule extends BaseRule {
  type: 'custom_rule';
  expression: string;
}

export interface FindReplaceRule extends BaseRule {
  type: 'find_replace';
  find: string;
  replace: string;
  matchCase: boolean;
  useRegex: boolean;
  replaceAll: boolean;
}

export interface PrefixSuffixRule extends BaseRule {
  type: 'prefix_suffix';
  prefix: string;
  suffix: string;
}

export interface CaseTransformRule extends BaseRule {
  type: 'case_transform';
  mode: 'lower' | 'upper' | 'title' | 'sentence' | 'camel' | 'pascal' | 'kebab' | 'snake';
}

export interface TrimTextRule extends BaseRule {
  type: 'trim_text';
  mode:
    | 'trim'
    | 'trim_start'
    | 'trim_end'
    | 'collapse_spaces'
    | 'remove_spaces'
    | 'remove_dashes'
    | 'remove_underscores';
}

export interface RemoveTextRule extends BaseRule {
  type: 'remove_text';
  text: string;
  matchCase: boolean;
}

export interface SequenceInsertRule extends BaseRule {
  type: 'sequence_insert';
  position: 'prefix' | 'suffix' | 'before_extension';
  start: number;
  step: number;
  padWidth: number;
  separator: string;
}

export interface LetterSequenceInsertRule extends BaseRule {
  type: 'letter_sequence_insert';
  position: 'prefix' | 'suffix' | 'before_extension';
  start: number;
  step: number;
  casing: 'upper' | 'lower';
  separator: string;
}

export interface DateTimeRule extends BaseRule {
  type: 'date_time';
  position: 'prefix' | 'suffix' | 'before_extension';
  format: string;
  separator: string;
}

export interface ExtensionHandlingRule extends BaseRule {
  type: 'extension_handling';
  mode: 'keep' | 'lowercase' | 'uppercase' | 'replace' | 'remove';
  replacement: string;
}

export interface SourceSelection {
  path: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}

export interface DirectoryListing {
  sourcePath: string;
  directChildren: number;
  recursiveChildren: number;
  items: SourceSelection[];
}

export type SourceMode =
  | 'picked_folders'
  | 'picked_files'
  | 'top_level_folders'
  | 'subfolders'
  | 'top_level_files'
  | 'files_recursive';

export interface PickSourcesRequest {
  mode: SourceMode;
}

export interface PreviewRequest {
  sourcePaths: string[];
  sourceMode: SourceMode;
  fileNamePattern: string;
  sortMode: SortMode;
  rules: RenameRule[];
  platform: PlatformTarget;
}

export interface PreviewRow {
  id: string;
  sourcePath: string;
  nextPath: string;
  originalName: string;
  proposedName: string;
  directoryPath: string;
  finalDirectoryPath: string;
  pathContext: string;
  isDirectory: boolean;
  changed: boolean;
  status: 'ok' | 'conflict' | 'invalid' | 'unchanged';
  reasons: string[];
}

export interface PreviewSummary {
  total: number;
  changed: number;
  ok: number;
  conflict: number;
  invalid: number;
  unchanged: number;
  blocked: boolean;
}

export interface PreviewResult {
  rows: PreviewRow[];
  summary: PreviewSummary;
}

export interface ExecuteRenameBatchRequest extends PreviewRequest {}

export interface ExecuteRenameBatchResult extends PreviewResult {
  batchId: number | null;
  renamedCount: number;
  blocked: boolean;
  errors: string[];
}

export interface UndoRenameBatchRequest {
  batchId: number;
}

export interface UndoRenameBatchResult {
  batchId: number;
  restoredCount: number;
  success: boolean;
  errors: string[];
}

export interface Preset {
  id: number;
  name: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  rules: RenameRule[];
}

export interface RenameBatchRecord {
  sourcePath: string;
  targetPath: string;
  isDirectory: boolean;
}

export interface HistoryEntry {
  id: number;
  createdAt: string;
  renamedCount: number;
  sourceRoots: string[];
  rules: RenameRule[];
  previewSummary: PreviewSummary;
  canUndo: boolean;
  undoState: 'ready' | 'archived' | 'overlap' | 'missing' | 'occupied';
  undoReason?: string;
}

export interface ResolvedRenameItem {
  sourcePath: string;
  name: string;
  parentPath: string;
  isDirectory: boolean;
}
