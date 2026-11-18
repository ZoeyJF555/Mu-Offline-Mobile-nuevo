import React, { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Database,
  Download,
  FileArchive,
  GitBranch,
  RefreshCw,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { exportDatabaseFile, getDatabaseStats, importDatabaseFile } from '../db/dexieStore';
import { generateAndroidApkKitZip } from '../services/apkKitGenerator';
import { cloudSyncManager } from '../services/cloudSyncManager';
import type { SyncStatusInfo } from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';

interface ApkSyncDrawerProps {
  open: boolean;
  syncStatus: SyncStatusInfo;
  onClose: () => void;
  onDatabaseImported: () => Promise<void>;
}

interface OtaManifest {
  appName: string;
  version: string;
  buildTimestamp: string;
  webEntryUrl: string;
  offlineEngine: string;
  githubWorkflow: string;
}

export const ApkSyncDrawer: React.FC<ApkSyncDrawerProps> = ({
  open,
  syncStatus,
  onClose,
  onDatabaseImported,
}) => {
  const [manifest, setManifest] = useState<OtaManifest | null>(null);
  const [dbStats, setDbStats] = useState<{
    tables: Array<{ name: string; rows: number }>;
    byteSize: number;
  } | null>(null);
  const [repoUrl, setRepoUrl] = useState('https://github.com/ZoeyJF555/Mu-Offline-Mobile-nuevo-');
  const [downloadingKit, setDownloadingKit] = useState(false);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getDatabaseStats().then(setDbStats).catch(() => {});
    fetch('/api/ota/manifest')
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const handleDownloadApkKit = async () => {
    setDownloadingKit(true);
    setNotice(null);
    try {
      const blob = await generateAndroidApkKitZip({
        webAppUrl: manifest?.webEntryUrl || window.location.origin,
        repoUrl,
        appVersion: manifest?.version || '2.0.0',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mu-lorencia-apk-github-kit.zip';
      a.click();
      URL.revokeObjectURL(url);
      setNotice(
        'Kit APK + GitHub Actions descargado. Súbelo en commits pequeños (sin node_modules ni dist) para compilar el APK automáticamente en GitHub.',
      );
    } finally {
      setDownloadingKit(false);
    }
  };

  const handleManualCloudSync = async () => {
    setSyncingCloud(true);
    setNotice(null);
    try {
      const res = await cloudSyncManager.syncNow();
      setNotice(res.message);
      const stats = await getDatabaseStats();
      setDbStats(stats);
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleExportJson = async () => {
    const blob = await exportDatabaseFile();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mu-lorencia-dexie-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Respaldo IndexedDB (.json) exportado correctamente.');
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importDatabaseFile(file);
    await onDatabaseImported();
    const stats = await getDatabaseStats();
    setDbStats(stats);
    setNotice('Base de datos IndexedDB (Dexie) restaurada con éxito.');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/75 p-0 md:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-lg font-bold text-amber-300">
                PWA, Cloud Sync (Timestamp) e IndexedDB Dexie
              </h2>
              <p className="text-xs text-slate-400">
                Instalación offline-first con caché de modelos .glb, sincronización sin sobreescritura y kit APK Android.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar panel APK"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#1a2233] hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {notice && (
          <div className="px-5 py-2.5 bg-emerald-950/70 border-b border-emerald-500/30 text-xs text-emerald-200">
            {notice}
          </div>
        )}

        <div className="flex-1 overflow-y-auto mu-scroll p-5 space-y-5">
          {/* 1. Direct Mobile Web Install + Cloud Sync Status */}
          <div className="p-4 rounded-xl bg-[#151c2c] border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  1. PWA Offline-First + Service Worker Auto-Update
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Versión: <span className="font-mono-tabular text-amber-300">{manifest?.version || '2.0.0'}</span> · Motor: <span className="text-sky-300">{manifest?.offlineEngine || 'Dexie IndexedDB + Babylon.js GLB'}</span>
                </p>
              </div>
              <PWAInstallButton />
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-2 text-xs">
                {syncStatus.isOnline ? (
                  <Cloud className="w-4 h-4 text-emerald-400" />
                ) : (
                  <CloudOff className="w-4 h-4 text-amber-400" />
                )}
                <span className="text-slate-200">
                  {syncStatus.isOnline
                    ? `En línea · Pendientes: ${syncStatus.pendingCount}`
                    : `Sin internet (Offline) · Pendientes locales: ${syncStatus.pendingCount}`}
                </span>
                {syncStatus.lastMessage && (
                  <span className="text-slate-400">({syncStatus.lastMessage})</span>
                )}
              </div>
              <button
                onClick={handleManualCloudSync}
                disabled={syncingCloud || !syncStatus.isOnline}
                className="min-h-[38px] px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
                Sincronizar Nube Ahora
              </button>
            </div>
          </div>

          {/* 2. Downloadable Android APK Wrapper + GitHub Actions Workflow */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <FileArchive className="w-4 h-4" />
              2. Kit APK Android (WebView + Capacitor + GitHub Actions)
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Al compilar el APK desde GitHub Actions, la aplicación precarga todos los modelos <code>.glb</code> medievales y ejecuta el juego en pantalla completa offline usando Dexie IndexedDB y sincronización por fecha <code>updatedAt</code> al recuperar conexión.
            </p>
            <label className="block text-xs text-slate-400">
              URL de tu repositorio GitHub:
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg bg-[#0d111a] border border-slate-700 px-3 text-xs font-mono-tabular text-slate-100"
              />
            </label>
            <button
              onClick={handleDownloadApkKit}
              disabled={downloadingKit}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs inline-flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {downloadingKit ? 'Empaquetando Kit...' : 'Descargar Kit APK + Workflow (.zip)'}
            </button>
          </div>

          {/* 3. GitHub Push Hygiene */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <GitBranch className="w-4 h-4" />
              3. Buenas Prácticas para GitHub &amp; Auto-Update PWA
            </div>
            <ul className="list-disc pl-5 text-xs text-slate-300 space-y-1.5 leading-relaxed">
              <li>
                Mantén <code>node_modules/</code>, <code>dist/</code> y <code>build/</code> en <code>.gitignore</code> para evitar pushes pesados.
              </li>
              <li>
                Cada push actualiza el Service Worker (<code>autoUpdate</code>), descargando nuevos mapas <code>.glb</code> y parches automáticamente al abrir la app.
              </li>
            </ul>
          </div>

          {/* 4. Dexie IndexedDB Inspector & Backup */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                <Database className="w-4 h-4" />
                4. Base de Datos Local IndexedDB / Dexie ({dbStats ? `${(dbStats.byteSize / 1024).toFixed(1)} KB` : '...'})
              </div>
              <button
                onClick={() => getDatabaseStats().then(setDbStats)}
                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Actualizar
              </button>
            </div>

            {dbStats && (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                {dbStats.tables.map((t) => (
                  <div key={t.name} className="p-2.5 rounded-lg bg-[#0d111a] border border-slate-800">
                    <div className="text-[11px] text-slate-400 truncate">{t.name}</div>
                    <div className="text-sm font-bold font-mono-tabular text-slate-100 mt-0.5">
                      {t.rows} filas
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap pt-1">
              <button
                onClick={handleExportJson}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Exportar Respaldo (.json)
              </button>

              <label className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1e293b] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-4 h-4" />
                Importar Respaldo (.json)
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportJson}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
