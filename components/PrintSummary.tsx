import React from 'react';
import type { MonitoringPlanItem, ScoredRegimen, DecisionReadiness } from '../types';
import type { WhyFirst } from '../services/engine/whyFirst';
import type { Patient } from '../types';
import { patientFacts } from './guided/patientFacts';
import { partitionAlerts, stopStateText } from './resultsModel';
import { clinicalSentence, costLabel, NO_CHANGE_TEXT } from './clinicalPresentation';
import { plainText } from './plainText';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { RESEARCH_LINE } from './appStatements';
import { formatRunTime } from './chartHeader';
import { doseLabel } from './clinicalPresentation';
import { isUseConfirmed, useStatusWords } from './guided/confirmUse';

interface Props {
    patient?: Patient;
    caseLabel?: string;
    /** ISO time of the analysis. */
    ranAt?: string;
    results: ScoredRegimen[];
    clinicalAlerts: string[];
    monitoring: MonitoringPlanItem[];
    monitoringOption: number;
    whyFirst?: WhyFirst;
    decisionReadiness?: DecisionReadiness;
    /** The evidence sentence and, when the scope question was not answered, the scope line (both from the engine). */
    evidenceBandText?: string;
    scopeNote?: string;
}

/** What is printed when the results are printed: patient, alerts, the options with their changes and reasons, and monitoring. Hidden on screen. */
export const PrintSummary: React.FC<Props> = ({ patient, caseLabel, ranAt, results, clinicalAlerts, monitoring, monitoringOption, whyFirst, decisionReadiness, evidenceBandText, scopeNote }) => {
    const { urgent } = partitionAlerts(clinicalAlerts);
    return (
        <section data-print-summary className="hidden space-y-3 text-sm text-black" aria-hidden="true">
            <h1 className="text-xl font-bold">Heart failure medication review: summary</h1>
            <p className="text-xs">{RESEARCH_LINE}</p>
            {scopeNote && <p className="text-xs" data-testid="print-scope-note">{scopeNote}</p>}
            {evidenceBandText && results.length > 0 && <p className="text-xs" data-testid="print-evidence-band">{evidenceBandText}</p>}
            <p className="text-xs" data-testid="print-run-facts">Analysis run: {ranAt ? formatRunTime(ranAt) : 'not recorded'}. Rule-set version: {RULESET_VERSION}. Case label: {caseLabel ? plainText(caseLabel) : 'none entered'}.</p>
            {patient && (
                <p className="text-xs">{patientFacts(patient).map(f => `${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''}${f.held ? `; ${f.held}` : ''}`).join('; ')}.</p>
            )}
            {patient && (
                <div className="text-xs" data-testid="print-regimen">
                    <p><strong>Current regimen as entered:</strong> {(patient.current_regimen ?? []).length === 0 ? 'none entered' : (patient.current_regimen ?? []).map(r => `${r.med.name} ${doseLabel(r)} (${useStatusWords(r.exposure)})`).join('; ')}.</p>
                    {(patient.current_regimen ?? []).some(r => !isUseConfirmed(r)) && (
                        <p>Use and course history is not confirmed for {(patient.current_regimen ?? []).filter(r => !isUseConfirmed(r)).map(r => r.med.name).join(', ')}: no increase or substitution of these drugs is offered until it is confirmed.</p>
                    )}
                </div>
            )}
            {urgent.length > 0 && (
                <div>
                    <h2 className="text-base font-bold">Safety alerts ({urgent.length})</h2>
                    <ul className="list-disc pl-5">{urgent.map((a, i) => <li key={i}>{a.head ? <strong>{plainText(a.head)}: </strong> : null}{plainText(a.body)}</li>)}</ul>
                </div>
            )}
            {results.length === 0 && <p className="font-semibold">{stopStateText(clinicalAlerts, decisionReadiness, whyFirst)}</p>}
            {results.map((r, i) => {
                const changes = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
                const why = whyFirst?.options[i];
                return (
                    <div key={i} className="break-inside-avoid">
                        <h2 className="text-base font-bold">Option {i + 1}{i === 0 ? ': first option to review' : ': alternative option'} ({costLabel(r.cost)})</h2>
                        <ul className="list-disc pl-5">{changes.length === 0 ? <li>{NO_CHANGE_TEXT}</li> : changes.map((m, j) => <li key={j}>{clinicalSentence(m.summary)}</li>)}</ul>
                        {why && why.lines.length > 0 && <p className="mt-1"><strong>{i === 0 ? 'Why this is first: ' : `Why this is option ${i + 1}: `}</strong>{why.lines.filter(l => !l.detail).map(l => plainText(l.text)).join(' ')}</p>}
                    </div>
                );
            })}
            {monitoring.length > 0 && (
                <div>
                    <h2 className="text-base font-bold">{results.length > 0 ? `Monitoring for option ${monitoringOption}` : 'Monitoring and urgent follow-up'}</h2>
                    <ul className="list-disc pl-5">{monitoring.map((m, i) => <li key={i}><strong>{m.test}</strong> ({m.timing}): {plainText(m.details)}</li>)}</ul>
                </div>
            )}
            <p className="text-xs">Expected effects are population averages from randomized trials, not a prediction for this patient. The full reasons, evidence and score details are in the on-screen results.</p>
        </section>
    );
};
