<template>
  <div class="row profile-settings-grid">
    <div class="column">
      <form class="card" @submit="updateSettings">
        <div class="card-title">
          <h2>账户设置</h2>
        </div>

        <div class="card-content account-preferences">
          <div class="setting-toggle-list">
            <label class="setting-toggle-row setting-check-row">
              <input type="checkbox" name="singleClick" v-model="singleClick" />
              <span class="setting-copy">
                <strong>桌面端单击打开</strong>
                <small>移动端仍保持双击打开、长按选择</small>
              </span>
            </label>
            <label class="setting-toggle-row setting-check-row">
              <input
                type="checkbox"
                name="redirectAfterCopyMove"
                v-model="redirectAfterCopyMove"
              />
              <span class="setting-copy">
                <strong>复制或移动后跳转</strong>
                <small>操作完成后进入目标目录</small>
              </span>
            </label>
            <label class="setting-toggle-row setting-check-row">
              <input type="checkbox" name="dateFormat" v-model="dateFormat" />
              <span class="setting-copy">
                <strong>使用绝对日期</strong>
                <small>关闭时显示“几分钟前”等相对时间</small>
              </span>
            </label>
            <div class="setting-toggle-row setting-control-row">
              <div class="setting-copy">
                <strong>播放器控件自动隐藏</strong>
                <small>账户级，跨设备；0 = 不自动隐藏，1–20 秒</small>
              </div>
              <div class="setting-controls">
                <input
                  class="app-number"
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  v-model.number="controlsTimeoutSec"
                  aria-label="控件自动隐藏秒数"
                />
                <span class="setting-unit">秒</span>
              </div>
            </div>
            <div class="setting-toggle-row setting-control-row">
              <div class="setting-copy">
                <strong>默认播放策略</strong>
                <small>进入视频时的策略；播放器内切换会立即生效</small>
              </div>
              <div class="setting-controls">
                <div class="app-select">
                  <select v-model="playbackMode" name="playbackMode">
                    <option value="native">原生</option>
                    <option value="compat">兼容转码</option>
                    <option value="ask">每次询问</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="setting-toggle-row setting-control-row">
              <div class="setting-copy">
                <strong>默认倍速</strong>
                <small>0.10–5.00，两位小数（如 1.15）</small>
              </div>
              <div class="setting-controls">
                <input
                  class="app-number"
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.01"
                  v-model.number="playbackRate"
                  name="playbackRate"
                />
                <span class="setting-unit">x</span>
              </div>
            </div>
          </div>

          <section class="prefix-preferences" aria-labelledby="prefix-title">
            <div class="prefix-preferences-heading">
              <div>
                <h3 id="prefix-title">特殊前缀</h3>
                <p>
                  控制目录列表中的显示和分组展开状态。直接路径、搜索、收藏和最近访问不受影响。
                </p>
              </div>
              <span>{{ customRuleCount }}/20 自定义</span>
            </div>

            <div class="prefix-rule-list">
              <div
                v-for="(rule, index) in prefixRules"
                :key="rule.prefix"
                class="prefix-rule-row"
              >
                <code>{{ rule.prefix }}</code>
                <span class="prefix-rule-kind">
                  {{
                    listingPreferencesStore.isBuiltIn(rule.prefix)
                      ? "内置"
                      : "自定义"
                  }}
                </span>
                <div class="prefix-rule-actions">
                  <button
                    type="button"
                    class="prefix-state-button"
                    :class="{ active: rule.visible }"
                    :aria-pressed="rule.visible"
                    :aria-label="`${rule.visible ? '隐藏' : '显示'}前缀 ${rule.prefix}`"
                    @click="togglePrefixVisibility(rule)"
                  >
                    <AppIcon
                      :name="rule.visible ? 'eye' : 'eye-off'"
                      :size="18"
                    />
                    {{ rule.visible ? "显示" : "隐藏" }}
                  </button>
                  <button
                    type="button"
                    class="prefix-state-button"
                    :class="{ active: rule.expanded }"
                    :aria-pressed="rule.expanded"
                    :aria-label="`${rule.expanded ? '折叠' : '展开'}前缀 ${rule.prefix}`"
                    @click="togglePrefixExpanded(rule)"
                  >
                    <AppIcon
                      :name="rule.expanded ? 'chevron-up' : 'chevron-down'"
                      :size="18"
                    />
                    {{ rule.expanded ? "展开" : "折叠" }}
                  </button>
                  <button
                    type="button"
                    class="prefix-icon-button"
                    :disabled="index === 0"
                    :aria-label="`上移前缀 ${rule.prefix}`"
                    @click="movePrefix(index, -1)"
                  >
                    <AppIcon name="arrow-up" :size="18" />
                  </button>
                  <button
                    type="button"
                    class="prefix-icon-button"
                    :disabled="index === prefixRules.length - 1"
                    :aria-label="`下移前缀 ${rule.prefix}`"
                    @click="movePrefix(index, 1)"
                  >
                    <AppIcon name="arrow-down" :size="18" />
                  </button>
                  <button
                    v-if="!listingPreferencesStore.isBuiltIn(rule.prefix)"
                    type="button"
                    class="prefix-icon-button danger"
                    :aria-label="`删除前缀 ${rule.prefix}`"
                    @click="removePrefix(rule.prefix)"
                  >
                    <AppIcon name="trash" :size="18" />
                  </button>
                </div>
              </div>
            </div>

            <div class="prefix-add-row">
              <input
                v-model="newPrefix"
                type="text"
                maxlength="8"
                placeholder="输入 1–8 个字符"
                aria-label="自定义特殊前缀"
                @keyup.enter="addPrefix"
              />
              <button
                type="button"
                class="button"
                :disabled="customRuleCount >= 20 || !newPrefix"
                @click="addPrefix"
              >
                添加前缀
              </button>
            </div>
            <p v-if="prefixError" class="prefix-error" role="alert">
              {{ prefixError }}
            </p>
          </section>

          <h3>编辑器主题</h3>
          <AceEditorTheme
            class="input input--block"
            v-model:aceEditorTheme="aceEditorTheme"
            id="aceTheme"
          ></AceEditorTheme>
        </div>

        <div class="card-action">
          <input
            class="button button--flat"
            type="submit"
            name="submitProfile"
            :value="'更新'"
          />
        </div>
      </form>
    </div>

    <div v-if="!noAuth" class="column">
      <form
        class="card"
        v-if="!authStore.user?.lockPassword"
        @submit="updatePassword"
      >
        <div class="card-title">
          <h2>修改密码</h2>
        </div>

        <div class="card-content">
          <input
            :class="passwordClass"
            type="password"
            placeholder="新密码"
            v-model="password"
            name="password"
          />
          <input
            :class="passwordClass"
            type="password"
            placeholder="确认新密码"
            v-model="passwordConf"
            name="passwordConf"
          />
          <input
            v-if="isCurrentPasswordRequired"
            :class="passwordClass"
            type="password"
            placeholder="当前密码"
            v-model="currentPassword"
            name="current_password"
            autocomplete="current-password"
          />
        </div>

        <div class="card-action">
          <input
            class="button button--flat"
            type="submit"
            name="submitPassword"
            :value="'更新'"
          />
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";
import { useLayoutStore } from "@/stores/layout";
import { useListingPreferencesStore } from "@/stores/listingPreferences";
import { users as api } from "@/api";
import AceEditorTheme from "@/components/settings/AceEditorTheme.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { computed, inject, onMounted, ref } from "vue";
import { authMethod, noAuth } from "@/utils/constants";
import type { PrefixRule } from "@/types/user";
import {
  MAX_CUSTOM_PREFIX_RULES,
  validatePrefix,
} from "@/utils/listingPreferences";
import {
  DEFAULT_CONTROLS_TIMEOUT_MS,
  readControlsTimeoutMs,
  resolveControlsTimeoutMs,
  writeControlsTimeoutMs,
} from "@/utils/playerControls";
const layoutStore = useLayoutStore();
const authStore = useAuthStore();
const listingPreferencesStore = useListingPreferencesStore();

