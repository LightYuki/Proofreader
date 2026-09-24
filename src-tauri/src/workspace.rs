use crate::documents::atomic_write;
use serde_json::{json, Value};
use std::{fs, io::ErrorKind, path::Path};

fn empty_workspace() -> Value {
    json!({ "version": 1, "activeId": null, "openIds": [], "sessions": [] })
}

fn validate(value: &Value) -> Result<(), String> {
    let record = value.as_object().ok_or("工作记录格式不正确")?;
    if record.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("工作记录版本不受支持".into());
    }
    if !record
        .get("activeId")
        .is_some_and(|id| id.is_null() || id.is_string())
        || !record
            .get("openIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().all(Value::is_string))
        || !record
            .get("sessions")
            .and_then(Value::as_array)
            .is_some_and(|sessions| sessions.iter().all(Value::is_object))
    {
        return Err("工作记录格式不正确".into());
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Value, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_workspace()),
        Err(error) => return Err(format!("无法读取工作记录：{error}")),
    };
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("无法恢复上次工作，原工作记录已保留：{error}"))?;
    validate(&value).map_err(|error| format!("无法恢复上次工作，原工作记录已保留：{error}"))?;
    Ok(value)
}

pub fn save(path: &Path, value: &Value) -> Result<(), String> {
    validate(value)?;
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("无法生成工作记录：{error}"))?;
    bytes.push(b'\n');
    atomic_write(path, &bytes).map_err(|error| format!("无法保存工作记录：{error}"))
}

pub fn reset(path: &Path) -> Result<Value, String> {
    match fs::metadata(path) {
        Ok(_) => {
            let backup =
                path.with_file_name(format!("workspace.recovery-{}.json", uuid::Uuid::new_v4()));
            fs::copy(path, &backup)
                .map_err(|error| format!("无法备份原工作记录，尚未重置：{error}"))?;
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法访问原工作记录，尚未重置：{error}")),
    }
    let workspace = empty_workspace();
    save(path, &workspace)?;
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_workspace_starts_empty_without_creating_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        assert_eq!(load(&path).unwrap(), empty_workspace());
        assert!(!path.exists());
    }

    #[test]
    fn workspace_roundtrip_preserves_nested_review_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        let record = json!({
            "version": 1,
            "activeId": "file-1",
            "openIds": ["file-1"],
            "sessions": [{
                "id": "file-1",
                "sourcePath": "source.json",
                "targetPath": "target.json",
                "selectedIndex": 12,
                "reviews": {"12": {"status": "accepted", "draft": "修改\n{name}"}}
            }]
        });
        save(&path, &record).unwrap();
        assert_eq!(load(&path).unwrap(), record);
        save(&path, &empty_workspace()).unwrap();
        assert_eq!(load(&path).unwrap(), empty_workspace());
    }

    #[test]
    fn corrupt_or_unsupported_records_are_reported_and_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        for contents in [
            "{broken",
            r#"{"version":2,"activeId":null,"openIds":[],"sessions":[]}"#,
            r#"{"version":1,"activeId":null,"openIds":[],"sessions":{}}"#,
        ] {
            fs::write(&path, contents).unwrap();
            assert!(load(&path).unwrap_err().contains("原工作记录已保留"));
            assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        }
    }

    #[test]
    fn invalid_updates_do_not_overwrite_the_previous_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        save(&path, &empty_workspace()).unwrap();
        assert!(save(&path, &json!({"version": 1})).is_err());
        assert_eq!(load(&path).unwrap(), empty_workspace());
    }

    #[test]
    fn reset_backs_up_the_original_bytes_before_replacing_a_damaged_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        let damaged = b"{broken \xff workspace";
        fs::write(&path, damaged).unwrap();
        assert_eq!(reset(&path).unwrap(), empty_workspace());
        assert_eq!(load(&path).unwrap(), empty_workspace());
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|entry| entry != &path)
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("workspace.recovery-"));
        assert_eq!(fs::read(&backups[0]).unwrap(), damaged);
    }

    #[test]
    fn reset_creates_a_missing_record_without_an_unnecessary_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        reset(&path).unwrap();
        assert_eq!(load(&path).unwrap(), empty_workspace());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn reset_does_not_replace_the_original_when_a_backup_cannot_be_copied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        fs::create_dir(&path).unwrap();
        let original = path.join("original.txt");
        fs::write(&original, "preserved").unwrap();
        assert!(reset(&path).unwrap_err().contains("尚未重置"));
        assert_eq!(fs::read_to_string(original).unwrap(), "preserved");
        assert!(path.is_dir());
    }
}
