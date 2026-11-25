// Core onboarding activity catalogue (Module 4). Seeded once; administrators may edit department, offsets
// and rules afterwards. `workflow` links an activity to the module that completes it automatically.
type Def = [seq: number, section: string, name: string, dept: string, mandatory: boolean, doc: string | null, verify: boolean,
  anchor: 'selection' | 'arrival', offset: number, workflow: string | null];

export const ACTIVITY_CATALOGUE: Def[] = [
  // A. Pre-arrival
  [1, 'A', 'Candidate selection confirmation', 'REC', true, null, false, 'selection', 0, null],
  [2, 'A', 'Personal information verification', 'HR', true, null, true, 'selection', 3, null],
  [3, 'A', 'Passport verification', 'PRO', true, 'passport', true, 'selection', 3, null],
  [4, 'A', 'Employment offer approval', 'HR', true, null, false, 'selection', 5, 'offer_accepted'],
  [5, 'A', 'Employment contract preparation', 'HR', true, null, false, 'selection', 7, 'contract_prepared'],
  [6, 'A', 'Employment contract signing', 'HR', true, 'employment_contract', false, 'selection', 12, 'contract_signed'],
  [7, 'A', 'Work permit / entry permit processing', 'PRO', true, 'work_permit', false, 'arrival', -14, 'entry_permit'],
  [8, 'A', 'Flight booking', 'MOB', true, null, false, 'arrival', -7, 'ticket_issued'],
  [9, 'A', 'Airport pickup arrangement', 'MOB', true, null, false, 'arrival', -2, 'pickup_assigned'],
  [10, 'A', 'Accommodation allocation', 'ACC', true, null, false, 'arrival', -3, 'bed_allocated'],
  // B. Arrival & initial onboarding
  [11, 'B', 'Employee arrival confirmation', 'MOB', true, null, false, 'arrival', 0, 'arrived'],
  [12, 'B', 'Airport pickup confirmation', 'MOB', true, null, false, 'arrival', 0, 'pickup_completed'],
  [13, 'B', 'Accommodation check-in', 'ACC', true, null, false, 'arrival', 0, 'checked_in'],
  [14, 'B', 'Original document collection', 'HR', true, null, true, 'arrival', 1, null],
  [15, 'B', 'Employee file creation', 'HR', true, null, true, 'arrival', 2, null],
  [16, 'B', 'HR registration', 'HR', true, null, false, 'arrival', 2, 'hr_registration'],
  // C. Medical & government formalities
  [17, 'C', 'UAE visa medical fitness examination', 'MED', true, null, false, 'arrival', 3, 'visa_medical_attended'],
  [18, 'C', 'Medical fitness result verification', 'MED', true, 'visa_medical', false, 'arrival', 6, 'visa_medical_fit'],
  [19, 'C', 'Health insurance card application and issuance', 'PRO', true, 'health_insurance', false, 'arrival', 6, 'health_insurance'],
  [20, 'C', 'Occupational health medical examination', 'MED', true, null, false, 'arrival', 5, 'occ_exam'],
  [21, 'C', 'Occupational medical fitness report', 'MED', true, 'occupational_medical', false, 'arrival', 8, 'occ_report'],
  [22, 'C', 'Residence visa application processing', 'PRO', true, null, false, 'arrival', 7, 'residence_applied'],
  [23, 'C', 'Emirates ID application and biometrics', 'PRO', true, null, false, 'arrival', 10, 'eid_biometrics'],
  [24, 'C', 'Residence visa issuance / stamping', 'PRO', true, 'residence_visa', false, 'arrival', 20, 'residence_issued'],
  [25, 'C', 'Emirates ID collection and verification', 'PRO', true, 'emirates_id', false, 'arrival', 30, 'eid_collected'],
  // D. Training & competency
  [26, 'D', 'Trade-specific technical training', 'TRN', true, null, false, 'arrival', 10, 'training:technical'],
  [27, 'D', 'Trade competency assessment', 'TRN', true, null, false, 'arrival', 12, 'training:competency'],
  [28, 'D', 'Occupational Health & Safety training', 'TRN', true, null, false, 'arrival', 5, 'training:hse'],
  [29, 'D', 'MOHRE awareness training', 'TRN', true, 'mohre_training', false, 'arrival', 7, 'training:mohre'],
  [30, 'D', 'Company rules and regulations awareness', 'TRN', true, null, false, 'arrival', 4, 'training:company_rules'],
  [31, 'D', 'Emergency procedures and safety awareness', 'TRN', true, null, false, 'arrival', 5, 'training:emergency'],
  [32, 'D', 'Client-specific training', 'TRN', true, null, false, 'arrival', 14, 'training:client'],
  [33, 'D', 'Training assessment and result verification', 'TRN', true, null, false, 'arrival', 15, 'training:all'],
  // E. Uniform & identification
  [34, 'E', 'Uniform measurement', 'ADM', true, null, false, 'arrival', 1, 'measurement'],
  [35, 'E', 'Uniform distribution', 'ADM', true, null, false, 'arrival', 3, 'issue:uniform'],
  [36, 'E', 'Safety shoes distribution', 'ADM', true, null, false, 'arrival', 3, 'issue:safety_shoes'],
  [37, 'E', 'PPE distribution', 'ADM', true, null, false, 'arrival', 3, 'issue:ppe'],
  [38, 'E', 'Employee ID card preparation', 'ADM', true, null, false, 'arrival', 5, null],
  [39, 'E', 'Employee ID card distribution', 'ADM', true, null, false, 'arrival', 7, 'issue:id_card'],
  // F. Induction & deployment
  [40, 'F', 'Company induction', 'HR', true, null, true, 'arrival', 2, null],
  [41, 'F', 'HR policies and procedures briefing', 'HR', true, null, false, 'arrival', 3, null],
  [42, 'F', 'Attendance and timesheet awareness', 'HR', true, null, false, 'arrival', 3, null],
  [43, 'F', 'Payroll and salary awareness', 'HR', true, null, false, 'arrival', 3, null],
  [44, 'F', 'Leave and disciplinary policy awareness', 'HR', true, null, false, 'arrival', 3, null],
  [45, 'F', 'Reporting structure introduction', 'OPS', true, null, false, 'arrival', 4, null],
  [46, 'F', 'Project / site-specific induction', 'OPS', true, null, true, 'arrival', 16, null],
  [47, 'F', 'Final onboarding clearance', 'HR', true, null, false, 'arrival', 18, 'clearance'],
  [48, 'F', 'Deployment approval', 'HR', true, null, false, 'arrival', 19, 'deployment_approval'],
  [49, 'F', 'Actual reporting to work confirmation', 'OPS', true, null, false, 'arrival', 21, 'deployed'],
];

