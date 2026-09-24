use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinePair {
    pub index: usize,
    pub source: String,
    pub translation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSession {
    pub id: String,
    pub revision: String,
    pub source_path: String,
    pub target_path: String,
    pub entries: Vec<LinePair>,
}

pub struct DocumentData {
    pub source_path: PathBuf,
    pub target_path: PathBuf,
    pub target: Value,
    pub entries: Vec<LinePair>,
}

#[derive(Deserialize)]
pub struct AcceptedChange {
    pub index: usize,
    pub message: String,
}

fn read_json(path: &Path, label: &str) -> Result<(Value, u64), String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取{label}：{e}"))?;
    let contents = std::str::from_utf8(&bytes).map_err(|e| format!("无法读取{label}：{e}"))?;
    let value = serde_json::from_str(contents.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{label} JSON 无法解析：{e}"))?;
    // Stable FNV-1a over the exact bytes parsed above. This is a change detector,
    // not a security signature; separate source/target hashes avoid ambiguity.
    let fingerprint = bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    Ok((value, fingerprint))
}

pub fn pair_entries(source: &Value, target: &Value) -> Result<Vec<LinePair>, String> {
    let source = source.as_array().ok_or("原文 JSON 顶层必须是数组")?;
    let target = target.as_array().ok_or("译文 JSON 顶层必须是数组")?;
    if source.len() != target.len() {
        return Err(format!(
            "原文有 {} 条，译文有 {} 条，数量不同，无法按顺序配对",
            source.len(),
            target.len()
        ));
    }
    source
        .iter()
        .zip(target)
        .enumerate()
        .map(|(index, (src, dst))| {
            let source = src
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("原文第 {} 条的 message 必须是文本", index + 1))?;
            let translation = dst
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("译文第 {} 条的 message 必须是文本", index + 1))?;
            Ok(LinePair {
                index,
                source: source.into(),
                translation: translation.into(),
                source_name: src.get("name").and_then(Value::as_str).map(str::to_owned),
                target_name: dst.get("name").and_then(Value::as_str).map(str::to_owned),
            })
        })
        .collect()
}

pub fn open(
    source_path: &str,
    target_path: &str,
) -> Result<(DocumentSession, DocumentData), String> {
    let source_path =
        fs::canonicalize(source_path).map_err(|e| format!("无法打开原文路径：{e}"))?;
    let target_path =
        fs::canonicalize(target_path).map_err(|e| format!("无法打开译文路径：{e}"))?;
    let (source, source_revision) = read_json(&source_path, "原文")?;
    let (target, target_revision) = read_json(&target_path, "译文")?;
    let entries = pair_entries(&source, &target)?;
    let session = DocumentSession {
        id: uuid::Uuid::new_v4().to_string(),
        revision: format!("fnv1a64:{source_revision:016x}:{target_revision:016x}"),
        source_path: display_path(&source_path),
        target_path: display_path(&target_path),
        entries: entries.clone(),
    };
    Ok((
        session,
        DocumentData {
            source_path,
            target_path,
            target,
            entries,
        },
    ))
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned()
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn output_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        if !path.is_file() {
            return Err("保存位置必须是文件".into());
        }
        return fs::canonicalize(path).map_err(|e| format!("无法访问保存位置：{e}"));
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = fs::canonicalize(parent).map_err(|e| format!("无法访问保存文件夹：{e}"))?;
    let filename = path.file_name().ok_or("保存位置缺少文件名")?;
    Ok(parent.join(filename))
}

