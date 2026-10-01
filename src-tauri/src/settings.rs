use crate::documents::atomic_write;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSettings {
    pub base_url: String,
    pub model: String,
    // Older versions could disable a saved credential. Never reactivate it on upgrade.
    #[serde(default, rename = "useApiKey", skip_serializing)]
    legacy_use_api_key: Option<bool>,
    #[serde(default)]
    disable_saved_key: bool,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            legacy_use_api_key: None,
            disable_saved_key: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsInput {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettings {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_error: Option<String>,
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.proofread.desktop", "llm-api-key")
        .map_err(|e| format!("无法访问 Windows 凭据管理器：{e}"))
}

pub fn api_key() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("无法读取已保存的 API Key：{e}")),
    }
}

pub fn load(path: &Path) -> Result<StoredSettings, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("模型设置文件无法解析：{e}"))
        }
        // Without the old config, the saved credential's service is unknown.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StoredSettings {
            disable_saved_key: true,
            ..StoredSettings::default()
        }),
        Err(e) => Err(format!("无法读取模型设置：{e}")),
    }
}

pub fn view(settings: StoredSettings) -> Result<ModelSettings, String> {
    let (has_api_key, credential_error) = match saved_key(&settings) {
        Ok(key) => (!key.is_empty(), None),
        Err(error) => (false, Some(error)),
    };
    Ok(ModelSettings {
        base_url: settings.base_url,
        model: settings.model,
        has_api_key,
        credential_error,
    })
}

pub fn validate(input: &ModelSettingsInput) -> Result<StoredSettings, String> {
    let base_url = input.base_url.trim().to_owned();
    crate::llm::endpoint(&base_url)?;
    let model = input.model.trim().to_owned();
    if model.is_empty() {
        return Err("请填写模型名称".into());
    }
    Ok(StoredSettings {
        base_url,
        model,
        legacy_use_api_key: None,
        disable_saved_key: false,
    })
}

fn select_key(
    input: &ModelSettingsInput,
    saved: &StoredSettings,
    saved_key: Option<&str>,
) -> Result<String, String> {
    if let Some(key) = &input.api_key {
        return Ok(key.trim().to_owned());
    }
    if saved.disable_saved_key
        || saved.legacy_use_api_key == Some(false)
        || !same_origin(&input.base_url, &saved.base_url)?
    {
        return Ok(String::new());
    }
    Ok(saved_key.unwrap_or_default().trim().to_owned())
}

fn same_origin(requested: &str, saved: &str) -> Result<bool, String> {
    Ok(crate::llm::endpoint(requested)?.origin() == crate::llm::endpoint(saved)?.origin())
}

pub fn saved_key(settings: &StoredSettings) -> Result<String, String> {
    if settings.disable_saved_key || settings.legacy_use_api_key == Some(false) {
        return Ok(String::new());
    }
    Ok(api_key()?.unwrap_or_default())
}

pub fn effective_key(path: &Path, input: &ModelSettingsInput) -> Result<String, String> {
    // Testing and model discovery never change the saved credential.
    if let Some(key) = &input.api_key {
        return Ok(key.trim().to_owned());
    }
    let saved = load(path)?;
    if saved.disable_saved_key
        || saved.legacy_use_api_key == Some(false)
        || !same_origin(&input.base_url, &saved.base_url)?
    {
        return Ok(String::new());
    }
    select_key(input, &saved, api_key()?.as_deref())
}

fn write_key(key: Option<&str>) -> Result<(), String> {
    let entry = credential()?;
    match key {
        Some(key) => entry
            .set_password(key)
            .map_err(|e| format!("API Key 保存失败：{e}")),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("API Key 移除失败：{e}")),
        },
    }
}

