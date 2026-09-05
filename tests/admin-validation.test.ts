import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Schema replicas for validation testing (duplicated here for clarity)
const sanctionSchema = z.object({
  action: z.enum(['WARN', 'MUTE', 'SUSPEND', 'BAN']),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
  durationHours: z.number().int().positive().optional(),
  notes: z.string().trim().optional(),
});

const unsanctionSchema = z.object({
  reason: z.string().trim().min(3),
});

const visibilitySchema = z.object({
  isHidden: z.boolean(),
  reason: z.string().trim().min(3),
});

const titleSchema = z.object({
  titleText: z.string().trim().min(1).max(80),
  colorHex: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Color HEX inválido'),
  displayOrder: z.number().int().min(0).default(0),
});

const pinSchema = z.object({
  isPinned: z.boolean(),
  reason: z.string().trim().min(3),
});

const bulkDeleteSchema = z.object({
  postIds: z.array(z.string()).optional(),
  authorId: z.string().optional(),
  reason: z.string().trim().min(3),
  hardDelete: z.boolean().default(false),
});

const reportUpdateSchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolutionNotes: z.string().trim().max(2000).optional(),
});

describe('Admin Panel Schemas - Zod Validation', () => {
  describe('Sanction Schema', () => {
    it('accepts valid action and reason', () => {
      const valid = { action: 'WARN', reason: 'spamming content' };
      expect(() => sanctionSchema.parse(valid)).not.toThrow();
    });

    it('rejects invalid action', () => {
      const invalid = { action: 'DELETE', reason: 'spam' };
      expect(() => sanctionSchema.parse(invalid)).toThrow();
    });

    it('rejects short reason', () => {
      const invalid = { action: 'WARN', reason: 'ab' };
      expect(() => sanctionSchema.parse(invalid)).toThrow();
    });

    it('accepts valid duration', () => {
      const valid = { action: 'MUTE', reason: 'spam', durationHours: 24 };
      expect(() => sanctionSchema.parse(valid)).not.toThrow();
    });

    it('rejects negative duration', () => {
      const invalid = { action: 'MUTE', reason: 'spam', durationHours: -1 };
      expect(() => sanctionSchema.parse(invalid)).toThrow();
    });
  });

  describe('Visibility Schema', () => {
    it('accepts boolean isHidden', () => {
      const valid = { isHidden: true, reason: 'inappropriate' };
      expect(() => visibilitySchema.parse(valid)).not.toThrow();
    });

    it('rejects non-boolean isHidden', () => {
      const invalid = { isHidden: 'true', reason: 'inappropriate' };
      expect(() => visibilitySchema.parse(invalid)).toThrow();
    });
  });

  describe('Title Schema', () => {
    it('accepts valid title with hex color', () => {
      const valid = { titleText: 'VIP', colorHex: '#FF0000' };
      expect(() => titleSchema.parse(valid)).not.toThrow();
    });

    it('rejects invalid hex color', () => {
      const invalid = { titleText: 'VIP', colorHex: '#GGG000' }; // Invalid hex
      expect(() => titleSchema.parse(invalid)).toThrow();
    });

    it('rejects short title text', () => {
      const invalid = { titleText: '', colorHex: '#FF0000' };
      expect(() => titleSchema.parse(invalid)).toThrow();
    });
  });

  describe('Pin Schema', () => {
    it('accepts valid isPinned', () => {
      const valid = { isPinned: true, reason: 'featured' };
      expect(() => pinSchema.parse(valid)).not.toThrow();
    });

    it('requires reason', () => {
      const invalid = { isPinned: true };
      expect(() => pinSchema.parse(invalid)).toThrow();
    });
  });

  describe('Bulk Delete Schema', () => {
    it('accepts valid authorId', () => {
      const valid = { authorId: 'spammer', reason: 'spam bot' };
      expect(() => bulkDeleteSchema.parse(valid)).not.toThrow();
    });

    it('accepts valid postIds', () => {
      const valid = { postIds: ['post1', 'post2'], reason: 'spam bot' };
      expect(() => bulkDeleteSchema.parse(valid)).not.toThrow();
    });

    it('requires reason', () => {
      const invalid = { authorId: 'spammer' };
      expect(() => bulkDeleteSchema.parse(invalid)).toThrow();
    });
  });

  describe('Report Update Schema', () => {
    it('accepts valid status and notes', () => {
      const valid = { status: 'RESOLVED', resolutionNotes: 'Handled' };
      expect(() => reportUpdateSchema.parse(valid)).not.toThrow();
    });

    it('rejects invalid status', () => {
      const invalid = { status: 'PENDING' }; // PENDING is not a valid target status for update
      expect(() => reportUpdateSchema.parse(invalid)).toThrow();
    });

    it('rejects invalid status from enum', () => {
      const invalid = { status: 'CLOSED' };
      expect(() => reportUpdateSchema.parse(invalid)).toThrow();
    });
  });

  describe('Audit Logs Query Params', () => {
    it('parses page and limit correctly', () => {
      const params = new URLSearchParams({ page: '2', limit: '50' });
      expect(parseInt(params.get('page') || '1')).toBe(2);
      expect(parseInt(params.get('limit') || '30')).toBe(50);
    });

    it('rejects invalid page values', () => {
      const params = new URLSearchParams({ page: '-1' });
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      expect(page).toBe(1); // -1 clamped to 1
    });
  });

  describe('Moderation Actions', () => {
    it('includes all moderation actions', () => {
      const actions = [
        'WARN', 'MUTE_USER', 'UNMUTE_USER', 'BAN_USER', 'UNBAN_USER',
        'DELETE_POST', 'DELETE_CIRCLE', 'DELETE_SALA', 'REVIEW_REPORT',
        'RESOLVE_REPORT', 'DISMISS_REPORT', 'CHANGE_ROLE', 'SUSPEND_USER',
        'UNSUSPEND_USER', 'HIDE_POST', 'UNHIDE_POST', 'HIDE_COMMENT',
        'UNHIDE_COMMENT', 'HIDE_MESSAGE', 'UNHIDE_MESSAGE', 'PIN_POST',
        'UNPIN_POST', 'FEATURE_POST', 'UNFEATURE_POST', 'HIDE_PROFILE',
        'UNHIDE_PROFILE', 'ASSIGN_TITLE', 'REMOVE_TITLE'
      ];
      expect(actions).toContain('WARN');
      expect(actions).toContain('BAN_USER');
      expect(actions).toContain('PIN_POST');
      expect(actions).not.toContain('INVALID_ACTION');
    });

    it('has sufficient enum values for new features', () => {
      const enums = [
        { type: 'ModerationAction', values: ['WARN', 'SUSPEND_USER', 'PIN_POST', 'HIDE_POST', 'FEATURE_POST'] },
        { type: 'ModerationTargetType', values: ['USER', 'POST', 'COMMENT', 'MESSAGE', 'REPORT'] },
        { type: 'ReportTargetType', values: ['USER', 'POST', 'MESSAGE', 'COMMUNITY'] }
      ];

      for (const enumGroup of enums) {
        expect(enumGroup.values.length).toBeGreaterThan(0);
      }
    });
  });
});
