use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPolicy {
    pub batch_size: usize,
    pub context_before: usize,
    pub context_after: usize,
}

impl ReviewPolicy {
    pub fn window_size(&self) -> usize {
        self.context_before + self.batch_size + self.context_after
    }
}

pub fn review_policy() -> &'static ReviewPolicy {
    static POLICY: OnceLock<ReviewPolicy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/review-policy.json"))
            .expect("shared/review-policy.json must contain a valid review policy")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_policy_preserves_the_agreed_window() {
        let policy = review_policy();
        assert_eq!(policy.batch_size, 30);
        assert_eq!(policy.context_before, 15);
        assert_eq!(policy.context_after, 15);
        assert_eq!(policy.window_size(), 60);
    }
}
