<template>
  <errors v-if="error" :errorCode="error.status" />
  <div class="row" v-else-if="!layoutStore.loading">
    <div class="column">
      <div class="card">
        <div class="card-title">
          <h2>分享管理</h2>
        </div>

        <div class="card-content full" v-if="links.length > 0">
          <table>
            <thead>
              <tr>
                <th scope="col">路径</th>
                <th scope="col">分享时长</th>
                <th v-if="authStore.user?.perm.admin" scope="col">用户名</th>
                <th scope="col"></th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="link in links" :key="link.hash">
                <td>
                  <a :href="buildLink(link)" target="_blank">{{ link.path }}</a>
                </td>
                <td>
                  <template v-if="link.expire !== 0">{{
                    humanTime(link.expire)
                  }}</template>
                  <template v-else>永久</template>
                </td>
                <td v-if="authStore.user?.perm.admin">{{ link.username }}</td>
                <td class="small">
                  <button
                    class="action"
                    @click="deleteLink($event, link)"
                    aria-label="删除"
                    title="删除"
                  >
                    <AppIcon name="trash" :size="18" />
                  </button>
                </td>
                <td class="small">
                  <button
                    class="action copy-clipboard"
                    aria-label="复制到剪贴板"
                    title="复制到剪贴板"
                    @click="copyToClipboard(buildLink(link))"
                  >
                    <AppIcon name="copy" :size="18" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="shares-empty">
          <AppIcon name="copy" :size="28" aria-hidden="true" />
          <div>
            <strong>还没有分享链接</strong>
            <p class="small">
              在文件列表里选中文件 → 分享，生成的链接会出现在这里。
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";
import { useLayoutStore } from "@/stores/layout";
import AppIcon from "@/components/ui/AppIcon.vue";
import { share as api, users } from "@/api";
import type { Share } from "@/types/api";
import dayjs from "@/utils/date";
import Errors from "@/views/Errors.vue";
import { inject, ref, onMounted } from "vue";
import { StatusError } from "@/api/utils";
import { copy } from "@/utils/clipboard";

const $showError = inject<IToastError>("$showError")!;
const $showSuccess = inject<IToastSuccess>("$showSuccess")!;

const layoutStore = useLayoutStore();
const authStore = useAuthStore();

const error = ref<StatusError | null>(null);
const links = ref<Share[]>([]);

onMounted(async () => {
  layoutStore.loading = true;
  try {
    const newLinks = await api.list();
    if (authStore.user?.perm.admin) {
      const userMap = new Map<number, string>();
      for (const user of await users.getAll())
        userMap.set(user.id, user.username);
      for (const link of newLinks) {
        if (link.userID && userMap.has(link.userID))
          link.username = userMap.get(link.userID);
      }
    }
    links.value = newLinks;
  } catch (err) {
    if (err instanceof Error) error.value = err as StatusError;
  } finally {
    layoutStore.loading = false;
  }
});

const copyToClipboard = (text: string) => {
  copy({ text }).then(
    () => $showSuccess("链接已复制到剪贴板"),
    () => {
      copy({ text }, { permission: true }).then(
        () => $showSuccess("链接已复制到剪贴板"),
        (e) => $showError(e)
      );
    }
  );
};

const deleteLink = (event: Event, link: Share) => {
  event.preventDefault();
  layoutStore.showHover({
    prompt: "share-delete",
    confirm: () => {
      layoutStore.closeHovers();
      try {
        api.remove(link.hash);
        links.value = links.value.filter((item) => item.hash !== link.hash);
        $showSuccess("分享已删除");
      } catch (err) {
        if (err instanceof Error) $showError(err);
      }
    },
  });
};

const humanTime = (time: number) => dayjs(time * 1000).fromNow();

const buildLink = (share: Share) => api.getShareURL(share);
</script>

<style scoped>
.shares-empty {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 20px 18px;
  margin: 8px 4px 12px;
  text-align: left;
  border: 1px dashed var(--borderPrimary, #d0d5dd);
  border-radius: 10px;
  background: var(--surfaceSecondary, #fafafa);
}

.shares-empty strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.shares-empty p {
  margin: 0;
  color: var(--textSecondary, #667085);
}
</style>
