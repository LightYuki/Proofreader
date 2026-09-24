mod documents;
mod llm;
mod policy;
mod prompts;
mod settings;
mod workspace;
mod single_instance;

use documents::{AcceptedChange, DocumentData, DocumentSession};
use llm::BatchRequest;
use settings::{ModelSettings, ModelSettingsInput};
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, State};
use tokio_util::sync::CancellationToken;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

struct AppState {
    documents: Mutex<HashMap<String, DocumentData>>,
    requests: Mutex<HashMap<String, CancellationToken>>,
    settings_path: PathBuf,
    workspace_path: PathBuf,
    client: reqwest::Client,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<ModelSettings, String> {
    settings::view(settings::load(&state.settings_path)?)
}

#[tauri::command]
fn reset_settings(state: State<'_, AppState>) -> Result<ModelSettings, String> {
    settings::reset(&state.settings_path)
}

#[tauri::command]
fn validate_settings(state: State<'_, AppState>) -> Result<ModelSettings, String> {
    settings::validate_saved(&state.settings_path)
}

#[tauri::command]
fn save_settings(
    settings: ModelSettingsInput,
    state: State<'_, AppState>,
) -> Result<ModelSettings, String> {
    settings::save(&state.settings_path, settings)
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    workspace::load(&state.workspace_path)
}

#[tauri::command]
fn reset_workspace(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    workspace::reset(&state.workspace_path)
}

#[tauri::command]
fn save_workspace(workspace: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    workspace::save(&state.workspace_path, &workspace)
}

#[tauri::command]
async fn list_models(settings: ModelSettingsInput, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let key = settings::effective_key(&state.settings_path, &settings)?;
    llm::list_models(&state.client, &settings.base_url, &key).await
}

#[tauri::command]
async fn test_connection(
    settings: ModelSettingsInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let connection = settings::validate(&settings)?;
    let key = settings::effective_key(&state.settings_path, &settings)?;
    llm::complete(
        &state.client,
        &connection,
        &key,
        serde_json::json!([
            {"role":"user", "content":"Reply with OK."}
        ]),
    )
    .await?;
    Ok("连接成功".into())
}

#[tauri::command]
async fn open_documents(
    source_path: String,
    target_path: String,
    state: State<'_, AppState>,
) -> Result<DocumentSession, String> {
    let (session, document) = documents::open(&source_path, &target_path)?;
    let mut docs = state
        .documents
        .lock()
        .map_err(|_| "文件状态不可用，请重新启动软件")?;
    docs.clear();
    docs.insert(session.id.clone(), document);
    Ok(session)
}

#[tauri::command]
async fn save_document(
    document_id: String,
    output_path: String,
    changes: Vec<AcceptedChange>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let docs = state
        .documents
        .lock()
        .map_err(|_| "文件状态不可用，请重新启动软件")?;
    let doc = docs
        .get(&document_id)
        .ok_or("文件已关闭或过期，请重新打开")?;
    documents::save(doc, &output_path, &changes)
}

#[tauri::command]
async fn check_batch(request: BatchRequest, state: State<'_, AppState>) -> Result<String, String> {
    let messages = {
        let docs = state
            .documents
            .lock()
            .map_err(|_| "文件状态不可用，请重新启动软件")?;
        let doc = docs
            .get(&request.document_id)
            .ok_or("文件已关闭或过期，请重新打开")?;
        llm::batch_messages(&request, &doc.entries)?
    };
    let settings = settings::load(&state.settings_path)?;
    let key = settings::saved_key(&settings)?;
    let token = {
        let mut requests = state.requests.lock().map_err(|_| "请求状态不可用")?;
        requests
            .entry(request.request_id.clone())
            .or_insert_with(CancellationToken::new)
            .clone()
    };
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err("请求已停止".into()),
        result = llm::complete(&state.client, &settings, &key, messages) => result,
    };
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request.request_id);
    }
    result
}

#[tauri::command]
fn cancel_request(request_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut requests = state.requests.lock().map_err(|_| "请求状态不可用")?;
    // Register a cancellation even when it races ahead of check_batch registration.
    requests
        .entry(request_id)
        .or_insert_with(CancellationToken::new)
        .cancel();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            std::fs::create_dir_all(&directory)?;
            #[cfg(windows)]
            match single_instance::acquire(&directory) {
                Ok(Some(guard)) => { app.manage(guard); }
                result => {
                    if let Err(message) = result {
                        use tauri_plugin_dialog::DialogExt;
                        app.dialog().message(message).title("校润").blocking_show();
                    }
                    app.handle().exit(0);
                    return Ok(());
                }
            }
            let client = reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .connect_timeout(CONNECT_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            app.manage(AppState {
                documents: Mutex::new(HashMap::new()),
                requests: Mutex::new(HashMap::new()),
                settings_path: directory.join("settings.json"),
                workspace_path: directory.join("workspace.json"),
                client,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            reset_settings,
            validate_settings,
            save_settings,
            test_connection,
            list_models,
            load_workspace,
            reset_workspace,
            save_workspace,
            open_documents,
            save_document,
            check_batch,
            cancel_request
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 Proofread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_wins_even_before_network_starts() {
        let token = CancellationToken::new();
        token.cancel();
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => "cancelled",
            _ = std::future::ready(()) => "completed",
        };
        assert_eq!(result, "cancelled");
    }
}
