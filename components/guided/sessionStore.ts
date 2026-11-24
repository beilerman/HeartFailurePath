import { reconciledHistory, validateEngineInput } from '../../services/engine/inputContract';
import { scopeConditionsPresent } from '../../services/engine/scopeGate';
import { REVIEW_STEP } from './steps';
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
        return { __reg: { name: r.med.name, strength: r.dose.strength, unit: r.dose.unit, frequency: r.selected_frequency, exposure: r.exposure } };
    }
    return v;
};
const reviver = (_k: string, v: unknown): unknown => {
    if (v && typeof v === 'object') {
        const o = v as { __set?: unknown[]; __reg?: { name: string; strength: number | string; unit?: string; frequency: string; exposure?: RegimenMed['exposure'] } };
        if (Array.isArray(o.__set)) return new Set(o.__set);
        if (o.__reg) {
            const saved = o.__reg;
            if (typeof saved.strength !== 'number' && typeof saved.strength !== 'string') throw new Error('Invalid saved strength.');
            const med = MEDICATION_FORMULARY.find(m => m.name === saved.name);
            const matches = med?.available_doses.filter(d => String(d.strength) === String(saved.strength)
                && (saved.unit === undefined || saved.unit === d.unit) && d.frequency_options.includes(saved.frequency));
            if (!med || matches?.length !== 1) throw new Error('Cannot reconcile a saved medication.');
            const dose = matches[0];
            return { med, dose, selected_frequency: saved.frequency, exposure: saved.exposure };
        }
    }
    return v;
};

export const encodeSession = (s: SessionState): string => JSON.stringify(s, replacer);
export function decodeSession(text: string): SessionState | undefined {
    try {
        const s = JSON.parse(text, reviver) as SessionState;
        if (!s || typeof s !== 'object' || !s.patient || typeof s.scenario !== 'string' || !Number.isInteger(s.step) || s.step < 0 || s.step > REVIEW_STEP || !['start', 'steps', 'results'].includes(s.phase)) return undefined;
        const checked = validateEngineInput(s.patient, 'draft');
        if (checked.errors.length) return undefined;
        s.patient = { ...s.patient, ...reconciledHistory(s.patient), current_regimen: checked.regimen };
        if (s.patient.scope_conditions) s.patient.scope_conditions = new Set(scopeConditionsPresent(s.patient));
        return s;
    } catch { return undefined; }
}
export function saveSession(s: SessionState): void { try { window.sessionStorage.setItem(KEY, encodeSession(s)); } catch { /* storage is a convenience only */ } }
export function loadSession(): SessionState | null | undefined { try { const t = window.sessionStorage.getItem(KEY); return t === null ? undefined : decodeSession(t) ?? null; } catch { return undefined; } }
export function clearSession(): void { try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
