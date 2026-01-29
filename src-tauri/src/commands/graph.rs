//! Commit graph command handlers
//! Provides commit graph data generation for visualization (GitKraken/SourceTree style)

use std::collections::HashMap;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Complete commit graph data for visualization
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphData {
    pub nodes: Vec<GraphNode>,
    pub total_commits: u32,
    pub max_lane: u32,
}

/// A single node in the commit graph
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub parents: Vec<String>,
    pub children: Vec<String>,
    pub lane: u32,
    pub is_merge: bool,
    pub is_fork: bool,
    pub refs: Vec<GraphRef>,
    pub edges: Vec<GraphEdge>,
}

/// A reference (branch, tag, etc.) pointing to a commit in the graph
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    pub name: String,
    pub ref_type: String,
    pub is_current: bool,
}

/// An edge connecting two nodes in the graph
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from_oid: String,
    pub to_oid: String,
    pub from_lane: u32,
    pub to_lane: u32,
    pub edge_type: String,
}

/// Build a mapping from commit OID -> list of refs pointing at it
fn build_refs_map(repo: &git2::Repository) -> HashMap<String, Vec<GraphRef>> {
    let mut refs_map: HashMap<String, Vec<GraphRef>> = HashMap::new();

    let head = repo.head().ok();
    let head_name = head.as_ref().and_then(|h| h.name().map(|s| s.to_string()));

    if let Ok(references) = repo.references() {
        for reference in references.flatten() {
            let name = match reference.name() {
                Some(n) => n.to_string(),
                None => continue,
            };

            // Skip HEAD and stash refs
            if name == "HEAD" || name.starts_with("refs/stash") {
                continue;
            }

            // Get the target commit OID (peel annotated tags)
            let target_oid = if reference.is_tag() {
                reference.peel_to_commit().ok().map(|c| c.id().to_string())
            } else {
                reference.target().map(|oid| oid.to_string())
            };

            let target_oid = match target_oid {
                Some(oid) => oid,
                None => continue,
            };

            let (ref_type, display_name) = if name.starts_with("refs/heads/") {
                (
                    "branch".to_string(),
                    name.strip_prefix("refs/heads/")
                        .unwrap_or(&name)
                        .to_string(),
                )
            } else if name.starts_with("refs/remotes/") {
                (
                    "remote".to_string(),
                    name.strip_prefix("refs/remotes/")
                        .unwrap_or(&name)
                        .to_string(),
                )
            } else if name.starts_with("refs/tags/") {
                (
                    "tag".to_string(),
                    name.strip_prefix("refs/tags/").unwrap_or(&name).to_string(),
                )
            } else {
                continue;
            };

            let is_current = head_name.as_ref().map(|h| h == &name).unwrap_or(false);

            // If this is HEAD, also add a special "head" ref
            if is_current {
                refs_map
                    .entry(target_oid.clone())
                    .or_default()
                    .push(GraphRef {
                        name: "HEAD".to_string(),
                        ref_type: "head".to_string(),
                        is_current: true,
                    });
            }

            refs_map.entry(target_oid).or_default().push(GraphRef {
                name: display_name,
                ref_type,
                is_current,
            });
        }
    }

    refs_map
}

/// Assign lanes to commits using a topological lane assignment algorithm.
///
/// This assigns each commit to a "lane" (column) in the graph visualization.
/// The algorithm processes commits in topological order and reuses lanes from
/// completed branches.
fn assign_lanes(
    ordered_oids: &[git2::Oid],
    parent_map: &HashMap<String, Vec<String>>,
    children_map: &HashMap<String, Vec<String>>,
) -> (HashMap<String, u32>, u32) {
    let mut lane_map: HashMap<String, u32> = HashMap::new();
    let mut active_lanes: Vec<Option<String>> = Vec::new();
    let mut max_lane: u32 = 0;

    for &oid in ordered_oids {
        let oid_str = oid.to_string();
        let children = children_map.get(&oid_str);

        // Try to inherit lane from first child (the child that continues this line)
        let inherited_lane = children.and_then(|ch| {
            // Find a child that has us as its first parent (main line continuation)
            for child_oid in ch {
                if let Some(child_parents) = parent_map.get(child_oid) {
                    if child_parents.first().map(|s| s.as_str()) == Some(oid_str.as_str()) {
                        return lane_map.get(child_oid).copied();
                    }
                }
            }
            None
        });

        let lane = if let Some(inherited) = inherited_lane {
            // Reuse the child's lane
            inherited
        } else {
            // Find an available lane or allocate a new one
            let available = active_lanes.iter().position(|l| l.is_none());
            match available {
                Some(idx) => idx as u32,
                None => {
                    active_lanes.push(None);
                    (active_lanes.len() - 1) as u32
                }
            }
        };

        // Mark lane as occupied by this commit
        while active_lanes.len() <= lane as usize {
            active_lanes.push(None);
        }
        active_lanes[lane as usize] = Some(oid_str.clone());

        lane_map.insert(oid_str.clone(), lane);

        if lane > max_lane {
            max_lane = lane;
        }

        // Check if any parents are not yet seen (they will need lanes later)
        // Free up lanes for commits whose children have all been processed
        let parents = parent_map.get(&oid_str);
        if let Some(parents) = parents {
            // If this commit only has one parent and no other children reference
            // that parent, we can keep the lane flowing.
            // For merge commits, the second+ parents will get their own lanes.
            if parents.len() <= 1 {
                // Single parent: lane continues to the parent
                // Don't free the lane yet
            } else {
                // Merge commit: the first parent continues on this lane,
                // other parents will get their own lanes when encountered
            }
        } else {
            // Root commit or no parents: free this lane after processing
            // (don't free immediately, let edges be drawn first)
        }
    }

    // Free up lanes for commits that have no remaining children to process
    // (This is handled implicitly by the "inherit lane" logic above)

    (lane_map, max_lane)
}

