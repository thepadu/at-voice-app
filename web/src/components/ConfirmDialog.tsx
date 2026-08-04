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
    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()}>
                <h3 id="confirm-title">{title}</h3>
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
