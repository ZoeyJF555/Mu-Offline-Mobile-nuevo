import React, { useEffect, useState } from 'react';
import {
  Database,
  Download,
  FileArchive,
  GitBranch,
  RefreshCw,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { generateAndroidApkKitZip } from '../services/apkKitGenerator';
import { exportSqliteFile, getSqliteStats, importSqliteFile } from '../db/sqliteStore';
import { PWAInstallButton } from './PWAInstallButton';

interface ApkSyncDrawerProps {
  open: boolean;
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
  onClose,
  onDatabaseImported,
}) => {
  const [manifest, setManifest] = useState<OtaManifest | null>(null);
  const [sqlStats, setSqlStats] = useState<{
    tables: Array<{ name: string; rows: number }>;
    byteSize: number;
  } | null>(null);
  const [repoUrl, setRepoUrl] = useState('https://github.com/tu-usuario/mu-lorencia-offline');
  const [downloadingKit, setDownloadingKit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getSqliteStats().then(setSqlStats).catch(() => {});
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
        appVersion: manifest?.version || '1.4.0',
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

  const handleExportSqlite = async () => {
    const blob = await exportSqliteFile();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mu-lorencia-save-${new Date().toISOString().slice(0, 10)}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Respaldo .sqlite exportado correctamente.');
  };

  const handleImportSqlite = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importSqliteFile(file);
    await onDatabaseImported();
    const stats = await getSqliteStats();
    setSqlStats(stats);
    setNotice('Base de datos .sqlite restaurada con éxito.');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/75 p-0 md:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-lg font-bold text-amber-300">
                APK Móvil Web, GitHub Auto-Update y SQLite
              </h2>
              <p className="text-xs text-slate-400">
                Instalación web en móvil, descarga de proyecto APK con actualización automática y respaldo SQLite.
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
          {/* 1. Direct Mobile Web Install + Live OTA Manifest */}
          <div className="p-4 rounded-xl bg-[#151c2c] border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  1. Ejecución en Web Móvil (PWA + Service Worker Auto-Update)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Versión activa: <span className="font-mono-tabular text-amber-300">{manifest?.version || '1.4.0'}</span> · Cada cambio desplegado se actualiza solo al abrir el juego en el teléfono.
                </p>
              </div>
              <PWAInstallButton />
            </div>
          </div>

          {/* 2. Downloadable Android APK Wrapper + GitHub Actions Workflow */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <FileArchive className="w-4 h-4" />
              2. Kit APK Android (WebView + Capacitor + GitHub Actions)
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Este repositorio ya incluye <code>.github/workflows/build-apk.yml</code>. Al subir el código en pasos pequeños a GitHub, GitHub Actions compila automáticamente el archivo <strong>app-debug.apk</strong> en la nube y lo publica en <em>Releases</em>. Al abrir ese APK en el móvil, ejecuta la web en pantalla completa con caché offline y permisos Bluetooth/Wi-Fi.
            </p>
            <label className="block text-xs text-slate-400">
              URL de tu repositorio GitHub (opcional para incluir en el manifiesto OTA del APK):
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

          {/* 3. How to avoid the 320MB GitHub permission / push failure */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <GitBranch className="w-4 h-4" />
              3. Solución al error de GitHub (320 MB perdidos / falso error de permisos)
            </div>
            <ul className="list-disc pl-5 text-xs text-slate-300 space-y-1.5 leading-relaxed">
              <li>
                <strong>Por qué falló:</strong> GitHub bloquea pushes que superan 100 MB por archivo (por ejemplo al incluir <code>node_modules/</code>, <code>android/build/</code> o un <code>.apk</code> dentro del commit), y muchas veces la consola muestra un error genérico de permisos o rechazo HTTP 400/403.
              </li>
              <li>
                <strong>Paso correcto:</strong> Verifica que <code>node_modules/</code>, <code>dist/</code> y <code>build/</code> estén en <code>.gitignore</code> antes de hacer <code>git add</code>, y sube cada avance con commits pequeños (&lt; 5 MB).
              </li>
              <li>
                <strong>Permisos de Token (PAT):</strong> En GitHub Settings &gt; Developer Settings &gt; Tokens, asegúrate de marcar <code>repo</code> y <code>workflow</code> (sin <code>workflow</code>, GitHub rechaza archivos dentro de <code>.github/workflows/</code> con error de permisos).
              </li>
            </ul>
          </div>

          {/* 4. SQLite Database Inspector & Backup */}
          <div className="p-4 rounded-xl bg-[#141a26] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                <Database className="w-4 h-4" />
                4. Base de Datos SQLite Integrada ({sqlStats ? `${(sqlStats.byteSize / 1024).toFixed(1)} KB` : '...'})
              </div>
              <button
                onClick={() => getSqliteStats().then(setSqlStats)}
                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Actualizar
              </button>
            </div>

            {sqlStats && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {sqlStats.tables.map((t) => (
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
                onClick={handleExportSqlite}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Exportar .sqlite
              </button>

              <label className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1e293b] hover:bg-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-4 h-4" />
                Importar .sqlite
                <input
                  type="file"
                  accept=".sqlite,.db"
                  onChange={handleImportSqlite}
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
