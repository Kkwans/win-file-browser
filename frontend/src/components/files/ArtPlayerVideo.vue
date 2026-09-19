<template>
  <div
    class="art-player-stage"
    :class="{
      'art-player-stage--busy': busy,
      'art-player-stage--asking': askVisible,
      'art-player-stage--portrait': isPortrait,
      'art-player-stage--mobile': isMobile,
      'art-player-stage--rate-open': rateDialogVisible,
    }"
  >
    <div ref="container" class="art-player-box"></div>

    <div v-if="loadingVisible" class="art-loading" role="status">
      <div class="art-ring" aria-hidden="true"></div>
      <div class="art-loading-text">
        <strong>{{ loadingTitle }}</strong>
        <span v-if="progressLabel">{{ progressLabel }}</span>
      </div>
    </div>

    <div v-if="askVisible" class="art-ask-overlay">
      <div class="art-ask-card">
        <div class="art-ask-title">选择播放方式</div>
        <div class="art-ask-sub">默认策略为「每次询问」；选择后立即生效</div>
        <div class="art-ask-actions">
          <button type="button" class="art-ask-btn" @click="chooseMode('native')">
            原生播放
          </button>
          <button
            type="button"
            class="art-ask-btn art-ask-btn--primary"
            :disabled="busy"
            @click="chooseMode('compat')"
          >
            兼容转码
          </button>
          <a class="art-ask-btn" :href="downloadUrl" download>下载</a>
        </div>
      </div>
    </div>

    <!-- Custom rate dialog: teleported into ArtPlayer so it works in fullscreen -->
    <Teleport v-if="rateDialogVisible && playerRoot" :to="playerRoot">
      <div class="art-modal-mask" @click.self="rateDialogVisible = false">
        <div class="art-modal" role="dialog" aria-label="自定义倍速">
          <div class="art-modal-title">自定义倍速</div>
          <div class="art-modal-sub">范围 0.10x – 5.00x，支持两位小数</div>
          <div class="art-modal-field">
            <input
              ref="rateInput"
              v-model.number="rateDraft"
              type="number"
              min="0.1"
              max="5"
              step="0.01"
              inputmode="decimal"
            />
            <span class="art-modal-unit">x</span>
          </div>
          <input
            v-model.number="rateDraft"
            class="art-modal-range"
            type="range"
            min="0.1"
            max="5"
            step="0.01"
          />
          <div class="art-modal-actions">
            <button type="button" class="art-modal-btn" @click="rateDialogVisible = false">
              取消
            </button>
            <button type="button" class="art-modal-btn art-modal-btn--ok" @click="confirmRate">
              应用
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <div
      v-else-if="rateDialogVisible"
      class="art-modal-mask"
      @click.self="rateDialogVisible = false"
    >
      <div class="art-modal" role="dialog" aria-label="自定义倍速">
        <div class="art-modal-title">自定义倍速</div>
        <div class="art-modal-sub">范围 0.10x – 5.00x，支持两位小数</div>
        <div class="art-modal-field">
          <input
            ref="rateInput"
            v-model.number="rateDraft"
            type="number"
            min="0.1"
            max="5"
            step="0.01"
            inputmode="decimal"
          />
          <span class="art-modal-unit">x</span>
        </div>
        <input
          v-model.number="rateDraft"
          class="art-modal-range"
          type="range"
          min="0.1"
          max="5"
          step="0.01"
        />
        <div class="art-modal-actions">
          <button type="button" class="art-modal-btn" @click="rateDialogVisible = false">
            取消
          </button>
          <button type="button" class="art-modal-btn art-modal-btn--ok" @click="confirmRate">
            应用
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { files as api, media as mediaApi, users as usersApi } from "@/api";
import { createURL } from "@/api/utils";
import { useAuthStore } from "@/stores/auth";

type Policy = "native" | "compat" | "ask";
type ActualMode = "native" | "compat";
type Quality = "source" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "native";

const PRESET_RATES = [0.25, 0.5, 1, 1.25, 1.5, 2];

const props = defineProps<{
  path: string;
  source: string;
  poster?: string;
  downloadSource?: string;
  subtitles?: { url: string; lang?: string; name?: string }[];
}>();

const authStore = useAuthStore();
const container = ref<HTMLElement | null>(null);
const art = shallowRef<Artplayer | null>(null);
const busy = ref(false);
const askVisible = ref(false);
const actualMode = ref<ActualMode>("native");
const currentRate = ref(1);
const rateDraft = ref(1);
const rateDialogVisible = ref(false);
const rateInput = ref<HTMLInputElement | null>(null);
const sourceWidth = ref(0);
const sourceHeight = ref(0);
const sourceVideoCodec = ref("");
const playerRoot = ref<HTMLElement | null>(null);
const transcodeQuality = ref<Quality>("source");
const loadProgress = ref<number | null>(null);
const videoPlaying = ref(false);
const isPortrait = ref(false);
const isMobile = ref(false);
let hlsInstance: Hls | null = null;
let progressTimer: number | null = null;
let loaderForceTimer: number | null = null;
let switchToken = 0;
let lastSavedPosition = 0;
let lastSaveAt = 0;
let nativeLoadHandlers: Array<() => void> = [];
let sizeHandler: (() => void) | null = null;

type SettingRow = {
  tooltip?: string;
  $item?: HTMLElement;
  selector?: Array<{ name?: string; html?: string; value?: string }>;
};

type SettingApi = {
  show?: boolean;
  find?: (name: string) => SettingRow | null | undefined;
  check?: (item: unknown) => void;
  resize?: () => void;
  add?: (o: Record<string, unknown>) => void;
};

const policy = computed<Policy>(() => {
  const raw = (
    authStore.user?.playerPreferences?.playbackMode || "native"
  ).toLowerCase();
  if (raw === "compat") return "compat";
  if (raw === "ask") return "ask";
  return "native";
});

const downloadUrl = computed(
  () =>
    props.downloadSource ||
    api.getDownloadURL({ path: props.path } as never, false)
);

const resolutionLabel = computed(() => {
  const h = sourceHeight.value;
  const w = sourceWidth.value;
  if (!h && !w) return "—";
  if (h >= 2000) return "4K";
  if (h >= 1300) return "2K";
  if (h >= 900) return "1080p";
  if (h >= 600) return "720p";
  if (h >= 400) return "480p";
  return w && h ? `${w}x${h}` : `${h}p`;
});

/**
 * Native mode cannot re-encode: only show the source resolution.
 * Compat mode (ffmpeg HLS) can go down from source.
 */
