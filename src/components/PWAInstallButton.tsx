import React, { useEffect, useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC<{ onOpenApkCenter?: () => void; compact?: boolean }> = ({
  onOpenApkCenter,
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted && onOpenApkCenter) {
        onOpenApkCenter();
      }
      return;
    }
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    onOpenApkCenter?.();
  };

  return (
    <>
      <button
        type="button"
        data-testid="btn-download-apk-web"
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-lg ${
          compact ? 'min-h-[34px] px-2.5 py-1 text-[11px]' : 'min-h-[42px] px-3.5 py-2 text-xs sm:text-sm'
        }`}
      >
        {isInstallable ? <Download className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
        <span>DESCARGAR APK-WEB</span>
      </button>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#111622] border border-slate-700 p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-amber-300">Instalar en iPhone / iPad</h3>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              1. Toca el botón <strong>Compartir</strong> en la barra inferior de Safari.<br />
              2. Selecciona <strong>Añadir a pantalla de inicio</strong> para jugar en pantalla completa offline.
            </p>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-sm cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-2 rounded-lg bg-[#1c1610] border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-200 shadow-lg">
      <WifiOff className="w-3.5 h-3.5 text-amber-400" />
      <span>Modo Offline · IndexedDB (Dexie) Activo</span>
    </div>
  );
};
