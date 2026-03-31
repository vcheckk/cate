import { useSettingsStore } from '../stores/settingsStore'
import { SettingRow, Toggle, Select } from './SettingsComponents'
import type { NotificationMode } from '../../shared/types'

export function NotificationSettings() {
  const store = useSettingsStore()

  return (
    <div className="flex flex-col gap-1">
      <SettingRow label="Enable notifications">
        <Toggle
          checked={store.notificationsEnabled}
          onChange={(v) => store.setSetting('notificationsEnabled', v)}
        />
      </SettingRow>

      <SettingRow label="Notification style">
        <Select
          value={store.notificationMode}
          onChange={(v) => store.setSetting('notificationMode', v as NotificationMode)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'os', label: 'OS only' },
            { value: 'inApp', label: 'In-app only' },
            { value: 'both', label: 'Both' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Only when window unfocused" description="Skip notifications when Cate is in focus">
        <Toggle
          checked={store.notifyOnlyWhenUnfocused}
          onChange={(v) => store.setSetting('notifyOnlyWhenUnfocused', v)}
        />
      </SettingRow>

      <SettingRow label="Terminal halt" description="Notify when Claude finishes or needs input">
        <Toggle
          checked={store.notifyOnTerminalHalt}
          onChange={(v) => store.setSetting('notifyOnTerminalHalt', v)}
        />
      </SettingRow>
    </div>
  )
}
