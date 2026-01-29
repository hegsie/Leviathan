//! Repository statistics command handlers
//! Commit counts, contributor breakdown, activity timeline

use std::collections::{HashMap, HashSet};
use std::path::Path;
use tauri::command;

use crate::error::Result;

/// Repository statistics overview
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub total_commits: usize,
    pub total_branches: usize,
    pub total_tags: usize,
    pub total_contributors: usize,
    pub first_commit_date: Option<i64>,
    pub latest_commit_date: Option<i64>,
    pub contributors: Vec<ContributorStats>,
    pub activity_by_month: Vec<MonthActivity>,
    pub activity_by_day_of_week: Vec<DayOfWeekActivity>,
    pub activity_by_hour: Vec<HourActivity>,
    pub files_count: usize,
    pub total_lines_added: usize,
    pub total_lines_deleted: usize,
}

/// Comprehensive repository statistics for dashboard
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatistics {
    // Basics
    pub total_commits: u32,
    pub total_branches: u32,
    pub total_tags: u32,
    pub total_contributors: u32,
    pub total_files: u32,
    pub repo_size_bytes: u64,

    // First/Last commits
    pub first_commit_date: Option<i64>,
    pub last_commit_date: Option<i64>,
    pub repo_age_days: u32,

    // Activity breakdown (if include_activity)
    pub activity_by_month: Option<Vec<EnhancedMonthActivity>>,
    pub activity_by_weekday: Option<Vec<WeekdayActivity>>,
    pub activity_by_hour: Option<Vec<EnhancedHourActivity>>,

    // Contributor breakdown (if include_contributors)
    pub top_contributors: Option<Vec<EnhancedContributorStats>>,

    // File type breakdown (if include_file_types)
    pub file_types: Option<Vec<FileTypeStats>>,

    // Code stats
    pub total_lines_added: u64,
    pub total_lines_deleted: u64,
}

/// Enhanced month activity with author count
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedMonthActivity {
    pub year: u32,
    pub month: u32,
    pub commits: u32,
    pub authors: u32,
}

/// Activity by day of week (0=Sunday, 6=Saturday)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekdayActivity {
    pub day: String,
    pub commits: u32,
}

/// Enhanced hour activity
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedHourActivity {
    pub hour: u32,
    pub commits: u32,
}

/// Enhanced contributor stats with detailed info
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedContributorStats {
    pub name: String,
    pub email: String,
    pub commits: u32,
    pub lines_added: u64,
    pub lines_deleted: u64,
    pub first_commit: i64,
    pub last_commit: i64,
}

/// File type statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTypeStats {
    pub extension: String,
    pub file_count: u32,
    pub total_lines: u64,
}

/// Statistics for a single contributor
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorStats {
    pub name: String,
    pub email: String,
    pub commit_count: usize,
    pub first_commit: i64,
    pub latest_commit: i64,
    pub lines_added: usize,
    pub lines_deleted: usize,
}

/// Activity for a month
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthActivity {
    pub year: i32,
    pub month: u32,
    pub commit_count: usize,
}

/// Activity by day of week
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayOfWeekActivity {
    pub day: String,
    pub day_index: u32,
    pub commit_count: usize,
}

/// Activity by hour of day
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourActivity {
    pub hour: u32,
    pub commit_count: usize,
}

