<template>
  <div class="art-player-stage" :class="{ 'art-player-stage--busy': busy }">
    <div ref="container" class="art-player-box"></div>
    <div v-if="statusText" class="art-player-toast" role="status">
      {{ statusText }}
    </div>
    <div class="art-player-toolbar">
      <button type="button" @click="cycleEngineMode">
        {{ modeLabel }}
      </button>
      <button type="button" :disabled="busy" @click="startCompat">
        {{ busy ? "处理中…" : "兼容播放" }}
      </button>
      <a :href="downloadUrl" download>下载</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { files as api, media as mediaApi } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { resolveControlsTimeoutMs } from "@/utils/playerControls";

const props = defineProps<{
  path: string;
  source: string;
  poster?: string;
  downloadSource?: string;
}>();

const authStore = useAuthStore();
const container = ref<HTMLElement | null>(null);
const art = shallowRef<Artplayer | null>(null);
const busy = ref(false);
const statusText = ref("");
const mode = ref<"native" | "compat" | "ask">(
  (authStore.user?.playerPreferences?.playbackMode as "native") || "native"
);

const downloadUrl = computed(
  () => props.downloadSource || api.getDownloadURL({ path: props.path } as never, false)
);

const modeLabel = computed(() => {
  if (mode.value === "compat") return "当前：兼容";
  if (mode.value === "ask") return "当前：选择";
  return "当前：原生";
});

function rawUrl() {
  return api.getDownloadURL({ path: props.path } as never, true);
}

function extOf(p: string) {
  const base = p.split("?")[0].split("#")[0];
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

function artType(p: string) {
  const e = extOf(p);
  if (e === "mkv") return "";
  return "";
}

function applyPlaybackRate() {
  const raw = authStore.user?.playerPreferences?.playbackRate;
  if (!art.value) return;
  const rate = raw == null ? 1 : Math.min(5, Math.max(0.1, Number(raw)));
  art.value.playbackRate = rate;
}

async function startCompat() {
  if (busy.value) return;
  busy.value = true;
  statusText.value = "正在启动兼容播放…";
  try {
    const status = await mediaApi.startHLSPlayback(props.path, "hls");
    const url = status.playlistUrl || status.sourceUrl;
    if (!url) {
      statusText.value = "兼容任务已提交，请稍候重试或到任务中心查看";
      return;
    }
    mode.value = "compat";
    if (!art.value) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(art.value.video as HTMLVideoElement);
      statusText.value = "正在使用兼容播放";
    } else {
      art.value.url = url;
      statusText.value = "正在使用兼容播放（原生 HLS）";
    }
  } catch (e) {
    statusText.value = e instanceof Error ? e.message : "兼容播放启动失败";
  } finally {
    busy.value = false;
  }
}

function cycleEngineMode() {
  mode.value =
    mode.value === "native" ? "compat" : mode.value === "compat" ? "ask" : "native";
  if (mode.value === "native") {
    statusText.value = "已切换原生优先（重新打开文件生效）";
    return;
  }
  if (mode.value === "compat") void startCompat();
  else statusText.value = "选择模式：点「兼容播放」或继续用原生";
}

onMounted(async () => {
  if (!container.value) return;
  const url = rawUrl();
  art.value = new Artplayer({
    container: container.value as HTMLDivElement,
    url,
    poster: props.poster || "",
    type: artType(props.path),
    volume: 0.7,
    autoplay: true,
    muted: false,
    pip: true,
    screenshot: false,
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
    settings: [
      {
        html: "播放方式",
        selector: [
          { html: "原生优先", value: "native", default: mode.value === "native" },
          { html: "兼容播放", value: "compat", default: mode.value === "compat" },
          { html: "每次选择", value: "ask", default: mode.value === "ask" },
        ],
        onSelect: (item: { html: string; value?: string }) => {
          const v = (item.value || "native") as "native" | "compat" | "ask";
          mode.value = v;
          if (v === "compat") void startCompat();
          return item.html;
        },
      },
    ],
  });

  art.value.on("ready", () => {
    applyPlaybackRate();
    statusText.value = "ArtPlayer 试验模式 · 快捷键已启用";
  });
  art.value.on("error", () => {
    statusText.value = "原生播放失败，可尝试兼容播放";
  });

  // Best-effort resume: keep lightweight; full resume can follow if trial merges.
  try {
    const saved = await mediaApi.getPlayback(props.path);
    if (saved.exists && art.value && saved.position > 5) {
      art.value.once("ready", () => {
        art.value && (art.value.currentTime = saved.position);
      });
    }
  } catch {
    /* ignore */
  }

  // Silence unused option warning in trial
  void resolveControlsTimeoutMs(
    authStore.user?.playerPreferences?.controlsTimeoutSec
  );
});

onBeforeUnmount(() => {
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
.art-player-toast {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 20;
  max-width: 80%;
  padding: 8px 12px;
  color: #e8f1ff;
  font-size: 12px;
  background: rgb(8 12 20 / 82%);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}
.art-player-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 20;
  display: flex;
  gap: 6px;
  align-items: center;
}
.art-player-toolbar button,
.art-player-toolbar a {
  min-height: 32px;
  padding: 6px 10px;
  color: #e9f2ff;
  font-size: 12px;
  text-decoration: none;
  background: rgb(20 28 42 / 90%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  cursor: pointer;
}
</style>
