import { minutesBetween } from './dates';
import type { AppointmentEvent, CareEvent, MedicationEvent } from './types';

export interface DailySummary {
  feedCount: number;
  nursingMinutes: number;
  bottleOunces: number;
  pumpOunces: number;
  wetDiapers: number;
  dirtyDiapers: number;
  sleepMinutes: number;
  medicationsGiven: number;
  appointments: number;
  growthMeasurements: number;
  notes: number;
}

export function createEmptyDailySummary(): DailySummary {
  return {
    appointments: 0,
    bottleOunces: 0,
    dirtyDiapers: 0,
    feedCount: 0,
    growthMeasurements: 0,
    medicationsGiven: 0,
    notes: 0,
    nursingMinutes: 0,
    pumpOunces: 0,
    sleepMinutes: 0,
    wetDiapers: 0
  };
}

export function getEventDurationMinutes(event: CareEvent) {
  if (event.type === 'breastfeed') {
    return event.durationMinutes;
  }

  if (event.type === 'sleep') {
    return minutesBetween(event.startedAt, event.endedAt);
  }

  return minutesBetween(event.startedAt, event.endedAt);
}

export function getDailySummary(events: CareEvent[]): DailySummary {
  return events.reduce((summary, event) => {
    switch (event.type) {
      case 'breastfeed':
        summary.feedCount += 1;
        summary.nursingMinutes += event.durationMinutes;
        break;
      case 'birth':
        summary.growthMeasurements += 1;
        break;
      case 'bottle':
        summary.feedCount += 1;
        summary.bottleOunces += event.amountOz;
        break;
      case 'pump':
        summary.pumpOunces += event.amountOz;
        break;
      case 'diaper':
        if (event.kind === 'wet' || event.kind === 'both') {
          summary.wetDiapers += 1;
        }
        if (event.kind === 'dirty' || event.kind === 'both') {
          summary.dirtyDiapers += 1;
        }
        break;
      case 'sleep':
        summary.sleepMinutes += getEventDurationMinutes(event);
        break;
      case 'medication':
        if (event.status === 'given') {
          summary.medicationsGiven += 1;
        }
        break;
      case 'appointment':
        summary.appointments += 1;
        break;
      case 'growth':
        summary.growthMeasurements += 1;
        break;
      case 'note':
        summary.notes += 1;
        break;
    }

    return summary;
  }, createEmptyDailySummary());
}

export function sortEventsDescending(events: CareEvent[]) {
  return [...events].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function getLastEvent(events: CareEvent[], predicate: (event: CareEvent) => boolean) {
  return sortEventsDescending(events).find(predicate);
}

export function getActiveSleep(events: CareEvent[]) {
  return sortEventsDescending(events).find((event) => event.type === 'sleep' && !event.endedAt);
}

export function getUpcomingMedicationEvents(events: CareEvent[], now = new Date(), windowMinutes = 180) {
  const nowTime = now.getTime();
  const windowEnd = nowTime + windowMinutes * 60_000;

  return events
    .filter((event): event is MedicationEvent => event.type === 'medication' && event.status === 'scheduled')
    .filter((event) => {
      const dueAt = new Date(event.scheduledAt ?? event.startedAt).getTime();
      return dueAt <= windowEnd;
    })
    .sort((a, b) => {
      const aDue = new Date(a.scheduledAt ?? a.startedAt).getTime();
      const bDue = new Date(b.scheduledAt ?? b.startedAt).getTime();

      if (aDue < nowTime && bDue >= nowTime) {
        return -1;
      }

      if (bDue < nowTime && aDue >= nowTime) {
        return 1;
      }

      return aDue - bDue;
    });
}

export function getUpcomingAppointments(events: CareEvent[], now = new Date(), windowDays = 14) {
  const nowTime = now.getTime();
  const windowEnd = nowTime + windowDays * 24 * 60 * 60_000;

  return events
    .filter((event): event is AppointmentEvent => event.type === 'appointment')
    .filter((event) => {
      const appointmentAt = new Date(event.startedAt).getTime();
      return appointmentAt >= nowTime && appointmentAt <= windowEnd;
    })
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}
