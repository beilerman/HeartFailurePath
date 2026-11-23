import type { Patient, RegimenMed } from '../../types';
import { MEDICATION_FORMULARY } from '../../constants';

// A mid-entry reload keeps the entered patient for this browser tab only (session storage; nothing is sent anywhere). The patient holds Sets and
// formulary objects with functions, so it is stored as plain data and rebuilt from the formulary by drug name.

export type SessionPhase = 'start' | 'steps' | 'results';
export interface SessionState { patient: Patient; step: number; phase: SessionPhase; scenario: string }

const KEY = 'hfp-session-v1';

const replacer = (_k: string, v: unknown): unknown => {
    if (v instanceof Set) return { __set: [...v] };
    if (v && typeof v === 'object' && 'med' in v && 'dose' in v && 'selected_frequency' in v) {
        const r = v as RegimenMed;
        return { __reg: { name: r.med.name, strength: r.dose.strength, frequency: r.selected_frequency, exposure: r.exposure } };
    }
    return v;
};
const reviver = (_k: string, v: unknown): unknown => {
    if (v && typeof v === 'object') {
        const o = v as { __set?: unknown[]; __reg?: { name: string; strength: number | string; frequency: string; exposure?: RegimenMed['exposure'] } };
        if (Array.isArray(o.__set)) return new Set(o.__set);
        if (o.__reg) {
            const med = MEDICATION_FORMULARY.find(m => m.name === o.__reg!.name);
            const dose = med?.available_doses.find(d => String(d.strength) === String(o.__reg!.strength));
            if (!med || !dose) return undefined;
            return { med, dose, selected_frequency: o.__reg.frequency, ...(o.__reg.exposure ? { exposure: o.__reg.exposure } : {}) };
        }
    }
    return v;
};

export const encodeSession = (s: SessionState): string => JSON.stringify(s, replacer);
export function decodeSession(text: string): SessionState | undefined {
    try {
        const s = JSON.parse(text, reviver) as SessionState;
        if (!s || typeof s !== 'object' || !s.patient || typeof s.step !== 'number' || !['start', 'steps', 'results'].includes(s.phase)) return undefined;
        if (Array.isArray(s.patient.current_regimen)) s.patient.current_regimen = s.patient.current_regimen.filter(Boolean);
        return s;
    } catch { return undefined; }
}
export function saveSession(s: SessionState): void { try { window.sessionStorage.setItem(KEY, encodeSession(s)); } catch { /* storage is a convenience only */ } }
export function loadSession(): SessionState | undefined { try { const t = window.sessionStorage.getItem(KEY); return t ? decodeSession(t) : undefined; } catch { return undefined; } }
export function clearSession(): void { try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
