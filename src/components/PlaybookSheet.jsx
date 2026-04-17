import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Modal for creating / editing a playbook.
// A playbook is a named, reusable setup definition (e.g. "MA30 Retracement
// Long"). Taken trades and missed trades can optionally tag a playbook; the
// insights layer aggregates stats per playbook over time.
export default function PlaybookSheet({ isOpen, onClose, session, playbook, onSaved }) {
  const isEdit = !!playbook?.id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setError(null);
    setSaved(false);
    setConfirmDelete(false);
  }, []);

  const handleClose = useCallback(() => { resetForm(); onClose(); }, [resetForm, onClose]);

  // Populate form when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    if (playbook) {
      setName(playbook.name || '');
      setDescription(playbook.description || '');
    } else {
      resetForm();
    }
  }, [isOpen, playbook, resetForm]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const handleSave = async () => {
    if (!session?.user?.id) {
      setError('Not logged in. Please refresh and try again.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name is required.'); return; }
    if (trimmedName.length > 64) { setError('Name must be 64 characters or fewer.'); return; }

    setError(null);
    setSaving(true);

    const payload = {
      user_id: session.user.id,
      name: trimmedName,
      description: description.trim() || null,
    };

    let dbError;
    if (isEdit) {
      ({ error: dbError } = await supabase
        .from('playbooks')
        .update(payload)
        .eq('id', playbook.id)
        .eq('user_id', session.user.id));
    } else {
      ({ error: dbError } = await supabase
        .from('playbooks')
        .insert(payload));
    }

    setSaving(false);
    if (dbError) {
      setError(`Save failed: ${dbError.message}`);
      return;
    }
    setSaved(true);
    setTimeout(() => { handleClose(); onSaved?.(); }, 800);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    const { error: dbError } = await supabase
      .from('playbooks')
      .delete()
      .eq('id', playbook.id)
      .eq('user_id', session.user.id);
    setSaving(false);
    if (dbError) {
      setError(`Delete failed: ${dbError.message}`);
      setConfirmDelete(false);
      return;
    }
    handleClose();
    onSaved?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-gray-900">
              {isEdit ? 'Edit playbook' : 'New playbook'}
            </h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1 -mr-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {saved ? (
            <div className="flex flex-col items-center py-10 space-y-3">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {isEdit ? 'Playbook updated' : 'Playbook saved'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="MA30 Retracement Long"
                  value={name}
                  onChange={ev => setName(ev.target.value)}
                  maxLength={64}
                  autoFocus={!isEdit}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
                />
                <p className="text-xs text-gray-400 mt-1">A short, memorable name for this setup.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Description / rules
                </label>
                <textarea
                  rows={5}
                  placeholder="Price pulls back to rising 30MA on higher-than-avg volume. Entry on close above prior day high. Target prior swing high, stop below MA."
                  value={description}
                  onChange={ev => setDescription(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">The exact pattern you want to track. Entry triggers, targets, stops, conditions.</p>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                  className="flex-1 bg-blue-600 text-white font-medium py-3 rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create playbook'}
                </button>
                {isEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className={`px-4 py-3 rounded-xl text-sm font-medium border transition-colors ${
                      confirmDelete
                        ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                        : 'border-gray-200 text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {confirmDelete ? 'Confirm' : 'Delete'}
                  </button>
                )}
              </div>
              {isEdit && (
                <p className="text-xs text-gray-400">
                  Deleting this playbook unlinks it from any plans or missed trades that reference it — those records stay intact.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