/// Get comprehensive repository statistics
#[command]
pub async fn get_repo_stats(path: String, max_commits: Option<usize>) -> Result<RepoStats> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let max = max_commits.unwrap_or(10000);

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    // Try to include all branches
    for (branch, _) in (repo.branches(Some(git2::BranchType::Local))?).flatten() {
        if let Some(oid) = branch.get().target() {
            let _ = revwalk.push(oid);
        }
    }

    let mut total_commits = 0;
    let mut first_commit_date: Option<i64> = None;
    let mut latest_commit_date: Option<i64> = None;
    let mut contributors_map: HashMap<String, ContributorStats> = HashMap::new();
    let mut month_activity: HashMap<(i32, u32), usize> = HashMap::new();
    let mut dow_activity: [usize; 7] = [0; 7];
    let mut hour_activity: [usize; 24] = [0; 24];

    for oid_result in revwalk {
        if total_commits >= max {
            break;
        }

        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        total_commits += 1;

        let time_secs = commit.time().seconds();
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let author_email = author.email().unwrap_or("unknown").to_string();

        // Track first and latest commit
        match first_commit_date {
            None => first_commit_date = Some(time_secs),
            Some(first) if time_secs < first => first_commit_date = Some(time_secs),
            _ => {}
        }
        match latest_commit_date {
            None => latest_commit_date = Some(time_secs),
            Some(latest) if time_secs > latest => latest_commit_date = Some(time_secs),
            _ => {}
        }

        // Contributor stats
        let key = author_email.clone();
        let entry = contributors_map.entry(key).or_insert(ContributorStats {
            name: author_name.clone(),
            email: author_email.clone(),
            commit_count: 0,
            first_commit: time_secs,
            latest_commit: time_secs,
            lines_added: 0,
            lines_deleted: 0,
        });
        entry.commit_count += 1;
        if time_secs < entry.first_commit {
            entry.first_commit = time_secs;
        }
        if time_secs > entry.latest_commit {
            entry.latest_commit = time_secs;
        }

        // Time-based activity (approximate from epoch seconds)
        // Simple date calculation from unix timestamp
        let days_since_epoch = time_secs / 86400;
        // Day of week: Jan 1 1970 was Thursday (4)
        let dow = ((days_since_epoch % 7) + 4) % 7;
        dow_activity[dow as usize] += 1;

        // Hour of day (UTC)
        let hour = ((time_secs % 86400) / 3600) as usize;
        if hour < 24 {
            hour_activity[hour] += 1;
        }

        // Year and month (approximate)
        // More accurate calculation
        let (year, month) = epoch_to_year_month(time_secs);
        *month_activity.entry((year, month)).or_insert(0) += 1;
    }

    // Count branches and tags
    let total_branches = repo.branches(None)?.filter_map(|b| b.ok()).count();

    let total_tags = repo.tag_names(None)?.iter().flatten().count();

    // Count files in HEAD
    let files_count = if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            let mut count = 0;
            tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
                if entry.kind() == Some(git2::ObjectType::Blob) {
                    count += 1;
                }
                git2::TreeWalkResult::Ok
            })
            .unwrap_or(());
            count
        } else {
            0
        }
    } else {
        0
    };

    // Sort contributors by commit count
    let mut contributors: Vec<ContributorStats> = contributors_map.into_values().collect();
    contributors.sort_by(|a, b| b.commit_count.cmp(&a.commit_count));

    // Sort month activity
    let mut activity_by_month: Vec<MonthActivity> = month_activity
        .into_iter()
        .map(|((year, month), count)| MonthActivity {
            year,
            month,
            commit_count: count,
        })
        .collect();
    activity_by_month.sort_by(|a, b| a.year.cmp(&b.year).then(a.month.cmp(&b.month)));

    let day_names = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    let activity_by_day_of_week: Vec<DayOfWeekActivity> = dow_activity
        .iter()
        .enumerate()
        .map(|(i, &count)| DayOfWeekActivity {
            day: day_names[i].to_string(),
            day_index: i as u32,
            commit_count: count,
        })
        .collect();

    let activity_by_hour: Vec<HourActivity> = hour_activity
        .iter()
        .enumerate()
        .map(|(i, &count)| HourActivity {
            hour: i as u32,
            commit_count: count,
        })
        .collect();

    Ok(RepoStats {
        total_commits,
        total_branches,
        total_tags,
        total_contributors: contributors.len(),
        first_commit_date,
        latest_commit_date,
        contributors,
        activity_by_month,
        activity_by_day_of_week,
        activity_by_hour,
        files_count,
        total_lines_added: 0, // Skip for performance
        total_lines_deleted: 0,
    })
}

