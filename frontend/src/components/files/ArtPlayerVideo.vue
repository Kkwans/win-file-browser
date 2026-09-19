<template>
  <div
    class="art-player-stage"
    :class="{
      'art-player-stage--busy': busy,
      'art-player-stage--asking': askVisible,
      'art-player-stage--portrait': isPortrait,
      'art-player-stage--mobile': isMobile,
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

    <!-- Modern custom playback rate dialog -->
    <div
      v-if="rateDialogVisible"
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
import { useAuthStore } from "@/stores/auth";

type Policy = "native" | "compat" | "ask";
type ActualMode = "native" | "compat";
type Quality = "source" | "2160p" | "1440p" | "1080p" | "720p" | "480p";

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
const transcodeQuality = ref<Quality>("source");
const loadProgress = ref<number | null>(null);
const videoPlaying = ref(false);
const isPortrait = ref(false);
const isMobile = ref(false);
let hlsInstance: Hls | null = null;
let progressTimer: number | null = null;
let nativeLoadHandlers: Array<() => void> = [];
let sizeHandler: (() => void) | null = null;

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

const qualityOptions = computed(() => {
  const h = sourceHeight.value || 1080;
  const opts: { html: string; value: Quality }[] = [
    { html: "原画", value: "source" },
  ];
  if (h >= 2000) opts.push({ html: "4K", value: "2160p" });
  if (h >= 1300) opts.push({ html: "2K", value: "1440p" });
  if (h >= 900) opts.push({ html: "1080p", value: "1080p" });
  if (h >= 600) opts.push({ html: "720p", value: "720p" });
  opts.push({ html: "480p", value: "480p" });
  return opts;
});

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

// Never show our loader while video is already playing (Via mobile bug).
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
  };
  void usersApi
    .update({ id: userId, playerPreferences: next }, ["PlayerPreferences"])
    .then(() => authStore.updateUser({ playerPreferences: next }));
}

function notice(msg: string) {
  art.value && (art.value.notice.show = msg);
}

function artApi() {
  return art.value as unknown as {
    loading?: { show: boolean };
    setting?: { show?: boolean; update?: (n: string) => void };
    controls?: { add: (o: Record<string, unknown>) => void };
    settingPanel?: unknown;
  } | null;
}

function artQuery(selector: string): HTMLElement | null {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const root = t?.$controls;
  if (root && "querySelector" in root) return root.querySelector(selector);
  return null;
}

