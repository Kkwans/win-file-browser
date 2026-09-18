<template>
  <div class="art-player-stage" :class="{ 'art-player-stage--busy': busy }">
    <div ref="container" class="art-player-box"></div>
    <div v-if="askVisible" class="art-ask-overlay">
      <div class="art-ask-card">
        <strong>选择播放方式</strong>
        <small>默认策略为「每次询问」；选择后立即生效</small>
        <div class="art-ask-actions">
          <button type="button" @click="chooseMode('native')">原生播放</button>
          <button type="button" :disabled="busy" @click="chooseMode('compat')">
            兼容转码
          </button>
          <a :href="downloadUrl" download>下载</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { files as api, media as mediaApi } from "@/api";
import { users as usersApi } from "@/api";
import { useAuthStore } from "@/stores/auth";

type Policy = "native" | "compat" | "ask";
/** Real playback engine in use right now */
type ActualMode = "native" | "compat";

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
let hlsInstance: Hls | null = null;

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

const actualModeLabel = computed(() =>
  actualMode.value === "compat" ? "兼容" : "原生"
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

function controlQuery(selector: string): HTMLElement | null {
  const t = art.value?.template as unknown as {
    $controls?: Element;
    query?: (s: string) => Element | null;
  } | null;
  if (!t) return null;
  const root = t.$controls;
  if (root && "querySelector" in root) {
    return (root as Element).querySelector(selector);
  }
  return (t.query?.(selector) as HTMLElement | null) ?? null;
}

function applyRate(rate: number) {
  currentRate.value = clampRate(rate);
  if (art.value) art.value.playbackRate = currentRate.value;
  const el = controlQuery(".art-custom-rate-value");
  if (el) el.textContent = `${currentRate.value.toFixed(2)}x`;
  persistRate(currentRate.value);
}

function setActualMode(mode: ActualMode) {
  actualMode.value = mode;
  const el = controlQuery(".art-custom-mode-value");
  if (el) el.textContent = actualModeLabel.value;
}

function detachHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

async function startCompat(fromAuto = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    const status = await mediaApi.startHLSPlayback(props.path, "hls");
    const url = status.playlistUrl || status.sourceUrl;
    if (!url) {
      notice("兼容任务已提交，稍后可重试");
      return;
    }
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
    setActualMode("compat");
    notice(fromAuto ? "原生无法播放，已切换兼容转码" : "已切换兼容转码");
  } catch (e) {
    notice(e instanceof Error ? e.message : "兼容播放启动失败");
  } finally {
    busy.value = false;
  }
}

function startNative() {
  detachHls();
  if (!art.value) return;
  art.value.url = rawUrl();
  setActualMode("native");
  notice("已切换原生播放");
}

function chooseMode(mode: ActualMode) {
  askVisible.value = false;
  if (mode === "compat") void startCompat();
  else startNative();
}