const qualityOptions = computed(() => {
  if (actualMode.value !== "compat") {
    return [{ html: resolutionLabel.value, value: "native" }];
  }
  const h = sourceHeight.value || 0;
  const opts: { html: string; value: Quality }[] = [
    {
      html: h ? `原画 ${resolutionLabel.value}` : "原画",
      value: "source",
    },
  ];
  const caps: Array<{ value: Quality; minH: number; html: string }> = [
    { value: "2160p", minH: 2000, html: "4K" },
    { value: "1440p", minH: 1300, html: "2K" },
    { value: "1080p", minH: 900, html: "1080p" },
    { value: "720p", minH: 600, html: "720p" },
    { value: "480p", minH: 400, html: "480p" },
  ];
  for (const cap of caps) {
    if (!h || h >= cap.minH) opts.push({ html: cap.html, value: cap.value });
  }
  if (!opts.some((o) => o.value === "480p")) {
    opts.push({ html: "480p", value: "480p" });
  }
  return opts;
});

function preferredCompatQuality(): Exclude<Quality, "native"> {
  if (transcodeQuality.value !== "source" && transcodeQuality.value !== "native") {
    return transcodeQuality.value;
  }
  const h = sourceHeight.value || 0;
  if (h >= 2000) return "2160p";
  if (h >= 1300) return "1440p";
  if (h >= 900) return "1080p";
  if (h >= 600) return "720p";
  return "480p";
}

const actualModeLabel = computed(() =>
  actualMode.value === "compat" ? "兼容" : "原生"
);

const loadingTitle = computed(() =>
  actualMode.value === "compat" ? "兼容播放加载中" : "原生播放加载中"
);

const progressLabel = computed(() => {
  if (loadProgress.value == null) return "";
  return `${Math.min(100, Math.max(0, Math.round(loadProgress.value)))}%`;
});

const loadingVisible = computed(
  () =>
    !askVisible.value &&
    !videoPlaying.value &&
    (busy.value || (loadProgress.value != null && loadProgress.value < 100))
);

function rawUrl() {
  return api.getDownloadURL({ path: props.path } as never, true);
}

function clampRate(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(0.1, Math.round(n * 100) / 100));
}

function accountRate() {
  return clampRate(authStore.user?.playerPreferences?.playbackRate ?? 1);
}

function persistRate(rate: number) {
  const userId = authStore.user?.id;
  if (!userId) return;
  const next = {
    controlsTimeoutSec:
      authStore.user?.playerPreferences?.controlsTimeoutSec ?? 4,
    playbackMode: authStore.user?.playerPreferences?.playbackMode || "native",
    playbackRate: rate,
    resumeMode: authStore.user?.playerPreferences?.resumeMode || "resume",
  };
  void usersApi
    .update({ id: userId, playerPreferences: next }, ["PlayerPreferences"])
    .then(() => authStore.updateUser({ playerPreferences: next }));
}

function accountResumeMode(): "resume" | "from-start" | "ask" {
  const raw = (
    authStore.user?.playerPreferences?.resumeMode || "resume"
  ).toLowerCase();
  if (raw === "from-start" || raw === "start" || raw === "restart")
    return "from-start";
  if (raw === "ask" || raw === "prompt") return "ask";
  return "resume";
}

/**
 * Browser codec probe via HTMLMediaElement.canPlayType.
 * true = likely OK (Firefox HEVC often "maybe"); false = should not try native;
 * null = unknown codec — still try native with a visible loader.
 */
function browserSupportsCodec(codec: string): boolean | null {
  const c = (codec || "").toLowerCase();
  if (!c) return null;
  const probe = document.createElement("video");
  const mimes: string[] = [];
  if (/hevc|h265/.test(c)) {
    mimes.push(
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
      'video/mp4; codecs="hvc1"',
      'video/mp4; codecs="hev1"'
    );
  } else if (/avc|h264/.test(c)) {
    mimes.push('video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1"');
  } else if (/vp0?9/.test(c)) {
    mimes.push('video/webm; codecs="vp9"');
  } else if (/av1/.test(c)) {
    mimes.push('video/mp4; codecs="av01.0.04M.08"', 'video/mp4; codecs="av01"');
  } else {
    return null;
  }
  let maybe = false;
  for (const mime of mimes) {
    const r = probe.canPlayType(mime);
    if (r === "probably") return true;
    if (r === "maybe") maybe = true;
  }
  return maybe ? true : false;
}

function formatClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** ArtPlayer layers toast — native chrome, works in fullscreen. */
function showResumeUi(position: number) {
  const mode = accountResumeMode();
  const label = formatClock(position);
  const artP = art.value as unknown as {
    notice: { show: string };
    layers: {
      add: (o: Record<string, unknown>) => unknown;
      remove: (name: string) => void;
    };
  } | null;
  if (!artP || position < 5) return;

  if (mode === "resume") {
    applyResume({ position, playing: false, rate: currentRate.value });
    artP.notice.show = `已续播 ${label}`;
    return;
  }
  if (mode === "from-start") {
    artP.notice.show = `从头播放 · 上次看到 ${label}`;
    try {
      artP.layers.add({
        name: "winfb-resume",
        html: `<div class="winfb-resume-toast"><span>上次看到 ${label}</span><button type="button" data-act="resume">跳到上次进度</button><button type="button" data-act="close">知道了</button></div>`,
        click: (_c: unknown, event: Event) => {
          const target = event.target as HTMLElement | null;
          const act = target?.dataset?.act;
          if (act === "resume") {
            applyResume({
              position,
              playing: true,
              rate: currentRate.value,
            });
            artP.notice.show = `已跳转 ${label}`;
          }
          try {
            artP.layers.remove("winfb-resume");
          } catch {
            /* ignore */
          }
        },
      });
    } catch {
      /* ignore */
    }
    return;
  }

  // ask
  try {
    artP.layers.add({
      name: "winfb-resume",
      html: `<div class="winfb-resume-toast"><span>上次看到 ${label}，如何播放？</span><button type="button" data-act="resume">续播</button><button type="button" data-act="restart">从头播放</button></div>`,
      click: (_c: unknown, event: Event) => {
        const target = event.target as HTMLElement | null;
        const act = target?.dataset?.act;
        if (act === "resume") {
          applyResume({ position, playing: true, rate: currentRate.value });
          artP.notice.show = `已续播 ${label}`;
        } else if (act === "restart") {
          artP.notice.show = "从头播放";
        }
        try {
          artP.layers.remove("winfb-resume");
        } catch {
          /* ignore */
        }
      },
    });
  } catch {
    /* ignore */
  }
}

function notice(msg: string) {
  art.value && (art.value.notice.show = msg);
}

function artSetting(): SettingApi | null {
  return (
    ((art.value as unknown as { setting?: SettingApi })?.setting as SettingApi) ??
    null
  );
}

