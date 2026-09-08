import { Award, Bath, Bed, Calendar, Droplets, Dumbbell, FileText, Heart, Milk, Pencil, Pill, Ruler, Smile, Syringe, Thermometer, Trash2, Wind } from 'lucide-react';
import { formatClock, formatDuration, formatShortDate } from '../domain/dates';
import { getMilestoneById, getMoodScale, getVaccinationById } from '../domain/reference';
import { getEventDurationMinutes } from '../domain/summary';
import { formatTemperature } from '../domain/temperature';
import { careEventLabels, type BabyProfile, type CareEvent, type CareEventType } from '../domain/types';
import { formatLength, formatVolume, formatWeight, getPreferredUnits } from '../domain/units';

interface TimelineProps {
  events: CareEvent[];
  emptyMessage?: string;
  onDelete?: (id: string) => void;
  onEdit?: (event: CareEvent) => void;
  profile?: BabyProfile;
}

const icons = {
  appointment: Calendar,
  bath: Bath,
  birth: Heart,
  diaper: Wind,
  feed: Milk,
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

function eventDetail(event: CareEvent, profile?: BabyProfile) {
  const preferredUnits = getPreferredUnits(profile);

  switch (event.type) {
    case 'bath':
      return 'Bath time';
    case 'feed': {
      const parts = [
        event.method === 'nursing' ? `nursing${event.side ? ` · ${event.side} side` : ''}` : `bottle${event.contents ? ` · ${event.contents}` : ''}`,
        event.durationMinutes != null ? formatDuration(event.durationMinutes) : undefined,
        event.amountOz != null ? formatVolume(event.amountOz, preferredUnits.system) : undefined
      ];
      return parts.filter(Boolean).join(' · ');
    }
    case 'birth': {
      const measures = [
        event.weightOz != null ? formatWeight(event.weightOz, preferredUnits) : undefined,
        event.lengthIn != null ? formatLength(event.lengthIn, preferredUnits.system) : undefined,
        event.headCircumferenceIn != null ? `${formatLength(event.headCircumferenceIn, preferredUnits.system)} head` : undefined
      ];
      return measures.filter(Boolean).join(' · ') || 'Birth logged';
    }
    case 'pump':
      return `${formatVolume(event.amountOz, preferredUnits.system)} · ${event.side}`;
    case 'diaper':
      return [event.kind, event.poopSize ? `${event.poopSize} poop` : undefined, event.color].filter(Boolean).join(' · ');
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
        event.weightOz != null ? formatWeight(event.weightOz, preferredUnits) : undefined,
        event.lengthIn != null ? formatLength(event.lengthIn, preferredUnits.system) : undefined,
        event.headCircumferenceIn != null ? `${formatLength(event.headCircumferenceIn, preferredUnits.system)} head` : undefined
      ];
      return measures.filter(Boolean).join(' · ') || 'Measurement';
    }
    case 'note':
      return event.title || event.notes || 'Note';
    case 'temperature':
      return formatTemperature(event.celsius, preferredUnits.system);
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

export function Timeline({ events, emptyMessage = 'No entries yet.', onDelete, onEdit, profile }: TimelineProps) {
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
              <p>{eventDetail(event, profile)}</p>
              {event.notes && event.type !== 'note' && <small>{event.notes}</small>}
            </div>
            {(onEdit || onDelete) && (
              <div className="timeline-actions">
                {onEdit && (
                  <button className="icon-button" type="button" onClick={() => onEdit(event)} aria-label={`Edit ${careEventLabels[event.type]}`}>
                    <Pencil aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button className="icon-button subtle" type="button" onClick={() => onDelete(event.id)} aria-label={`Delete ${careEventLabels[event.type]}`}>
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
