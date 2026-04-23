/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TemplateType = 'tiktok' | 'reels' | 'shorts' | 'none';

export type UserTier = 'free' | 'pro' | 'unlimited';

export interface UserSubscription {
  tier: UserTier;
  credits: number; // in minutes
  maxCredits: number;
  renewsAt?: number;
  isAnnual?: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  createdAt?: number;
  subscription: UserSubscription;
}

export interface VideoProject {
  id: string;
  userId?: string;
  name: string;
  originalPath: string;
  thumbnailUrl?: string;
  duration: number;
  createdAt: number;
  clips: VideoClip[];
  activeTemplate: TemplateType;
}

export interface VideoClip {
  id: string;
  startTime: number; // in seconds
  endTime: number;
  transcript?: string;
  viralScore: number;
  title: string;
  isVertical: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  outputPath?: string;
}

export interface ProcessingProgress {
  projectId: string;
  clipId?: string;
  percent: number;
  message: string;
}