fn persist_settings(
    path: &Path,
    settings: &StoredSettings,
    previous_key: Option<&str>,
    next_key: Option<&str>,
    mut write_credential: impl FnMut(Option<&str>) -> Result<(), String>,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    let changed_key = previous_key != next_key;
    if changed_key {
        write_credential(next_key)?;
    }
    if let Err(error) = atomic_write(path, &bytes) {
        // Keep the previously saved URL/model and credential together if the file write fails.
        if changed_key && write_credential(previous_key).is_err() {
            return Err(format!("{error}；API Key 已变更，请重新保存完整设置"));
        }
        return Err(error);
    }
    Ok(())
}

pub fn save(path: &Path, input: ModelSettingsInput) -> Result<ModelSettings, String> {
    let mut settings = validate(&input)?;
    let saved = load(path)?;
    let no_key = input
        .api_key
        .as_ref()
        .is_some_and(|key| key.trim().is_empty())
        || (input.api_key.is_none()
            && (saved.disable_saved_key
                || saved.legacy_use_api_key == Some(false)
                || !same_origin(&input.base_url, &saved.base_url)?));
    if no_key {
        settings.disable_saved_key = true;
        // An inaccessible vault is left intact. Persist the opt-out so it cannot
        // silently reactivate on a later launch or a newly configured service.
        if let (Some(_), Ok(previous)) = (&input.api_key, api_key()) {
            persist_settings(path, &settings, previous.as_deref(), None, write_key)?;
        } else {
            atomic_write(
                path,
                &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
            )?;
        }
        return view(settings);
    }
    let previous_key = api_key()?;
    let selected_key = select_key(&input, &saved, previous_key.as_deref())?;
    let next_key = (!selected_key.is_empty()).then_some(selected_key.as_str());
    persist_settings(
        path,
        &settings,
        previous_key.as_deref(),
        next_key,
        write_key,
    )?;
    view(settings)
}

pub fn reset(path: &Path) -> Result<ModelSettings, String> {
    if path.exists() {
        let backup =
            path.with_file_name(format!("settings.recovery-{}.json", uuid::Uuid::new_v4()));
        fs::copy(path, backup).map_err(|e| format!("无法备份模型设置，尚未重建：{e}"))?;
    }
    let settings = StoredSettings {
        disable_saved_key: true,
        ..StoredSettings::default()
    };
    atomic_write(
        path,
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )?;
    view(settings)
}

