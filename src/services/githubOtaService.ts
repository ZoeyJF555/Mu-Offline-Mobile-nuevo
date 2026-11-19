export interface LocalOtaManifest {
  appName: string;
  version: string;
  repo: string;
  pagesUrl: string;
  apkReleaseUrl: string;
  buildTimestamp: string;
  webEntryUrl?: string;
  offlineEngine: string;
}

export interface GithubOtaStatus {
  repoSlug: string;
  repoUrl: string;
  pagesUrl: string;
  localVersion: string;
  localBuildTimestamp: string;
  pagesVersion: string | null;
  pagesBuildTimestamp: string | null;
  latestCommitSha: string | null;
  latestCommitMessage: string | null;
  latestCommitDate: string | null;
  latestReleaseTag: string | null;
  latestApkUrl: string | null;
  updateAvailable: boolean;
  updateReason: string | null;
  checkedAt: number;
  cloudApiUrl: string;
  sameOriginApiAvailable: boolean;
}

const DEFAULT_REPO_SLUG = 'ZoeyJF555/Mu-Offline-Mobile-nuevo-';
const REPO_STORAGE_KEY = 'mu_github_repo_slug';
const CLOUD_URL_STORAGE_KEY = 'mu_cloud_api_url';
const SEEN_COMMIT_STORAGE_KEY = 'mu_seen_github_commit';

export function normalizeRepoSlug(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_REPO_SLUG;
  const ghMatch = trimmed.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
  if (ghMatch?.[1]) {
    return ghMatch[1].replace(/\.git$/i, '').replace(/\/+$/, '');
  }
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return trimmed.replace(/\.git$/i, '');
  }
  return DEFAULT_REPO_SLUG;
}

export function getLinkedGithubRepoSlug(): string {
  try {
    const saved = localStorage.getItem(REPO_STORAGE_KEY);
    return saved ? normalizeRepoSlug(saved) : DEFAULT_REPO_SLUG;
  } catch {
    return DEFAULT_REPO_SLUG;
  }
}

export function setLinkedGithubRepoSlug(repoUrlOrSlug: string): string {
  const slug = normalizeRepoSlug(repoUrlOrSlug);
  try {
    localStorage.setItem(REPO_STORAGE_KEY, slug);
  } catch {
    // ignore storage errors
  }
  return slug;
}

export function getGithubRepoUrl(slug = getLinkedGithubRepoSlug()): string {
  return `https://github.com/${slug}`;
}

export function getGithubPagesUrl(slug = getLinkedGithubRepoSlug()): string {
  const [owner, repo] = slug.split('/');
  if (!owner || !repo) return 'https://zoeyjf555.github.io/Mu-Offline-Mobile-nuevo-/';
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

export function getConfiguredCloudApiUrl(): string {
  try {
    const saved = localStorage.getItem(CLOUD_URL_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    // ignore
  }
  const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CLOUD_API_URL;
  return envUrl ? envUrl.trim().replace(/\/+$/, '') : '';
}

export function setConfiguredCloudApiUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '');
  try {
    if (clean) localStorage.setItem(CLOUD_URL_STORAGE_KEY, clean);
    else localStorage.removeItem(CLOUD_URL_STORAGE_KEY);
  } catch {
    // ignore
  }
  return clean;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') && !url.endsWith('.json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function probeSameOriginBackend(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'file:' || window.location.hostname.endsWith('.github.io')) {
    return false;
  }
  try {
    const res = await fetch('/api/ota/manifest', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    return res.ok && ct.includes('application/json');
  } catch {
    return false;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) {
      return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
    }
  }
  return 0;
}