/** Official ArtPlayer SVG icons only — never Material ligature text in the player. */
function iconClone(key: string): HTMLElement | undefined {
  const icons = (art.value as unknown as { icons?: Record<string, unknown> })
    ?.icons;
  const el = icons?.[key];
  if (el instanceof HTMLElement) return el.cloneNode(true) as HTMLElement;
  return undefined;
}

function settingWidth() {
  const ctor = (
    art.value as unknown as {
      constructor?: { SETTING_ITEM_WIDTH?: number };
    }
  )?.constructor;
  return ctor?.SETTING_ITEM_WIDTH ?? 250;
}

function forceHideArtLoading() {
  try {
    const loading = (art.value as unknown as { loading?: { show: boolean } })
      ?.loading;
    if (loading) loading.show = false;
  } catch {
    /* ignore */
  }
}

function clearLoadingState() {
  videoPlaying.value = true;
  loadProgress.value = null;
  forceHideArtLoading();
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
  if (loaderForceTimer) {
    window.clearTimeout(loaderForceTimer);
    loaderForceTimer = null;
  }
}

function persistPlaybackPosition(force = false) {
  const video = art.value?.video as HTMLVideoElement | undefined;
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const pos = video.currentTime;
  if (!Number.isFinite(pos) || pos < 1) return;
  const now = Date.now();
  if (!force && Math.abs(pos - lastSavedPosition) < 5 && now - lastSaveAt < 8000) {
    return;
  }
  lastSavedPosition = pos;
  lastSaveAt = now;
  void mediaApi.savePlayback(props.path, pos, video.duration).catch(() => {});
}

function captureResume() {
  const video = art.value?.video as HTMLVideoElement | undefined;
  return {
    position: video?.currentTime || 0,
    playing: !!video && !video.paused && !video.ended,
    rate: currentRate.value,
  };
}

