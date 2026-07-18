import { useEffect } from "react";
import { useStore } from "../store";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore(s => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
  }, [theme]);

  return <>{children}</>;
}