function forceHideArtLoading() {
  try {
    const a = artApi();
    if (a?.loading) a.loading.show = false;
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
}

function applyRate(rate: number) {
  currentRate.value = clampRate(rate);
  if (art.value) art.value.playbackRate = currentRate.value;
  const el = artQuery(".art-rate-label");
  if (el) el.textContent = `${currentRate.value.toFixed(2)}x`;
  persistRate(currentRate.value);
}

function setActualMode(mode: ActualMode) {
  actualMode.value = mode;
  const el = artQuery(".art-mode-label");
  if (el) el.textContent = actualModeLabel.value;
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

function startCompatProgressPolling(id: string) {
  if (progressTimer) window.clearInterval(progressTimer);
  if (videoPlaying.value) return;
  loadProgress.value = 0;
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
  } catch {
    /* optional */
  }
}

async function startCompat(
  fromAuto = false,
  quality: Quality = transcodeQuality.value
) {
  if (busy.value) return;
  busy.value = true;
  transcodeQuality.value = quality;
  videoPlaying.value = false;
  try {
    const status = await mediaApi.startHLSPlayback(props.path, "hls", quality);
    if (status.id) startCompatProgressPolling(status.id);
    const url = status.playlistUrl || status.sourceUrl;
    if (!url) {
      notice("兼容任务已提交，转码完成后可播放");
      return;
    }
    await attachHls(url);
    setActualMode("compat");
    notice(fromAuto ? "原生无法播放，已切换兼容转码" : "已切换兼容转码");
  } catch (e) {
    loadProgress.value = null;
    notice(e instanceof Error ? e.message : "兼容播放启动失败");
  } finally {
    busy.value = false;
  }
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

function startNative() {
  detachHls();
  clearNativeProgressHooks();
  if (!art.value) return;
  videoPlaying.value = false;
  art.value.url = rawUrl();
  setActualMode("native");
  forceHideArtLoading();
  bindNativeProgress();
  notice("已切换原生播放");
}

function chooseMode(mode: ActualMode) {
  askVisible.value = false;
  if (mode === "compat") void startCompat(false);
  else startNative();
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

/** Playback-page switches apply immediately; account defaults only seed new sessions. */
async function applyTranscodeQuality(q: Quality): Promise<string> {
  transcodeQuality.value = q;
  const label = qualityLabel(q);
  if (actualMode.value === "compat") {
    notice(`正在切换兼容画质 ${label}…`);
    await startCompat(true, q);
  } else {
    notice(`转码画质 ${label}（切到兼容播放时立即生效）`);
  }
  return label;
}

function buildSettings() {
  return [
    {
      html: "播放方式",
      selector: [
        { html: "原生播放", value: "native", default: actualMode.value === "native" },
        { html: "兼容转码", value: "compat", default: actualMode.value === "compat" },
      ],
      onSelect: (item: { html: string; value: string }) => {
        // Immediate
        if (item.value === "compat") void startCompat(true, transcodeQuality.value);
        else startNative();
        return item.html;
      },
    },
    {
      html: "播放速度",
      selector: [
        ...PRESET_RATES.map((r) => ({
          html: `${r.toFixed(2)}x`,
          value: String(r),
          default: Math.abs(r - currentRate.value) < 0.001,
        })),
        { html: `自定义倍速…`, value: "custom" },
      ],
      onSelect: (item: { html: string; value: string }) => {
        if (item.value === "custom") {
          openRateDialog();
          return `自定义 ${currentRate.value.toFixed(2)}x`;
        }
        applyRate(clampRate(Number(item.value)));
        return `${clampRate(Number(item.value)).toFixed(2)}x`;
      },
    },
    {
      html: "转码画质",
      selector: qualityOptions.value.map((o) => ({
        html: o.html,
        value: o.value,
        default: o.value === transcodeQuality.value,
      })),
      onSelect: (item: { html: string; value: string }) =>
        applyTranscodeQuality(item.value as Quality),
    },
    {
      html: "字幕",
      selector: [
        { html: "关闭", value: "", default: true },
        ...(props.subtitles || []).map((s, i) => ({
          html: s.name || s.lang || `字幕 ${i + 1}`,
          value: s.url,
        })),
      ],
      onSelect: (item: { html: string; value: string }) => {
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
 * Bottom-bar lists follow ArtPlayer's official quality pattern:
 * control item with `selector` + `onSelect` (not click-only).
 */
function bindBottomControls() {
  const a = artApi();
  if (!a?.controls) return;

  const compact = isMobile.value && isPortrait.value;

  if (!compact) {
    a.controls.add({
      position: "right",
      name: "playback-mode",
      html: `<span class="art-ctrl-btn"><span class="art-mode-label">${actualModeLabel.value}</span></span>`,
      selector: [
        {
          html: "原生播放",
          value: "native",
          default: actualMode.value === "native",
        },
        {
          html: "兼容转码",
          value: "compat",
          default: actualMode.value === "compat",
        },
      ],
      onSelect: (item: { html: string; value: string }) => {
        if (item.value === "compat") {
          void startCompat(true, transcodeQuality.value);
        } else {
          startNative();
        }
        return item.html;
      },
    } as never);
  }

  a.controls.add({
    position: "right",
    name: "playback-rate",
    html: `<span class="art-ctrl-btn"><span class="art-rate-label">${currentRate.value.toFixed(2)}x</span></span>`,
    selector: [
      ...PRESET_RATES.map((r) => ({
        html: `${r.toFixed(2)}x`,
        value: String(r),
        default: Math.abs(r - currentRate.value) < 0.001,
      })),
      { html: "自定义倍速…", value: "custom" },
    ],
    onSelect: (item: { html: string; value: string }) => {
      if (item.value === "custom") {
        openRateDialog();
        return `${currentRate.value.toFixed(2)}x`;
      }
      applyRate(clampRate(Number(item.value)));
      return `${currentRate.value.toFixed(2)}x`;
    },
  } as never);

  if (!compact) {
    a.controls.add({
      position: "right",
      name: "playback-quality",
      html: `<span class="art-ctrl-btn art-ctrl-muted">${actualMode.value === "compat" ? qualityLabel(transcodeQuality.value) : resolutionLabel.value}</span>`,
      selector: qualityOptions.value.map((o) => ({
        html: o.html,
        value: o.value,
        default: o.value === transcodeQuality.value,
      })),
      onSelect: (item: { html: string; value: string }) =>
        applyTranscodeQuality(item.value as Quality),
    } as never);
  }

  if ((props.subtitles || []).length > 0 && !compact) {
    a.controls.add({
      position: "right",
      name: "playback-subtitle",
      html: `<span class="art-ctrl-btn">字幕</span>`,
      selector: [
        { html: "关闭", value: "", default: true },
        ...(props.subtitles || []).map((s, i) => ({
          html: s.name || s.lang || `字幕 ${i + 1}`,
          value: s.url,
        })),
      ],
      onSelect: (item: { html: string; value: string }) => {
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
    } as never);
  }
}

function bindControlBarScroll() {
  const t = art.value?.template as unknown as { $controls?: Element } | null;
  const bar = t?.$controls;
  if (!bar) return;
  const htmlBar = bar as HTMLElement;
  htmlBar.style.overflowX = "auto";
  htmlBar.style.overflowY = "visible";
  htmlBar.style.flexWrap = "nowrap";
  htmlBar.style.scrollbarWidth = "thin";
  htmlBar.style.touchAction = "pan-x";
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
    pip: true,
    setting: true,
    playbackRate: true,
    flip: true,
    aspectRatio: true,
    fullscreen: true,
    fullscreenWeb: true,
    miniProgressBar: true,
    mutex: true,
    backdrop: true,
    playsInline: true,
    autoOrientation: orientation !== "manual",
    hotkey: true,
    lang: "zh-cn",
    theme: "#2979ff",
    moreVideoAttr: { playsInline: true, preload: "metadata" } as never,
    settings: buildSettings() as never,
  });

  art.value.on("ready", () => {
    forceHideArtLoading();
    applyRate(currentRate.value);
    bindBottomControls();
    bindControlBarScroll();
    if (!askVisible.value) bindNativeProgress();
    if (policy.value === "compat" && !askVisible.value) void startCompat(true);
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

  // Kill double default spinner + stuck loader
  (["playing", "loadeddata", "canplay", "canplaythrough"] as const).forEach(
    (ev) => art.value?.on(ev, () => clearLoadingState())
  );

  art.value.on("error", () => {
    clearLoadingState();
    if (askVisible.value || actualMode.value === "compat") {
      notice("播放失败，可下载后用本地播放器打开");
      return;
    }
    if (policy.value === "native") void startCompat(true);
    else notice("原生播放失败");
  });

  try {
    const saved = await mediaApi.getPlayback(props.path);
    if (saved.exists && saved.position > 5) {
      art.value?.once("ready", () => {
        if (art.value) art.value.currentTime = saved.position;
      });
    }
  } catch {
    /* ignore */
  }
});

watch(isPortrait, () => {
  // Rebind control visibility when rotating
  bindBottomControls();
});

onBeforeUnmount(() => {
  if (progressTimer) window.clearInterval(progressTimer);
  if (sizeHandler) {
    window.removeEventListener("resize", sizeHandler);
    window.removeEventListener("orientationchange", sizeHandler);
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
/* Single loader only: hide ArtPlayer built-in spinner */
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
.art-player-stage :deep(.art-ctrl-btn) {
  display: inline-flex;
  min-width: 48px;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  background: rgb(255 255 255 / 8%);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.art-player-stage :deep(.art-ctrl-muted) {
  color: rgb(255 255 255 / 72%);
  font-weight: 500;
}
/* Settings panel: allow scroll on short/mobile viewports */
.art-player-stage :deep(.art-setting-panel),
.art-player-stage :deep(.art-setting),
.art-player-stage :deep(.art-contextmenus) {
  max-height: min(70vh, 480px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
.art-player-stage--portrait :deep(.art-video-player .art-control) {
  min-width: 40px;
}
.art-modal-mask {
  position: absolute;
  inset: 0 0 72px 0;
  z-index: 99999;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 42%);
  backdrop-filter: blur(6px);
}
.art-modal {
  width: min(340px, calc(100% - 32px));
  padding: 22px 22px 18px;
  color: #f2f6ff;
  background: rgb(18 24 38 / 96%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 18px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 50%);
  transform: translateY(-12%);
}
.art-modal-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: center;
}
.art-modal-sub {
  margin-top: 6px;
  color: rgb(235 242 255 / 55%);
  font-size: 12px;
  text-align: center;
}
.art-modal-field {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  margin: 18px 0 12px;
}
.art-modal-field input {
  width: 132px;
  height: 48px;
  color: #fff;
  font-size: 20px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-align: center;
  background: rgb(255 255 255 / 7%);
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 14px;
  outline: none;
  appearance: textfield;
}
.art-modal-field input::-webkit-outer-spin-button,
.art-modal-field input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.art-modal-field input:focus {
  border-color: #8bc0ff;
  box-shadow: 0 0 0 4px rgb(139 192 255 / 18%);
}
.art-modal-unit {
  color: rgb(255 255 255 / 65%);
  font-size: 16px;
  font-weight: 600;
}
.art-modal-range {
  width: 100%;
  margin: 0 0 18px;
  accent-color: #6db3ff;
}
.art-modal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.art-modal-btn {
  min-width: 104px;
  min-height: 42px;
  padding: 0 16px;
  color: #e9f2ff;
  font-size: 14px;
  font-weight: 650;
  background: rgb(255 255 255 / 8%);
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 12px;
  cursor: pointer;
}
.art-modal-btn--ok {
  color: #061018;
  background: linear-gradient(180deg, #a8d0ff, #6db3ff);
  border-color: transparent;
}
@media (max-width: 720px) {
  .art-player-stage :deep(.art-ctrl-btn) {
    min-width: 44px;
    min-height: 40px;
  }
  .art-modal {
    padding: 16px;
  }
}
</style>