function applyResume(resume: {
  position: number;
  playing: boolean;
  rate: number;
}) {
  const player = art.value as unknown as {
    video?: HTMLVideoElement;
    playbackRate?: number;
  } | null;
  if (!player) return;
  currentRate.value = clampRate(resume.rate);
  const run = () => {
    try {
      const video = player.video;
      if (video && resume.position > 0.5 && Number.isFinite(video.duration)) {
        const max = Math.max(0, video.duration - 0.5);
        video.currentTime = Math.min(resume.position, max);
      }
      try {
        player.playbackRate = currentRate.value;
      } catch {
        /* ignore */
      }
      if (resume.playing) {
        void player.video?.play?.().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    clearLoadingState();
    syncPlayerLabels();
  };
  const video = player.video;
  if (video && video.readyState >= 1) {
    run();
    return;
  }
  const onMeta = () => {
    video?.removeEventListener("loadedmetadata", onMeta);
    run();
  };
  video?.addEventListener("loadedmetadata", onMeta);
  window.setTimeout(() => {
    video?.removeEventListener("loadedmetadata", onMeta);
    run();
  }, 2800);
}

function markBarSelectorCurrent(name: string, labels: string[]) {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls as HTMLElement | null;
  if (!bar) return;
  const set = new Set(labels);
  bar
    .querySelectorAll(`.art-control-${name} .art-selector-item`)
    .forEach((el) => {
      const html = (el.textContent || "").trim();
      const value = el.getAttribute("data-value") || "";
      const on = set.has(html) || set.has(value);
      el.classList.toggle("art-current", on);
    });
}

function refreshQualityPickers() {
  const setting = artSetting() as (SettingApi & {
    update?: (s: Record<string, unknown>) => unknown;
  }) | null;
  const controlsApi = art.value as unknown as {
    controls?: {
      update?: (o: Record<string, unknown>) => unknown;
      remove?: (n: string) => void;
      add?: (o: Record<string, unknown>) => unknown;
    };
  };
  const qualityItem = buildSettings().find(
    (s) => (s as { name?: string }).name === "playback-quality"
  );
  if (qualityItem && setting?.update) {
    try {
      setting.update(qualityItem as never);
    } catch {
      /* ignore */
    }
  }
  const barQuality = buildBarControls().find(
    (c) => (c as { name?: string }).name === "playback-quality"
  );
  if (barQuality && controlsApi.controls?.update) {
    try {
      controlsApi.controls.update(barQuality);
    } catch {
      /* ignore */
    }
  }
  hardenSelectorLists();
}

/**
 * Switch native/compat (and compat quality) as a source reload.
 * Chips + loading title update immediately; playback position is restored.
 */
async function switchEngine(
  mode: ActualMode,
  quality?: Quality,
  fromAuto = false
) {
  const token = ++switchToken;
  const resume = captureResume();
  persistPlaybackPosition(true);

  const targetQuality =
    mode === "compat" ? (quality ?? preferredCompatQuality()) : transcodeQuality.value;

  // Optimistic UI — user sees the switch immediately
  actualMode.value = mode;
  if (mode === "compat" && targetQuality !== "native") {
    transcodeQuality.value = targetQuality;
  }
  closeBarSelectors();
  syncPlayerLabels();
  refreshQualityPickers();
  markBarSelectorCurrent(
    "playback-mode",
    mode === "compat" ? ["兼容", "compat"] : ["原生", "native"]
  );
  markBarSelectorCurrent(
    "playback-quality",
    mode === "compat"
      ? [qualityLabel(transcodeQuality.value), transcodeQuality.value]
      : [resolutionLabel.value, "native"]
  );

  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
  if (loaderForceTimer) {
    window.clearTimeout(loaderForceTimer);
    loaderForceTimer = null;
  }

  videoPlaying.value = false;
  busy.value = true;
  loadProgress.value = mode === "compat" ? 8 : 0;
  forceHideArtLoading();

  try {
    if (mode === "compat") {
      const q: Exclude<Quality, "native"> =
        targetQuality === "native" ? preferredCompatQuality() : targetQuality;
      transcodeQuality.value = q;
      const status = await mediaApi.startHLSPlayback(props.path, "hls", q);
      if (token !== switchToken) return;
      if (status.id) startCompatProgressPolling(status.id);
      const url = status.playlistUrl || status.sourceUrl;
      if (!url) {
        notice("兼容任务已提交，转码完成后可播放");
        loadProgress.value = 40;
        return;
      }
      await attachHls(url);
      if (token !== switchToken) return;
      notice(
        fromAuto
          ? "原生无法播放，已切换兼容转码"
          : `已切换兼容 · ${qualityLabel(transcodeQuality.value)}`
      );
      applyResume(resume);
    } else {
      detachHls();
      clearNativeProgressHooks();
      if (!art.value) return;
      art.value.url = rawUrl();
      notice("已切换原生播放");
      applyResume(resume);
    }
  } catch (e) {
    if (token !== switchToken) return;
    loadProgress.value = null;
    notice(e instanceof Error ? e.message : "切换播放方式失败");
  } finally {
    if (token === switchToken) {
      busy.value = false;
      syncPlayerLabels();
      loaderForceTimer = window.setTimeout(() => {
        if (token !== switchToken) return;
        const video = art.value?.video as HTMLVideoElement | undefined;
        if (video && (video.readyState >= 2 || video.currentTime > 0)) {
          clearLoadingState();
        } else {
          clearLoadingState();
          notice("加载较慢，可再点一次播放或切换播放方式");
        }
      }, 5000);
    }
  }
}

function startCompatProgressPolling(id: string) {
  if (progressTimer) window.clearInterval(progressTimer);
  if (videoPlaying.value) return;
  loadProgress.value = Math.max(loadProgress.value ?? 0, 5);
  progressTimer = window.setInterval(async () => {
    try {
      const status = await mediaApi.getHLSPlayback(id);
      if (videoPlaying.value) {
        clearLoadingState();
        return;
      }
      if (status.processedSeconds && status.durationSeconds) {
        loadProgress.value = Math.min(
          99,
          (status.processedSeconds / status.durationSeconds) * 100
        );
      } else if (status.state === "streamable" || status.state === "completed") {
        loadProgress.value = 99;
        const video = art.value?.video as HTMLVideoElement | undefined;
        if (video && video.readyState >= 2) {
          clearLoadingState();
          return;
        }
        video?.addEventListener(
          "canplay",
          () => clearLoadingState(),
          { once: true }
        );
      }
    } catch {
      /* keep last */
    }
  }, 800);
}

async function loadMediaInfo() {
  try {
    const info = await mediaApi.getMediaInformation(props.path, false);
    if (info.resolution) {
      sourceWidth.value = info.resolution.width || 0;
      sourceHeight.value = info.resolution.height || 0;
    }
    sourceVideoCodec.value = info.videoCodec || "";
  } catch {
    /* optional */
  }
}

async function startCompat(fromAuto = false, quality?: Quality) {
  await switchEngine("compat", quality, fromAuto);
}

function startNative() {
  void switchEngine("native");
}

function chooseMode(mode: ActualMode) {
  askVisible.value = false;
  void switchEngine(mode);
}

function detachHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

function clearNativeProgressHooks() {
  const video = art.value?.video as HTMLVideoElement | undefined;
  if (!video) {
    nativeLoadHandlers = [];
    return;
  }
  nativeLoadHandlers.forEach((fn) => fn());
  nativeLoadHandlers = [];
}

function bindNativeProgress() {
  clearNativeProgressHooks();
  const video = art.value?.video as HTMLVideoElement | undefined;
  if (!video) return;
  if (videoPlaying.value || video.readyState >= 2 || (video.currentTime > 0 && !video.paused)) {
    clearLoadingState();
    return;
  }
  loadProgress.value = 0;
  const onProgress = () => {
    if (videoPlaying.value) return;
    if (!video.duration || !Number.isFinite(video.duration)) {
      loadProgress.value = Math.max(loadProgress.value ?? 0, 5);
      return;
    }
    let end = 0;
    if (video.buffered.length > 0) {
      end = video.buffered.end(video.buffered.length - 1);
    }
    loadProgress.value = Math.min(95, (end / video.duration) * 100);
  };
  const onReady = () => clearLoadingState();
  const onWaiting = () => {
    if (videoPlaying.value) return;
    loadProgress.value = Math.min(95, loadProgress.value ?? 10);
  };
  const onTime = () => {
    if (video.currentTime > 0.15) clearLoadingState();
  };
  video.addEventListener("progress", onProgress);
  video.addEventListener("canplay", onReady);
  video.addEventListener("loadeddata", onReady);
  video.addEventListener("playing", onReady);
  video.addEventListener("waiting", onWaiting);
  video.addEventListener("timeupdate", onTime);
  nativeLoadHandlers = [
    () => video.removeEventListener("progress", onProgress),
    () => video.removeEventListener("canplay", onReady),
    () => video.removeEventListener("loadeddata", onReady),
    () => video.removeEventListener("playing", onReady),
    () => video.removeEventListener("waiting", onWaiting),
    () => video.removeEventListener("timeupdate", onTime),
  ];
}

async function attachHls(url: string) {
  detachHls();
  const video = art.value?.video as HTMLVideoElement | undefined;
  if (!art.value || !video) return;
  if (Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);
  } else {
    art.value.url = url;
  }
  bindNativeProgress();
}

function openRateDialog() {
  rateDraft.value = currentRate.value;
  rateDialogVisible.value = true;
  try {
    (art.value as unknown as { pause?: () => void })?.pause?.();
  } catch {
    /* ignore */
  }
  void nextTick(() => rateInput.value?.focus());
}

function confirmRate() {
  applyRate(clampRate(Number(rateDraft.value)));
  rateDialogVisible.value = false;
  notice(`倍速 ${currentRate.value.toFixed(2)}x`);
}

function orientationPref(): "auto-fullscreen" | "auto-rotate" | "manual" {
  try {
    const v = localStorage.getItem("win-file-browser-player-orientation");
    if (v === "auto-rotate" || v === "manual" || v === "auto-fullscreen")
      return v;
  } catch {
    /* ignore */
  }
  return "auto-fullscreen";
}

function updateOrientationState() {
  const box = container.value;
  if (!box) return;
  const w = box.clientWidth || window.innerWidth;
  const h = box.clientHeight || window.innerHeight;
  isPortrait.value = h > w;
  isMobile.value =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    w < 768;
}

function rateDisplay() {
  return `${currentRate.value.toFixed(2)}x`;
}

function qualityLabel(q: Quality) {
  switch (q) {
    case "2160p":
      return "4K";
    case "1440p":
      return "2K";
    case "1080p":
      return "1080p";
    case "720p":
      return "720p";
    case "480p":
      return "480p";
    default:
      return "原画";
  }
}

function qualityDisplay() {
  return actualMode.value === "compat"
    ? qualityLabel(transcodeQuality.value)
    : resolutionLabel.value;
}

function modeDisplay() {
  return actualModeLabel.value;
}

function setBarLabel(name: string, text: string) {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls as HTMLElement | null;
  if (!bar) return;
  const root = bar.querySelector<HTMLElement>(`.art-control-${name}`);
  if (!root) return;
  const value = root.querySelector<HTMLElement>(
    ".art-selector-value, .art-bar-label"
  );
  if (value) value.textContent = text;
}

function closeBarSelectors() {
  const t = art.value?.template as unknown as {
    $controls?: Element;
    $player?: Element;
  } | null;
  const bar = t?.$controls as HTMLElement | null;
  if (bar) {
    bar
      .querySelectorAll(".art-control-selector.art-selector-open")
      .forEach((el) => el.classList.remove("art-selector-open"));
  }
  const player = t?.$player as HTMLElement | null;
  player?.classList.remove("art-bar-selector-open");
}

function openBarSelector(ctrl: HTMLElement) {
  const setting = artSetting();
  try {
    if (setting) setting.show = false;
  } catch {
    /* ignore */
  }
  closeBarSelectors();
  ctrl.classList.add("art-selector-open");
  const t = art.value?.template as unknown as { $player?: Element } | null;
  (t?.$player as HTMLElement | null)?.classList.add("art-bar-selector-open");
}

let barSelectorDocHandler: ((e: MouseEvent) => void) | null = null;

/** Official echo: right-side gray `tooltip` only — never append to menu name. */
function syncSettingEcho(name: string, value: string, checkName?: string) {
  const setting = artSetting();
  if (!setting?.find) return;
  const item = setting.find(name);
  if (!item) return;
  item.tooltip = value;
  if (checkName && setting.check) {
    const target = setting.find(checkName);
    if (target) setting.check(target);
  }
}

function syncPlayerLabels() {
  setBarLabel("playback-mode", modeDisplay());
  setBarLabel("playback-rate", rateDisplay());
  setBarLabel("playback-quality", qualityDisplay());
  syncSettingEcho(
    "playback-mode",
    modeDisplay(),
    actualMode.value === "compat" ? "mode-compat" : "mode-native"
  );
  syncSettingEcho("playback-rate", rateDisplay(), `rate-${currentRate.value}`);
  syncSettingEcho(
    "playback-quality",
    qualityDisplay(),
    `quality-${transcodeQuality.value}`
  );
}

function applyRate(rate: number) {
  currentRate.value = clampRate(rate);
  if (art.value) {
    try {
      art.value.playbackRate = currentRate.value;
    } catch {
      /* ignore */
    }
  }
  persistRate(currentRate.value);
  syncPlayerLabels();
}

function setActualMode(mode: ActualMode) {
  actualMode.value = mode;
  syncPlayerLabels();
}

async function applyTranscodeQuality(q: Quality): Promise<string> {
  if (q === "native") {
    return resolutionLabel.value;
  }
  if (actualMode.value !== "compat") {
    // Native cannot re-encode — keep source res, remember preferred compat quality.
    transcodeQuality.value = q;
    notice(`原生模式不支持转码分辨率；已记录 ${qualityLabel(q)}，切到兼容后生效`);
    syncPlayerLabels();
    return resolutionLabel.value;
  }
  notice(`正在切换兼容画质 ${qualityLabel(q)}…`);
  await switchEngine("compat", q);
  return qualityLabel(transcodeQuality.value);
}

/**
 * Settings panel — official ArtPlayer pattern:
 * html = name only, icon = SVG clone, tooltip = gray right echo.
 */
function buildSettings() {
  const width = settingWidth();
  return [
    {
      width,
      name: "playback-mode",
      html: "播放方式",
      icon: iconClone("config"),
      tooltip: modeDisplay(),
      selector: [
        {
          name: "mode-native",
          html: "原生播放",
          value: "native",
          default: actualMode.value === "native",
        },
        {
          name: "mode-compat",
          html: "兼容转码",
          value: "compat",
          default: actualMode.value === "compat",
        },
      ],
      onSelect(item: { html: string; value: string }) {
        if (!item || item.value == null) return modeDisplay();
        void switchEngine(
          item.value === "compat" ? "compat" : "native"
        );
        return item.value === "compat" ? "兼容" : "原生";
      },
    },
    {
      width,
      name: "playback-rate",
      html: "播放速度",
      icon: iconClone("playbackRate"),
      tooltip: rateDisplay(),
      selector: [
        ...PRESET_RATES.map((r) => ({
          name: `rate-${r}`,
          html: `${r.toFixed(2)}x`,
          value: String(r),
          default: Math.abs(r - currentRate.value) < 0.001,
        })),
        { name: "rate-custom", html: "自定义倍速…", value: "custom" },
      ],
      onSelect(item: { html: string; value: string }) {
        if (item.value === "custom") {
          openRateDialog();
          return rateDisplay();
        }
        applyRate(clampRate(Number(item.value)));
        return rateDisplay();
      },
    },
    {
      width,
      name: "playback-quality",
      html: "转码画质",
      icon: iconClone("aspectRatio"),
      tooltip: qualityDisplay(),
      selector: qualityOptions.value.map((o) => ({
        name: `quality-${o.value}`,
        html: o.html,
        value: o.value,
        default:
          actualMode.value === "compat"
            ? o.value === transcodeQuality.value
            : o.value === "native",
      })),
      onSelect(item: { html: string; value: string }) {
        if (!item || item.value == null) return qualityDisplay();
        void applyTranscodeQuality(item.value as Quality);
        return qualityDisplay();
      },
    },
    {
      width,
      name: "playback-subtitle",
      html: "字幕",
      icon: iconClone("subtitle") || iconClone("config"),
      tooltip: "关",
      selector: [
        { name: "sub-off", html: "关闭", value: "", default: true },
        ...(props.subtitles || []).map((s, i) => ({
          name: `sub-${i}`,
          html: s.name || s.lang || `字幕 ${i + 1}`,
          value: s.url,
        })),
      ],
      onSelect(item: { html: string; value: string }) {
        const p = art.value as unknown as {
          subtitle: { url: string; switch: (u: string) => void };
        } | null;
        if (!p) return item.html;
        if (!item.value) {
          p.subtitle.url = "";
          return "关闭";
        }
        p.subtitle.switch(item.value);
        return item.html;
      },
    },
  ];
}

/**
 * Bottom-bar chips: each opens its OWN ArtPlayer selector list anchored
 * above that chip — never the settings panel (which sits at the gear).
 */
function modeSelector() {
  return [
    {
      html: "原生",
      value: "native",
      default: actualMode.value === "native",
    },
    {
      html: "兼容",
      value: "compat",
      default: actualMode.value === "compat",
    },
  ];
}

function rateSelector() {
  return [
    ...PRESET_RATES.map((r) => ({
      html: `${r.toFixed(2)}x`,
      value: String(r),
      default: Math.abs(r - currentRate.value) < 0.001,
    })),
    { html: "自定义…", value: "custom" },
  ];
}

function qualitySelector() {
  return qualityOptions.value.map((o) => ({
    html: o.html,
    value: o.value,
    default:
      actualMode.value === "compat"
        ? o.value === transcodeQuality.value
        : o.value === "native",
  }));
}

function buildBarControls() {
  const compact = isMobile.value && isPortrait.value;
  const controls: Record<string, unknown>[] = [];
  if (!compact) {
    controls.push({
      position: "right",
      index: 10,
      name: "playback-mode",
      html: `<span class="art-bar-label">${modeDisplay()}</span>`,
      selector: modeSelector(),
      onSelect(item: { html: string; value: string }) {
        if (!item || item.value == null) return modeDisplay();
        void switchEngine(item.value === "compat" ? "compat" : "native");
        return item.value === "compat" ? "兼容" : "原生";
      },
    });
  }
  controls.push({
    position: "right",
    index: 11,
    name: "playback-rate",
    html: `<span class="art-bar-label">${rateDisplay()}</span>`,
    selector: rateSelector(),
    onSelect(item: { html: string; value: string }) {
      if (!item || item.value == null) return rateDisplay();
      if (item.value === "custom") {
        closeBarSelectors();
        openRateDialog();
        return rateDisplay();
      }
      applyRate(clampRate(Number(item.value)));
      closeBarSelectors();
      return rateDisplay();
    },
  });
  if (!compact) {
    controls.push({
      position: "right",
      index: 12,
      name: "playback-quality",
      html: `<span class="art-bar-label">${qualityDisplay()}</span>`,
      selector: qualitySelector(),
      onSelect(item: { html: string; value: string }) {
        if (!item || item.value == null) return qualityDisplay();
        void applyTranscodeQuality(item.value as Quality);
        closeBarSelectors();
        return qualityDisplay();
      },
    });
  }
  return controls;
}

/** Click-only independent popups — never hover, never settings panel. */
function bindBarSelectorPopups() {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls as HTMLElement | null;
  if (!bar || bar.dataset.winfbBarBound === "1") return;
  bar.dataset.winfbBarBound = "1";

  const onBarClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target || !bar.contains(target)) return;
    const inItem = target.closest?.(".art-selector-item");
    if (inItem) {
      // Let ArtPlayer onSelect run; just ensure we don't toggle.
      return;
    }
    const ctrl = target.closest?.(
      ".art-control-playback-mode, .art-control-playback-rate, .art-control-playback-quality"
    ) as HTMLElement | null;
    if (!ctrl || !bar.contains(ctrl)) return;
    e.preventDefault();
    e.stopPropagation();
    const open = ctrl.classList.contains("art-selector-open");
    if (open) closeBarSelectors();
    else openBarSelector(ctrl);
  };
  bar.addEventListener("click", onBarClick, true);

  if (!barSelectorDocHandler) {
    barSelectorDocHandler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target && bar.contains(target)) {
        if (target.closest?.(".art-control-selector")) return;
      }
      closeBarSelectors();
    };
    document.addEventListener("click", barSelectorDocHandler);
  }
}

