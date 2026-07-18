import { Toaster } from "react-hot-toast";
import { useStore } from "../store";

export default function ToastProvider() {
  const theme = useStore(s => s.theme);

  return (
    <Toaster
      position="top-right"
      gutter={12}
      toastOptions={{
        style: {
          background: theme === "dark" ? "#1e293b" : "#ffffff",
          color: theme === "dark" ? "#e2e8f0" : "#1e293b",
          border: theme === "dark" ? "1px solid #334155" : "1px solid #e2e8f0",
          borderRadius: "12px",
          fontSize: "14px",
          fontFamily: "'Inter', sans-serif",
          padding: "12px 16px",
        },
        duration: 3000,
      }}
    />
  );
}
