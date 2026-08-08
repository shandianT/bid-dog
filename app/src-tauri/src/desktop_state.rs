use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobLifecycle {
    Quiet,
    Running,
    NeedsAttention,
    Done,
    Failed,
}

#[derive(Clone, Debug, Deserialize)]
pub struct JobSnapshot {
    pub job_id: String,
    #[serde(default)]
    pub pct: Option<u64>,
    #[serde(default)]
    pub presentation_state: String,
}

impl JobSnapshot {
    pub fn lifecycle(&self) -> JobLifecycle {
        match self.presentation_state.as_str() {
            "preparing" => JobLifecycle::Quiet,
            "generating" => JobLifecycle::Running,
            "needs_input" => JobLifecycle::NeedsAttention,
            "completed" => JobLifecycle::Done,
            "incomplete" => JobLifecycle::Failed,
            // A new server value must fail visible instead of silently looking healthy.
            _ => JobLifecycle::Failed,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationKind {
    NeedsAttention,
    Done,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobNotification {
    pub job_id: String,
    pub kind: NotificationKind,
}

#[derive(Default)]
pub struct NotificationTracker {
    initialized: bool,
    previous: HashMap<String, JobLifecycle>,
}

impl NotificationTracker {
    pub fn observe(&mut self, jobs: &[JobSnapshot]) -> Vec<JobNotification> {
        let current: HashMap<String, JobLifecycle> = jobs
            .iter()
            .map(|job| (job.job_id.clone(), job.lifecycle()))
            .collect();
        let mut notifications = Vec::new();

        if self.initialized {
            for job in jobs {
                let lifecycle = job.lifecycle();
                if self.previous.get(&job.job_id).copied() == Some(lifecycle) {
                    continue;
                }
                let kind = match lifecycle {
                    JobLifecycle::NeedsAttention => Some(NotificationKind::NeedsAttention),
                    JobLifecycle::Done => Some(NotificationKind::Done),
                    JobLifecycle::Failed => Some(NotificationKind::Failed),
                    JobLifecycle::Quiet | JobLifecycle::Running => None,
                };
                if let Some(kind) = kind {
                    notifications.push(JobNotification {
                        job_id: job.job_id.clone(),
                        kind,
                    });
                }
            }
        }

        self.previous = current;
        self.initialized = true;
        notifications
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProgressKind {
    None,
    Normal,
    Paused,
    Indeterminate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProgressSummary {
    pub kind: ProgressKind,
    pub percent: Option<u64>,
    pub active_jobs: usize,
}

pub fn aggregate_progress(jobs: &[JobSnapshot]) -> ProgressSummary {
    let active: Vec<&JobSnapshot> = jobs
        .iter()
        .filter(|job| {
            matches!(
                job.lifecycle(),
                JobLifecycle::Running | JobLifecycle::NeedsAttention
            )
        })
        .collect();
    if active.is_empty() {
        return ProgressSummary {
            kind: ProgressKind::None,
            percent: None,
            active_jobs: 0,
        };
    }

    let needs_attention = active
        .iter()
        .any(|job| job.lifecycle() == JobLifecycle::NeedsAttention);
    let percentages: Vec<u64> = active
        .iter()
        .filter_map(|job| job.pct.map(|pct| pct.min(100)))
        .collect();
    let percent = if percentages.is_empty() {
        None
    } else {
        Some(percentages.iter().sum::<u64>() / percentages.len() as u64)
    };
    let kind = if needs_attention {
        ProgressKind::Paused
    } else if percent.is_some() {
        ProgressKind::Normal
    } else {
        ProgressKind::Indeterminate
    };
    ProgressSummary {
        kind,
        percent,
        active_jobs: active.len(),
    }
}

pub fn should_send_shutdown(is_primary: bool, explicit_quit: bool, already_sent: bool) -> bool {
    is_primary && explicit_quit && !already_sent
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseAction {
    HideToTray,
    Exit,
}

pub fn close_action(jobs_known: bool, active_jobs: usize) -> CloseAction {
    if jobs_known && active_jobs == 0 {
        CloseAction::Exit
    } else {
        CloseAction::HideToTray
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, presentation: &str, pct: Option<u64>) -> JobSnapshot {
        JobSnapshot {
            job_id: id.into(),
            pct,
            presentation_state: presentation.into(),
        }
    }

    #[test]
    fn presentation_states_map_to_user_meaning() {
        assert_eq!(
            job("a", "preparing", Some(0)).lifecycle(),
            JobLifecycle::Quiet
        );
        assert_eq!(
            job("a", "generating", Some(20)).lifecycle(),
            JobLifecycle::Running
        );
        assert_eq!(
            job("a", "needs_input", Some(20)).lifecycle(),
            JobLifecycle::NeedsAttention
        );
        assert_eq!(
            job("a", "completed", Some(100)).lifecycle(),
            JobLifecycle::Done
        );
        assert_eq!(
            job("a", "incomplete", Some(70)).lifecycle(),
            JobLifecycle::Failed
        );
        assert_eq!(
            job("a", "future_value", None).lifecycle(),
            JobLifecycle::Failed
        );
    }

    #[test]
    fn initial_poll_seeds_state_without_spamming_old_jobs() {
        let mut tracker = NotificationTracker::default();
        let notices = tracker.observe(&[
            job("done-before-launch", "completed", Some(100)),
            job("waiting-before-launch", "needs_input", Some(50)),
        ]);
        assert!(notices.is_empty());
    }

    #[test]
    fn each_meaningful_transition_notifies_once() {
        let mut tracker = NotificationTracker::default();
        tracker.observe(&[job("a", "generating", Some(10))]);

        assert_eq!(
            tracker.observe(&[job("a", "needs_input", Some(20))]),
            vec![JobNotification {
                job_id: "a".into(),
                kind: NotificationKind::NeedsAttention
            }]
        );
        assert!(tracker
            .observe(&[job("a", "needs_input", Some(20))])
            .is_empty());
        assert!(tracker
            .observe(&[job("a", "generating", Some(30))])
            .is_empty());
        assert_eq!(
            tracker.observe(&[job("a", "needs_input", Some(40))]),
            vec![JobNotification {
                job_id: "a".into(),
                kind: NotificationKind::NeedsAttention
            }]
        );
        assert_eq!(
            tracker.observe(&[job("a", "completed", Some(100))]),
            vec![JobNotification {
                job_id: "a".into(),
                kind: NotificationKind::Done
            }]
        );
        assert!(tracker
            .observe(&[job("a", "completed", Some(100))])
            .is_empty());
    }

    #[test]
    fn jobs_that_finish_between_polls_are_not_lost() {
        let mut tracker = NotificationTracker::default();
        tracker.observe(&[job("existing", "generating", Some(10))]);
        assert_eq!(
            tracker.observe(&[
                job("existing", "generating", Some(20)),
                job("short-lived", "completed", Some(100)),
            ]),
            vec![JobNotification {
                job_id: "short-lived".into(),
                kind: NotificationKind::Done
            }]
        );
    }

    #[test]
    fn failed_transition_notifies_once() {
        let mut tracker = NotificationTracker::default();
        tracker.observe(&[job("a", "generating", Some(80))]);
        assert_eq!(
            tracker.observe(&[job("a", "incomplete", Some(80))]),
            vec![JobNotification {
                job_id: "a".into(),
                kind: NotificationKind::Failed
            }]
        );
        assert!(tracker
            .observe(&[job("a", "incomplete", Some(80))])
            .is_empty());
    }

    #[test]
    fn progress_aggregates_only_active_jobs_and_pauses_for_attention() {
        assert_eq!(
            aggregate_progress(&[
                job("a", "generating", Some(20)),
                job("b", "generating", Some(60)),
                job("old", "completed", Some(100)),
            ]),
            ProgressSummary {
                kind: ProgressKind::Normal,
                percent: Some(40),
                active_jobs: 2
            }
        );
        assert_eq!(
            aggregate_progress(&[
                job("a", "generating", Some(20)),
                job("b", "needs_input", Some(60)),
            ]),
            ProgressSummary {
                kind: ProgressKind::Paused,
                percent: Some(40),
                active_jobs: 2
            }
        );
        assert_eq!(
            aggregate_progress(&[job("a", "generating", None)]),
            ProgressSummary {
                kind: ProgressKind::Indeterminate,
                percent: None,
                active_jobs: 1
            }
        );
        assert_eq!(
            aggregate_progress(&[job("old", "completed", Some(100))]),
            ProgressSummary {
                kind: ProgressKind::None,
                percent: None,
                active_jobs: 0
            }
        );
    }

    #[test]
    fn engine_shutdown_requires_primary_explicit_once_only() {
        assert!(
            !should_send_shutdown(false, true, false),
            "a second instance must never stop the primary engine"
        );
        assert!(
            !should_send_shutdown(true, false, false),
            "closing or crashing is not an explicit quit"
        );
        assert!(should_send_shutdown(true, true, false));
        assert!(
            !should_send_shutdown(true, true, true),
            "repeated exit events must be harmless"
        );
    }

    #[test]
    fn close_hides_for_active_or_unknown_work_but_exits_when_known_idle() {
        assert_eq!(close_action(false, 0), CloseAction::HideToTray);
        assert_eq!(close_action(false, 2), CloseAction::HideToTray);
        assert_eq!(close_action(true, 1), CloseAction::HideToTray);
        assert_eq!(close_action(true, 0), CloseAction::Exit);
    }
}
