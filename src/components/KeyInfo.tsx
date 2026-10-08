import { Bed, Milk, Navigation, Pencil, Phone, Pill, Stethoscope, Wind, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { getCaregivers } from '../domain/family';
import { HOSPITAL, OB } from '../domain/medicalInfo';
import { parentRoleLabels, type BabyProfile, type CareContact, type CareInfo, type FeedingType, type MeasurementSystem } from '../domain/types';
import { formatVolume, getPreferredUnits, toStoredVolume, toUnitVolume } from '../domain/units';

interface KeyInfoProps {
  profile: BabyProfile;
  /** Everyone tracked — the parents among them are the guardians. */
  profiles?: BabyProfile[];
  onSave: (patch: Partial<BabyProfile>) => Promise<void>;
}

/**
 * The guardians are the parent profiles, so the two records cannot drift apart.
 * A household that has not added parents yet still sees whatever the old
 * `careInfo.guardians` list holds — those rows are still in the sheet, and this
 * card is the wrong place to lose a phone number from.
 */
function getGuardians(profiles: BabyProfile[], info: CareInfo): CareContact[] {
  const parents = getCaregivers(profiles);

  if (parents.length > 0) {
    return parents.map((parent) => ({
      // The role rides along in the name, which is the only line this card
      // gives a contact — "Casey Example · Mom" reads the way you would say it.
      name: parent.parentRole ? `${parent.name} · ${parentRoleLabels[parent.parentRole]}` : parent.name,
      phone: parent.phone
    }));
  }

  return info.guardians ?? [];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function mapsUrl(to: string, from?: string): string {
  if (!to) return '#';
  if (from) {
    const params = new URLSearchParams({ api: '1', destination: to, origin: from, travelmode: 'driving' });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(to)}`;
}

const FEEDING_LABELS: Record<FeedingType, string> = {
  breastmilk: 'Breast milk',
  combination: 'Combination',
  formula: 'Formula'
};

// ── read-view sub-components ──────────────────────────────────────────────────

/**
 * `role` says what the contact *is* — "Pediatrician", "Pharmacy" — above the
 * name, since a name alone ("Dr. Patel", "CVS") leaves the reader guessing.
 */
function ContactCard({ contact, icon, role, urgent, homeAddress }: {
  contact: CareContact;
  icon?: React.ReactNode;
  role?: string;
  urgent?: boolean;
  homeAddress?: string;
}) {
  return (
    <article className={`status-row ${urgent ? 'urgent' : ''}`}>
      {icon ?? <Stethoscope aria-hidden="true" />}
      <div>
        {role && <small className="contact-role">{role}</small>}
        <strong>{contact.name}</strong>
        {contact.address && <span>{contact.address}</span>}
        <div className="care-actions">
          {contact.address && (
            <a className="primary-button compact info-directions" href={mapsUrl(contact.address, homeAddress)} target="_blank" rel="noreferrer">
              <Navigation aria-hidden="true" />
              <span>Directions</span>
            </a>
          )}
          {contact.phone && (
            <a className="secondary-button compact info-directions" href={`tel:${contact.phone.replace(/\D/g, '')}`}>
              <Phone aria-hidden="true" />
              <span>{contact.phone}</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function InfoCard({ icon, role, title, lines }: { icon: React.ReactNode; role?: string; title: string; lines: (string | undefined)[] }) {
  const visible = lines.filter(Boolean) as string[];
  if (visible.length === 0) return null;
  return (
    <article className="status-row">
      {icon}
      <div>
        {role && <small className="contact-role">{role}</small>}
        <strong>{title}</strong>
        {visible.map((line, i) => <span key={i}>{line}</span>)}
      </div>
    </article>
  );
}

// ── form sub-components ───────────────────────────────────────────────────────

function Field({ label, name, value, onChange, placeholder, type = 'text' }: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label>
      {label}
      <input type={type} name={name} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextareaField({ label, name, value, onChange, placeholder }: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="form-grid-wide">
      {label}
      <textarea name={name} value={value} placeholder={placeholder} rows={3}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="form-grid-wide care-form-section"><strong>{children}</strong></div>;
}

// ── initial draft from profile ────────────────────────────────────────────────

function makeDraft(info: CareInfo, unitSystem: MeasurementSystem) {
  return {
    homeAddress: info.homeAddress ?? '',
    // care team
    hospitalName: info.hospital?.name ?? HOSPITAL.name,
    hospitalAddress: info.hospital?.address ?? HOSPITAL.address,
    obName: info.ob?.name ?? OB.name,
    obPhone: info.ob?.phone ?? '',
    obAddress: info.ob?.address ?? OB.address,
    pedName: info.pediatrician?.name ?? '',
    pedPhone: info.pediatrician?.phone ?? '',
    pedAddress: info.pediatrician?.address ?? '',
    lactName: info.lactation?.name ?? '',
    lactPhone: info.lactation?.phone ?? '',
    pharmName: info.pharmacy?.name ?? '',
    pharmPhone: info.pharmacy?.phone ?? '',
    // backup contacts
    ec1Name: info.emergencyContacts?.[0]?.name ?? '',
    ec1Phone: info.emergencyContacts?.[0]?.phone ?? '',
    ec2Name: info.emergencyContacts?.[1]?.name ?? '',
    ec2Phone: info.emergencyContacts?.[1]?.phone ?? '',
    // insurance + baby
    insurancePlan: info.insurance?.plan ?? '',
    insuranceMemberId: info.insurance?.memberId ?? '',
    insurancePhone: info.insurance?.phone ?? '',
    babyBloodType: info.babyBloodType ?? '',
    babyAllergies: info.babyAllergies ?? '',
    // feeding
    feedingType: info.feedingType ?? '' as FeedingType | '',
    formulaBrand: info.formulaBrand ?? '',
    bottleAmountOz: info.bottleAmountOz != null
      ? String(Number(toUnitVolume(info.bottleAmountOz, unitSystem).toFixed(unitSystem === 'metric' ? 0 : 2)))
      : '',
    feedingNotes: info.feedingNotes ?? '',
    // sleep
    safeSleep: info.safeSleep ?? '',
    sleepRoutine: info.sleepRoutine ?? '',
    soothingMethods: info.soothingMethods ?? '',
    // meds + skin
    currentMedications: info.currentMedications ?? '',
    skinNotes: info.skinNotes ?? ''
  };
}

type Draft = ReturnType<typeof makeDraft>;

function draftToCareInfo(d: Draft, unitSystem: MeasurementSystem, existing: CareInfo): CareInfo {
  const ec: CareContact[] = [];
  if (d.ec1Name) ec.push({ name: d.ec1Name, phone: d.ec1Phone || undefined });
  if (d.ec2Name) ec.push({ name: d.ec2Name, phone: d.ec2Phone || undefined });

  return {
    homeAddress: d.homeAddress || undefined,
    // Carried through untouched: the guardians are the parent profiles now, but
    // an old list is still someone's stored data and this form no longer edits it.
    guardians: existing.guardians,
    hospital: d.hospitalName ? { name: d.hospitalName, address: d.hospitalAddress || undefined } : undefined,
    ob: d.obName ? { name: d.obName, phone: d.obPhone || undefined, address: d.obAddress || undefined } : undefined,
    pediatrician: d.pedName ? { name: d.pedName, phone: d.pedPhone || undefined, address: d.pedAddress || undefined } : undefined,
    lactation: d.lactName ? { name: d.lactName, phone: d.lactPhone || undefined } : undefined,
    pharmacy: d.pharmName ? { name: d.pharmName, phone: d.pharmPhone || undefined } : undefined,
    emergencyContacts: ec.length ? ec : undefined,
    insurance: d.insurancePlan ? { plan: d.insurancePlan, memberId: d.insuranceMemberId, phone: d.insurancePhone } : undefined,
    babyBloodType: d.babyBloodType || undefined,
    babyAllergies: d.babyAllergies || undefined,
    feedingType: (d.feedingType || undefined) as FeedingType | undefined,
    formulaBrand: d.formulaBrand || undefined,
    bottleAmountOz: d.bottleAmountOz ? toStoredVolume(Number(d.bottleAmountOz), unitSystem) : undefined,
    feedingNotes: d.feedingNotes || undefined,
    safeSleep: d.safeSleep || undefined,
    sleepRoutine: d.sleepRoutine || undefined,
    soothingMethods: d.soothingMethods || undefined,
    currentMedications: d.currentMedications || undefined,
    skinNotes: d.skinNotes || undefined
  };
}

// ── main component ────────────────────────────────────────────────────────────

export function KeyInfo({ profile, profiles = [], onSave }: KeyInfoProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const info = profile.careInfo ?? {};
  const preferredUnits = getPreferredUnits(profile);
  const unitSystem = preferredUnits.system;
  const metric = unitSystem === 'metric';
  const [d, setD] = useState<Draft>(() => makeDraft(info, unitSystem));

  const set = (key: keyof Draft) => (v: string) => setD((prev) => ({ ...prev, [key]: v }));

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ careInfo: draftToCareInfo(d, unitSystem, info) });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit() {
    setD(makeDraft(profile.careInfo ?? {}, unitSystem));
    setEditing(true);
  }

  // ── edit form ───────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <section className="section-block">
        <div className="section-heading">
          <h2>Key info</h2>
          <button type="button" className="icon-button subtle" onClick={() => setEditing(false)} aria-label="Cancel">
            <X aria-hidden="true" />
          </button>
        </div>

        <form className="form-grid" onSubmit={handleSave}>

          <SectionLabel>Home</SectionLabel>
          <Field label="Home address" name="homeAddress" value={d.homeAddress} onChange={set('homeAddress')}
            placeholder="123 Main St, City, ST 00000" />
          <div />

          <SectionLabel>Parents / guardians</SectionLabel>
          <p className="field-note form-grid-wide">
            Parents are people the tracker knows — add them under Settings → Family, with a phone number, and they show
            here. That way one record covers the guardian list, the switcher, and the "Logged by" picker.
          </p>

          <SectionLabel>ER / Hospital</SectionLabel>
          <Field label="Name" name="hospitalName" value={d.hospitalName} onChange={set('hospitalName')} />
          <Field label="Address" name="hospitalAddress" value={d.hospitalAddress} onChange={set('hospitalAddress')} />

          <SectionLabel>Pediatrician</SectionLabel>
          <Field label="Name" name="pedName" value={d.pedName} onChange={set('pedName')} />
          <Field label="Phone" name="pedPhone" value={d.pedPhone} onChange={set('pedPhone')} placeholder="(000) 000-0000" />
          <Field label="Address" name="pedAddress" value={d.pedAddress} onChange={set('pedAddress')} />
          <div />

          <SectionLabel>OB / Midwife</SectionLabel>
          <Field label="Name" name="obName" value={d.obName} onChange={set('obName')} />
          <Field label="Phone" name="obPhone" value={d.obPhone} onChange={set('obPhone')} placeholder="(000) 000-0000" />
          <Field label="Address" name="obAddress" value={d.obAddress} onChange={set('obAddress')} />
          <div />

          <SectionLabel>Lactation consultant</SectionLabel>
          <Field label="Name" name="lactName" value={d.lactName} onChange={set('lactName')} />
          <Field label="Phone" name="lactPhone" value={d.lactPhone} onChange={set('lactPhone')} placeholder="(000) 000-0000" />

          <SectionLabel>Pharmacy</SectionLabel>
          <Field label="Name" name="pharmName" value={d.pharmName} onChange={set('pharmName')} />
          <Field label="Phone" name="pharmPhone" value={d.pharmPhone} onChange={set('pharmPhone')} placeholder="(000) 000-0000" />

          <SectionLabel>Backup emergency contacts</SectionLabel>
          <Field label="Contact 1 name" name="ec1Name" value={d.ec1Name} onChange={set('ec1Name')} />
          <Field label="Phone" name="ec1Phone" value={d.ec1Phone} onChange={set('ec1Phone')} placeholder="(000) 000-0000" />
          <Field label="Contact 2 name" name="ec2Name" value={d.ec2Name} onChange={set('ec2Name')} />
          <Field label="Phone" name="ec2Phone" value={d.ec2Phone} onChange={set('ec2Phone')} placeholder="(000) 000-0000" />

          <SectionLabel>Health insurance</SectionLabel>
          <Field label="Plan name" name="insurancePlan" value={d.insurancePlan} onChange={set('insurancePlan')} />
          <Field label="Member ID" name="insuranceMemberId" value={d.insuranceMemberId} onChange={set('insuranceMemberId')} />
          <Field label="Member services phone" name="insurancePhone" value={d.insurancePhone} onChange={set('insurancePhone')} placeholder="(000) 000-0000" />
          <div />

          <SectionLabel>Baby health</SectionLabel>
          <Field label="Blood type" name="babyBloodType" value={d.babyBloodType} onChange={set('babyBloodType')} placeholder="e.g. A+" />
          <Field label="Allergies / conditions" name="babyAllergies" value={d.babyAllergies} onChange={set('babyAllergies')} />

          <SectionLabel>Feeding</SectionLabel>
          <label className="form-grid-wide">
            Feeding type
            <select value={d.feedingType} onChange={(e) => set('feedingType')(e.target.value)}>
              <option value="">— select —</option>
              <option value="breastmilk">Breast milk</option>
              <option value="formula">Formula</option>
              <option value="combination">Combination</option>
            </select>
          </label>
          {(d.feedingType === 'formula' || d.feedingType === 'combination') && (
            <Field label="Formula brand / type" name="formulaBrand" value={d.formulaBrand} onChange={set('formulaBrand')}
              placeholder="e.g. Similac Pro-Advance" />
          )}
          <Field label={`Typical bottle amount (${metric ? 'mL' : 'oz'})`} name="bottleAmountOz" value={d.bottleAmountOz}
            onChange={set('bottleAmountOz')} type="number" placeholder={metric ? 'e.g. 120' : 'e.g. 4'} />
          <TextareaField label="Feeding notes" name="feedingNotes" value={d.feedingNotes} onChange={set('feedingNotes')}
            placeholder="Schedule, burping method, positions, reflux notes…" />

          <SectionLabel>Sleep &amp; soothing</SectionLabel>
          <TextareaField label="Safe sleep setup" name="safeSleep" value={d.safeSleep} onChange={set('safeSleep')}
            placeholder="Back to sleep, firm mattress, no loose bedding, room-share without bed-share…" />
          <TextareaField label="Bedtime routine" name="sleepRoutine" value={d.sleepRoutine} onChange={set('sleepRoutine')}
            placeholder="Bath at 7 pm, nurse, white noise, swaddle…" />
          <TextareaField label="Soothing methods" name="soothingMethods" value={d.soothingMethods} onChange={set('soothingMethods')}
            placeholder="Pacifier, rocking, specific song, walk in carrier…" />

          <SectionLabel>Current medications</SectionLabel>
          <TextareaField label="Standing medications" name="currentMedications" value={d.currentMedications}
            onChange={set('currentMedications')}
            placeholder="Vitamin D — 400 IU, 1 drop daily at 9 am&#10;(list name, dose, and schedule for each)" />

          <SectionLabel>Skin &amp; diapering</SectionLabel>
          <TextareaField label="Diapering &amp; skin notes" name="skinNotes" value={d.skinNotes} onChange={set('skinNotes')}
            placeholder="Size 1 diapers, Pampers Swaddlers, Aquaphor for rash, fragrance-free wipes only…" />

          <button className="primary-button form-grid-wide" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save care info'}
          </button>
        </form>
      </section>
    );
  }

  // ── read view ───────────────────────────────────────────────────────────────

  const home = info.homeAddress;
  const hospital = info.hospital ?? { name: HOSPITAL.name, address: HOSPITAL.address };
  const ob = info.ob ?? { name: OB.name, address: OB.address };
  const guardians = getGuardians(profiles, info);
  const hasAnyData = Boolean(guardians.length || info.pediatrician || info.feedingType ||
    info.safeSleep || info.currentMedications || info.skinNotes);

  return (
    <section className="section-block">
      <div className="section-heading">
        <div>
          <h2>Key info</h2>
          <span>Have these ready before you need them</span>
        </div>
        <button type="button" className="icon-button" onClick={handleEdit} aria-label="Edit care info">
          <Pencil aria-hidden="true" />
        </button>
      </div>

      <div className="status-list">
        {guardians.map((guardian) => (
          <ContactCard key={guardian.name} contact={guardian} icon={<Phone aria-hidden="true" />} />
        ))}

        <ContactCard contact={hospital} role="ER / Hospital" urgent homeAddress={home} />

        {info.pediatrician && <ContactCard contact={info.pediatrician} role="Pediatrician" homeAddress={home} />}

        <ContactCard contact={ob} role="OB / Midwife" homeAddress={home} />

        {info.emergencyContacts?.map((ec, i) => (
          <ContactCard key={i} contact={ec} role="Backup emergency contact" icon={<Phone aria-hidden="true" />} />
        ))}
      </div>

      {(info.feedingType || info.feedingNotes || info.safeSleep || info.sleepRoutine ||
        info.soothingMethods || info.currentMedications || info.skinNotes ||
        info.insurance || info.babyBloodType || info.babyAllergies || info.lactation || info.pharmacy) && (
        <div className="status-list care-secondary">
          {info.feedingType && (
            <InfoCard icon={<Milk aria-hidden="true" />} title={FEEDING_LABELS[info.feedingType]}
              lines={[
                info.formulaBrand ? `Formula: ${info.formulaBrand}` : undefined,
                info.bottleAmountOz ? `${formatVolume(info.bottleAmountOz, preferredUnits.system)} per feed` : undefined,
                info.feedingNotes
              ]} />
          )}
          {!info.feedingType && info.feedingNotes && (
            <InfoCard icon={<Milk aria-hidden="true" />} title="Feeding" lines={[info.feedingNotes]} />
          )}

          {(info.safeSleep || info.sleepRoutine || info.soothingMethods) && (
            <InfoCard icon={<Bed aria-hidden="true" />} title="Sleep &amp; soothing"
              lines={[info.safeSleep, info.sleepRoutine, info.soothingMethods]} />
          )}

          {info.currentMedications && (
            <InfoCard icon={<Pill aria-hidden="true" />} title="Current medications"
              lines={[info.currentMedications]} />
          )}

          {info.skinNotes && (
            <InfoCard icon={<Wind aria-hidden="true" />} title="Skin &amp; diapering"
              lines={[info.skinNotes]} />
          )}

          {info.insurance && (
            <InfoCard icon={<Stethoscope aria-hidden="true" />} role="Health insurance" title={info.insurance.plan}
              lines={[
                `Member ID: ${info.insurance.memberId}`,
                info.insurance.phone || undefined
              ]} />
          )}

          {(info.babyBloodType || info.babyAllergies) && (
            <InfoCard icon={<Stethoscope aria-hidden="true" />} role="Baby health" title={`Blood type: ${info.babyBloodType || 'not recorded'}`}
              lines={[info.babyAllergies ? `Allergies / conditions: ${info.babyAllergies}` : undefined]} />
          )}

          {info.lactation && <ContactCard contact={info.lactation} role="Lactation consultant" />}
          {info.pharmacy && <ContactCard contact={info.pharmacy} role="Pharmacy" />}
        </div>
      )}

      {!hasAnyData && (
        <p className="learn-footnote">
          Tap the pencil to build a caregiver reference card — contacts, feeding, sleep, and medications all in one place.
        </p>
      )}
    </section>
  );
}