const $showSuccess = inject<IToastSuccess>("$showSuccess")!;
const $showError = inject<IToastError>("$showError")!;

const password = ref<string>("");
const passwordConf = ref<string>("");
const currentPassword = ref<string>("");
const isCurrentPasswordRequired = ref<boolean>(false);
const singleClick = ref<boolean>(false);
const redirectAfterCopyMove = ref<boolean>(false);
const dateFormat = ref<boolean>(false);
const controlsTimeoutSec = ref<number>(4);
const playbackMode = ref<string>("native");
const playbackRate = ref<number>(1);

function persistControlsTimeout() {
  const raw = Number(controlsTimeoutSec.value);
  const sec = !Number.isFinite(raw)
    ? 4
    : Math.min(20, Math.max(0, Math.round(raw)));
  controlsTimeoutSec.value = sec;
  writeControlsTimeoutMs(sec * 1000);
}

function clampPlaybackRate(raw: number) {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(5, Math.max(0.1, Math.round(raw * 100) / 100));
}

function normalizePlaybackMode(raw: string) {
  const v = (raw || "").toLowerCase();
  if (v === "compat" || v === "ask") return v;
  return "native";
}
const aceEditorTheme = ref<string>("");
const newPrefix = ref("");
const prefixError = ref("");
const prefixRules = computed(() => listingPreferencesStore.prefixRules);
const customRuleCount = computed(
  () =>
    prefixRules.value.filter(
      (rule) => !listingPreferencesStore.isBuiltIn(rule.prefix)
    ).length
);

