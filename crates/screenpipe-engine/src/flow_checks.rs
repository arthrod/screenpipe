// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

//! Why a workflow built by the chat cannot become a Flow: a node type this
//! n8n does not load (invented, or switched off like Execute Command), a
//! version it does not have, a required parameter left empty, a credential
//! the node needs and n8n does not hold, a node connected to nothing, or no
//! trigger at all. A Flow is never created half-built.
//!
//! Node facts come from `infra/automation-flows/n8n-catalog.json`, generated
//! from the n8n image by `n8n-catalog.ts`. Display rules (`show`/`hide`) are
//! evaluated as n8n does for plain values and the common `_cnd` conditions;
//! a rule this check cannot evaluate never causes a refusal.
//!
//! Credentials still never come from the chat's request (ticket 22): a node
//! keeps the one n8n already gives it, and a credential it needs and lacks is
//! wired here when n8n holds exactly one of that type. None, or several, is a
//! refusal: ScreenPipe does not choose between the user's accounts.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const CATALOG_JSON: &str = include_str!("../../../infra/automation-flows/n8n-catalog.json");
const STICKY_NOTE: &str = "n8n-nodes-base.stickyNote";
/// Display rules can read parameters whose own rules read others.
const MAX_RULE_DEPTH: u8 = 8;

#[derive(Deserialize)]
struct Catalog {
    excluded: Vec<String>,
    nodes: HashMap<String, Vec<Group>>,
}

/// One set of versions of a node type, as the catalog describes it.
#[derive(Deserialize)]
struct Group {
    versions: Vec<f64>,
    #[serde(default)]
    trigger: bool,
    credentials: Vec<CredentialRule>,
    params: Vec<ParamDef>,
}

#[derive(Deserialize)]
struct CredentialRule {
    name: String,
    #[serde(flatten)]
    rules: Rules,
}

#[derive(Deserialize)]
struct ParamDef {
    name: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    default: Value,
    #[serde(default)]
    required: bool,
    #[serde(flatten)]
    rules: Rules,
}

#[derive(Deserialize, Default)]
struct Rules {
    #[serde(default)]
    show: Option<Map<String, Value>>,
    #[serde(default)]
    hide: Option<Map<String, Value>>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(CATALOG_JSON).expect("n8n-catalog.json is valid"))
}

/// A credential n8n holds: never its secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct N8nCredential {
    pub id: String,
    pub name: String,
    pub kind: String,
}

impl N8nCredential {
    /// One item of n8n's `GET /credentials`.
    pub fn from_n8n(item: &Value) -> Option<Self> {
        Some(Self {
            id: item["id"].as_str()?.to_string(),
            name: item["name"].as_str().unwrap_or_default().to_string(),
            kind: item["type"].as_str()?.to_string(),
        })
    }
}

/// Checks `workflow` against what this n8n really has and wires each
/// credential a node needs when n8n holds exactly one of its type. On a
/// refusal, every problem is listed so one answer tells the chat all it must
/// fix.
pub fn check_and_wire(workflow: &mut Value, credentials: &[N8nCredential]) -> Result<(), Vec<String>> {
    let problems = inspect(workflow, credentials).problems();
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// What the check found on one node (sticky notes are not reported).
#[derive(Debug, Clone, PartialEq)]
pub struct NodeReport {
    pub name: String,
    pub kind: String,
    /// The node can never run here: a type this n8n does not have or
    /// switches off, or a version it lacks. A step of a draft is refused.
    pub invention: Option<String>,
    /// What the node still lacks: a required parameter, a credential, a link.
    pub missing: Vec<String>,
    /// The credentials the node holds after wiring: (credential type, name).
    pub credentials: Vec<(String, String)>,
}

/// The check of a whole workflow, node by node.
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub nodes: Vec<NodeReport>,
    pub has_trigger: bool,
}

pub const NO_TRIGGER: &str = "the workflow has no trigger node, so it would never run";

impl Report {
    /// Why the workflow can never become a Flow as built: inventions only.
    pub fn inventions(&self) -> Vec<String> {
        self.nodes.iter().filter_map(|node| node.invention.clone()).collect()
    }

    /// Every problem, node by node, then the missing trigger.
    pub fn problems(&self) -> Vec<String> {
        let mut problems: Vec<String> = self
            .nodes
            .iter()
            .flat_map(|node| node.invention.iter().chain(&node.missing).cloned())
            .collect();
        if !self.has_trigger {
            problems.push(NO_TRIGGER.into());
        }
        problems
    }
}

