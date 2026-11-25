// Option lists used by validation on the server and served to the UI through /api/meta.
export type Opt = { value: string; label: string; tone?: string };

export const ENUMS: Record<string, Opt[]> = {
  candidate_status: [
    { value: 'selected', label: 'Selected', tone: 'slate' },
    { value: 'pre_arrival', label: 'Pre-arrival Processing', tone: 'blue' },
    { value: 'travel_confirmed', label: 'Travel Confirmed', tone: 'indigo' },
    { value: 'arrived', label: 'Arrived in UAE', tone: 'cyan' },
    { value: 'onboarding', label: 'Onboarding In Progress', tone: 'amber' },
    { value: 'awaiting_clearance', label: 'Awaiting Final Clearance', tone: 'orange' },
    { value: 'ready_for_deployment', label: 'Ready for Deployment', tone: 'emerald' },
    { value: 'deployed', label: 'Deployed', tone: 'green' },
    { value: 'on_hold', label: 'On Hold', tone: 'purple' },
    { value: 'cancelled', label: 'Cancelled', tone: 'red' },
  ],
  gender: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }],
  marital_status: [
    { value: 'single', label: 'Single' }, { value: 'married', label: 'Married' },
    { value: 'divorced', label: 'Divorced' }, { value: 'widowed', label: 'Widowed' },
  ],
  employment_category: [
    { value: 'staff', label: 'Staff' }, { value: 'labour', label: 'Labour / Worker' }, { value: 'professional', label: 'Professional' },
    { value: 'contract', label: 'Contract' }, { value: 'temporary', label: 'Temporary' },
  ],
  contract_status: [
    { value: 'not_prepared', label: 'Not Prepared', tone: 'slate' }, { value: 'prepared', label: 'Prepared', tone: 'blue' },
    { value: 'sent', label: 'Sent to Candidate', tone: 'amber' }, { value: 'signed', label: 'Signed', tone: 'green' },
    { value: 'rejected', label: 'Rejected', tone: 'red' },
  ],
  offer_letter_status: [
    { value: 'not_issued', label: 'Not Issued', tone: 'slate' }, { value: 'issued', label: 'Issued', tone: 'amber' },
    { value: 'accepted', label: 'Accepted', tone: 'green' }, { value: 'declined', label: 'Declined', tone: 'red' },
  ],
  cancel_category: [
    { value: 'rejected_by_company', label: 'Rejected by company' }, { value: 'candidate_withdrew', label: 'Candidate withdrew' },
    { value: 'medical_unfit', label: 'Medically unfit' }, { value: 'visa_rejected', label: 'Visa / permit rejected' },
    { value: 'other', label: 'Other' },
  ],
  trade_category: [
    { value: 'professional', label: 'Professional' }, { value: 'staff', label: 'Staff' }, { value: 'skilled', label: 'Skilled' },
    { value: 'semi_skilled', label: 'Semi-skilled' }, { value: 'unskilled', label: 'Unskilled' }, { value: 'driver', label: 'Driver' },
    { value: 'medical', label: 'Medical' },
  ],
  document_category: [
    { value: 'passport', label: 'Passport' }, { value: 'photograph', label: 'Photograph' }, { value: 'offer_letter', label: 'Offer Letter' },
    { value: 'employment_contract', label: 'Employment Contract' }, { value: 'work_permit', label: 'Work Permit / Entry Permit' },
    { value: 'flight_ticket', label: 'Flight Ticket' }, { value: 'visa_medical', label: 'Visa Medical Fitness Certificate' },
    { value: 'occupational_medical', label: 'Occupational Medical Report' }, { value: 'training_certificate', label: 'Training Certificate' },
    { value: 'mohre_training', label: 'MOHRE Awareness Training Record' }, { value: 'emirates_id', label: 'Emirates ID' },
    { value: 'residence_visa', label: 'Residence Visa' }, { value: 'health_insurance', label: 'Health Insurance Card' }, { value: 'education_certificate', label: 'Education Certificate' },
    { value: 'professional_certificate', label: 'Professional Certificate' }, { value: 'uniform_ppe_ack', label: 'Uniform / PPE Acknowledgement' },
    { value: 'invoice', label: 'Invoice' }, { value: 'other', label: 'Other Document' },
  ],
  booking_status: [
    { value: 'pending_booking', label: 'Pending Booking', tone: 'slate' },
    { value: 'quotation_received', label: 'Quotation Received', tone: 'blue' },
    { value: 'approval_pending', label: 'Approval Pending', tone: 'amber' },
    { value: 'approved', label: 'Approved', tone: 'cyan' },
    { value: 'ticket_booked', label: 'Ticket Booked', tone: 'indigo' },
    { value: 'ticket_issued', label: 'Ticket Issued', tone: 'emerald' },
    { value: 'travel_completed', label: 'Travel Completed', tone: 'green' },
    { value: 'cancelled', label: 'Cancelled', tone: 'red' },
  ],
  pickup_status: [
    { value: 'pending', label: 'Not Assigned', tone: 'red' }, { value: 'assigned', label: 'Assigned', tone: 'blue' },
    { value: 'completed', label: 'Picked Up', tone: 'green' }, { value: 'no_show', label: 'No Show', tone: 'orange' },
    { value: 'cancelled', label: 'Cancelled', tone: 'slate' },
  ],
  airport: [
    { value: 'DXB', label: 'Dubai International (DXB)' }, { value: 'DWC', label: 'Al Maktoum International (DWC)' },
    { value: 'AUH', label: 'Zayed International, Abu Dhabi (AUH)' }, { value: 'SHJ', label: 'Sharjah International (SHJ)' },
    { value: 'RKT', label: 'Ras Al Khaimah International (RKT)' }, { value: 'FJR', label: 'Fujairah International (FJR)' },
  ],
  vehicle_type: [{ value: 'car', label: 'Car' }, { value: 'van', label: 'Van' }, { value: 'minibus', label: 'Minibus' }, { value: 'bus', label: 'Bus' }],
  camp_status: [{ value: 'active', label: 'Active', tone: 'green' }, { value: 'maintenance', label: 'Under Maintenance', tone: 'amber' }, { value: 'closed', label: 'Closed', tone: 'slate' }],
  room_type: [
    { value: 'shared', label: 'Shared' }, { value: 'single', label: 'Single' }, { value: 'double', label: 'Double' },
    { value: 'supervisor', label: 'Supervisor' }, { value: 'family', label: 'Family' },
  ],
  room_gender: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'any', label: 'Any' }],
  allocation_status: [
    { value: 'allocated', label: 'Reserved', tone: 'amber' }, { value: 'checked_in', label: 'Checked In', tone: 'green' },
    { value: 'checked_out', label: 'Checked Out', tone: 'slate' }, { value: 'cancelled', label: 'Cancelled', tone: 'red' },
  ],
  activity_status: [
    { value: 'not_started', label: 'Not Started', tone: 'slate' }, { value: 'pending', label: 'Pending', tone: 'slate' },
    { value: 'in_progress', label: 'In Progress', tone: 'blue' }, { value: 'awaiting_documents', label: 'Awaiting Documents', tone: 'orange' },
    { value: 'awaiting_approval', label: 'Awaiting Approval', tone: 'amber' }, { value: 'completed', label: 'Completed', tone: 'green' },
    { value: 'rejected', label: 'Rejected', tone: 'red' }, { value: 'on_hold', label: 'On Hold', tone: 'purple' },
    { value: 'not_applicable', label: 'Not Applicable', tone: 'slate' },
  ],
  section: [
    { value: 'A', label: 'A. Pre-arrival' }, { value: 'B', label: 'B. Arrival & initial onboarding' }, { value: 'C', label: 'C. Medical & government' },
    { value: 'D', label: 'D. Training & competency' }, { value: 'E', label: 'E. Uniform & identification' }, { value: 'F', label: 'F. Induction & deployment' },
  ],
  training_category: [
    { value: 'technical', label: 'Trade technical' }, { value: 'competency', label: 'Trade competency assessment' }, { value: 'hse', label: 'Occupational Health & Safety' },
    { value: 'mohre', label: 'MOHRE awareness' }, { value: 'company_rules', label: 'Company rules' }, { value: 'emergency', label: 'Emergency procedures' },
    { value: 'client', label: 'Client-specific' },
  ],
  training_status: [
    { value: 'required', label: 'Required', tone: 'slate' }, { value: 'scheduled', label: 'Scheduled', tone: 'blue' },
    { value: 'attended', label: 'Attended', tone: 'cyan' }, { value: 'passed', label: 'Passed', tone: 'green' }, { value: 'failed', label: 'Failed', tone: 'red' },
    { value: 'absent', label: 'Absent', tone: 'orange' }, { value: 'exempted', label: 'Exempted', tone: 'purple' },
  ],
  visa_medical_result: [
    { value: 'pending', label: 'Result pending', tone: 'amber' }, { value: 'fit', label: 'Fit', tone: 'green' },
    { value: 'unfit', label: 'Unfit', tone: 'red' }, { value: 'retest', label: 'Re-test required', tone: 'orange' },
  ],
  occ_fitness: [
    { value: 'pending', label: 'Pending', tone: 'amber' }, { value: 'fit', label: 'Fit', tone: 'green' },
    { value: 'fit_with_restrictions', label: 'Fit with restrictions', tone: 'cyan' }, { value: 'temporarily_unfit', label: 'Temporarily unfit', tone: 'orange' },
    { value: 'unfit', label: 'Unfit', tone: 'red' },
  ],
  residence_status: [
    { value: 'not_started', label: 'Not started', tone: 'slate' }, { value: 'applied', label: 'Applied', tone: 'blue' },
    { value: 'approved', label: 'Approved', tone: 'cyan' }, { value: 'issued', label: 'Issued / stamped', tone: 'green' }, { value: 'rejected', label: 'Rejected', tone: 'red' },
  ],
  uniform_category: [
    { value: 'uniform', label: 'Uniform' }, { value: 'safety_shoes', label: 'Safety shoes' }, { value: 'ppe', label: 'PPE' }, { value: 'id_card', label: 'ID card' },
  ],
  expense_category: [
    { value: 'recruitment_fee', label: 'Recruitment agency fees' }, { value: 'flight_ticket', label: 'Flight ticket' },
    { value: 'airport_transport', label: 'Airport transportation' }, { value: 'visa_processing', label: 'Visa processing' },
    { value: 'medical_exam', label: 'Medical examination' }, { value: 'health_insurance', label: 'Health insurance' }, { value: 'emirates_id', label: 'Emirates ID' },
    { value: 'occupational_medical', label: 'Occupational medical examination' }, { value: 'training', label: 'Training expenses' },
    { value: 'accommodation', label: 'Accommodation expenses' }, { value: 'uniform_ppe', label: 'Uniform and PPE' },
    { value: 'other', label: 'Other mobilisation expenses' },
  ],
  payment_status: [{ value: 'unpaid', label: 'Unpaid', tone: 'red' }, { value: 'partially_paid', label: 'Partially paid', tone: 'amber' }, { value: 'paid', label: 'Paid', tone: 'green' }],
  verification_status: [{ value: 'pending', label: 'Pending verification', tone: 'amber' }, { value: 'verified', label: 'Verified', tone: 'green' }, { value: 'rejected', label: 'Rejected', tone: 'red' }],
  deployment_status: [
    { value: 'requested', label: 'Awaiting approval', tone: 'amber' }, { value: 'approved', label: 'Approved — awaiting reporting', tone: 'cyan' },
    { value: 'rejected', label: 'Rejected', tone: 'red' }, { value: 'reported', label: 'Reported to work', tone: 'green' }, { value: 'cancelled', label: 'Cancelled', tone: 'slate' },
  ],
  notification_type: [
    { value: 'upcoming_travel', label: 'Upcoming travel' }, { value: 'booking_pending', label: 'Flight booking pending' },
    { value: 'pickup_unassigned', label: 'Airport pickup not assigned' }, { value: 'accommodation_missing', label: 'Accommodation not allocated' },
    { value: 'medical_pending', label: 'Medical appointment pending' }, { value: 'medical_overdue', label: 'Medical examination overdue' },
    { value: 'visa_delay', label: 'Visa processing delay' }, { value: 'training_overdue', label: 'Training not completed' },
    { value: 'uniform_overdue', label: 'Uniform / PPE not distributed' }, { value: 'activity_reminder', label: 'Activity due' },
    { value: 'activity_overdue', label: 'Activity overdue' }, { value: 'passport_expiry', label: 'Passport approaching expiry' },
    { value: 'document_expiry', label: 'Document expiring' }, { value: 'clearance_pending', label: 'Awaiting final clearance' },
    { value: 'ready_for_deployment', label: 'Ready for deployment' }, { value: 'approval_pending', label: 'Approval waiting for you' },
  ],
  emirate: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'].map((e) => ({ value: e, label: e })),
};

export const COUNTRIES = [
  'Afghanistan', 'Algeria', 'Bahrain', 'Bangladesh', 'Bhutan', 'Cameroon', 'China', 'Egypt', 'Eritrea', 'Ethiopia', 'Ghana', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Lebanon', 'Malaysia', 'Morocco', 'Myanmar',
  'Nepal', 'Nigeria', 'Oman', 'Pakistan', 'Palestine', 'Philippines', 'Qatar', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Sierra Leone',
  'Somalia', 'South Africa', 'Sri Lanka', 'Sudan', 'Syria', 'Tajikistan', 'Tanzania', 'Thailand', 'Tunisia', 'Turkey', 'Turkmenistan',
  'Uganda', 'United Arab Emirates', 'United Kingdom', 'Uzbekistan', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

export const label = (list: string, value: unknown) => ENUMS[list]?.find((o) => o.value === value)?.label ?? (value == null ? '' : String(value));

/** Statuses that later phases set through their own workflows; not selectable by hand. */
export const WORKFLOW_STATUSES = ['travel_confirmed', 'arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed'];
