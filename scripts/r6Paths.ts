/**
 * The paths that end with no ranked option (and the full path for comparison), applied to a generated patient. Shared by the round 6 screen checks and the round 6 sweeps.
 */
import type { Patient } from '../types';

export const NO_OPTION_PATHS: Array<[string, (p: Patient) => void]> = [
    ['full', p => { p.scope_conditions = new Set(); }],
    ['scope_unanswered', p => { p.scope_conditions = undefined; }],
    ['input_error', p => { p.cost_sensitivity = -1; }],
    ['limited_review', p => { p.age = 0; }],
    ['sbp_le_dbp', p => { p.sbp = Math.min(p.sbp || 100, 110); p.dbp = p.sbp + 5; }],
    ['sbp_blank', p => { p.sbp = 0; }],
    ['implausible_lvef', p => { p.lvef = 250; }],
    ['implausible_egfr', p => { p.egfr = 500; }],
    ['stop_k68', p => { p.potassium = 6.8; }],
    ['stop_sbp84', p => { p.sbp = 84; p.dbp = 50; }],
    ['stop_block3', p => { p.rhythm = '3rd Degree AV Block'; }],
    ['stop_preg', p => { p.sex = 'Female'; p.is_pregnant = true; }],
    ['scope_ticked', p => { p.scope_conditions = new Set(['Dialysis']); }],
];
