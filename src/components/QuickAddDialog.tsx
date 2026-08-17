import { Play, Square, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addMinutes, fromDateTimeInputValue, toDateTimeInputValue } from '../domain/dates';
import { getMoodScale } from '../domain/reference';
import { type ActiveTimers, type TimerType, formatElapsed, getElapsedSeconds, isTimerType } from '../domain/timers';
import { careEventLabels, type CareEvent, type CareEventType, type CreateCareEventInput, type FeedMethod } from '../domain/types';

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

export function QuickAddDialog({ activeTimers, editEvent, eventType: addType, onClose, onSave, onTimerStart, onTimerStop }: QuickAddDialogProps) {
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
    setAmountOz(eventType === 'pump' ? '3' : eventType === 'feed' ? '' : '2');
    setContents('breastmilk');
    setFeedMethod('nursing');
    setDiaperKind('wet');
    setDiaperColor('');
    setMedicationName('');
    setDose('');
    setMedicationStatus('given');
    setProvider('');
    setLocation('');
    setReason('Checkup');
    setWeightOz('');
    setLengthIn('');
    setHeadIn('');
    setTitle('');
    setTemperature('98.6');
    setTemperatureUnit('f');
    setMoodLevel('2');

    if (!editEvent) {
      return;
    }

    switch (editEvent.type) {
      case 'feed':
        setAmountOz(numberInputValue(editEvent.amountOz));
        setContents(editEvent.contents ?? 'breastmilk');
        setDurationMinutes(numberInputValue(editEvent.durationMinutes));
        setFeedMethod(editEvent.method);
        setSide(editEvent.side ?? 'left');
        break;
      case 'pump':
        setAmountOz(String(editEvent.amountOz));
        setSide(editEvent.side);
        break;
      case 'diaper':
        setDiaperKind(editEvent.kind);
        setDiaperColor(editEvent.color ?? '');
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
      case 'growth':
        setWeightOz(numberInputValue(editEvent.weightOz));
        setLengthIn(numberInputValue(editEvent.lengthIn));
        setHeadIn(numberInputValue(editEvent.headCircumferenceIn));
        break;
      case 'note':
        setTitle(editEvent.title ?? '');
        break;
      case 'temperature':
        setTemperature(String(Math.round((editEvent.celsius * (9 / 5) + 32) * 10) / 10));
        setTemperatureUnit('f');
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
  }, [eventType, editEvent]);

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
      setAmountOz((current) => current || '2');
    }
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
          amountOz: numberOrUndefined(amountOz),
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
          headCircumferenceIn: numberOrUndefined(headIn),
          lengthIn: numberOrUndefined(lengthIn),
          notes: trimmedNotes,
          startedAt: startedAtIso,
          weightOz: numberOrUndefined(weightOz)
        };
        break;
      case 'pump':
        payload = {
          type: 'pump',
          amountOz: Number(amountOz),
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
                Ounces <small>optional</small>
                <input min="0" step="0.25" type="number" value={amountOz} onChange={(event) => setAmountOz(event.target.value)} />
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