/// [`check_and_wire`] without the verdict: what each node lacks, and the
/// credentials it holds once the only one n8n has of a needed type is wired.
pub fn inspect(workflow: &mut Value, credentials: &[N8nCredential]) -> Report {
    let linked = linked_names(&workflow["connections"]);
    let mut reports = Vec::new();
    let mut has_trigger = false;
    for node in workflow["nodes"].as_array_mut().into_iter().flatten() {
        let kind = node["type"].as_str().unwrap_or_default().to_string();
        if kind == STICKY_NOTE {
            continue;
        }
        let name = node["name"].as_str().unwrap_or("(unnamed)").to_string();
        let mut report = NodeReport {
            name: name.clone(),
            kind: kind.clone(),
            invention: None,
            missing: Vec::new(),
            credentials: Vec::new(),
        };
        if !linked.contains(&name) {
            report.missing.push(format!("« {name} » is connected to no other node"));
        }
        inspect_node(node, &mut report, credentials, &mut has_trigger);
        report.credentials = held_credentials(node);
        reports.push(report);
    }
    Report { nodes: reports, has_trigger }
}

fn inspect_node(node: &mut Value, report: &mut NodeReport, credentials: &[N8nCredential], has_trigger: &mut bool) {
    let catalog = catalog();
    let (name, kind) = (report.name.clone(), report.kind.clone());
    let Some(groups) = catalog.nodes.get(&kind) else {
        report.invention = Some(if catalog.excluded.contains(&kind) {
            format!("« {name} »: `{kind}` is switched off in this n8n; no node here can do that")
        } else {
            format!("« {name} »: `{kind}` is not a node type this n8n has; never invent one")
        });
        return;
    };
    let version = node["typeVersion"].as_f64().unwrap_or(1.0);
    let Some(group) = groups
        .iter()
        .find(|g| g.versions.iter().any(|v| (v - version).abs() < 1e-9))
    else {
        let known: Vec<String> = groups.iter().flat_map(|g| &g.versions).map(f64::to_string).collect();
        report.invention = Some(format!(
            "« {name} »: `{kind}` has no version {version} here (versions: {})",
            known.join(", ")
        ));
        return;
    };
    *has_trigger |= group.trigger;
    let empty_params = Map::new();
    let params = node["parameters"].as_object().unwrap_or(&empty_params);
    let eval = Eval { group, params, version };

    let mut checked = HashSet::new();
    for def in group.params.iter().filter(|def| def.required) {
        if checked.contains(&def.name) || eval.shown(&def.rules, 0) != Some(true) {
            continue;
        }
        checked.insert(def.name.clone());
        let value = params.get(&def.name).unwrap_or(&def.default);
        if is_empty(value, def.kind.as_deref()) {
            report.missing.push(format!("« {name} »: required parameter `{}` is empty", def.name));
        }
    }

    let mut needed: Vec<String> = group
        .credentials
        .iter()
        .filter(|rule| eval.shown(&rule.rules, 0) == Some(true))
        .map(|rule| rule.name.clone())
        .collect();
    // HTTP Request and its kin name any credential type in a parameter.
    if params.get("authentication").and_then(Value::as_str) == Some("predefinedCredentialType") {
        if let Some(predefined) = params.get("nodeCredentialType").and_then(Value::as_str) {
            needed.push(predefined.to_string());
        }
    }
    needed.sort();
    needed.dedup();
    for credential_kind in needed {
        if let Err(problem) = wire(node, &name, &credential_kind, credentials) {
            report.missing.push(problem);
        }
    }
}

/// (credential type, name) of each credential the node holds.
fn held_credentials(node: &Value) -> Vec<(String, String)> {
    node["credentials"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(kind, credential)| {
            (kind.clone(), credential["name"].as_str().unwrap_or_default().to_string())
        })
        .collect()
}

/// The parameters a new node of `kind` at `version` starts from, for the card
/// the chat reads ([`crate::n8n_nodes`]): every parameter the check reads
/// (required ones and those their display rules read) that is shown, at the
/// `chosen` value or its default. The chat fills the empty ones. `None` when
/// the check does not know that type at that version.
pub fn skeleton_parameters(
    kind: &str,
    version: f64,
    chosen: &Map<String, Value>,
) -> Option<Map<String, Value>> {
    let group = catalog()
        .nodes
        .get(kind)?
        .iter()
        .find(|g| g.versions.iter().any(|v| (v - version).abs() < 1e-9))?;
    let eval = Eval { group, params: chosen, version };
    let mut parameters = chosen.clone();
    for def in &group.params {
        if !parameters.contains_key(&def.name) && eval.shown(&def.rules, 0) == Some(true) {
            parameters.insert(def.name.clone(), def.default.clone());
        }
    }
    Some(parameters)
}

