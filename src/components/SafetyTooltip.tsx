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
        C’est sûr ?
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm leading-relaxed shadow-[0_0_24px_var(--neon-glow)]">
          <p className="mb-2 font-semibold text-[var(--neon)]">
            Vos identifiants restent chez Google
          </p>
          <ul className="space-y-1.5 text-[var(--muted)]">
            <li>• Connexion directe avec Google — on ne voit pas votre mot de passe</li>
            <li>
              • On crée un calendrier{" "}
              <strong className="text-white">secondaire</strong>, on ne touche
              pas à votre agenda principal
            </li>
            <li>• Vous pouvez d’abord tester avec quelques semaines</li>
            <li>
              • Au pire, supprimez le calendrier dans{" "}
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon)] underline"
              >
                Google Agenda (ordinateur)
              </a>
              : Paramètres → votre calendrier → Supprimer
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
