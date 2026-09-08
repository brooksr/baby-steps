import { Play, Square, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addMinutes, fromDateTimeInputValue, toDateTimeInputValue } from '../domain/dates';
import { getMoodScale } from '../domain/reference';
import { type ActiveTimers, type TimerType, formatElapsed, getElapsedSeconds, isTimerType } from '../domain/timers';
import { careEventLabels, type BabyProfile, type CareEvent, type CareEventType, type CreateCareEventInput, type DiaperKind, type DiaperPoopSize, type FeedMethod } from '../domain/types';
import { getPreferredUnits, toStoredLength, toStoredVolume, toStoredWeight, toUnitLength, toUnitVolume, toUnitWeight } from '../domain/units';

const moodLevels = getMoodScale();

interface QuickAddDialogProps {
  activeTimers: ActiveTimers;
  /** Set when adding a new entry. Ignored while `editEvent` is set. */
  eventType: CareEventType | null;
  /** Set when editing an entry that has already been logged. */
  editEvent?: CareEvent | null;
  onClose: () => void;
  onSave: (input: CreateCareEventInput) => Promise<void>;
  onTimerStart: (type: TimerType) => void;
  onTimerStop: (type: TimerType) => void;
  profile?: BabyProfile;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  return Number(value);
}

function numberInputValue(value: number | undefined) {
  return value == null ? '' : String(value);
}

function roundedInputValue(value: number, fractionDigits: number) {
  return String(Number(value.toFixed(fractionDigits)));
}

