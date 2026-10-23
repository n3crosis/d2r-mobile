// 可选的本地应用外观字段，依据打包器的封闭校验契约。
// Optional local app identity fields, based on the packager's closed validation contract.
import { useRef } from "react";
import { t } from "../../i18n.mjs";
import { APP_CUSTOMIZATION_LIMITS } from "../../app-customization.mjs";
import { Button } from "@/components/ui/button";

export type AppCustomizationDraft = {
  displayName?: string;
  bundleIdentifier?: string;
  version?: string;
  buildVersion?: string;
  icon?: File;
};
const fields = [
  {
    name: "displayName",
    label: "dmWebCustomName",
    maxLength: APP_CUSTOMIZATION_LIMITS.displayNameCharacters * 2,
  },
  {
    name: "bundleIdentifier",
    label: "dmWebCustomBundle",
    maxLength: APP_CUSTOMIZATION_LIMITS.bundleIdentifierCharacters,
  },
  {
    name: "version",
    label: "dmWebCustomVersion",
    maxLength: APP_CUSTOMIZATION_LIMITS.versionCharacters,
  },
  { name: "buildVersion", label: "dmWebCustomBuild", maxLength: 10 },
] as const;
export function AppCustomizationFields({
  value,
  disabled,
  onChange,
  error,
}: {
  value: AppCustomizationDraft;
  disabled: boolean;
  onChange: (value: AppCustomizationDraft) => void;
  error: string;
}) {
  const iconInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <details className="space-y-2 rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("dmWebCustomizeApp")}</summary>
        <p className="text-xs text-muted-foreground">{t("dmWebCustomHelp")}</p>
        <fieldset
          className="space-y-2"
          disabled={disabled}
          aria-describedby={error ? "customization-error" : undefined}
        >
          <legend className="sr-only">{t("dmWebCustomizeApp")}</legend>
          {fields.map(({ name, label, maxLength }) => (
            <label key={name} className="block space-y-1 text-sm">
              <span>{t(label)}</span>
              <input
                type="text"
                value={value[name] ?? ""}
                maxLength={maxLength}
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => onChange({ ...value, [name]: event.target.value })}
              />
            </label>
          ))}
          {value.bundleIdentifier && (
            <p className="text-xs text-muted-foreground">{t("dmWebCustomBundleHelp")}</p>
          )}
          <label className="block space-y-1 text-sm">
            <span>{t("dmWebCustomIcon")}</span>
            <input
              ref={iconInput}
              type="file"
              accept="image/png,.png"
              className="block w-full text-sm"
              aria-describedby="custom-icon-help"
              onChange={(event) => onChange({ ...value, icon: event.target.files?.[0] })}
            />
          </label>
          <p id="custom-icon-help" className="text-xs text-muted-foreground">
            {t("dmWebCustomIconHelp")}
          </p>
          {value.icon && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (disabled) return;
                onChange({ ...value, icon: undefined });
                if (iconInput.current) iconInput.current.value = "";
              }}
            >
              {t("dmWebCustomRemoveIcon")}
            </Button>
          )}
        </fieldset>
      </details>
      {error && (
        <p id="customization-error" className="text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
