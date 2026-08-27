"use client";

import { useState } from "react";

export function SafetyTooltip() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--neon)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        É seguro?
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm leading-relaxed shadow-[0_0_24px_var(--neon-glow)]">
          <p className="mb-2 font-semibold text-[var(--neon)]">Suas credenciais estão seguras</p>
          <ul className="space-y-1.5 text-[var(--muted)]">
            <li>• Login direto com Google — nunca armazenamos sua senha</li>
            <li>• Criamos um calendário <strong className="text-white">secundário</strong>, nunca tocamos no principal</li>
            <li>• Você pode testar com limite de semanas antes de sincronizar tudo</li>
            <li>
              • No pior caso, delete o calendário no{" "}
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon)] underline"
              >
                Google Agenda (versão desktop)
              </a>
              : Configurações → seu calendário → Excluir
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