const passwordClass = computed(() => {
  const baseClass = "input input--block";

  if (password.value === "" && passwordConf.value === "") {
    return baseClass;
  }

  if (password.value === passwordConf.value) {
    return `${baseClass} input--green`;
  }

  return `${baseClass} input--red`;
});

onMounted(async () => {
  layoutStore.loading = true;
  if (authStore.user === null) return false;
  listingPreferencesStore.loadFromUser();
  singleClick.value = authStore.user.singleClick;
  redirectAfterCopyMove.value = authStore.user.redirectAfterCopyMove;
  dateFormat.value = authStore.user.dateFormat;
  aceEditorTheme.value = authStore.user.aceEditorTheme;
  controlsTimeoutSec.value = Math.round(
    resolveControlsTimeoutMs(
      authStore.user.playerPreferences?.controlsTimeoutSec
    ) / 1000
  );
  playbackMode.value = normalizePlaybackMode(
    authStore.user.playerPreferences?.playbackMode || "native"
  );
  playbackRate.value = clampPlaybackRate(
    authStore.user.playerPreferences?.playbackRate ?? 1
  );
  layoutStore.loading = false;
  isCurrentPasswordRequired.value = authMethod == "json";

  return true;
});

const updatePassword = async (event: Event) => {
  event.preventDefault();

  if (
    password.value !== passwordConf.value ||
    password.value === "" ||
    currentPassword.value === "" ||
    authStore.user === null
  ) {
    return;
  }

  try {
    const data = {
      ...authStore.user,
      id: authStore.user.id,
      password: password.value,
    };
    await api.update(data, ["password"], currentPassword.value);
    authStore.updateUser(data);
    $showSuccess("密码已更新");
  } catch (e: any) {
    $showError(e);
  } finally {
    password.value = passwordConf.value = "";
  }
};
const updateSettings = async (event: Event) => {
  event.preventDefault();

  try {
    if (authStore.user === null) throw new Error("User is not set!");

    persistControlsTimeout();
    playbackRate.value = clampPlaybackRate(playbackRate.value);
    playbackMode.value = normalizePlaybackMode(playbackMode.value);
    const data = {
      ...authStore.user,
      id: authStore.user.id,
      singleClick: singleClick.value,
      redirectAfterCopyMove: redirectAfterCopyMove.value,
      dateFormat: dateFormat.value,
      aceEditorTheme: aceEditorTheme.value,
      playerPreferences: {
        controlsTimeoutSec: controlsTimeoutSec.value,
        playbackMode: playbackMode.value,
        playbackRate: playbackRate.value,
      },
    };

    await api.update(data, [
      "singleClick",
      "redirectAfterCopyMove",
      "dateFormat",
      "aceEditorTheme",
      "PlayerPreferences",
    ]);
    authStore.updateUser(data);
    $showSuccess("设置已更新（播放偏好已同步到账户）");
  } catch (err) {
    if (err instanceof Error) {
      $showError(err);
    }
  }
};

