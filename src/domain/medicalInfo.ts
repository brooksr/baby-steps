// Privacy-safe placeholders for a new install. Key Info persists the household's
// actual care team and addresses on the profile instead of shipping them here.

export interface Place {
  name: string;
  address: string;
  directionsUrl: string;
  note?: string;
}

export const HOSPITAL: Place = {
  address: '',
  directionsUrl: '',
  name: 'Birth hospital'
};

export const OB: Place = {
  address: '',
  directionsUrl: '',
  name: 'OB / Obstetrician'
};

export interface ContactLine {
  title: string;
  detail: string;
  /** Optional tel: number (digits only) for a tappable call link. */
  tel?: string;
}

// Public emergency lines (United States) — safe to include verbatim.
export const EMERGENCY_LINES: ContactLine[] = [
  { detail: 'Call 911', tel: '911', title: 'Emergencies' },
  { detail: '1-800-222-1222', tel: '18002221222', title: 'Poison Control (US)' }
];

// Prompts for information worth keeping on hand — fill these into a Note for now.
export const INFO_TO_HAVE: ContactLine[] = [
  { detail: 'Office number and the after-hours / nurse advice line.', title: 'Pediatrician' },
  { detail: "Labor & delivery and postpartum unit phone numbers.", title: 'Birth hospital units' },
  { detail: 'Breastfeeding support / IBCLC contact.', title: 'Lactation consultant' },
  { detail: 'Name, phone, and hours of your usual pharmacy.', title: 'Pharmacy' },
  { detail: 'Plan name, member ID, and member-services number.', title: 'Health insurance' },
  { detail: "Baby's blood type, birth weight, and any conditions or allergies.", title: 'Baby details' },
  { detail: "Mother's OB, allergies, blood type, and current medications.", title: 'Mother details' },
  { detail: 'Two people who can be reached quickly in an emergency.', title: 'Emergency contacts' }
];
