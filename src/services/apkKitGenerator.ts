import JSZip from 'jszip';

export interface ApkKitOptions {
  webAppUrl: string;
  repoUrl: string;
  appVersion: string;
}

export async function generateAndroidApkKitZip(opts: ApkKitOptions): Promise<Blob> {
  const zip = new JSZip();
  const cleanWebUrl = opts.webAppUrl.replace(/\/$/, '');

  zip.file(
    'README_PASO_A_PASO.md',
    `# MU Lorencia Offline & Sync — Kit APK Auto-Actualizable

Este paquete contiene el proyecto Android WebView/Capacitor + el Workflow de GitHub Actions para generar un **archivo APK único** que siempre ejecuta la versión web más reciente (y funciona offline gracias al Service Worker + SQLite WASM integrado).

## 1. Cómo evitar el error de GitHub de 320MB y permisos
Cuando subes archivos pesados (>100MB, como carpetas \`node_modules/\`, \`dist/\` o \`android/build/\`), GitHub rechaza el push con errores de permisos o tamaño de archivo.

**Regla de oro:**
1. Nunca subas \`node_modules/\`, \`dist/\`, \`build/\`, ni \`.apk\` directamente por \`git push\`. El archivo \`.gitignore\` ya los excluye.
2. Usa **commits pequeños por paso** (ej: primero \`src/\`, luego \`server.ts\`, luego \`.github/workflows/build-apk.yml\`).
3. En GitHub, si usas HTTPS con Token (PAT), verifica que tu token tenga marcados los permisos: \`repo\` y \`workflow\`.
4. Deja que **GitHub Actions** compile el APK en la nube gratis cada vez que hagas \`git push\`.

## 2. Cómo funciona la auto-actualización dentro del APK
- El APK abre el juego en un **WebView nativo con WebGL2 + IndexedDB + Web Bluetooth + Service Worker** apuntando a: \`${cleanWebUrl}\`.
- Cada vez que actualizas tu repositorio, el servidor web y el Service Worker actualizan el juego automáticamente dentro del APK sin obligar al usuario a reinstalar el APK cada día.
- Si además cambias permisos nativos de Android, GitHub Actions genera un nuevo \`app-debug.apk\` en la pestaña **Releases** del repositorio.
`,
  );

  zip.file(
    'capacitor.config.json',
    JSON.stringify(
      {
        appId: 'com.mulorencia.offline',
        appName: 'MU Lorencia Offline',
        webDir: 'dist',
        server: {
          url: cleanWebUrl,
          cleartext: true,
          allowNavigation: ['*'],
        },
        android: {
          allowMixedContent: true,
          webContentsDebuggingEnabled: true,
        },
      },
      null,
      2,
    ),
  );

  zip.file(
    'android/app/src/main/AndroidManifest.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.mulorencia.offline">

    <!-- Red local Wi-Fi y actualizaciones web -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!-- Vinculación Bluetooth cercana (Android 12+) -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

    <application
        android:allowBackup="true"
        android:label="MU Lorencia Offline"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:screenOrientation="sensorLandscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
  );

  zip.file(
    'android/app/src/main/java/com/mulorencia/offline/MainActivity.java',
    `package com.mulorencia.offline;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;

public class MainActivity extends Activity {
    private static final String LIVE_WEB_URL = "${cleanWebUrl}";
    private static final String OFFLINE_FALLBACK = "file:///android_asset/public/index.html";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                view.loadUrl(OFFLINE_FALLBACK);
            }
        });

        webView.loadUrl(LIVE_WEB_URL);
        setContentView(webView);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`,
  );

  zip.file(
    '.github/workflows/build-apk.yml',
    `name: Build Auto-Updating Android APK
on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci && npm run build
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - name: Capacitor Android Build
        run: |
          npm install @capacitor/core @capacitor/cli @capacitor/android
          npx cap sync android
          cd android && chmod +x gradlew && ./gradlew assembleDebug
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: v${opts.appVersion}.\${{ github.run_number }}
          files: android/app/build/outputs/apk/debug/app-debug.apk
`,
  );

  zip.file(
    'ota-updater.json',
    JSON.stringify(
      {
        version: opts.appVersion,
        webEntryUrl: cleanWebUrl,
        repoUrl: opts.repoUrl || 'https://github.com/tu-usuario/mu-lorencia-offline',
        autoUpdateWebBundle: true,
        offlineEngine: 'Dexie IndexedDB + Workbox GLB Cache',
      },
      null,
      2,
    ),
  );

  return zip.generateAsync({ type: 'blob' });
}
