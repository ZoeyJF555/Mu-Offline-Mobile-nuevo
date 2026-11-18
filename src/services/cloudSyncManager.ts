import {
  countPendingSync,
  getPendingSyncRecords,
  hashPassword,
  hashSecretAnswer,
  markRecordsSynced,
  setOnLocalMutationListener,
  upsertAccountFromCloud,
  upsertCharacterFromCloud,
} from '../db/dexieStore';
import type { MuAccount, MuCharacter, SyncStatusInfo } from '../types/game';

export interface CloudSyncResponse {
  acceptedAccountIds: string[];
  acceptedCharacterIds: string[];
  newerAccounts: MuAccount[];
  newerCharacters: MuCharacter[];
  serverTimestamp: number;
}

export class CloudSyncManager {
  private status: SyncStatusInfo = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastMessage: null,
  };
  private listeners = new Set<(status: SyncStatusInfo) => void>();
  private dataAppliedListeners = new Set<() => void>();
  private activeAccountId: string | null = null;
  private debounceTimer: number | null = null;
  private periodicTimer: number | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    setOnLocalMutationListener(() => {
      this.refreshPendingCount().then(() => {
        if (navigator.onLine) {
          this.scheduleSync(1200);
        }
      });
    });

    this.refreshPendingCount().then(() => {
      if (navigator.onLine) {
        this.syncNow();
      }
    });

    this.periodicTimer = window.setInterval(() => {
      if (navigator.onLine && !this.status.syncing) {
        this.syncNow();
      }
    }, 25000);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    setOnLocalMutationListener(null);
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.periodicTimer) window.clearInterval(this.periodicTimer);
  }

  setActiveAccountId(accountId: string | null) {
    this.activeAccountId = accountId;
    if (accountId && navigator.onLine) {
      this.scheduleSync(400);
    }
  }

  subscribeStatus(fn: (status: SyncStatusInfo) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  onCloudDataApplied(fn: () => void): () => void {
    this.dataAppliedListeners.add(fn);
    return () => this.dataAppliedListeners.delete(fn);
  }

  getStatus(): SyncStatusInfo {
    return this.status;
  }

  private emitStatus(patch: Partial<SyncStatusInfo>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) {
      fn(this.status);
    }
  }

  private handleOnline = () => {
    this.emitStatus({
      isOnline: true,
      lastMessage: 'Conexión detectada · Sincronizando cambios locales con la nube...',
    });
    this.scheduleSync(350);
  };

  private handleOffline = () => {
    this.emitStatus({
      isOnline: false,
      syncing: false,
      lastMessage: 'Sin conexión · Guardando todo offline en IndexedDB (Dexie).',
    });
  };

  private scheduleSync(delayMs: number) {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.syncNow();
    }, delayMs);
  }

  async refreshPendingCount() {
    const pendingCount = await countPendingSync();
    this.emitStatus({ pendingCount });
  }

  /**
   * Sincronización bidireccional con Regla de Oro contra Sobreescritura:
   * - Solo envía registros con isSynced = false.
   * - Compara timestamps `updatedAt`: el registro más reciente siempre gana (local vs nube).
   */
  async syncNow(): Promise<{ ok: boolean; message: string }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await this.refreshPendingCount();
      this.emitStatus({ isOnline: false, syncing: false });
      return { ok: false, message: 'Dispositivo offline. Cambios seguros en IndexedDB.' };
    }

    if (this.status.syncing) {
      return { ok: true, message: 'Sincronización en curso...' };
    }

    this.emitStatus({ isOnline: true, syncing: true });

    try {
      const pending = await getPendingSyncRecords();
      const res = await fetch('/api/cloud/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: pending.accounts,
          characters: pending.characters,
          activeAccountId: this.activeAccountId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const payload = (await res.json()) as CloudSyncResponse;

      if (payload.acceptedAccountIds.length > 0 || payload.acceptedCharacterIds.length > 0) {
        await markRecordsSynced(payload.acceptedAccountIds, payload.acceptedCharacterIds);
      }

      let cloudUpdatedLocal = false;
      for (const cloudAcc of payload.newerAccounts || []) {
        const applied = await upsertAccountFromCloud(cloudAcc);
        if (applied) cloudUpdatedLocal = true;
      }
      for (const cloudChar of payload.newerCharacters || []) {
        const applied = await upsertCharacterFromCloud(cloudChar);
        if (applied) cloudUpdatedLocal = true;
      }

      if (cloudUpdatedLocal) {
        for (const fn of this.dataAppliedListeners) {
          fn();
        }
      }

      const remaining = await countPendingSync();
      const msg = cloudUpdatedLocal
        ? 'Nube tenía progreso más reciente · Datos fusionados por timestamp.'
        : pending.accounts.length + pending.characters.length > 0
          ? `Sincronizado (${payload.acceptedAccountIds.length} cuentas, ${payload.acceptedCharacterIds.length} héroes)`
          : 'Datos al día con la nube';

      this.emitStatus({
        isOnline: true,
        syncing: false,
        pendingCount: remaining,
        lastSyncedAt: Date.now(),
        lastMessage: msg,
      });
      return { ok: true, message: msg };
    } catch {
      const remaining = await countPendingSync();
      this.emitStatus({
        syncing: false,
        pendingCount: remaining,
        lastMessage: 'Nube no accesible temporalmente · Modo Offline-First activo.',
      });
      return { ok: false, message: 'No se pudo conectar con la API Cloud Sync.' };
    }
  }

  async fetchRecoveryQuestionsFromCloud(
    username: string,
  ): Promise<{ found: true; secretQ1: string; secretQ2: string } | { found: false; error?: string }> {
    if (!navigator.onLine) {
      return { found: false, error: 'Sin internet para consultar la nube.' };
    }
    try {
      const res = await fetch(
        `/api/cloud/recovery-questions?username=${encodeURIComponent(username.trim().toLowerCase())}`,
      );
      if (!res.ok) return { found: false };
      const data = (await res.json()) as { found: boolean; secretQ1?: string; secretQ2?: string };
      if (!data.found || !data.secretQ1 || !data.secretQ2) {
        return { found: false };
      }
      return { found: true, secretQ1: data.secretQ1, secretQ2: data.secretQ2 };
    } catch {
      return { found: false, error: 'Error consultando nube.' };
    }
  }

  async recoverAccountFromCloud(input: {
    username: string;
    answer1: string;
    answer2: string;
    newPassword: string;
  }): Promise<{ ok: true; account: MuAccount; charactersCount: number } | { ok: false; error: string }> {
    if (!navigator.onLine) {
      return { ok: false, error: 'Sin conexión a internet para recuperar desde la nube.' };
    }
    try {
      const res = await fetch('/api/cloud/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: input.username.trim().toLowerCase(),
          secretA1Hash: hashSecretAnswer(input.answer1),
          secretA2Hash: hashSecretAnswer(input.answer2),
          newPasswordHash: hashPassword(input.newPassword),
          updatedAt: Date.now(),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        account?: MuAccount;
        characters?: MuCharacter[];
      };
      if (!res.ok || !data.ok || !data.account) {
        return { ok: false, error: data.error || 'No se pudo recuperar la cuenta en la nube.' };
      }

      await upsertAccountFromCloud(data.account);
      let restoredChars = 0;
      for (const ch of data.characters || []) {
        const applied = await upsertCharacterFromCloud(ch);
        if (applied) restoredChars++;
      }

      for (const fn of this.dataAppliedListeners) {
        fn();
      }
      await this.refreshPendingCount();

      return { ok: true, account: data.account, charactersCount: restoredChars };
    } catch {
      return { ok: false, error: 'Error de red al recuperar cuenta desde la nube.' };
    }
  }
}

export const cloudSyncManager = new CloudSyncManager();