/// Get contributor statistics with diff stats (slower, separate command)
#[command]
pub async fn get_contributor_stats(
    path: String,
    max_commits: Option<usize>,
) -> Result<Vec<ContributorStats>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let max = max_commits.unwrap_or(5000);

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut contributors_map: HashMap<String, ContributorStats> = HashMap::new();

    for (count, oid_result) in revwalk.enumerate() {
        if count >= max {
            break;
        }

        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let time_secs = commit.time().seconds();
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let author_email = author.email().unwrap_or("unknown").to_string();

        // Get diff stats for this commit
        let (added, deleted) = if commit.parent_count() > 0 {
            if let Ok(parent) = commit.parent(0) {
                if let (Ok(parent_tree), Ok(commit_tree)) = (parent.tree(), commit.tree()) {
                    if let Ok(diff) =
                        repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)
                    {
                        if let Ok(stats) = diff.stats() {
                            (stats.insertions(), stats.deletions())
                        } else {
                            (0, 0)
                        }
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        let key = author_email.clone();
        let entry = contributors_map.entry(key).or_insert(ContributorStats {
            name: author_name,
            email: author_email,
            commit_count: 0,
            first_commit: time_secs,
            latest_commit: time_secs,
            lines_added: 0,
            lines_deleted: 0,
        });
        entry.commit_count += 1;
        entry.lines_added += added;
        entry.lines_deleted += deleted;
        if time_secs < entry.first_commit {
            entry.first_commit = time_secs;
        }
        if time_secs > entry.latest_commit {
            entry.latest_commit = time_secs;
        }
    }

    let mut contributors: Vec<ContributorStats> = contributors_map.into_values().collect();
    contributors.sort_by(|a, b| b.commit_count.cmp(&a.commit_count));

    Ok(contributors)
}

/// Simple epoch to year/month conversion
fn epoch_to_year_month(epoch: i64) -> (i32, u32) {
    // Approximate calculation
    let days = epoch / 86400;
    let mut year = 1970i32;
    let mut remaining_days = days;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: &[i64] = if is_leap_year(year) {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1u32;
    for &dim in days_in_months {
        if remaining_days < dim {
            break;
        }
        remaining_days -= dim;
        month += 1;
    }

    (year, month)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Parse ISO 8601 date string to epoch seconds
fn parse_iso8601_to_epoch(date_str: &str) -> Option<i64> {
    // Simple parsing for common ISO 8601 formats:
    // YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM:SSZ
    let date_part = date_str.split('T').next()?;
    let parts: Vec<&str> = date_part.split('-').collect();
    if parts.len() < 3 {
        return None;
    }

    let year: i32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Calculate days from epoch (1970-01-01)
    let mut days: i64 = 0;

    // Add days for years
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }

    // Add days for months
    let days_in_months: &[i64] = if is_leap_year(year) {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    for dim in days_in_months.iter().take((month - 1) as usize) {
        days += dim;
    }

    days += (day - 1) as i64;

    Some(days * 86400)
}

/// Count lines in a blob (for file type stats)
fn count_blob_lines(repo: &git2::Repository, oid: git2::Oid) -> u64 {
    if let Ok(blob) = repo.find_blob(oid) {
        if blob.is_binary() {
            return 0;
        }
        if let Ok(content) = std::str::from_utf8(blob.content()) {
            return content.lines().count() as u64;
        }
    }
    0
}

/// Get comprehensive repository statistics
#[command]
pub async fn get_repo_statistics(
    path: String,
    include_activity: bool,
    include_contributors: bool,
    include_file_types: bool,
    since: Option<String>,
    until: Option<String>,
) -> Result<RepoStatistics> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Parse date filters
    let since_epoch = since.as_ref().and_then(|s| parse_iso8601_to_epoch(s));
    let until_epoch = until.as_ref().and_then(|s| parse_iso8601_to_epoch(s));

    // Walk commits
    let mut revwalk = repo.revwalk()?;
    if repo.head().is_ok() {
        revwalk.push_head()?;
    }
    revwalk.set_sorting(git2::Sort::TIME)?;

    // Try to include all branches
    for (branch, _) in (repo.branches(Some(git2::BranchType::Local))?).flatten() {
        if let Some(oid) = branch.get().target() {
            let _ = revwalk.push(oid);
        }
    }

    let mut total_commits: u32 = 0;
    let mut first_commit_date: Option<i64> = None;
    let mut last_commit_date: Option<i64> = None;
    let mut total_lines_added: u64 = 0;
    let mut total_lines_deleted: u64 = 0;

    // For contributors
    let mut contributors_map: HashMap<String, EnhancedContributorStats> = HashMap::new();

    // For activity breakdown
    let mut month_activity: HashMap<(u32, u32), (u32, HashSet<String>)> = HashMap::new();
    let mut weekday_activity: [u32; 7] = [0; 7];
    let mut hour_activity: [u32; 24] = [0; 24];

    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let time_secs = commit.time().seconds();

        // Apply date filters
        if let Some(since) = since_epoch {
            if time_secs < since {
                continue;
            }
        }
        if let Some(until) = until_epoch {
            if time_secs > until {
                continue;
            }
        }

        total_commits += 1;

        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let author_email = author.email().unwrap_or("unknown").to_string();

        // Track first and last commit
        match first_commit_date {
            None => first_commit_date = Some(time_secs),
            Some(first) if time_secs < first => first_commit_date = Some(time_secs),
            _ => {}
        }
        match last_commit_date {
            None => last_commit_date = Some(time_secs),
            Some(last) if time_secs > last => last_commit_date = Some(time_secs),
            _ => {}
        }

        // Get diff stats (lines added/deleted)
        let (added, deleted) = if include_contributors && commit.parent_count() > 0 {
            if let Ok(parent) = commit.parent(0) {
                if let (Ok(parent_tree), Ok(commit_tree)) = (parent.tree(), commit.tree()) {
                    if let Ok(diff) =
                        repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)
                    {
                        if let Ok(stats) = diff.stats() {
                            (stats.insertions() as u64, stats.deletions() as u64)
                        } else {
                            (0, 0)
                        }
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        total_lines_added += added;
        total_lines_deleted += deleted;

        // Contributor stats
        if include_contributors {
            let key = author_email.clone();
            let entry = contributors_map
                .entry(key)
                .or_insert(EnhancedContributorStats {
                    name: author_name.clone(),
                    email: author_email.clone(),
                    commits: 0,
                    lines_added: 0,
                    lines_deleted: 0,
                    first_commit: time_secs,
                    last_commit: time_secs,
                });
            entry.commits += 1;
            entry.lines_added += added;
            entry.lines_deleted += deleted;
            if time_secs < entry.first_commit {
                entry.first_commit = time_secs;
            }
            if time_secs > entry.last_commit {
                entry.last_commit = time_secs;
            }
        }

        // Activity breakdown
        if include_activity {
            // Year/month activity
            let (year, month) = epoch_to_year_month(time_secs);
            let entry = month_activity
                .entry((year as u32, month))
                .or_insert((0, HashSet::new()));
            entry.0 += 1;
            entry.1.insert(author_email.clone());

            // Day of week (0=Sunday)
            let days_since_epoch = time_secs / 86400;
            let dow = ((days_since_epoch % 7) + 4) % 7; // Jan 1, 1970 was Thursday (4)
            weekday_activity[dow as usize] += 1;

            // Hour of day (UTC)
            let hour = ((time_secs % 86400) / 3600) as usize;
            if hour < 24 {
                hour_activity[hour] += 1;
            }
        }
    }

    // Count branches and tags
    let total_branches = repo.branches(None)?.filter_map(|b| b.ok()).count() as u32;
    let total_tags = repo.tag_names(None)?.iter().flatten().count() as u32;

    // Count files and get file type breakdown
    let mut total_files: u32 = 0;
    let mut file_types_map: HashMap<String, (u32, u64)> = HashMap::new();

    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
                if entry.kind() == Some(git2::ObjectType::Blob) {
                    total_files += 1;

                    if include_file_types {
                        let name = entry.name().unwrap_or("");
                        let ext = if let Some(pos) = name.rfind('.') {
                            name[pos..].to_lowercase()
                        } else {
                            "(no extension)".to_string()
                        };

                        let lines = if let Some(oid) = entry.id().into() {
                            count_blob_lines(&repo, oid)
                        } else {
                            0
                        };

                        let stat = file_types_map.entry(ext).or_insert((0, 0));
                        stat.0 += 1;
                        stat.1 += lines;
                    }
                }
                git2::TreeWalkResult::Ok
            })
            .unwrap_or(());
        }
    }

    // Calculate repo size (sum of file sizes in HEAD)
    let mut repo_size_bytes: u64 = 0;
    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
                if entry.kind() == Some(git2::ObjectType::Blob) {
                    if let Ok(blob) = repo.find_blob(entry.id()) {
                        repo_size_bytes += blob.size() as u64;
                    }
                }
                git2::TreeWalkResult::Ok
            })
            .unwrap_or(());
        }
    }

    // Calculate repo age in days
    let repo_age_days = if let (Some(first), Some(last)) = (first_commit_date, last_commit_date) {
        ((last - first) / 86400) as u32
    } else {
        0
    };

    // Build activity breakdown
    let activity_by_month = if include_activity {
        let mut activity: Vec<EnhancedMonthActivity> = month_activity
            .into_iter()
            .map(
                |((year, month), (commits, authors))| EnhancedMonthActivity {
                    year,
                    month,
                    commits,
                    authors: authors.len() as u32,
                },
            )
            .collect();
        activity.sort_by(|a, b| a.year.cmp(&b.year).then(a.month.cmp(&b.month)));
        Some(activity)
    } else {
        None
    };

    let activity_by_weekday = if include_activity {
        let day_names = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ];
        Some(
            weekday_activity
                .iter()
                .enumerate()
                .map(|(i, &commits)| WeekdayActivity {
                    day: day_names[i].to_string(),
                    commits,
                })
                .collect(),
        )
    } else {
        None
    };

    let activity_by_hour = if include_activity {
        Some(
            hour_activity
                .iter()
                .enumerate()
                .map(|(i, &commits)| EnhancedHourActivity {
                    hour: i as u32,
                    commits,
                })
                .collect(),
        )
    } else {
        None
    };

    // Build contributors list
    let top_contributors = if include_contributors {
        let mut contributors: Vec<EnhancedContributorStats> =
            contributors_map.into_values().collect();
        contributors.sort_by(|a, b| b.commits.cmp(&a.commits));
        Some(contributors)
    } else {
        None
    };

    // Build file types list
    let file_types = if include_file_types {
        let mut types: Vec<FileTypeStats> = file_types_map
            .into_iter()
            .map(|(ext, (count, lines))| FileTypeStats {
                extension: ext,
                file_count: count,
                total_lines: lines,
            })
            .collect();
        types.sort_by(|a, b| b.file_count.cmp(&a.file_count));
        Some(types)
    } else {
        None
    };

    let total_contributors = if let Some(ref contribs) = top_contributors {
        contribs.len() as u32
    } else {
        // Count unique contributors
        let mut unique_authors: HashSet<String> = HashSet::new();
        let mut revwalk = repo.revwalk()?;
        if repo.head().is_ok() {
            revwalk.push_head()?;
        }
        for oid_result in revwalk.flatten() {
            if let Ok(commit) = repo.find_commit(oid_result) {
                let time_secs = commit.time().seconds();
                // Apply date filters
                if let Some(since) = since_epoch {
                    if time_secs < since {
                        continue;
                    }
                }
                if let Some(until) = until_epoch {
                    if time_secs > until {
                        continue;
                    }
                }
                if let Some(email) = commit.author().email() {
                    unique_authors.insert(email.to_string());
                }
            }
        }
        unique_authors.len() as u32
    };

    Ok(RepoStatistics {
        total_commits,
        total_branches,
        total_tags,
        total_contributors,
        total_files,
        repo_size_bytes,
        first_commit_date,
        last_commit_date,
        repo_age_days,
        activity_by_month,
        activity_by_weekday,
        activity_by_hour,
        top_contributors,
        file_types,
        total_lines_added,
        total_lines_deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_repo_stats_empty() {
        let repo = TestRepo::new();
        let result = get_repo_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.total_commits, 0);
    }

    #[tokio::test]
    async fn test_get_repo_stats_with_commits() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        let result = get_repo_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.total_commits, 3);
        assert_eq!(stats.total_contributors, 1);
        assert_eq!(stats.contributors[0].name, "Test User");
        assert!(stats.first_commit_date.is_some());
        assert!(stats.latest_commit_date.is_some());
    }

    #[tokio::test]
    async fn test_get_repo_stats_branches_and_tags() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature-1");
        repo.create_branch("feature-2");
        repo.create_tag("v1.0");

        let result = get_repo_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert!(stats.total_branches >= 3); // main + 2 features
        assert_eq!(stats.total_tags, 1);
    }

    #[tokio::test]
    async fn test_get_repo_stats_max_commits() {
        let repo = TestRepo::with_initial_commit();
        for i in 0..10 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(format!("file{}.txt", i).as_str(), "content")],
            );
        }

        let result = get_repo_stats(repo.path_str(), Some(5)).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.total_commits, 5);
    }

    #[tokio::test]
    async fn test_get_repo_stats_activity() {
        let repo = TestRepo::with_initial_commit();

        let result = get_repo_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        // Activity by day of week should have 7 entries
        assert_eq!(stats.activity_by_day_of_week.len(), 7);

        // Activity by hour should have 24 entries
        assert_eq!(stats.activity_by_hour.len(), 24);

        // At least one month should have activity
        assert!(!stats.activity_by_month.is_empty());
    }

    #[tokio::test]
    async fn test_get_contributor_stats() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("file.txt", "content")]);

        let result = get_contributor_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let contributors = result.unwrap();
        assert_eq!(contributors.len(), 1);
        assert_eq!(contributors[0].name, "Test User");
        assert_eq!(contributors[0].commit_count, 2);
    }

    #[tokio::test]
    async fn test_get_repo_stats_files_count() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit(
            "Add files",
            &[("src/a.rs", "fn a() {}"), ("src/b.rs", "fn b() {}")],
        );

        let result = get_repo_stats(repo.path_str(), None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert!(stats.files_count >= 3); // README + src/a.rs + src/b.rs
    }

    #[test]
    fn test_epoch_to_year_month() {
        // Jan 1, 2020 00:00:00 UTC
        let (year, month) = epoch_to_year_month(1577836800);
        assert_eq!(year, 2020);
        assert_eq!(month, 1);

        // Dec 31, 2023 23:59:59 UTC
        let (year, month) = epoch_to_year_month(1704067199);
        assert_eq!(year, 2023);
        assert_eq!(month, 12);
    }

    // Tests for get_repo_statistics
    #[tokio::test]
    async fn test_get_repo_statistics_empty() {
        let repo = TestRepo::new();
        let result = get_repo_statistics(repo.path_str(), false, false, false, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.total_commits, 0);
        assert_eq!(stats.total_files, 0);
        assert!(stats.activity_by_month.is_none());
        assert!(stats.top_contributors.is_none());
        assert!(stats.file_types.is_none());
    }

    #[tokio::test]
    async fn test_get_repo_statistics_basic() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        let result = get_repo_statistics(repo.path_str(), false, false, false, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.total_commits, 3);
        assert!(stats.total_files >= 3);
        assert!(stats.first_commit_date.is_some());
        assert!(stats.last_commit_date.is_some());
    }

    #[tokio::test]
    async fn test_get_repo_statistics_with_activity() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("file.txt", "content")]);

        let result = get_repo_statistics(repo.path_str(), true, false, false, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        // Activity should be included
        assert!(stats.activity_by_month.is_some());
        assert!(stats.activity_by_weekday.is_some());
        assert!(stats.activity_by_hour.is_some());

        let weekday = stats.activity_by_weekday.unwrap();
        assert_eq!(weekday.len(), 7);

        let hour = stats.activity_by_hour.unwrap();
        assert_eq!(hour.len(), 24);

        // Month activity should include author count
        let months = stats.activity_by_month.unwrap();
        assert!(!months.is_empty());
        assert!(months[0].authors >= 1);
    }

    #[tokio::test]
    async fn test_get_repo_statistics_with_contributors() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("file.txt", "content\nline2\nline3")]);

        let result = get_repo_statistics(repo.path_str(), false, true, false, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        assert!(stats.top_contributors.is_some());
        let contributors = stats.top_contributors.unwrap();
        assert_eq!(contributors.len(), 1);
        assert_eq!(contributors[0].name, "Test User");
        assert_eq!(contributors[0].commits, 2);
    }

    #[tokio::test]
    async fn test_get_repo_statistics_with_file_types() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit(
            "Add files",
            &[
                ("src/main.rs", "fn main() {}"),
                ("src/lib.rs", "pub fn lib() {}"),
                ("data.json", "{\"key\": \"value\"}"),
            ],
        );

        let result = get_repo_statistics(repo.path_str(), false, false, true, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        assert!(stats.file_types.is_some());
        let file_types = stats.file_types.unwrap();
        assert!(!file_types.is_empty());

        // Should have .rs and .json and .md extensions
        let extensions: Vec<&str> = file_types.iter().map(|f| f.extension.as_str()).collect();
        assert!(extensions.contains(&".rs"));
        assert!(extensions.contains(&".json"));
        assert!(extensions.contains(&".md"));
    }

    #[tokio::test]
    async fn test_get_repo_statistics_all_options() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add code", &[("app.js", "console.log('hello');")]);
        repo.create_branch("feature");
        repo.create_tag("v1.0");

        let result = get_repo_statistics(repo.path_str(), true, true, true, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        // All sections should be present
        assert!(stats.activity_by_month.is_some());
        assert!(stats.top_contributors.is_some());
        assert!(stats.file_types.is_some());

        // Check counts
        assert_eq!(stats.total_commits, 2);
        assert!(stats.total_branches >= 2); // main + feature
        assert_eq!(stats.total_tags, 1);
        assert!(stats.repo_size_bytes > 0);
    }

    #[test]
    fn test_parse_iso8601_to_epoch() {
        // Test basic date parsing
        let epoch = parse_iso8601_to_epoch("2020-01-01");
        assert!(epoch.is_some());
        // Jan 1, 2020 should be around 1577836800
        let val = epoch.unwrap();
        assert!(val >= 1577836800 && val < 1577923200);

        // Test date with time
        let epoch2 = parse_iso8601_to_epoch("2023-06-15T12:00:00Z");
        assert!(epoch2.is_some());

        // Test invalid date
        let invalid = parse_iso8601_to_epoch("invalid");
        assert!(invalid.is_none());
    }

    #[tokio::test]
    async fn test_get_repo_statistics_repo_age() {
        let repo = TestRepo::with_initial_commit();
        // Create a second commit (same day, so age should be 0)
        repo.create_commit("Second", &[("file.txt", "content")]);

        let result = get_repo_statistics(repo.path_str(), false, false, false, None, None).await;
        assert!(result.is_ok());
        let stats = result.unwrap();

        // Repo age should be 0 for same-day commits
        assert_eq!(stats.repo_age_days, 0);
    }
}
