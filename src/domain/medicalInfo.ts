// Quick-reference medical info to have on hand. The hospital/OB/home values are
// fixed for this family; the "to have on hand" list is a set of prompts for
// information worth gathering (kept here, not as personal data in the repo).
//
// V2: make these editable and persisted on the profile rather than hard-coded.

export const HOME_ADDRESS = '751 Benson Way, Thousand Oaks, CA 91360';

function directionsFromHome(destination: string) {
  const params = new URLSearchParams({ api: '1', destination, origin: HOME_ADDRESS, travelmode: 'driving' });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface Place {
  name: string;
  address: string;
  directionsUrl: string;
  note?: string;
}

export const HOSPITAL: Place = {
  address: '215 W Janss Rd, Thousand Oaks, CA 91360',
  // Exact route the family shared (home → Los Robles ER / helipad).
  directionsUrl:
    'https://www.google.com/maps/dir/751+Benson+Way,+Thousand+Oaks,+CA+91360/Los+Robles+Medical+Center+-+Helipad,+215+W+Janss+Rd,+Thousand+Oaks,+CA+91360/@34.1944053,-118.8800281,3402m/data=!3m3!1e3!4b1!5s0x80e8267a489f18cd:0x551c573cc86abde0!4m14!4m13!1m5!1m1!1s0x80e83ab210323533:0x76f8f11d70aa6eca!2m2!1d-118.8646287!2d34.1862463!1m5!1m1!1s0x80e8306cb3109b75:0x891bb15898eb478f!2m2!1d-118.8831032!2d34.206836!3e0',
  name: 'Los Robles Medical Center — ER',
  note: '≈ 8 min from home'
};

export const OB: Place = {
  address: '32144 Agoura Rd, Westlake Village, CA 91361',
  directionsUrl: directionsFromHome('32144 Agoura Rd, Westlake Village, CA 91361'),
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
