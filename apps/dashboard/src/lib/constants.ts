import {
  LayoutDashboard,
  Box,
  Radar,
  Radio,
  Package,
  ClipboardList,
  AlertTriangle,
  Shield,
  ScrollText,
  MessageSquare,
  Play,
  Timer,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Apps", path: "/apps", icon: Box },
  { label: "Discovered", path: "/discovered-apps", icon: Radar },
  { label: "Sources", path: "/sources", icon: Radio },
  { label: "Releases", path: "/releases", icon: Package },
  { label: "Review Queue", path: "/review-queue", icon: ClipboardList },
  { label: "Job Failures", path: "/job-failures", icon: AlertTriangle },
  { label: "Overrides", path: "/overrides", icon: Shield },
  { label: "Audit Log", path: "/audit-log", icon: ScrollText },
  { label: "Feedback", path: "/feedback", icon: MessageSquare },
  { label: "Executions", path: "/executions", icon: Play },
  { label: "Jobs", path: "/jobs", icon: Timer },
];

const SUCCESS = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400";
const WARNING = "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400";
const DANGER = "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400";
const INFO = "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400";
const PURPLE = "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-400";
const NEUTRAL = "bg-zinc-100 text-zinc-800 dark:bg-zinc-700/50 dark:text-zinc-300";

export const statusColors: Record<string, string> = {
  active: SUCCESS,
  success: SUCCESS,
  resolved: SUCCESS,
  stable: SUCCESS,
  up_to_date: SUCCESS,
  green: SUCCESS,
  verified: SUCCESS,
  assisted_replace: SUCCESS,
  completed: SUCCESS,

  deprecated: WARNING,
  paused: WARNING,
  pending: WARNING,
  retrying: WARNING,
  draft: WARNING,
  ambiguous: WARNING,
  yellow: WARNING,
  publication_gated: WARNING,
  triaged: WARNING,

  error: DANGER,
  open: DANGER,
  retracted: DANGER,
  red: DANGER,
  failed: DANGER,

  merged: INFO,
  in_progress: INFO,
  running: INFO,
  beta: INFO,
  update_available: INFO,
  provisional: INFO,
  new: INFO,
  assisted_download: INFO,
  initiated: INFO,

  nightly: PURPLE,
  automation_candidate: PURPLE,

  unlisted: NEUTRAL,
  disabled: NEUTRAL,
  dismissed: NEUTRAL,
  abandoned: NEUTRAL,
  superseded: NEUTRAL,
  unknown: NEUTRAL,
  unsupported: NEUTRAL,
  ignored: NEUTRAL,
  unverified: NEUTRAL,
  notify_only: NEUTRAL,
  cancelled: NEUTRAL,
};

export const statusLabels: Record<string, string> = {
  active: "Active",
  deprecated: "Deprecated",
  merged: "Merged",
  unlisted: "Unlisted",
  paused: "Paused",
  disabled: "Disabled",
  error: "Error",
  success: "Success",
  pending: "Pending",
  in_progress: "In Progress",
  running: "Running",
  resolved: "Resolved",
  dismissed: "Dismissed",
  open: "Open",
  retrying: "Retrying",
  abandoned: "Abandoned",
  stable: "Stable",
  beta: "Beta",
  nightly: "Nightly",
  retracted: "Retracted",
  superseded: "Superseded",
  draft: "Draft",
  unknown: "Unknown",
  up_to_date: "Up to Date",
  update_available: "Update Available",
  ambiguous: "Ambiguous",
  unsupported: "Unsupported",
  ignored: "Ignored",
  not_modified: "Not Modified",
  timeout: "Timeout",
  partial: "Partial",
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  verified: "Verified",
  provisional: "Provisional",
  unverified: "Unverified",
  publication_gated: "Publication Gated",
  new: "New",
  triaged: "Triaged",
  notify_only: "Notify Only",
  assisted_download: "Assisted Download",
  assisted_replace: "Assisted Replace",
  automation_candidate: "Automation Candidate",
  initiated: "Initiated",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
