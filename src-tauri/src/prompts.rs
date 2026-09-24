use crate::documents::LinePair;
use serde::Deserialize;
use serde_json::{json, Value};
use std::ops::Range;

#[derive(Deserialize)]
pub struct Requirements {
    pub style: String,
    pub background: String,
}

const SYSTEM_PROMPT: &str = include_str!("prompts/review.md");

/// Compose a validated review window without interpreting the user's language guidance.
pub fn review_messages(
    requirements: &Requirements,
    range: Range<usize>,
    lines: &[LinePair],
) -> Value {
    let user = json!({
        "style": requirements.style,
        "background": requirements.background,
        "reviewRange": {"startInclusive": range.start, "endExclusive": range.end},
        "lines": lines,
    });
    json!([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user.to_string()}
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_language_guidance_outside_the_former_language_options() {
        let requirements: Requirements = serde_json::from_value(json!({
            "style": "原文为日语，译文为法语；保留敬语关系。",
            "background": "两人是初次见面的同事。"
        }))
        .unwrap();
        let lines = vec![LinePair {
            index: 30,
            source: "はじめまして。\\n{name}".into(),
            translation: "Enchanté.\\n{name}".into(),
            source_name: Some("田中".into()),
            target_name: Some("Tanaka".into()),
        }];
        let messages = review_messages(&requirements, 30..31, &lines);
        let payload: Value =
            serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(payload["style"], requirements.style);
        assert_eq!(payload["background"], requirements.background);
        assert_eq!(payload["lines"], serde_json::to_value(&lines).unwrap());
        assert_eq!(
            payload["reviewRange"],
            json!({"startInclusive": 30, "endExclusive": 31})
        );
        assert!(payload.get("targetLanguage").is_none());
    }

    #[test]
    fn legacy_language_metadata_does_not_override_written_requirements() {
        let requirements: Requirements = serde_json::from_value(json!({
            "targetLanguage": "JP", "style": "译文使用法语。", "background": ""
        }))
        .unwrap();
        let messages = review_messages(&requirements, 0..1, &[]);
        let payload: Value =
            serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(payload["style"], "译文使用法语。");
        assert!(payload.get("targetLanguage").is_none());
    }

    #[test]
    fn allows_requirements_without_a_language_direction() {
        let requirements: Requirements =
            serde_json::from_value(json!({"style": "", "background": ""})).unwrap();
        let messages = review_messages(&requirements, 0..1, &[]);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], SYSTEM_PROMPT);
        assert!(SYSTEM_PROMPT.contains("preserve the language of the existing translation"));
    }
}
