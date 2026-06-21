import { Award, Baby, Bed, Calendar, Droplets, Dumbbell, FileText, Heart, Milk, Pill, Ruler, Smile, Syringe, Thermometer, Trash2, Wind } from 'lucide-react';
import { formatClock, formatDuration, formatShortDate } from '../domain/dates';
import { getMilestoneById, getMoodScale, getVaccinationById } from '../domain/reference';
import { getEventDurationMinutes } from '../domain/summary';
import { formatTemperature } from '../domain/temperature';
import { careEventLabels, type CareEvent, type CareEventType } from '../domain/types';

interface TimelineProps {
  events: CareEvent[];
  emptyMessage?: string;
  onDelete?: (id: string) => void;
}

const icons = {
  appointment: Calendar,
  birth: Heart,
  bottle: Milk,
  breastfeed: Baby,
  diaper: Wind,
  growth: Ruler,
  medication: Pill,
  milestone: Award,
  mood: Smile,
  note: FileText,
  pump: Droplets,
  sleep: Bed,
  temperature: Thermometer,
  tummytime: Dumbbell,
  vaccine: Syringe
} satisfies Record<CareEventType, typeof Milk>;

function eventDetail(event: CareEvent) {
  switch (event.type) {
    case 'breastfeed':
      return `${event.side} side · ${formatDuration(event.durationMinutes)}`;
    case 'birth': {
      const measures = [
        event.weightOz ? `${event.weightOz} oz` : undefined,
        event.lengthIn ? `${event.lengthIn} in` : undefined,
        event.headCircumferenceIn ? `${event.headCircumferenceIn} in head` : undefined
      ];
      return measures.filter(Boolean).join(' · ') || 'Birth logged';
    }
    case 'bottle':
      return `${event.amountOz} oz · ${event.contents}`;
    case 'pump':
      return `${event.amountOz} oz · ${event.side}`;
    case 'diaper':
      return [event.kind, event.color].filter(Boolean).join(' · ');
    case 'sleep': {
      const minutes = getEventDurationMinutes(event);
      return event.endedAt ? formatDuration(minutes) : 'In progress';
    }
    case 'medication':
      return `${event.medicationName} · ${event.dose} · ${event.status}`;
    case 'appointment':
      return [event.reason, event.provider, event.location].filter(Boolean).join(' · ');
    case 'growth': {
      const measures = [
        event.weightOz ? `${event.weightOz} oz` : undefined,
        event.lengthIn ? `${event.lengthIn} in` : undefined,
        event.headCircumferenceIn ? `${event.headCircumferenceIn} in head` : undefined
      ];
      return measures.filter(Boolean).join(' · ') || 'Measurement';
    }
    case 'note':
      return event.title || event.notes || 'Note';
    case 'temperature':
      return formatTemperature(event.celsius);
    case 'tummytime':
      return formatDuration(event.durationMinutes);
    case 'mood': {
      const match = getMoodScale().find((level) => level.level === event.level);
      return match ? `${event.level} · ${match.label}` : `Level ${event.level}`;
    }
    case 'milestone':
      return getMilestoneById(event.refId)?.milestone ?? 'Milestone reached';
    case 'vaccine': {
      const vaccination = getVaccinationById(event.refId);
      return vaccination ? `${vaccination.age} · ${vaccination.vaccines}` : 'Vaccine given';
    }
  }
}

export function Timeline({ events, emptyMessage = 'No entries yet.', onDelete }: TimelineProps) {
  if (events.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ol className="timeline">
      {events.map((event) => {
        const Icon = icons[event.type];

        return (
          <li className="timeline-item" key={event.id}>
            <span className="timeline-icon">
              <Icon aria-hidden="true" />
            </span>
            <div className="timeline-body">
              <div className="timeline-row">
                <strong>{careEventLabels[event.type]}</strong>
                <time dateTime={event.startedAt}>
                  {formatShortDate(event.startedAt)} · {formatClock(event.startedAt)}
                </time>
              </div>
              <p>{eventDetail(event)}</p>
              {event.notes && event.type !== 'note' && <small>{event.notes}</small>}
            </div>
            {onDelete && (
              <button className="icon-button subtle" type="button" onClick={() => onDelete(event.id)} aria-label={`Delete ${careEventLabels[event.type]}`}>
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
