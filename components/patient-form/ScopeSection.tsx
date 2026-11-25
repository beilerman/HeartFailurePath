import React from 'react';
import type { Patient } from '../../types';
import { SCOPE_CONDITIONS, SCOPE_NONE_LABEL, SCOPE_QUESTION, scopeConditionsPresent } from '../../services/engine/scopeGate';

interface ScopeSectionProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
}

/**
 * The scope question (policy, services/engine/scopeGate.ts), answered before results are shown. Unanswered = results carry a visible "scope was not confirmed" line; "None of these" is an answer;
 * ticking any condition means no ranked option is shown. One implementation for the guided steps and the full form.
 */
export const ScopeSection: React.FC<ScopeSectionProps> = ({ patientData, setPatientData }) => {
    const answered = patientData.scope_conditions !== undefined;
    const present = scopeConditionsPresent(patientData);
    const none = answered && present.length === 0;
    const toggle = (label: string, on: boolean) => setPatientData(prev => {
        const next = new Set(prev.scope_conditions ?? []);
        if (on) next.add(label); else next.delete(label);
        // Unticking the last condition returns the question to "not answered", never to "None of these" by accident.
        return { ...prev, scope_conditions: next.size === 0 ? undefined : next };
    });
    const setNone = (on: boolean) => setPatientData(prev => ({ ...prev, scope_conditions: on ? new Set<string>() : undefined }));
    const box = 'h-5 w-5 rounded border-slate-400 text-indigo-600 focus:ring-2 focus:ring-indigo-500';
    return (
        <section id="patient-scope" tabIndex={-1} data-testid="scope-question">
            <h3 className="text-base font-bold text-slate-900 mb-2 pb-2 border-b border-slate-100">Conditions the tool does not cover</h3>
            <fieldset>
                <legend className="text-sm font-semibold text-slate-800">{SCOPE_QUESTION}</legend>
                <p className="mt-1 text-xs text-slate-600">The trials behind this tool did not study these conditions and the tool cannot take them into account. If any is present, no medication option is shown. Leave unanswered to see results with a note that scope was not confirmed.</p>
                <ul className="mt-2 space-y-1.5">
                    {SCOPE_CONDITIONS.map(c => (
                        <li key={c.id}>
                            <label className="flex min-h-[36px] items-start gap-2 text-sm text-slate-800">
                                <input type="checkbox" className={`${box} mt-0.5`} checked={present.includes(c.label)} onChange={e => toggle(c.label, e.target.checked)} />
                                <span>{c.label}</span>
                            </label>
                        </li>
                    ))}
                    <li>
                        <label className="flex min-h-[36px] items-start gap-2 text-sm font-semibold text-slate-900">
                            <input type="checkbox" className={`${box} mt-0.5`} checked={none} disabled={present.length > 0} onChange={e => setNone(e.target.checked)} />
                            <span>{SCOPE_NONE_LABEL}</span>
                        </label>
                    </li>
                </ul>
            </fieldset>
        </section>
    );
};
