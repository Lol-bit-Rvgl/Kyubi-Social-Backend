import { prisma } from '@/lib/prisma';

export async function findUserByIdOrUsername(value: string) {
  return prisma.user.findFirst({
    where: {
      OR: [{ id: value }, { username: value }],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bannerUrl: true,
      bio: true,
      usernameColor: true,
      themeSettings: true,
      avatarFrame: true,
      level: true,
      isOnline: true,
      availability: true,
      gender: true,
      showGender: true,
      emailVerifiedAt: true,
      onboardingCompleted: true,
      createdAt: true,
      _count: { select: { followers: true, following: true, posts: true, visitsReceived: true } },
    },
  });
}

export const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bannerUrl: true,
  bio: true,
  usernameColor: true,
  themeSettings: true,
  avatarFrame: true,
  level: true,
  isOnline: true,
  availability: true,
  gender: true,
  showGender: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  createdAt: true,
} as const;
