import { X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { addMinutes, fromDateTimeInputValue, toDateTimeInputValue } from '../domain/dates';
import { careEventLabels, type CareEventType, type CreateCareEventInput } from '../domain/types';

interface QuickAddDialogProps {
  eventType: CareEventType | null;
  onClose: () => void;
  onSave: (input: CreateCareEventInput) => Promise<void>;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  return Number(value);
}

export function QuickAddDialog({ eventType, onClose, onSave }: QuickAddDialogProps) {
  const [startedAt, setStartedAt] = useState(() => toDateTimeInputValue(new Date().toISOString()));
  const [endedAt, setEndedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [side, setSide] = useState('left');
  const [amountOz, setAmountOz] = useState('2');
  const [contents, setContents] = useState('breastmilk');
  const [diaperKind, setDiaperKind] = useState('wet');
  const [diaperColor, setDiaperColor] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [medicationStatus, setMedicationStatus] = useState('given');
  const [provider, setProvider] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('Checkup');
  const [weightOz, setWeightOz] = useState('');
  const [lengthIn, setLengthIn] = useState('');
  const [headIn, setHeadIn] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eventType) {
      return;
    }

    setStartedAt(toDateTimeInputValue(new Date().toISOString()));
    setEndedAt('');
    setNotes('');
    setDurationMinutes(eventType === 'sleep' ? '60' : '15');
    setAmountOz(eventType === 'pump' ? '3' : '2');
    setMedicationStatus('given');
  }, [eventType]);

  const titleText = useMemo(() => {
    if (!eventType) {
      return '';
    }

    return `Add ${careEventLabels[eventType]}`;
  }, [eventType]);

  if (!eventType) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!eventType) {
      return;
    }

    const startedAtIso = fromDateTimeInputValue(startedAt);
    const trimmedNotes = notes.trim() || undefined;
    let payload: CreateCareEventInput;

    switch (eventType) {
      case 'breastfeed': {
        const duration = Number(durationMinutes);
        payload = {
          type: 'breastfeed',
          durationMinutes: duration,
          endedAt: addMinutes(startedAtIso, duration),
          notes: trimmedNotes,
          side: side as 'left' | 'right' | 'both',
          startedAt: startedAtIso
        };
        break;
      }
      case 'birth':
        payload = {
          type: 'birth',
          headCircumferenceIn: numberOrUndefined(headIn),
          lengthIn: numberOrUndefined(lengthIn),
          notes: trimmedNotes,
          startedAt: startedAtIso,
          weightOz: numberOrUndefined(weightOz)
        };
        break;
      case 'bottle':
        payload = {
          type: 'bottle',
          amountOz: Number(amountOz),
          contents: contents as 'breastmilk' | 'formula' | 'mixed' | 'other',
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      case 'pump':
        payload = {
          type: 'pump',
          amountOz: Number(amountOz),
          notes: trimmedNotes,
          side: side as 'left' | 'right' | 'both',
          startedAt: startedAtIso
        };
        break;
      case 'diaper':
        payload = {
          type: 'diaper',
          color: diaperColor.trim() || undefined,
          kind: diaperKind as 'wet' | 'dirty' | 'both',
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      case 'sleep':
        payload = {
          type: 'sleep',
          endedAt: endedAt ? fromDateTimeInputValue(endedAt) : undefined,
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      case 'medication':
        payload = {
          type: 'medication',
          dose: dose.trim(),
          givenAt: medicationStatus === 'given' ? startedAtIso : undefined,
          medicationName: medicationName.trim(),
          notes: trimmedNotes,
          scheduledAt: startedAtIso,
          startedAt: startedAtIso,
          status: medicationStatus as 'scheduled' | 'given' | 'skipped'
        };
        break;
      case 'appointment':
        payload = {
          type: 'appointment',
          location: location.trim() || undefined,
          notes: trimmedNotes,
          provider: provider.trim() || undefined,
          reason: reason.trim() || 'Appointment',
          startedAt: startedAtIso
        };
        break;
      case 'growth':
        payload = {
          type: 'growth',
          headCircumferenceIn: numberOrUndefined(headIn),
          lengthIn: numberOrUndefined(lengthIn),
          notes: trimmedNotes,
          startedAt: startedAtIso,
          weightOz: numberOrUndefined(weightOz)
        };
        break;
      case 'note':
        payload = {
          type: 'note',
          notes: trimmedNotes,
          startedAt: startedAtIso,
          title: title.trim() || undefined
        };
        break;
    }

    setSaving(true);
    try {
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="quick-add-title" onSubmit={handleSubmit}>
        <header className="modal-header">
          <h2 id="quick-add-title">{titleText}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="form-grid">
          <label>
            Time
            <input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required />
          </label>

          {eventType === 'breastfeed' && (
            <>
              <label>
                Side
                <select value={side} onChange={(event) => setSide(event.target.value)}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <label>
                Minutes
                <input min="1" step="1" type="number" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required />
              </label>
            </>
          )}

          {eventType === 'bottle' && (
            <>
              <label>
                Ounces
                <input min="0" step="0.25" type="number" value={amountOz} onChange={(event) => setAmountOz(event.target.value)} required />
              </label>
              <label>
                Contents
                <select value={contents} onChange={(event) => setContents(event.target.value)}>
                  <option value="breastmilk">Breast milk</option>
                  <option value="formula">Formula</option>
                  <option value="mixed">Mixed</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </>
          )}

          {eventType === 'pump' && (
            <>
              <label>
                Ounces
                <input min="0" step="0.25" type="number" value={amountOz} onChange={(event) => setAmountOz(event.target.value)} required />
              </label>
              <label>
                Side
                <select value={side} onChange={(event) => setSide(event.target.value)}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </select>
              </label>
            </>
          )}

          {eventType === 'diaper' && (
            <>
              <label>
                Type
                <select value={diaperKind} onChange={(event) => setDiaperKind(event.target.value)}>
                  <option value="wet">Wet</option>
                  <option value="dirty">Dirty</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <label>
                Color
                <input value={diaperColor} onChange={(event) => setDiaperColor(event.target.value)} />
              </label>
            </>
          )}

          {eventType === 'sleep' && (
            <label>
              End time
              <input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
            </label>
          )}

          {eventType === 'medication' && (
            <>
              <label>
                Medication
                <input value={medicationName} onChange={(event) => setMedicationName(event.target.value)} required />
              </label>
              <label>
                Dose
                <input value={dose} onChange={(event) => setDose(event.target.value)} required />
              </label>
              <label>
                Status
                <select value={medicationStatus} onChange={(event) => setMedicationStatus(event.target.value)}>
                  <option value="given">Given</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="skipped">Skipped</option>
                </select>
              </label>
            </>
          )}

          {eventType === 'appointment' && (
            <>
              <label>
                Reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} required />
              </label>
              <label>
                Provider
                <input value={provider} onChange={(event) => setProvider(event.target.value)} />
              </label>
              <label>
                Location
                <input value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>
            </>
          )}

          {(eventType === 'birth' || eventType === 'growth') && (
            <>
              <label>
                Weight oz
                <input min="0" step="0.1" type="number" value={weightOz} onChange={(event) => setWeightOz(event.target.value)} />
              </label>
              <label>
                Length in
                <input min="0" step="0.1" type="number" value={lengthIn} onChange={(event) => setLengthIn(event.target.value)} />
              </label>
              <label>
                Head in
                <input min="0" step="0.1" type="number" value={headIn} onChange={(event) => setHeadIn(event.target.value)} />
              </label>
            </>
          )}

          {eventType === 'note' && (
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          )}

          <label className="form-grid-wide">
            Notes
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>

        <footer className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            <span>{saving ? 'Saving' : 'Save'}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}