function hardenSelectorLists() {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls as HTMLElement | null;
  if (!bar) return;
  bar.querySelectorAll(".art-selector-list").forEach((node) => {
    const list = node as HTMLElement;
    if (list.dataset.winfbHard === "1") return;
    list.dataset.winfbHard = "1";
    list.addEventListener(
      "touchstart",
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
    list.addEventListener(
      "touchmove",
      (e) => {
        e.stopPropagation();
      },
      { passive: false }
    );
  });
}

function hideMobileExtraControls() {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls as HTMLElement | undefined;
  if (!bar) return;
  bar
    .querySelectorAll(
      ".art-pip, .art-fullscreen-web, .art-quality-label, .art-mode-label"
    )
    .forEach((el) => {
      (el as HTMLElement).style.display = "none";
    });
}

function bindControlBarScroll() {
  const t = art.value?.template as unknown as {
    $controls?: Element;
    $controlsRight?: Element;
  } | null;
  // overflow-x:auto forces overflow-y to auto and clips selector popups.
  const bar = t?.$controls as HTMLElement | null;
  if (bar) {
    bar.style.overflow = "visible";
  }
  const right = t?.$controlsRight as HTMLElement | null;
  if (right) {
    right.style.overflow = "visible";
  }
}

onMounted(async () => {
  if (!container.value) return;
  currentRate.value = accountRate();
  actualMode.value = policy.value === "compat" ? "compat" : "native";
  askVisible.value = policy.value === "ask";
  await loadMediaInfo();
  updateOrientationState();
  sizeHandler = () => updateOrientationState();
  window.addEventListener("resize", sizeHandler);
  window.addEventListener("orientationchange", sizeHandler);

  const orientation = orientationPref();

  art.value = new Artplayer({
    container: container.value as HTMLDivElement,
    url: askVisible.value ? "" : rawUrl(),
    poster: props.poster || "",
    volume: 0.7,
    autoplay: !askVisible.value,
    pip: !isMobile.value,
    setting: true,
    playbackRate: false,
    flip: true,
    aspectRatio: true,
    fullscreen: true,
    fullscreenWeb: !isMobile.value,
    miniProgressBar: true,
    mutex: true,
    backdrop: false,
    playsInline: true,
    autoOrientation: orientation !== "manual",
    hotkey: true,
    lang: "zh-cn",
    theme: "#2979ff",
    moreVideoAttr: { playsInline: true, preload: "metadata" } as never,
    settings: [] as never,
    controls: [] as never,
  });

  art.value.on("ready", () => {
    forceHideArtLoading();
    applyRate(currentRate.value);
    const t = art.value?.template as unknown as { $player?: HTMLElement } | null;
    playerRoot.value = t?.$player || null;
    const setting = artSetting();
    const controlsApi = art.value as unknown as {
      controls?: { add: (o: Record<string, unknown>) => void };
    };
    if (setting?.add) {
      buildSettings().forEach((item) => setting.add!(item as never));
    }
    if (controlsApi.controls?.add) {
      buildBarControls().forEach((item) =>
        controlsApi.controls!.add(item as never)
      );
    }
    syncPlayerLabels();
    if (setting?.check && setting.find) {
      const rateItem = setting.find(`rate-${currentRate.value}`);
      if (rateItem) setting.check(rateItem);
    }
    bindControlBarScroll();
    bindBarSelectorPopups();
    hardenSelectorLists();
    if (isMobile.value) hideMobileExtraControls();

    // Native-first: show loader always. Only auto-compat when the browser
    // clearly cannot decode (canPlayType === false). Firefox HEVC is allowed.
    if (!askVisible.value && policy.value === "compat") {
      void startCompat(true);
    } else if (!askVisible.value && policy.value === "native") {
      videoPlaying.value = false;
      loadProgress.value = 0;
      bindNativeProgress();
      forceHideArtLoading();
      // Resume preference (account-level)
      void mediaApi
        .getPlayback(props.path)
        .then((saved) => {
          if (!saved.exists || saved.position < 5) return;
          lastSavedPosition = saved.position;
          showResumeUi(saved.position);
        })
        .catch(() => {});
      const support = browserSupportsCodec(sourceVideoCodec.value);
      if (support === false) {
        notice(
          `当前浏览器无法原生解码 ${sourceVideoCodec.value || "该编码"}，切换兼容转码`
        );
        void switchEngine("compat", preferredCompatQuality(), true);
      } else {
        notice(
          support === true
            ? "正在加载原生播放…"
            : "正在加载原生流（编码较慢，请稍候）…"
        );
        // Slow native: keep loader; if still no picture, offer compat — do not silent-fail.
        window.setTimeout(() => {
          const video = art.value?.video as HTMLVideoElement | undefined;
          if (videoPlaying.value || actualMode.value !== "native") return;
          if (!video || video.readyState >= 2) return;
          notice("原生加载较慢，可再等一会，或手动切「兼容」");
          if (loadProgress.value != null && loadProgress.value < 100) {
            loadProgress.value = Math.max(loadProgress.value, 20);
          }
        }, 12000);
      }
    }

    // Progress-bar sprite thumbnails (ArtPlayer native option).
    void mediaApi
      .getVideoSprite(props.path)
      .then((meta) => {
        if (!art.value || !meta?.number || meta.number < 2) return;
        const url = createURL("api/media/sprite.jpg", { path: props.path });
        try {
          art.value.thumbnails = {
            url,
            number: meta.number,
            column: meta.column || 10,
            width: meta.width || 160,
            height: meta.height || 90,
          } as never;
        } catch {
          /* optional */
        }
      })
      .catch(() => {});

    if (isMobile.value && orientation === "auto-fullscreen") {
      window.setTimeout(() => {
        try {
          const p = art.value as unknown as { fullscreen?: { enter?: () => void } };
          p?.fullscreen?.enter?.();
        } catch {
          /* ignore */
        }
      }, 400);
    }
  });

  art.value.on("video:ratechange", () => {
    const video = art.value?.video as HTMLVideoElement | undefined;
    if (!video) return;
    const next = clampRate(video.playbackRate);
    if (Math.abs(next - currentRate.value) > 0.001) {
      currentRate.value = next;
      syncPlayerLabels();
    }
  });

  art.value.on("video:timeupdate", () => {
    persistPlaybackPosition(false);
  });
  art.value.on("pause", () => {
    persistPlaybackPosition(true);
  });

  (["playing", "loadeddata", "canplay", "canplaythrough"] as const).forEach(
    (ev) => art.value?.on(ev, () => clearLoadingState())
  );

  art.value.on("error", () => {
    if (askVisible.value) {
      clearLoadingState();
      notice("请选择播放方式");
      return;
    }
    if (actualMode.value === "compat") {
      clearLoadingState();
      notice("播放失败，可下载后用本地播放器打开");
      return;
    }
    // Native failed for real (decode/network) — then compat is the right path.
    videoPlaying.value = false;
    loadProgress.value = Math.max(loadProgress.value ?? 0, 12);
    busy.value = true;
    notice("原生播放失败，切换兼容转码…");
    void switchEngine("compat", preferredCompatQuality(), true);
  });
});

watch(isPortrait, () => {
  /* control bar layout is native; nothing to rebind */
});

onBeforeUnmount(() => {
  persistPlaybackPosition(true);
  if (progressTimer) window.clearInterval(progressTimer);
  if (loaderForceTimer) window.clearTimeout(loaderForceTimer);
  if (sizeHandler) {
    window.removeEventListener("resize", sizeHandler);
    window.removeEventListener("orientationchange", sizeHandler);
  }
  if (barSelectorDocHandler) {
    document.removeEventListener("click", barSelectorDocHandler);
    barSelectorDocHandler = null;
  }
  clearNativeProgressHooks();
  detachHls();
  art.value?.destroy(false);
  art.value = null;
});
</script>

<style scoped>
.art-player-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #000;
}
.art-player-box {
  width: 100%;
  height: 100%;
  min-height: 320px;
}
.art-player-box :deep(.art-loading),
.art-player-box :deep(.art-video-loading) {
  display: none !important;
}
.art-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 28;
  display: grid;
  justify-items: center;
  gap: 12px;
  color: #fff;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.art-ring {
  width: 48px;
  height: 48px;
  border: 3px solid rgb(255 255 255 / 20%);
  border-top-color: #6db3ff;
  border-radius: 50%;
  animation: art-spin 0.9s linear infinite;
}
@keyframes art-spin {
  to {
    transform: rotate(360deg);
  }
}
.art-loading-text {
  display: grid;
  gap: 4px;
  justify-items: center;
  font-size: 13px;
}
.art-loading-text span {
  color: rgb(255 255 255 / 80%);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.art-ask-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(0 0 0 / 48%);
}
.art-ask-card {
  width: min(400px, 100%);
  padding: 20px;
  text-align: center;
  color: #eef3ff;
  background: rgb(14 18 28 / 96%);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 14px;
}
.art-ask-title {
  font-size: 16px;
  font-weight: 650;
}
.art-ask-sub {
  margin-top: 6px;
  color: rgb(235 242 255 / 65%);
  font-size: 12px;
}
.art-ask-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}
.art-ask-btn {
  min-width: 96px;
  min-height: 40px;
  padding: 8px 14px;
  color: #e9f2ff;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  background: rgb(255 255 255 / 8%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 10px;
  cursor: pointer;
}
.art-ask-btn--primary {
  color: #071321;
  background: #8bc0ff;
  border-color: transparent;
}
.art-player-stage :deep(.art-setting-item-left-icon) {
  flex: 0 0 auto;
}
.art-player-stage :deep(.art-setting-item-left-icon .art-icon) {
  width: 18px;
  height: 18px;
}
.art-player-stage :deep(.art-setting-item-left-text) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.art-player-stage :deep(.art-setting-item-right-tooltip) {
  flex: 0 0 auto;
  margin-left: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
  font-size: 12px;
  white-space: nowrap;
}
.art-player-stage--rate-open :deep(.art-control-bar),
.art-player-stage--rate-open :deep(.art-setting),
.art-player-stage--rate-open :deep(.art-settings),
.art-player-stage--rate-open :deep(.art-subtitle),
.art-player-stage--rate-open :deep(.art-state),
.art-player-stage--rate-open :deep(.art-big-play-button),
.art-player-stage--rate-open :deep(.art-contextmenus) {
  opacity: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
}
.art-player-stage--mobile :deep(.art-pip),
.art-player-stage--mobile :deep(.art-fullscreen-web),
.art-player-stage--mobile :deep([class*="art-pip"]),
.art-player-stage--mobile :deep([class*="fullscreen-web"]) {
  display: none !important;
}
.art-player-stage--portrait :deep(.art-quality-label),
.art-player-stage--portrait :deep(.art-mode-label) {
  display: none !important;
}
.art-bar-label {
  padding: 0 8px;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  white-space: nowrap;
}
/* Independent bottom-bar popups (not settings panel) */
.art-player-stage :deep(.art-bottom),
.art-player-stage :deep(.art-controls),
.art-player-stage :deep(.art-controls-left),
.art-player-stage :deep(.art-controls-center),
.art-player-stage :deep(.art-controls-right),
.art-player-stage :deep(.art-control) {
  overflow: visible !important;
}
.art-player-stage :deep(.art-control-selector) {
  position: relative;
  overflow: visible !important;
}
/* Raise bottom above settings so chip popups are not covered */
.art-player-stage :deep(.art-video-player.art-bar-selector-open .art-bottom),
.art-player-stage :deep(.art-bar-selector-open .art-bottom) {
  z-index: 120 !important;
}
.art-player-stage :deep(.art-control-selector .art-selector-list) {
  position: absolute;
  left: 50%;
  bottom: calc(var(--art-control-height) + 6px);
  z-index: 160;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 104px;
  max-height: min(42vh, 280px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  margin: 0;
  transform: translate(-50%, 10px);
  opacity: 0;
  pointer-events: none;
  color: #f3f6fb;
  background: rgba(28, 30, 36, 0.82);
  backdrop-filter: blur(18px) saturate(1.25);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.art-player-stage :deep(.art-control-selector.art-selector-open .art-selector-list) {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}
/* Mobile: list must fit without fighting volume gestures */
.art-player-stage :deep(.art-control-selector .art-selector-list) {
  max-height: min(48vh, 340px) !important;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
.art-player-stage :deep(.art-bar-selector-open .art-video) {
  pointer-events: none !important;
}
.art-player-stage :deep(.winfb-resume-toast) {
  position: absolute;
  left: 50%;
  bottom: calc(var(--art-control-height) + 24px);
  z-index: 170;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: center;
  max-width: min(92%, 420px);
  padding: 10px 12px;
  color: #f3f6fb;
  font-size: 13px;
  transform: translateX(-50%);
  background: rgba(28, 30, 36, 0.86);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
.art-player-stage :deep(.winfb-resume-toast button) {
  min-height: 32px;
  padding: 4px 10px;
  color: #0b1220;
  font-size: 12px;
  font-weight: 600;
  background: linear-gradient(180deg, #9ec9ff, #6da8ff);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.art-player-stage :deep(.winfb-resume-toast button[data-act="close"]),
.art-player-stage :deep(.winfb-resume-toast button[data-act="restart"]) {
  color: #eef3ff;
  background: rgba(255, 255, 255, 0.1);
}
/* Force click-only: neutralize ArtPlayer hover-open */
.art-player-stage :deep(.art-control-selector:hover .art-selector-list) {
  opacity: 0 !important;
  transform: translate(-50%, 10px) !important;
  pointer-events: none !important;
}
.art-player-stage :deep(.art-control-selector.art-selector-open:hover .art-selector-list) {
  opacity: 1 !important;
  transform: translate(-50%, 0) !important;
  pointer-events: auto !important;
}
/* Kill ArtPlayer hint tooltips on bar chips — they cover the list */
.art-player-stage :deep(.art-control-playback-mode),
.art-player-stage :deep(.art-control-playback-rate),
.art-player-stage :deep(.art-control-playback-quality) {
  pointer-events: auto;
}
.art-player-stage :deep(.art-control-playback-mode[class*="hint"]),
.art-player-stage :deep(.art-control-playback-rate[class*="hint"]),
.art-player-stage :deep(.art-control-playback-quality[class*="hint"]) {
  /* hint tooltips are pseudo-elements; ensure they never show */
}
.art-player-stage :deep(.art-control-playback-mode.hint--top:after),
.art-player-stage :deep(.art-control-playback-mode.hint--top:before),
.art-player-stage :deep(.art-control-playback-rate.hint--top:after),
.art-player-stage :deep(.art-control-playback-rate.hint--top:before),
.art-player-stage :deep(.art-control-playback-quality.hint--top:after),
.art-player-stage :deep(.art-control-playback-quality.hint--top:before) {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}
.art-player-stage :deep(.art-selector-item) {
  min-width: 88px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  border-radius: 8px;
  cursor: pointer;
}
.art-player-stage :deep(.art-selector-item:hover),
.art-player-stage :deep(.art-selector-item.art-current) {
  color: #9ec9ff;
  background: rgba(255, 255, 255, 0.08);
}
.art-player-stage :deep(.art-settings),
.art-player-stage :deep(.art-setting-panel) {
  max-height: min(70vh, 480px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
.art-modal-mask {
  position: absolute;
  inset: 0;
  z-index: 100000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.55);
}
.art-modal {
  width: min(320px, calc(100% - 28px));
  padding: 20px 20px 16px;
  color: #f5f7fb;
  background: rgba(32, 34, 40, 0.72);
  backdrop-filter: blur(18px) saturate(1.25);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.art-modal-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: center;
}
.art-modal-sub {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  text-align: center;
}
.art-modal-field {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin: 16px 0 10px;
}
.art-modal-field input {
  width: 108px;
  height: 40px;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  outline: none;
  appearance: textfield;
}
.art-modal-field input::-webkit-outer-spin-button,
.art-modal-field input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.art-modal-field input:focus {
  border-color: #7cb5ff;
  box-shadow: 0 0 0 3px rgba(124, 181, 255, 0.22);
}
.art-modal-unit {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 600;
}
.art-modal-range {
  width: 100%;
  margin: 0 0 16px;
  accent-color: #7cb5ff;
}
.art-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.art-modal-btn {
  min-width: 96px;
  min-height: 38px;
  padding: 0 14px;
  color: #f0f4ff;
  font-size: 13px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  cursor: pointer;
}
.art-modal-btn--ok {
  color: #0b1220;
  background: linear-gradient(180deg, #9ec9ff, #6da8ff);
  border-color: transparent;
}
@media (max-width: 720px) {
  .art-modal {
    width: min(300px, calc(100% - 24px));
    padding: 16px;
  }
}
</style>
