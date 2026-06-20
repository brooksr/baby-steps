import type { TrackerExport } from '../domain/types';

export interface SyncAdapter {
  readonly name: string;
  pull(): Promise<TrackerExport>;
  push(data: TrackerExport): Promise<void>;
}

export class GoogleSheetsSyncAdapterUnavailable implements SyncAdapter {
  readonly name = 'google-sheets';

  async pull(): Promise<TrackerExport> {
    throw new Error('Google Sheets sync is prepared but not implemented in v1.');
  }

  async push(data: TrackerExport): Promise<void> {
    void data;
    throw new Error('Google Sheets sync is prepared but not implemented in v1.');
  }
}