/// Keeps the node's credential of `kind` when n8n holds it, else wires the
/// only one n8n has of that kind.
fn wire(node: &mut Value, name: &str, kind: &str, credentials: &[N8nCredential]) -> Result<(), String> {
    let held = node["credentials"][kind]["id"].as_str();
    if credentials.iter().any(|c| c.kind == kind && Some(c.id.as_str()) == held) {
        return Ok(());
    }
    let candidates: Vec<&N8nCredential> = credentials.iter().filter(|c| c.kind == kind).collect();
    match candidates.as_slice() {
        [only] => {
            if !node["credentials"].is_object() {
                node["credentials"] = json!({});
            }
            node["credentials"][kind] = json!({"id": only.id, "name": only.name});
            Ok(())
        }
        [] => Err(format!(
            "« {name} » needs a `{kind}` credential and n8n has none: the user must create it in n8n first"
        )),
        several => Err(format!(
            "« {name} » needs a `{kind}` credential and n8n has {} ({}): ScreenPipe does not choose between the user's accounts",
            several.len(),
            several.iter().map(|c| format!("« {} »", c.name)).collect::<Vec<_>>().join(", ")
        )),
    }
}

/// Every node named on either end of a connection, of any kind (`main`, `ai_tool`, …).
fn linked_names(connections: &Value) -> HashSet<String> {
    let mut names = HashSet::new();
    for (source, outputs) in connections.as_object().into_iter().flatten() {
        for lists in outputs.as_object().into_iter().flat_map(|o| o.values()) {
            for target in lists.as_array().into_iter().flatten().flat_map(|l| l.as_array().into_iter().flatten()) {
                if let Some(target) = target["node"].as_str() {
                    names.insert(source.clone());
                    names.insert(target.to_string());
                }
            }
        }
    }
    names
}

/// Whether a value leaves a required parameter unset, as n8n's editor sees it.
fn is_empty(value: &Value, kind: Option<&str>) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(fields) if fields.contains_key("__rl") => {
            is_empty(fields.get("value").unwrap_or(&Value::Null), None)
        }
        Value::Object(fields) => matches!(kind, Some("collection" | "fixedCollection")) && fields.is_empty(),
        Value::Bool(_) | Value::Number(_) => false,
    }
}

/// Display rules of one node, read against its parameters and the defaults.
struct Eval<'a> {
    group: &'a Group,
    params: &'a Map<String, Value>,
    version: f64,
}

impl Eval<'_> {
    /// Whether `rules` switch a parameter or credential on; `None` when they
    /// read something this check cannot know.
    fn shown(&self, rules: &Rules, depth: u8) -> Option<bool> {
        if depth > MAX_RULE_DEPTH {
            return None;
        }
        for (key, allowed) in rules.show.iter().flatten() {
            if !any_matches(allowed, &self.value(key, depth)?)? {
                return Some(false);
            }
        }
        for (key, allowed) in rules.hide.iter().flatten() {
            if any_matches(allowed, &self.value(key, depth)?)? {
                return Some(false);
            }
        }
        Some(true)
    }

    /// The value a rule reads: `@version`, a parameter the node sets, or the
    /// default of the definition of that parameter its own rules switch on.
    fn value(&self, key: &str, depth: u8) -> Option<Value> {
        if key == "@version" {
            return Some(json!(self.version));
        }
        if key.starts_with('@') {
            return None;
        }
        let name = key.trim_start_matches('/');
        if let Some(value) = self.params.get(name) {
            return Some(value.clone());
        }
        for def in self.group.params.iter().filter(|def| def.name == name) {
            if self.shown(&def.rules, depth + 1)? {
                return Some(def.default.clone());
            }
        }
        None
    }
}

/// Whether `value` is one of `allowed`; `None` when only an unknown
/// condition could have matched.
fn any_matches(allowed: &Value, value: &Value) -> Option<bool> {
    let mut unknown = false;
    for candidate in allowed.as_array().into_iter().flatten() {
        let matched = match candidate.get("_cnd").and_then(Value::as_object) {
            Some(condition) => condition_holds(condition, value),
            None => Some(same(candidate, value)),
        };
        match matched {
            Some(true) => return Some(true),
            Some(false) => {}
            None => unknown = true,
        }
    }
    if unknown {
        None
    } else {
        Some(false)
    }
}