pub fn validate_saved(path: &Path) -> Result<ModelSettings, String> {
    let settings = load(path)?;
    crate::llm::endpoint(&settings.base_url)?;
    if settings.model.trim().is_empty() {
        return Err("请先在设置中填写模型名称。".into());
    }
    let has_api_key = !saved_key(&settings)?.is_empty();
    Ok(ModelSettings {
        base_url: settings.base_url,
        model: settings.model,
        has_api_key,
        credential_error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(base_url: &str, api_key: Option<&str>) -> ModelSettingsInput {
        ModelSettingsInput {
            base_url: base_url.into(),
            model: "test-model".into(),
            api_key: api_key.map(str::to_owned),
        }
    }

    fn stored(base_url: &str) -> StoredSettings {
        StoredSettings {
            base_url: base_url.into(),
            ..StoredSettings::default()
        }
    }

    #[test]
    fn saved_key_is_reused_only_for_the_same_normalized_origin() {
        let saved = stored("https://api.example.com/v1");
        for same_origin in [
            "https://API.EXAMPLE.COM:443/v2/chat/completions/",
            " https://api.example.com/custom?version=2 ",
        ] {
            assert_eq!(
                select_key(&input(same_origin, None), &saved, Some("saved-test-key")).unwrap(),
                "saved-test-key"
            );
        }
        for other_origin in [
            "https://other.example.com/v1",
            "http://api.example.com/v1",
            "https://api.example.com:8443/v1",
        ] {
            assert_eq!(
                select_key(&input(other_origin, None), &saved, Some("saved-test-key")).unwrap(),
                ""
            );
        }
    }

    #[test]
    fn explicit_key_or_no_saved_key_allows_a_new_service() {
        let next = "http://localhost:8787/v1";
        let saved = stored("https://api.example.com/v1");
        assert_eq!(
            select_key(
                &input(next, Some(" new-test-key ")),
                &saved,
                Some("old-test-key")
            )
            .unwrap(),
            "new-test-key"
        );
        assert_eq!(select_key(&input(next, None), &saved, None).unwrap(), "");
    }

    #[test]
    fn explicit_empty_key_clears_even_on_the_same_service() {
        let base = "https://api.example.com/v1";
        let next = input(base, Some("  "));
        assert_eq!(
            select_key(&next, &stored(base), Some("saved-key")).unwrap(),
            ""
        );
        // An explicit key (including empty) does not need to read settings or credentials.
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(effective_key(directory.path(), &next).unwrap(), "");
        assert_eq!(
            effective_key(directory.path(), &input(base, Some(" new-key "))).unwrap(),
            "new-key"
        );
    }

    #[test]
    fn old_settings_keep_the_existing_authentication_default() {
        let old: StoredSettings = serde_json::from_str(
            r#"{"baseUrl":"https://api.example.com/v1","model":"test-model"}"#,
        )
        .unwrap();
        assert_eq!(old.legacy_use_api_key, None);
        let old_input: ModelSettingsInput = serde_json::from_str(
            r#"{"baseUrl":"https://api.example.com/v1","model":"test-model"}"#,
        )
        .unwrap();
        assert!(old_input.api_key.is_none());
        assert_eq!(
            select_key(&old_input, &old, Some("saved-key")).unwrap(),
            "saved-key"
        );
    }

    #[test]
    fn old_disabled_credentials_are_not_reactivated() {
        let old: StoredSettings = serde_json::from_str(
            r#"{"baseUrl":"https://api.example.com/v1","model":"test-model","useApiKey":false}"#,
        )
        .unwrap();
        let next = input(&old.base_url, None);
        assert_eq!(select_key(&next, &old, Some("saved-key")).unwrap(), "");
        assert_eq!(saved_key(&old).unwrap(), "");
        assert!(!view(old.clone()).unwrap().has_api_key);
        assert!(!serde_json::to_string(&old).unwrap().contains("useApiKey"));
        assert_eq!(
            select_key(
                &input(&old.base_url, Some("new-key")),
                &old,
                Some("saved-key")
            )
            .unwrap(),
            "new-key"
        );
    }

    #[test]
    fn saving_without_a_key_removes_the_credential_without_a_mode_flag() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let next = input("http://localhost:8787/v1", Some(""));
        let settings = validate(&next).unwrap();
        let mut credential = Some("saved-key".to_owned());
        persist_settings(&path, &settings, Some("saved-key"), None, |key| {
            credential = key.map(str::to_owned);
            Ok(())
        })
        .unwrap();
        assert!(credential.is_none());
        let contents = fs::read_to_string(path).unwrap();
        assert!(!contents.contains("useApiKey"));
        assert!(!contents.contains("saved-key"));
    }

    #[test]
    fn failed_config_write_restores_a_removed_key() {
        let directory = tempfile::tempdir().unwrap();
        let settings = StoredSettings::default();
        let mut writes = Vec::new();
        // A directory cannot be replaced by the settings file, so persistence must roll back.
        let result = persist_settings(
            directory.path(),
            &settings,
            Some("saved-key"),
            None,
            |key| {
                writes.push(key.map(str::to_owned));
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(writes, vec![None, Some("saved-key".into())]);
    }

    #[test]
    fn failed_credential_change_does_not_overwrite_the_existing_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, "existing-settings").unwrap();
        let result = persist_settings(
            &path,
            &StoredSettings::default(),
            Some("saved-key"),
            None,
            |_| Err("credential-write-failed".into()),
        );
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "existing-settings");
    }
}
