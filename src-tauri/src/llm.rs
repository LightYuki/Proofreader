use crate::{
    documents::LinePair,
    policy::review_policy,
    prompts::{self, Requirements},
    settings::StoredSettings,
};
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub request_id: String,
    pub document_id: String,
    pub core_start: usize,
    pub core_end: usize,
    pub context_start: usize,
    pub context_end: usize,
    pub requirements: Requirements,
}

pub fn endpoint(base: &str) -> Result<Url, String> {
    let mut url = Url::parse(base.trim())
        .map_err(|_| "Base URL 格式不正确，请填写完整的 http:// 或 https:// 地址")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL 仅支持 HTTP 或 HTTPS 地址".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Base URL 不能包含账户密码或 # 片段，请在 API Key 栏填写密钥".into());
    }
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        let endpoint_path = format!("{path}/chat/completions");
        url.set_path(&endpoint_path);
    } else {
        let endpoint_path = path.to_owned();
        url.set_path(&endpoint_path);
    }
    Ok(url)
}

pub fn models_endpoint(base: &str) -> Result<Url, String> {
    let mut url = endpoint(base)?;
    let base_path = url
        .path()
        .strip_suffix("/chat/completions")
        .unwrap_or(url.path());
    let path = format!("{base_path}/models");
    url.set_path(&path);
    Ok(url)
}

pub fn batch_messages(request: &BatchRequest, entries: &[LinePair]) -> Result<Value, String> {
    let policy = review_policy();
    if request.request_id.is_empty()
        || request.core_start >= request.core_end
        || request.context_start > request.core_start
        || request.core_end > request.context_end
        || request.context_end > entries.len()
        || request.core_end - request.core_start > policy.batch_size
        || request.context_end - request.context_start > policy.window_size()
        || request.core_start - request.context_start > policy.context_before
        || request.context_end - request.core_end > policy.context_after
    {
        return Err("批次范围无效，请重新打开文件后开始检查".into());
    }
    Ok(prompts::review_messages(
        &request.requirements,
        request.core_start..request.core_end,
        &entries[request.context_start..request.context_end],
    ))
}

fn provider_error(value: &Value, status: reqwest::StatusCode, key: &str) -> String {
    let description = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("服务未返回可读的错误说明");
    let redacted = if key.is_empty() {
        description.to_owned()
    } else {
        description.replace(key, "[API Key]")
    };
    format!(
        "模型服务返回 HTTP {}：{}",
        status.as_u16(),
        redacted.chars().take(600).collect::<String>()
    )
}

pub fn extract_content(response: &Value) -> Result<String, String> {
    let choice = response
        .pointer("/choices/0")
        .ok_or("响应缺少 choices[0]，请确认服务支持 OpenAI Chat Completions 接口")?;
    match choice.get("finish_reason").and_then(Value::as_str) {
        Some("length") => {
            return Err("模型响应因长度限制被截断。本批未完成，请调整模型配置后重试".into())
        }
        Some("content_filter") => return Err("模型服务过滤了本批内容，本批未完成".into()),
        _ => {}
    }
    let content = choice.pointer("/message/content");
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    };
    if text.trim().is_empty() {
        return Err(
            "模型未返回文本内容，本批未完成；请检查模型是否支持文本 Chat Completions".into(),
        );
    }
    Ok(text)
}

async fn request_json(mut request: reqwest::RequestBuilder, key: &str) -> Result<Value, String> {
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| -> String {
        if e.is_timeout() {
            "模型服务请求超时，请重试".into()
        } else if e.is_connect() {
            "无法连接模型服务，请检查 Base URL、网络和服务状态".into()
        } else {
            "模型请求失败，请检查服务地址、网络或 API Key 格式".into()
        }
    })?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "无法完整读取模型服务响应，请重试")?;
    let parsed = serde_json::from_slice::<Value>(&bytes);
    if !status.is_success() {
        return Err(provider_error(&parsed.unwrap_or(Value::Null), status, key));
    }
    parsed.map_err(|_| "模型服务返回的不是 JSON 响应，请确认 Base URL 指向 API 而非网页".into())
}

