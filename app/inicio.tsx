"use client";

import { useRouter } from "next/navigation";
// Dashboard é .jsx sem tipos
import Dashboard from "@/components/Dashboard.jsx";

export default function Inicio() {
  const router = useRouter();
  // abrir caixinha virou navegação de verdade: a URL identifica a caixinha
  return <Dashboard onOpenCaixinha={(id: string) => router.push(`/caixinhas/${id}`)} />;
}