const withPrefixError = async (operation: () => Promise<void>) => {
  prefixError.value = "";
  try {
    await operation();
  } catch (error) {
    prefixError.value = error instanceof Error ? error.message : "偏好保存失败";
    $showError(error instanceof Error ? error : new Error(prefixError.value));
  }
};

const togglePrefixVisibility = (rule: PrefixRule) =>
  withPrefixError(() =>
    listingPreferencesStore.updateRule(rule.prefix, {
      visible: !rule.visible,
    })
  );

const togglePrefixExpanded = (rule: PrefixRule) =>
  withPrefixError(() =>
    listingPreferencesStore.updateRule(rule.prefix, {
      expanded: !rule.expanded,
    })
  );

const movePrefix = (index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= prefixRules.value.length) return;
  const rules = prefixRules.value.map((rule) => ({ ...rule }));
  [rules[index], rules[target]] = [rules[target], rules[index]];
  void withPrefixError(() => listingPreferencesStore.setRules(rules));
};

const removePrefix = (prefix: string) => {
  if (listingPreferencesStore.isBuiltIn(prefix)) return;
  void withPrefixError(() =>
    listingPreferencesStore.setRules(
      prefixRules.value.filter((rule) => rule.prefix !== prefix)
    )
  );
};

const addPrefix = () => {
  const prefix = newPrefix.value;
  const validation = validatePrefix(prefix);
  if (validation) {
    prefixError.value = validation;
    return;
  }
  if (prefixRules.value.some((rule) => rule.prefix === prefix)) {
    prefixError.value = `前缀 ${prefix} 已存在`;
    return;
  }
  if (customRuleCount.value >= MAX_CUSTOM_PREFIX_RULES) {
    prefixError.value = `自定义前缀最多 ${MAX_CUSTOM_PREFIX_RULES} 个`;
    return;
  }
  void withPrefixError(async () => {
    await listingPreferencesStore.setRules([
      ...prefixRules.value,
      {
        prefix,
        visible: true,
        expanded: true,
        order: prefixRules.value.length,
      },
    ]);
    newPrefix.value = "";
  });
};
</script>

<style scoped>
.account-preferences {
  display: grid;
  gap: 24px;
}

.profile-settings-grid {
  align-items: flex-start;
}

.profile-settings-grid > .column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-settings-grid > .column > .card {
  height: auto;
}

/* Keep password card at the top of the right column; do not stretch empty space visually. */
.profile-settings-grid > .column:last-child {
  position: sticky;
  top: 16px;
}

@media (max-width: 1200px) {
  .profile-settings-grid > .column {
    flex: 0 0 auto;
    width: 100%;
    max-width: 100%;
  }

  .profile-settings-grid > .column:last-child {
    position: static;
  }
}

.setting-toggle-list {
  display: grid;
  gap: 10px;
}

