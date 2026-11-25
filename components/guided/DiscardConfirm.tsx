import React from 'react';
import type { Patient } from '../../types';
import { SCENARIOS, clonePatient } from '../../data/scenarios';
import { blankPatient, withFormDerivations } from '../patient-form/patientDraft';

export const DISCARD_QUESTION = 'Discard the entered case?';

/** Order of keys does not matter. */
const key = (p: Patient) => JSON.stringify(p, (_k, v) => (v instanceof Set ? [...v] : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** True when anything has been entered or changed: an unfinished entry, or a patient that differs from the blank case or from the unmodified example it started as. */
export const caseIsTouched = (patient: Patient, scenario: string, pendingEntry: boolean): boolean => {
    if (pendingEntry) return true;
    // An example is untouched when the case equals the raw example (results page: the form has never been opened) OR the example as the form opens it (the form adds derived fields, R12 D5(d)). R13 E5(a).
    const baselines = scenario === 'custom' ? [blankPatient()] : (() => { const e = SCENARIOS.find(s => s.title === scenario); return e ? [clonePatient(e.patient), withFormDerivations(clonePatient(e.patient))] : []; })();
    const k = key(patient);
    return !baselines.some(b => key(b) === k);
};

const btn = 'min-h-[44px] rounded-lg px-4 py-2 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';

/** In-page confirmation (no browser dialog). The caller puts focus on "Keep editing" when it opens and returns focus to the button that opened it. */
export const DiscardConfirm = React.forwardRef<HTMLButtonElement, { onDiscard: () => void; onKeep: () => void }>(({ onDiscard, onKeep }, keepRef) => (
    <div role="alertdialog" aria-labelledby="discard-question" className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 print:hidden"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onKeep(); } }}>
        <p id="discard-question" className="text-sm font-bold text-slate-900">{DISCARD_QUESTION}</p>
        <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onDiscard} className={`${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>Discard</button>
            <button type="button" ref={keepRef} onClick={onKeep} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>Keep editing</button>
        </div>
    </div>
));
DiscardConfirm.displayName = 'DiscardConfirm';
