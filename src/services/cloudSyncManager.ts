import {
  countPendingSync,
  getAllSyncRecordsForCloud,
  hashPassword,
  hashSecretAnswer,
  markRecordsSynced,
  setOnLocalMutationListener,
  upsertAccountFromCloud,
  upsertCharacterFromCloud,
} from '../db/dexieStore';
import {
  getConfiguredCloudApiUrl,
  getLinkedGithubRepoSlug,
  probeSameOriginBackend,
} from './githubOtaService';
import type { AsyncDuelChallenge, MuAccount, MuCharacter, SyncStatusInfo } from '../types/game';

export interface CloudSyncResponse {
  acceptedAccountIds: string[];
  acceptedCharacterIds: string[];
  newerAccounts: MuAccount[];
  newerCharacters: MuCharacter[];
  syncedLedgerCount?: number;
  syncedDuelsCount?: number;
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
  private cachedSameOriginApi: boolean | null = null;

  private async resolveApiBase(): Promise<string | null> {
    const customUrl = getConfiguredCloudApiUrl();
    if (customUrl) return customUrl;
    if (this.cachedSameOriginApi === null) {
      this.cachedSameOriginApi = await probeSameOriginBackend();
    }
    return this.cachedSameOriginApi ? '' : null;
  }

  resetApiProbe() {
    this.cachedSameOriginApi = null;
  }

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
    this.cachedSameOriginApi = null;
    this.emitStatus({
      isOnline: true,
      lastMessage: 'Conexión detectada · Verificando actualizaciones y sincronización...',
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
   * - En GitHub Pages o APK sin backend propio configurado, mantiene IndexedDB local activo sin falsos errores.
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

    const apiBase = await this.resolveApiBase();
    if (apiBase === null) {
      const remaining = await countPendingSync();
      const msg = 'GitHub Pages / APK Offline-First activo · Progreso seguro en IndexedDB';
      this.emitStatus({
        isOnline: true,
        syncing: false,
        pendingCount: remaining,
        lastMessage: msg,
      });
      return {
        ok: true,
        message: 'Modo GitHub Pages / APK activo: todo tu progreso está seguro en IndexedDB y las actualizaciones llegan desde GitHub.',
      };
    }

    this.emitStatus({ isOnline: true, syncing: true });

    try {
      const pending = await getAllSyncRecordsForCloud();
      const res = await fetch(`${apiBase}/api/cloud/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: pending.accounts,
          characters: pending.characters,
          ledger: pending.ledger,
          duels: pending.duels,
          events: pending.events,
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
        lastMessage: 'Servidor Cloud remoto no respondió · Modo Offline-First activo.',
      });
      return {
        ok: false,
        message: 'El servidor Cloud configurado no respondió. Tus datos locales siguen seguros en IndexedDB.',
      };
    }
  }

  async buildGithubSyncSnapshotJson(): Promise<string> {
    const apiBase = await this.resolveApiBase();
    if (apiBase !== null && navigator.onLine) {
      try {
        await this.syncNow();
        const res = await fetch(`${apiBase}/api/cloud/github-export`);
        if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
          return await res.text();
        }
      } catch {
        // Fallback to local Dexie snapshot below
      }
    }

    const records = await getAllSyncRecordsForCloud();
    return JSON.stringify(
      {
        repository: getLinkedGithubRepoSlug(),
        exportedAt: new Date().toISOString(),
        version: '2.2.0',
        source: 'dexie-indexeddb-local',
        summary: {
          accounts: records.accounts.length,
          characters: records.characters.length,
          ledgerEntries: records.ledger.length,
          duelRecords: records.duels.length,
          eventSessions: records.events.length,
        },
        data: records,
      },
      null,
      2,
    );
  }

  async fetchRecoveryQuestionsFromCloud(
    username: string,
  ): Promise<{ found: true; secretQ1: string; secretQ2: string } | { found: false; error?: string }> {
    if (!navigator.onLine) {
      return { found: false, error: 'Sin internet para consultar la nube.' };
    }
    const apiBase = await this.resolveApiBase();
    if (apiBase === null) {
      return { found: false, error: 'Sin servidor Cloud remoto vinculado en este dispositivo.' };
    }
    try {
      const res = await fetch(
        `${apiBase}/api/cloud/recovery-questions?username=${encodeURIComponent(username.trim().toLowerCase())}`,
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
    const apiBase = await this.resolveApiBase();
    if (apiBase === null) {
      return { ok: false, error: 'Configura la URL del Servidor Cloud Sync o usa recuperación local.' };
    }
    try {
      const res = await fetch(`${apiBase}/api/cloud/recover`, {
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

  async publishDuelChallenge(challenge: AsyncDuelChallenge): Promise<boolean> {
    if (!navigator.onLine) return false;
    const apiBase = await this.resolveApiBase();
    if (apiBase === null) return false;
    try {
      const res = await fetch(`${apiBase}/api/duels/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(challenge),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchDuelChallenges(): Promise<AsyncDuelChallenge[]> {
    if (!navigator.onLine) return [];
    const apiBase = await this.resolveApiBase();
    if (apiBase === null) return [];
    try {
      const res = await fetch(`${apiBase}/api/duels/challenges`);
      if (!res.ok) return [];
      const data = (await res.json()) as { challenges?: AsyncDuelChallenge[] };
      return data.challenges || [];
    } catch {
      return [];
    }
  }
}

export const cloudSyncManager = new CloudSyncManager();
