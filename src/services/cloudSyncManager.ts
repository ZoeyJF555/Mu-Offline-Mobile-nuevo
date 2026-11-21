import { countPendingSync, db, setOnLocalMutationListener } from '../db/dexieStore';
import { getConfiguredCloudApiUrl, probeSameOriginBackend } from './githubOtaService';
import { generateRecoveryCode, syncEncryptedBackup } from './privateBackup';
import type { AsyncDuelChallenge, MuAccount, SyncStatusInfo } from '../types/game';

const backupStorageKey = (id: string) => 'mu-private-backup-v1:' + id;

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

  private async privateBackupEndpoint() {
    const base = await this.resolveApiBase();
    if (base === null) throw new Error('Configura la URL HTTPS de tu servidor de respaldo.');
    return new URL('api/private-backup', base ? base.replace(/\/$/, '') + '/' : new URL(import.meta.env.BASE_URL, location.href));
  }

  private async localBackup(accountId: string) {
    return db.transaction('r',db.Accounts,db.Characters,async () => {
      const account = await db.Accounts.get(accountId);
      if (!account) throw new Error('Inicia sesión antes de crear una copia.');
      const characters = await db.Characters.where('accountId').equals(account.id).toArray();
      return { account, characters };
    });
  }

  private async applyBackup(data: Awaited<ReturnType<CloudSyncManager['localBackup']>>) {
    const changed = await db.transaction('rw',db.Accounts,db.Characters,async () => {
      let updated = false;
      const local = await db.Accounts.get(data.account.id);
      const conflicting = await db.Accounts.where('username').equals(data.account.username).first();
      if (conflicting && conflicting.id !== data.account.id) throw new Error('Ya tienes otra cuenta local con ese nombre.');
      if (!local || data.account.updatedAt > local.updatedAt) {
        await db.Accounts.put({ ...data.account, isSynced: true });
        updated = true;
      } else if (!local.isSynced && data.account.updatedAt === local.updatedAt) {
        await db.Accounts.update(local.id,{isSynced:true});
      }
      for (const char of data.characters) {
        const current = await db.Characters.get(char.id);
        if (current && current.accountId !== data.account.id) continue;
        if (!current || char.updatedAt > current.updatedAt) {
          await db.Characters.put({ ...char,isSynced:true });
          updated = true;
        } else if (!current.isSynced && char.updatedAt === current.updatedAt) {
          await db.Characters.update(current.id,{isSynced:true});
        }
      }
      return updated;
    });
    if (changed) this.dataAppliedListeners.forEach(fn => fn());
  }

  async createPrivateBackup() {
    const id = this.activeAccountId;
    if (!id) throw new Error('Inicia sesión antes de crear una copia.');
    const storage = backupStorageKey(id);
    const existing = localStorage.getItem(storage);
    const code = existing || generateRecoveryCode();
    const result = await syncEncryptedBackup(await this.privateBackupEndpoint(),code,await this.localBackup(id));
    await this.applyBackup(result);
    localStorage.setItem(storage,code);
    return code;
  }

  async restorePrivateBackup(code: string) {
    const data = await syncEncryptedBackup(await this.privateBackupEndpoint(),code);
    await this.applyBackup(data);
    localStorage.setItem(backupStorageKey(data.account.id),code.trim().toLowerCase());
    return data.characters.length;
  }

  async syncNow(): Promise<{ ok: boolean; message: string }> {
    if (!navigator.onLine) {
      this.emitStatus({ isOnline: false });
      return { ok: false, message: 'Sin conexión. Tu progreso sigue en este dispositivo.' };
    }
    if (this.status.syncing) return { ok:true, message:'La copia privada se está guardando.' };
    const id = this.activeAccountId;
    const code = id && localStorage.getItem(backupStorageKey(id));
    if (!id || !code) {
      await this.refreshPendingCount();
      return { ok: true, message: 'Partida local. Activa la copia privada en el menú de respaldo.' };
    }
    this.emitStatus({ isOnline:true, syncing:true });
    try {
      const result = await syncEncryptedBackup(await this.privateBackupEndpoint(), code, await this.localBackup(id));
      await this.applyBackup(result);
      const message = 'Copia privada sincronizada.';
      this.emitStatus({ lastMessage:message,lastSyncedAt:Date.now() });
      return { ok:true,message };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La copia privada queda pendiente.';
      this.emitStatus({ lastMessage:message });
      return { ok:false,message };
    } finally {
      this.emitStatus({ syncing:false });
      await this.refreshPendingCount();
    }
  }

  async fetchRecoveryQuestionsFromCloud(_username: string): Promise<{ found: true; secretQ1: string; secretQ2: string } | { found: false; error: string }> {
    return { found:false,error:'Para recuperar otro dispositivo usa tu código en Copia privada.' };
  }

  async recoverAccountFromCloud(_input: { username:string; answer1:string; answer2:string; newPassword:string }):
    Promise<{ok:true;account:MuAccount;charactersCount:number} | {ok:false;error:string}> {
    return { ok:false,error:'Para recuperar otro dispositivo usa tu código en Copia privada.' };
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