.setting-toggle-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px 14px;
  padding: 14px;
  border: 1px solid var(--divider, #e5e7eb);
  border-radius: 12px;
  background: var(--surfacePrimary, #fff);
}

.setting-check-row {
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  cursor: pointer;
}

.setting-control-row {
  grid-template-columns: minmax(0, 1fr) minmax(120px, 220px);
  align-items: center;
}

.setting-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.setting-copy strong {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--textPrimary, #1f2937);
}

.setting-copy small {
  color: var(--textSecondary, #667085);
  font-size: 12px;
  line-height: 1.55;
}

.setting-controls {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.setting-unit {
  color: var(--textSecondary, #667085);
  font-size: 13px;
}

/* Native-looking square checkbox */
.setting-toggle-row input[type="checkbox"] {
  appearance: auto;
  -webkit-appearance: checkbox;
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
}

.app-number {
  box-sizing: border-box;
  width: 96px;
  height: 36px;
  padding: 0 8px;
  font-size: 14px;
  color: var(--textPrimary, #111);
  background: var(--surfacePrimary, #fff);
  border: 1px solid var(--borderPrimary, #d0d5dd);
  border-radius: 8px;
  outline: none;
}

.app-number:focus {
  border-color: #2979ff;
}

/* Themed select — not the browser default look */
.app-select {
  position: relative;
  min-width: 160px;
  max-width: 220px;
}

.app-select select {
  width: 100%;
  height: 36px;
  margin: 0;
  padding: 0 32px 0 12px;
  font-size: 14px;
  color: var(--textPrimary, #111);
  background: var(--surfacePrimary, #fff);
  border: 1px solid var(--borderPrimary, #d0d5dd);
  border-radius: 8px;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23667085' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}

.app-select select:focus {
  border-color: #2979ff;
}

@media (max-width: 900px) {
  .setting-control-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .setting-controls {
    justify-content: flex-start;
  }

  .app-select {
    max-width: 100%;
    width: 100%;
  }

  .app-number {
    width: 120px;
  }
}

.setting-toggle-row select,
.setting-toggle-row .setting-number {
  width: auto;
  min-width: 132px;
  max-width: 240px;
  height: 36px;
  margin: 0;
}

@media (max-width: 900px) {
  .setting-control-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .setting-controls {
    justify-content: flex-start;
  }

  .setting-toggle-row select,
  .setting-toggle-row .setting-number {
    max-width: 100%;
    flex: 1 1 140px;
  }
}

.setting-toggle-row strong {
  font-size: 14px;
  line-height: 1.4;
}

.setting-toggle-row small,
.prefix-preferences-heading p {
  color: var(--textSecondary, #667085);
  font-size: 12px;
  line-height: 1.55;
}

.prefix-preferences {
  display: grid;
  gap: 12px;
  padding-top: 4px;
}

.prefix-preferences-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.prefix-preferences-heading h3,
.prefix-preferences-heading p {
  margin: 0;
}

.prefix-preferences-heading > span {
  flex: none;
  color: var(--textSecondary, #667085);
  font-size: 12px;
}

.prefix-rule-list {
  overflow: hidden;
  border: 1px solid var(--divider, #e5e7eb);
  border-radius: 12px;
}

.prefix-rule-row {
  display: grid;
  grid-template-columns: 54px 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 7px 10px 7px 14px;
}

.prefix-rule-row + .prefix-rule-row {
  border-top: 1px solid var(--divider, #e5e7eb);
}

.prefix-rule-row code {
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  text-overflow: ellipsis;
}

.prefix-rule-kind {
  color: var(--textSecondary, #667085);
  font-size: 12px;
}

.prefix-rule-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.prefix-state-button,
.prefix-icon-button {
  display: inline-grid;
  place-items: center;
  min-width: 36px;
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--textSecondary, #667085);
}

.prefix-state-button {
  grid-auto-flow: column;
  gap: 5px;
  padding: 0 9px;
  font-size: 12px;
}

.prefix-state-button .app-icon,
.prefix-icon-button .app-icon {
  width: 18px;
  height: 18px;
}

.prefix-state-button:hover,
.prefix-icon-button:hover:not(:disabled) {
  background: var(--surfaceSecondary, #f2f4f7);
  color: var(--textSecondary, #101828);
}

.prefix-state-button.active {
  color: var(--blue, #2196f3);
}

.prefix-icon-button:disabled {
  opacity: 0.32;
}

.prefix-icon-button.danger:hover {
  color: var(--icon-red, #d92d20);
}

.prefix-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.prefix-add-row input {
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--divider, #d0d5dd);
  border-radius: 9px;
  background: var(--surfacePrimary, #fff);
  color: inherit;
}

.prefix-add-row .button {
  min-height: 42px;
  margin: 0;
}

.prefix-error {
  margin: 0;
  color: var(--icon-red, #d92d20);
  font-size: 12px;
}

@media (max-width: 700px) {
  .prefix-rule-row {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .prefix-rule-kind {
    text-align: right;
  }

  .prefix-rule-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .prefix-state-button,
  .prefix-icon-button,
  .prefix-add-row input,
  .prefix-add-row .button {
    min-height: 44px;
  }

  .prefix-icon-button {
    min-width: 44px;
  }
}
</style>
