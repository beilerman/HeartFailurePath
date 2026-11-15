import React from 'react';
import type { Patient } from '../../types';
import { patientFacts } from './patientFacts';

interface PatientBarProps {
    patient: Patient;
    caseLabel: string;
    onEditInputs: () => void;
    onNewPatient: () => void;
}

const btn = 'min-h-[44px] rounded-lg px-4 py-2 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';

/** Compact summary of what was entered, shown above the results. A blank is "not entered", never 0. */
export const PatientBar: React.FC<PatientBarProps> = ({ patient, caseLabel, onEditInputs, onNewPatient }) => (
    <section aria-label="Patient summary" className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base font-bold text-slate-900">{caseLabel}</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onEditInputs} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>Edit inputs</button>
                <button type="button" onClick={onNewPatient} className={`${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>New patient</button>
            </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-8">
            {patientFacts(patient).map(f => (
                <div key={f.label} className="min-w-0">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{f.label}</dt>
                    <dd className={`mt-0.5 break-words text-sm ${f.entered ? 'font-bold text-slate-900' : 'italic text-slate-600'}`}>{f.value}</dd>
                </div>
            ))}
        </dl>
    </section>
);
