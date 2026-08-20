import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { X } from 'lucide-react';

type Toast = { id: number; message: string; kind: 'success' | 'error' };

const ToastContext = createContext<{ show: (message: string, kind?: Toast['kind']) => void }>({
    show: () => {}
});

let nextId = 1;

// Errors get longer on screen than a routine success confirmation — an
// agent who looks away for a moment mid-call (which is often) has more
// chance of actually seeing "softphone registration failed" before it
// auto-dismisses. Both are also manually dismissible now, and closing one
// doesn't need to wait out the timer at all.
const AUTO_DISMISS_MS: Record<Toast['kind'], number> = { success: 3500, error: 6000 };

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const dismiss = useCallback((id: number) => {
        setToasts(current => current.filter(t => t.id !== id));
    }, []);

    const show = useCallback((message: string, kind: Toast['kind'] = 'success') => {
        const id = nextId++;
        setToasts(current => [...current, { id, message, kind }]);
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind]);
    }, [dismiss]);

    return (
        <ToastContext.Provider value={{ show }}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.kind}`}>
                        <span className="toast-message">{t.message}</span>
                        <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext).show;
}
