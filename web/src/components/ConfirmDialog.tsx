import { TriangleAlert } from 'lucide-react';
import { useModalA11y } from '../lib/useModalA11y';

type ConfirmDialogProps = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
};

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    const containerRef = useModalA11y(open, onCancel);

    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                ref={containerRef}
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
                onClick={e => e.stopPropagation()}
            >
                <h3 id="confirm-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {danger && <TriangleAlert size={18} color="var(--danger)" aria-hidden="true" />}
                    {title}
                </h3>
                <p>{message}</p>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                    <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
