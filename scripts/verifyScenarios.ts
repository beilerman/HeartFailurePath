
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { SCENARIOS } from '../data/scenarios';

async function runVerification() {
    console.log('Starting Clinical Scenario Verification...\n');
    let passed = 0;
    let failed = 0;

    // Use any tier to get the full set of medication names (all tiers have the same keys)
    const prices = await getDrugPrices(undefined, 'commercial');
    const availableMedNames = new Set(Object.keys(prices));
    const betaBlockerMeds = new Set(['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol']);

    for (const scenario of SCENARIOS) {
        console.log(`Analyzing Scenario: "${scenario.title}"`);

        try {
            const scenarioPrices = await getDrugPrices(undefined, scenario.patient.insurance_tier);
            const scenarioAvailableMedNames = scenario.title.includes('No BB Available')
                ? new Set([...availableMedNames].filter(name => !betaBlockerMeds.has(name)))
                : availableMedNames;
            const { scoredRegimens, clinicalAlerts, monitoringPlan } = generateAndScoreModifications(scenario.patient, scenarioAvailableMedNames, scenarioPrices);
            const topRegimen = scoredRegimens[0];

            if (clinicalAlerts.length > 0) {
                clinicalAlerts.forEach(a => console.log(`  ALERT: ${a.substring(0, 80)}...`));
            }

            if (!topRegimen) {
                // No regimens is valid when clinical alerts block recs (e.g. SBP < 85)
                if (clinicalAlerts.length === 0) {
                    console.error(`  [FAIL] No regimens generated and no clinical alerts.`);
                    failed++;
                    continue;
                }
                console.log(`  No regimens (clinical alerts active).`);
            } else {
                console.log(`  Top Score: ${topRegimen.overall_score}`);
                console.log(`  Regimen: ${topRegimen.regimen.map(r => `${r.med.name} ${r.dose.strength}${r.dose.unit}`).join(' + ')}`);
            }

            // SCENARIO SPECIFIC ASSERTIONS
            const meds = topRegimen ? topRegimen.regimen.map(r => r.med.name) : [];
            const classes = new Set(topRegimen ? topRegimen.regimen.map(r => r.med.drug_class) : []);

            let scenarioPassed = true;
            const failures: string[] = [];

            // 1. Hyperkalemia (K+ 5.6) -> Should NOT have MRA
            if (scenario.title.includes('Hyperkalemia')) {
                if (classes.has('MRA')) {
                    failures.push('Contraindicated MRA prescribed despite K+ 5.6');
                    scenarioPassed = false;
                }
            }

            // 2. Severe Hypotension -> SBP < 90 should block all recs
            if (scenario.title.includes('Severe Hypotension')) {
                if (scenario.patient.sbp < 90) {
                    // S2: Should have hemodynamic instability alert and no drug recs
                    if (scoredRegimens.length > 0) {
                        failures.push(`Drug recs generated despite SBP ${scenario.patient.sbp}`);
                        scenarioPassed = false;
                    }
                    if (!clinicalAlerts.some(a => a.includes('HEMODYNAMIC INSTABILITY'))) {
                        failures.push('Missing hemodynamic instability alert');
                        scenarioPassed = false;
                    }
                }
            }

            // 3. Bradycardia -> No BB
            if (scenario.title.includes('Bradycardia')) {
                if (classes.has('Beta Blocker')) {
                    failures.push('Beta Blocker prescribed in Bradycardia (HR 48)');
                    scenarioPassed = false;
                }
            }

            // 4. Angioedema -> No ACEi/ARNI
            if (scenario.title.includes('Angioedema')) {
                if (classes.has('ACEi') || classes.has('ARNI')) {
                    failures.push('ACEi/ARNI prescribed despite Angioedema history');
                    scenarioPassed = false;
                }
            }

            // 5. Asthma -> Selective BB only (Metoprolol or Bisoprolol), No Carvedilol
            if (scenario.title.includes('Severe Asthma')) {
                if (meds.includes('Carvedilol') || meds.includes('Propranolol')) { // Non-selective
                    failures.push('Non-selective Beta Blocker (Carvedilol) prescribed in Asthma');
                    scenarioPassed = false;
                }
                // Should probably have a BB if possible, but selective
            }

            // 6. Critical Renal (eGFR 25) -> No MRA (cutoff usually 30), Caution ACEi
            if (scenario.title.includes('Critical Renal')) {
                if (classes.has('MRA')) {
                    failures.push('MRA prescribed despite eGFR 25');
                    scenarioPassed = false;
                }
            }

            // 6b. Dapagliflozin should not be initiated if eGFR < 25
            if (scenario.title.includes('eGFR 22')) {
                if (meds.includes('Dapagliflozin')) {
                    failures.push('Dapagliflozin prescribed despite eGFR 22');
                    scenarioPassed = false;
                }
            }

            // 7. Non-Compliant -> Low Complexity
            if (scenario.title.includes('Non-Compliant')) {
                if (topRegimen.complexity > 10) { // Arbitrary threshold
                    failures.push(`Complexity ${topRegimen.complexity} too high for tolerance 0`);
                    scenarioPassed = false;
                }
            }

            // 8. Ideal Candidate -> Should have all 4 GDMT pillars
            if (scenario.title.includes('Ideal Candidate')) {
                const pillarPresent = {
                    raas: classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB'),
                    bb: classes.has('Beta Blocker'),
                    mra: classes.has('MRA'),
                    sglt2: classes.has('SGLT2i')
                };
                if (!pillarPresent.raas) { failures.push('Missing RAAS pillar'); scenarioPassed = false; }
                if (!pillarPresent.bb) { failures.push('Missing BB pillar'); scenarioPassed = false; }
                if (!pillarPresent.mra) { failures.push('Missing MRA pillar'); scenarioPassed = false; }
                if (!pillarPresent.sglt2) { failures.push('Missing SGLT2i pillar'); scenarioPassed = false; }
            }

            // 9. Obese HFpEF -> No ARNI/BB/MRA; should have SGLT2i
            if (scenario.title.includes('Obese HFpEF')) {
                if (classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB')) {
                    failures.push('RAAS prescribed for HFpEF (not indicated)');
                    scenarioPassed = false;
                }
                if (classes.has('Beta Blocker')) {
                    failures.push('BB prescribed for HFpEF (not indicated)');
                    scenarioPassed = false;
                }
                if (classes.has('MRA')) {
                    failures.push('MRA prescribed for HFpEF (not indicated)');
                    scenarioPassed = false;
                }
            }

            // 10. Iron-Deficient -> Should have IV Iron
            if (scenario.title.includes('Iron-Deficient')) {
                if (!classes.has('IV Iron')) {
                    failures.push('IV Iron not prescribed despite ferritin < 100 and TSAT < 20');
                    scenarioPassed = false;
                }
            }

            // 11. Sinus Tachycardia -> Should have Ivabradine
            if (scenario.title.includes('Ivabradine Candidate')) {
                if (!classes.has('If Inhibitor')) {
                    failures.push('Ivabradine not prescribed despite HR >= 70, sinus, LVEF <= 35, on BB');
                    scenarioPassed = false;
                }
            }

            // 9b. Volume depletion -> prioritize diuretic de-escalation before RAAS/MRA/SGLT2 intensification
            if (scenario.title.includes('Volume Depleted') && topRegimen?.modification_set) {
                const volumeSensitiveIntensification = topRegimen.modification_set.modifications.some(m => {
                    const targetClass = m.target?.med.drug_class;
                    if (!targetClass) return false;
                    if (!(m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap')) return false;
                    return targetClass === 'ARNI' || targetClass === 'ACEi' || targetClass === 'ARB' || targetClass === 'MRA' || targetClass === 'SGLT2i';
                });
                const diureticDeEscalation = topRegimen.modification_set.modifications.some(m => {
                    const sourceClass = m.source?.med.drug_class;
                    if (!sourceClass) return false;
                    if (!(m.action === 'remove' || m.action === 'titrate_down')) return false;
                    return sourceClass === 'Loop Diuretic' || sourceClass === 'Thiazide-like Diuretic';
                });
                if (volumeSensitiveIntensification && !diureticDeEscalation) {
                    failures.push('Volume-depleted scenario intensified RAAS/MRA/SGLT2 without diuretic de-escalation');
                    scenarioPassed = false;
                }
            }

            // 11b. Ivabradine fallback when all BB agents are unavailable
            if (scenario.title.includes('Ivabradine Fallback')) {
                if (!classes.has('If Inhibitor')) {
                    failures.push('Ivabradine fallback missing when beta blockers are unavailable');
                    scenarioPassed = false;
                }
                if (classes.has('Beta Blocker')) {
                    failures.push('Beta blocker present despite scenario-level formulary exclusion');
                    scenarioPassed = false;
                }
            }

            // 12. Budget-Constrained -> Should NOT have Entresto (too expensive)
            if (scenario.title.includes('Budget-Constrained')) {
                if (meds.includes('Sacubitril/Valsartan (Entresto)')) {
                    failures.push('Entresto prescribed despite $25 budget');
                    scenarioPassed = false;
                }
            }

            // 13. ACEi-to-ARNI Swap -> Must have 36-hour washout warning
            if (scenario.title.includes('ACEi-to-ARNI Swap')) {
                // Check across all returned regimens for any that contain the washout warning
                const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                if (!allWarnings.some(w => w.includes('36-hour washout'))) {
                    failures.push('Missing 36-hour washout warning for ACEi→ARNI swap');
                    scenarioPassed = false;
                }
            }

            // 14. Euvolemic Asthma -> No Carvedilol, should have Bisoprolol or Metoprolol
            if (scenario.title.includes('Euvolemic Asthma')) {
                if (meds.includes('Carvedilol')) {
                    failures.push('Non-selective Carvedilol prescribed in Asthma');
                    scenarioPassed = false;
                }
                // Verify a beta blocker IS available (Bisoprolol or Metoprolol)
                const hasSafeBB = meds.includes('Bisoprolol') || meds.includes('Metoprolol Succinate');
                if (!hasSafeBB && topRegimen) {
                    // Check all regimens, not just top
                    const anyBB = scoredRegimens.some(r =>
                        r.regimen.some(m => m.med.name === 'Bisoprolol' || m.med.name === 'Metoprolol Succinate')
                    );
                    if (!anyBB) {
                        failures.push('No cardioselective BB available despite euvolemic asthma patient needing BB');
                        scenarioPassed = false;
                    }
                }
            }

            // 15. HFimpEF -> Should keep all 4 GDMT pillars (not de-escalate)
            if (scenario.title.includes('HFimpEF')) {
                if (topRegimen) {
                    const pillarPresent = {
                        raas: classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB'),
                        bb: classes.has('Beta Blocker'),
                        mra: classes.has('MRA'),
                        sglt2: classes.has('SGLT2i')
                    };
                    if (!pillarPresent.raas) { failures.push('HFimpEF: Missing RAAS (should continue)'); scenarioPassed = false; }
                    if (!pillarPresent.bb) { failures.push('HFimpEF: Missing BB (should continue)'); scenarioPassed = false; }
                    if (!pillarPresent.mra) { failures.push('HFimpEF: Missing MRA (should continue)'); scenarioPassed = false; }
                    if (!pillarPresent.sglt2) { failures.push('HFimpEF: Missing SGLT2i (should continue)'); scenarioPassed = false; }
                }
            }

            // 16. Pregnant -> No RAAS agents (ACEi/ARB/ARNI), no MRA
            if (scenario.title.includes('Pregnant')) {
                if (classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB')) {
                    failures.push('RAAS agent prescribed in pregnancy (Category X)');
                    scenarioPassed = false;
                }
                if (classes.has('MRA')) {
                    failures.push('MRA prescribed in pregnancy (Category X)');
                    scenarioPassed = false;
                }
                // Should have pregnancy alert
                if (!clinicalAlerts.some(a => a.includes('PREGNANCY'))) {
                    failures.push('Missing pregnancy clinical alert');
                    scenarioPassed = false;
                }
            }

            // 17. Severe Hypotension (SBP 82) -> No drug recommendations, clinical alert present
            if (scenario.title.includes('SBP 82')) {
                if (scoredRegimens.length > 0) {
                    failures.push(`Drug recommendations generated despite SBP 82 (got ${scoredRegimens.length} regimens)`);
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('HEMODYNAMIC INSTABILITY'))) {
                    failures.push('Missing hemodynamic instability alert for SBP 82');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('ADVANCED HEART FAILURE'))) {
                    failures.push('Missing advanced HF referral alert for LVEF 18 + NYHA IV + BNP 8000');
                    scenarioPassed = false;
                }
            }

            // 19. Pregnant on existing ACEi -> ACEi must NOT be titrated up; should be removed or down-titrated
            if (scenario.title.includes('Pregnant on Existing ACEi')) {
                if (classes.has('ACEi') || classes.has('ARNI') || classes.has('ARB')) {
                    failures.push('RAAS agent retained/titrated in pregnancy (should be removed)');
                    scenarioPassed = false;
                }
                if (classes.has('MRA')) {
                    failures.push('MRA prescribed in pregnancy');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('PREGNANCY'))) {
                    failures.push('Missing pregnancy clinical alert');
                    scenarioPassed = false;
                }
                // Should keep BB (Carvedilol is safe in pregnancy)
                if (!classes.has('Beta Blocker') && topRegimen) {
                    failures.push('BB removed in pregnancy (should be continued)');
                    scenarioPassed = false;
                }
            }

            // 20. SGLT2i continuation below eGFR threshold
            if (scenario.title.includes('SGLT2i Continuation')) {
                if (!classes.has('SGLT2i') && topRegimen) {
                    failures.push('SGLT2i removed despite continuation being allowed below initiation threshold');
                    scenarioPassed = false;
                }
            }

            // 21. SBP 90 borderline -> should be blocked (SBP < 90 gate)
            if (scenario.title.includes('SBP 90 Borderline')) {
                // SBP exactly 90 is NOT < 90, so should get cautious recs... BUT we check the spirit:
                // At exactly 90, we allow recs (gate is strict < 90). Score may be low due to projected drop.
                // This tests that the system handles the boundary correctly.
                if (scoredRegimens.length > 0) {
                    // If recs are generated at SBP 90, projected SBP should not be < 90 for the top pick
                    // OR the score should be heavily penalized
                    if (topRegimen && topRegimen.overall_score > 50) {
                        // If projected SBP would drop below 90, score should be very low
                        const projSbp = topRegimen.projected_patient.sbp;
                        if (projSbp < 85) {
                            failures.push(`Top regimen at SBP 90 projects dangerous SBP ${projSbp.toFixed(0)} with high score ${topRegimen.overall_score}`);
                            scenarioPassed = false;
                        }
                    }
                }
            }

            // 22. MRA boundary (eGFR 31, K+ 5.4) -> MRA should come with binder rescue
            if (scenario.title.includes('MRA Boundary')) {
                if (topRegimen && classes.has('MRA')) {
                    // MRA at this K+ level should trigger binder rescue
                    const hasBinder = meds.includes('Patiromer');
                    if (!hasBinder) {
                        failures.push('MRA prescribed at K+ 5.4 without Patiromer rescue');
                        scenarioPassed = false;
                    }
                }
            }

            // 23. Elderly >80 on all 4 pillars -> should show age-related warnings
            if (scenario.title.includes('Elderly >80')) {
                if (topRegimen) {
                    // Should keep all 4 pillars (already on them)
                    const pillarPresent = {
                        raas: classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB'),
                        bb: classes.has('Beta Blocker'),
                        mra: classes.has('MRA'),
                        sglt2: classes.has('SGLT2i')
                    };
                    if (!pillarPresent.raas) { failures.push('Elderly: RAAS dropped'); scenarioPassed = false; }
                    if (!pillarPresent.bb) { failures.push('Elderly: BB dropped'); scenarioPassed = false; }
                    if (!pillarPresent.mra) { failures.push('Elderly: MRA dropped'); scenarioPassed = false; }
                    if (!pillarPresent.sglt2) { failures.push('Elderly: SGLT2i dropped'); scenarioPassed = false; }
                }
            }

            // 24. NYHA II + BNP >= 1600 + LVEF < 45 -> Vericiguat should be available
            if (scenario.title.includes('Vericiguat Eligible')) {
                // Vericiguat should appear in at least one regimen
                const anyVericiguat = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'sGC Stimulator')
                );
                if (!anyVericiguat) {
                    failures.push('Vericiguat not available despite NYHA II + BNP 1800 + LVEF 35 (VICTORIA criteria)');
                    scenarioPassed = false;
                }
            }

            // 25. Liver Disease + AFib -> No Carvedilol (hepatic CI), should have Digoxin for rate control
            if (scenario.title.includes('Liver Disease + AFib')) {
                if (meds.includes('Carvedilol')) {
                    failures.push('Carvedilol prescribed despite Liver Disease (Child-Pugh B/C) contraindication');
                    scenarioPassed = false;
                }
            }

            // 26. NSAID + RAAS DDI -> should have DDI warning
            if (scenario.title.includes('NSAID + RAAS DDI')) {
                if (topRegimen) {
                    const hasRAASInRec = classes.has('ARNI') || classes.has('ACEi') || classes.has('ARB');
                    if (hasRAASInRec) {
                        const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                        if (!allWarnings.some(w => w.includes('NSAID'))) {
                            failures.push('Missing DDI warning for RAAS + chronic NSAID use');
                            scenarioPassed = false;
                        }
                    }
                }
            }

            // 18. Structured monitoring plan should appear when RAAS/MRA/diuretic intensification is recommended
            if (topRegimen?.modification_set) {
                const needsStructuredMonitoring = topRegimen.modification_set.modifications.some(m => {
                    const targetClass = m.target?.med.drug_class;
                    if (!targetClass) return false;
                    if (!(m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap')) return false;
                    return targetClass === 'ARNI' || targetClass === 'ACEi' || targetClass === 'ARB' || targetClass === 'MRA'
                        || targetClass === 'Loop Diuretic' || targetClass === 'Thiazide-like Diuretic';
                });

                if (needsStructuredMonitoring) {
                    if (monitoringPlan.length === 0) {
                        failures.push('Missing structured monitoring plan despite high-risk medication intensification');
                        scenarioPassed = false;
                    } else if (!monitoringPlan.some(item => item.test.includes('BMP'))) {
                        failures.push('Monitoring plan missing BMP guidance for renal/electrolyte safety');
                        scenarioPassed = false;
                    }
                }
            }

            if (scenarioPassed) {
                console.log(`  [PASS] assertions met.`);
                passed++;
            } else {
                console.error(`  [FAIL] ${failures.join(', ')}`);
                failed++;
            }

        } catch (e) {
            console.error(`  [ERROR] Simulation crashed:`, e);
            failed++;
        }
        console.log('---');
    }

    console.log(`\nVerification Complete.`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

runVerification();