export async function checkForGithubOtaUpdate(): Promise<GithubOtaStatus> {
  const repoSlug = getLinkedGithubRepoSlug();
  const repoUrl = getGithubRepoUrl(repoSlug);
  const pagesUrl = getGithubPagesUrl(repoSlug);
  const cloudApiUrl = getConfiguredCloudApiUrl();

  const [sameOriginApiAvailable, localStaticManifest, localApiManifest] = await Promise.all([
    probeSameOriginBackend(),
    fetchJsonWithTimeout<LocalOtaManifest>(`./ota-manifest.json`),
    fetchJsonWithTimeout<LocalOtaManifest>(`/api/ota/manifest`),
  ]);

  const localManifest = localApiManifest || localStaticManifest;
  const localVersion = localManifest?.version || '2.2.0';
  const localBuildTimestamp = localManifest?.buildTimestamp || '';

  let pagesVersion: string | null = null;
  let pagesBuildTimestamp: string | null = null;
  let latestCommitSha: string | null = null;
  let latestCommitMessage: string | null = null;
  let latestCommitDate: string | null = null;
  let latestReleaseTag: string | null = null;
  let latestApkUrl: string | null = `${repoUrl}/releases/latest`;

  if (typeof navigator === 'undefined' || navigator.onLine) {
    const pagesManifestUrl = `${pagesUrl.replace(/\/$/, '')}/ota-manifest.json?t=${Date.now()}`;
    const [pagesManifest, commitInfo, releaseInfoList] = await Promise.all([
      fetchJsonWithTimeout<LocalOtaManifest>(pagesManifestUrl, 5000),
      fetchJsonWithTimeout<{
        sha?: string;
        commit?: { message?: string; committer?: { date?: string } };
      }>(`https://api.github.com/repos/${repoSlug}/commits/main`, 5000),
      fetchJsonWithTimeout<
        Array<{
          tag_name?: string;
          html_url?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        }>
      >(`https://api.github.com/repos/${repoSlug}/releases?per_page=1`, 5000),
    ]);

    if (pagesManifest) {
      pagesVersion = pagesManifest.version;
      pagesBuildTimestamp = pagesManifest.buildTimestamp;
    }

    if (commitInfo?.sha) {
      latestCommitSha = commitInfo.sha.slice(0, 7);
      latestCommitMessage = commitInfo.commit?.message?.split('\n')[0] || null;
      latestCommitDate = commitInfo.commit?.committer?.date || null;
    }

    const releaseInfo = Array.isArray(releaseInfoList) ? releaseInfoList[0] : null;
    if (releaseInfo?.tag_name) {
      latestReleaseTag = releaseInfo.tag_name;
      const apkAsset = releaseInfo.assets?.find((a) => a.name?.toLowerCase().endsWith('.apk'));
      latestApkUrl = apkAsset?.browser_download_url || releaseInfo.html_url || latestApkUrl;
    }
  }

  let updateAvailable = false;
  let updateReason: string | null = null;

  if (pagesVersion && compareSemver(pagesVersion, localVersion) > 0) {
    updateAvailable = true;
    updateReason = `Nueva versión ${pagesVersion} disponible en GitHub Pages (local: ${localVersion}).`;
  } else if (
    pagesBuildTimestamp &&
    localBuildTimestamp &&
    Date.parse(pagesBuildTimestamp) > Date.parse(localBuildTimestamp) + 60_000
  ) {
    updateAvailable = true;
    updateReason = 'Nuevo despliegue web detectado en GitHub Pages.';
  } else if (latestCommitSha) {
    try {
      const seen = localStorage.getItem(SEEN_COMMIT_STORAGE_KEY);
      if (!seen) {
        localStorage.setItem(SEEN_COMMIT_STORAGE_KEY, latestCommitSha);
      } else if (seen !== latestCommitSha) {
        updateAvailable = true;
        updateReason = `Nuevo commit (${latestCommitSha}) detectado en ${repoSlug}.`;
      }
    } catch {
      // ignore
    }
  }

  return {
    repoSlug,
    repoUrl,
    pagesUrl,
    localVersion,
    localBuildTimestamp,
    pagesVersion,
    pagesBuildTimestamp,
    latestCommitSha,
    latestCommitMessage,
    latestCommitDate,
    latestReleaseTag,
    latestApkUrl,
    updateAvailable,
    updateReason,
    checkedAt: Date.now(),
    cloudApiUrl,
    sameOriginApiAvailable,
  };
}

export async function applyWebOtaUpdate(latestCommitSha?: string | null): Promise<void> {
  if (latestCommitSha) {
    try {
      localStorage.setItem(SEEN_COMMIT_STORAGE_KEY, latestCommitSha);
    } catch {
      // ignore
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    } catch {
      // ignore
    }
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.includes('mu-flyff-assets'))
          .map((k) => caches.delete(k)),
      );
    } catch {
      // ignore
    }
  }

  window.location.reload();
}
