<template>
  <div
    class="art-player-stage"
    :class="{ 'art-player-stage--busy': busy, 'art-player-stage--asking': askVisible }"
  >
    <div ref="container" class="art-player-box"></div>

    <!-- Loading: ring + real progress when available -->
    <div v-if="loadingVisible" class="art-loading" role="status">
      <div class="art-ring" aria-hidden="true"></div>
      <div class="art-loading-text">
        <strong>{{ loadingTitle }}</strong>
        <span v-if="progressLabel">{{ progressLabel }}</span>
      </div>
    </div>

    <!-- Ask mode: symmetric, no double spinner -->
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { files as api, media as mediaApi, users as usersApi } from "@/api";
import { useAuthStore } from "@/stores/auth";

type Policy = "native" | "compat" | "ask";
type ActualMode = "native" | "compat";
type Quality = "source" | "2160p" | "1440p" | "1080p" | "720p" | "480p";

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
const sourceWidth = ref(0);
const sourceHeight = ref(0);
const transcodeQuality = ref<Quality>("source");
const loadProgress = ref<number | null>(null);
const loadingPhase = ref("");
let hlsInstance: Hls | null = null;
let progressTimer: number | null = null;
let nativeLoadHandlers: Array<() => void> = [];

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
  actualMode.value === "compat"
    ? busy.value
      ? "兼容转码准备中"
      : "兼容播放加载中"
    : "原生播放加载中"
);

const progressLabel = computed(() => {
  if (loadProgress.value == null) return "";
  return `${Math.min(100, Math.max(0, Math.round(loadProgress.value)))}%`;
});

