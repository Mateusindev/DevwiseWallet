"use client";

import App from "@/App";
import AuthGate from "@/components/AuthGate";
import { FinanceProvider } from "@/store/FinanceContext";

export default function Home() {
  return (
    <AuthGate>
      <FinanceProvider>
        <App />
      </FinanceProvider>
    </AuthGate>
  );
}