/// n8n's `_cnd` display conditions; `None` for one this check does not know.
fn condition_holds(condition: &Map<String, Value>, value: &Value) -> Option<bool> {
    let (op, arg) = condition.iter().next()?;
    let number = |v: &Value| v.as_f64();
    Some(match op.as_str() {
        "eq" => same(arg, value),
        "not" => !same(arg, value),
        "gte" => number(value)? >= number(arg)?,
        "lte" => number(value)? <= number(arg)?,
        "gt" => number(value)? > number(arg)?,
        "lt" => number(value)? < number(arg)?,
        "between" => {
            let v = number(value)?;
            v >= number(&arg["from"])? && v <= number(&arg["to"])?
        }
        "exists" => !value.is_null() && value != "",
        "startsWith" => value.as_str()?.starts_with(arg.as_str()?),
        "endsWith" => value.as_str()?.ends_with(arg.as_str()?),
        "includes" => value.as_str()?.contains(arg.as_str()?),
        _ => return None,
    })
}

/// Equality with numbers compared as numbers (`2` is `2.0`).
fn same(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) if !a.is_boolean() && !b.is_boolean() => (x - y).abs() < 1e-9,
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials() -> Vec<N8nCredential> {
        [
            ("g1", "Gmail", "gmailOAuth2"),
            ("j1", "NovaDesk Jira", "jiraSoftwareCloudApi"),
            ("s1", "ScreenPipe API", "screenpipeApi"),
            ("o1", "ScreenPipe AI proxy", "openAiApi"),
            ("i1", "NovaDesk IMAP", "imap"),
        ]
        .into_iter()
        .map(|(id, name, kind)| N8nCredential { id: id.into(), name: name.into(), kind: kind.into() })
        .collect()
    }

    fn schedule() -> Value {
        json!({"name": "Toutes les 5 min", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "parameters": {}})
    }

    /// The nodes, each connected to the next.
    fn chain(nodes: Vec<Value>) -> Value {
        let names: Vec<String> = nodes.iter().map(|n| n["name"].as_str().unwrap().to_string()).collect();
        let mut connections = Map::new();
        for pair in names.windows(2) {
            connections.insert(pair[0].clone(), json!({"main": [[{"node": pair[1], "type": "main", "index": 0}]]}));
        }
        json!({"nodes": nodes, "connections": connections})
    }

    fn problems(mut workflow: Value) -> Vec<String> {
        check_and_wire(&mut workflow, &credentials()).err().unwrap_or_default()
    }

    #[test]
    fn the_demo_workflow_passes_untouched() {
        let mut demo: Value = serde_json::from_str(include_str!(
            "../../../infra/automation-flows/workflows/novadesk-support-tickets.json"
        ))
        .unwrap();
        let mut credentials = credentials();
        // The demo's own credential ids.
        for (id, kind) in [
            ("iI1juBmbWgqjr8Yo", "gmailOAuth2"),
            ("spProxyOpenAI001", "openAiApi"),
            ("spScreenpipeApi1", "screenpipeApi"),
            ("spNovaJira000001", "jiraSoftwareCloudApi"),
        ] {
            credentials.push(N8nCredential { id: id.into(), name: id.into(), kind: kind.into() });
        }
        let before = demo.clone();
        assert_eq!(check_and_wire(&mut demo, &credentials), Ok(()));
        assert_eq!(demo, before);
    }

    #[test]
    fn a_switched_off_or_invented_node_type_is_refused() {
        let execute = json!({"name": "Ouvrir un terminal", "type": "n8n-nodes-base.executeCommand", "typeVersion": 1, "parameters": {"command": "open -a Terminal"}});
        let found = problems(chain(vec![schedule(), execute]));
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("switched off in this n8n"), "{found:?}");

        let invented = json!({"name": "Terminal", "type": "n8n-nodes-base.openTerminal", "typeVersion": 1, "parameters": {}});
        assert!(problems(chain(vec![schedule(), invented]))[0].contains("not a node type this n8n has"));
    }

    #[test]
    fn a_version_n8n_does_not_have_is_refused() {
        let http = json!({"name": "Requête", "type": "n8n-nodes-base.httpRequest", "typeVersion": 9, "parameters": {"url": "https://x"}});
        assert!(problems(chain(vec![schedule(), http]))[0].contains("has no version 9"));
    }

    #[test]
    fn an_empty_required_parameter_is_refused_and_a_set_one_passes() {
        let gmail = |params: Value| json!({"name": "Envoyer", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "parameters": params});
        let found = problems(chain(vec![schedule(), gmail(json!({"operation": "send"}))]));
        assert_eq!(found.len(), 3, "{found:?}");
        assert!(found.iter().any(|p| p.contains("`sendTo`")));

        let ok = gmail(json!({"operation": "send", "sendTo": "a@b.c", "subject": "s", "message": "m"}));
        assert_eq!(problems(chain(vec![schedule(), ok])), Vec::<String>::new());

        let http = json!({"name": "Requête", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "parameters": {}});
        assert!(problems(chain(vec![schedule(), http]))[0].contains("`url`"));
    }

    #[test]
    fn the_only_credential_of_a_type_is_wired_and_a_missing_one_refused() {
        let mut workflow = chain(vec![
            json!({"name": "Si", "type": "CUSTOM.screenPipeAiTrigger", "typeVersion": 1, "parameters": {"conditionPrompt": "x"}}),
            json!({"name": "Envoyer", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1,
                   "parameters": {"operation": "send", "sendTo": "a@b.c", "subject": "s", "message": "m"}}),
        ]);
        assert_eq!(check_and_wire(&mut workflow, &credentials()), Ok(()));
        assert_eq!(workflow["nodes"][0]["credentials"], json!({"screenpipeApi": {"id": "s1", "name": "ScreenPipe API"}}));
        assert_eq!(workflow["nodes"][1]["credentials"], json!({"gmailOAuth2": {"id": "g1", "name": "Gmail"}}));

        let slack = json!({"name": "Slack", "type": "n8n-nodes-base.slack", "typeVersion": 2.3,
                           "parameters": {"select": "channel", "channelId": {"__rl": true, "mode": "id", "value": "C1"}, "text": "hi"}});
        let found = problems(chain(vec![schedule(), slack]));
        assert_eq!(found, vec!["« Slack » needs a `slackApi` credential and n8n has none: the user must create it in n8n first"]);
    }

    #[test]
    fn several_credentials_of_a_type_are_never_chosen_between() {
        let mut two = credentials();
        two.push(N8nCredential { id: "g2".into(), name: "Gmail perso".into(), kind: "gmailOAuth2".into() });
        let mut workflow = chain(vec![
            schedule(),
            json!({"name": "Envoyer", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1,
                   "parameters": {"operation": "send", "sendTo": "a@b.c", "subject": "s", "message": "m"}}),
        ]);
        let found = check_and_wire(&mut workflow, &two).unwrap_err();
        assert!(found[0].contains("has 2 (« Gmail », « Gmail perso »)"), "{found:?}");

        // The credential n8n already gives the node is kept.
        workflow["nodes"][1]["credentials"] = json!({"gmailOAuth2": {"id": "g2", "name": "Gmail perso"}});
        assert_eq!(check_and_wire(&mut workflow, &two), Ok(()));
    }

    #[test]
    fn a_predefined_credential_type_must_exist() {
        let http = |kind: &str| json!({"name": "Jira", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "parameters": {"url": "https://x", "authentication": "predefinedCredentialType", "nodeCredentialType": kind}});
        assert_eq!(problems(chain(vec![schedule(), http("jiraSoftwareCloudApi")])), Vec::<String>::new());
        assert!(problems(chain(vec![schedule(), http("notionApi")]))[0].contains("`notionApi`"));
    }

    #[test]
    fn a_lone_node_and_a_workflow_without_trigger_are_refused() {
        let http = json!({"name": "Requête", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "parameters": {"url": "https://x"}});
        let lone = json!({"nodes": [schedule(), http.clone()], "connections": {}});
        let found = problems(lone);
        assert_eq!(found.len(), 2, "{found:?}");
        assert!(found.iter().all(|p| p.contains("connected to no other node")));

        let set = json!({"name": "Préparer", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "parameters": {}});
        assert_eq!(problems(chain(vec![http, set])), vec!["the workflow has no trigger node, so it would never run"]);
    }

    #[test]
    fn every_problem_is_listed_at_once() {
        let slack = json!({"name": "Slack", "type": "n8n-nodes-base.slack", "typeVersion": 2.3, "parameters": {}});
        let found = problems(json!({"nodes": [schedule(), slack], "connections": {}}));
        assert!(found.len() >= 4, "{found:?}");
    }
}