export function QuickAddDialog({ activeTimers, editEvent, eventType: addType, onClose, onSave, onTimerStart, onTimerStop, profile }: QuickAddDialogProps) {
  const preferredUnits = getPreferredUnits(profile);
  const unitSystem = preferredUnits.system;
  const [startedAt, setStartedAt] = useState(() => toDateTimeInputValue(new Date().toISOString()));
  const [endedAt, setEndedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [side, setSide] = useState('left');
  const [amountOz, setAmountOz] = useState('2');
  const [contents, setContents] = useState('breastmilk');
  const [feedMethod, setFeedMethod] = useState<FeedMethod>('nursing');
  const [diaperKind, setDiaperKind] = useState('wet');
  const [diaperColor, setDiaperColor] = useState('');
  const [poopSize, setPoopSize] = useState<DiaperPoopSize | ''>('');
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [medicationStatus, setMedicationStatus] = useState('given');
  const [provider, setProvider] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('Checkup');
  const [weightOz, setWeightOz] = useState('');
  const [weightPounds, setWeightPounds] = useState('');
  const [lengthIn, setLengthIn] = useState('');
  const [headIn, setHeadIn] = useState('');
  const [title, setTitle] = useState('');
  const [temperature, setTemperature] = useState('98.6');
  const [temperatureUnit, setTemperatureUnit] = useState('f');
  const [moodLevel, setMoodLevel] = useState('2');
  const [saving, setSaving] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);

  const editing = Boolean(editEvent);
  const eventType = editEvent?.type ?? addType;

  const activeTimer = eventType && !editing && isTimerType(eventType) ? activeTimers[eventType] : undefined;
  const timerRunning = Boolean(activeTimer);

  // Read only when the dialog opens: the timers object is re-created every second
  // while one runs, and depending on it would reset the form mid-entry.
  const activeTimersRef = useRef(activeTimers);
  activeTimersRef.current = activeTimers;

  useEffect(() => {
    if (!timerRunning) return;
    setTimerElapsed(activeTimer ? getElapsedSeconds(activeTimer.startedAt) : 0);
    const id = setInterval(() => {
      setTimerElapsed(activeTimer ? getElapsedSeconds(activeTimer.startedAt) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, activeTimer]);

  useEffect(() => {
    if (!eventType) {
      return;
    }

    const timer = !editEvent && isTimerType(eventType) ? activeTimersRef.current[eventType] : undefined;

    setStartedAt(toDateTimeInputValue(editEvent?.startedAt ?? timer?.startedAt ?? new Date().toISOString()));
    setEndedAt(editEvent?.endedAt ? toDateTimeInputValue(editEvent.endedAt) : '');
    setNotes(editEvent?.notes ?? '');
    setDurationMinutes(eventType === 'sleep' ? '60' : eventType === 'tummytime' ? '5' : '15');
    setSide('left');
    // A feed opens on nursing, where the amount is unknown until a bottle is picked.
    setAmountOz(eventType === 'pump' ? roundedInputValue(toUnitVolume(3, unitSystem), 0) : eventType === 'feed' ? '' : roundedInputValue(toUnitVolume(2, unitSystem), 0));
    setContents('breastmilk');
    setFeedMethod('nursing');
    setDiaperKind('wet');
    setDiaperColor('');
    setPoopSize('');
    setMedicationName('');
    setDose('');
    setMedicationStatus('given');
    setProvider('');
    setLocation('');
    setReason('Checkup');
    setWeightOz('');
    setWeightPounds('');
    setLengthIn('');
    setHeadIn('');
    setTitle('');
    setTemperature(unitSystem === 'metric' ? '37' : '98.6');
    setTemperatureUnit(unitSystem === 'metric' ? 'c' : 'f');
    setMoodLevel('2');

    if (!editEvent) {
      return;
    }

    switch (editEvent.type) {
      case 'feed':
        setAmountOz(editEvent.amountOz == null ? '' : roundedInputValue(toUnitVolume(editEvent.amountOz, unitSystem), unitSystem === 'metric' ? 0 : 2));
        setContents(editEvent.contents ?? 'breastmilk');
        setDurationMinutes(numberInputValue(editEvent.durationMinutes));
        setFeedMethod(editEvent.method);
        setSide(editEvent.side ?? 'left');
        break;
      case 'pump':
        setAmountOz(roundedInputValue(toUnitVolume(editEvent.amountOz, unitSystem), unitSystem === 'metric' ? 0 : 2));
        setSide(editEvent.side);
        break;
      case 'diaper':
        setDiaperKind(editEvent.kind);
        setDiaperColor(editEvent.color ?? '');
        setPoopSize(editEvent.poopSize ?? '');
        break;
      case 'medication':
        setMedicationName(editEvent.medicationName);
        setDose(editEvent.dose);
        setMedicationStatus(editEvent.status);
        break;
      case 'appointment':
        setReason(editEvent.reason);
        setProvider(editEvent.provider ?? '');
        setLocation(editEvent.location ?? '');
        break;
      case 'birth':
      case 'growth': {
        if (editEvent.weightOz != null && unitSystem === 'american' && preferredUnits.weightDisplay === 'pounds-ounces') {
          const pounds = Math.floor(editEvent.weightOz / 16);
          setWeightPounds(String(pounds));
          setWeightOz(roundedInputValue(editEvent.weightOz - pounds * 16, 1));
        } else {
          setWeightOz(editEvent.weightOz == null ? '' : roundedInputValue(toUnitWeight(editEvent.weightOz, unitSystem), unitSystem === 'metric' ? 3 : 1));
        }
        setLengthIn(editEvent.lengthIn == null ? '' : roundedInputValue(toUnitLength(editEvent.lengthIn, unitSystem), 1));
        setHeadIn(editEvent.headCircumferenceIn == null ? '' : roundedInputValue(toUnitLength(editEvent.headCircumferenceIn, unitSystem), 1));
        break;
      }
      case 'note':
        setTitle(editEvent.title ?? '');
        break;
      case 'temperature':
        setTemperature(roundedInputValue(unitSystem === 'metric' ? editEvent.celsius : editEvent.celsius * (9 / 5) + 32, 1));
        setTemperatureUnit(unitSystem === 'metric' ? 'c' : 'f');
        break;
      case 'tummytime':
        setDurationMinutes(String(editEvent.durationMinutes));
        break;
      case 'mood':
        setMoodLevel(String(editEvent.level));
        break;
      default:
        break;
    }
  }, [eventType, editEvent, preferredUnits.weightDisplay, unitSystem]);

  const titleText = useMemo(() => {
    if (!eventType) {
      return '';
    }

    return `${editing ? 'Edit' : 'Add'} ${careEventLabels[eventType]}`;
  }, [editing, eventType]);

  if (!eventType) {
    return null;
  }

  function handleStopTimer() {
    if (!eventType || !isTimerType(eventType) || !activeTimer) return;
    const nowIso = new Date().toISOString();
    const elapsed = getElapsedSeconds(activeTimer.startedAt);
    setEndedAt(toDateTimeInputValue(nowIso));
    if (eventType === 'feed' || eventType === 'tummytime') {
      setDurationMinutes(String(Math.max(1, Math.round(elapsed / 60))));
    }
    onTimerStop(eventType);
  }

  // Switching method clears the field the other one doesn't measure, so a
  // bottle never carries a stray duration (or a nursing feed a stray amount).
  function handleFeedMethod(next: FeedMethod) {
    setFeedMethod(next);
    if (next === 'nursing') {
      setAmountOz('');
      setDurationMinutes((current) => current || '15');
    } else {
      setDurationMinutes('');
      setAmountOz((current) => current || roundedInputValue(toUnitVolume(2, unitSystem), 0));
    }
  }

  function handleDiaperKind(next: DiaperKind) {
    setDiaperKind(next);
    setPoopSize((current) => (next === 'wet' ? '' : current || 'medium'));
  }

  function storedWeightOrUndefined() {
    if (unitSystem === 'american' && preferredUnits.weightDisplay === 'pounds-ounces') {
      if (!weightPounds.trim() && !weightOz.trim()) {
        return undefined;
      }

      return Number(weightPounds || 0) * 16 + Number(weightOz || 0);
    }

    const value = numberOrUndefined(weightOz);
    return value == null ? undefined : toStoredWeight(value, unitSystem);
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
      case 'feed': {
        const duration = numberOrUndefined(durationMinutes);
        const nursing = feedMethod === 'nursing';
        payload = {
          type: 'feed',
          amountOz: numberOrUndefined(amountOz) == null ? undefined : toStoredVolume(Number(amountOz), unitSystem),
          contents: nursing ? undefined : (contents as 'breastmilk' | 'formula' | 'mixed' | 'other'),
          durationMinutes: duration,
          endedAt: duration != null ? addMinutes(startedAtIso, duration) : endedAt ? fromDateTimeInputValue(endedAt) : undefined,
          method: feedMethod,
          notes: trimmedNotes,
          side: nursing ? (side as 'left' | 'right' | 'both') : undefined,
          startedAt: startedAtIso
        };
        break;
      }
      case 'birth':
        payload = {
          type: 'birth',
          headCircumferenceIn: numberOrUndefined(headIn) == null ? undefined : toStoredLength(Number(headIn), unitSystem),
          lengthIn: numberOrUndefined(lengthIn) == null ? undefined : toStoredLength(Number(lengthIn), unitSystem),
          notes: trimmedNotes,
          startedAt: startedAtIso,
          weightOz: storedWeightOrUndefined()
        };
        break;
      case 'pump':
        payload = {
          type: 'pump',
          amountOz: toStoredVolume(Number(amountOz), unitSystem),
          endedAt: endedAt ? fromDateTimeInputValue(endedAt) : undefined,
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
          poopSize: diaperKind === 'wet' ? undefined : poopSize || undefined,
          startedAt: startedAtIso
        };
        break;
      case 'bath':
        // Time and notes only — there is nothing else worth typing at 7pm.
        payload = {
          type: 'bath',
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
          headCircumferenceIn: numberOrUndefined(headIn) == null ? undefined : toStoredLength(Number(headIn), unitSystem),
          lengthIn: numberOrUndefined(lengthIn) == null ? undefined : toStoredLength(Number(lengthIn), unitSystem),
          notes: trimmedNotes,
          startedAt: startedAtIso,
          weightOz: storedWeightOrUndefined()
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
      case 'temperature': {
        const entered = Number(temperature);
        const celsius = temperatureUnit === 'f' ? (entered - 32) * (5 / 9) : entered;
        payload = {
          type: 'temperature',
          celsius: Math.round(celsius * 10) / 10,
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      }
      case 'tummytime': {
        const duration = Number(durationMinutes);
        payload = {
          type: 'tummytime',
          durationMinutes: duration,
          endedAt: addMinutes(startedAtIso, duration),
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      }
      case 'mood':
        payload = {
          type: 'mood',
          level: Number(moodLevel),
          notes: trimmedNotes,
          startedAt: startedAtIso
        };
        break;
      default:
        // milestone / vaccine are toggled from the Care view, so there is nothing
        // to add here — but an existing one can still be re-timed or annotated.
        if (!editEvent) {
          return;
        }

        payload = { ...editEvent, notes: trimmedNotes, startedAt: startedAtIso } as CreateCareEventInput;
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

          {isTimerType(eventType) && !editing && (
            <div className="timer-row">
              {timerRunning ? (
                <>
                  <span className="timer-display">{formatElapsed(timerElapsed)}</span>
                  <button className="timer-stop-button" type="button" onClick={handleStopTimer}>
                    <Square aria-hidden="true" />
                    Stop
                  </button>
                </>
              ) : (
                <button className="timer-start-button" type="button" onClick={() => onTimerStart(eventType)}>
                  <Play aria-hidden="true" />
                  Start Timer
                </button>
              )}
            </div>
          )}

          {eventType === 'feed' && (
            <>
              <div className="form-grid-wide segmented-control" role="radiogroup" aria-label="Feeding method">
                {(['nursing', 'bottle'] as FeedMethod[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={feedMethod === method}
                    className={feedMethod === method ? 'active' : ''}
                    onClick={() => handleFeedMethod(method)}
                  >
                    {method === 'nursing' ? 'Nursing' : 'Bottle'}
                  </button>
                ))}
              </div>
              {feedMethod === 'nursing' ? (
                <label>
                  Side
                  <select value={side} onChange={(event) => setSide(event.target.value)}>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              ) : (
                <label>
                  Contents
                  <select value={contents} onChange={(event) => setContents(event.target.value)}>
                    <option value="breastmilk">Breast milk</option>
                    <option value="formula">Formula</option>
                    <option value="mixed">Mixed</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              )}
              {/* Both are optional: a bottle is rarely timed, and a nursing
                  session rarely has a known volume. */}
              <label>
                Minutes <small>optional</small>
                <input min="1" step="1" type="number" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
              </label>
              <label>
                {unitSystem === 'metric' ? 'Milliliters' : 'Ounces'} <small>optional</small>
                <input min="0" step={unitSystem === 'metric' ? '1' : '0.25'} type="number" value={amountOz} onChange={(event) => setAmountOz(event.target.value)} />
              </label>
            </>
          )}

          {eventType === 'pump' && (
            <>
              <label>
                {unitSystem === 'metric' ? 'Milliliters' : 'Ounces'}
                <input min="0" step={unitSystem === 'metric' ? '1' : '0.25'} type="number" value={amountOz} onChange={(event) => setAmountOz(event.target.value)} required />
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
                <select value={diaperKind} onChange={(event) => handleDiaperKind(event.target.value as DiaperKind)}>
                  <option value="wet">Wet</option>
                  <option value="dirty">Dirty</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <label>
                Color
                <input value={diaperColor} onChange={(event) => setDiaperColor(event.target.value)} />
              </label>
              {diaperKind !== 'wet' && (
                <div className="form-grid-wide option-field">
                  <span>Poop size</span>
                  <div className="segmented-control three-option" role="radiogroup" aria-label="Poop size">
                    {(['small', 'medium', 'large'] as DiaperPoopSize[]).map((size) => (
                      <button
                        key={size}
                        type="button"
                        role="radio"
                        aria-checked={poopSize === size}
                        className={poopSize === size ? 'active' : ''}
                        onClick={() => setPoopSize(size)}
                      >
                        {size.charAt(0).toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
              {unitSystem === 'american' && preferredUnits.weightDisplay === 'pounds-ounces' ? (
                <div className="option-field">
                  <span id="weight-pair-label">Weight</span>
                  <div className="unit-pair" role="group" aria-labelledby="weight-pair-label">
                    <span className="unit-pair-part">
                      <input
                        aria-label="Weight lb"
                        min="0"
                        step="1"
                        type="number"
                        value={weightPounds}
                        onChange={(event) => setWeightPounds(event.target.value)} />
                      <span className="unit-pair-suffix">lb</span>
                    </span>
                    <span className="unit-pair-part">
                      <input
                        aria-label="Weight oz"
                        min="0"
                        max="15.9"
                        step="0.1"
                        type="number"
                        value={weightOz}
                        onChange={(event) => setWeightOz(event.target.value)} />
                      <span className="unit-pair-suffix">oz</span>
                    </span>
                  </div>
                </div>
              ) : (
                <label>
                  Weight {unitSystem === 'metric' ? 'kg' : 'oz'}
                  <input min="0" step={unitSystem === 'metric' ? '0.001' : '0.1'} type="number" value={weightOz} onChange={(event) => setWeightOz(event.target.value)} />
                </label>
              )}
              <label>
                Length {unitSystem === 'metric' ? 'cm' : 'in'}
                <input min="0" step="0.1" type="number" value={lengthIn} onChange={(event) => setLengthIn(event.target.value)} />
              </label>
              <label>
                Head {unitSystem === 'metric' ? 'cm' : 'in'}
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

          {eventType === 'temperature' && (
            <>
              <label>
                Temperature
                <input min="0" step="0.1" type="number" value={temperature} onChange={(event) => setTemperature(event.target.value)} required />
              </label>
              <label>
                Unit
                <select value={temperatureUnit} onChange={(event) => setTemperatureUnit(event.target.value)}>
                  <option value="f">°F</option>
                  <option value="c">°C</option>
                </select>
              </label>
            </>
          )}

          {eventType === 'tummytime' && (
            <label>
              Minutes
              <input min="1" step="1" type="number" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required />
            </label>
          )}

          {eventType === 'mood' && (
            <label>
              Mood
              <select value={moodLevel} onChange={(event) => setMoodLevel(event.target.value)}>
                {moodLevels.map((level) => (
                  <option key={level.level} value={level.level}>
                    {level.level} · {level.label}
                  </option>
                ))}
              </select>
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