pub async fn complete(
    client: &Client,
    settings: &StoredSettings,
    key: &str,
    messages: Value,
) -> Result<String, String> {
    if settings.model.trim().is_empty() {
        return Err("请先在模型设置中选择或填写模型名称".into());
    }
    let request = client
        .post(endpoint(&settings.base_url)?)
        .json(&json!({ "model": settings.model, "messages": messages, "stream": false }));
    extract_content(&request_json(request, key).await?)
}

pub async fn list_models(
    client: &Client,
    base_url: &str,
    key: &str,
) -> Result<Vec<String>, String> {
    let response = request_json(client.get(models_endpoint(base_url)?), key).await?;
    let entries = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or("服务未返回可用的模型列表，请手动填写模型名称")?;
    let mut models: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };

    fn mock_service(status: &str, response: Value) -> (String, std::thread::JoinHandle<String>) {
        mock_body_service(status, response.to_string())
    }

    fn mock_body_service(status: &str, body: String) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/v1", listener.local_addr().unwrap());
        let status = status.to_owned();
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(start) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..start]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse().unwrap())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= start + 4 + length {
                        break;
                    }
                }
            }
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            String::from_utf8(bytes).unwrap()
        });
        (address, thread)
    }

    #[tokio::test]
    async fn sends_real_chat_request_and_extracts_response() {
        let (base_url, server) = mock_service(
            "200 OK",
            json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"issues\":[]}"}}]}),
        );
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let mut settings = StoredSettings::default();
        settings.base_url = base_url;
        settings.model = "local-test-model".into();
        let result = complete(
            &client,
            &settings,
            "test-only-key",
            json!([{"role":"user","content":"hello"}]),
        )
        .await
        .unwrap();
        assert_eq!(result, "{\"issues\":[]}");
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test-only-key"));
        let body: Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["model"], "local-test-model");
        assert_eq!(body["stream"], false);
    }

    #[tokio::test]
    async fn http_failure_is_reported_and_key_is_redacted() {
        let (base_url, server) = mock_service(
            "401 Unauthorized",
            json!({"error":{"message":"Invalid key test-only-key"}}),
        );
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let mut settings = StoredSettings::default();
        settings.base_url = base_url;
        settings.model = "mock".into();
        let result = complete(&client, &settings, "test-only-key", json!([]))
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(result.contains("401"));
        assert!(!result.contains("test-only-key"));
    }

    #[test]
    fn endpoint_handles_base_full_path_and_query() {
        assert_eq!(
            endpoint("https://example.com/v1/").unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://localhost:1234/v1/chat/completions/")
                .unwrap()
                .as_str(),
            "http://localhost:1234/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://example.com/custom?version=1")
                .unwrap()
                .as_str(),
            "https://example.com/custom/chat/completions?version=1"
        );
        assert!(endpoint("file:///example").is_err());
        assert!(endpoint("https://user:password@example.com").is_err());
    }

    #[test]
    fn model_endpoint_uses_the_same_api_root_and_preserves_query() {
        for (base, expected) in [
            ("https://example.com/v1/", "https://example.com/v1/models"),
            (
                "http://localhost:1234/v1/chat/completions/",
                "http://localhost:1234/v1/models",
            ),
            (
                "https://example.com/custom/chat/completions?version=1",
                "https://example.com/custom/models?version=1",
            ),
            ("http://localhost:1234", "http://localhost:1234/models"),
        ] {
            assert_eq!(models_endpoint(base).unwrap().as_str(), expected);
        }
        assert!(models_endpoint("file:///example").is_err());
        assert!(models_endpoint("https://user:password@example.com").is_err());
    }

    #[tokio::test]
    async fn model_listing_supports_keyless_and_authenticated_services_without_a_model() {
        for key in ["", "test-only-key"] {
            let (base, server) = mock_service(
                "200 OK",
                json!({"data":[
                    {"id":" z-model "}, {"id":"a-model"}, {"id":"z-model"},
                    {"id":" "}, {"id":null}, {"object":"ignored"}
                ]}),
            );
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            let models = list_models(&client, &format!("{base}/chat/completions"), key)
                .await
                .unwrap();
            assert_eq!(models, vec!["a-model", "z-model"]);
            let request = server.join().unwrap().to_lowercase();
            assert!(request.starts_with("get /v1/models http/1.1"));
            assert_eq!(
                request.contains("authorization: bearer test-only-key"),
                !key.is_empty()
            );
            if key.is_empty() {
                assert!(!request.contains("authorization:"));
            }
        }
    }

    #[tokio::test]
    async fn model_listing_reports_redacted_http_and_invalid_response_errors() {
        for (status, body, expected) in [
            (
                "401 Unauthorized",
                r#"{"error":{"message":"Invalid key test-only-key"}}"#,
                "401",
            ),
            ("200 OK", r#"{"models":["unrecognized"]}"#, "手动填写"),
            ("200 OK", "<html>Not an API</html>", "不是 JSON"),
        ] {
            let (base, server) = mock_body_service(status, body.into());
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            let error = list_models(&client, &base, "test-only-key")
                .await
                .unwrap_err();
            server.join().unwrap();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("test-only-key"));
        }
    }

    #[tokio::test]
    async fn empty_model_list_is_valid() {
        let (base, server) = mock_service("200 OK", json!({"data":[]}));
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        assert!(list_models(&client, &base, "").await.unwrap().is_empty());
        server.join().unwrap();
    }

    #[test]
    fn prompt_uses_original_global_indices_and_exact_context_slice() {
        let entries = (0..100)
            .map(|index| LinePair {
                index,
                source: format!("原文{index}"),
                translation: format!("Translation {index}"),
                source_name: None,
                target_name: None,
            })
            .collect::<Vec<_>>();
        let request = BatchRequest {
            request_id: "r".into(),
            document_id: "d".into(),
            core_start: 30,
            core_end: 60,
            context_start: 15,
            context_end: 75,
            requirements: Requirements {
                style: "Keep names".into(),
                background: "They are siblings".into(),
            },
        };
        let messages = batch_messages(&request, &entries).unwrap();
        let payload: Value =
            serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(payload["lines"].as_array().unwrap().len(), 60);
        assert_eq!(payload["lines"][0]["index"], 15);
        assert_eq!(payload["lines"][59]["index"], 74);
        assert_eq!(payload["reviewRange"]["startInclusive"], 30);
        assert_eq!(payload["reviewRange"]["endExclusive"], 60);
        assert_eq!(payload["style"], "Keep names");
        assert!(batch_messages(&request, &entries[..60]).is_err());
    }

    #[test]
    fn batch_limits_follow_the_shared_policy() {
        let entries = (0..100)
            .map(|index| LinePair {
                index,
                source: String::new(),
                translation: String::new(),
                source_name: None,
                target_name: None,
            })
            .collect::<Vec<_>>();
        // The latter two keep a 60-line window but overrun one side's context allowance.
        for (core_end, context_start, context_end) in [(61, 15, 75), (60, 14, 74), (60, 16, 76)] {
            let request = BatchRequest {
                request_id: "limit-test".into(),
                document_id: "document".into(),
                core_start: 30,
                core_end,
                context_start,
                context_end,
                requirements: Requirements {
                    style: String::new(),
                    background: String::new(),
                },
            };
            assert!(batch_messages(&request, &entries).is_err());
        }
    }

    #[test]
    fn truncated_and_empty_responses_are_failures_not_no_issues() {
        assert!(extract_content(
            &json!({"choices":[{"finish_reason":"length","message":{"content":"{\"issues\":[]}"}}]})
        )
        .is_err());
        assert!(extract_content(&json!({"choices":[{"message":{"content":null}}]})).is_err());
        assert_eq!(extract_content(&json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"issues\":[]}"}}]})).unwrap(), "{\"issues\":[]}");
    }
}