const loadingVisible = computed(
  () => !askVisible.value && (busy.value || loadProgress.value != null)
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

function artTemplateQuery(selector: string): HTMLElement | null {
  const t = art.value?.template as unknown as {
    $controls?: Element;
  } | null;
  const root = t?.$controls;
  if (root && "querySelector" in root) return root.querySelector(selector);
  return null;
}

function applyRate(rate: number) {
  currentRate.value = clampRate(rate);
  if (art.value) art.value.playbackRate = currentRate.value;
  const el = artTemplateQuery(".art-rate-label");
  if (el) el.textContent = `${currentRate.value.toFixed(2)}x`;
  persistRate(currentRate.value);
}

function setActualMode(mode: ActualMode) {
  actualMode.value = mode;
  const el = artTemplateQuery(".art-mode-label");
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
  loadProgress.value = 0;
  loadingPhase.value = "native";
  const onProgress = () => {
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
  const onCanPlay = () => {
    loadProgress.value = 100;
    window.setTimeout(() => {
      if (actualMode.value === "native") loadProgress.value = null;
    }, 350);
  };
  const onWaiting = () => {
    loadProgress.value = Math.min(95, loadProgress.value ?? 10);
  };
  video.addEventListener("progress", onProgress);
  video.addEventListener("canplay", onCanPlay);
  video.addEventListener("waiting", onWaiting);
  nativeLoadHandlers = [
    () => video.removeEventListener("progress", onProgress),
    () => video.removeEventListener("canplay", onCanPlay),
    () => video.removeEventListener("waiting", onWaiting),
  ];
}

function startCompatProgressPolling(id: string) {
  if (progressTimer) window.clearInterval(progressTimer);
  loadProgress.value = 0;
  loadingPhase.value = "compat";
  progressTimer = window.setInterval(async () => {
    try {
      const status = await mediaApi.getHLSPlayback(id);
      if (status.processedSeconds && status.durationSeconds) {
        loadProgress.value = Math.min(
          99,
          (status.processedSeconds / status.durationSeconds) * 100
        );
      } else if (status.state === "streamable" || status.state === "completed") {
        loadProgress.value = 100;
        if (progressTimer) window.clearInterval(progressTimer);
        progressTimer = null;
        window.setTimeout(() => {
          if (actualMode.value === "compat") loadProgress.value = null;
        }, 400);
      }
    } catch {
      /* keep last progress */
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

async function startCompat(fromAuto = false, quality: Quality = transcodeQuality.value) {
  if (busy.value) return;
  busy.value = true;
  transcodeQuality.value = quality;
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
    loadProgress.value = 100;
    window.setTimeout(() => {
      if (actualMode.value === "compat") loadProgress.value = null;
    }, 400);
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
    hlsInstance.on(Hls.Events.FRAG_BUFFERED, () => {
      if (actualMode.value !== "compat") return;
      const stats = (hlsInstance as unknown as { stats?: { loaded?: number } })
        ?.stats;
      if (stats?.loaded != null) {
        loadProgress.value = Math.min(99, loadProgress.value ?? 0 + 3);
      }
    });
  } else {
    art.value.url = url;
  }
  bindNativeProgress();
}

function startNative() {
  detachHls();
  clearNativeProgressHooks();
  if (!art.value) return;
  art.value.url = rawUrl();
  setActualMode("native");
  bindNativeProgress();
  notice("已切换原生播放");
}

function chooseMode(mode: ActualMode) {
  askVisible.value = false;
  if (mode === "compat") void startCompat(false);
  else startNative();
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

function bindBottomControls() {
  const p = art.value as unknown as {
    controls: { add: (o: Record<string, unknown>) => void };
    setting: { add: (o: Record<string, unknown>) => void; show?: boolean };
    notice: { show: string };
    subtitle: { url: string; switch: (u: string) => void };
  } | null;
  if (!p) return;

  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];

  // Playback mode list (bottom → setting menu)
  p.setting.add({
    html: "播放方式",
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
      if (item.value === "compat") void startCompat(false);
      else startNative();
      return item.html;
    },
  });

  // Transcode quality list
  p.setting.add({
    html: "转码画质",
    selector: qualityOptions.value.map((o) => ({
      html: o.html,
      value: o.value,
      default: o.value === transcodeQuality.value,
    })),
    onSelect: (item: { html: string; value: string }) => {
      transcodeQuality.value = item.value as Quality;
      notice(`转码画质：${item.html}（下次兼容播放生效）`);
      return item.html;
    },
  });

  // Speed list + custom (ArtPlayer setting, not browser prompt)
  p.setting.add({
    html: "播放速度",
    selector: [
      ...rates.map((r) => ({
        html: `${r.toFixed(2)}x`,
        value: String(r),
        default: Math.abs(r - currentRate.value) < 0.001,
      })),
      { html: "自定义…", value: "custom" },
    ],
    onSelect: (item: { html: string; value: string }) => {
      if (item.value === "custom") {
        // Styled custom rate panel via notice + controls dialog
        showCustomRateDialog();
        return `自定义 ${currentRate.value.toFixed(2)}x`;
      }
      const v = clampRate(Number(item.value));
      applyRate(v);
      return `${v.toFixed(2)}x`;
    },
  });

  // Subtitles
  const subList = props.subtitles || [];
  p.setting.add({
    html: "字幕",
    selector: [
      { html: "关闭", value: "", default: true },
      ...subList.map((s, i) => ({
        html: s.name || s.lang || `字幕 ${i + 1}`,
        value: s.url,
      })),
    ],
    onSelect: (item: { html: string; value: string }) => {
      if (!item.value) {
        p.subtitle.url = "";
        return "关闭";
      }
      p.subtitle.switch(item.value);
      return item.html;
    },
  });

  // Bottom controls open settings panels (lists, not cycle)
  p.controls.add({
    position: "right",
    name: "mode-list",
    html: `<button type="button" class="art-ctrl-btn" title="播放方式"><span class="art-mode-label">${actualModeLabel.value}</span></button>`,
    click: () => {
      p.setting.show = true;
    },
  });
  p.controls.add({
    position: "right",
    name: "rate-list",
    html: `<button type="button" class="art-ctrl-btn" title="倍速"><span class="art-rate-label">${currentRate.value.toFixed(2)}x</span></button>`,
    click: () => {
      p.setting.show = true;
    },
  });
  p.controls.add({
    position: "right",
    name: "quality-label",
    html: `<button type="button" class="art-ctrl-btn art-ctrl-muted" title="分辨率">${resolutionLabel.value}</button>`,
    click: () => {
      p.setting.show = true;
    },
  });
  if (subList.length) {
    p.controls.add({
      position: "right",
      name: "subtitle-ctrl",
      html: `<button type="button" class="art-ctrl-btn" title="字幕">字幕</button>`,
      click: () => {
        p.setting.show = true;
      },
    });
  }
}

function showCustomRateDialog() {
  const p = art.value;
  if (!p) return;
  const box = document.createElement("div");
  box.className = "art-custom-rate-dialog";
  box.innerHTML = `
    <div class="art-custom-rate-card">
      <div class="art-custom-rate-title">自定义倍速</div>
      <div class="art-custom-rate-row">
        <input type="number" min="0.1" max="5" step="0.01" value="${currentRate.value}" />
        <span>x</span>
      </div>
      <div class="art-custom-rate-actions">
        <button type="button" data-act="cancel">取消</button>
        <button type="button" class="ok" data-act="ok">确定</button>
      </div>
    </div>`;
  const stage = container.value?.parentElement || document.body;
  stage.appendChild(box);
  const input = box.querySelector("input") as HTMLInputElement;
  const close = () => box.remove();
  box.querySelector('[data-act="cancel"]')?.addEventListener("click", close);
  box.querySelector('[data-act="ok"]')?.addEventListener("click", () => {
    const v = clampRate(Number(input.value));
    applyRate(v);
    notice(`倍速 ${v.toFixed(2)}x`);
    close();
  });
  input?.focus();
}

onMounted(async () => {
  if (!container.value) return;
  currentRate.value = accountRate();
  actualMode.value = policy.value === "compat" ? "compat" : "native";
  askVisible.value = policy.value === "ask";
  await loadMediaInfo();

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
    autoOrientation: true,
    hotkey: true,
    lang: "zh-cn",
    theme: "#2979ff",
    moreVideoAttr: { playsInline: true, preload: "metadata" } as never,
  });

  art.value.on("ready", () => {
    // Hide ArtPlayer's default loading when we show our progress overlay
    (art.value as unknown as { loading?: { show: boolean } })?.loading &&
      ((art.value as unknown as { loading: { show: boolean } }).loading.show =
        askVisible.value ? false : false);
    applyRate(currentRate.value);
    bindBottomControls();
    if (!askVisible.value) bindNativeProgress();
    if (policy.value === "compat" && !askVisible.value) void startCompat(true);
  });

  art.value.on("error", () => {
    if (askVisible.value || actualMode.value === "compat") {
      loadProgress.value = null;
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

onBeforeUnmount(() => {
  if (progressTimer) window.clearInterval(progressTimer);
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
  background: rgb(0 0 0 / 48%);
}
.art-ask-card {
  width: min(400px, calc(100% - 40px));
  padding: 20px 20px 16px;
  text-align: center;
  color: #eef3ff;
  background: rgb(14 18 28 / 96%);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 40%);
}
.art-ask-title {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.4;
}
.art-ask-sub {
  margin-top: 6px;
  color: rgb(235 242 255 / 65%);
  font-size: 12px;
  line-height: 1.5;
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
.art-custom-rate-dialog {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 45%);
}
.art-custom-rate-card {
  width: min(280px, calc(100% - 32px));
  padding: 16px;
  color: #eef3ff;
  background: rgb(14 18 28 / 96%);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 12px;
}
.art-custom-rate-title {
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}
.art-custom-rate-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin: 14px 0;
}
.art-custom-rate-row input {
  width: 96px;
  height: 36px;
  color: #fff;
  text-align: center;
  background: rgb(255 255 255 / 8%);
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 8px;
}
.art-custom-rate-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.art-custom-rate-actions button {
  min-width: 72px;
  min-height: 36px;
  color: #e9f2ff;
  background: rgb(255 255 255 / 8%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  cursor: pointer;
}
.art-custom-rate-actions button.ok {
  color: #071321;
  background: #8bc0ff;
  border-color: transparent;
}
</style>
