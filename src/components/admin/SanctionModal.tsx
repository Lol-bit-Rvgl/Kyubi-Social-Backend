'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  MicOff,
  PauseCircle,
  Ban,
  X,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { adminFetch } from '@/components/admin/api';

const ACTIONS = [
  {
    value: 'WARN',
    label: 'Advertencia',
    icon: AlertTriangle,
    style: 'from-amber-500/20 to-orange-500/20 border-amber-500/40 text-amber-300 shadow-amber-500/10',
    activeStyle: 'bg-gradient-to-r from-amber-500/30 to-orange-500/30 border-amber-400 text-white shadow-md shadow-amber-500/20',
    needDuration: false,
  },
  {
    value: 'MUTE',
    label: 'Silenciar (Mute)',
    icon: MicOff,
    style: 'from-orange-500/20 to-amber-600/20 border-orange-500/40 text-orange-300 shadow-orange-500/10',
    activeStyle: 'bg-gradient-to-r from-orange-500/30 to-amber-600/30 border-orange-400 text-white shadow-md shadow-orange-500/20',
    needDuration: true,
  },
  {
    value: 'SUSPEND',
    label: 'Suspender',
    icon: PauseCircle,
    style: 'from-rose-500/20 to-pink-500/20 border-rose-500/40 text-rose-300 shadow-rose-500/10',
    activeStyle: 'bg-gradient-to-r from-rose-500/30 to-pink-500/30 border-rose-400 text-white shadow-md shadow-rose-500/20',
    needDuration: true,
  },
  {
    value: 'BAN',
    label: 'Ban (Admin+)',
    icon: Ban,
    style: 'from-red-600/20 to-rose-700/20 border-red-500/40 text-red-300 shadow-red-500/10',
    activeStyle: 'bg-gradient-to-r from-red-600/40 to-rose-600/40 border-red-400 text-white shadow-md shadow-red-500/30',
    needDuration: true,
  },
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
      className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="backdrop-blur-2xl bg-slate-950/90 border border-white/15 rounded-3xl w-full max-w-md shadow-[0_16px_48px_0_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Sancionar a <span className="text-rose-300">@{username}</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Aplica una medida disciplinaria sobre la cuenta
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Selector de Tipo de sanción */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Tipo de sanción
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                const isSelected = action === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAction(a.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl text-xs font-semibold border transition-all duration-200 ${
                      isSelected
                        ? a.activeStyle
                        : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06] hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Duración */}
          {needsDuration && (
            <div className="rounded-2xl p-3.5 bg-white/[0.02] border border-white/[0.08]">
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Duración de la sanción</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permanent}
                    onChange={(e) => setPermanent(e.target.checked)}
                    className="rounded accent-rose-500"
                  />
                  <span>Permanente</span>
                </label>
              </div>
              {!permanent && (
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full bg-slate-900/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500/50"
                >
                  <option value={1}>1 hora</option>
                  <option value={6}>6 horas</option>
                  <option value={12}>12 horas</option>
                  <option value={24}>24 horas (1 día)</option>
                  <option value={72}>3 días</option>
                  <option value={168}>7 días (1 semana)</option>
                  <option value={720}>30 días (1 mes)</option>
                </select>
              )}
            </div>
          )}

          {/* Motivo */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Motivo <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Describe el motivo de la sanción (mínimo 3 caracteres)..."
              className="w-full bg-slate-900/70 border border-white/10 rounded-2xl p-3 text-xs text-white placeholder-slate-500 resize-none focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/20"
            />
            {!reasonValid && reason.length > 0 && (
              <p className="text-[11px] text-amber-400 mt-1">
                Mínimo 3 caracteres requeridos ({reason.trim().length}/3)
              </p>
            )}
          </div>

          {/* Notas internas */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Notas internas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notas visibles solo para el equipo de moderación..."
              className="w-full bg-slate-900/70 border border-white/10 rounded-2xl p-3 text-xs text-white placeholder-slate-500 resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
            />
          </div>

          {error && (
            <div className="p-3 bg-rose-950/50 border border-rose-900/60 rounded-2xl text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Acciones con degradados */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-medium text-slate-300 transition-colors shadow-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !reasonValid}
              className={`flex-1 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-lg ${
                loading || !reasonValid
                  ? 'bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed'
                  : 'bg-gradient-to-r from-rose-500/80 via-pink-500/80 to-purple-600/80 hover:from-rose-400 hover:to-purple-500 text-white shadow-rose-500/20 border border-white/20'
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