export const SECTIONS: Record<string, string> = {
  A: 'Pre-arrival', B: 'Arrival & initial onboarding', C: 'Medical & government formalities',
  D: 'Training & competency', E: 'Uniform & identification', F: 'Induction & deployment',
};

/** Activities handled by the Phase 4 clearance & deployment workflow; locked in the checklist. */
export const CLEARANCE_KEYS = ['clearance', 'deployment_approval', 'deployed'];
/** Workflow-linked activities that people complete through a dedicated action instead of the generic form. */
export const MANUAL_WORKFLOW_KEYS = ['hr_registration'];

export const TRAINING_CATEGORY_ACTIVITY: Record<string, number> = {
  technical: 26, competency: 27, hse: 28, mohre: 29, company_rules: 30, emergency: 31, client: 32,
};

export const DEFAULT_COURSES: [code: string, name: string, category: string, hours: number, validity: number | null][] = [
  ['HSE-IND', 'General HSE & Workplace Safety Induction', 'hse', 8, 24],
  ['MOHRE-AW', 'MOHRE Labour Law & Worker Rights Awareness', 'mohre', 3, null],
  ['CO-RULES', 'Company Rules, Code of Conduct & Regulations', 'company_rules', 2, null],
  ['EMERG', 'Emergency Procedures, Fire Safety & First Response', 'emergency', 3, 12],
  ['DEF-DRV', 'Defensive Driving', 'technical', 8, 36],
  ['VEH-SAFE', 'Vehicle & Road Safety (UAE traffic rules)', 'technical', 4, 24],
  ['SCAF-SAFE', 'Scaffolding Safety', 'technical', 16, 36],
  ['SCAF-COMP', 'Scaffolding Competency Assessment', 'competency', 4, 36],
  ['RIG-LIFT', 'Rigging & Lifting Safety', 'technical', 16, 36],
  ['RIG-COMP', 'Rigger / Banksman Competency Assessment', 'competency', 4, 36],
  ['ELEC-LOTO', 'Electrical Safety & Lock-out / Tag-out', 'technical', 8, 24],
  ['MECH-SAFE', 'Mechanical Maintenance Safety', 'technical', 8, 24],
  ['WELD-HOT', 'Hot Work & Welding Safety', 'technical', 8, 24],
  ['WELD-TEST', 'Welder Qualification Test (6G)', 'competency', 6, 24],
  ['NURSE-BLS', 'Basic Life Support (BLS)', 'technical', 6, 24],
  ['NURSE-DHA', 'DHA Licensing & Professional Compliance Orientation', 'competency', 4, null],
  ['CLIENT-ADNOC', 'Client HSE Passport (Oil & Gas site access)', 'client', 8, 24],
];

export const DEFAULT_UNIFORM_ITEMS: [name: string, category: string, needsSize: boolean, qty: number][] = [
  ['Company coverall', 'uniform', true, 2], ['Work shirt & trousers', 'uniform', true, 2], ['Safety shoes', 'safety_shoes', true, 1],
  ['Safety helmet', 'ppe', false, 1], ['Safety glasses', 'ppe', false, 1], ['Hi-vis vest', 'ppe', true, 1], ['Work gloves', 'ppe', false, 2],
  ['Ear plugs', 'ppe', false, 1], ['Employee ID card', 'id_card', false, 1],
];
