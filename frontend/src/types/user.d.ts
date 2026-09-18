export {};

export interface IUser {
  id: number;
  username: string;
  password: string;
  scope: string;
  locale: string;
  perm: Permissions;
  commands: string[];
  rules: IRule[];
  lockPassword: boolean;
  hideDotfiles: boolean;
  singleClick: boolean;
  redirectAfterCopyMove: boolean;
  dateFormat: boolean;
  viewMode: ViewModeType;
  sorting?: Sorting;
  aceEditorTheme: string;
  sidebarPreferences?: string;
  listingPreferences?: ListingPreferences;
  playerPreferences?: PlayerPreferences;
}

export type ViewModeType =
  | "mosaic"
  | "compact-grid"
  | "details"
  | "compact-list";

export interface Permissions {
  admin: boolean;
  copy: boolean;
  create: boolean;
  delete: boolean;
  download: boolean;
  execute: boolean;
  modify: boolean;
  move: boolean;
  rename: boolean;
  share: boolean;
  shell: boolean;
  upload: boolean;
}

export interface Sorting {
  by: string;
  asc: boolean;
}

export interface PrefixRule {
  prefix: string;
  visible: boolean;
  expanded: boolean;
  order: number;
}

export interface ListingPreferences {
  version: number;
  prefixRules: PrefixRule[];
}

export interface PlayerPreferences {
  /** nil/undefined = default 4s; 0 = never hide; 1-20 = seconds */
  controlsTimeoutSec?: number | null;
}

interface IRule {
  allow: boolean;
  path: string;
  regex: boolean;
  regexp: IRegexp;
}

interface IRegexp {
  raw: string;
}

export type UserTheme = "light" | "dark" | "";
