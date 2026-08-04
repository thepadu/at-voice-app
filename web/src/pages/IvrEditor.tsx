import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import ConfirmDialog from '../components/ConfirmDialog';

type IvrOption = {
    digit: string;
    label: string;
    response_message: string | null;
    action: 'message' | 'transfer_agent' | 'repeat_menu';
};

const ACTIONS: { value: IvrOption['action']; label: string }[] = [
    { value: 'message', label: 'Say a message' },
    { value: 'transfer_agent', label: 'Transfer to an available agent' },
    { value: 'repeat_menu', label: 'Repeat this menu' }
];

const EMPTY_FORM = { digit: '', label: '', response_message: '', action: 'message' as IvrOption['action'] };

export default function IvrEditor() {
    const [options, setOptions] = useState<IvrOption[]>([]);
    const [drafts, setDrafts] = useState<Record<string, IvrOption>>({});
    const [addOpen, setAddOpen] = useState(false);
    const [addForm, setAddForm] = useState(EMPTY_FORM);
    const [addError, setAddError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<IvrOption | null>(null);
    const showToast = useToast();

    function load() {
        apiFetch('/api/ivr-options').then(data => {
            setOptions(data.options);
            setDrafts(Object.fromEntries(data.options.map((o: IvrOption) => [o.digit, o])));
        }).catch(() => {});
    }

    useEffect(load, []);

    function updateDraft(digit: string, changes: Partial<IvrOption>) {
        setDrafts(current => ({ ...current, [digit]: { ...current[digit], ...changes } }));
    }

    function isDirty(digit: string) {
        const original = options.find(o => o.digit === digit);
        const draft = drafts[digit];
        if (!original || !draft) return false;
        return original.label !== draft.label || original.response_message !== draft.response_message || original.action !== draft.action;
    }

    async function saveRow(digit: string) {
        const draft = drafts[digit];
        try {
            await apiFetch(`/api/ivr-options/${digit}`, {
                method: 'PATCH',
                body: JSON.stringify({ label: draft.label, response_message: draft.response_message, action: draft.action })
            });
            showToast(`Option ${digit} saved`);
            load();
        } catch (err: any) {
            showToast(err.message || 'Failed to save', 'error');
        }
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        try {
            await apiFetch(`/api/ivr-options/${pendingDelete.digit}`, { method: 'DELETE' });
            showToast(`Option ${pendingDelete.digit} removed`);
            load();
        } catch (err: any) {
            showToast(err.message || 'Failed to remove', 'error');
        } finally {
            setPendingDelete(null);
        }
    }

    async function saveNew() {
        setAddError('');
        try {
            await apiFetch('/api/ivr-options', { method: 'POST', body: JSON.stringify(addForm) });
            showToast(`Option ${addForm.digit} added`);
            setAddOpen(false);
            setAddForm(EMPTY_FORM);
            load();
        } catch (err: any) {
            setAddError(err.message || 'Something went wrong');
        }
    }

    return (
        <div>
            <div className="panel">
                <div className="panel-header">
                    <h3>☎️ IVR Menu</h3>
                    <button className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Add Option</button>
                </div>
                <p className="hint">
                    This is exactly what callers hear when they dial in — edits take effect on the next call, no deploy needed.
                </p>

                {options.map(option => {
                    const draft = drafts[option.digit] ?? option;
                    return (
                        <div className="ivr-row" key={option.digit}>
                            <div className="ivr-row-digit">{option.digit}</div>
                            <div className="ivr-row-fields">
                                <label>
                                    Label (shown as "Press {option.digit} for ___")
                                    <input
                                        value={draft.label}
                                        onChange={e => updateDraft(option.digit, { label: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Action
                                    <select
                                        value={draft.action}
                                        onChange={e => updateDraft(option.digit, { action: e.target.value as IvrOption['action'] })}
                                    >
                                        {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                    </select>
                                </label>
                                {draft.action !== 'repeat_menu' && (
                                    <label>
                                        {draft.action === 'transfer_agent' ? 'Message before transferring' : 'Response message'}
                                        <textarea
                                            value={draft.response_message ?? ''}
                                            onChange={e => updateDraft(option.digit, { response_message: e.target.value })}
                                            rows={2}
                                        />
                                    </label>
                                )}
                            </div>
                            <div className="ivr-row-actions">
                                <button
                                    className="btn btn-primary"
                                    disabled={!isDirty(option.digit)}
                                    onClick={() => saveRow(option.digit)}
                                >
                                    Save
                                </button>
                                <button className="btn btn-link btn-link-danger" onClick={() => setPendingDelete(option)}>
                                    Delete
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {addOpen && (
                <div className="modal-overlay" onClick={() => setAddOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Add IVR Option</h3>

                        <label>
                            Digit (0-9, *, #)
                            <input
                                maxLength={1}
                                value={addForm.digit}
                                onChange={e => setAddForm({ ...addForm, digit: e.target.value })}
                            />
                        </label>
                        <label>
                            Label
                            <input value={addForm.label} onChange={e => setAddForm({ ...addForm, label: e.target.value })} />
                        </label>
                        <label>
                            Action
                            <select
                                value={addForm.action}
                                onChange={e => setAddForm({ ...addForm, action: e.target.value as IvrOption['action'] })}
                            >
                                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                        </label>
                        {addForm.action !== 'repeat_menu' && (
                            <label>
                                Response message
                                <textarea
                                    value={addForm.response_message}
                                    onChange={e => setAddForm({ ...addForm, response_message: e.target.value })}
                                    rows={2}
                                />
                            </label>
                        )}

                        {addError && <p className="error">{addError}</p>}

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveNew}>Add</button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={!!pendingDelete}
                title="Remove IVR option"
                message={`Remove option ${pendingDelete?.digit} ("${pendingDelete?.label}")? Callers who press ${pendingDelete?.digit} will hear "Invalid input" until you add another.`}
                confirmLabel="Remove"
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
