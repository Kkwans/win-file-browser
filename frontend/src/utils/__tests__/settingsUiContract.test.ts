import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsViews = [
  "Global.vue",
  "Profile.vue",
  "Shares.vue",
  "Users.vue",
  "User.vue",
];

describe("settings UI contract", () => {
  it("keeps settings navigation semantically ordered as list items with links", () => {
    const settings = readFileSync(
      resolve(process.cwd(), "src/views/Settings.vue"),
      "utf8"
    );

    expect(settings).toMatch(/<ul>[\s\S]*<li[\s\S]*<router-link/);
    expect(settings).not.toMatch(/<router-link[^>]*>\s*<li/);
  });

  it("uses the shared local icon component across settings views", () => {
    for (const view of settingsViews) {
      const source = readFileSync(
        resolve(process.cwd(), `src/views/settings/${view}`),
        "utf8"
      );

      expect(source, view).not.toContain("material-icons");
    }

    const profile = readFileSync(
      resolve(process.cwd(), "src/views/settings/Profile.vue"),
      "utf8"
    );
    const registry = readFileSync(
      resolve(process.cwd(), "src/components/ui/iconRegistry.ts"),
      "utf8"
    );

    expect(profile).toContain(
      'import AppIcon from "@/components/ui/AppIcon.vue"'
    );
    expect(profile).toContain(":name=\"rule.visible ? 'eye' : 'eye-off'\"");
    expect(registry).toContain('"eye-off"');
  });

  it("账户设置两列按内容高度对齐，密码卡片不被左侧长表单撑满", () => {
    const profile = readFileSync(
      resolve(process.cwd(), "src/views/settings/Profile.vue"),
      "utf8"
    );

    expect(profile).toContain('class="row profile-settings-grid"');
    expect(profile).toMatch(
      /\.profile-settings-grid\s*\{[\s\S]*?align-items:\s*flex-start;/
    );
    expect(profile).toMatch(
      /\.profile-settings-grid\s*>\s*\.column\s*>\s*\.card\s*\{[\s\S]*?height:\s*auto;/
    );
  });

  it("账户设置播放偏好使用可换行控制区，不会把说明压成竖排", () => {
    const profile = readFileSync(
      resolve(process.cwd(), "src/views/settings/Profile.vue"),
      "utf8"
    );

    expect(profile).toContain('class="setting-toggle-row setting-control-row"');
    expect(profile).toContain("setting-controls");
    expect(profile).not.toMatch(/grid-template-columns:\s*20px/);
    expect(profile).toMatch(
      /\.setting-control-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/
    );
  });

  it("播放器超时仅用数字输入；默认播放策略为原生/兼容/每次询问", () => {
    const profile = readFileSync(
      resolve(process.cwd(), "src/views/settings/Profile.vue"),
      "utf8"
    );

    expect(profile).toContain('class="app-number"');
    expect(profile).toContain("默认播放策略");
    expect(profile).toContain('option value="native">原生');
    expect(profile).toContain('option value="compat">兼容转码');
    expect(profile).toContain('option value="ask">每次询问');
    // timeout row must not ship a preset dropdown
    const timeoutBlock = profile.split("播放器控件自动隐藏")[1]?.split("默认播放策略")[0] || "";
    expect(timeoutBlock).not.toContain("<select");
  });
});
