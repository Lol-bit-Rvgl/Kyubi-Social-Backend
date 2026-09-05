'use client';

import { useState } from 'react';
import { adminFetch } from '@/components/admin/api';

const ACTIONS = [
  { value: 'WARN', label: '⚠️ Advertencia', color: 'text-yellow-400', needDuration: false },
  { value: 'MUTE', label: '🔇 Silenciar (Mute)', color: 'text-orange-400', needDuration: true },
  { value: 'SUSPEND', label: '⏸️ Suspender', color: 'text-red-400', needDuration: true },
  { value: 'BAN', label: '🔨 Ban (Admin+)', color: 'text-red-500', needDuration: true },
] as const;

export type SanctionAction = 'WARN' | 'MUTE' | 'SUSPEND' | 'BAN';

interface SanctionModalProps {
  userId: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SanctionModal({
  userId,
  username,
  isOpen,
  onClose,
  onSuccess,
}: SanctionModalProps) {
  const [action, setAction] = useState<SanctionAction>('WARN');
  const [durationHours, setDurationHours] = useState<number>(24);
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedAction = ACTIONS.find((a) => a.value === action)!;
  const needsDuration = selectedAction.needDuration;
  const reasonValid = reason.trim().length >= 3;

  const handleSubmit = async () => {
    if (!reasonValid) return;
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { action, reason: reason.trim() };
      if (notes.trim()) body.notes = notes.trim();
      if (needsDuration && !permanent) body.durationHours = durationHours;

      const res = await adminFetch(`/api/admin/users/${userId}/sanction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Error ${res.status}`);
      }

      onSuccess?.();
      onClose();
      setReason('');
      setNotes('');
      setDurationHours(24);
      setPermanent(false);
      setAction('WARN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Sancionar a @{username}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Action selector */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Tipo de sanción
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAction(a.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    action === a.value
                      ? 'bg-purple-600/30 border-purple-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration (optional for MUTE/SUSPEND/BAN) */}
          {needsDuration && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-300">
                  Duración
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={permanent}
                    onChange={(e) => setPermanent(e.target.checked)}
                    className="rounded"
                  />
                  Permanente
                </label>
              </div>
              {!permanent && (
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value={1}>1 hora</option>
                  <option value={6}>6 horas</option>
                  <option value={24}>24 horas</option>
                  <option value={72}>3 días</option>
                  <option value={168}>7 días</option>
                  <option value={720}>30 días</option>
                </select>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Motivo <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Describe la razón de la sanción (mínimo 3 caracteres)..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500"
            />
            {!reasonValid && reason.length > 0 && (
              <p className="text-xs text-yellow-500 mt-1">
                Mínimo 3 caracteres requeridos ({reason.trim().length}/3)
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Notas internas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notas visibles solo para el staff..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm font-medium text-slate-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !reasonValid}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                loading || !reasonValid
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500'
              }`}
            >
              {loading ? 'Aplicando...' : `Aplicar ${selectedAction.label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
