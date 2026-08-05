import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const STORAGE_KEY = 'chumz-dark-mode';

const ThemeContext = createContext<{ darkMode: boolean; toggleDarkMode: () => void }>({
    darkMode: false,
    toggleDarkMode: () => {}
});

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

    useEffect(() => {
        document.documentElement.classList.toggle('dark', darkMode);
        localStorage.setItem(STORAGE_KEY, String(darkMode));
    }, [darkMode]);

    return (
        <ThemeContext.Provider value={{ darkMode, toggleDarkMode: () => setDarkMode(d => !d) }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
