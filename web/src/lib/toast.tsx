import { createContext, useCallback, useContext, useState, ReactNode } from 'react';

type Toast = { id: number; message: string; kind: 'success' | 'error' };

const ToastContext = createContext<{ show: (message: string, kind?: Toast['kind']) => void }>({
    show: () => {}
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const show = useCallback((message: string, kind: Toast['kind'] = 'success') => {
        const id = nextId++;
        setToasts(current => [...current, { id, message, kind }]);
        setTimeout(() => {
            setToasts(current => current.filter(t => t.id !== id));
        }, 3500);
    }, []);

    return (
        <ToastContext.Provider value={{ show }}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.kind}`}>
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext).show;
}
