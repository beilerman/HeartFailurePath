import React from 'react';
import type { DecisionReadiness } from '../types';
import { Disclosure } from './Disclosure';
import { NO_OPTION_SENTENCE } from '../services/engine/whyFirst';

export const DecisionReadinessPanel: React.FC<{ assessment?: DecisionReadiness; noMedicationChange?: boolean }> = ({ assessment, noMedicationChange }) => {
    if (!assessment) return null;
    // R8 X7: on a screen with no medication change the one sentence that says so is the bold line; it is not printed again as the first list item.
    const lead = noMedicationChange && assessment.mode !== 'limited_review' && assessment.available.length > 0 ? assessment.available[0] : undefined;
    const items = [...new Set(lead ? assessment.available.slice(1) : assessment.available)];
    return <section aria-labelledby="decision-scope-title" className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
        <h2 id="decision-scope-title" className="text-lg font-bold text-slate-900">What can be assessed with these inputs</h2>
        <p className="text-sm font-semibold text-slate-800">{lead ? lead : noMedicationChange ? (assessment.mode === 'limited_review' ? 'Focused safety review: no medication option is proposed until the missing items are entered.' : NO_OPTION_SENTENCE) : assessment.mode === 'limited_review' ? 'Focused safety review: complete medication options are not generated yet.' : 'Medication options are limited to changes with recorded prerequisites.'}</p>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">{items.map(line=><li key={line}>{line}</li>)}</ul>
        {assessment.mode === 'limited_review' && <p className="text-sm text-amber-950">{assessment.deferred[0]}</p>}
        {assessment.missing.length > 0 && <Disclosure title={`Decisions waiting for information (${assessment.missing.length})`} buttonClassName="py-2 text-sm font-semibold text-blue-900">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-2">{assessment.missing.map(item=><li key={item.field}><strong>{item.label}:</strong> {item.consequence}</li>)}</ul>
        </Disclosure>}
        <p className="text-xs text-slate-600">Not recorded does not mean normal or absent. Reassess with current measurements and a reconciled medication/allergy history before treatment. Scores from different amounts of information are not directly comparable.</p>
    </section>;
};
