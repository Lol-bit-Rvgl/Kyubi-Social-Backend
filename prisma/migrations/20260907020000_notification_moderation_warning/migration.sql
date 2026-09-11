-- Añade el valor 'MODERATION_WARNING' al enum NotificationType para las
-- notificaciones de advertencia emitidas a usuarios sancionados con WARN.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MODERATION_WARNING';