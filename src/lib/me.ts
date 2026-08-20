import { toIso } from '@/lib/serialize';

export type MePayload = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  emailVerifiedAt: Date | null;
  onboardingCompleted: boolean;
  role: string;
  usernameColor: string | null;
  avatarFrame: string | null;
  level: number;
  isOnline: boolean;
  gender: string | null;
  showGender: boolean;
  stickers: string[];
  interests: string[];
  socialLinks: unknown;
  voiceBioUrl: string | null;
  hasPaymentPassword: boolean;
  availability: unknown;
  createdAt: Date;
  _count: { followers: number; following: number };
};

export function serializeMe(user: MePayload) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName ?? user.username,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    bio: user.bio,
    emailVerifiedAt: toIso(user.emailVerifiedAt),
    onboardingCompleted: user.onboardingCompleted,
    role: user.role,
    usernameColor: user.usernameColor,
    avatarFrame: user.avatarFrame,
    level: user.level,
    isOnline: user.isOnline,
    gender: user.gender,
    showGender: user.showGender,
    stickers: user.stickers,
    interests: user.interests,
    socialLinks: user.socialLinks,
    voiceBioUrl: user.voiceBioUrl,
    hasPaymentPassword: user.hasPaymentPassword,
    availability: user.availability,
    createdAt: toIso(user.createdAt),
    isFollowing: false,
    followersCount: user._count?.followers ?? 0,
    followingCount: user._count?.following ?? 0,
  };
}

export const meSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bannerUrl: true,
  bio: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  role: true,
  usernameColor: true,
  avatarFrame: true,
  level: true,
  isOnline: true,
  gender: true,
  showGender: true,
  stickers: true,
  interests: true,
  socialLinks: true,
  voiceBioUrl: true,
  hasPaymentPassword: true,
  availability: true,
  createdAt: true,
  _count: { select: { followers: true, following: true } },
} as const;