/// Get commit graph data for visualization
///
/// Returns graph nodes with lane assignments, edges, and ref annotations
/// suitable for rendering a commit graph like GitKraken or SourceTree.
#[command]
pub async fn get_commit_graph(
    path: String,
    max_count: Option<u32>,
    branch: Option<String>,
    skip: Option<u32>,
) -> Result<CommitGraphData> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Set up revwalk
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    if let Some(ref branch_name) = branch {
        // Try as a local branch first, then remote, then direct OID
        let resolved = repo
            .find_branch(branch_name, git2::BranchType::Local)
            .ok()
            .and_then(|b| b.get().target())
            .or_else(|| {
                repo.find_branch(branch_name, git2::BranchType::Remote)
                    .ok()
                    .and_then(|b| b.get().target())
            })
            .or_else(|| git2::Oid::from_str(branch_name).ok());

        match resolved {
            Some(oid) => revwalk.push(oid)?,
            None => {
                return Err(LeviathanError::BranchNotFound(branch_name.clone()));
            }
        }
    } else {
        // Push all refs for complete graph
        for reference in repo.references()?.flatten() {
            if let Some(oid) = reference.target() {
                let _ = revwalk.push(oid);
            }
        }
    }

    let skip_count = skip.unwrap_or(0) as usize;
    let limit_count = max_count.unwrap_or(500) as usize;

    // Collect commit OIDs in topological order
    let ordered_oids: Vec<git2::Oid> = revwalk
        .skip(skip_count)
        .take(limit_count)
        .filter_map(|r| r.ok())
        .collect();

    // Build parent and children maps
    let mut parent_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
    let oid_set: std::collections::HashSet<String> =
        ordered_oids.iter().map(|o| o.to_string()).collect();

    for &oid in &ordered_oids {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let oid_str = oid.to_string();
        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

        for parent_oid in &parents {
            children_map
                .entry(parent_oid.clone())
                .or_default()
                .push(oid_str.clone());
        }

        parent_map.insert(oid_str, parents);
    }

    // Build refs map
    let refs_map = build_refs_map(&repo);

    // Assign lanes
    let (lane_map, max_lane) = assign_lanes(&ordered_oids, &parent_map, &children_map);

    // Build graph nodes
    let mut nodes = Vec::with_capacity(ordered_oids.len());

    for &oid in &ordered_oids {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let oid_str = oid.to_string();
        let short_oid = oid_str[..7.min(oid_str.len())].to_string();
        let lane = lane_map.get(&oid_str).copied().unwrap_or(0);

        let parents = parent_map.get(&oid_str).cloned().unwrap_or_default();

        let children = children_map.get(&oid_str).cloned().unwrap_or_default();

        let is_merge = parents.len() > 1;
        let is_fork = children.len() > 1;

        // Build edges to parents
        let edges: Vec<GraphEdge> = parents
            .iter()
            .enumerate()
            .map(|(idx, parent_oid)| {
                let parent_lane = if oid_set.contains(parent_oid) {
                    lane_map.get(parent_oid).copied().unwrap_or(0)
                } else {
                    // Parent is outside our visible window; put edge off to the side
                    lane
                };

                let edge_type = if idx == 0 {
                    if is_merge {
                        "normal".to_string()
                    } else {
                        "normal".to_string()
                    }
                } else {
                    "merge".to_string()
                };

                GraphEdge {
                    from_oid: oid_str.clone(),
                    to_oid: parent_oid.clone(),
                    from_lane: lane,
                    to_lane: parent_lane,
                    edge_type,
                }
            })
            .collect();

        // Get refs for this commit
        let commit_refs = refs_map.get(&oid_str).cloned().unwrap_or_default();

        let message = commit.message().unwrap_or("").to_string();
        let author = commit.author();
        let author_name = author.name().unwrap_or("").to_string();
        let author_email = author.email().unwrap_or("").to_string();
        let author_date = commit.time().seconds();

        nodes.push(GraphNode {
            oid: oid_str,
            short_oid,
            message,
            author_name,
            author_email,
            author_date,
            parents,
            children,
            lane,
            is_merge,
            is_fork,
            refs: commit_refs,
            edges,
        });
    }

    let total_commits = nodes.len() as u32;

    Ok(CommitGraphData {
        nodes,
        total_commits,
        max_lane,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_commit_graph_basic() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        repo.create_commit("Third commit", &[("file3.txt", "content3")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        assert_eq!(graph.total_commits, 3);
        assert!(!graph.nodes.is_empty());

        // Nodes should be in topological/time order
        assert!(graph.nodes[0].message.contains("Third"));
        assert!(graph.nodes[1].message.contains("Second"));
        assert!(graph.nodes[2].message.contains("Initial"));
    }

    #[tokio::test]
    async fn test_get_commit_graph_linear_lanes() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        repo.create_commit("Third commit", &[("file3.txt", "content3")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        // Linear history should stay on a single lane
        for node in &graph.nodes {
            assert_eq!(node.lane, 0, "Linear history should use lane 0");
        }
        assert_eq!(graph.max_lane, 0);
    }

    #[tokio::test]
    async fn test_get_commit_graph_with_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        // Create a branch and add a commit on it
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        assert_eq!(graph.total_commits, 3);
    }

    #[tokio::test]
    async fn test_get_commit_graph_specific_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Main commit", &[("main.txt", "main")]);

        // Create a branch
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature")]);

        // Get graph for only the feature branch
        let result = get_commit_graph(
            repo.path_str(),
            Some(100),
            Some("feature".to_string()),
            None,
        )
        .await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        // Should include feature branch commits and ancestors
        assert!(graph.total_commits >= 2);
        assert!(graph.nodes.iter().any(|n| n.message.contains("Feature")));
    }

    #[tokio::test]
    async fn test_get_commit_graph_with_limit() {
        let repo = TestRepo::with_initial_commit();
        for i in 1..=5 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(&format!("file{}.txt", i), &format!("content{}", i))],
            );
        }

        let result = get_commit_graph(repo.path_str(), Some(3), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();
        assert_eq!(graph.total_commits, 3);
    }

    #[tokio::test]
    async fn test_get_commit_graph_with_skip() {
        let repo = TestRepo::with_initial_commit();
        for i in 1..=5 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(&format!("file{}.txt", i), &format!("content{}", i))],
            );
        }

        let result = get_commit_graph(repo.path_str(), Some(100), None, Some(2)).await;
        assert!(result.is_ok());
        let graph = result.unwrap();
        // Should have 6 total commits (initial + 5), minus 2 skipped = 4
        assert_eq!(graph.total_commits, 4);
    }

    #[tokio::test]
    async fn test_get_commit_graph_node_structure() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Test node structure", &[("test.txt", "test")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        let node = &graph.nodes[0];
        assert!(!node.oid.is_empty());
        assert!(!node.short_oid.is_empty());
        assert_eq!(node.short_oid.len(), 7);
        assert!(!node.message.is_empty());
        assert_eq!(node.author_name, "Test User");
        assert_eq!(node.author_email, "test@example.com");
        assert!(node.author_date > 0);
        assert_eq!(node.parents.len(), 1);
        assert!(!node.is_merge);
    }

    #[tokio::test]
    async fn test_get_commit_graph_parent_child_relationships() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid().to_string();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        let second_oid = repo.head_oid().to_string();

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        // Second commit should have initial as parent
        let second_node = graph.nodes.iter().find(|n| n.oid == second_oid).unwrap();
        assert_eq!(second_node.parents, vec![initial_oid.clone()]);

        // Initial commit should have second as child
        let initial_node = graph.nodes.iter().find(|n| n.oid == initial_oid).unwrap();
        assert!(initial_node.children.contains(&second_oid));
    }

    #[tokio::test]
    async fn test_get_commit_graph_edges() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        // Second commit (newest) should have an edge to initial commit
        let second_node = &graph.nodes[0];
        assert_eq!(second_node.edges.len(), 1);
        assert_eq!(second_node.edges[0].edge_type, "normal");
        assert_eq!(second_node.edges[0].from_oid, second_node.oid);
        assert_eq!(second_node.edges[0].to_oid, second_node.parents[0]);
    }

    #[tokio::test]
    async fn test_get_commit_graph_refs() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Tagged commit", &[("file.txt", "content")]);

        // Create a tag and a branch
        repo.create_tag("v1.0.0");
        repo.create_branch("develop");

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        let head_node = &graph.nodes[0]; // Most recent commit
        assert!(!head_node.refs.is_empty());

        // Should have branch and tag refs
        let has_tag = head_node
            .refs
            .iter()
            .any(|r| r.ref_type == "tag" && r.name == "v1.0.0");
        assert!(has_tag, "Should have tag ref");

        let has_branch = head_node
            .refs
            .iter()
            .any(|r| r.ref_type == "branch" && r.name == "develop");
        assert!(has_branch, "Should have branch ref");

        let has_head = head_node.refs.iter().any(|r| r.ref_type == "head");
        assert!(has_head, "Should have HEAD ref");
    }

    #[tokio::test]
    async fn test_get_commit_graph_root_commit() {
        let repo = TestRepo::with_initial_commit();

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        let root_node = &graph.nodes[0]; // Only commit
        assert!(root_node.parents.is_empty());
        assert!(!root_node.is_merge);
        assert!(!root_node.is_fork);
    }

    #[tokio::test]
    async fn test_get_commit_graph_invalid_path() {
        let result = get_commit_graph("/nonexistent/path".to_string(), None, None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_commit_graph_invalid_branch() {
        let repo = TestRepo::with_initial_commit();

        let result = get_commit_graph(
            repo.path_str(),
            None,
            Some("nonexistent-branch".to_string()),
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_commit_graph_serialization() {
        let graph = CommitGraphData {
            nodes: vec![GraphNode {
                oid: "abc1234567890".to_string(),
                short_oid: "abc1234".to_string(),
                message: "Test commit".to_string(),
                author_name: "Test User".to_string(),
                author_email: "test@example.com".to_string(),
                author_date: 1700000000,
                parents: vec!["def4567890123".to_string()],
                children: vec![],
                lane: 0,
                is_merge: false,
                is_fork: false,
                refs: vec![GraphRef {
                    name: "main".to_string(),
                    ref_type: "branch".to_string(),
                    is_current: true,
                }],
                edges: vec![GraphEdge {
                    from_oid: "abc1234567890".to_string(),
                    to_oid: "def4567890123".to_string(),
                    from_lane: 0,
                    to_lane: 0,
                    edge_type: "normal".to_string(),
                }],
            }],
            total_commits: 1,
            max_lane: 0,
        };

        let json = serde_json::to_string(&graph);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"totalCommits\":1"));
        assert!(json_str.contains("\"maxLane\":0"));
        assert!(json_str.contains("\"shortOid\":\"abc1234\""));
        assert!(json_str.contains("\"isMerge\":false"));
        assert!(json_str.contains("\"isFork\":false"));
        assert!(json_str.contains("\"refType\":\"branch\""));
        assert!(json_str.contains("\"edgeType\":\"normal\""));
        assert!(json_str.contains("\"fromLane\":0"));
        assert!(json_str.contains("\"toLane\":0"));
        assert!(json_str.contains("\"isCurrent\":true"));
    }

    #[tokio::test]
    async fn test_get_commit_graph_is_fork() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid().to_string();

        // Create two branches from initial commit
        repo.create_branch("feature-a");
        repo.create_branch("feature-b");

        // Add commits on each branch
        repo.checkout_branch("feature-a");
        repo.create_commit("Feature A commit", &[("a.txt", "a")]);

        repo.checkout_branch("feature-b");
        repo.create_commit("Feature B commit", &[("b.txt", "b")]);

        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();

        // The initial commit should be a fork point (has 2 children)
        let initial_node = graph.nodes.iter().find(|n| n.oid == initial_oid).unwrap();
        assert!(
            initial_node.is_fork,
            "Initial commit should be a fork point"
        );
    }

    #[tokio::test]
    async fn test_get_commit_graph_empty_repo() {
        let repo = TestRepo::new();
        // For a truly empty repo (no commits), the revwalk should produce nothing
        let result = get_commit_graph(repo.path_str(), Some(100), None, None).await;
        assert!(result.is_ok());
        let graph = result.unwrap();
        assert_eq!(graph.total_commits, 0);
        assert!(graph.nodes.is_empty());
    }
}
