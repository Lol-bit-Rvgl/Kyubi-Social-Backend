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
  themeSettings?: unknown;
  availability: unknown;
  createdAt: Date;
  _count: { followers: number; following: number; visitsReceived?: number };
};

export function serializeMe(user: MePayload) {
  let themeSettings = (user as any).themeSettings;
  if (typeof themeSettings === 'string') {
    try {
      themeSettings = JSON.parse(themeSettings);
    } catch {
      themeSettings = null;
    }
  }
  if (!themeSettings || typeof themeSettings !== 'object') {
    themeSettings = {
      primaryColor: '#BA68C8',
      accentColor: '#00E676',
      glassStyle: 'frosted',
    };
  }

  const visitsCount = user._count?.visitsReceived ?? 0;

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
    themeSettings,
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
    profileViews: visitsCount,
    visitorsCount: visitsCount,
    extensions: {
      profileViews: visitsCount,
      visitorsCount: visitsCount,
    },
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
  themeSettings: true,
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
  _count: { select: { followers: true, following: true, visitsReceived: true } },
} as const;