pub fn patch_document(original: &Value, changes: &[AcceptedChange]) -> Result<Value, String> {
    let mut target = original.clone();
    let rows = target.as_array_mut().ok_or("译文不是数组")?;
    let mut seen = HashSet::new();
    for change in changes {
        if !seen.insert(change.index) {
            return Err(format!("第 {} 条出现重复修改", change.index + 1));
        }
        let row = rows
            .get_mut(change.index)
            .ok_or_else(|| format!("修改索引 {} 超出译文范围", change.index))?;
        let message = row.get_mut("message").ok_or("原译文缺少 message 字段")?;
        *message = Value::String(change.message.clone());
    }
    Ok(target)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("保存位置缺少文件夹")?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法创建临时文件：{e}"))?;
    temp.write_all(bytes)
        .map_err(|e| format!("写入失败：{e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("文件同步失败：{e}"))?;
    temp.persist(path)
        .map_err(|e| format!("无法替换保存文件：{}", e.error))?;
    Ok(())
}

pub fn save(data: &DocumentData, path: &str, changes: &[AcceptedChange]) -> Result<String, String> {
    let path = output_path(Path::new(path))?;
    if same_path(&path, &data.source_path) || same_path(&path, &data.target_path) {
        return Err("请另存为校润版，不能覆盖导入的原文或译文文件".into());
    }
    let patched = patch_document(&data.target, changes)?;
    let mut bytes =
        serde_json::to_vec_pretty(&patched).map_err(|e| format!("无法生成校润版 JSON：{e}"))?;
    bytes.push(b'\n');
    atomic_write(&path, &bytes)?;
    Ok(display_path(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairs_by_position_and_preserves_optional_names() {
        let rows = pair_entries(
            &json!([{"message":"你好"},{"name":"夏","message":""}]),
            &json!([{"message":"Hi"},{"name":"Xia","message":""}]),
        )
        .unwrap();
        assert_eq!(rows[1].index, 1);
        assert_eq!(rows[1].source_name.as_deref(), Some("夏"));
        assert_eq!(rows[1].target_name.as_deref(), Some("Xia"));
        assert!(pair_entries(&json!([]), &json!([])).unwrap().is_empty());
        assert!(pair_entries(&json!([{"message":"a"}]), &json!([])).is_err());
        assert!(pair_entries(&json!([{"message":12}]), &json!([{"message":"a"}])).is_err());
    }

    #[test]
    fn patch_preserves_fields_numbers_and_unmodified_messages() {
        let original: Value = serde_json::from_str(r#"[{"name":"Xia","message":"A","number":123456789012345678901234567890,"extra":{"x":[true,null]}},{"message":"B"}]"#).unwrap();
        let patched = patch_document(
            &original,
            &[AcceptedChange {
                index: 1,
                message: "Fixed\n{name}".into(),
            }],
        )
        .unwrap();
        assert_eq!(patched[0], original[0]);
        assert_eq!(patched[1]["message"], "Fixed\n{name}");
        assert!(serde_json::to_string(&patched)
            .unwrap()
            .contains("123456789012345678901234567890"));
        assert_eq!(original[1]["message"], "B");
        assert!(patch_document(
            &original,
            &[AcceptedChange {
                index: 2,
                message: "bad".into()
            }]
        )
        .is_err());
    }

    #[test]
    fn save_rejects_input_paths_and_replaces_output_completely() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("source.json");
        let dst = dir.path().join("target.json");
        fs::write(&src, r#"[{"message":"原文"}]"#).unwrap();
        fs::write(&dst, r#"[{"message":"Original","other":42}]"#).unwrap();
        let (_, data) = open(src.to_str().unwrap(), dst.to_str().unwrap()).unwrap();
        assert!(save(&data, src.to_str().unwrap(), &[]).is_err());
        assert!(save(&data, dst.to_str().unwrap(), &[]).is_err());
        let output = dir.path().join("reviewed.json");
        fs::write(&output, "old contents longer than the new ones").unwrap();
        save(
            &data,
            output.to_str().unwrap(),
            &[AcceptedChange {
                index: 0,
                message: "Fixed".into(),
            }],
        )
        .unwrap();
        let (value, _) = read_json(&output, "test").unwrap();
        assert_eq!(value, json!([{"message":"Fixed","other":42}]));
        assert_eq!(read_json(&dst, "test").unwrap().0[0]["message"], "Original");
    }

    #[test]
    fn revision_is_stable_and_detects_changes_to_either_original_file() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("source.json");
        let dst = dir.path().join("target.json");
        fs::write(&src, "\u{feff}[{\"message\":\"原文\"}]").unwrap();
        fs::write(&dst, r#"[{"message":"Original","other":42}]"#).unwrap();
        let read_session = || {
            open(src.to_str().unwrap(), dst.to_str().unwrap())
                .unwrap()
                .0
        };
        let original = read_session();
        assert_eq!(original.entries[0].source, "原文");
        assert_eq!(original.revision, read_session().revision);
        fs::write(&src, r#"[{"message":"更新原文"}]"#).unwrap();
        let source_changed = read_session();
        assert_ne!(original.revision, source_changed.revision);
        // Even a non-message edit invalidates a stored review conservatively.
        fs::write(&dst, r#"[{"message":"Original","other":43}]"#).unwrap();
        assert_ne!(source_changed.revision, read_session().revision);
    }
}
