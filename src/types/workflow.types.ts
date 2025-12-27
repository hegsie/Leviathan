/**
 * Workflow types for Git identity profiles and workflow support
 */

/**
 * Git identity profile for switching between different identities
 */
export interface GitProfile {
  /** Unique identifier for the profile */
  id: string;
  /** Display name (e.g., "Work", "Personal") */
  name: string;
  /** Git user.name value */
  gitName: string;
  /** Git user.email value */
  gitEmail: string;
  /** Optional GPG signing key ID */
  signingKey: string | null;
  /** URL patterns for auto-detection (e.g., "github.com/mycompany/*") */
  urlPatterns: string[];
  /** Whether this is the default profile */
  isDefault: boolean;
  /** Optional color for UI display */
  color: string | null;
}

/**
 * Configuration for storing profiles
 */
export interface ProfilesConfig {
  /** All saved profiles */
  profiles: GitProfile[];
  /** Repository to profile assignments (repo path -> profile id) */
  repositoryAssignments: Record<string, string>;
}

/**
 * Git Flow configuration for a repository
 */
export interface GitFlowConfig {
  /** Whether Git Flow is initialized */
  initialized: boolean;
  /** Main branch name (e.g., "main" or "master") */
  mainBranch: string;
  /** Development branch name (e.g., "develop") */
  developBranch: string;
  /** Feature branch prefix (e.g., "feature/") */
  featurePrefix: string;
  /** Release branch prefix (e.g., "release/") */
  releasePrefix: string;
  /** Hotfix branch prefix (e.g., "hotfix/") */
  hotfixPrefix: string;
  /** Version tag prefix (e.g., "v") */
  versionTagPrefix: string;
}

/**
 * Git Flow branch type
 */
export type GitFlowBranchType =
  | 'main'
  | 'develop'
  | 'feature'
  | 'release'
  | 'hotfix'
  | 'other';

/**
 * A step in a Git Flow operation
 */
export interface GitFlowOperationStep {
  /** Description of the step */
  description: string;
  /** Git command that will be executed */
  command: string;
  /** Whether this step is optional */
  optional: boolean;
}

/**
 * Preview of a Git Flow operation
 */
export interface GitFlowOperationPlan {
  /** Operation type (e.g., "start_feature", "finish_release") */
  operation: string;
  /** Branch name involved */
  branchName: string;
  /** Steps that will be executed */
  steps: GitFlowOperationStep[];
  /** Warnings about the operation */
  warnings: string[];
}

/**
 * Branch age status for trunk-based development
 */
export type BranchAgeStatus = 'ok' | 'warning' | 'critical';

/**
 * Branch age information for trunk-based development
 */
export interface BranchAgeInfo {
  /** Branch name */
  branchName: string;
  /** Age in hours since creation/last commit */
  ageHours: number;
  /** Status based on age */
  status: BranchAgeStatus;
}

/**
 * Default Git Flow configuration
 */
export const DEFAULT_GITFLOW_CONFIG: GitFlowConfig = {
  initialized: false,
  mainBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  versionTagPrefix: 'v',
};

/**
 * Create a new empty profile
 */
export function createEmptyProfile(): Omit<GitProfile, 'id'> {
  return {
    name: '',
    gitName: '',
    gitEmail: '',
    signingKey: null,
    urlPatterns: [],
    isDefault: false,
    color: null,
  };
}

/**
 * Profile colors for UI display
 */
export const PROFILE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
] as const;