function bindBottomControls() {
  const p = art.value as unknown as {
    controls: { add: (o: Record<string, unknown>) => void };
    setting: { add: (o: Record<string, unknown>) => void; show?: boolean };
    notice: { show: string };
    subtitle: { url: string; switch: (u: string) => void };
    video?: HTMLVideoElement;
  } | null;
  if (!p) return;

  // Mode button — shows REAL current mode, switches immediately.
  p.controls.add({
    position: "right",
    name: "playback-mode",
    html: `<button type="button" class="art-ctrl-btn" title="播放方式"><span class="art-custom-mode-value">${actualModeLabel.value}</span></button>`,
    click: () => {
      if (actualMode.value === "native") void startCompat();
      else startNative();
    },
    mounted: () => {
      /* label updated via setActualMode */
    },
  });

  // Speed: presets + custom number, always on bottom bar.
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const rateItems = rates.map((r) => ({
    html: `${r.toFixed(2)}x`,
    value: r,
    default: r === currentRate.value,
  }));
  p.controls.add({
    position: "right",
    name: "playback-rate-custom",
    html: `<button type="button" class="art-ctrl-btn" title="倍速"><span class="art-custom-rate-value">${currentRate.value.toFixed(2)}x</span></button>`,
    click: () => {
      // Simple cycle through presets; long-term use setting panel custom.
      const idx = rates.findIndex((r) => Math.abs(r - currentRate.value) < 0.001);
      const next = rates[(idx + 1) % rates.length];
      applyRate(next);
      notice(`倍速 ${next.toFixed(2)}x`);
    },
  });

  p.setting.add({
    html: "播放速度",
    selector: [
      ...rateItems,
      { html: "自定义…", value: "custom" },
    ],
    onSelect: (item: { html: string; value: number | string }) => {
      if (item.value === "custom") {
        const raw = window.prompt("输入倍速 0.10–5.00", String(currentRate.value));
        if (raw != null) {
          const v = clampRate(Number(raw));
          applyRate(v);
          notice(`倍速 ${v.toFixed(2)}x`);
        }
        return `自定义 ${currentRate.value.toFixed(2)}x`;
      }
      applyRate(Number(item.value));
      return item.html;
    },
  });

  // External / embedded subtitles
  const subList = props.subtitles || [];
  if (subList.length > 0) {
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
    p.controls.add({
      position: "right",
      name: "subtitle-ctrl",
      html: `<button type="button" class="art-ctrl-btn" title="字幕">字幕</button>`,
      click: () => {
        p.setting.show = true;
      },
    });
  }

  // Resolution label (single source for NAS files — show for clarity)
  p.controls.add({
    position: "right",
    name: "quality-label",
    html: `<button type="button" class="art-ctrl-btn art-ctrl-muted" title="画质">源画质</button>`,
    click: () => {
      notice("当前为文件源画质；无多码率档位");
    },
  });
}

onMounted(async () => {
  if (!container.value) return;

  currentRate.value = accountRate();
  actualMode.value = policy.value === "compat" ? "compat" : "native";
  askVisible.value = policy.value === "ask";

  // When asking, do not autoplay until user picks a mode.
  const startUrl = policy.value === "compat" ? rawUrl() : askVisible.value ? "" : rawUrl();

  art.value = new Artplayer({
    container: container.value as HTMLDivElement,
    url: startUrl,
    poster: props.poster || "",
    volume: 0.7,
    autoplay: policy.value !== "ask",
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
    moreVideoAttr: {
      playsInline: true,
      preload: "metadata",
    } as never,
  });

  art.value.on("ready", () => {
    applyRate(currentRate.value);
    bindBottomControls();
    if (policy.value === "compat" && !askVisible.value) {
      void startCompat(true);
    }
  });

  art.value.on("error", () => {
    // Real mode display + auto fallback when policy is native.
    if (askVisible.value || actualMode.value === "compat") {
      notice("播放失败，可下载后用本地播放器打开");
      return;
    }
    if (policy.value === "native") {
      void startCompat(true);
    } else {
      notice("原生播放失败");
    }
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
.art-ask-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 55%);
}
.art-ask-card {
  display: grid;
  gap: 10px;
  width: min(360px, calc(100% - 32px));
  padding: 18px;
  color: #eef3ff;
  background: rgb(12 16 24 / 94%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 12px;
}
.art-ask-card small {
  color: rgb(235 242 255 / 70%);
  font-size: 12px;
}
.art-ask-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.art-ask-actions button,
.art-ask-actions a {
  min-height: 40px;
  padding: 8px 12px;
  color: #e9f2ff;
  font-size: 13px;
  text-decoration: none;
  background: rgb(255 255 255 / 8%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  cursor: pointer;
}
.art-ask-actions button:last-of-type {
  color: #071321;
  background: #8bc0ff;
  border-color: transparent;
}
.art-player-stage :deep(.art-ctrl-btn) {
  display: inline-flex;
  min-width: 44px;
  min-height: 36px;
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
  color: rgb(255 255 255 / 70%);
  font-weight: 500;
}
</style>
